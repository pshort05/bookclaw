/**
 * Pure logic for the Guided wizard (frontend/studio/src/lib/guidedSeeds.ts):
 * heat->pipeline selection, the Create gate, and the /api/books payload shape.
 * Run: node --import tsx --test tests/unit/guided-seeds.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pipelineForHeat, guidedCanCreate, buildGuidedCreatePayload, EMPTY_GUIDED_SEEDS,
} from '../../frontend/studio/src/lib/guidedSeeds.js';

test('pipelineForHeat selects the sweet/spicy deterministic pipeline', () => {
  assert.equal(pipelineForHeat('sweet'), 'romance-sweet-deterministic');
  assert.equal(pipelineForHeat('spicy'), 'romance-spicy-deterministic');
});

test('guidedCanCreate requires title, author, voice, and a fully-fit format', () => {
  const base = { title: 'T', author: 'a', voice: 'v', formatOk: true, formatActive: true };
  assert.equal(guidedCanCreate(base), true);
  assert.equal(guidedCanCreate({ ...base, title: '  ' }), false);
  assert.equal(guidedCanCreate({ ...base, author: '' }), false);
  assert.equal(guidedCanCreate({ ...base, voice: '' }), false);
  assert.equal(guidedCanCreate({ ...base, formatActive: false }), false);
  assert.equal(guidedCanCreate({ ...base, formatOk: false }), false);
});

test('buildGuidedCreatePayload assembles the /api/books body for a sweet book', () => {
  const payload = buildGuidedCreatePayload({
    title: ' My Book ', author: 'default', voice: 'default', genre: 'romance',
    seeds: { ...EMPTY_GUIDED_SEEDS, storyArc: 'ARC', characters: 'CHARS', setting: 'SET', heat: 'sweet', councilSelection: 'propose' },
    format: { structure: 'three-act', form: 'novel', chapterCount: 30, wordsPerChapter: 2500 },
  });
  assert.deepEqual(payload, {
    title: 'My Book', author: 'default', voice: 'default', genre: 'romance',
    pipelineSequence: ['romance-sweet-deterministic'],
    storyArc: 'ARC', characters: 'CHARS', setting: 'SET', councilSelection: 'propose',
    structure: 'three-act', form: 'novel', chapterCount: 30, wordsPerChapter: 2500,
  });
});

test('buildGuidedCreatePayload selects the spicy pipeline, nulls an empty genre, and includes customStructure when present', () => {
  const payload = buildGuidedCreatePayload({
    title: 'X', author: 'a', voice: 'v', genre: '',
    seeds: { ...EMPTY_GUIDED_SEEDS, heat: 'spicy' },
    format: { structure: 'custom', customStructure: { id: 'custom', beats: [] }, form: 'novella', chapterCount: 12, wordsPerChapter: 3000 },
  });
  assert.deepEqual(payload.pipelineSequence, ['romance-spicy-deterministic']);
  assert.equal(payload.genre, null);
  assert.deepEqual(payload.customStructure, { id: 'custom', beats: [] });
});
