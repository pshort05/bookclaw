/**
 * Unit tests for the Conductor engine's pure dependency derivation
 * (`deriveDependencies`). Synthetic step lists only — no engine, no AI,
 * no filesystem. See gateway/src/services/pipeline/derive-deps.ts for the
 * rules (a)-(d) this exercises.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveDependencies } from '../../gateway/src/services/pipeline/derive-deps.js';
import type { ProjectStep } from '../../gateway/src/services/projects.js';

function step(id: string, overrides: Partial<ProjectStep> = {}): ProjectStep {
  return {
    id,
    label: overrides.label ?? id,
    taskType: 'general',
    prompt: 'p',
    status: 'pending',
    ...overrides,
  };
}

test('rule (a): chapter write steps chain sequentially by chapter number', () => {
  const steps: ProjectStep[] = [
    step('outline', { label: 'Chapter outline', phase: 'outline' }),
    step('ch1', { label: 'Write Chapter 1', phase: 'writing', skill: 'write', chapterNumber: 1 }),
    step('ch2', { label: 'Write Chapter 2', phase: 'writing', skill: 'write', chapterNumber: 2 }),
    step('ch3', { label: 'Write Chapter 3', phase: 'writing', skill: 'write', chapterNumber: 3 }),
  ];

  deriveDependencies(steps);

  // First chapter has no prior write step -> sequential fallback to its
  // immediately-preceding step (the outline).
  assert.deepEqual(steps[1].dependsOn, ['outline']);
  assert.deepEqual(steps[2].dependsOn, ['ch1']);
  assert.deepEqual(steps[3].dependsOn, ['ch2']);
});

test('rule (b): a review/polish step depends only on its own write step', () => {
  const steps: ProjectStep[] = [
    step('ch1', { label: 'Write Chapter 1', phase: 'writing', skill: 'write', chapterNumber: 1 }),
    step('ch2', { label: 'Write Chapter 2', phase: 'writing', skill: 'write', chapterNumber: 2 }),
    step('polish1', { label: 'Polish Chapter 1', phase: 'polish', skill: 'revise', chapterNumber: 1 }),
  ];

  deriveDependencies(steps);

  // polish1 depends only on ch1 (its own chapter), not on ch2 which
  // immediately precedes it in step order.
  assert.deepEqual(steps[2].dependsOn, ['ch1']);
});

test('rule (c): a plain step depends on the immediately preceding step', () => {
  const steps: ProjectStep[] = [
    step('premise', { label: 'Develop premise', phase: 'premise' }),
    step('bible', { label: 'Protagonist profile', phase: 'bible' }),
    step('outline', { label: 'Chapter outline', phase: 'outline' }),
  ];

  deriveDependencies(steps);

  assert.deepEqual(steps[0].dependsOn, []);
  assert.deepEqual(steps[1].dependsOn, ['premise']);
  assert.deepEqual(steps[2].dependsOn, ['bible']);
});

test('rule (d): a terminal/compile step depends on all upstream writing+review steps', () => {
  const steps: ProjectStep[] = [
    step('outline', { label: 'Chapter outline', phase: 'outline' }),
    step('ch1', { label: 'Write Chapter 1', phase: 'writing', skill: 'write', chapterNumber: 1 }),
    step('polish1', { label: 'Polish Chapter 1', phase: 'polish', skill: 'revise', chapterNumber: 1 }),
    step('ch2', { label: 'Write Chapter 2', phase: 'writing', skill: 'write', chapterNumber: 2 }),
    step('polish2', { label: 'Polish Chapter 2', phase: 'polish', skill: 'revise', chapterNumber: 2 }),
    step('compile', { label: 'Compile manuscript', phase: 'assembly' }),
  ];

  deriveDependencies(steps);

  const compile = steps.find(s => s.id === 'compile')!;
  assert.deepEqual(compile.dependsOn, ['ch1', 'polish1', 'ch2', 'polish2']);
});

test('terminal detection also matches label prefixes without a phase marker', () => {
  const steps: ProjectStep[] = [
    step('ch1', { label: 'Write Chapter 1', phase: 'writing', skill: 'write', chapterNumber: 1 }),
    step('assemble', { label: 'Assemble manuscript & report' }),
  ];

  deriveDependencies(steps);

  assert.deepEqual(steps[1].dependsOn, ['ch1']);
});

test('empty input is a no-op', () => {
  const steps: ProjectStep[] = [];
  assert.doesNotThrow(() => deriveDependencies(steps));
  assert.deepEqual(steps, []);
});
