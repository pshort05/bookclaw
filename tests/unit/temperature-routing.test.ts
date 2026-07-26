import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRouting, applyBookModelConfig } from '../../gateway/src/api/routes/_shared.js';

test('applyBookModelConfig syncs temperatures onto the project', () => {
  const project: any = {};
  applyBookModelConfig(project, { temperatures: { creative: 0.9, surgical: 0.25 } });
  assert.deepEqual(project.temperatures, { creative: 0.9, surgical: 0.25 });
});

test('a creative-role step resolves the creative temperature', () => {
  const project: any = { genre: 'romance', temperatures: { creative: 0.9, surgical: 0.25 } };
  assert.equal(stepRouting(project, { role: 'draft', taskType: 'creative_writing' }).temperature, 0.9);
});

test('a surgical-role step resolves the surgical temperature (overriding the sheet)', () => {
  const project: any = { genre: 'romance', temperatures: { creative: 0.9, surgical: 0.25 } };
  // romance sheet continuity temp is 0.2; the book surgical knob (0.25) wins
  assert.equal(stepRouting(project, { role: 'continuity', taskType: 'revision' }).temperature, 0.25);
});

test('an untagged surgical step resolves the surgical temperature', () => {
  const project: any = { genre: '__no_sheet__', temperatures: { creative: 0.9, surgical: 0.25 } };
  assert.equal(stepRouting(project, { taskType: 'consistency' }).temperature, 0.25);
});

test('no temperatures on the project → temperature unchanged (regression)', () => {
  const project: any = { genre: 'romance' };
  // romance draft sheet temp is 1
  assert.equal(stepRouting(project, { role: 'draft', taskType: 'creative_writing' }).temperature, 1);
});

test('an explicit per-step modelOverride.temperature still wins', () => {
  const project: any = { genre: 'romance', temperatures: { creative: 0.9, surgical: 0.25 } };
  assert.equal(stepRouting(project, { role: 'draft', taskType: 'creative_writing', modelOverride: { temperature: 0.15 } }).temperature, 0.15);
});
