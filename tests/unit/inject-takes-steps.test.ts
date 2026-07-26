import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectTakesSteps } from '../../gateway/src/sampling/inject-takes-steps.js';
import type { ResolvedStepInput } from '../../gateway/src/services/pipeline-expand.js';

const steps: ResolvedStepInput[] = [
  { label: 'Scene Brief — Chapter 1', taskType: 'outline', prompt: 'brief', role: 'scene_brief', chapterNumber: 1 },
  { label: 'First Draft — Chapter 1', taskType: 'creative_writing', prompt: 'draft', role: 'draft', chapterNumber: 1 },
  { label: 'Consistency Audit — Chapter 1', taskType: 'revision', prompt: 'audit', role: 'improve', chapterNumber: 1 },
];

test('sceneTakes inserts a vs-enabled approach step before each scene_brief', () => {
  const out = injectTakesSteps(steps, { sceneTakes: true });
  const briefIdx = out.findIndex((s) => s.role === 'scene_brief');
  const before = out[briefIdx - 1];
  assert.equal(before.role, 'approach');
  assert.equal((before as any).vs?.enabled, true);
  assert.equal(before.chapterNumber, 1);
  assert.match(before.label, /Scene Takes — Chapter 1/);
});

test('draftOpening inserts a vs-enabled draft opening step before each draft', () => {
  const out = injectTakesSteps(steps, { draftOpening: true });
  const draftIdx = out.findIndex((s) => s.label === 'First Draft — Chapter 1');
  const before = out[draftIdx - 1];
  assert.equal(before.role, 'draft');
  assert.equal((before as any).vs?.enabled, true);
  assert.equal(before.wordCountTarget, 150);
  assert.match(before.label, /Draft Opening — Chapter 1/);
});

test('both flags inject both; the consistency (improve) step is never targeted', () => {
  const out = injectTakesSteps(steps, { sceneTakes: true, draftOpening: true });
  assert.equal(out.length, 5); // 3 original + 2 injected
  assert.equal(out.filter((s) => (s as any).vs?.enabled).length, 2);
  // the improve step has no injected step before it
  const impIdx = out.findIndex((s) => s.role === 'improve');
  assert.notEqual((out[impIdx - 1] as any).vs?.enabled, true);
});

test('no flags → steps returned unchanged', () => {
  assert.equal(injectTakesSteps(steps, {}), steps);
  assert.deepEqual(injectTakesSteps(steps, { sceneTakes: false, draftOpening: false }), steps);
});
