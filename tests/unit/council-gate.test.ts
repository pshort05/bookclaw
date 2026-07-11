/**
 * LLM Council pipeline gate — the shared driver helper (Romance Workflow
 * sub-project 3, Task 3). `maybeRunCouncilStep` is the single decision point
 * both drivers call; this test drives it against a fake engine + fake council
 * (mirrors tests/unit/human-review.test.ts's mockEngine() pattern) so the
 * auto-vs-propose logic is verified in isolation, with zero engine coupling.
 *
 * Run: node --import tsx --test tests/unit/council-gate.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNCIL_SKILL, isCouncilStep, maybeRunCouncilStep, seedFallbackBaseStory } from '../../gateway/src/services/council-gate.js';

const COUNCIL_RESULT = {
  candidates: [
    { id: 'c1', model: 'claude', premise: 'P1', relationshipArc: 'A1', text: 'Text c1' },
    { id: 'c2', model: 'gemini', premise: 'P2', relationshipArc: 'A2', text: 'Text c2' },
  ],
  ranking: [
    { id: 'c1', rank: 2, rationale: 'ok' },
    { id: 'c2', rank: 1, rationale: 'best' },
  ],
  recommendedId: 'c2',
  rationale: 'c2 has stronger stakes',
};

function fakeEngine() {
  const calls: any = { completed: [], parked: [], persisted: 0 };
  return {
    calls,
    getProject: (id: string) => undefined,
    completeStep: (projectId: string, stepId: string, result: string) => { calls.completed.push({ projectId, stepId, result }); },
    parkForReview: (id: string) => { calls.parked.push(id); },
    persistState: () => { calls.persisted++; },
  };
}

function fakeCouncil(result: any = COUNCIL_RESULT) {
  const calls: any = { originateCount: 0 };
  return {
    calls,
    async originate(seeds: any) { calls.originateCount++; calls.lastSeeds = seeds; return result; },
  };
}

function councilStep(overrides: any = {}) {
  return { id: 's-council', label: 'Council', skill: COUNCIL_SKILL, status: 'active', ...overrides };
}

// ── isCouncilStep ────────────────────────────────────────────────────────────

test('isCouncilStep is true only for the council-origination skill', () => {
  assert.equal(isCouncilStep({ skill: COUNCIL_SKILL }), true);
  assert.equal(isCouncilStep({ skill: 'write' }), false);
  assert.equal(isCouncilStep({}), false);
  assert.equal(isCouncilStep(null), false);
  assert.equal(isCouncilStep(undefined), false);
});

// ── non-council step ─────────────────────────────────────────────────────────

test('a non-council step is not handled and the engine is untouched', async () => {
  const engine = fakeEngine();
  const council = fakeCouncil();
  const project = { id: 'p1', context: {}, steps: [] };
  const step = { id: 's1', skill: 'write', status: 'active' };

  const outcome = await maybeRunCouncilStep({ engine, council }, project, step);

  assert.deepEqual(outcome, { handled: false, gated: false });
  assert.equal(engine.calls.completed.length, 0);
  assert.equal(engine.calls.parked.length, 0);
  assert.equal(council.calls.originateCount, 0);
});

// ── auto mode ─────────────────────────────────────────────────────────────────

test('auto mode: council runs once, step completes with the recommended candidate text, not gated', async () => {
  const engine = fakeEngine();
  const council = fakeCouncil();
  const project = { id: 'p1', context: { councilSelection: 'auto' }, steps: [] };
  const step = councilStep();

  const outcome = await maybeRunCouncilStep({ engine, council }, project, step);

  assert.deepEqual(outcome, { handled: true, gated: false });
  assert.equal(council.calls.originateCount, 1);
  assert.equal(engine.calls.completed.length, 1);
  assert.equal(engine.calls.completed[0].stepId, 's-council');
  assert.equal(engine.calls.completed[0].result, 'Text c2', 'the recommended candidate (c2) text');
  assert.equal(engine.calls.parked.length, 0);
  assert.equal((project as any).selection, undefined);
});

test('unset councilSelection defaults to auto (same as explicit auto)', async () => {
  const engine = fakeEngine();
  const council = fakeCouncil();
  const project = { id: 'p1', context: {}, steps: [] };
  const step = councilStep();

  const outcome = await maybeRunCouncilStep({ engine, council }, project, step);

  assert.deepEqual(outcome, { handled: true, gated: false });
  assert.equal(engine.calls.completed[0].result, 'Text c2');
});

// ── propose mode ──────────────────────────────────────────────────────────────

test('propose mode: council runs, project.selection populated, project parked, step NOT completed', async () => {
  const engine = fakeEngine();
  const council = fakeCouncil();
  const project = { id: 'p1', context: { councilSelection: 'propose' }, steps: [] };
  const step = councilStep();

  const outcome = await maybeRunCouncilStep({ engine, council }, project, step);

  assert.deepEqual(outcome, { handled: true, gated: true });
  assert.equal(council.calls.originateCount, 1);
  assert.equal(engine.calls.completed.length, 0, 'step not completed in propose mode');
  assert.deepEqual(engine.calls.parked, ['p1']);
  assert.ok((project as any).selection, 'selection populated');
  assert.equal((project as any).selection.stepId, 's-council');
  assert.deepEqual((project as any).selection.candidates, COUNCIL_RESULT.candidates);
  assert.deepEqual((project as any).selection.ranking, COUNCIL_RESULT.ranking);
  assert.equal((project as any).selection.recommendedId, 'c2');
});

// ── idempotent re-entry ────────────────────────────────────────────────────────

test('re-entry with selection already set does not re-run the council', async () => {
  const engine = fakeEngine();
  const council = fakeCouncil();
  const project = {
    id: 'p1',
    context: { councilSelection: 'propose' },
    steps: [],
    selection: { stepId: 's-council', candidates: COUNCIL_RESULT.candidates, ranking: COUNCIL_RESULT.ranking, recommendedId: 'c2', rationale: 'x', createdAt: 'now' },
  };
  const step = councilStep();

  const outcome = await maybeRunCouncilStep({ engine, council }, project, step);

  assert.deepEqual(outcome, { handled: true, gated: true });
  assert.equal(council.calls.originateCount, 0, 'council not re-run');
  assert.deepEqual(engine.calls.parked, ['p1']);
});

// ── degrade on council failure ──────────────────────────────────────────────

test('council.originate throwing degrades to a seed-fallback base story, not gated', async () => {
  const engine = fakeEngine();
  const council = { async originate() { throw new Error('COUNCIL_ORIGINATION_FAILED'); } };
  const project = { id: 'p1', context: { councilSelection: 'propose' }, steps: [], storyArc: 'x' };
  const step = councilStep();

  const outcome = await maybeRunCouncilStep({ engine, council }, project, step);

  assert.deepEqual(outcome, { handled: true, gated: false });
  assert.equal(engine.calls.completed.length, 1);
  assert.equal(engine.calls.completed[0].stepId, 's-council');
  assert.ok(engine.calls.completed[0].result.includes('PREMISE'), 'fallback text is a minimal base story');
  assert.equal(engine.calls.parked.length, 0);
  assert.equal((project as any).selection, undefined);
});

// ── Bug #32(b): fallback base story mislabels the character roster ──────────

test('seedFallbackBaseStory labels the character roster as CHARACTERS, not RELATIONSHIP ARC', () => {
  const text = seedFallbackBaseStory({ storyArc: 'A meet-cute at a bakery.', characters: 'Ava, a baker. Theo, a rival chef.' });
  assert.match(text, /^PREMISE\n/);
  assert.match(text, /CHARACTERS\nAva, a baker\. Theo, a rival chef\./);
  assert.doesNotMatch(text, /RELATIONSHIP ARC/, 'must not mislabel the character roster as a relationship arc');
});
