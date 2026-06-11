import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hhmmss, money } from '../../frontend/shared/src/format.js';

test('hhmmss formats local time to HH:MM:SS', () => {
  // 2026-06-11T14:32:09 local — build from parts so the test is timezone-stable.
  const d = new Date(2026, 5, 11, 14, 32, 9);
  assert.equal(hhmmss(d.toISOString()), '14:32:09');
});

test('hhmmss pads single digits', () => {
  const d = new Date(2026, 5, 11, 4, 5, 6);
  assert.equal(hhmmss(d.toISOString()), '04:05:06');
});

test('hhmmss returns empty string for an invalid date', () => {
  assert.equal(hhmmss('not-a-date'), '');
});

test('money renders four decimal places with a leading $', () => {
  assert.equal(money(0), '$0.0000');
  assert.equal(money(0.0001), '$0.0001');
  assert.equal(money(0.012345), '$0.0123');
  assert.equal(money(5), '$5.0000');
});
