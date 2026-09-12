/**
 * The human-review gate resolution, factored out of `POST /api/projects/:id/
 * review/action` so a second caller can reuse it without duplicating the gate
 * machinery (View Book §5 rule 4: editing a gated chapter IS the gate decision).
 *
 * There is exactly one copy of: resolve the confirmation, capture the step +
 * its resumed text before `applyReviewResume` clears `project.review`, re-run
 * the chapter context extraction the drive loop would have run, and re-drive in
 * the background. Both callers get identical behaviour.
 */

import { acquireDrive, releaseDrive } from '../../services/pipeline/scheduler.js';
import { runChapterContextExtraction } from '../../util/chapter-context-extraction.js';
import type { ReviewGateAction } from '../../services/human-review.js';

export interface ReviewActions {
  /** Drive a resumed project to its next gate/error/end. Fire-and-forget. */
  driveResumedProject(projectId: string): Promise<void>;
  /** Apply one of the four gate actions to a project that has a pending review. */
  applyReviewAction(project: any, action: ReviewGateAction, opts?: { editedText?: string; note?: string }): Promise<void>;
}

export function makeReviewActions(gateway: any, services: any): ReviewActions {
  // M1 fix: an API/headless caller of /review/action has no browser polling
  // /auto-execute and no Telegram loop driving it — without this, a resumed
  // project stays 'active' with an 'active' step but nothing ever runs it
  // (worst for regenerate: reset to active, nothing re-runs at all). Mirrors
  // the phase-10 heartbeat resolver sweep's own driveProject: claims the
  // shared drive lock (never races a concurrent /auto-execute or the sweep),
  // drives to the next gate/error/end via the same startAndRunProject the
  // headless driver and Telegram bridge use, fire-and-forget so the HTTP
  // response isn't blocked by a long chapter chain. Fail-soft.
  async function driveResumedProject(projectId: string): Promise<void> {
    const engine = gateway.getProjectEngine?.();
    if (!engine) return;
    if (!(await acquireDrive(services.driveScheduler, engine, projectId))) return;
    try {
      const handlers = gateway.buildTelegramCommandHandlers?.();
      if (!handlers) return;
      for (let i = 0; i < 500; i++) {
        const p = engine.getProject(projectId);
        if (!p || p.status !== 'active' || !p.steps.some((s: any) => s.status === 'active')) break;
        const r = await handlers.startAndRunProject(projectId);
        if (r && 'error' in r) break; // next gate hit, error raised, or nothing runnable
      }
    } finally {
      releaseDrive(services.driveScheduler, engine, projectId);
    }
  }

  async function applyReviewAction(
    project: any, action: ReviewGateAction, opts: { editedText?: string; note?: string } = {},
  ): Promise<void> {
    const engine = gateway.getProjectEngine?.();
    if (!engine) throw new Error('Project engine not initialized');
    const { confirmationId, stepId, kind, pendingResult } = project.review;
    const gate = services.confirmationGate;

    if (action === 'stop') {
      if (gate && confirmationId) await gate.reject(confirmationId, 'user', opts.note).catch(() => {});
      engine.clearReview(project.id);
      return;
    }

    if (gate && confirmationId) {
      await gate.approve(confirmationId);
      await gate.recordOutcome(confirmationId, {
        success: true,
        message: `Human review: ${action}`,
        executedAt: new Date().toISOString(),
      }).catch(() => {});
    }

    // Capture the step + its canonical resumed text BEFORE applyReviewResume
    // clears project.review — H1 fix: applyReviewResume completes the step
    // OUTSIDE the route's drive loop, so the loop's own inline ContextEngine
    // hook (summary + entity extraction) never runs for a gated-then-approved/
    // edited chapter. Re-run the identical hook here.
    const stepForExtraction = project.steps.find((s: any) => s.id === stepId);
    const resumedText = action === 'edit' ? opts.editedText : (pendingResult ?? '[approved by human review]');

    engine.applyReviewResume(project.id, stepId, kind, action, {
      editedText: opts.editedText,
      note: opts.note,
    });

    if ((action === 'approve' || action === 'edit') && kind === 'cadence-gate' && stepForExtraction) {
      await runChapterContextExtraction(
        {
          contextEngine: services.contextEngine,
          aiComplete: (r: any) => services.aiRouter.complete(r),
          aiSelectProvider: (t: string) => services.aiRouter.selectProvider(t),
        },
        project, stepForExtraction, resumedText ?? '',
      );
    }

    // M1 fix: re-drive in the background — never awaited, so a long chapter
    // chain never blocks the HTTP response.
    void driveResumedProject(project.id).catch((err: any) =>
      console.error('[review-action] re-drive failed:', err?.message || err));
  }

  return { driveResumedProject, applyReviewAction };
}
