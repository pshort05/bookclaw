/**
 * Human Review pipeline gate (owner ask 2026-06-30).
 *
 * A pipeline step whose skill is `human-review` is a no-generation GATE: when a
 * driver (the dashboard auto-execute loop or the autonomous heartbeat) reaches
 * it, the pipeline pauses and a Confirmations request is raised; approval
 * advances past the gate, rejection leaves it paused. The same request is raised
 * whenever any step ERRORS (independent of the skill). ConfirmationGateService is
 * poll-based (no approval callback), so resume is a resolver that polls
 * checkDecision and applies the decision.
 */

export const HUMAN_REVIEW_SKILL = 'human-review';
export const REVIEW_SERVICE = 'human-review';

export type ReviewKind = 'pipeline-gate' | 'pipeline-error';
export type ReviewAction = 'resume' | 'retry' | 'abort' | 'wait';

interface GateLike {
  // `any` params so the concrete ConfirmationGateService (with its specific
  // CreateConfirmationInput / outcome types) is assignable here.
  createRequest(input: any): Promise<{ id: string }>;
  checkDecision(id: string): { status: string; request: unknown };
  recordOutcome(id: string, outcome: any): Promise<unknown>;
}
interface EngineLike {
  listProjects(): any[];
  getProject(id: string): any;
  parkForReview(id: string): void;
  applyReviewResume(id: string, stepId: string, kind: ReviewKind): void;
  clearReview(id: string): void;
}
interface Deps { gate: GateLike; engine: EngineLike; }

/** A step is a human-review gate iff its skill is `human-review`. */
export function isHumanReviewStep(step: { skill?: string } | null | undefined): boolean {
  return step?.skill === HUMAN_REVIEW_SKILL;
}

/** Map a confirmation status + gate kind to the action the resolver should take. */
export function reviewDecisionAction(status: string, kind: ReviewKind): ReviewAction {
  if (status === 'approved') return kind === 'pipeline-error' ? 'retry' : 'resume';
  if (status === 'pending') return 'wait';
  return 'abort'; // rejected, expired, completed, failed, unknown
}

/**
 * Raise a Confirmations request for a review gate / step error and pause the
 * project. Idempotent (no duplicate while a review is already pending) and
 * fail-soft (a gate-service failure never crashes the driver — returns null and
 * the caller proceeds with its normal pause/fail).
 */
export async function openReviewGate(
  deps: Deps, project: any, step: any, kind: ReviewKind, detail?: string,
): Promise<{ id: string } | null> {
  if (project?.review) return null; // already gated — don't duplicate
  // Claim the review slot SYNCHRONOUSLY (before the async createRequest) so a
  // concurrent driver hitting the same step doesn't raise a second confirmation.
  project.review = { confirmationId: '', stepId: step?.id, kind };
  try {
    const label = step?.label ?? step?.id;
    const description = kind === 'pipeline-error'
      ? `Step "${label}" failed — review and approve to retry, or reject to stop.`
      : `Human review — approve to continue "${project?.title ?? project?.id}" past "${label}".`;
    const req = await deps.gate.createRequest({
      service: REVIEW_SERVICE,
      action: kind,
      platform: 'BookClaw',
      riskLevel: 'medium',
      isReversible: true,
      description,
      payload: {
        projectId: project.id,
        stepId: step?.id,
        stepLabel: label,
        bookSlug: project?.bookSlug,
        kind,
        ...(detail ? { error: String(detail).slice(0, 1000) } : {}),
      },
    });
    project.review.confirmationId = req.id;
    deps.engine.parkForReview(project.id);
    return req;
  } catch (err) {
    delete project.review; // release the claim so a later attempt can retry
    console.log(`  ⚠ Human review gate could not be raised: ${(err as Error)?.message || err}`);
    return null;
  }
}

/**
 * Poll-based resume: for every project awaiting review, read the confirmation
 * decision and apply it (resume past a gate / retry a failed step / abort on
 * rejection). Idempotent and guarded per-project so one bad project never blocks
 * the rest. Called instantly from the approve/reject endpoint and periodically
 * from the heartbeat tick.
 */
export async function resolveReviewGates(deps: Deps): Promise<string[]> {
  const resumed: string[] = [];
  for (const project of deps.engine.listProjects()) {
    const review = project?.review;
    if (!review?.confirmationId) continue;
    try {
      const { status } = deps.gate.checkDecision(review.confirmationId);
      const action = reviewDecisionAction(status, review.kind);
      if (action === 'wait') continue;
      if (action === 'abort') {
        deps.engine.clearReview(project.id); // human declined / expired — stays paused
        continue;
      }
      // resume (gate) | retry (error): advance the project, then record the outcome
      // (recordOutcome requires the 'approved' state — only reached here).
      deps.engine.applyReviewResume(project.id, review.stepId, review.kind);
      resumed.push(project.id);
      await deps.gate.recordOutcome(review.confirmationId, {
        success: true,
        message: action === 'retry' ? 'Human review approved — retrying step' : 'Human review approved — continuing',
        executedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.log(`  ⚠ Human review resolve failed for ${project?.id}: ${(err as Error)?.message || err}`);
    }
  }
  return resumed;
}
