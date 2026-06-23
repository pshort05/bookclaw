import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGenreWordRange, buildLengthReview } from '../../gateway/src/services/format-review.js';
import { getForm } from '../../gateway/src/services/story-forms.js';

test('parseGenreWordRange extracts a band from reader-expectations prose', () => {
  assert.deepEqual(parseGenreWordRange('Standard novel length for this genre is 70,000–120,000 words.'), [70000, 120000]);
  assert.deepEqual(parseGenreWordRange('80,000-110,000 words is standard.'), [80000, 110000]);
  assert.equal(parseGenreWordRange('No numbers here.'), null);
});

test('buildLengthReview computes per-chapter deltas, total, and band fit', () => {
  const form = getForm('novella');
  const r = buildLengthReview({
    chapters: [{ chapter: 'chapter-1', words: 1600 }, { chapter: 'chapter-2', words: 1400 }],
    wordsPerChapter: 1500, overrides: { 'chapter-2': 1200 }, form, genreRange: null,
  });
  assert.equal(r.perChapter[0].target, 1500);
  assert.equal(r.perChapter[0].delta, 100);
  assert.equal(r.perChapter[1].target, 1200);   // override applied
  assert.equal(r.perChapter[1].delta, 200);
  assert.equal(r.totalWords, 3000);
  assert.equal(r.withinBand, false);             // 3000 < novella min 17500
});
