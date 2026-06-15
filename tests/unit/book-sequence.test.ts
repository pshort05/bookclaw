/**
 * Unit tests for config-not-code pipelines Task 10: ProjectEngine.createBookSequence
 * chains one Project per entry in a book's pipelineSequence, linked by a shared
 * pipelineId, with phases ordered 1..N and all bound to the book's slug.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import type { LibraryPipeline } from '../../gateway/src/services/library-types.js';

function engine(): ProjectEngine {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-seq-'));
  return new ProjectEngine(undefined, root);
}

const tinyPipeline = (name: string): LibraryPipeline => ({
  schemaVersion: 1,
  name,
  label: name,
  steps: [{ label: 's', taskType: 'general', promptTemplate: 'x' }],
});

test('createBookSequence chains one project per sequence entry with a shared pipelineId', () => {
  const eng = engine();
  const snapshots: Record<string, LibraryPipeline> = {
    p1: tinyPipeline('p1'),
    p2: tinyPipeline('p2'),
  };
  const { pipelineId, projects } = eng.createBookSequence(
    { slug: 'b', pipelineSequence: ['p1', 'p2'] },
    'T',
    'D',
    { bookSlug: 'b' },
    (n) => snapshots[n] ?? null,
  );

  assert.equal(projects.length, 2);
  assert.ok(pipelineId);
  assert.equal(projects[0].pipelineId, pipelineId);
  assert.equal(projects[1].pipelineId, pipelineId);
  assert.equal(projects[0].pipelinePhase, 1);
  assert.equal(projects[1].pipelinePhase, 2);
  assert.equal(projects[0].bookSlug, 'b');
  assert.equal(projects[1].bookSlug, 'b');

  // Only the first project is pending-ready; the rest wait.
  assert.equal(projects[0].status, 'pending');
  const firstStepReady = projects[0].steps.some((s) => s.status === 'pending' || s.status === 'active');
  assert.ok(firstStepReady, 'first project has a runnable step');
});

test('createBookSequence skips unresolved pipeline names (fail-soft)', () => {
  const eng = engine();
  const { projects } = eng.createBookSequence(
    { slug: 'b', pipelineSequence: ['missing', 'p2'] },
    'T',
    'D',
    {},
    (n) => (n === 'p2' ? tinyPipeline('p2') : null),
  );
  assert.equal(projects.length, 1);
  assert.equal(projects[0].type, 'p2');
  // pipelinePhase is numbered by resolved position, so a skipped entry does NOT
  // leave a gap — the single surviving project is phase 1 (contiguous 1..N).
  assert.equal(projects[0].pipelinePhase, 1);
});
