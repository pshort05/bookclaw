/**
 * Wiring glue between a pipeline `romance-deai-audit` step and the pure
 * runChunkedDeAiSweep orchestrator. Shared by the studio, auto-execute, and
 * headless dispatch sites so the router/banned-terms plumbing lives in one
 * place. Depends on the router only through an injected `aiComplete`.
 */

import { runChunkedDeAiSweep, resolveDeaiPassModel, secondReaderFraming, type SweepResult } from './sweep.js';
import type { BannedTerms } from './banned-terms.js';
import { applyDeAiEdits, parseAuditEdits, makeScopedRewriteFn, type DeAiEdit } from '../deterministic-apply.js';

interface StepLike { skill?: string; role?: string; chapterNumber?: number; status: string; result?: string }

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
  aiComplete: (req: any) => Promise<{ text?: string }>;
  targetWords?: number;
}): Promise<SweepResult> {
  const draft = resolveSweepBaseDraft(args.steps, args.chapterNumber);
  if (draft == null) throw new Error(`romance-deai-audit: no completed draft for chapter ${args.chapterNumber}`);

  const rewriteFn = makeScopedRewriteFn(args.aiComplete);

  const auditWindow = async (w: { windowText: string; seam: string; pass: 1 | 2; forbiddenBlock: string }): Promise<DeAiEdit[]> => {
    const model = resolveDeaiPassModel(args.stageModels, w.pass);
    const system = args.skillContent
      + (w.pass === 2 ? `\n\n${secondReaderFraming()}` : '')
      + w.forbiddenBlock;
    const seamNote = w.seam
      ? `\n\n## Read-only preceding context (do NOT emit edits for this — it is here only so you can spot cross-seam tells):\n${w.seam}\n`
      : '';
    const res = await args.aiComplete({
      provider: model.provider,
      model: model.model,
      system,
      messages: [{ role: 'user', content: `Chapter window to audit:\n${w.windowText}${seamNote}` }],
      maxTokens: 4000,
      temperature: 0.3,
    });
    return parseAuditEdits(res?.text ?? '');
  };

  const applyEdits = (base: string, edits: DeAiEdit[]) => applyDeAiEdits(base, edits, rewriteFn);

  return runChunkedDeAiSweep({
    draft, banned: args.banned, stageModels: args.stageModels,
    deps: { auditWindow, applyEdits }, targetWords: args.targetWords,
  });
}
