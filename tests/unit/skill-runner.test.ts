/**
 * Multi-step skills Phase A — SkillRunner: chains phases (each its own OpenRouter
 * model + temperature), substitutes {{input}}/{{previous}}/{{guidance}}, and retries
 * the failing phase (throw OR empty output) up to `retries`. Tested with a fake AI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SkillRunner, renderSkillPrompt } from '../../gateway/src/services/skill-runner.js';

test('renderSkillPrompt substitutes literally — no $-pattern interpretation, no cross-token re-expansion', () => {
  const out = renderSkillPrompt('a {{input}} b {{previous}} c {{guidance}}', {
    input: 'IN',
    previous: 'cost $5 $& $1 $` and a literal {{guidance}} token',
    guidance: 'GUIDE',
  });
  // $5/$&/$1/$` survive verbatim; the {{guidance}} literal inside `previous` is NOT re-expanded.
  assert.equal(out, 'a IN b cost $5 $& $1 $` and a literal {{guidance}} token c GUIDE');
});

function harness(responder: (req: any, n: number) => { text: string }) {
  const calls: any[] = [];
  const complete = async (req: any) => { calls.push(req); return responder(req, calls.length); };
  return { runner: new SkillRunner(complete), calls };
}
const twoPhase = (retries = 0) => ({
  name: 'humanize',
  retries,
  steps: [
    { model: 'flash', temperature: 0.2, prompt: 'detect in {{input}} [g:{{guidance}}]' },
    { model: 'pro', temperature: 0.9, prompt: 'rewrite {{input}} using {{previous}}' },
  ],
});

test('chains phases, substitutes vars, forces openrouter + per-phase model/temperature', async () => {
  const { runner, calls } = harness((_req, n) => ({ text: n === 1 ? 'TELLS' : 'REWRITTEN' }));
  const out = await runner.run(twoPhase(), 'TEXT', 'GUIDE');
  assert.equal(out, 'REWRITTEN');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].provider, 'openrouter');
  assert.equal(calls[0].model, 'flash');
  assert.equal(calls[0].temperature, 0.2);
  assert.equal(calls[1].provider, 'openrouter');
  assert.equal(calls[1].model, 'pro');
  assert.equal(calls[1].temperature, 0.9);
  assert.equal(calls[0].messages[0].content, 'detect in TEXT [g:GUIDE]');
  assert.equal(calls[1].messages[0].content, 'rewrite TEXT using TELLS');
});

test('retries the failing phase on throw, up to `retries`, then succeeds', async () => {
  let attempts = 0;
  const { runner } = harness((req) => {
    if (req.model === 'pro') { attempts++; if (attempts < 3) throw new Error('boom'); return { text: 'OK' }; }
    return { text: 'TELLS' };
  });
  assert.equal(await runner.run(twoPhase(3), 'T', ''), 'OK');
  assert.equal(attempts, 3); // initial + 2 retries
});

test('treats empty/whitespace output as failure and retries', async () => {
  let n2 = 0;
  const { runner } = harness((req) => {
    if (req.model === 'pro') { n2++; return { text: n2 < 2 ? '   ' : 'GOOD' }; }
    return { text: 'X' };
  });
  assert.equal(await runner.run(twoPhase(2), 'T', ''), 'GOOD');
  assert.equal(n2, 2);
});

test('throws when retries are exhausted', async () => {
  const { runner } = harness((req) => { if (req.model === 'pro') throw new Error('always'); return { text: 'X' }; });
  await assert.rejects(() => runner.run(twoPhase(1), 'T', ''), /always|failed/i);
});

test('single-phase skill returns its output; no steps throws', async () => {
  const { runner } = harness(() => ({ text: 'ONLY' }));
  assert.equal(await runner.run({ name: 's', steps: [{ model: 'm', prompt: 'do {{input}}' }] }, 'T', ''), 'ONLY');
  await assert.rejects(() => runner.run({ name: 'empty', steps: [] }, 'T', ''), /no executable steps/i);
});

test('failure message identifies a name/model-less phase by ordinal', async () => {
  const { runner } = harness(() => { throw new Error('boom'); });
  await assert.rejects(
    () => runner.run({ name: 's', steps: [{ prompt: 'only {{input}}' }] }, 'T', ''),
    /phase "#1"/, // no name, no model → identified by ordinal, not "undefined"
  );
});

test('routes each phase to its own provider, defaulting to openrouter', async () => {
  const { runner, calls } = harness((_req, n) => ({ text: n === 1 ? 'A' : 'B' }));
  const skill = {
    name: 'mp', retries: 0,
    steps: [
      { provider: 'claude', model: 'claude-sonnet-4-5', prompt: 'x {{input}}' },
      { prompt: 'y {{previous}}' }, // no provider, no model → openrouter default
    ],
  };
  const out = await runner.run(skill, 'T', '');
  assert.equal(out, 'B');
  assert.equal(calls[0].provider, 'claude');
  assert.equal(calls[0].model, 'claude-sonnet-4-5');
  assert.equal(calls[1].provider, 'openrouter'); // default
  assert.equal(calls[1].model, undefined);        // router resolves the provider default
});
