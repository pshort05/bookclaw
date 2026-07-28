/**
 * Deterministic de-AI apply (drift-proof line editing).
 *
 * The de-AI polish is split into two steps so the chapter is NEVER regenerated
 * by an LLM (which is what caused every drift — wedding, ch5-swap, Gavin/Maine):
 *
 *   1. De-AI Audit (LLM): reads the draft and emits an EDIT LIST only — each edit
 *      quotes an exact verbatim `find` span plus either a literal `replace`
 *      (mechanical: forbidden words, Oxford commas, em/en dashes, clichés) or an
 *      `instruction` for a scoped rewrite (show-don't-tell).
 *   2. Apply (THIS module, deterministic): starts from the draft and applies each
 *      edit as a literal find-and-replace. A `swap` replaces in place; a `rewrite`
 *      replaces the span with a per-span LLM call scoped to ONLY that span. Any
 *      `find` not present verbatim is SKIPPED (never invented). The chapter is the
 *      draft with surgical substitutions — drift is structurally impossible.
 *
 * Pure and dependency-free (the per-span rewrite is an injected function) so it is
 * fully unit-testable.
 */

import { unsafeEditReason } from './deai/validate-edit.js';

export interface DeAiEdit {
  op: 'swap' | 'rewrite';
  find: string;
  replace?: string;      // op === 'swap'
  instruction?: string;  // op === 'rewrite'
  reason?: string;
}

export interface ApplyResult {
  text: string;
  appliedSwaps: number;
  appliedRewrites: number;
  skipped: number;       // edits whose `find` span wasn't found verbatim, or a guarded rewrite
  malformed: number;     // edits rejected because they INTRODUCED a seam artifact (subset of skipped)
}

/**
 * Count structural text artifacts an apply must never INTRODUCE at a splice seam:
 *   - orphaned sentence punctuation: a terminator (. ? !) abutting a following
 *     comma/semicolon/colon, or a comma abutting a period (e.g. `right., and`);
 *   - an empty / near-empty double-quote pair, i.e. a swap that deleted quoted
 *     content and left the quotes behind (e.g. `","`, `""`, `"."`).
 * Compared before/after each edit so an edit that merely inherits a pre-existing
 * oddity is never penalized — only a NET increase blocks the edit. Straight and
 * curly double quotes both count; single quotes/apostrophes are ignored.
 *
 * Intra-artifact whitespace is spaces/tabs only ([ \t]), NOT newlines: a real
 * splice artifact is same-line adjacency, whereas a closing quote / blank line /
 * opening quote across a paragraph break (`"\n\n"`, adjacent dialogue turns) is
 * legitimate prose and must not count.
 */
const SEAM_ARTIFACT_RE = /[.?!][ \t]*[,;:]|,[ \t]*\.|["“][ \t]*[,.]?[ \t]*["”]/g;
function countSeamArtifacts(s: string): number {
  const m = s.match(SEAM_ARTIFACT_RE);
  return m ? m.length : 0;
}

/**
 * Parse the audit step's output into edits. Tolerant: pulls the first JSON array
 * out of any surrounding prose/fences; returns [] on any parse failure (→ apply
 * nothing → the chapter equals the draft, which is safe).
 */
/** Extract the balanced [ ... ] array starting at `start` (which must point at a
 * '['), ignoring brackets inside JSON strings. Returns its end index (of the
 * closing ']') or -1 if unterminated. */
function scanArrayEnd(text: string, start: number): number {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') { if (--depth === 0) return i; }
  }
  return -1; // unterminated
}

/** Every complete, balanced, top-level [ ... ] array in `text`, in order. A model
 * sometimes emits more than one (e.g. a throwaway array, then "let me redo this",
 * then the real list) — we collect them all and let the caller pick the richest. */
function extractAllJsonArrays(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '[') { i++; continue; }
    const end = scanArrayEnd(text, i);
    if (end === -1) break;            // unterminated: nothing usable past here
    out.push(text.slice(i, end + 1));
    i = end + 1;                       // resume after this array (skips nested inner arrays)
  }
  return out;
}

