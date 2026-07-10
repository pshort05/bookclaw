/**
 * LLM Council — base-story origination (Romance Workflow sub-project 3).
 *
 * From the author's romance seeds, fan out N candidate base stories (premise +
 * relationship arc) across N model configs, then a single judge call ranks the
 * candidates and recommends one. Pure, injected-AI service — no engine coupling,
 * modelled on the shipped PremiseIntakeService (premise-intake.ts:11-39) so it is
 * deterministically unit-testable. The chosen candidate's `text` is what the
 * council-gate (council-gate.ts) writes as the council step's result; downstream
 * pipeline steps consume it via the existing step-result chaining.
 */
export type AiComplete = (req: { provider: string; system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number; thinking?: 'low' | 'medium' | 'high' }) => Promise<{ text: string }>;
export type AiSelectProvider = (taskType: string) => { id: string };

export interface CouncilSeeds { storyArc: string; characters: string; setting: string; blueprint: string; heat: 'sweet' | 'spicy'; title?: string; }
export interface CouncilCandidate { id: string; model: string; premise: string; relationshipArc: string; text: string; }
export interface CouncilRanking { id: string; rank: number; rationale: string; }
export interface CouncilResult { candidates: CouncilCandidate[]; ranking: CouncilRanking[]; recommendedId: string; rationale: string; }

// N model configs — 3 by default; degrade to fewer if a generation fails.
export interface CouncilModel { provider: string; model?: string; }

const DEFAULT_MODELS: CouncilModel[] = [
  { provider: 'claude' },
  { provider: 'gemini' },
  { provider: 'deepseek' },
];

const GENERATION_SYSTEM = `You originate ONE candidate base story (premise + relationship arc) for a romance novel from the author's seeds.
Rules:
- Develop, preserve, and fill gaps in the seeds — never discard or contradict what the author wrote.
- The premise sets up the central romantic conflict and stakes; the relationship arc sketches meet, escalation, midpoint, dark moment, and resolution.
- Output ONE JSON object and nothing else, matching:
{"premise": "<premise prose>", "relationshipArc": "<relationship arc prose>"}`;

const JUDGE_SYSTEM = `You are the LLM COUNCIL JUDGE for a romance novel base-story council. You receive several candidate base stories (premise + relationship arc) and must rank them and recommend the strongest for a full novel pipeline.
Judge on: originality, emotional stakes, romance-genre fit, and how well the premise sustains a full-length relationship arc.
Output ONE JSON object and nothing else, matching:
{"ranking":[{"id","rank","rationale"}],"recommendedId","rationale"}
ranking MUST include every candidate id exactly once (rank 1 = best); recommendedId MUST be one of the candidate ids.`;

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(raw); } catch { throw new Error('COUNCIL_PARSE_FAILED'); }
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function buildGenerationPrompt(seeds: CouncilSeeds): string {
  return `Develop ONE candidate base story for a ${seeds.heat} romance${seeds.title ? ` titled "${seeds.title}"` : ''}.

STORY ARC SEED:
${seeds.storyArc}

CHARACTERS SEED:
${seeds.characters}

SETTING SEED:
${seeds.setting}

BLUEPRINT SEED (acts / POV / ending):
${seeds.blueprint}`;
}

export class CouncilService {
  constructor(
    private aiComplete: AiComplete,
    private aiSelectProvider: AiSelectProvider,
    private models: CouncilModel[] = DEFAULT_MODELS,
  ) {}

  async originate(seeds: CouncilSeeds): Promise<CouncilResult> {
    const settled = await Promise.all(
      this.models.map((model, index) => this.generateCandidate(seeds, model, index).catch(() => null)),
    );
    const candidates = settled.filter((c): c is CouncilCandidate => c !== null);
    if (candidates.length === 0) throw new Error('COUNCIL_ORIGINATION_FAILED');

    const { ranking, recommendedId, rationale } = await this.judge(candidates);
    return { candidates, ranking, recommendedId, rationale };
  }

  private async generateCandidate(seeds: CouncilSeeds, model: CouncilModel, index: number): Promise<CouncilCandidate> {
    const { text } = await this.aiComplete({
      provider: model.provider,
      system: GENERATION_SYSTEM,
      messages: [{ role: 'user', content: buildGenerationPrompt(seeds) }],
      maxTokens: 4000,
      thinking: 'medium',
    });
    const j = extractJson(text);
    const premise = str(j?.premise);
    const relationshipArc = str(j?.relationshipArc);
    return {
      id: `c${index + 1}`,
      model: model.model ? `${model.provider}/${model.model}` : model.provider,
      premise,
      relationshipArc,
      text: `PREMISE\n${premise}\n\nRELATIONSHIP ARC\n${relationshipArc}`,
    };
  }

  private async judge(candidates: CouncilCandidate[]): Promise<{ ranking: CouncilRanking[]; recommendedId: string; rationale: string }> {
    const provider = this.aiSelectProvider('book_bible').id;
    const payload = candidates.map((c) => ({ id: c.id, premise: c.premise, relationshipArc: c.relationshipArc }));
    const { text } = await this.aiComplete({
      provider,
      system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
      maxTokens: 4000,
      thinking: 'medium',
    });

    let j: any;
    try { j = extractJson(text); } catch { j = null; }

    const ids = new Set(candidates.map((c) => c.id));
    const ranking: CouncilRanking[] = Array.isArray(j?.ranking)
      ? j.ranking.filter((r: any) => r && ids.has(r.id)).map((r: any) => ({
          id: str(r.id),
          rank: typeof r.rank === 'number' ? r.rank : 0,
          rationale: str(r.rationale),
        }))
      : [];

    let recommendedId = str(j?.recommendedId);
    if (!ids.has(recommendedId)) {
      console.log('  ℹ Council judge recommendation missing/invalid — falling back to the first candidate');
      recommendedId = candidates[0].id;
    }

    return { ranking, recommendedId, rationale: str(j?.rationale) };
  }
}

/**
 * Adapt the app's AI router into a CouncilService (used by both project drivers).
 * Kept out of the class so the class stays purely injected/unit-testable.
 *
 * Each council model names a preferred provider (claude/gemini/deepseek), but the
 * provider is resolved through selectProvider(taskType, preferred): if the
 * preferred provider is not registered/available (e.g. no API keys on an
 * Ollama-only deployment) it degrades to an available one rather than throwing —
 * so the council still fans out N generations on any deployment with ≥1 provider.
 */
export function buildCouncilService(
  aiRouter: { complete(req: any): Promise<{ text: string }>; selectProvider(taskType: string, preferredId?: string): { id: string } },
): CouncilService {
  const complete: AiComplete = (r) => aiRouter.complete({ ...r, provider: aiRouter.selectProvider('book_bible', r.provider).id });
  const selectProvider: AiSelectProvider = (t) => aiRouter.selectProvider(t);
  return new CouncilService(complete, selectProvider);
}
