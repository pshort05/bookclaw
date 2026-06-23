import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStructureRail } from '../../gateway/src/services/format-guide.js';

test('appends the rail to the first outline/planning step only', () => {
  const steps = [
    { prompt: 'Plan the outline.', phase: 'outline' },
    { prompt: 'Write chapter 1.', phase: 'production' },
    { prompt: 'Another outline pass.', phase: 'outline' },
  ];
  applyStructureRail(steps, 'STRUCTURE RAIL TEXT');
  assert.match(steps[0].prompt, /STRUCTURE RAIL TEXT/);
  assert.doesNotMatch(steps[1].prompt, /STRUCTURE RAIL TEXT/);
  assert.doesNotMatch(steps[2].prompt, /STRUCTURE RAIL TEXT/); // only the first
});

test('no outline step → falls back to the first step; empty rail is a no-op', () => {
  const s1 = [{ prompt: 'Do a thing.', phase: 'production' }];
  applyStructureRail(s1, 'RAIL');
  assert.match(s1[0].prompt, /RAIL/);
  const s2 = [{ prompt: 'unchanged', phase: 'outline' }];
  applyStructureRail(s2, '');
  assert.equal(s2[0].prompt, 'unchanged');
});
