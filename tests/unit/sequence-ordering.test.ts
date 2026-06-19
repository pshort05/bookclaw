/**
 * Unit tests for the autonomous-mode sequence phase-ordering gate.
 *
 * A multi-pipeline book sequence creates N chained Projects up-front: phase 1 is
 * started (active), phases 2..N are left pending. The autonomous heartbeat selects
 * work over (active||pending) && stepsRemaining>0 with no pipeline awareness, so it
 * could run a later sequence phase before an earlier one completes.
 *
 * ProjectEngine.sequencePredecessorsComplete(project) is the single readiness rule
 * (reused by advancePipeline): a pipeline phase is runnable only once every earlier
 * phase in its pipeline has completed; non-pipeline projects are always runnable.
 * The heartbeat adapter uses it to drop blocked pending phases before scoring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import type { LibraryPipeline } from '../../gateway/src/services/library-types.js';

function engine(): ProjectEngine {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-seqorder-'));
  return new ProjectEngine(undefined, root);
}

const tinyPipeline = (name: string): LibraryPipeline => ({
  schemaVersion: 1,
  name,
  label: name,
  steps: [{ label: 's', taskType: 'general', promptTemplate: 'x' }],
});

function makeSequence(eng: ProjectEngine) {
  const snapshots: Record<string, LibraryPipeline> = {
    p1: tinyPipeline('p1'),
    p2: tinyPipeline('p2'),
    p3: tinyPipeline('p3'),
  };
  return eng.createBookSequence(
    { slug: 'b', pipelineSequence: ['p1', 'p2', 'p3'] },
    'T',
    'D',
    { bookSlug: 'b' },
    (n) => snapshots[n] ?? null,
  );
}

// Complete every step of a project so it transitions to 'completed'.
function completeProject(eng: ProjectEngine, projectId: string) {
  eng.startProject(projectId);
  let guard = 0;
  while (guard++ < 50) {
    const p = eng.getProject(projectId)!;
    const active = p.steps.find((s) => s.status === 'active');
    if (!active) break;
    eng.completeStep(projectId, active.id, 'result');
  }
}

test('a non-pipeline project is always runnable', () => {
  const eng = engine();
  const p = eng.createProject('solo', 'Solo', 'D');
  assert.equal(eng.sequencePredecessorsComplete(p), true);
});

test('phase 1 (no predecessors) is runnable', () => {
  const eng = engine();
  const { projects } = makeSequence(eng);
  assert.equal(eng.sequencePredecessorsComplete(eng.getProject(projects[0].id)!), true);
});

test('a later phase is blocked while an earlier phase is still active', () => {
  const eng = engine();
  const { projects } = makeSequence(eng);
  eng.startProject(projects[0].id); // phase 1 active, not completed
  assert.equal(eng.sequencePredecessorsComplete(eng.getProject(projects[1].id)!), false);
  assert.equal(eng.sequencePredecessorsComplete(eng.getProject(projects[2].id)!), false);
});

test('a later phase is blocked while an earlier phase is still pending', () => {
  const eng = engine();
  const { projects } = makeSequence(eng);
  // Nothing started: phase 1 is pending (createBookSequence starts phase 1, so
  // force it back to pending to model the gap before its first step runs).
  const p1 = eng.getProject(projects[0].id)!;
  p1.status = 'pending';
  assert.equal(eng.sequencePredecessorsComplete(eng.getProject(projects[1].id)!), false);
});

test('a later phase becomes runnable once its predecessor completes', () => {
  const eng = engine();
  const { projects } = makeSequence(eng);
  completeProject(eng, projects[0].id);
  assert.equal(eng.getProject(projects[0].id)!.status, 'completed');
  assert.equal(eng.sequencePredecessorsComplete(eng.getProject(projects[1].id)!), true);
  // Phase 3 is still blocked behind phase 2.
  assert.equal(eng.sequencePredecessorsComplete(eng.getProject(projects[2].id)!), false);
});

test('a failed predecessor keeps later phases blocked (sequence halts visibly)', () => {
  const eng = engine();
  const { projects } = makeSequence(eng);
  const p1 = eng.getProject(projects[0].id)!;
  p1.status = 'failed';
  assert.equal(eng.sequencePredecessorsComplete(eng.getProject(projects[1].id)!), false);
});

test('only phase 1 of a fresh sequence is selectable by the heartbeat filter', () => {
  const eng = engine();
  const { projects } = makeSequence(eng);
  // Mirror the heartbeat adapter: surface only runnable work (active, or a
  // pending phase whose predecessors are complete).
  const runnable = eng.listProjects().filter(
    (g) => g.status !== 'pending' || eng.sequencePredecessorsComplete(g),
  );
  const ids = runnable.map((g) => g.id);
  assert.ok(ids.includes(projects[0].id), 'phase 1 is selectable');
  assert.ok(!ids.includes(projects[1].id), 'phase 2 is not selectable');
  assert.ok(!ids.includes(projects[2].id), 'phase 3 is not selectable');
});
