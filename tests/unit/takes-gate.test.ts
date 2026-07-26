import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maybeRunTakesStep, isTakesStep } from '../../gateway/src/services/takes-gate.js';

function fakeEngine() {
  const calls = { complete: [] as any[], park: 0 };
  return {
    calls,
    engine: {
      getProject: () => null,
      completeStep: (_p: string, s: string, r: string) => calls.complete.push({ s, r }),
      parkForReview: () => { calls.park++; },
      persistStepResultFile: async () => {},
    },
  };
}

const HEALTHY = async () => ({ candidates: [{ index: 0, text: 'A' }, { index: 1, text: 'B' }, { index: 2, text: 'C' }], degraded: false, config: { k: 3, variant: 'cot', threshold: 0.1 } });
const DEGRADED = async () => ({ candidates: [{ index: 0, text: 'DIRECT' }], degraded: true, config: { k: 3, variant: 'cot', threshold: 0.1 } });

test('isTakesStep is true only for a vs-enabled allowlisted role', () => {
  assert.equal(isTakesStep({ role: 'approach', vs: { enabled: true } }), true);
  assert.equal(isTakesStep({ role: 'draft' }), false);
  assert.equal(isTakesStep({ role: 'continuity', vs: { enabled: true } }), false);
});

test('non-VS step → passthrough', async () => {
  const { engine } = fakeEngine();
  assert.deepEqual(await maybeRunTakesStep({ engine, generateTakes: HEALTHY as any }, {}, { id: 's', role: 'draft' }), { handled: false, gated: false });
});

test('healthy VS step sets project.takes and parks', async () => {
  const { engine, calls } = fakeEngine();
  let gen = 0;
  const project: any = { id: 'p1' };
  const step = { id: 's1', role: 'approach', vs: { enabled: true } };
  const out = await maybeRunTakesStep({ engine, generateTakes: async (p, s) => { gen++; return HEALTHY(); } }, project, step);
  assert.deepEqual(out, { handled: true, gated: true });
  assert.equal(project.takes.candidates.length, 3);
  assert.equal(project.takes.stepId, 's1');
  assert.equal(calls.park, 1);
  // re-entry: marker set → re-park, do NOT regenerate
  const out2 = await maybeRunTakesStep({ engine, generateTakes: async () => { gen++; return HEALTHY(); } }, project, step);
  assert.equal(out2.gated, true);
  assert.equal(gen, 1, 'did not regenerate on re-entry');
  assert.equal(calls.park, 2);
});

test('degraded VS step completes directly and does not gate', async () => {
  const { engine, calls } = fakeEngine();
  const project: any = { id: 'p2' };
  const out = await maybeRunTakesStep({ engine, generateTakes: DEGRADED as any }, project, { id: 's2', role: 'draft', vs: { enabled: true } });
  assert.deepEqual(out, { handled: true, gated: false });
  assert.equal(calls.complete.length, 1);
  assert.equal(calls.complete[0].r, 'DIRECT');
  assert.equal(project.takes, undefined);
});

test('generateTakes throwing → passthrough (run the step normally)', async () => {
  const { engine } = fakeEngine();
  const out = await maybeRunTakesStep({ engine, generateTakes: async () => { throw new Error('boom'); } }, { id: 'p3' }, { id: 's3', role: 'approach', vs: { enabled: true } });
  assert.deepEqual(out, { handled: false, gated: false });
});
