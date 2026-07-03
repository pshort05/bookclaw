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
import { resolveCadence, shouldGate, computeBoundaries, type Boundary } from './pipeline/gate-cadence.js';
import { analyzeChapter, describeFindings } from './pipeline/analyze-apply.js';
import { aggregateActContinuity, type ActChapterFlags } from './consistency/continuity-check.js';
import { runChapterContextExtraction, type ContextExtractionDeps } from '../util/chapter-context-extraction.js';

export const HUMAN_REVIEW_SKILL = 'human-review';
export const REVIEW_SERVICE = 'human-review';

/**
 * 'cadence-gate' (Flagship Plan 5) is a human-review gate raised by
 * review.cadence at a chapter/act/outline/pre-export boundary — same
 * Confirmations + park/resume machinery as 'pipeline-gate', but opened AFTER
 * a step already generated real content (so approve/edit resume with that
 * text — see project.review.pendingResult) and resolved via the four gate
 * actions (services/projects.ts applyReviewResume) rather than a plain
 * approve/reject.
 */
export type ReviewKind = 'pipeline-gate' | 'pipeline-error' | 'cadence-gate';
export type ReviewAction = 'resume' | 'retry' | 'abort' | 'wait';
/** The four gate actions a human can take on a paused review (Flagship Plan 5, Task 3). */
export type ReviewGateAction = 'approve' | 'edit' | 'regenerate' | 'stop';

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
  applyReviewResume(
    id: string, stepId: string, kind: ReviewKind,
    action?: ReviewGateAction, extra?: { editedText?: string; note?: string },
  ): void;
  clearReview(id: string): void;
}
interface Deps {
  gate: GateLike;
  engine: EngineLike;
  /** H1 fix: when set, resolveReviewGates runs the same summary/entity
   *  extraction the drive loops run inline, for a cadence-gate chapter that
   *  just resumed via this sweep — otherwise a chapter approved through the
   *  generic Confirmations UI never gets indexed. Optional; omitting it just
   *  skips extraction (fail-soft, and keeps every other Deps caller/test
   *  working unchanged). */
  contextExtraction?: ContextExtractionDeps;
}

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
  /** Automated pre-gate findings (Flagship Plan 5, Task 4) — craft-critic /
   *  continuity annotations attached to the Confirmations payload so the
   *  human sees them alongside the gate. Omitted/undefined → no `findings` key. */
  findings?: Record<string, unknown>,
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
        ...(findings ? { findings } : {}),
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
      // H1 fix: capture the gated step + its canonical resumed text BEFORE
      // applyReviewResume clears project.review — a cadence-gate resume
      // completes the step with review.pendingResult (see applyReviewResume's
      // 'approve' branch), the same text the drive loop's inline ContextEngine
      // hook would have summarized/indexed had the chapter not been gated.
      const stepForExtraction = review.kind === 'cadence-gate'
        ? project.steps?.find((s: any) => s.id === review.stepId)
        : null;
      const resumedText = review.pendingResult;

      // resume (gate) | retry (error): advance the project, then record the outcome
      // (recordOutcome requires the 'approved' state — only reached here).
      deps.engine.applyReviewResume(project.id, review.stepId, review.kind);
      resumed.push(project.id);
      await deps.gate.recordOutcome(review.confirmationId, {
        success: true,
        message: action === 'retry' ? 'Human review approved — retrying step' : 'Human review approved — continuing',
        executedAt: new Date().toISOString(),
      });

      if (deps.contextExtraction && stepForExtraction && resumedText) {
        await runChapterContextExtraction(deps.contextExtraction, project, stepForExtraction, resumedText);
      }
    } catch (err) {
      console.log(`  ⚠ Human review resolve failed for ${project?.id}: ${(err as Error)?.message || err}`);
    }
  }
  return resumed;
}

export interface CadenceGateResult {
  gated: boolean;
  confirmationId?: string;
  boundary?: Boundary;
}

