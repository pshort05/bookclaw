/**
 * Unit tests for ProjectEngine's orchestration surface — step sequencing and
 * completion hooks — driven WITHOUT any real AI (gateway/src/services/projects.ts).
 *
 * Key insight: completeStep(projectId, stepId, result) takes the AI result as a
 * PARAMETER, so a whole project can be driven to completion by supplying fake
 * step results. No provider, no network. The engine is constructed against a
 * non-existent root (so loadState() is inert, no fixtures written) and fed a
 * multi-step project via an injected pipeline resolver (mirroring phase-06
 * wiring + tests/unit/projects.test.ts / project-bookslug.test.ts).
 *
 * Out of scope (cannot be exercised without source changes / a real provider):
 *   - The auto-execute generation loop that actually calls the AI router and
 *     then invokes completeStep — that lives in the route handler / executeStep
 *     path and needs a live AIRouter. We test the state machine it drives, not
 *     the driver.
 *   - bookSlug binding (covered by tests/unit/project-bookslug.test.ts).
 *
 * Run: node --import tsx --test tests/unit/project-engine-orchestration.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

// Non-existent root → loadState() returns early; constructor is inert.
function makeEngine(): ProjectEngine {
  return new ProjectEngine(undefined, join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
}

// A minimal valid LibraryPipeline with three static steps. createProjectFromPipeline
// builds one ProjectStep per entry, all initially 'pending'.
const THREE_STEP_PIPELINE = {
  schemaVersion: 1,
  name: 'book-planning',
  label: 'Book Planning',
  description: 'Plan a book',
  dynamic: false,
  steps: [
    { label: 'Step One',   skill: undefined, toolSuggestion: undefined, taskType: 'outline',         promptTemplate: 'One for {{title}}.' },
    { label: 'Step Two',   skill: undefined, toolSuggestion: undefined, taskType: 'creative_writing', promptTemplate: 'Two.' },
    { label: 'Step Three', skill: undefined, toolSuggestion: undefined, taskType: 'general',          promptTemplate: 'Three.' },
  ],
} as const;

// Build a 3-step project bound through the resolver path (book-planning → pipeline).
function makeThreeStepProject(e: ProjectEngine) {
  e.setPipelineResolver((name) => (name === 'book-planning' ? (THREE_STEP_PIPELINE as any) : null));
  return e.createProjectResolved('book-planning' as any, 'My Plan', 'desc', {});
}

// Cancel the debounced state write so the process exits promptly and writes no fixture.
function quiesce(e: ProjectEngine): void {
  clearTimeout((e as any).saveDebounceTimer);
}

// ── createProject → ordered steps, retrievable ───────────────────────────────

test('createProjectResolved builds the ordered multi-step project from the pipeline', () => {
  const e = makeEngine();
  const p = makeThreeStepProject(e);

  assert.equal(p.type, 'book-planning');
  assert.equal(p.steps.length, 3);
  assert.deepEqual(p.steps.map(s => s.label), ['Step One', 'Step Two', 'Step Three']);
  // Fresh project: every step pending, project pending, 0% progress.
  assert.deepEqual(p.steps.map(s => s.status), ['pending', 'pending', 'pending']);
  assert.equal(p.status, 'pending');
  assert.equal(p.progress, 0);

  // getProject returns the same instance.
  assert.strictEqual(e.getProject(p.id), p);
  quiesce(e);
});

test('getProject returns undefined for an unknown id', () => {
  const e = makeEngine();
  assert.equal(e.getProject('no-such-project'), undefined);
  quiesce(e);
});

test('startProject marks the project active and activates the first pending step', () => {
  const e = makeEngine();
  const p = makeThreeStepProject(e);

  const first = e.startProject(p.id);
  assert.ok(first, 'startProject should return the first step');
  assert.equal(first!.id, p.steps[0].id);
  assert.equal(first!.status, 'active');
  assert.equal(p.status, 'active');
  // Subsequent steps untouched.
  assert.equal(p.steps[1].status, 'pending');
  quiesce(e);
});

test('startProject returns null for an unknown project', () => {
  const e = makeEngine();
  assert.equal(e.startProject('no-such-project'), null);
  quiesce(e);
});

// ── Step sequencing via completeStep ─────────────────────────────────────────

test('completeStep marks the step completed, stores the result, and advances the pointer', () => {
  const e = makeEngine();
  const p = makeThreeStepProject(e);
  e.startProject(p.id);

  const next = e.completeStep(p.id, p.steps[0].id, 'fake-result-one');
  assert.ok(next, 'completing step 1 should return step 2 as the next active step');
  assert.equal(next!.id, p.steps[1].id);
  assert.equal(next!.status, 'active');

  // Step 1 recorded.
  assert.equal(p.steps[0].status, 'completed');
  assert.equal(p.steps[0].result, 'fake-result-one');
  // Progress is 1/3 ≈ 33%.
  assert.equal(p.progress, Math.round((1 / 3) * 100));
  // Project still in flight.
  assert.notEqual(p.status, 'completed');
  quiesce(e);
});

test('completeStep returns null and is a no-op result for an unknown project id', () => {
  const e = makeEngine();
  assert.equal(e.completeStep('no-such-project', 'whatever', 'x'), null);
  quiesce(e);
});

test('completeStep with an unknown step id still advances the next pending step (per source)', () => {
  // The source finds the step by id; if absent it skips the status write but
  // STILL advances: it activates the next pending step. Assert that documented
  // behavior rather than presuming a guard that does not exist.
  const e = makeEngine();
  const p = makeThreeStepProject(e);
  e.startProject(p.id); // step 1 active

  const next = e.completeStep(p.id, 'bogus-step-id', 'ignored');
  // No step matched 'bogus-step-id', so nothing was marked completed...
  assert.deepEqual(p.steps.map(s => s.status).filter(s => s === 'completed'), []);
  // ...but a pending step was activated. With step 1 already active, the next
  // pending (step 2) is promoted to active and returned.
  assert.ok(next, 'a pending step should be activated');
  assert.equal(next!.id, p.steps[1].id);
  assert.equal(next!.status, 'active');
  quiesce(e);
});

test('driving every step to completion marks the project completed at 100%', () => {
  const e = makeEngine();
  const p = makeThreeStepProject(e);
  e.startProject(p.id);

  assert.ok(e.completeStep(p.id, p.steps[0].id, 'r1'), 'step1 → step2');
  assert.ok(e.completeStep(p.id, p.steps[1].id, 'r2'), 'step2 → step3');
  const afterLast = e.completeStep(p.id, p.steps[2].id, 'r3');

  assert.equal(afterLast, null, 'completing the last step returns null (no next step)');
  assert.equal(p.status, 'completed');
  assert.equal(p.progress, 100);
  assert.ok(p.completedAt, 'completedAt should be stamped');
  assert.deepEqual(p.steps.map(s => s.status), ['completed', 'completed', 'completed']);
  quiesce(e);
});

// ── onProjectCompleted hook ──────────────────────────────────────────────────

test('onProjectCompleted fires exactly once, with the completed project, on the LAST step', () => {
  const e = makeEngine();
  const p = makeThreeStepProject(e);
  e.startProject(p.id);

  const seen: Array<{ id: string; status: string }> = [];
  e.onProjectCompleted((proj) => { seen.push({ id: proj.id, status: proj.status }); });

  // Hook must NOT fire on intermediate completions.
  e.completeStep(p.id, p.steps[0].id, 'r1');
  e.completeStep(p.id, p.steps[1].id, 'r2');
  assert.equal(seen.length, 0, 'hook must not fire before the final step');

  e.completeStep(p.id, p.steps[2].id, 'r3');
  assert.equal(seen.length, 1, 'hook fires exactly once');
  assert.equal(seen[0].id, p.id);
  assert.equal(seen[0].status, 'completed', 'project is already marked completed when the hook sees it');
  quiesce(e);
});

test('a synchronously-throwing completion hook does not break completeStep', () => {
  // The source dispatches hooks as `Promise.resolve(fn(project)).catch(...)`
  // inside an OUTER try/catch. fn(project) is evaluated eagerly, so a SYNC throw
  // escapes the per-hook .catch but is swallowed by the outer try/catch — which
  // means completeStep still finalizes the project. (As a side effect the outer
  // catch aborts the loop, so a hook registered AFTER the thrower may not run;
  // we assert only the guarantee the source actually makes: completion succeeds.)
  const e = makeEngine();
  const p = makeThreeStepProject(e);
  e.startProject(p.id);

  e.onProjectCompleted(() => { throw new Error('hook boom'); });

  e.completeStep(p.id, p.steps[0].id, 'r1');
  e.completeStep(p.id, p.steps[1].id, 'r2');
  assert.doesNotThrow(() => e.completeStep(p.id, p.steps[2].id, 'r3'));
  assert.equal(p.status, 'completed', 'completion still finalizes the project despite the throwing hook');
  assert.equal(p.progress, 100);
  quiesce(e);
});

test('an async-rejecting completion hook does not break completeStep', () => {
  // A hook returning a rejected promise is caught by the per-hook .catch, so it
  // cannot disturb completion nor abort sibling hooks.
  const e = makeEngine();
  const p = makeThreeStepProject(e);
  e.startProject(p.id);

  let goodHookFired = false;
  e.onProjectCompleted(async () => { throw new Error('async hook boom'); });
  e.onProjectCompleted(() => { goodHookFired = true; });

  e.completeStep(p.id, p.steps[0].id, 'r1');
  e.completeStep(p.id, p.steps[1].id, 'r2');
  assert.doesNotThrow(() => e.completeStep(p.id, p.steps[2].id, 'r3'));
  assert.equal(p.status, 'completed', 'completion still finalizes the project');
  assert.ok(goodHookFired, 'the rejected-promise hook is isolated by .catch, so the later hook still runs');
  quiesce(e);
});

// ── skipStep advancement + completion ────────────────────────────────────────

test('skipStep advances to the next pending step and counts as progress', () => {
  const e = makeEngine();
  const p = makeThreeStepProject(e);
  e.startProject(p.id);

  const next = e.skipStep(p.id, p.steps[0].id);
  assert.ok(next, 'skipping step 1 advances to step 2');
  assert.equal(next!.id, p.steps[1].id);
  assert.equal(next!.status, 'active');
  assert.equal(p.steps[0].status, 'skipped');
  // Skipped counts toward progress (1/3).
  assert.equal(p.progress, Math.round((1 / 3) * 100));
  quiesce(e);
});

test('skipping the final remaining step completes the project', () => {
  const e = makeEngine();
  const p = makeThreeStepProject(e);
  e.startProject(p.id);
  // Complete the first two so only step 3 remains.
  e.completeStep(p.id, p.steps[0].id, 'r1');
  e.completeStep(p.id, p.steps[1].id, 'r2');

  const next = e.skipStep(p.id, p.steps[2].id);
  assert.equal(next, null, 'no pending steps remain after skipping the last');
  assert.equal(p.status, 'completed');
  assert.ok(p.completedAt, 'completedAt stamped on skip-completion');
  quiesce(e);
});

// ── pauseProject ─────────────────────────────────────────────────────────────

test('pauseProject sets status paused and reverts any active step to pending', () => {
  const e = makeEngine();
  const p = makeThreeStepProject(e);
  e.startProject(p.id); // step 1 active

  e.pauseProject(p.id);
  assert.equal(p.status, 'paused');
  // The previously-active step is reverted to pending so it can resume cleanly.
  assert.equal(p.steps[0].status, 'pending');
  quiesce(e);
});
