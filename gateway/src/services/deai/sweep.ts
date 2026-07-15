/**
 * Chunked two-pass de-AI sweep orchestrator.
 *
 * Encapsulates the whole per-chapter humanization: banned-terms replace →
 * de-AI pass 1 (chunked, broad) → apply → de-AI pass 2 (chunked, second-reader)
 * → apply. Capped at 2 passes; a pass whose merged edit list is empty
 * short-circuits (no apply, no wasted call). The `audit`/`apply` callables are
 * injected so this is fully unit-testable with fakes and imports no router.
 */

import { chunkChapter } from './chunk-chapter.js';
import { mergeWindowEdits } from './merge-edits.js';
import { applyBannedTerms, forbiddenWordsInNarration, forbiddenWordsBlock, type BannedTerms } from './banned-terms.js';
import type { DeAiEdit, ApplyResult } from '../deterministic-apply.js';

export interface PassModel { provider: string; model: string; }

const DEFAULT_PASS: Record<1 | 2, PassModel> = {
  1: { provider: 'gemini', model: 'auto:newest-gemini' },
  2: { provider: 'openrouter', model: 'auto:newest-haiku' },
};

/**
 * Resolve the model for a de-AI pass. Both audits share taskType 'revision', so
 * stepRouting cannot distinguish them — the sweep resolves by EXPLICIT stage key
 * (`deai_pass1` / `deai_pass2`), bypassing stepRouting. A slot with a truthy
 * provider overrides the default; otherwise the pass default is used.
 */
export function resolveDeaiPassModel(
  stageModels: Record<string, { provider?: string; model?: string }> | undefined,
  pass: 1 | 2,
): PassModel {
  const pin = stageModels?.[`deai_pass${pass}`];
  const def = DEFAULT_PASS[pass];
  if (pin?.provider) return { provider: pin.provider, model: pin.model || def.model };
  return def;
}

/** Pass-2 attention-redirect preamble — the "completeness critic" framing that
 *  hunts the subtler residue surviving a first edit rather than re-surfacing the
 *  same top-N. */
export function secondReaderFraming(): string {
  return 'SECOND-READER PASS: the obvious AI tells are already gone. Hunt only the '
    + 'subtler residue that survives a first edit — sententious "button" one-liners, '
    + 'echo rhythms between adjacent sentences, generalizing second-person asides, and '
    + 'quiet rule-of-three balance. Emit an edit ONLY for genuine residue; if the '
    + 'window is clean, return [].';
}

export interface SweepDeps {
  auditWindow: (args: { windowText: string; seam: string; pass: 1 | 2; forbiddenBlock: string }) => Promise<DeAiEdit[]>;
  applyEdits: (base: string, edits: DeAiEdit[]) => Promise<ApplyResult>;
}
export interface SweepResult { text: string; passes: number; bannedCounts: Record<string, number>; passStats: ApplyResult[]; }

async function auditAllWindows(
  working: string, pass: 1 | 2, forbiddenBlock: string, deps: SweepDeps, targetWords: number,
): Promise<DeAiEdit[]> {
  const windows = chunkChapter(working, targetWords);
  const lists: DeAiEdit[][] = [];
  for (const w of windows) {
    try { lists.push(await deps.auditWindow({ windowText: w.text, seam: w.seam, pass, forbiddenBlock })); }
    catch (e) { console.log(`  ⚠ deai pass ${pass} window audit failed — skipped: ${(e as Error).message}`); lists.push([]); }
  }
  return mergeWindowEdits(lists);
}

export async function runChunkedDeAiSweep(args: {
  draft: string; banned: BannedTerms;
  stageModels?: Record<string, { provider?: string; model?: string }>;
  deps: SweepDeps; targetWords?: number;
}): Promise<SweepResult> {
  const targetWords = args.targetWords ?? 1000;
  const passStats: ApplyResult[] = [];

  // Stage 0: deterministic banned-terms replace (narration only).
  const banned = applyBannedTerms(args.draft, args.banned.fixed);
  let working = banned.text;
  const forbiddenBlock = forbiddenWordsBlock(forbiddenWordsInNarration(working, args.banned.banOnly));

  // Pass 1 — broad sweep, chunked.
  const merged1 = await auditAllWindows(working, 1, forbiddenBlock, args.deps, targetWords);
  if (merged1.length === 0) return { text: working, passes: 1, bannedCounts: banned.counts, passStats };
  const r1 = await args.deps.applyEdits(working, merged1);
  passStats.push(r1); working = r1.text;

  // Pass 2 — second reader, re-window the applied text.
  const merged2 = await auditAllWindows(working, 2, forbiddenBlock, args.deps, targetWords);
  if (merged2.length === 0) return { text: working, passes: 2, bannedCounts: banned.counts, passStats };
  const r2 = await args.deps.applyEdits(working, merged2);
  passStats.push(r2); working = r2.text;

  return { text: working, passes: 2, bannedCounts: banned.counts, passStats };
}
