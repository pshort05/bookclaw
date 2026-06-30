/**
 * Human Review pipeline gate (owner ask 2026-06-30). A `human-review` step pauses
 * the pipeline and raises a Confirmations request; approval advances it. Any step
 * error raises the same kind of request. ConfirmationGate is poll-based, so resume
 * is a resolver that polls checkDecision and acts.
 *
 * Run: node --import tsx --test tests/unit/human-review.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import {
  HUMAN_REVIEW_SKILL,
  isHumanReviewStep,
  reviewDecisionAction,
  openReviewGate,
  resolveReviewGates,
} from '../../gateway/src/services/human-review.js';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

// ── pure helpers ────────────────────────────────────────────────────────────

test('isHumanReviewStep is true only for the human-review skill', () => {
  assert.equal(isHumanReviewStep({ skill: HUMAN_REVIEW_SKILL }), true);
  assert.equal(isHumanReviewStep({ skill: 'write' }), false);
  assert.equal(isHumanReviewStep({}), false);
  assert.equal(isHumanReviewStep(null), false);
  assert.equal(isHumanReviewStep(undefined), false);
});

test('reviewDecisionAction maps status x kind correctly', () => {
  assert.equal(reviewDecisionAction('approved', 'pipeline-gate'), 'resume');
  assert.equal(reviewDecisionAction('approved', 'pipeline-error'), 'retry');
  assert.equal(reviewDecisionAction('pending', 'pipeline-gate'), 'wait');
  assert.equal(reviewDecisionAction('pending', 'pipeline-error'), 'wait');
  for (const s of ['rejected', 'expired', 'completed', 'failed', 'whatever']) {
    assert.equal(reviewDecisionAction(s, 'pipeline-gate'), 'abort');
  }
});

// ── mocks for the gate logic (engine method calls are what we assert) ─────────

function mockGate(decisionStatus = 'pending') {
  const calls: any = { created: [], recorded: [] };
  return {
    calls,
    async createRequest(input: any) { calls.created.push(input); return { id: 'conf-1', status: 'pending', ...input }; },
    checkDecision() { return { status: decisionStatus, request: { id: 'conf-1', status: decisionStatus } }; },
    async recordOutcome(id: string, outcome: any) { calls.recorded.push({ id, outcome }); return { id, status: 'completed' }; },
  };
}

function mockEngine(projects: any[]) {
  const calls: any = { parked: [], resumed: [], cleared: [] };
  return {
    calls,
    listProjects: () => projects,
    getProject: (id: string) => projects.find((p) => p.id === id),
    parkForReview: (id: string) => { calls.parked.push(id); const p = projects.find((x) => x.id === id); if (p) p.status = 'paused'; },
    applyReviewResume: (id: string, stepId: string, kind: string) => { calls.resumed.push([id, stepId, kind]); const p = projects.find((x) => x.id === id); if (p) { p.status = 'active'; delete p.review; } },
    clearReview: (id: string) => { calls.cleared.push(id); const p = projects.find((x) => x.id === id); if (p) delete p.review; },
  };
}

// ── openReviewGate ──────────────────────────────────────────────────────────

test('openReviewGate creates one confirmation, stamps project.review, and pauses', async () => {
  const project: any = { id: 'p1', title: 'My Book', bookSlug: 'my-book', status: 'active', steps: [{ id: 's1', label: 'Human review', skill: HUMAN_REVIEW_SKILL, status: 'active' }] };
  const gate = mockGate();
  const engine = mockEngine([project]);

  const req = await openReviewGate({ gate, engine }, project, project.steps[0], 'pipeline-gate');

  assert.equal(gate.calls.created.length, 1);
  assert.equal(gate.calls.created[0].service, 'human-review');
  assert.equal(gate.calls.created[0].action, 'pipeline-gate');
  assert.equal(gate.calls.created[0].payload.projectId, 'p1');
  assert.equal(gate.calls.created[0].payload.stepId, 's1');
  assert.deepEqual(project.review, { confirmationId: 'conf-1', stepId: 's1', kind: 'pipeline-gate' });
  assert.deepEqual(engine.calls.parked, ['p1'], 'parks (no step demotion), not pauseProject');
  assert.equal((req as any).id, 'conf-1');
});

test('openReviewGate claims the review slot synchronously (race guard) and releases it on failure', async () => {
  // The claim must be visible before the async createRequest resolves.
  let claimedDuringCreate = false;
  const project: any = { id: 'p1', title: 'B', status: 'active', steps: [{ id: 's1', status: 'active' }] };
  const slowGate: any = {
    createRequest: async () => { claimedDuringCreate = !!project.review; throw new Error('boom'); },
  };
  await openReviewGate({ gate: slowGate, engine: mockEngine([project]) }, project, project.steps[0], 'pipeline-gate');
  assert.equal(claimedDuringCreate, true, 'review claimed before createRequest resolved');
  assert.equal(project.review, undefined, 'claim released after failure');
});

test('openReviewGate error gate carries the error detail in the payload', async () => {
  const project: any = { id: 'p1', title: 'B', status: 'active', steps: [{ id: 's2', status: 'failed' }] };
  const gate = mockGate();
  await openReviewGate({ gate, engine: mockEngine([project]) }, project, project.steps[0], 'pipeline-error', 'provider blew up');
  assert.equal(gate.calls.created[0].action, 'pipeline-error');
  assert.equal(gate.calls.created[0].payload.error, 'provider blew up');
});

test('openReviewGate is idempotent — no duplicate confirmation when a review is already set', async () => {
  const project: any = { id: 'p1', title: 'B', status: 'paused', review: { confirmationId: 'conf-old', stepId: 's1', kind: 'pipeline-gate' }, steps: [{ id: 's1', skill: HUMAN_REVIEW_SKILL, status: 'active' }] };
  const gate = mockGate();
  const req = await openReviewGate({ gate, engine: mockEngine([project]) }, project, project.steps[0], 'pipeline-gate');
  assert.equal(gate.calls.created.length, 0);
  assert.equal(req, null);
});

test('openReviewGate is fail-soft if the gate throws (never crashes the driver)', async () => {
  const project: any = { id: 'p1', title: 'B', status: 'active', steps: [{ id: 's1', status: 'active' }] };
  const gate: any = { createRequest: async () => { throw new Error('gate down'); } };
  await assert.doesNotReject(() => openReviewGate({ gate, engine: mockEngine([project]) }, project, project.steps[0], 'pipeline-error', 'boom'));
});

// ── resolveReviewGates ──────────────────────────────────────────────────────

test('resolveReviewGates: approved gate → applyReviewResume(gate) + recordOutcome', async () => {
  const project: any = { id: 'p1', status: 'paused', review: { confirmationId: 'conf-1', stepId: 's1', kind: 'pipeline-gate' }, steps: [{ id: 's1', skill: HUMAN_REVIEW_SKILL, status: 'active' }] };
  const gate = mockGate('approved');
  const engine = mockEngine([project]);
  await resolveReviewGates({ gate, engine });
  assert.deepEqual(engine.calls.resumed, [['p1', 's1', 'pipeline-gate']]);
  assert.equal(gate.calls.recorded.length, 1);
  assert.equal(gate.calls.recorded[0].outcome.success, true);
  assert.equal(project.status, 'active');
  assert.equal(project.review, undefined);
});

test('resolveReviewGates: approved error → applyReviewResume(error/retry)', async () => {
  const project: any = { id: 'p1', status: 'paused', review: { confirmationId: 'conf-1', stepId: 's2', kind: 'pipeline-error' }, steps: [{ id: 's2', status: 'failed', error: 'boom' }] };
  const gate = mockGate('approved');
  const engine = mockEngine([project]);
  await resolveReviewGates({ gate, engine });
  assert.deepEqual(engine.calls.resumed, [['p1', 's2', 'pipeline-error']]);
  assert.equal(gate.calls.recorded.length, 1);
  assert.equal(project.review, undefined);
});

test('resolveReviewGates: rejected → clearReview, stays paused, NO recordOutcome', async () => {
  const project: any = { id: 'p1', status: 'paused', review: { confirmationId: 'conf-1', stepId: 's1', kind: 'pipeline-gate' }, steps: [{ id: 's1', status: 'active' }] };
  const gate = mockGate('rejected');
  const engine = mockEngine([project]);
  await resolveReviewGates({ gate, engine });
  assert.deepEqual(engine.calls.resumed, []);
  assert.deepEqual(engine.calls.cleared, ['p1']);
  assert.equal(gate.calls.recorded.length, 0, 'rejected must not call recordOutcome (would throw — needs approved)');
  assert.equal(project.status, 'paused');
  assert.equal(project.review, undefined);
});

test('resolveReviewGates: pending → no-op (waits)', async () => {
  const project: any = { id: 'p1', status: 'paused', review: { confirmationId: 'conf-1', stepId: 's1', kind: 'pipeline-gate' }, steps: [{ id: 's1', status: 'active' }] };
  const gate = mockGate('pending');
  const engine = mockEngine([project]);
  await resolveReviewGates({ gate, engine });
  assert.deepEqual(engine.calls.resumed, []);
  assert.deepEqual(engine.calls.cleared, []);
  assert.ok(project.review, 'review preserved while pending');
});

test('resolveReviewGates ignores projects without a review and is guarded per-project', async () => {
  const ok: any = { id: 'p1', status: 'paused', review: { confirmationId: 'conf-1', stepId: 's1', kind: 'pipeline-gate' }, steps: [{ id: 's1', status: 'active' }] };
  const noReview: any = { id: 'p2', status: 'active', steps: [] };
  const engine = mockEngine([noReview, ok]);
  await assert.doesNotReject(() => resolveReviewGates({ gate: mockGate('approved'), engine }));
  assert.equal(ok.review, undefined);
});

// ── engine methods (real ProjectEngine) ──────────────────────────────────────

const PIPELINE = { schemaVersion: 1, name: 'book-planning', label: 'P', description: 'd', dynamic: false, steps: [
  { label: 'Human review', skill: HUMAN_REVIEW_SKILL, taskType: 'general', promptTemplate: '' },
  { label: 'Write', skill: 'write', taskType: 'general', promptTemplate: 'x' },
] } as const;

function realEngine() {
  const e = new ProjectEngine(undefined, mkdtempSync(join(tmpdir(), 'bookclaw-review-')));
  e.setPipelineResolver(() => (PIPELINE as any));
  return e;
}

test('engine.applyReviewResume(gate) completes the gate step, advances, sets active, clears review', () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-planning' as any, 'P', 'd', {});
  e.startProject(p.id); // step 0 (gate) active
  (p as any).review = { confirmationId: 'c', stepId: p.steps[0].id, kind: 'pipeline-gate' };
  p.status = 'paused';

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'pipeline-gate');

  assert.equal(p.steps[0].status, 'completed', 'gate step completed');
  assert.equal(p.steps[1].status, 'active', 'next step activated');
  assert.equal(p.status, 'active');
  assert.equal((p as any).review, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});

test('engine.applyReviewResume(gate) on the LAST step leaves the project completed, not active', () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-planning' as any, 'P', 'd', {});
  e.startProject(p.id);
  p.steps[1].status = 'completed';  // the write step already done
  p.steps[0].status = 'active';     // gate is the last remaining step
  p.status = 'paused';

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'pipeline-gate');

  assert.equal(p.steps[0].status, 'completed');
  assert.equal(p.status, 'completed', 'a finished pipeline must end completed, not active');
  clearTimeout((e as any).saveDebounceTimer);
});

test('engine.applyReviewResume(error) resets the failed step to active and clears review', () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-planning' as any, 'P', 'd', {});
  e.startProject(p.id);
  p.steps[0].status = 'failed'; p.steps[0].error = 'boom';
  (p as any).review = { confirmationId: 'c', stepId: p.steps[0].id, kind: 'pipeline-error' };
  p.status = 'paused';

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'pipeline-error');

  assert.equal(p.steps[0].status, 'active', 'failed step reactivated for retry');
  assert.equal(p.steps[0].error, undefined);
  assert.equal(p.status, 'active');
  assert.equal((p as any).review, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});

test('engine.clearReview removes the review marker', () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-planning' as any, 'P', 'd', {});
  (p as any).review = { confirmationId: 'c', stepId: 's', kind: 'pipeline-gate' };
  (e as any).clearReview(p.id);
  assert.equal((p as any).review, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});
