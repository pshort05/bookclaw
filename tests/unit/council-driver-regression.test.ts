/**
 * LLM Council driver-wiring regression (Romance Workflow sub-project 3, Task 4).
 *
 * PRODUCTION SAFETY FIRST. This drives the exact helper the two drivers call
 * (`maybeRunCouncilStep`) against a REAL ProjectEngine (mirrors
 * council-selection-state.test.ts's realEngine() pattern) and asserts the three
 * safety invariants that keep the live auto-execute path unchanged:
 *   1. A non-council project's active step is NOT handled and the engine is
 *      NOT mutated (proves every existing pipeline — none has a council step —
 *      takes byte-for-byte today's path).
 *   2. A romance-full project on its active council step, councilSelection unset
 *      OR 'auto', runs straight through: council runs, step completes, NOT gated,
 *      project NOT paused (auto is transparent — no gate).
 *   3. Same project with 'propose' → gated, project.selection set, status paused.
 *
 * Run: node --import tsx --test tests/unit/council-driver-regression.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { maybeRunCouncilStep } from '../../gateway/src/services/council-gate.js';

const COUNCIL_RESULT = {
  candidates: [
    { id: 'c1', model: 'claude', premise: 'P1', relationshipArc: 'A1', text: 'Base story c1' },
    { id: 'c2', model: 'gemini', premise: 'P2', relationshipArc: 'A2', text: 'Base story c2' },
    { id: 'c3', model: 'deepseek', premise: 'P3', relationshipArc: 'A3', text: 'Base story c3' },
  ],
  ranking: [
    { id: 'c2', rank: 1, rationale: 'best' },
    { id: 'c1', rank: 2, rationale: 'ok' },
    { id: 'c3', rank: 3, rationale: 'weakest' },
  ],
  recommendedId: 'c2',
  rationale: 'c2 sustains the arc best',
};

const ROMANCE_PIPELINE = { schemaVersion: 1, name: 'romance-sweet-full', label: 'P', description: 'd', dynamic: false, steps: [
  { label: 'Council — Base Story Origination', skill: 'council-origination', taskType: 'book_bible', phase: 'premise', promptTemplate: 'Council.' },
  { label: 'Premise', taskType: 'book_bible', phase: 'premise', promptTemplate: 'Premise.' },
] } as const;

// A normal (non-council) pipeline: no council-origination step anywhere — every
// existing shipped pipeline is shaped like this until Task 5.
const NORMAL_PIPELINE = { schemaVersion: 1, name: 'novel', label: 'P', description: 'd', dynamic: false, steps: [
  { label: 'Outline', taskType: 'outline', phase: 'planning', promptTemplate: 'Outline.' },
  { label: 'Draft', taskType: 'creative_writing', phase: 'production', promptTemplate: 'Draft.' },
] } as const;

function engineFor(pipeline: any) {
  const e = new ProjectEngine(undefined, mkdtempSync(join(tmpdir(), 'bookclaw-council-driver-')));
  e.setPipelineResolver(() => (pipeline as any));
  return e;
}

function fakeCouncil(result: any = COUNCIL_RESULT) {
  const calls: any = { originateCount: 0 };
  return { calls, async originate(seeds: any) { calls.originateCount++; calls.lastSeeds = seeds; return result; } };
}

// ── Invariant 1: non-council project unchanged ───────────────────────────────

test('a non-council project active step is not handled and the engine is not mutated', async () => {
  const e = engineFor(NORMAL_PIPELINE);
  const p = e.createProjectResolved('novel' as any, 'P', 'd', {});
  e.startProject(p.id);
  const activeStep = p.steps.find((s: any) => s.status === 'active');
  const council = fakeCouncil();

  const outcome = await maybeRunCouncilStep({ engine: e as any, council }, p, activeStep);

  assert.deepEqual(outcome, { handled: false, gated: false });
  assert.equal(council.calls.originateCount, 0, 'council never runs for a non-council step');
  assert.equal(p.status, 'active', 'status unchanged');
  assert.equal(p.steps[0].status, 'active', 'active step untouched');
  assert.equal(p.steps[0].result, undefined, 'step not completed');
  assert.equal((p as any).selection, undefined, 'no selection set');
  clearTimeout((e as any).saveDebounceTimer);
});

// ── Invariant 2: auto mode runs straight through (no gate) ────────────────────

for (const sel of [undefined, 'auto'] as const) {
  test(`romance-full council step, councilSelection=${sel ?? 'unset'}: runs straight through, not gated`, async () => {
    const e = engineFor(ROMANCE_PIPELINE);
    const ctx: any = { heat: 'sweet' };
    if (sel) ctx.councilSelection = sel;
    const p = e.createProjectResolved('romance-sweet-full' as any, 'P', 'd', ctx);
    e.startProject(p.id); // council step active
    const activeStep = p.steps.find((s: any) => s.status === 'active');
    const council = fakeCouncil();

    const outcome = await maybeRunCouncilStep({ engine: e as any, council }, p, activeStep);

    assert.deepEqual(outcome, { handled: true, gated: false });
    assert.equal(council.calls.originateCount, 1, 'council ran once');
    assert.equal(p.steps[0].status, 'completed', 'council step completed');
    assert.equal(p.steps[0].result, 'Base story c2', 'completed with the recommended candidate text');
    assert.notEqual(p.status, 'paused', 'project NOT paused in auto mode');
    assert.equal((p as any).selection, undefined, 'no selection gate set');
    assert.equal(p.steps[1].status, 'active', 'premise step is the new frontier');
    clearTimeout((e as any).saveDebounceTimer);
  });
}

// ── Invariant 3: propose mode parks the project ──────────────────────────────

test('romance-full council step, councilSelection=propose: gated, selection set, status paused', async () => {
  const e = engineFor(ROMANCE_PIPELINE);
  const p = e.createProjectResolved('romance-sweet-full' as any, 'P', 'd', { heat: 'sweet', councilSelection: 'propose' });
  e.startProject(p.id);
  const activeStep = p.steps.find((s: any) => s.status === 'active');
  const council = fakeCouncil();

  const outcome = await maybeRunCouncilStep({ engine: e as any, council }, p, activeStep);

  assert.deepEqual(outcome, { handled: true, gated: true });
  assert.equal(council.calls.originateCount, 1, 'council ran once');
  assert.equal(p.steps[0].status, 'active', 'council step NOT completed — waiting on a pick');
  assert.equal(p.status, 'paused', 'project parked awaiting selection');
  assert.ok((p as any).selection, 'selection populated');
  assert.equal((p as any).selection.stepId, p.steps[0].id);
  assert.deepEqual((p as any).selection.candidates, COUNCIL_RESULT.candidates);
  assert.equal((p as any).selection.recommendedId, 'c2');
  clearTimeout((e as any).saveDebounceTimer);
});
