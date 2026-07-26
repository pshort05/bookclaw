import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

// A minimal library pipeline with a scene_brief + draft step, mirroring the
// per-chapter shape of the romance deterministic pipelines.
const PIPELINE: any = {
  schemaVersion: 1, name: 'mini-takes', label: 'Mini', description: 'd',
  steps: [
    { label: 'Scene Brief', taskType: 'outline', role: 'scene_brief', promptTemplate: 'brief' },
    { label: 'First Draft', taskType: 'creative_writing', role: 'draft', promptTemplate: 'draft' },
    { label: 'Consistency Audit', taskType: 'revision', role: 'improve', promptTemplate: 'audit' },
  ],
};

test('createProjectFromPipeline injects a vs-enabled Scene Takes step when the book opts in', () => {
  const root = mkdtempSync(join(tmpdir(), 'takes-wire-'));
  try {
    const engine = new ProjectEngine(undefined, root);
    const project = engine.createProjectFromPipeline(PIPELINE, 'Book', 'desc', { alternateTakes: { sceneTakes: true } });
    const briefIdx = project.steps.findIndex((s: any) => s.role === 'scene_brief');
    const before: any = project.steps[briefIdx - 1];
    assert.equal(before.role, 'approach');
    assert.equal(before.vs?.enabled, true);
    assert.match(before.label, /Scene Takes/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no opt-in → no injected steps (pipeline unchanged)', () => {
  const root = mkdtempSync(join(tmpdir(), 'takes-wire-'));
  try {
    const engine = new ProjectEngine(undefined, root);
    const project = engine.createProjectFromPipeline(PIPELINE, 'Book', 'desc', {});
    assert.equal(project.steps.filter((s: any) => s.vs?.enabled).length, 0);
    assert.equal(project.steps.filter((s: any) => s.role === 'approach').length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('draftOpening opt-in injects a vs-enabled Draft Opening step before draft', () => {
  const root = mkdtempSync(join(tmpdir(), 'takes-wire-'));
  try {
    const engine = new ProjectEngine(undefined, root);
    const project = engine.createProjectFromPipeline(PIPELINE, 'Book', 'desc', { alternateTakes: { draftOpening: true } });
    const draftIdx = project.steps.findIndex((s: any) => s.label === 'First Draft');
    const before: any = project.steps[draftIdx - 1];
    assert.equal(before.role, 'draft');
    assert.equal(before.vs?.enabled, true);
    assert.match(before.label, /Draft Opening/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
