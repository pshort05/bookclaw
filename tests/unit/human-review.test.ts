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
  maybeOpenCadenceGate,
  chapterContinuityFlags,
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

test('resolveReviewGates: approved cadence-gate resume runs ContextEngine summary + entity extraction (H1)', async () => {
  const step = { id: 's1', label: 'Write Chapter 1', skill: 'write', chapterNumber: 1, status: 'active' };
  const pendingResult = 'Real chapter prose. '.repeat(30);
  const project: any = {
    id: 'p1', status: 'paused',
    review: { confirmationId: 'conf-1', stepId: 's1', kind: 'cadence-gate', pendingResult },
    steps: [step],
  };
  const gate = mockGate('approved');
  const engine = mockEngine([project]);
  const summaryCalls: any[] = [];
  const entityCalls: any[] = [];
  const contextExtraction = {
    contextEngine: {
      async generateSummary(projectId: string, stepId: string, stepLabel: string, chapterNumber: number, fullText: string) {
        summaryCalls.push({ projectId, stepId, stepLabel, chapterNumber, fullText });
        return {};
      },
      async extractEntities(projectId: string, stepId: string, fullText: string) {
        entityCalls.push({ projectId, stepId, fullText });
        return [];
      },
    },
    aiComplete: async () => ({ text: '{}' }),
    aiSelectProvider: () => ({ id: 'fake' }),
  };

  await resolveReviewGates({ gate, engine, contextExtraction });

  assert.equal(summaryCalls.length, 1, 'summary generated for the gated-then-approved chapter');
  assert.equal(summaryCalls[0].fullText, pendingResult);
  assert.equal(summaryCalls[0].chapterNumber, 1);
  assert.equal(entityCalls.length, 1);
  assert.equal(entityCalls[0].fullText, pendingResult);
});

test('resolveReviewGates: no contextExtraction deps passed is fail-soft (no crash, no extraction)', async () => {
  const step = { id: 's1', label: 'Write Chapter 1', skill: 'write', chapterNumber: 1, status: 'active' };
  const project: any = {
    id: 'p1', status: 'paused',
    review: { confirmationId: 'conf-1', stepId: 's1', kind: 'cadence-gate', pendingResult: 'x'.repeat(300) },
    steps: [step],
  };
  const gate = mockGate('approved');
  const engine = mockEngine([project]);
  await assert.doesNotReject(() => resolveReviewGates({ gate, engine }));
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

// ── saveReviewDraft: inline "Save (keep paused)" on the content pane (owner ask
//    2026-07-03) — persist a human edit into a paused cadence-gate review's
//    drafted text WITHOUT resuming; a later approve then resumes with it. ──────

test('engine.saveReviewDraft persists edited text into a paused cadence-gate review and keeps it parked', () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-planning' as any, 'P', 'd', {});
  e.startProject(p.id); // step 0 active
  (p as any).review = { confirmationId: 'c', stepId: p.steps[0].id, kind: 'cadence-gate', pendingResult: 'original draft' };
  p.status = 'paused';

  (e as any).saveReviewDraft(p.id, 'a human-rewritten chapter');

  assert.equal((p as any).review.pendingResult, 'a human-rewritten chapter', 'draft replaced');
  assert.ok((p as any).review, 'review preserved — not resumed');
  assert.equal(p.status, 'paused', 'still parked for review');
  assert.equal(p.steps[0].status, 'active', 'step not completed by a save');
  clearTimeout((e as any).saveDebounceTimer);
});

test('engine.saveReviewDraft throws when no review is pending', () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-planning' as any, 'P', 'd', {});
  assert.throws(() => (e as any).saveReviewDraft(p.id, 'x'), /no review/i);
  clearTimeout((e as any).saveDebounceTimer);
});

test('engine.saveReviewDraft throws for a non-cadence-gate review (no editable draft)', () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-planning' as any, 'P', 'd', {});
  (p as any).review = { confirmationId: 'c', stepId: 's', kind: 'pipeline-error' };
  assert.throws(() => (e as any).saveReviewDraft(p.id, 'x'), /editable draft/i);
  clearTimeout((e as any).saveDebounceTimer);
});

// ── act-gate continuity aggregation (M2) ────────────────────────────────────
// The shipped flagship pipelines (romance-spicy.json, romantasy-production.json,
// technothriller-production.json) tag per-chapter steps with phase:'draft' and
// attach continuityFlags to the role:'draft' step — never phase:'writing'.
// buildCadenceGateFindings' flaggedChapters selection must key off
// chapterNumber + continuityFlags, not the literal phase string, or the
// act-boundary continuity mini-audit is silently absent for every real pipeline.

