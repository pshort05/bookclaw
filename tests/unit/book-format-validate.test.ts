import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookFormat } from '../../gateway/src/services/format-input.js';
import { StoryStructureService } from '../../gateway/src/services/story-structures.js';

const svc = new StoryStructureService();

test('absent format inputs → no format, no error', () => {
  assert.deepEqual(buildBookFormat({}, svc), {});
});

test('valid inputs → format block with computed total', () => {
  const r = buildBookFormat({ structure: 'four_act', form: 'novella', chapterCount: 20, wordsPerChapter: 1500 }, svc);
  assert.equal(r.error, undefined);
  assert.equal(r.format?.formId, 'novella');
  assert.equal(r.format?.totalTarget, 30000);
});

test('out-of-band total → error (hard block)', () => {
  const r = buildBookFormat({ structure: 'three_act', form: 'short-story', chapterCount: 24, wordsPerChapter: 100000 }, svc);
  assert.match(r.error!, /Short Story/);
  assert.equal(r.format, undefined);
});

test('custom structure carried through; unknown structure/form → error', () => {
  const custom = { id: 'custom', name: 'Four Summers', beats: [{ name: 'Summer One', expectedPct: 12, pctRange: [0, 25], description: '', keywords: [], mustHave: true }] };
  const r = buildBookFormat({ structure: 'custom', customStructure: custom, form: 'novel', chapterCount: 30, wordsPerChapter: 2000 }, svc);
  assert.equal(r.format?.structureId, 'custom');
  assert.equal((r.format?.customStructure as any).name, 'Four Summers');
  assert.match(buildBookFormat({ structure: 'nope', form: 'novel', chapterCount: 30, wordsPerChapter: 2000 }, svc).error!, /structure/i);
  assert.match(buildBookFormat({ structure: 'three_act', form: 'nope', chapterCount: 30, wordsPerChapter: 2000 }, svc).error!, /form/i);
});
