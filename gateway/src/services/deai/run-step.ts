/**
 * Wiring glue between a pipeline `romance-deai-audit` step and the pure
 * runChunkedDeAiSweep orchestrator. Shared by the studio, auto-execute, and
 * headless dispatch sites so the router/banned-terms plumbing lives in one
 * place. Depends on the router only through an injected `aiComplete`.
 */

import { runChunkedDeAiSweep, secondReaderFraming, type SweepResult } from './sweep.js';
import type { BannedTerms } from './banned-terms.js';
import type { AiNameMap } from './ai-names.js';
import { applyDeAiEdits, parseAuditEdits, makeScopedRewriteFn, type DeAiEdit } from '../deterministic-apply.js';
import { limitEmDashes } from './em-dash.js';

// Human authors use one or two em-dashes per chapter; LLMs use one per paragraph.
// Cap the mid-sentence em-dashes at this budget (dialogue interruptions exempt).
const EM_DASH_BUDGET = 3;

interface StepLike { skill?: string; role?: string; chapterNumber?: number; status: string; result?: string }

// C8: phrase-level constraints appended to every de-AI audit window so the model
// stops emitting the edits the applier now rejects (name/POV/number/duplication).
const DEAI_EDIT_CONSTRAINTS = '\n\nHARD CONSTRAINTS — an edit that breaks these is rejected by the applier and wasted: each `replace` MUST preserve every proper noun, character name, number, and quoted line exactly as in the `find`; keep the same grammatical person and POV (never turn "I" into a name or "she", or vice versa); add no new character, object, place, plot, or imagery; introduce no repeated word. Rephrase only — say the same thing more plainly, usually shorter.';

/**
 * The chapter text the de-AI sweep operates on: prefer the completed
 * consistency-apply (`deterministic-apply`) output for this chapter — so the
 * sweep humanizes the consistency-corrected text and its result is the final
 * chapter — else fall back to the raw `draft` step.
 */
export function resolveSweepBaseDraft(steps: StepLike[], chapterNumber?: number): string | null {
  const done = (s: StepLike) => s.status === 'completed' && !!s.result;
  const apply = steps.find(s => s.chapterNumber === chapterNumber && s.skill === 'deterministic-apply' && done(s));
  if (apply?.result) return apply.result;
  const draft = steps.find(s => s.chapterNumber === chapterNumber && s.role === 'draft' && done(s));
  return draft?.result ?? null;
}

export async function runDeaiSweepStep(args: {
  steps: StepLike[];
  chapterNumber?: number;
  skillContent: string;
  stageModels?: Record<string, { provider?: string; model?: string }>;
  banned: BannedTerms;
  aiNames?: AiNameMap;
  availableProviders: string[];
  aiComplete: (req: any) => Promise<{ text?: string }>;
  targetWords?: number;
}): Promise<SweepResult> {
  const draft = resolveSweepBaseDraft(args.steps, args.chapterNumber);
  if (draft == null) throw new Error(`romance-deai-audit: no completed draft for chapter ${args.chapterNumber}`);

  const rewriteFn = makeScopedRewriteFn(args.aiComplete);

  const auditWindow = async (w: { windowText: string; seam: string; pass: 1 | 2; forbiddenBlock: string; provider: string; model: string }): Promise<DeAiEdit[]> => {
    const system = args.skillContent
      + (w.pass === 2 ? `\n\n${secondReaderFraming()}` : '')
      + w.forbiddenBlock
      + DEAI_EDIT_CONSTRAINTS;
    const seamNote = w.seam
      ? `\n\n## Read-only preceding context (do NOT emit edits for this — it is here only so you can spot cross-seam tells):\n${w.seam}\n`
      : '';
    const res = await args.aiComplete({
      provider: w.provider,
      model: w.model,
      system,
      messages: [{ role: 'user', content: `Chapter window to audit:\n${w.windowText}${seamNote}` }],
      maxTokens: 4000,
      temperature: 0.3,
    });
    return parseAuditEdits(res?.text ?? '');
  };

  const applyEdits = (base: string, edits: DeAiEdit[]) => applyDeAiEdits(base, edits, rewriteFn, { guardEntities: true });

  const result = await runChunkedDeAiSweep({
    draft, banned: args.banned, aiNames: args.aiNames, availableProviders: args.availableProviders,
    stageModels: args.stageModels,
    deps: { auditWindow, applyEdits }, targetWords: args.targetWords,
  });

  // Em-dash frequency cap — deterministic final pass over the humanized chapter.
  const em = limitEmDashes(result.text, EM_DASH_BUDGET);
  result.text = em.text;

  // C8: per-chapter log — trim%, unsafe edits the guard rejected, em-dashes thinned.
  const trimmedPct = draft.length ? Math.round((1 - result.text.length / draft.length) * 1000) / 10 : 0;
  const rejected = result.passStats.reduce((a, s) => a + s.malformed, 0);
  console.log(`  ✓ de-AI ch${args.chapterNumber ?? '?'}: ${result.passes} pass(es), trim ${trimmedPct}%, ${rejected} unsafe edit(s) rejected, ${em.removed} em-dash(es) thinned`);
  return result;
}