test('an act-boundary cadence gate aggregates continuityFlags from phase:"draft" chapters (M2)', async () => {
  const project: any = {
    id: 'p1', title: 'Flagship Book', status: 'active',
    steps: [
      { id: 's1', label: 'Draft Chapter 1', skill: 'write', phase: 'draft', role: 'draft', chapterNumber: 1,
        continuityFlags: [{ kind: 'contradiction', detail: 'eye color changed' }] },
      { id: 's2', label: 'Draft Chapter 2', skill: 'write', phase: 'draft', role: 'draft', chapterNumber: 2,
        continuityFlags: [{ kind: 'timeline', detail: 'day count skipped' }] },
      { id: 's3', label: 'Draft Chapter 3', skill: 'write', phase: 'draft', role: 'draft', chapterNumber: 3, status: 'active' },
    ],
  };
  const gate = mockGate();
  const engine = mockEngine([project]);
  const manifest = { review: { cadence: 'per_act' } };

  const result = await maybeOpenCadenceGate({ gate, engine }, project, project.steps[2], 'Chapter 3 prose.', { manifest });

  assert.equal(result.gated, true, 'chapter 3 of 3 is an act boundary under per_act cadence');
  assert.equal(gate.calls.created.length, 1);
  const findings = gate.calls.created[0].payload.findings;
  assert.ok(findings?.actContinuity, 'act-boundary gate must carry the aggregated continuity summary');
  assert.equal(findings.actContinuity.totalFlags, 2, 'flags from both drafted chapters are aggregated');
  assert.deepEqual(
    findings.actContinuity.chapters.map((c: any) => c.chapterNumber),
    [1, 2],
    'only the flagged chapters are included, in order',
  );
});

// ── contradiction force-gate (consistency-feedback design, Feature 2) ────────
// The ledger attaches continuityFlags to the chapter's DRAFT step, but the gate
// must fire at the chapter's LAST prose step: the count is identical at every
// prose step and applyReviewResume clears project.review, so gating on "any
// prose step" re-opened an identical gate 3-4 times per chapter (each able to
// die at the 24h Confirmations expiry) AND pre-empted the Improvement Plan +
// Rewrite repair passes. Fires once, after the repair, so the author reviews
// the repaired text.

/** [id prefix, role, taskType, label] — the real romance-spicy-deterministic
 *  per-chapter shape: 7 steps, 3 of them prose (draft, rewrite, sweep). */
const DETERMINISTIC_CHAPTER: Array<[string, string, string, string]> = [
  ['b', 'scene_brief', 'outline', 'Scene Brief'],
  ['d', 'draft', 'creative_writing', 'First Draft'],
  ['p', 'improve', 'revision', 'Improvement Plan'],
  ['r', 'rewrite', 'creative_writing', 'Rewrite'],
  ['a', '', 'revision', 'Consistency Audit'],
  ['x', '', 'general', 'Consistency Apply'],
  ['s', 'humanize', 'general', 'Humanize — De-AI Sweep'],
];

/** The real romance-*-full shape: 6 steps, 4 of them prose (draft, rewrite,
 *  humanize, intimacy) — 4 firings under the old "any prose step" rule. */
const FULL_CHAPTER: Array<[string, string, string, string]> = [
  ['b', 'scene_brief', 'outline', 'Scene Brief'],
  ['d', 'draft', 'creative_writing', 'First Draft'],
  ['p', 'improve', 'revision', 'Improvement Plan'],
  ['r', 'rewrite', 'revision', 'Rewrite'],
  ['h', 'humanize', 'final_edit', 'Humanize'],
  ['i', 'intimacy', 'creative_writing', 'Intimacy'],
];

/** novel-pipeline's single prose step per chapter. */
const SINGLE_PROSE_CHAPTER: Array<[string, string, string, string]> = [
  ['d', 'draft', 'creative_writing', 'Write Chapter'],
];

