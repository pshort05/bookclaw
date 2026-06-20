/**
 * Unit tests for ProjectStep.modelOverride copying (Task 3 of per-step model pinning).
 *
 * Asserts that createProjectFromPipeline copies modelOverride (incl. temperature)
 * from a resolved step into the ProjectStep at projects.ts:656.
 *
 * Run: node --import tsx --test tests/unit/project-step-modeloverride.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

function makeEngine(): ProjectEngine {
  return new ProjectEngine(undefined, join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
}

const PIPELINE_WITH_OVERRIDE = {
  schemaVersion: 1,
  name: 'book-planning',
  label: 'Book Planning',
  description: 'Plan a book',
  dynamic: false,
  steps: [
    {
      label: 'Pinned Step',
      taskType: 'creative_writing',
      promptTemplate: 'Write {{title}}.',
      modelOverride: { provider: 'openrouter', model: 'x-ai/grok-4', temperature: 1.1 },
    },
    {
      label: 'Unpinned Step',
      taskType: 'general',
      promptTemplate: 'Summarize {{title}}.',
    },
  ],
} as const;

test('createProjectFromPipeline copies modelOverride (incl. temperature) into ProjectStep', () => {
  const e = makeEngine();
  const project = e.createProjectFromPipeline(
    PIPELINE_WITH_OVERRIDE as any,
    'My Novel',
    'A great story',
    {},
  );
  assert.equal(project.steps.length, 2);
  assert.deepEqual(project.steps[0].modelOverride, { provider: 'openrouter', model: 'x-ai/grok-4', temperature: 1.1 });
  clearTimeout((e as any).saveDebounceTimer);
});

test('createProjectFromPipeline leaves modelOverride undefined on unpinned steps (backward compat)', () => {
  const e = makeEngine();
  const project = e.createProjectFromPipeline(
    PIPELINE_WITH_OVERRIDE as any,
    'My Novel',
    'A great story',
    {},
  );
  assert.equal(project.steps[1].modelOverride, undefined);
  clearTimeout((e as any).saveDebounceTimer);
});
