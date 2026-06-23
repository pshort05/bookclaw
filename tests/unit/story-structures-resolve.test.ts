import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoryStructureService, resolveStructure, type StoryStructure } from '../../gateway/src/services/story-structures.js';

const svc = new StoryStructureService();

test('four_act is in the catalog with ordered beats', () => {
  const s = svc.get('four_act' as any);
  assert.ok(s, 'four_act present');
  assert.ok(s!.beats.length >= 4);
});

test('resolveStructure returns catalog by id and inline custom', () => {
  assert.equal(resolveStructure({ structureId: 'three_act' }, svc)?.id, 'three_act');
  const custom: StoryStructure = {
    id: 'custom' as any, name: 'Four Summers', oneLiner: '', recommendedFor: [], worksLessWellFor: [], why: '',
    beats: [{ name: 'Summer One', expectedPct: 12, pctRange: [0, 25], description: '', keywords: [], mustHave: true }],
  };
  const r = resolveStructure({ structureId: 'custom', customStructure: custom }, svc);
  assert.equal(r?.name, 'Four Summers');
  assert.equal(resolveStructure({ structureId: 'nonsense' }, svc), null);
});
