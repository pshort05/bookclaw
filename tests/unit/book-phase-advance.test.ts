/**
 * Regression: a book bound to a 6-phase pipeline must advance its manifest
 * `phase` when each phase-project COMPLETES. Previously only the project chain
 * advanced (advancePipeline) while book.json `phase` stuck at 'planning' — so
 * the board showed Planning still running and the Write view offered "Market &
 * genre analysis" as the next step even after the Planning project finished.
 *
 * nextBookPhaseAfter(completedProjectType) returns the lifecycle phase the book
 * should move to when a phase-project of that type completes (the NEXT segment).
 *
 * Run: node --import tsx --test tests/unit/book-phase-advance.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextBookPhaseAfter } from '../../gateway/src/services/book-types.js';

test('completing Planning advances the book to bible', () => {
  assert.equal(nextBookPhaseAfter('book-planning'), 'bible');
});

test('completing Bible advances the book to production', () => {
  assert.equal(nextBookPhaseAfter('book-bible'), 'production');
});

test('completing Production advances the book to revision', () => {
  assert.equal(nextBookPhaseAfter('book-production'), 'revision');
});

test('completing Deep Revision advances the book to format', () => {
  assert.equal(nextBookPhaseAfter('deep-revision'), 'format');
});

test('completing Format & Export advances the book to launch', () => {
  assert.equal(nextBookPhaseAfter('format-export'), 'launch');
});

test('completing Book Launch clamps at launch (no phase past the last)', () => {
  assert.equal(nextBookPhaseAfter('book-launch'), 'launch');
});

test('non-pipeline project types return null so the hook no-ops', () => {
  assert.equal(nextBookPhaseAfter('custom'), null);
  assert.equal(nextBookPhaseAfter('novel-pipeline'), null);
  assert.equal(nextBookPhaseAfter(undefined), null);
  assert.equal(nextBookPhaseAfter('not-a-type'), null);
});