/** 9 chapters x the given per-chapter shape + a review step + assembly; acts land on 3/6/9. */
function contradictionProject(
  flagsByChapter: Record<number, any[]> = {},
  shape: Array<[string, string, string, string]> = DETERMINISTIC_CHAPTER,
) {
  const steps: any[] = [];
  for (let n = 1; n <= 9; n++) {
    for (const [prefix, role, taskType, label] of shape) {
      steps.push({
        id: `${prefix}${n}`, label: `${label} — Chapter ${n}`, taskType, chapterNumber: n,
        ...(role ? { role } : {}),
        ...(prefix === 'd' ? { skill: 'romance-sweet-first-draft' } : {}),
        ...(prefix === 'd' && flagsByChapter[n] ? { continuityFlags: flagsByChapter[n] } : {}),
      });
    }
  }
  steps.push({ id: 'rev', label: 'Continuity & Arc Review', skill: 'revision' });
  steps.push({ id: 'asm', label: 'Compile manuscript', skill: 'assembly' });
  return { id: 'pc', title: 'Book', type: 'book-production', steps, review: undefined as any };
}

const contradictions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ kind: 'contradiction', detail: `contradiction ${i + 1}` }));

/** per_act + chapter 2 of 9 → no cadence hit; only the contradiction rule can gate. */
const noCadenceHit = { manifest: { review: { cadence: 'per_act' } } };

/** Drive every step of chapter `ch` in order, releasing the review slot between
 *  steps exactly as applyReviewResume does — returns the ids that gated. */
async function driveChapter(project: any, ch: number, gate: any, ctx: any = noCadenceHit): Promise<string[]> {
  const engine = mockEngine([project]);
  const fired: string[] = [];
  for (const step of project.steps.filter((s: any) => s.chapterNumber === ch)) {
    const r = await maybeOpenCadenceGate({ gate, engine }, project, step, `Chapter ${ch} prose.`, ctx);
    if (r.gated) fired.push(step.id);
    delete project.review; // applyReviewResume clears the slot on resume
  }
  return fired;
}

test('the contradiction gate fires ONCE per chapter, at the de-AI sweep — not at every prose step', async () => {
  const project: any = contradictionProject({ 2: contradictions(9) });
  const gate = mockGate();

  const fired = await driveChapter(project, 2, gate);

  assert.deepEqual(fired, ['s2'], 'only the chapter\'s LAST prose step gates');
  assert.equal(gate.calls.created.length, 1, 'one Confirmations request per chapter, not three');
});

test('the romance-*-full shape gates only at the intimacy pass (its last prose step)', async () => {
  const project: any = contradictionProject({ 2: contradictions(9) }, FULL_CHAPTER);
  const gate = mockGate();

  const fired = await driveChapter(project, 2, gate);

  assert.deepEqual(fired, ['i2'], 'four prose steps, one gate');
});

test('a single-prose-step pipeline gates on that one step', async () => {
  const project: any = contradictionProject({ 2: contradictions(9) }, SINGLE_PROSE_CHAPTER);
  const gate = mockGate();

  const fired = await driveChapter(project, 2, gate);

  assert.deepEqual(fired, ['d2']);
});

test('the DRAFT step never force-gates — the Improvement Plan and Rewrite run first', async () => {
  const project: any = contradictionProject({ 2: contradictions(9) });
  const draft = project.steps.find((s: any) => s.id === 'd2');
  const gate = mockGate();

  const r = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, draft, 'Chapter 2 prose.', noCadenceHit);

  assert.equal(r.gated, false, 'gating at the draft pre-empts the repair passes');
  assert.equal(gate.calls.created.length, 0);
});

test('9 contradictions on the DRAFT step force a gate at the SWEEP step, with no cadence hit', async () => {
  const project: any = contradictionProject({ 2: contradictions(9) });
  const sweep = project.steps.find((s: any) => s.id === 's2');
  const gate = mockGate();
  const engine = mockEngine([project]);

  const r = await maybeOpenCadenceGate({ gate, engine }, project, sweep, 'Chapter 2 prose.', noCadenceHit);

  assert.equal(r.gated, true, 'contradiction count force-opens the gate');
  const text = String(gate.calls.created[0].payload.findings.contradictions);
  assert.match(text, /^9 contradictions in chapter 2\b/, 'the count and chapter lead the note');
  assert.match(text, /threshold of 6/);
  assert.match(text, /found in the draft/i, 'the rewrite-may-have-fixed-it caveat is stated to the human');
  assert.match(text, /^- contradiction 1$/m, 'the detail strings make the gate actionable');
});

