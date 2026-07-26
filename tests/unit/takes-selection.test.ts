import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

function seededProject(engine: ProjectEngine) {
  const project: any = engine.createNovelPipeline('Takes Test', 'A test', { targetChapters: 1 });
  const step = project.steps[0];
  step.status = 'active';
  project.takes = {
    stepId: step.id, role: 'approach',
    candidates: [{ index: 0, text: 'A' }, { index: 1, text: 'B' }],
    config: { k: 2, variant: 'cot', threshold: 0.1 },
    createdAt: new Date().toISOString(),
  };
  return { project, step };
}

test('applyTakeSelection completes the gated step with the chosen take and clears the marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'takes-sel-'));
  try {
    const engine = new ProjectEngine(undefined, root);
    const { project, step } = seededProject(engine);
    assert.equal(engine.applyTakeSelection(project.id, 1), true);
    const after = engine.getProject(project.id)!;
    const s = after.steps.find((x: any) => x.id === step.id);
    assert.equal(s.status, 'completed');
    assert.equal(s.result, 'B');
    assert.equal(after.takes, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('applyTakeSelection returns false for an unknown index and leaves the marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'takes-sel-'));
  try {
    const engine = new ProjectEngine(undefined, root);
    const { project } = seededProject(engine);
    assert.equal(engine.applyTakeSelection(project.id, 9), false);
    assert.ok(engine.getProject(project.id)!.takes, 'marker preserved on bad index');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('applyTakeSelection returns false when no marker is pending', () => {
  const root = mkdtempSync(join(tmpdir(), 'takes-sel-'));
  try {
    const engine = new ProjectEngine(undefined, root);
    const project: any = engine.createNovelPipeline('No Marker', 'x', { targetChapters: 1 });
    assert.equal(engine.applyTakeSelection(project.id, 0), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('clearTakesSelection drops the marker without completing the step', () => {
  const root = mkdtempSync(join(tmpdir(), 'takes-sel-'));
  try {
    const engine = new ProjectEngine(undefined, root);
    const { project, step } = seededProject(engine);
    engine.clearTakesSelection(project.id);
    const after = engine.getProject(project.id)!;
    assert.equal(after.takes, undefined);
    assert.equal(after.steps.find((x: any) => x.id === step.id).status, 'active', 'step not completed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