/** Parse one balanced array string into validated edits (invalid elements dropped). */
function editsFromArray(jsonStr: string): DeAiEdit[] {
  let arr: unknown;
  try { arr = JSON.parse(jsonStr); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const out: DeAiEdit[] = [];
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const find = typeof (e as any).find === 'string' ? (e as any).find : '';
    if (!find) continue;
    const op = (e as any).op;
    if (op === 'rewrite' && typeof (e as any).instruction === 'string' && (e as any).instruction.trim()) {
      out.push({ op: 'rewrite', find, instruction: (e as any).instruction, reason: (e as any).reason });
    } else if (typeof (e as any).replace === 'string') {
      out.push({ op: 'swap', find, replace: (e as any).replace, reason: (e as any).reason });
    }
  }
  return out;
}

export function parseAuditEdits(raw: string | undefined | null): DeAiEdit[] {
  const text = String(raw ?? '');
  if (!text.trim()) return [];
  // Pick the array that yields the MOST valid edits. This makes the parser robust
  // to a model that emits a throwaway array before self-correcting to the real
  // list (observed in practice), and to trailing prose brackets (which yield 0
  // valid edits). Ties resolve to the LATER array — a self-correcting model's
  // final list is authoritative.
  let best: DeAiEdit[] = [];
  for (const jsonStr of extractAllJsonArrays(text)) {
    const edits = editsFromArray(jsonStr);
    if (edits.length >= best.length) best = edits;
  }
  return best;
}

/**
 * Apply edits to `base` deterministically. `find` is matched as a literal
 * substring (first occurrence, recomputed after each edit so indices stay valid).
 * A missing span is skipped, never invented. A scoped rewrite that comes back
 * empty or more than ~3x the original span (a sign the model over-generated) is
 * also skipped — the original span stays. The chapter is never regenerated.
 */
export async function applyDeAiEdits(
  base: string,
  edits: DeAiEdit[],
  rewriteFn?: (span: string, instruction: string) => Promise<string>,
  opts?: { guardEntities?: boolean },
): Promise<ApplyResult> {
  let text = String(base ?? '');
  let appliedSwaps = 0, appliedRewrites = 0, skipped = 0, malformed = 0;
  let baseArtifacts = countSeamArtifacts(text);
  for (const e of edits) {
    if (!e.find) { skipped++; continue; }
    const idx = text.indexOf(e.find);
    if (idx === -1) { skipped++; continue; }
    if (e.op === 'swap') {
      const replace = e.replace ?? '';
      // Guard swaps too (not just rewrites): a replacement that balloons past
      // ~3x + 200 chars is a hallucinated injection (a whole scene), not a phrase
      // swap — skip it. Without this, one bad audit edit could drift the chapter.
      if (replace.length > e.find.length * 3 + 200) { skipped++; continue; }
      // C8 de-AI entity guard: a de-AI swap must not inject a name/number, flip
      // person, or duplicate a word — keep the original span if it would.
      if (opts?.guardEntities && unsafeEditReason(e.find, replace)) { skipped++; malformed++; continue; }
      const candidate = text.slice(0, idx) + replace + text.slice(idx + e.find.length);
      // Seam guard: reject a swap that INTRODUCES orphaned punctuation or an empty
      // quote (e.g. `replace:""` deleting quoted dialogue → `","`). Fail closed to
      // the pre-edit span rather than ship malformed prose.
      const candArtifacts = countSeamArtifacts(candidate);
      if (candArtifacts > baseArtifacts) { skipped++; malformed++; continue; }
      text = candidate; baseArtifacts = candArtifacts;
      appliedSwaps++;
      continue;
    }
    // op === 'rewrite': scoped per-span LLM call.
    if (!rewriteFn) { skipped++; continue; }
    let revised = '';
    try { revised = String(await rewriteFn(e.find, e.instruction ?? '')).trim(); } catch { revised = ''; }
    // Guard the scoped rewrite: empty, or ballooned past ~3x + 200 chars, is
    // treated as a bad/over-generated result — keep the original span.
    if (!revised || revised.length > e.find.length * 3 + 200) { skipped++; continue; }
    if (opts?.guardEntities && unsafeEditReason(e.find, revised)) { skipped++; malformed++; continue; }
    const candidate = text.slice(0, idx) + revised + text.slice(idx + e.find.length);
    // Same seam guard for scoped rewrites.
    const candArtifacts = countSeamArtifacts(candidate);
    if (candArtifacts > baseArtifacts) { skipped++; malformed++; continue; }
    text = candidate; baseArtifacts = candArtifacts;
    appliedRewrites++;
  }
  return { text, appliedSwaps, appliedRewrites, skipped, malformed };
}