test('the contradiction findings value is a plain string, never a nested object', async () => {
  const project: any = contradictionProject({ 2: contradictions(9) });
  const sweep = project.steps.find((s: any) => s.id === 's2');
  const gate = mockGate();

  await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 2 prose.', noCadenceHit);

  // A non-string value renders as raw JSON in Confirmations/GatePanel, and a
  // >300-char line there drags the WHOLE findings payload into a JSON blob.
  assert.equal(typeof gate.calls.created[0].payload.findings.contradictions, 'string');
});

test('the contradiction findings string is capped (10 flags + "+N more", <= 1200 chars)', async () => {
  const project: any = contradictionProject({ 2: contradictions(25) });
  const sweep = project.steps.find((s: any) => s.id === 's2');
  const gate = mockGate();

  await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 2 prose.', noCadenceHit);

  const text = String(gate.calls.created[0].payload.findings.contradictions);
  assert.equal(text.split('\n').filter((l) => l.startsWith('- ')).length, 10);
  assert.match(text, /\+15 more/);
  assert.ok(text.length <= 1200, `expected <= 1200 chars, got ${text.length}`);
});

test('3 contradictions do NOT force a gate', async () => {
  const project: any = contradictionProject({ 2: contradictions(3) });
  const sweep = project.steps.find((s: any) => s.id === 's2');
  const gate = mockGate();

  const r = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 2 prose.', noCadenceHit);

  assert.equal(r.gated, false);
  assert.equal(gate.calls.created.length, 0);
});

test('knowledge/timeline flags alone never force a gate, however many', async () => {
  const flags = Array.from({ length: 12 }, (_, i) => ({ kind: i % 2 ? 'knowledge' : 'timeline', detail: `soft ${i}` }));
  const project: any = contradictionProject({ 2: flags });
  const sweep = project.steps.find((s: any) => s.id === 's2');
  const gate = mockGate();

  const r = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 2 prose.', noCadenceHit);

  assert.equal(r.gated, false);
});

test('headless skips the contradiction gate, but the same chapter gates with a human present', async () => {
  const project: any = contradictionProject({ 2: contradictions(9) });
  const sweep = project.steps.find((s: any) => s.id === 's2');
  const gate = mockGate();

  const headless = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 2 prose.',
    { ...noCadenceHit, headless: true });
  assert.equal(headless.gated, false, 'no human to resolve a Confirmations request');
  assert.equal(gate.calls.created.length, 0);

  const interactive = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 2 prose.', noCadenceHit);
  assert.equal(interactive.gated, true, 'the twin: identical project, no headless flag → gated');
});

test('an explicit `autonomous` cadence is never contradiction-force-gated (per_act twin is)', async () => {
  const project: any = contradictionProject({ 2: contradictions(9) });
  const sweep = project.steps.find((s: any) => s.id === 's2');
  const gate = mockGate();

  const auto = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 2 prose.',
    { manifest: { review: { cadence: 'autonomous' } } });
  assert.equal(auto.gated, false, '"do not pause me" is the owner\'s explicit choice');
  assert.equal(gate.calls.created.length, 0);

  const perAct = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 2 prose.', noCadenceHit);
  assert.equal(perAct.gated, true, 'the twin: identical project under per_act → gated');
});

test('a non-prose step is never force-gated, while the same chapter\'s prose step is', async () => {
  const project: any = contradictionProject({ 2: contradictions(9) });
  const gate = mockGate();

  for (const id of ['b2', 'p2', 'a2', 'x2']) { // brief, improvement plan, consistency audit + apply
    const step = project.steps.find((s: any) => s.id === id);
    const r = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, step, 'Not prose.', noCadenceHit);
    assert.equal(r.gated, false, `${step.label} must not be force-gated (2026-09-12 noise)`);
    delete project.review;
  }

  const sweep = project.steps.find((s: any) => s.id === 's2');
  const r = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 2 prose.', noCadenceHit);
  assert.equal(r.gated, true, 'the twin: the same chapter\'s prose step DOES gate');
  assert.equal(gate.calls.created.length, 1);
});

test('BOOKCLAW_CONTRADICTION_GATE overrides the threshold', async () => {
  const project: any = contradictionProject({ 2: contradictions(3) });
  const sweep = project.steps.find((s: any) => s.id === 's2');
  const gate = mockGate();
  const prev = process.env.BOOKCLAW_CONTRADICTION_GATE;
  process.env.BOOKCLAW_CONTRADICTION_GATE = '3';
  try {
    const r = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 2 prose.', noCadenceHit);
    assert.equal(r.gated, true);
    assert.match(String(gate.calls.created[0].payload.findings.contradictions), /threshold of 3/);
  } finally {
    if (prev === undefined) delete process.env.BOOKCLAW_CONTRADICTION_GATE;
    else process.env.BOOKCLAW_CONTRADICTION_GATE = prev;
  }
});

