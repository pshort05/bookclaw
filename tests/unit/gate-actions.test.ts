/**
 * Human-Gate Cadence (Flagship Plan 5, Task 3): the four gate actions
 * (approve/edit/regenerate/stop) on `ProjectEngine.applyReviewResume` for a
 * 'cadence-gate' review, plus `openReviewGate`'s findings payload. Uses a
 * REAL ProjectEngine (mirrors tests/unit/human-review.test.ts's realEngine()
 * pattern), not a stub, so completeStep/step-status transitions are the real
 * ones a driver would observe.
 *
 * Run: node --import tsx --test tests/unit/gate-actions.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { openReviewGate } from '../../gateway/src/services/human-review.js';

const PIPELINE = { schemaVersion: 1, name: 'book-planning', label: 'P', description: 'd', dynamic: false, steps: [
  { label: 'Write Chapter 1', skill: 'write', taskType: 'creative_writing', phase: 'writing', chapterNumber: 1, promptTemplate: 'Write.' },
  { label: 'Write Chapter 2', skill: 'write', taskType: 'creative_writing', phase: 'writing', chapterNumber: 2, promptTemplate: 'Write.' },
] } as const;

function realEngine() {
  const e = new ProjectEngine(undefined, mkdtempSync(join(tmpdir(), 'bookclaw-gateactions-')));
  e.setPipelineResolver(() => (PIPELINE as any));
  return e;
}

function gatedProject() {
  const e = realEngine();
  const p = e.createProjectResolved('book-planning' as any, 'P', 'd', {});
  e.startProject(p.id); // Chapter 1 active
  return { e, p };
}

// ── approve ──────────────────────────────────────────────────────────────

test('cadence-gate approve completes the step with pendingResult (the real drafted text)', () => {
  const { e, p } = gatedProject();
  (p as any).review = { confirmationId: 'c', stepId: p.steps[0].id, kind: 'cadence-gate', pendingResult: 'The real chapter prose.' };
  p.status = 'paused';

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'cadence-gate', 'approve');

  assert.equal(p.steps[0].status, 'completed');
  assert.equal(p.steps[0].result, 'The real chapter prose.');
  assert.equal(p.steps[1].status, 'active', 'next chapter activated');
  assert.equal(p.status, 'active');
  assert.equal((p as any).review, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});

test('cadence-gate approve defaults when no action is given (backward compatible with the old 2-arg call)', () => {
  const { e, p } = gatedProject();
  (p as any).review = { confirmationId: 'c', stepId: p.steps[0].id, kind: 'cadence-gate', pendingResult: 'Draft text.' };
  p.status = 'paused';

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'cadence-gate'); // no action arg

  assert.equal(p.steps[0].result, 'Draft text.');
  clearTimeout((e as any).saveDebounceTimer);
});

test('a literal pipeline-gate (no pendingResult) still falls back to the pre-Plan-5 placeholder', () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-planning' as any, 'P', 'd', {});
  e.startProject(p.id);
  (p as any).review = { confirmationId: 'c', stepId: p.steps[0].id, kind: 'pipeline-gate' };
  p.status = 'paused';

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'pipeline-gate');

  assert.equal(p.steps[0].result, '[approved by human review]');
  clearTimeout((e as any).saveDebounceTimer);
});

// ── edit ─────────────────────────────────────────────────────────────────

test('cadence-gate edit completes the step with editedText, not the generated draft', () => {
  const { e, p } = gatedProject();
  (p as any).review = { confirmationId: 'c', stepId: p.steps[0].id, kind: 'cadence-gate', pendingResult: 'Original AI draft.' };
  p.status = 'paused';

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'cadence-gate', 'edit', { editedText: 'Human-edited chapter text.' });

  assert.equal(p.steps[0].status, 'completed');
  assert.equal(p.steps[0].result, 'Human-edited chapter text.');
  assert.equal(p.steps[1].status, 'active');
  assert.equal(p.status, 'active');
  assert.equal((p as any).review, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});

// ── regenerate ───────────────────────────────────────────────────────────

test('cadence-gate regenerate resets the step to active with the note attached, without completing it', () => {
  const { e, p } = gatedProject();
  (p as any).review = { confirmationId: 'c', stepId: p.steps[0].id, kind: 'cadence-gate', pendingResult: 'First attempt, too short.' };
  p.status = 'paused';

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'cadence-gate', 'regenerate', { note: 'Add more sensory detail.' });

  assert.equal(p.steps[0].status, 'active', 'reactivated for re-generation, not completed');
  assert.equal(p.steps[0].result, undefined);
  assert.equal((p.steps[0] as any).regenerateNote, 'Add more sensory detail.');
  assert.equal(p.steps[1].status, 'pending', 'next chapter must NOT advance — the same step re-runs');
  assert.equal(p.status, 'active');
  assert.equal((p as any).review, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});

// ── stop ─────────────────────────────────────────────────────────────────

test('cadence-gate stop leaves the project paused and the step untouched', () => {
  const { e, p } = gatedProject();
  (p as any).review = { confirmationId: 'c', stepId: p.steps[0].id, kind: 'cadence-gate', pendingResult: 'Draft awaiting review.' };
  p.status = 'paused';

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'cadence-gate', 'stop');

  assert.equal(p.steps[0].status, 'active', 'step untouched — neither completed nor reset');
  assert.equal(p.status, 'paused', 'project stays paused');
  assert.equal((p as any).review, undefined, 'review marker cleared so it is not stuck "awaiting"');
  clearTimeout((e as any).saveDebounceTimer);
});

// ── openReviewGate findings payload ─────────────────────────────────────

function mockGate() {
  const calls: any = { created: [] };
  return {
    calls,
    async createRequest(input: any) { calls.created.push(input); return { id: 'conf-1', status: 'pending', ...input }; },
    checkDecision() { return { status: 'pending', request: { id: 'conf-1', status: 'pending' } }; },
    async recordOutcome() { return { id: 'conf-1', status: 'completed' }; },
  };
}
function mockEngine(projects: any[]) {
  return {
    listProjects: () => projects,
    getProject: (id: string) => projects.find((p) => p.id === id),
    parkForReview: (id: string) => { const p = projects.find((x) => x.id === id); if (p) p.status = 'paused'; },
    applyReviewResume: () => {},
    clearReview: () => {},
  };
}

test('openReviewGate attaches pre-gate findings to the confirmation payload when provided', async () => {
  const project: any = { id: 'p1', title: 'My Book', status: 'active', steps: [{ id: 's1', label: 'Write Chapter 3', status: 'active' }] };
  const gate = mockGate();
  const findings = { chapter: 'Dialogue tag overuse in paragraph 4.', actContinuity: { totalFlags: 2, byKind: { contradiction: 1, timeline: 1, knowledge: 0, red_herring: 0 }, chapters: [] } };

  await openReviewGate({ gate, engine: mockEngine([project]) }, project, project.steps[0], 'cadence-gate', undefined, findings);

  assert.equal(gate.calls.created.length, 1);
  assert.deepEqual(gate.calls.created[0].payload.findings, findings);
});

test('openReviewGate omits the findings key entirely when none are provided (unchanged payload shape)', async () => {
  const project: any = { id: 'p1', title: 'My Book', status: 'active', steps: [{ id: 's1', label: 'Write Chapter 3', status: 'active' }] };
  const gate = mockGate();

  await openReviewGate({ gate, engine: mockEngine([project]) }, project, project.steps[0], 'cadence-gate');

  assert.equal('findings' in gate.calls.created[0].payload, false);
});
