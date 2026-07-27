/**
 * Romance engagement checks (C2 / pacing review). Two library prompts —
 * `romance-arc-checker` (whole-book, run on the outline at the outline gate) and
 * `romance-chapter-checker` (single chapter, run cheaply on every chapter) — are
 * loaded from the prompt library and run through the AI router. Their output is
 * attached to the human-review Confirmations gate (services/human-review.ts) so a
 * person signs off; the chapter checker additionally FORCE-OPENS a gate when it
 * rates a chapter a Stall, regardless of the book's cadence.
 *
 * All AI access is injected (RomanceCheckDeps) so the logic is testable with fakes
 * and fail-soft: a missing prompt or a provider error yields null and the gate
 * opens without the annotation.
 */

export interface RomanceCheckDeps {
  /** aiRouter.complete adapter. */
  complete: (req: {
    provider: string; model?: string; system: string;
    messages: Array<{ role: 'user'; content: string }>; maxTokens?: number;
  }) => Promise<{ text: string }>;
  /** aiRouter.selectProvider adapter. */
  selectProvider: (taskType: string, preferredId?: string) => { id: string };
  /** Load a prompt entry's systemPrompt from the library (null if absent). */
  getPrompt: (name: string) => string | null;
}

export const ARC_CHECKER = 'romance-arc-checker';
export const CHAPTER_CHECKER = 'romance-chapter-checker';

/** Build the injected deps from the gateway's AI router + library (used at the
 *  cadence-gate call sites). Fail-soft: a missing prompt resolves to null. */
export function romanceCheckDepsFrom(s: {
  aiRouter: { complete: (r: any) => Promise<{ text: string }>; selectProvider: (t: string, p?: string) => { id: string } };
  library: { get: (kind: any, name: string) => any };
}): RomanceCheckDeps {
  return {
    complete: (r) => s.aiRouter.complete(r),
    selectProvider: (t, p) => s.aiRouter.selectProvider(t, p),
    getPrompt: (name) => s.library.get('prompt', name)?.prompt?.systemPrompt ?? null,
  };
}

export type ChapterVerdict = 'strong' | 'adequate' | 'stall' | 'unknown';

/**
 * Parse the chapter checker's `RATING:` line (Strong / Adequate / Stall). A
 * `BEAT: missing` with no rating is treated as a stall; anything unparseable is
 * 'unknown' (which never force-gates).
 */
export function parseChapterVerdict(text: string): ChapterVerdict {
  const m = (text || '').match(/RATING:\s*(Strong|Adequate|Stall)/i);
  if (m) return m[1].toLowerCase() as ChapterVerdict;
  if (/BEAT:\s*missing/i.test(text || '')) return 'stall';
  return 'unknown';
}

// Cheap route: prefer OpenRouter+Haiku (matches the premise-intake convention);
// fall back to whatever the tier routes to when OpenRouter isn't configured.
function cheapRoute(deps: RomanceCheckDeps, taskType: string): { provider: string; model?: string } {
  const p = deps.selectProvider(taskType, 'openrouter');
  return p.id === 'openrouter' ? { provider: p.id, model: 'auto:newest-haiku' } : { provider: p.id };
}

/** Run the whole-book arc checker on an outline (or manuscript). Returns its
 *  critique text, or null on missing prompt / empty input / provider error. */
export async function runRomanceArcCheck(deps: RomanceCheckDeps, outlineText: string): Promise<string | null> {
  const system = deps.getPrompt(ARC_CHECKER);
  if (!system || !outlineText?.trim()) return null;
  try {
    const route = { provider: deps.selectProvider('revision').id }; // a deeper, once-per-book read
    const r = await deps.complete({ ...route, system, messages: [{ role: 'user', content: outlineText }], maxTokens: 4000 });
    return r.text?.trim() || null;
  } catch { return null; }
}

export interface ChapterCheckResult { text: string; verdict: ChapterVerdict; stall: boolean; }

/** Run the single-chapter checker (cheap model). `beat` is the intended
 *  structural beat for the chapter, if known, so it can judge BEAT FIT. */
export async function runRomanceChapterCheck(
  deps: RomanceCheckDeps, chapterText: string, beat?: string,
): Promise<ChapterCheckResult | null> {
  const system = deps.getPrompt(CHAPTER_CHECKER);
  if (!system || !chapterText?.trim()) return null;
  try {
    const route = cheapRoute(deps, 'revision');
    const user = beat ? `INTENDED BEAT: ${beat}\n\nCHAPTER:\n${chapterText}` : `CHAPTER:\n${chapterText}`;
    const r = await deps.complete({ ...route, system, messages: [{ role: 'user', content: user }], maxTokens: 600 });
    const text = r.text?.trim() || '';
    if (!text) return null;
    const verdict = parseChapterVerdict(text);
    return { text, verdict, stall: verdict === 'stall' };
  } catch { return null; }
}
