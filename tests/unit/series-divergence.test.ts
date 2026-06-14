/**
 * Series Phase A — divergence detection: compare a book's snapshot refs to the
 * series' current refs by NAME (drives the "series-updated" / pull affordance).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seriesDivergence } from '../../gateway/src/services/series-bible.js';

test('no divergence when names match', () => {
  const refs = { author: { name: 'ada', source: 'builtin' as const }, voice: { name: 'wry', source: 'builtin' as const }, genre: { name: 'fantasy', source: 'builtin' as const } };
  const book = { author: { name: 'ada' }, voice: { name: 'wry' }, genre: { name: 'fantasy' } };
  assert.deepEqual(seriesDivergence(refs, book), []);
});

test('flags a differing author and ignores kinds the series does not set', () => {
  const refs = { author: { name: 'bram', source: 'builtin' as const } };
  const book = { author: { name: 'ada' }, voice: { name: 'wry' } };
  assert.deepEqual(seriesDivergence(refs, book), [{ kind: 'author', series: 'bram', book: 'ada' }]);
});

test('a book missing a series-set kind diverges (book name empty)', () => {
  const refs = { genre: { name: 'fantasy', source: 'builtin' as const } };
  assert.deepEqual(seriesDivergence(refs, {}), [{ kind: 'genre', series: 'fantasy', book: '' }]);
});

test('genre null on the series is treated as unset (no divergence)', () => {
  assert.deepEqual(seriesDivergence({ genre: null }, { genre: { name: 'whatever' } }), []);
});
