/**
 * Unit tests for pipelinePhases (TODO #15): derive a pipeline's ordered, distinct
 * phase list so the board can render N segments from the book's actual pipeline
 * instead of a hardcoded 6-phase lifecycle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipelinePhases, NOVEL_PIPELINE_PHASES } from '../../gateway/src/services/library-types.js';
import type { LibraryPipeline } from '../../gateway/src/services/library-types.js';

const pipeline = (over: Partial<LibraryPipeline>): LibraryPipeline => ({
  schemaVersion: 1, name: 'p', label: 'P', description: 'd', steps: [], ...over,
});

test('static phase-tagged pipeline → ordered distinct step phases', () => {
  const p = pipeline({ steps: [
    { label: 'a', taskType: 'general', promptTemplate: '', phase: 'planning' },
    { label: 'b', taskType: 'general', promptTemplate: '', phase: 'bible' },
    { label: 'c', taskType: 'general', promptTemplate: '', phase: 'bible' },
    { label: 'd', taskType: 'general', promptTemplate: '', phase: 'production' },
  ] });
  assert.deepEqual(pipelinePhases(p), ['planning', 'bible', 'production']);
});

test('dynamic novel-pipeline → the canonical NOVEL_PIPELINE_PHASES (steps are empty at rest)', () => {
  const p = pipeline({ name: 'novel-pipeline', dynamic: true, steps: [] });
  assert.deepEqual(pipelinePhases(p), NOVEL_PIPELINE_PHASES);
  assert.deepEqual(NOVEL_PIPELINE_PHASES, ['premise', 'bible', 'outline', 'writing', 'revision', 'assembly']);
});

test('no-phase built-in pipeline → single segment named after its lifecycle stage', () => {
  const p = pipeline({ name: 'book-planning', steps: [
    { label: 'a', taskType: 'general', promptTemplate: '' },
    { label: 'b', taskType: 'general', promptTemplate: '' },
  ] });
  assert.deepEqual(pipelinePhases(p), ['planning']);
});

test('no-phase pipeline without a book- prefix → single segment of its own name', () => {
  const p = pipeline({ name: 'custom', steps: [{ label: 'a', taskType: 'general', promptTemplate: '' }] });
  assert.deepEqual(pipelinePhases(p), ['custom']);
});

test('descends into parallel groups so grouped phases still appear as segments', () => {
  const p = pipeline({ name: 'romantasy-planning', steps: [
    { parallel: [
      { label: 'g1', taskType: 'creative_writing', promptTemplate: '', phase: 'ideation' },
      { label: 'g2', taskType: 'creative_writing', promptTemplate: '', phase: 'ideation' },
    ] },
    { parallel: [
      { label: 'e1', taskType: 'revision', promptTemplate: '', phase: 'selection' },
    ] },
    { label: 'join', taskType: 'final_edit', promptTemplate: '', phase: 'selection' },
    { label: 'wb', taskType: 'book_bible', promptTemplate: '', phase: 'worldbuilding' },
  ] as any });
  assert.deepEqual(pipelinePhases(p), ['ideation', 'selection', 'worldbuilding']);
});
