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
import { applyAiNames, type AiNameMap } from './ai-names.js';
import type { DeAiEdit, ApplyResult } from '../deterministic-apply.js';

export interface PassModel { provider: string; model: string; }

const DEFAULT_PASS: Record<1 | 2, PassModel> = {
  1: { provider: 'openrouter', model: 'google/gemini-2.5-flash' },
  2: { provider: 'openrouter', model: 'auto:newest-haiku' },
};

/** Family-preserving OpenRouter slug for a native provider whose direct API is
 *  unavailable (used by the preflight fallback). Unknown providers keep the
 *  requested model string. */
const OPENROUTER_FAMILY_SLUG: Record<string, string> = {
  gemini: 'google/gemini-2.5-flash',
  claude: 'auto:newest-haiku',
  openai: 'openai/gpt-4o-mini',
};

/**
 * Preflight-resolve a pass model against the router's available provider ids.
 * - Provider available → keep as-is (fellBack: false).
 * - Provider unavailable, OpenRouter available → route the same family through
 *   OpenRouter (keeps the "detector family" intent), fellBack: true.
 * - Provider unavailable, no OpenRouter → first available provider with an empty
 *   model (router picks its default), fellBack: true.
 * - Nothing available at all → null (caller fails loudly once and skips the sweep).
 */
export function resolveAvailablePassModel(
  requested: PassModel, available: string[],
): { provider: string; model: string; fellBack: boolean } | null {
  if (!available.length) return null;
  if (available.includes(requested.provider)) {
    return { provider: requested.provider, model: requested.model, fellBack: false };
  }
  if (available.includes('openrouter')) {
    return { provider: 'openrouter', model: OPENROUTER_FAMILY_SLUG[requested.provider] ?? requested.model, fellBack: true };
  }
  return { provider: available[0], model: '', fellBack: true };
}

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
  auditWindow: (args: { windowText: string; seam: string; pass: 1 | 2; forbiddenBlock: string; provider: string; model: string }) => Promise<DeAiEdit[]>;
  applyEdits: (base: string, edits: DeAiEdit[]) => Promise<ApplyResult>;
}
export interface SweepResult { text: string; passes: number; bannedCounts: Record<string, number>; aiNameCounts: Record<string, number>; passStats: ApplyResult[]; }

async function auditAllWindows(
  working: string, pass: 1 | 2, forbiddenBlock: string, deps: SweepDeps, targetWords: number,
  provider: string, model: string,
): Promise<{ edits: DeAiEdit[]; errored: boolean }> {
  const windows = chunkChapter(working, targetWords);
  const lists: DeAiEdit[][] = [];
  let errored = false;
  for (const w of windows) {
    try { lists.push(await deps.auditWindow({ windowText: w.text, seam: w.seam, pass, forbiddenBlock, provider, model })); }
    catch (e) { errored = true; console.log(`  ⚠ deai pass ${pass} window audit failed — skipped: ${(e as Error).message}`); lists.push([]); }
  }
  return { edits: mergeWindowEdits(lists), errored };
}

export async function runChunkedDeAiSweep(args: {
  draft: string; banned: BannedTerms; aiNames?: AiNameMap;
  availableProviders: string[];
  stageModels?: Record<string, { provider?: string; model?: string }>;
  deps: SweepDeps; targetWords?: number;
}): Promise<SweepResult> {
  const targetWords = args.targetWords ?? 1000;
  const passStats: ApplyResult[] = [];

  // Stage 0: deterministic banned-terms (narration only) then AI-names (global).
  const banned = applyBannedTerms(args.draft, args.banned.fixed);
  const names = applyAiNames(banned.text, args.aiNames ?? []);
  let working = names.text;
  const forbiddenBlock = forbiddenWordsBlock(forbiddenWordsInNarration(working, args.banned.banOnly));

  // Preflight: resolve both pass models against the router's available providers.
  const req1 = resolveDeaiPassModel(args.stageModels, 1);
  const req2 = resolveDeaiPassModel(args.stageModels, 2);
  const m1 = resolveAvailablePassModel(req1, args.availableProviders);
  const m2 = resolveAvailablePassModel(req2, args.availableProviders);
  if (!m1 || !m2) {
    console.log('  ⚠ de-AI sweep skipped: no AI provider is available — ran banned-terms + AI-name stages only.');
    return { text: working, passes: 0, bannedCounts: banned.counts, aiNameCounts: names.counts, passStats };
  }
  if (m1.fellBack) console.log(`  ⚠ de-AI pass 1 provider "${req1.provider}" unavailable — routed to ${m1.provider}/${m1.model}`);
  if (m2.fellBack) console.log(`  ⚠ de-AI pass 2 provider "${req2.provider}" unavailable — routed to ${m2.provider}/${m2.model}`);

  // Pass 1 — broad sweep, chunked.
  const p1 = await auditAllWindows(working, 1, forbiddenBlock, args.deps, targetWords, m1.provider, m1.model);
  // Short-circuit ONLY when pass 1 completed with no errors AND found nothing.
  // A pass 1 that errored (empty due to failure) must NOT be mistaken for "clean".
  if (p1.edits.length === 0 && !p1.errored) {
    return { text: working, passes: 1, bannedCounts: banned.counts, aiNameCounts: names.counts, passStats };
  }
  if (p1.edits.length > 0) {
    const r1 = await args.deps.applyEdits(working, p1.edits);
    passStats.push(r1); working = r1.text;
  }

  // Pass 2 — second reader, re-window the applied text. Capped at 2 passes.
  const p2 = await auditAllWindows(working, 2, forbiddenBlock, args.deps, targetWords, m2.provider, m2.model);
  if (p2.edits.length > 0) {
    const r2 = await args.deps.applyEdits(working, p2.edits);
    passStats.push(r2); working = r2.text;
  }

  return { text: working, passes: 2, bannedCounts: banned.counts, aiNameCounts: names.counts, passStats };
}
