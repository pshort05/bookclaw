/**
 * Shared ContextEngine hook (rolling summary + entity/fact extraction) for a
 * just-completed canonical chapter or bible step.
 *
 * Both drive loops (the bridge/heartbeat loop in index.ts and the dashboard
 * /auto-execute loop in projects.routes.ts) run this INLINE right after their
 * own `completeStep()` call. The Human-Review cadence-gate resume path (Plan 5
 * code-review fix, H1) needs the identical behavior for a chapter that was
 * gated then approved/edited: `ProjectEngine.applyReviewResume` completes the
 * step OUTSIDE those loops, so without this, a gated chapter's summary/entities
 * were silently never recorded. Called from the two `applyReviewResume` call
 * sites (services/human-review.ts `resolveReviewGates` and the
 * `/api/projects/:id/review/action` route) on approve/edit only — regenerate
 * and stop don't complete the step, so there's nothing to extract yet.
 *
 * Uses the same `skill === 'write' || phase === 'polish'` canonical-chapter
 * signal as projects.routes.ts's inline hook (bug-review finding #17 — the
 * precise signal, not the looser label-matching one index.ts's bridge loop
 * still uses for its own inline call).
 */
import { chapterSummaryTarget } from './chapter-summary.js';

export interface ContextExtractionEngine {
  generateSummary(
    projectId: string, stepId: string, stepLabel: string, chapterNumber: number, fullText: string,
    aiComplete: (req: any) => Promise<any>, aiSelectProvider: (taskType: string) => any,
  ): Promise<unknown>;
  extractEntities(
    projectId: string, stepId: string, fullText: string,
    aiComplete: (req: any) => Promise<any>, aiSelectProvider: (taskType: string) => any,
  ): Promise<unknown>;
}

export interface ContextExtractionDeps {
  contextEngine?: ContextExtractionEngine | null;
  aiComplete: (req: any) => Promise<any>;
  aiSelectProvider: (taskType: string) => any;
}

/** A canonical first-draft or polished chapter, or a book-bible step. */
export function isCanonicalOrBibleStep(
  step: { skill?: string; phase?: string; label?: string },
  projectType?: string,
): boolean {
  const stepLabel = (step.label || '').toLowerCase();
  const stepSkill = step.skill || '';
  const stepPhase = step.phase || '';
  const isCanonicalChapter = stepSkill === 'write' || stepPhase === 'polish';
  const isBibleStep = projectType === 'book-bible' ||
    stepLabel.includes('bible') ||
    stepLabel.includes('world') ||
    (stepLabel.includes('character') && stepSkill !== 'revise');
  return isCanonicalChapter || isBibleStep;
}

/**
 * Fire the summary + entity-extraction calls for a completed step's text.
 * No-op (fail-soft) when there's no ContextEngine, the text is too short, or
 * the step isn't a canonical chapter/bible step. Awaits both calls but never
 * throws — matches the inline hooks' `.catch(...)` behavior.
 */
export async function runChapterContextExtraction(
  deps: ContextExtractionDeps,
  project: { id: string; type?: string; steps: Array<{ status: string; id: string }> },
  step: { id: string; label: string; chapterNumber?: number; skill?: string; phase?: string },
  text: string,
): Promise<void> {
  if (!deps.contextEngine || !text || text.length <= 200) return;
  if (!isCanonicalOrBibleStep(step, project.type)) return;

  const isCanonicalChapter = step.skill === 'write' || step.phase === 'polish';
  const { chapterNum, summaryId } = chapterSummaryTarget(project, step, isCanonicalChapter);

  await Promise.allSettled([
    deps.contextEngine.generateSummary(
      project.id, summaryId, step.label, chapterNum, text, deps.aiComplete, deps.aiSelectProvider,
    ).catch((err: any) => console.error('[context-engine] Summary error:', err?.message ?? err)),
    deps.contextEngine.extractEntities(
      project.id, step.id, text, deps.aiComplete, deps.aiSelectProvider,
    ).catch((err: any) => console.error('[context-engine] Entity extraction error:', err?.message ?? err)),
  ]);
}