/**
 * Build the per-span rewrite function for the Apply step: a scoped LLM call that
 * revises ONLY the given span. Cheap model (newest Haiku), tight budget, low temp;
 * the applier guards against an over-generated result, so this can never drift the
 * chapter. `aiComplete` is injected (the gateway's aiRouter.complete) to keep this
 * module free of router imports.
 */
export function makeScopedRewriteFn(
  aiComplete: (req: any) => Promise<{ text?: string }>,
): (span: string, instruction: string) => Promise<string> {
  return async (span: string, instruction: string) => {
    const res = await aiComplete({
      provider: 'openrouter',
      model: 'auto:newest-haiku',
      system: 'You are a line editor. Rewrite ONLY the given span to satisfy the instruction. Keep the same meaning, tense, POV, and roughly the same length. Do NOT add new information, characters, or events, and do NOT write beyond the span. Output ONLY the revised span text — no quotes, no labels, no commentary.',
      messages: [{ role: 'user', content: `Instruction: ${instruction}\n\nSpan:\n${span}` }],
      maxTokens: 400,
      temperature: 0.3,
    });
    return res?.text ?? '';
  };
}

/** Minimal step shape the runner reads (ProjectStep is structurally assignable). */
export interface ApplyRunnerStep {
  chapterNumber?: number;
  role?: string;
  skill?: string;
  status: string;
  result?: string;
}

/**
 * The working chapter prose for a chapter: a completed Rewrite (role `rewrite`)
 * if the pipeline ran one, else the First Draft (role `draft`). A pipeline can
 * insert a free-form rewrite pass after the draft; without this the downstream
 * deterministic apply + de-AI chain would silently operate on the superseded
 * first draft and discard the rewrite. Backward compatible: no rewrite → draft.
 */
export function resolveChapterDraftStep<T extends { chapterNumber?: number; role?: string; status: string; result?: string }>(
  steps: T[],
  n: number | undefined,
): T | undefined {
  const done = (s: T) => s.status === 'completed' && !!s.result;
  return steps.find(s => s.chapterNumber === n && s.role === 'rewrite' && done(s))
      ?? steps.find(s => s.chapterNumber === n && s.role === 'draft' && done(s));
}

/**
 * Resolve the base draft + audit edits for an Apply step and run the deterministic
 * apply. Base = this chapter's working prose (Rewrite if present, else Draft).
 * Edits = gathered from EVERY completed audit step of this chapter (any skill
 * ending in `-audit`: consistency, de-AI, …)
 * — the "N audits → 1 apply" model. Consistency audits are applied first (fix
 * facts on the original draft), then the rest (prose polish); an edit whose `find`
 * a prior audit already changed is simply skipped. Throws if the draft is missing,
 * so the caller fails the step rather than emitting an empty chapter.
 */
export async function runDeterministicApply(
  steps: ApplyRunnerStep[],
  step: ApplyRunnerStep,
  rewriteFn: (span: string, instruction: string) => Promise<string>,
): Promise<{ text: string; stats: ApplyResult & { auditSteps: number } }> {
  const N = step.chapterNumber;
  const done = (s: ApplyRunnerStep) => s.status === 'completed' && !!s.result;
  const draft = resolveChapterDraftStep(steps, N);
  if (!draft?.result) throw new Error(`deterministic-apply: no completed draft for chapter ${N}`);
  const audits = steps
    .filter(s => s.chapterNumber === N && done(s) && /audit$/i.test(s.skill ?? ''))
    // consistency (facts) before de-AI (prose); stable otherwise.
    .sort((a, b) => (/consistency/i.test(a.skill ?? '') ? 0 : 1) - (/consistency/i.test(b.skill ?? '') ? 0 : 1));
  const edits: DeAiEdit[] = [];
  for (const a of audits) edits.push(...parseAuditEdits(a.result));
  const stats = await applyDeAiEdits(draft.result, edits, rewriteFn);
  return { text: stats.text, stats: { ...stats, auditSteps: audits.length } };
}
