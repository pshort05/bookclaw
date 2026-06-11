import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookCards } from '../../gateway/src/services/book-card.js';
import type { BookSummary, NextStep } from '../../gateway/src/services/book-types.js';

const sum = (slug: string, phase = 'production'): BookSummary => ({
  slug, title: slug, phase, schemaVersion: 1, status: 'ok', createdAt: '2026-06-11T00:00:00.000Z',
});
const next = (slug: string): NextStep => ({ phase: 'production', hasOutput: true, label: 'Continue drafting', hint: '7 of 20' });

test('attaches next for every book and live=null when no active project', () => {
  const cards = buildBookCards([sum('a'), sum('b')], next, []);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].next, next('a'));
  assert.equal(cards[0].live, null);
  assert.equal(cards[1].live, null);
});

test('derives live from an active project bound to the book', () => {
  const active = [{ bookSlug: 'a', progress: 35, steps: [
    { label: 'Outline', status: 'completed' },
    { label: 'Draft chapter 7', status: 'active' },
  ] }];
  const cards = buildBookCards([sum('a'), sum('b')], next, active);
  assert.deepEqual(cards[0].live, { stepLabel: 'Draft chapter 7', progress: 35 });
  assert.equal(cards[1].live, null);
});

test('live falls back to the last step label when none is active', () => {
  const active = [{ bookSlug: 'a', progress: 90, steps: [{ label: 'Compile', status: 'completed' }] }];
  const cards = buildBookCards([sum('a')], next, active);
  assert.deepEqual(cards[0].live, { stepLabel: 'Compile', progress: 90 });
});

test('first active project wins when two are bound to the same book', () => {
  const active = [
    { bookSlug: 'a', progress: 10, steps: [{ label: 'First', status: 'active' }] },
    { bookSlug: 'a', progress: 80, steps: [{ label: 'Second', status: 'active' }] },
  ];
  const cards = buildBookCards([sum('a')], next, active);
  assert.equal(cards[0].live?.stepLabel, 'First');
});
