import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoverTypographyService } from '../../gateway/src/services/cover-typography.js';

// The pure layout logic in this service lives in two PRIVATE helpers
// (`wrapTitle`, `fitFontSize`). `apply()` itself is an image/file-IO wrapper
// (reads a PNG, writes an SVG) with no further pure logic worth isolating, so
// we test only the deterministic helpers. Reaching them via an `any` cast is a
// test-only seam — no production change.
const svc = new CoverTypographyService() as any;

// ── wrapTitle ──

test('wrapTitle returns a single-word title as one line', () => {
  assert.deepEqual(svc.wrapTitle('Inferno', 14), ['Inferno']);
});

test('wrapTitle keeps a short multi-word title that fits on one line', () => {
  assert.deepEqual(svc.wrapTitle('Dark Tide', 14), ['Dark Tide']);
});

test('wrapTitle greedily wraps a long title at word boundaries (<= maxCharsPerLine)', () => {
  assert.deepEqual(
    svc.wrapTitle('The Shadow Of The Wind Returns', 14),
    ['The Shadow Of', 'The Wind Returns'],
  );
});

test('wrapTitle rebalances a short title that would otherwise be 3+ lines down to 2', () => {
  // Three 7-char words, none pair within 14 chars => greedy gives 3 lines.
  // Title length 23 < 14*2.2 (30.8) => rebalanced to ceil(3/2)=2 words on line 1.
  assert.deepEqual(
    svc.wrapTitle('bigword bigword bigword', 14),
    ['bigword bigword', 'bigword'],
  );
});

test('wrapTitle keeps many lines for a long title past the rebalance threshold', () => {
  // 5 words, length 39 > 30.8 => no rebalance, greedy lines kept.
  assert.deepEqual(
    svc.wrapTitle('bigword bigword bigword bigword bigword', 14),
    ['bigword', 'bigword', 'bigword', 'bigword', 'bigword'],
  );
});

// ── fitFontSize (stepped heuristic by raw title length) ──

test('fitFontSize returns max size for very short titles (<12 chars)', () => {
  assert.equal(svc.fitFontSize('Short', 0, 0, 92, 180), 180);
});

test('fitFontSize scales to 0.85x for 12-19 char titles', () => {
  assert.equal(svc.fitFontSize('A'.repeat(15), 0, 0, 92, 180), Math.round(180 * 0.85));
});

test('fitFontSize scales to 0.7x for 20-29 char titles', () => {
  assert.equal(svc.fitFontSize('A'.repeat(25), 0, 0, 92, 180), Math.round(180 * 0.7));
});

test('fitFontSize scales to 0.55x for 30-44 char titles', () => {
  assert.equal(svc.fitFontSize('A'.repeat(40), 0, 0, 92, 180), Math.round(180 * 0.55));
});

test('fitFontSize floors at min size for 45+ char titles', () => {
  assert.equal(svc.fitFontSize('A'.repeat(50), 0, 0, 92, 180), 92);
});
