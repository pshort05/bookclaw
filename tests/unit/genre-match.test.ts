/**
 * Unit tests for matchGenre — the genre-name resolver used by the /genre command
 * (dashboard + Telegram). Library genre names are hyphenated slugs (e.g.
 * "dark-romance"), but chat users type free text ("dark romance", "Dark Romance").
 * The resolver normalizes separators/case: exact wins, then a normalized exact
 * name, then a unique normalized substring; multiple substrings are ambiguous so
 * the caller can show candidates instead of guessing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchGenre } from '../../gateway/src/services/genre-match.js';

const GENRES = ['romance', 'dark-romance', 'sports-romance', 'dark-fantasy', 'epic-fantasy'];

test('an exact slug matches', () => {
  assert.deepEqual(matchGenre(GENRES, 'dark-fantasy'), { kind: 'match', name: 'dark-fantasy' });
});

test('space-separated input matches a hyphenated slug', () => {
  assert.deepEqual(matchGenre(GENRES, 'dark fantasy'), { kind: 'match', name: 'dark-fantasy' });
});

test('mixed-case, space-separated input matches', () => {
  assert.deepEqual(matchGenre(GENRES, 'Dark Fantasy'), { kind: 'match', name: 'dark-fantasy' });
});

test('a normalized exact name beats substring matches', () => {
  // "romance" is a substring of three slugs, but normalizes to exactly "romance".
  assert.deepEqual(matchGenre(GENRES, 'romance'), { kind: 'match', name: 'romance' });
});

test('a unique normalized substring matches', () => {
  assert.deepEqual(matchGenre(GENRES, 'sports'), { kind: 'match', name: 'sports-romance' });
});

test('surrounding whitespace is trimmed before matching', () => {
  assert.deepEqual(matchGenre(GENRES, '  epic fantasy  '), { kind: 'match', name: 'epic-fantasy' });
});

test('multiple substring matches are reported as ambiguous with candidates', () => {
  const r = matchGenre(GENRES, 'dark');
  assert.equal(r.kind, 'ambiguous');
  assert.deepEqual(r.kind === 'ambiguous' ? r.candidates : [], ['dark-romance', 'dark-fantasy']);
});

test('no match returns kind none', () => {
  assert.deepEqual(matchGenre(GENRES, 'thriller'), { kind: 'none' });
});

test('an empty/whitespace query returns kind none', () => {
  assert.deepEqual(matchGenre(GENRES, '   '), { kind: 'none' });
});
