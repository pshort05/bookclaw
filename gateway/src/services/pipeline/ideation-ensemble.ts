/**
 * Opt-in Ideation Ensemble (Flagship Plan 8, Tasks 1-3).
 *
 * Fans one seed premise out to a panel of models (default
 * `[gpt, grok, gemini, claude]`), each writing a pitch from a distinct
 * creative angle, then a divergence-preserving judge picks the strongest
 * single pitch (or names what it grafted from the others). Built in-house —
 * NOT OpenRouter Fusion, whose consensus judge would flatten the panel's
 * divergence back toward the average pitch (spec §4.4).
 *
 * Reuses AIRouter.complete via an injected `complete` callback; no new HTTP
 * client. Off by default — this module has no opinion on when it runs, that
 * opt-in gate lives in the wiring seam (see `_shared.ts`'s
 * `resolveEnsemblePremise`).
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { jsonrepair } from 'jsonrepair';

export interface EnsemblePitch {
  member: string;
  angle: string;
  pitch: string;
}

export interface SelectPitchResult {
  chosen: string;
  rationale: string;
  graftedFrom: string[];
}

/** The genre casting sheet's `ensemblePanel` default when a book has none of its own. */
export const DEFAULT_ENSEMBLE_PANEL: readonly string[] = ['gpt', 'grok', 'gemini', 'claude'];

/**
 * Panel-member name -> real, router-registered provider id (+ optional pinned
 * model). A panel member string ('gpt'/'grok'/'gemini'/'claude') is NOT a
 * provider id — AIRouter only registers 'ollama' | 'gemini' | 'deepseek' |
 * 'claude' | 'openai' | 'openrouter' (router.ts AI_PROVIDER_IDS). Calling
 * `complete` with an unmapped/wrong provider id throws ("Provider X not
 * found"); that's a fatal-looking error for one panel member, but
 * `runIdeationEnsemble` catches it per-member (Promise.allSettled) so a bad
 * mapping only drops that one pitch instead of going inert.
 *
 * Grok has no dedicated router provider — routed via OpenRouter with a
 * pinned model (models are provisional across this repo's pipeline library,
 * same convention as library/pipelines/*.json).
 */
const PANEL_MEMBER_PROVIDERS: Record<string, { provider: string; model?: string }> = {
  gpt: { provider: 'openai' },
  claude: { provider: 'claude' },
  gemini: { provider: 'gemini' },
  grok: { provider: 'openrouter', model: 'x-ai/grok-4' },
};

/** Default production panel-member -> provider resolver. Throws on an unknown member name (caught per-member by the fan-out, never fatal to the whole ensemble). */
export function resolvePanelMemberProvider(member: string): { provider: string; model?: string } {
  const mapped = PANEL_MEMBER_PROVIDERS[String(member || '').toLowerCase().trim()];
  if (!mapped) throw new Error(`Unknown ideation-ensemble panel member: "${member}"`);
  return mapped;
}

/** Effective panel: an explicit book override wins, else the genre sheet's ensemblePanel, else the hardcoded default. */
export function resolveEnsemblePanel(args: { manifestPanel?: string[]; sheetPanel?: string[] }): string[] {
  if (args.manifestPanel && args.manifestPanel.length > 0) return args.manifestPanel;
  if (args.sheetPanel && args.sheetPanel.length > 0) return args.sheetPanel;
  return [...DEFAULT_ENSEMBLE_PANEL];
}

/** Fail-soft default angles, used only if library/craft/ideation-angles.json is missing/unreadable. */
const FALLBACK_ANGLES: Record<string, string> = {
  'mvp-first': 'Find the leanest, most commercially proven version of this premise — the version an editor could greenlight today with the least execution risk.',
  'risk-first': "Push the premise toward its boldest, least-safe version — the choice that could fail spectacularly but, if it lands, is unforgettable.",
  'character-first': "Build the pitch outward from the protagonist's psychology — their want, wound, and contradiction — letting plot and stakes follow from who this person specifically is.",
  'world-first': "Build the pitch outward from the setting/world's own rules and pressures — let the world's logic generate the conflict and stakes.",
};

/** Loads the per-panel angle prompts from library/craft/ideation-angles.json. Fail-soft to FALLBACK_ANGLES on any read/parse error. */
export function loadIdeationAngles(builtinDir?: string): Record<string, string> {
  const dir = builtinDir ?? join(process.cwd(), 'library', 'craft');
  const p = join(dir, 'ideation-angles.json');
  if (!existsSync(p)) return { ...FALLBACK_ANGLES };
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...FALLBACK_ANGLES };
    const angles: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim()) angles[k] = v;
    }
    return Object.keys(angles).length > 0 ? angles : { ...FALLBACK_ANGLES };
  } catch {
    return { ...FALLBACK_ANGLES };
  }
}

/**
 * Task 1: fan one premise out to N panel members in parallel, each writing a
 * pitch from a distinct creative angle. A member that fails to resolve a
 * provider or whose `complete` call rejects is dropped (logged), never fatal
 * to the rest of the panel. An empty panel or empty angle set returns [].
 */