/**
 * Cadence-driven review gate (Flagship Plan 5, Task 4). Call AFTER a step has
 * generated its real content but BEFORE completing it, at every chapter/act/
 * outline/pre-export boundary a driver reaches (both the dashboard
 * auto-execute loop and the bridge/heartbeat runner — see projects.routes.ts
 * and index.ts). Checks the book's resolved review.cadence (already
 * inherited book > author at creation — book-types.ts BookManifest.review;
 * services/book.ts create()) against the boundary(ies) this step corresponds
 * to (`computeBoundaries`); when one requires a gate, opens the SAME
 * Confirmations request as a literal 'pipeline-gate' but under kind
 * 'cadence-gate', with the just-generated `response` stashed on
 * `project.review.pendingResult` (so approve/edit resume with the real text)
 * and automated pre-gate findings attached — the deterministic craft-critic +
 * dialogue-auditor pass (Flagship Plan 4's analyzeChapter) on this chapter,
 * plus Flagship Plan 3 Task 5's `aggregateActContinuity` mini-audit across
 * every chapter's continuityFlags in the current project (surfaces on an act
 * boundary; harmless — usually empty — on an ordinary chapter boundary).
 *
 * Fail-soft + backward compatible: no book/manifest resolves 'per_act' (see
 * resolveCadence); a missing craftCritic/dialogueAuditor just means the
 * findings payload omits the `chapter` key; a gate-service failure never
 * blocks the caller (openReviewGate's own fail-soft — this still reports
 * `gated: true` so the caller stops driving rather than silently completing
 * past an un-openable gate).
 *
 * `ctx.headless`: skip cadence gating entirely regardless of cadence. Set by
 * callers that drive a project with no human present to resolve a
 * Confirmations request — the headless server-side driver
 * (BOOKCLAW_HEADLESS_PIPELINE=1) and the autonomous heartbeat both go through
 * `startAndRunProject` (index.ts), which resolves this from the same signal
 * the review-resolver sweep uses (env flag OR heartbeat.getAutonomousStatus()
 * enabled+!paused). Without this, a gated headless/autonomous run stalls
 * until the 24h Confirmations expiry abandons the book. The interactive
 * dashboard `/auto-execute` path (projects.routes.ts) never sets this, so
 * per_act stays the interactive default.
 */
export async function maybeOpenCadenceGate(
  deps: Deps, project: any, step: any, response: string,
  ctx: { manifest?: any; craftCritic?: any; dialogueAuditor?: any; headless?: boolean } = {},
): Promise<CadenceGateResult> {
  if (ctx.headless) return { gated: false };
  const steps = project?.steps ?? [];
  const stepIndex = steps.findIndex((s: any) => s.id === step?.id);
  const cadence = resolveCadence(ctx.manifest);
  const boundaries = computeBoundaries(stepIndex, steps);
  const hit = boundaries.find((b) => shouldGate(cadence, b));
  if (!hit) return { gated: false };

  const findings = buildCadenceGateFindings(project, step, response, ctx);
  const req = await openReviewGate(deps, project, step, 'cadence-gate', undefined, findings);
  if (project.review) project.review.pendingResult = response;
  return { gated: true, confirmationId: req?.id, boundary: hit };
}

/** Assemble the automated pre-gate findings payload — see maybeOpenCadenceGate. */
function buildCadenceGateFindings(
  project: any, step: any, response: string,
  ctx: { craftCritic?: any; dialogueAuditor?: any },
): Record<string, unknown> | undefined {
  const findings: Record<string, unknown> = {};

  if (typeof step?.chapterNumber === 'number' && ctx.craftCritic && ctx.dialogueAuditor && response) {
    try {
      const f = analyzeChapter({
        text: response,
        chapterNumber: step.chapterNumber,
        craftCritic: ctx.craftCritic,
        dialogueAuditor: ctx.dialogueAuditor,
        continuityFlags: step?.continuityFlags,
      });
      if (f.hasFindings) findings.chapter = describeFindings(f);
    } catch { /* fail-soft: annotation only, never blocks the gate */ }
  }

  const flaggedChapters = (project?.steps ?? []).filter((s: any) =>
    s.phase === 'writing' && typeof s.chapterNumber === 'number' && Array.isArray(s.continuityFlags) && s.continuityFlags.length);
  if (flaggedChapters.length) {
    const perChapter: ActChapterFlags[] = flaggedChapters.map((s: any) => ({ chapterNumber: s.chapterNumber, flags: s.continuityFlags }));
    const summary = aggregateActContinuity(perChapter);
    if (summary.totalFlags > 0) findings.actContinuity = summary;
  }

  return Object.keys(findings).length ? findings : undefined;
}
