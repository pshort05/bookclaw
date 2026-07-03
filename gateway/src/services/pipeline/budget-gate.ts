/**
 * Graceful cost-boundary pause (Flagship Plan 6, Task 3). Mirrors the
 * Human Review gate pattern (services/human-review.ts isHumanReviewStep):
 * a small pure check called at a chapter/step boundary — AFTER the previous
 * step has already completed and its real cost recorded, BEFORE the next one
 * starts — so a cap trip never interrupts a chapter already being generated,
 * only the next one from starting. Reuses the existing CostTracker as the
 * single source of spend truth; no second cost store.
 */
import type { CostTracker } from '../costs.js';

export interface BudgetPauseResult {
  reason: string;
  scope: 'book' | 'global';
}

/**
 * Returns a pause reason when either this project's bound book has its own
 * budget (CostTracker.setBookBudget) and has reached it, or the global
 * daily/monthly cap has been reached — otherwise null (safe to continue).
 */
export function checkBudgetPause(
  costs: CostTracker,
  project: { bookSlug?: string | null },
): BudgetPauseResult | null {
  if (project.bookSlug && costs.wouldExceedBook(project.bookSlug, 0)) {
    return { reason: `Book budget reached for "${project.bookSlug}".`, scope: 'book' };
  }
  if (costs.isOverBudget()) {
    return { reason: 'Global daily/monthly cost cap reached.', scope: 'global' };
  }
  return null;
}

/** Park a project at a budget boundary — mirrors human-review's parkForReview shape. */
export function applyBudgetPause(project: any, result: BudgetPauseResult): void {
  project.status = 'paused';
  project.budgetPause = { reason: result.reason, scope: result.scope, at: new Date().toISOString() };
}
