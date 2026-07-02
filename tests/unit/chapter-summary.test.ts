/**
 * Unit tests for chapterSummaryTarget (bug-review finding #17): summaries must be
 * numbered by the step's own chapterNumber and canonical write/polish passes of
 * the same chapter must share a summary id so polish replaces write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterSummaryTarget } from '../../gateway/src/util/chapter-summary.js';

// A book-production project: write-1, polish-1, write-2, polish-2, ... each step
// carries its real chapterNumber.
const project = {
  id: 'proj-1',
  steps: [
    { id: 'proj-1-step-1', status: 'completed' }, // Write Ch1
    { id: 'proj-1-step-2', status: 'completed' }, // Polish Ch1
    { id: 'proj-1-step-3', status: 'completed' }, // Write Ch2
    { id: 'proj-1-step-4', status: 'active' },     // Polish Ch2 (current)
  ],
};

test('canonical chapter uses the step chapterNumber, not the completed-step count', () => {
  // Polish Chapter 2 is the current step. The old count heuristic would call it
  // chapter 4 (3 completed + 1); the real chapter number is 2.
  const r = chapterSummaryTarget(project, { id: 'proj-1-step-4', chapterNumber: 2 }, true);
  assert.equal(r.chapterNum, 2);
});

test('write and polish of the same chapter share a summary id (polish replaces write)', () => {
  const write = chapterSummaryTarget(project, { id: 'proj-1-step-1', chapterNumber: 1 }, true);
  const polish = chapterSummaryTarget(project, { id: 'proj-1-step-2', chapterNumber: 1 }, true);
  assert.equal(write.summaryId, polish.summaryId, 'same chapter → same summary id');
  assert.equal(write.summaryId, 'proj-1-chapter-1');
});

test('a non-canonical step (bible) keeps its unique step id and the count heuristic', () => {
  const bibleProject = {
    id: 'proj-2',
    steps: [
      { id: 'proj-2-step-1', status: 'completed' },
      { id: 'proj-2-step-2', status: 'active' },
    ],
  };
  const r = chapterSummaryTarget(bibleProject, { id: 'proj-2-step-2' }, false);
  assert.equal(r.summaryId, 'proj-2-step-2', 'bible step keeps its own id');
  assert.equal(r.chapterNum, 2, 'falls back to completed-count + 1 when no chapterNumber');
});
