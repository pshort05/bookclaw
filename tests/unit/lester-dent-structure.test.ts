import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoryStructureService } from '../../gateway/src/services/story-structures.js';

const svc = new StoryStructureService();

test('lester_dent is in the catalog with ordered quarter beats + a final snapper', () => {
  const s = svc.get('lester_dent' as any);
  assert.ok(s, 'lester_dent present');
  assert.ok(s!.beats.length >= 8, 'has the four quarters + their twists');
  // Beats are ordered by expected position.
  const pcts = s!.beats.map(b => b.expectedPct);
  assert.deepEqual(pcts, [...pcts].sort((a, b) => a - b), 'beats ordered by expectedPct');
  // The final beat is the end-of-story snapper twist.
  const last = s!.beats[s!.beats.length - 1];
  assert.ok(last.expectedPct >= 92, 'final twist sits at the very end');
  assert.match(s!.name, /Dent/);
});
