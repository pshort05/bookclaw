/**
 * Unit tests for config-not-code pipelines follow-up F1: ProjectEngine.advancePipeline
 * starts the next still-pending phase project in a book sequence, but ONLY once the
 * immediately-preceding phase has completed. It marks the next project active (no AI
 * execution), so a multi-pipeline book progresses across its chained Projects without
 * unattended cost.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import type { LibraryPipeline } from '../../gateway/src/services/library-types.js';

function engine(): ProjectEngine {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-advance-'));
  return new ProjectEngine(undefined, root);
}

const tinyPipeline = (name: string): LibraryPipeline => ({
  schemaVersion: 1,
  name,
  label: name,
  steps: [{ label: 's', taskType: 'general', promptTemplate: 'x' }],
});

function makeSequence(eng: ProjectEngine) {
  const snapshots: Record<string, LibraryPipeline> = {
    p1: tinyPipeline('p1'),
    p2: tinyPipeline('p2'),
    p3: tinyPipeline('p3'),
  };
  return eng.createBookSequence(
    { slug: 'b', pipelineSequence: ['p1', 'p2', 'p3'] },
    'T',
    'D',
    { bookSlug: 'b' },
    (n) => snapshots[n] ?? null,
  );
}

// Complete every step of a project so it transitions to 'completed'.
function completeProject(eng: ProjectEngine, projectId: string) {
  eng.startProject(projectId);
  let guard = 0;
  while (guard++ < 50) {
    const p = eng.getProject(projectId)!;
    const active = p.steps.find((s) => s.status === 'active');
    if (!active) break;
    eng.completeStep(projectId, active.id, 'result');
  }
}

test('advancePipeline is a no-op while the current phase is still running', () => {
  const eng = engine();
  const { pipelineId, projects } = makeSequence(eng);
  eng.startProject(projects[0].id); // phase 1 active, not yet completed

  const advanced = eng.advancePipeline(pipelineId);
  assert.equal(advanced, null, 'must not advance before phase 1 completes');
  assert.equal(eng.getProject(projects[1].id)!.status, 'pending', 'phase 2 stays pending');
});

test('advancePipeline starts the next phase once the prior one completes', () => {
  const eng = engine();
  const { pipelineId, projects } = makeSequence(eng);
  completeProject(eng, projects[0].id);
  assert.equal(eng.getProject(projects[0].id)!.status, 'completed');

  const advanced = eng.advancePipeline(pipelineId);
  assert.ok(advanced, 'returns the started phase-2 project');
  assert.equal(advanced!.id, projects[1].id);
  assert.equal(advanced!.status, 'active', 'phase 2 is now active');
  assert.ok(advanced!.steps.some((s) => s.status === 'active'), 'phase 2 has a runnable active step');
  // Phase 3 must NOT be touched yet.
  assert.equal(eng.getProject(projects[2].id)!.status, 'pending');
});

test('advancePipeline returns null when there is no further pending phase', () => {
  const eng = engine();
  const { pipelineId, projects } = makeSequence(eng);
  completeProject(eng, projects[0].id);
  completeProject(eng, projects[1].id);
  completeProject(eng, projects[2].id);

  assert.equal(eng.advancePipeline(pipelineId), null);
});

test('advancePipeline returns null for an unknown pipelineId', () => {
  const eng = engine();
  makeSequence(eng);
  assert.equal(eng.advancePipeline('pipeline-does-not-exist'), null);
});

// Guards the production wiring (init phase): an onProjectCompleted hook that
// calls advancePipeline makes a sequence auto-progress one phase per completion.
test('an onProjectCompleted hook calling advancePipeline auto-starts the next phase', () => {
  const eng = engine();
  eng.onProjectCompleted((p) => { if (p.pipelineId) eng.advancePipeline(p.pipelineId); });
  const { projects } = makeSequence(eng);

  completeProject(eng, projects[0].id); // completing phase 1 fires the hook
  assert.equal(eng.getProject(projects[1].id)!.status, 'active', 'phase 2 auto-started by the hook');
  assert.equal(eng.getProject(projects[2].id)!.status, 'pending', 'phase 3 untouched');
});
