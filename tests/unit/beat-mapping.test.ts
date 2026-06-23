import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoryStructureService, evaluateBeatMapping } from '../../gateway/src/services/story-structures.js';

const threeAct = new StoryStructureService().get('three_act')!;

test('classifies mapped beats by position vs pctRange', () => {
  const beats = threeAct.beats;
  const first = beats[0].name;                 // early beat (~setup)
  const last = beats[beats.length - 1].name;   // climax/resolution (late)
  const mapping: Record<string, number[]> = {
    [first]: [1],            // chapter 1 of 20 → ~2.5% → in early range
    [last]: [2],             // chapter 2 of 20 → ~7.5% → far too early → misplaced
  };
  const r = evaluateBeatMapping(threeAct, mapping, 20);
  const rf = r.results.find(x => x.beat.name === first)!;
  const rl = r.results.find(x => x.beat.name === last)!;
  assert.equal(rf.status, 'found_in_range');
  assert.equal(rl.status, 'found_misplaced');
  assert.ok(r.beatsMissing >= 1);              // unmapped beats are missing
  assert.equal(r.totalBeats, beats.length);
});
