import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookCards } from '../../gateway/src/services/book-card.js';
import type { BookSummary, NextStep } from '../../gateway/src/services/book-types.js';

const sum = (slug: string, phase = 'production'): BookSummary => ({
  slug, title: slug, phase, schemaVersion: 1, status: 'ok', createdAt: '2026-06-11T00:00:00.000Z',
});
const next = (slug: string): NextStep => ({ phase: 'production', hasOutput: true, label: 'Continue drafting', hint: '7 of 20' });
const phasesFn = (_slug: string): string[] => ['planning', 'bible', 'production', 'revision'];

test('attaches next for every book and live=null when no active project', () => {
  const cards = buildBookCards([sum('a'), sum('b')], next, [], phasesFn);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].next, next('a'));
  assert.equal(cards[0].live, null);
  assert.equal(cards[1].live, null);
});

test('attaches the pipeline phase list to every card', () => {
  const cards = buildBookCards([sum('a')], next, [], phasesFn);
  assert.deepEqual(cards[0].phases, ['planning', 'bible', 'production', 'revision']);
});

test('derives live from an active project bound to the book', () => {
  const active = [{ bookSlug: 'a', progress: 35, steps: [
    { label: 'Outline', status: 'completed' },
    { label: 'Draft chapter 7', status: 'active' },
  ] }];
  const cards = buildBookCards([sum('a'), sum('b')], next, active, phasesFn);
  assert.deepEqual(cards[0].live, { stepLabel: 'Draft chapter 7', progress: 35 });
  assert.equal(cards[1].live, null);
});

test('live falls back to the last step label when none is active', () => {
  const active = [{ bookSlug: 'a', progress: 90, steps: [{ label: 'Compile', status: 'completed' }] }];
  const cards = buildBookCards([sum('a')], next, active, phasesFn);
  assert.deepEqual(cards[0].live, { stepLabel: 'Compile', progress: 90 });
});

test('first active project wins when two are bound to the same book', () => {
  const active = [
    { bookSlug: 'a', progress: 10, steps: [{ label: 'First', status: 'active' }] },
    { bookSlug: 'a', progress: 80, steps: [{ label: 'Second', status: 'active' }] },
  ];
  const cards = buildBookCards([sum('a')], next, active, phasesFn);
  assert.equal(cards[0].live?.stepLabel, 'First');
});

test('overrides the manifest phase with the active step phase while in-flight', () => {
  // Manifest says planning (frozen), but the live active step is in bible.
  const active = [{ bookSlug: 'a', progress: 25, steps: [
    { label: 'Premise', status: 'completed', phase: 'planning' },
    { label: 'Story bible', status: 'active', phase: 'bible' },
  ] }];
  const cards = buildBookCards([sum('a', 'planning')], next, active, phasesFn);
  assert.equal(cards[0].phase, 'bible');
});

test('does not override with a live phase outside the book pipeline phase list (clamps to manifest)', () => {
  // 'polish' is a book-production sub-phase not present in this book's segment list;
  // the chip must stay on the containing segment, never leave card.phases.
  const active = [{ bookSlug: 'a', progress: 60, steps: [
    { label: 'Write chapter 8', status: 'completed', phase: 'production' },
    { label: 'Polish chapter 3', status: 'active', phase: 'polish' },
  ] }];
  const cards = buildBookCards([sum('a', 'production')], next, active, phasesFn);
  assert.equal(cards[0].phase, 'production');
  assert.ok(cards[0].phases.indexOf(cards[0].phase) >= 0, 'card.phase is always a member of card.phases');
});

test('still overrides freely when the book has no resolvable phase list (phases empty)', () => {
  const active = [{ bookSlug: 'a', progress: 60, steps: [{ label: 'x', status: 'active', phase: 'polish' }] }];
  const cards = buildBookCards([sum('a', 'production')], next, active, () => []);
  assert.equal(cards[0].phase, 'polish');
});

test('uses the last step phase (frontier) when the project has no active step', () => {
  const active = [{ bookSlug: 'a', progress: 100, steps: [
    { label: 'Revise', status: 'completed', phase: 'revision' },
  ] }];
  const cards = buildBookCards([sum('a', 'planning')], next, active, phasesFn);
  assert.equal(cards[0].phase, 'revision');
});

test('keeps the manifest phase when there is no live project (or its step carries no phase)', () => {
  const cards = buildBookCards([sum('a', 'production')], next, [], phasesFn);
  assert.equal(cards[0].phase, 'production');
  const active = [{ bookSlug: 'a', progress: 10, steps: [{ label: 'x', status: 'active' }] }];
  const cards2 = buildBookCards([sum('a', 'production')], next, active, phasesFn);
  assert.equal(cards2[0].phase, 'production');
});
