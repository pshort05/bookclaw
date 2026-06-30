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
import { nextBookPhaseAfter, pipelineNameForPhase } from '../../gateway/src/services/book-types.js';

const SEQ = ['book-planning', 'book-bible', 'book-production', 'deep-revision', 'format-export', 'book-launch'];

test('pipelineNameForPhase maps the book phase to its sequence pipeline (the Write-view fix)', () => {
  // A book in the bible phase must surface the book-bible pipeline, not book-planning.
  assert.equal(pipelineNameForPhase('bible', SEQ), 'book-bible');
  assert.equal(pipelineNameForPhase('planning', SEQ), 'book-planning');
  assert.equal(pipelineNameForPhase('production', SEQ), 'book-production');
  assert.equal(pipelineNameForPhase('launch', SEQ), 'book-launch');
});

test('pipelineNameForPhase returns null for unknown/empty phase or empty sequence (caller falls back to [0])', () => {
  assert.equal(pipelineNameForPhase('nope', SEQ), null);
  assert.equal(pipelineNameForPhase(undefined, SEQ), null);
  assert.equal(pipelineNameForPhase('bible', []), null);
});

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
