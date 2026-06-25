import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStructureReport } from '../../gateway/src/services/reports/render-structure.js';
import type { LengthReview } from '../../gateway/src/services/format-review.js';

test('renders per-chapter table, totals, band line + summary (in band)', () => {
  const length: LengthReview = {
    perChapter: [
      { chapter: 'chapter-1', words: 3000, target: 3500, delta: -500 },
      { chapter: 'chapter-2', words: 4000, target: 3500, delta: 500 },
    ],
    totalWords: 7000,
    totalTarget: 7000,
    withinBand: true,
    bandMessage: 'Fits the form band.',
    genreRange: [70000, 120000],
  };
  const out = renderStructureReport({ length, mapping: { 'Opening Image': [1], Midpoint: [2] } });
  assert.match(out.title, /Structure & Length/);
  // Table rows
  assert.match(out.markdown, /chapter-1/);
  assert.match(out.markdown, /3000/);
  assert.match(out.markdown, /3500/);
  assert.match(out.markdown, /chapter-2/);
  assert.match(out.markdown, /4000/);
  // Totals
  assert.match(out.markdown, /7000/);
  // Band line
  assert.match(out.markdown, /in band/i);
  assert.match(out.markdown, /Fits the form band\./);
  // Genre range
  assert.match(out.markdown, /70000/);
  assert.match(out.markdown, /120000/);
  // Mapping
  assert.match(out.markdown, /Opening Image/);
  assert.match(out.markdown, /Midpoint/);
  // Summary
  assert.equal(out.summary, '7000 words, in band');
});

test('renders OUT OF BAND summary when not within band', () => {
  const length: LengthReview = {
    perChapter: [
      { chapter: 'chapter-1', words: 1000, target: 3500, delta: -2500 },
      { chapter: 'chapter-2', words: 1200, target: 3500, delta: -2300 },
    ],
    totalWords: 2200,
    totalTarget: 7000,
    withinBand: false,
    bandMessage: 'Too short for the form.',
    genreRange: null,
  };
  const out = renderStructureReport({ length });
  assert.match(out.markdown, /OUT OF BAND/);
  assert.match(out.markdown, /Too short for the form\./);
  assert.equal(out.summary, '2200 words, OUT OF BAND');
});
