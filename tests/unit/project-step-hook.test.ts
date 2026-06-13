/**
 * Unit tests for ProjectEngine.onStepCompleted (TODO #15): a per-step callback
 * fired on every step completion with (project, completedStep, next). The init
 * wiring uses it to advance the bound book's manifest phase to
 * `next?.phase ?? completedStep.phase`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

function makeEngine(): ProjectEngine {
  return new ProjectEngine(undefined, join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
}

const PIPELINE = {
  schemaVersion: 1, name: 'book-planning', label: 'P', description: 'd', dynamic: false,
  steps: [
    { label: 'One',   taskType: 'general', promptTemplate: 'a', phase: 'planning' },
    { label: 'Two',   taskType: 'general', promptTemplate: 'b', phase: 'bible' },
    { label: 'Three', taskType: 'general', promptTemplate: 'c', phase: 'production' },
  ],
} as const;

function makeProject(e: ProjectEngine) {
  e.setPipelineResolver((name) => (name === 'book-planning' ? (PIPELINE as any) : null));
  const p = e.createProjectResolved('book-planning' as any, 'My Plan', 'desc', {});
  clearTimeout((e as any).saveDebounceTimer);
  return p;
}

test('onStepCompleted fires per step with the completed step and the next step', () => {
  const e = makeEngine();
  const p = makeProject(e);
  const calls: Array<{ completed?: string; next: string | null }> = [];
  e.onStepCompleted((_proj, completed, next) => {
    calls.push({ completed: completed?.phase, next: next?.phase ?? null });
  });

  e.completeStep(p.id, p.steps[0].id, 'r1');
  e.completeStep(p.id, p.steps[1].id, 'r2');
  e.completeStep(p.id, p.steps[2].id, 'r3');
  clearTimeout((e as any).saveDebounceTimer);

  assert.deepEqual(calls, [
    { completed: 'planning',   next: 'bible' },
    { completed: 'bible',      next: 'production' },
    { completed: 'production', next: null },   // last step: frontier is the completed phase
  ]);
});

test('a throwing step hook never blocks completeStep', () => {
  const e = makeEngine();
  const p = makeProject(e);
  e.onStepCompleted(() => { throw new Error('boom'); });
  const next = e.completeStep(p.id, p.steps[0].id, 'r1');
  clearTimeout((e as any).saveDebounceTimer);
  assert.equal(next?.id, p.steps[1].id, 'completeStep still advanced despite the hook throwing');
});
