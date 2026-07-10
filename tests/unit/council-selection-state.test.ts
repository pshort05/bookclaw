/**
 * LLM Council pause-resume engine state (Romance Workflow sub-project 3, Task 2):
 * `Project.selection` + `applyCouncilSelection` / `clearCouncilSelection`. Mirrors
 * tests/unit/gate-actions.test.ts's realEngine() pattern (a real ProjectEngine,
 * not a stub) so completeStep/status transitions are the real ones a driver
 * would observe. Purely additive — no existing run path reads `selection` yet.
 *
 * Run: node --import tsx --test tests/unit/council-selection-state.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

const PIPELINE = { schemaVersion: 1, name: 'romance-sweet-full', label: 'P', description: 'd', dynamic: false, steps: [
  { label: 'Council — Base Story Origination', skill: 'council-origination', taskType: 'book_bible', phase: 'premise', promptTemplate: 'Council.' },
  { label: 'Premise', taskType: 'book_bible', phase: 'premise', promptTemplate: 'Premise.' },
] } as const;

function realEngine(rootDir?: string) {
  const e = new ProjectEngine(undefined, rootDir ?? mkdtempSync(join(tmpdir(), 'bookclaw-council-state-')));
  e.setPipelineResolver(() => (PIPELINE as any));
  return e;
}

function gatedProject() {
  const e = realEngine();
  const p = e.createProjectResolved('book-planning' as any, 'P', 'd', {});
  e.startProject(p.id); // Council step active
  return { e, p };
}

const CANDIDATES = [
  { id: 'c1', model: 'claude', premise: 'Premise 1', relationshipArc: 'Arc 1', text: 'Text for c1' },
  { id: 'c2', model: 'gemini', premise: 'Premise 2', relationshipArc: 'Arc 2', text: 'Text for c2' },
  { id: 'c3', model: 'deepseek', premise: 'Premise 3', relationshipArc: 'Arc 3', text: 'Text for c3' },
];

function withSelection(p: any, recommendedId = 'c1') {
  p.selection = {
    stepId: p.steps[0].id,
    candidates: CANDIDATES,
    ranking: CANDIDATES.map((c, i) => ({ id: c.id, rank: i + 1, rationale: `why ${c.id}` })),
    recommendedId,
    rationale: 'overall rationale',
    createdAt: new Date().toISOString(),
  };
  p.status = 'paused';
}

// ── applyCouncilSelection ───────────────────────────────────────────────────

test('applyCouncilSelection completes the council step with the chosen candidate text and activates the frontier', () => {
  const { e, p } = gatedProject();
  withSelection(p);

  (e as any).applyCouncilSelection(p.id, 'c2');

  assert.equal(p.steps[0].status, 'completed');
  assert.equal(p.steps[0].result, 'Text for c2');
  assert.equal((p as any).selection, undefined, 'selection cleared');
  assert.equal(p.status, 'active');
  assert.equal(p.steps[1].status, 'active', 'premise step is now the active frontier');
  clearTimeout((e as any).saveDebounceTimer);
});

test('applyCouncilSelection with an unknown candidateId falls back to the recommendedId text', () => {
  const { e, p } = gatedProject();
  withSelection(p, 'c3');

  (e as any).applyCouncilSelection(p.id, 'bogus');

  assert.equal(p.steps[0].status, 'completed');
  assert.equal(p.steps[0].result, 'Text for c3');
  assert.equal((p as any).selection, undefined);
  assert.equal(p.status, 'active');
  clearTimeout((e as any).saveDebounceTimer);
});

test('applyCouncilSelection is a no-op when neither the given id nor recommendedId match any candidate', () => {
  const { e, p } = gatedProject();
  withSelection(p, 'does-not-exist');

  (e as any).applyCouncilSelection(p.id, 'also-bogus');

  assert.equal(p.steps[0].status, 'active', 'step untouched');
  assert.ok((p as any).selection, 'selection left in place');
  assert.equal(p.status, 'paused');
  clearTimeout((e as any).saveDebounceTimer);
});

// ── clearCouncilSelection ───────────────────────────────────────────────────

test('clearCouncilSelection removes the marker but leaves the project paused', () => {
  const { e, p } = gatedProject();
  withSelection(p);

  (e as any).clearCouncilSelection(p.id);

  assert.equal((p as any).selection, undefined);
  assert.equal(p.status, 'paused');
  assert.equal(p.steps[0].status, 'active', 'step untouched — abandoned, not resolved');
  clearTimeout((e as any).saveDebounceTimer);
});

// ── persistence round-trip ──────────────────────────────────────────────────

test('project.selection survives a save + reload cycle', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'bookclaw-council-persist-'));
  try {
    const e1 = realEngine(rootDir);
    const p1 = e1.createProjectResolved('book-planning' as any, 'P', 'd', {});
    e1.startProject(p1.id);
    withSelection(p1 as any);
    e1.saveState();

    await delay(1300);

    const stateFile = join(rootDir, 'workspace', '.config', 'projects-state.json');
    assert.ok(existsSync(stateFile), 'state file must exist after flush');

    const e2 = realEngine(rootDir);
    const reloaded = e2.getProject(p1.id) as any;
    assert.ok(reloaded, 'project must be found in the reloaded engine');
    assert.ok(reloaded.selection, 'selection must survive round-trip');
    assert.equal(reloaded.selection.recommendedId, 'c1');
    assert.equal(reloaded.selection.candidates.length, 3);

    clearTimeout((e1 as any).saveDebounceTimer);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