test('BOOKCLAW_CONTRADICTION_GATE=0 disables the force-gate entirely', async () => {
  const project: any = contradictionProject({ 2: contradictions(20) });
  const sweep = project.steps.find((s: any) => s.id === 's2');
  const gate = mockGate();
  const prev = process.env.BOOKCLAW_CONTRADICTION_GATE;
  process.env.BOOKCLAW_CONTRADICTION_GATE = '0';
  try {
    const r = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 2 prose.', noCadenceHit);
    assert.equal(r.gated, false);
  } finally {
    if (prev === undefined) delete process.env.BOOKCLAW_CONTRADICTION_GATE;
    else process.env.BOOKCLAW_CONTRADICTION_GATE = prev;
  }
});

test('the chapter findings block picks up the DRAFT step flags when the gate fires at the sweep step', async () => {
  // 3 contradictions: below the force-gate threshold, so the gate here is the
  // ordinary per_act act boundary (chapter 3 of 9) — what is under test is that
  // findings.chapter is no longer silently empty at a non-draft step.
  const project: any = contradictionProject({ 3: contradictions(3) });
  const sweep = project.steps.find((s: any) => s.id === 's3');
  const gate = mockGate();
  const ctx = {
    manifest: { review: { cadence: 'per_act' } },
    craftCritic: { analyze: () => ({ flags: [] }) },
    dialogueAuditor: { audit: () => ({ flags: [] }) },
  };

  const r = await maybeOpenCadenceGate({ gate, engine: mockEngine([project]) }, project, sweep, 'Chapter 3 prose.', ctx as any);

  assert.equal(r.gated, true, 'chapter 3 of 9 is an act boundary under per_act');
  const findings = gate.calls.created[0].payload.findings;
  assert.match(String(findings.chapter), /\[continuity:contradiction\] contradiction 1/);
});

// ── chapterContinuityFlags: the cross-step lookup + dedup key ────────────────
// `detail` alone is a lossy key: it is a deterministic template over
// entity+attribute+values, so two DISTINCT violations can be byte-identical and
// differ only in `span` — which the old key discarded. Flags with no detail at
// all collapsed to a single entry.

test('chapterContinuityFlags gathers every step of the chapter and dedups on detail + span', () => {
  const project = {
    steps: [
      { chapterNumber: 1, continuityFlags: [{ kind: 'contradiction', detail: 'Mara is 28', span: 'she was 28' }] },
      { chapterNumber: 2, continuityFlags: [
        { kind: 'contradiction', detail: 'the bar is on Main', span: 'the bar on Main' },
        { kind: 'contradiction', detail: 'the bar is on Main', span: 'the bar on Main' }, // true duplicate
        { kind: 'contradiction', detail: 'the bar is on Main', span: 'down at the bar' }, // distinct violation
      ] },
      { chapterNumber: 2, continuityFlags: [{ kind: 'timeline', detail: 'Tuesday twice' }] },
      { chapterNumber: 3, continuityFlags: [{ kind: 'contradiction', detail: 'other chapter' }] },
    ],
  };

  const flags = chapterContinuityFlags(project, 2);

  assert.equal(flags.length, 3, 'the true duplicate collapses; the different-span flag survives');
  assert.deepEqual(flags.map((f: any) => f.span), ['the bar on Main', 'down at the bar', undefined]);
});

test('chapterContinuityFlags never collapses detail-less flags into one', () => {
  const project = {
    steps: [{ chapterNumber: 4, continuityFlags: [
      { kind: 'contradiction' }, { kind: 'contradiction' }, { kind: 'knowledge' },
    ] }],
  };

  assert.equal(chapterContinuityFlags(project, 4).length, 3);
});

test('chapterContinuityFlags is fail-soft on a malformed project', () => {
  assert.deepEqual(chapterContinuityFlags(undefined, 1), []);
  assert.deepEqual(chapterContinuityFlags({ steps: null }, 1), []);
  assert.deepEqual(chapterContinuityFlags({ steps: [{ chapterNumber: 1, continuityFlags: 'nope' }] }, 1), []);
});
