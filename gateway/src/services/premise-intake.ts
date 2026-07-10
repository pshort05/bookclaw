export type SeedField = 'storyArc' | 'characters' | 'setting' | 'blueprint' | 'heat' | 'chapterCount' | 'wordsPerChapter';
export interface IntakeSeeds { storyArc: string; characters: string; setting: string; blueprint: string; heat: 'sweet' | 'spicy'; chapterCount: number; wordsPerChapter: number; }
export interface IntakeGap { id: string; question: string; proposedAnswer: string; alternatives?: string[]; targetField: SeedField; }
export interface RealPlace { isReal: boolean; canonicalName?: string; }
export interface IntakeResult { seeds: IntakeSeeds; gaps: IntakeGap[]; realPlace: RealPlace; }

export interface Discrepancy { id: string; premiseClaim: string; finding: string; status: 'pass' | 'fail'; suggestion?: string; targetField: 'setting' | 'blueprint' | 'characters'; }
export type GroundingStatus = 'grounded' | 'fallback-llm' | 'skipped';
export interface GroundingResult { dossier: string; discrepancies: Discrepancy[]; status: GroundingStatus; citations: Array<{ title: string; url?: string }>; }

export type AiComplete = (req: { provider: string; system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number; thinking?: 'low' | 'medium' | 'high' }) => Promise<{ text: string }>;
export type AiSelectProvider = (taskType: string) => { id: string };

export interface ResearchLookup { lookup(query: string, opts?: { maxWords?: number }): Promise<{ answer: string; citations: Array<{ title: string; url?: string }>; hasVerifiedSources: boolean }>; }

const PARSE_SYSTEM = `You convert a free-form romance premise document into a strict JSON seed set for a novel pipeline.
Rules:
- Preserve everything the author wrote; never invent plot the premise does not imply.
- Map sections: logline/theme -> storyArc; characters -> characters; setting -> setting (verbatim place notes); structure/POV/ending -> blueprint.
- Infer heat ('sweet' | 'spicy'), chapterCount, wordsPerChapter as suggestions.
- gaps[]: one per open choice the file flags PLUS implicit missing pieces needed to draft. Each has a proposedAnswer and a targetField (storyArc|characters|setting|blueprint|heat|chapterCount|wordsPerChapter).
- realPlace: is the setting a real, mappable location? If so give its canonicalName.
Output ONE JSON object and nothing else, matching:
{"seeds":{"storyArc","characters","setting","blueprint","heat","chapterCount","wordsPerChapter"},"gaps":[{"id","question","proposedAnswer","alternatives"?,"targetField"}],"realPlace":{"isReal","canonicalName"?}}`;

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(raw); } catch { throw new Error('PREMISE_INTAKE_PARSE_FAILED'); }
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class PremiseIntakeService {
  constructor(private aiComplete: AiComplete, private aiSelectProvider: AiSelectProvider, private researchLookup?: ResearchLookup) {}

  async parse(premiseText: string): Promise<IntakeResult> {
    const provider = this.aiSelectProvider('book_bible').id;
    const { text } = await this.aiComplete({ provider, system: PARSE_SYSTEM, messages: [{ role: 'user', content: premiseText }], maxTokens: 8000, thinking: 'medium' });
    const j = extractJson(text);
    const s = j?.seeds ?? {};
    const seeds: IntakeSeeds = {
      storyArc: str(s.storyArc), characters: str(s.characters), setting: str(s.setting), blueprint: str(s.blueprint),
      heat: s.heat === 'spicy' ? 'spicy' : 'sweet', chapterCount: num(s.chapterCount, 40), wordsPerChapter: num(s.wordsPerChapter, 2500),
    };
    const gaps: IntakeGap[] = Array.isArray(j?.gaps) ? j.gaps.filter((g: any) => g && typeof g.id === 'string').map((g: any) => ({
      id: str(g.id), question: str(g.question), proposedAnswer: str(g.proposedAnswer),
      ...(Array.isArray(g.alternatives) ? { alternatives: g.alternatives.map(str) } : {}),
      targetField: (['storyArc','characters','setting','blueprint','heat','chapterCount','wordsPerChapter'].includes(g.targetField) ? g.targetField : 'blueprint') as SeedField,
    })) : [];
    const realPlace: RealPlace = j?.realPlace?.isReal ? { isReal: true, canonicalName: str(j.realPlace.canonicalName) || undefined } : { isReal: false };
    return { seeds, gaps, realPlace };
  }

  async ground(setting: string, realPlace: RealPlace, premiseText: string): Promise<GroundingResult> {
    if (!realPlace.isReal) return { dossier: setting, discrepancies: [], status: 'skipped', citations: [] };

    let researchText = ''; let citations: Array<{ title: string; url?: string }> = []; let status: GroundingStatus = 'fallback-llm';
    if (this.researchLookup) {
      try {
        const r = await this.researchLookup.lookup(`Real geography of ${realPlace.canonicalName}: towns, main roads, orientation to water, notable public landmarks, seasonal economy.`, { maxWords: 500 });
        researchText = r.answer; citations = r.citations ?? []; status = r.hasVerifiedSources ? 'grounded' : 'fallback-llm';
      } catch { status = 'fallback-llm'; }
    }

    const system = `You build a factual SETTING DOSSIER for a novelist and audit the premise's real-world claims.
Given RESEARCH (may be empty) and the PREMISE, output ONE JSON object:
{"dossier": "<markdown place bible: real towns, roads, geography, seasonal texture; place FICTIONAL businesses on real streets; never assert a real private business as a story location>",
 "discrepancies": [{"id","premiseClaim","finding","status":"pass|fail","suggestion"?,"targetField":"setting|blueprint|characters"}]}
Audit ONLY real-world facts the PREMISE asserts (street names, town placement, geography). Record verified facts as status "pass" and errors as status "fail" with a suggestion. A fictional business is NOT a discrepancy; a wrong real street/town IS. Never rewrite the premise.`;
    const provider = this.aiSelectProvider('book_bible').id;
    const { text } = await this.aiComplete({ provider, system, messages: [{ role: 'user', content: `RESEARCH:\n${researchText || '(none available)'}\n\nPREMISE:\n${premiseText}` }], maxTokens: 8000, thinking: 'medium' });

    let j: any; try { j = extractJson(text); } catch { j = { dossier: researchText || setting, discrepancies: [] }; }
    const discrepancies: Discrepancy[] = Array.isArray(j?.discrepancies) ? j.discrepancies.filter((d: any) => d && typeof d.id === 'string').map((d: any) => ({
      id: str(d.id), premiseClaim: str(d.premiseClaim), finding: str(d.finding), status: d.status === 'fail' ? 'fail' : 'pass',
      ...(d.suggestion ? { suggestion: str(d.suggestion) } : {}),
      targetField: (['setting','blueprint','characters'].includes(d.targetField) ? d.targetField : 'setting') as Discrepancy['targetField'],
    })) : [];
    return { dossier: str(j?.dossier) || researchText || setting, discrepancies, status, citations };
  }
}
