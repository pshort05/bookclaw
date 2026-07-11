/**
 * Project-engine gating / completion-safety regressions (hardening batch A,
 * bugs #6 / #7 / #8). Uses a real ProjectEngine (mirrors
 * tests/unit/council-selection-state.test.ts's realEngine() pattern) so the
 * completeStep / applyReviewResume transitions are the real ones a driver sees.
 *
 * #8 — completeStep must NOT auto-complete a project that still has a 'failed'
 *      step (a hole in the manuscript) and must NOT fire completion hooks.
 * #6 — applyReviewResume's 'approve' branch must NOT clobber a step that was
 *      already completed (fresh result) with the stale pre-gate pendingResult.
 * #7 — the four mutation routes (retry/restart/skip/resume) must refuse while a
 *      project is being driven; engine-level we assert the isDriving predicate,
 *      document resumeProject's unsafe demotion, and assert the route guards.
 *
 * Run: node --import tsx --test tests/unit/project-engine-gating.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

const THREE_STEP = { schemaVersion: 1, name: 'three-step', label: 'P', description: 'd', dynamic: false, steps: [
  { label: 'Chapter A', taskType: 'creative_writing', phase: 'production', promptTemplate: 'A.' },
  { label: 'Chapter B', taskType: 'creative_writing', phase: 'production', promptTemplate: 'B.' },
  { label: 'Chapter C', taskType: 'creative_writing', phase: 'production', promptTemplate: 'C.' },
] } as const;

function realEngine() {
  const e = new ProjectEngine(undefined, mkdtempSync(join(tmpdir(), 'bookclaw-gating-')));
  e.setPipelineResolver(() => (THREE_STEP as any));
  return e;
}

function project(e: ProjectEngine) {
  const p = e.createProjectResolved('book-production' as any, 'P', 'd', {});
  e.startProject(p.id); // step[0] active
  return p as any;
}

// ── #8: a 'failed' step blocks auto-completion ──────────────────────────────

test('#8 completeStep does NOT mark the project completed while a step is failed', () => {
  const e = realEngine();
  const p = project(e);
  let hookFired = false;
  e.onProjectCompleted(() => { hookFired = true; });

  // A completes, B fails (a hole), C is the last step and completes.
  p.steps[0].status = 'completed';
  p.steps[1].status = 'failed';
  p.steps[2].status = 'active';

  const next = e.completeStep(p.id, p.steps[2].id, 'text C');

  assert.equal(next, null, 'no runnable frontier remains');
  assert.notEqual(p.status, 'completed', 'a holey manuscript must not read as completed');
  assert.equal(hookFired, false, 'completion hook (website auto-add-book) must NOT fire on a failed run');
  clearTimeout((e as any).saveDebounceTimer);
});

test('#8 skipStep does NOT mark the project completed while a step is failed', () => {
  const e = realEngine();
  const p = project(e);

  // A completed, B failed (a hole), C is the last step and gets SKIPPED.
  p.steps[0].status = 'completed';
  p.steps[1].status = 'failed';
  p.steps[2].status = 'active';

  const next = e.skipStep(p.id, p.steps[2].id);

  assert.equal(next, null, 'no runnable frontier remains');
  assert.notEqual(p.status, 'completed', 'skipping past a failed step must not read as completed');
  clearTimeout((e as any).saveDebounceTimer);
});

test('#8 skipStep still completes a clean project with no failed steps', () => {
  const e = realEngine();
  const p = project(e);

  p.steps[0].status = 'completed';
  p.steps[1].status = 'completed';
  p.steps[2].status = 'active';

  const next = e.skipStep(p.id, p.steps[2].id);

  assert.equal(next, null);
  assert.equal(p.status, 'completed', 'a clean skip of the last step still completes');
  clearTimeout((e as any).saveDebounceTimer);
});

test('#8 the normal all-completed path still completes and fires the hook', () => {
  const e = realEngine();
  const p = project(e);
  let hookFired = false;
  e.onProjectCompleted(() => { hookFired = true; });

  p.steps[0].status = 'completed';
  p.steps[1].status = 'completed';
  p.steps[2].status = 'active';

  const next = e.completeStep(p.id, p.steps[2].id, 'text C');

  assert.equal(next, null);
  assert.equal(p.status, 'completed', 'a clean all-completed run still completes');
  assert.equal(hookFired, true, 'completion hook still fires on a clean run');
  clearTimeout((e as any).saveDebounceTimer);
});

// ── #6: approve must not clobber an already-completed step ──────────────────

test('#6 applyReviewResume approve does NOT overwrite a fresh completed result with the stale pendingResult', () => {
  const e = realEngine();
  const p = project(e);

  // Step 0 was already regenerated + completed with FRESH text while a cadence
  // review sat parked carrying the STALE pre-gate draft.
  p.steps[0].status = 'completed';
  p.steps[0].result = 'FRESH regenerated chapter';
  p.status = 'paused';
  p.review = {
    kind: 'cadence-gate',
    stepId: p.steps[0].id,
    confirmationId: 'conf-1',
    pendingResult: 'STALE pre-gate draft',
  };

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'cadence-gate', 'approve');

  assert.equal(p.steps[0].result, 'FRESH regenerated chapter', 'must keep the fresh result, not the stale pendingResult');
  assert.equal(p.review, undefined, 'review marker cleared');
  clearTimeout((e as any).saveDebounceTimer);
});

test('#6 approve still completes a genuinely-active gate step with its pendingResult', () => {
  const e = realEngine();
  const p = project(e); // step[0] active
  p.status = 'paused';
  p.review = {
    kind: 'cadence-gate',
    stepId: p.steps[0].id,
    confirmationId: 'conf-2',
    pendingResult: 'the drafted chapter text',
  };

  (e as any).applyReviewResume(p.id, p.steps[0].id, 'cadence-gate', 'approve');

  assert.equal(p.steps[0].status, 'completed');
  assert.equal(p.steps[0].result, 'the drafted chapter text', 'a real gate approve completes with the generated draft');
  assert.equal(p.status, 'active');
  clearTimeout((e as any).saveDebounceTimer);
});

// ── #7: isDriving predicate + route guards ──────────────────────────────────

test('#7 isDriving reflects the shared drive lock', () => {
  const e = realEngine();
  const p = project(e);
  assert.equal(e.isDriving(p.id), false);
  assert.equal(e.tryStartDriving(p.id), true, 'first claim succeeds');
  assert.equal(e.isDriving(p.id), true, 'lock is observable');
  assert.equal(e.tryStartDriving(p.id), false, 'reentrant claim refused');
  e.stopDriving(p.id);
  assert.equal(e.isDriving(p.id), false);
  clearTimeout((e as any).saveDebounceTimer);
});

test('#7 resumeProject demotes an in-flight active step (why the route guard is required)', () => {
  const e = realEngine();
  const p = project(e); // step[0] active = "in flight"
  // A no-op call with an already-active frontier keeps step[0] active, but if a
  // LATER step were mid-run it would be demoted; document the hazard: resume
  // re-derives the frontier from runnableSteps, so it must never run mid-drive.
  // Simulate a half-fanned/ahead active step: activate step[1] while step[0] is
  // still pending → resume reverts the ahead step and re-fronts step[0].
  p.steps[0].status = 'pending';
  p.steps[1].status = 'active';
  e.resumeProject(p.id);
  assert.equal(p.steps[1].status, 'pending', 'the ahead active step is demoted — unsafe if it was in flight');
  assert.equal(p.steps[0].status, 'active', 'frontier reset to the first pending step');
  clearTimeout((e as any).saveDebounceTimer);
});

test('#7 the four mutation routes guard on isDriving (409 while driving)', () => {
  const routesPath = fileURLToPath(new URL('../../gateway/src/api/routes/projects.routes.ts', import.meta.url));
  const src = readFileSync(routesPath, 'utf-8');
  // Each mutation route registration is followed shortly by an isDriving guard.
  const routes = [
    "app.post('/api/projects/:id/steps/:stepId/retry'",
    "app.post('/api/projects/:id/restart'",
    "app.post('/api/projects/:id/skip/:stepId'",
    "app.post('/api/projects/:id/resume'",
  ];
  for (const marker of routes) {
    const idx = src.indexOf(marker);
    assert.notEqual(idx, -1, `route not found: ${marker}`);
    const window = src.slice(idx, idx + 900);
    assert.match(window, /engine\.isDriving\(/, `missing isDriving guard on ${marker}`);
  }
});