export async function runIdeationEnsemble(args: {
  premise: string;
  genre: string;
  panel: string[];
  angles: Record<string, string>;
  complete: (req: any) => Promise<{ text: string }>;
  resolveModel: (member: string) => { provider: string; model?: string };
}): Promise<EnsemblePitch[]> {
  const { premise, genre, panel, angles, complete, resolveModel } = args;
  const angleNames = Object.keys(angles);
  if (panel.length === 0 || angleNames.length === 0) return [];

  const settled = await Promise.allSettled(
    panel.map(async (member, i) => {
      const angle = angleNames[i % angleNames.length];
      const instruction = angles[angle];
      const { provider, model } = resolveModel(member);
      const system = `You are a creative story consultant on a panel independently pitching one divergent take on a novel premise. Your assigned creative angle for this pass: "${angle}" — ${instruction} Write only the pitch, no preamble or meta-commentary.`;
      const userContent = `Genre: ${genre || 'fiction'}\n\nSeed premise / concept:\n${premise}\n\nWrite ONE pitch (a logline plus a short premise elaboration, roughly 150-300 words) that develops this concept from your assigned angle.`;
      const resp = await complete({
        provider,
        ...(model ? { model } : {}),
        system,
        messages: [{ role: 'user', content: userContent }],
      });
      const pitch: EnsemblePitch = { member, angle, pitch: resp.text };
      return pitch;
    }),
  );

  const pitches: EnsemblePitch[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      pitches.push(s.value);
    } else {
      console.warn('  [ideation-ensemble] panel member dropped (non-fatal):', (s.reason as Error)?.message ?? s.reason);
    }
  }
  return pitches;
}

const JUDGE_SYSTEM = 'You are a divergence-preserving creative judge for a panel of AI-generated novel pitches. Your job is NOT to average or blend the panel into a consensus — pick the SINGLE strongest pitch, optionally grafting a specific strength from another pitch onto it, and explain why. Score on originality, genre fit, and hook strength. Reward a pitch that commits hard to one bold angle over one that hedges toward the middle. Respond with ONLY a JSON object: {"chosen": "<the full text of the winning pitch, verbatim, with any grafted addition folded in>", "rationale": "<2-4 sentences>", "graftedFrom": ["<member ids whose ideas were grafted in, if any>"]}';

function buildJudgePrompt(pitches: EnsemblePitch[], premise: string): string {
  const listed = pitches
    .map((p, i) => `### Pitch ${i + 1} — panel member "${p.member}", angle "${p.angle}"\n${p.pitch}`)
    .join('\n\n');
  return `Seed premise / concept:\n${premise}\n\nThe panel produced these divergent pitches:\n\n${listed}\n\nPick the single strongest pitch. You may graft one or two specific strengths from other pitches onto it, but the result must stay a coherent single pitch driven by one clear angle — not an averaged blend. Respond with ONLY the JSON object described in your instructions.`;
}

/** Fail-soft fallback when the judge call/parse fails: deterministically keep the longest pitch (a proxy for the most fully-developed one) rather than throwing. */
function fallbackSelection(pitches: EnsemblePitch[]): SelectPitchResult {
  if (pitches.length === 0) return { chosen: '', rationale: 'No pitches to judge.', graftedFrom: [] };
  const longest = pitches.reduce((best, p) => (p.pitch.length > best.pitch.length ? p : best), pitches[0]);
  return {
    chosen: longest.pitch,
    rationale: 'Judge unavailable — fell back to the longest (most fully-developed) pitch.',
    graftedFrom: [longest.member],
  };
}

function parseJudgeJson(raw: string): any {
  const cleaned = String(raw || '').replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start >= 0 && end > start ? cleaned.substring(start, end + 1) : cleaned;
  try { return JSON.parse(candidate); }
  catch { return JSON.parse(jsonrepair(candidate)); }
}

/**
 * Task 2: judge the panel's pitches and pick (or graft-blend into) the single
 * strongest one — deliberately NOT a consensus merge (spec §4.4). Tolerant
 * JSON parse (jsonrepair). Any judge-call or parse failure falls back
 * deterministically to the longest pitch rather than throwing.
 */
export async function selectPitch(args: {
  pitches: EnsemblePitch[];
  premise: string;
  complete: (req: any) => Promise<{ text: string }>;
  judgeModel: { provider: string; model?: string };
}): Promise<SelectPitchResult> {
  const { pitches, premise, complete, judgeModel } = args;
  if (pitches.length === 0) return fallbackSelection(pitches);

  let raw: string;
  try {
    const resp = await complete({
      provider: judgeModel.provider,
      ...(judgeModel.model ? { model: judgeModel.model } : {}),
      system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: buildJudgePrompt(pitches, premise) }],
    });
    raw = resp.text ?? '';
  } catch (err) {
    console.warn('  [select-pitch] judge call failed, falling back:', (err as Error)?.message || err);
    return fallbackSelection(pitches);
  }

  try {
    const parsed = parseJudgeJson(raw);
    if (!parsed || typeof parsed.chosen !== 'string' || !parsed.chosen.trim()) {
      return fallbackSelection(pitches);
    }
    return {
      chosen: parsed.chosen,
      rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
      graftedFrom: Array.isArray(parsed.graftedFrom) ? parsed.graftedFrom.filter((x: unknown) => typeof x === 'string') : [],
    };
  } catch (err) {
    console.warn('  [select-pitch] judge returned unparseable JSON, falling back:', (err as Error)?.message || err);
    return fallbackSelection(pitches);
  }
}
