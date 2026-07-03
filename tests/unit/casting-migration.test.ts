import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagPipelineRoles } from '../../scripts/migrate-step-roles.js';

test('tagPipelineRoles tags top-level and nested expand steps, skips already-tagged', () => {
  const pipeline = {
    steps: [
      { label: 'Scene Brief — Chapter 1' },
      { label: 'Already', role: 'editorial' },
      { expand: 'chapters', steps: [
        { label: 'First Draft — Chapter {{n}}' },
        { label: 'Humanize — Chapter {{n}}' },
      ] },
    ],
  };
  const { changed } = tagPipelineRoles(pipeline);
  assert.equal(pipeline.steps[0].role, 'scene_brief');
  assert.equal(pipeline.steps[1].role, 'editorial', 'existing role preserved');
  assert.equal((pipeline.steps[2] as any).steps[0].role, 'draft');
  assert.equal((pipeline.steps[2] as any).steps[1].role, 'humanize');
  assert.equal(changed, 3);
});

test('tagPipelineRoles tags members of a parallel group', () => {
  const pipeline = {
    steps: [
      { parallel: [
        { label: 'First Draft — Chapter 1' },
        { label: 'Improvement Plan — Chapter 1' },
      ] },
    ],
  };
  const { changed } = tagPipelineRoles(pipeline);
  assert.equal((pipeline.steps[0] as any).parallel[0].role, 'draft');
  assert.equal((pipeline.steps[0] as any).parallel[1].role, 'improve');
  assert.equal(changed, 2);
});
