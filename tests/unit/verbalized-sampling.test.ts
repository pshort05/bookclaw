import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeVsPrompt, parseTakes, runVerbalizedSampling, VS_DEFAULTS } from '../../gateway/src/sampling/verbalized-sampling.js';

test('composeVsPrompt appends the VS envelope AFTER the base prompt (envelope last)', () => {
  const out = composeVsPrompt('CRAFT INSTRUCTIONS HERE', { ...VS_DEFAULTS, k: 3 });
  assert.ok(out.startsWith('CRAFT INSTRUCTIONS HERE'), 'base prompt preserved and first');
  assert.ok(out.indexOf('CRAFT INSTRUCTIONS HERE') < out.indexOf('<take'), 'envelope comes after the craft content');
  assert.match(out, /exactly 3/i);
});

test('parseTakes extracts k blocks with probabilities', () => {
  const raw = `<take p="0.06">Approach one.</take>\n<take p="0.08">Approach two.</take>`;
  const c = parseTakes(raw, 2);
  assert.equal(c?.length, 2);
  assert.equal(c?.[0].index, 0);
  assert.equal(c?.[0].text, 'Approach one.');
});

test('parseTakes tolerates near-XML (unquoted probability)', () => {
  const raw = `blah\n<take p=0.06>One.</take> <take p=0.08>Two.</take>\ntrailing`;
  assert.equal(parseTakes(raw, 2)?.length, 2);
});

test('parseTakes returns null when the block count is wrong', () => {
  assert.equal(parseTakes(`<take p="0.06">only one</take>`, 3), null);
});

test('parseTakes returns null when a probability is missing', () => {
  assert.equal(parseTakes(`<take>no prob</take><take p="0.05">ok</take>`, 2), null);
});

test('runVerbalizedSampling returns k candidates and discards probabilities', async () => {
  const complete = async () => ({ text: `<take p="0.06">A.</take><take p="0.07">B.</take><take p="0.09">C.</take>` });
  const r = await runVerbalizedSampling({ basePrompt: 'x', systemPrompt: 'sys', routing: { provider: 'openrouter', model: 'm' }, config: { ...VS_DEFAULTS, k: 3 }, complete });
  assert.equal(r.degraded, false);
  assert.equal(r.candidates.length, 3);
  assert.ok(!('probability' in (r.candidates[0] as any)), 'probabilities discarded');
});

test('runVerbalizedSampling fails open: malformed twice → single degraded direct output', async () => {
  let calls = 0;
  const complete = async (_req: any) => { calls++; return { text: calls <= 2 ? 'garbage no blocks' : 'DIRECT PROSE' }; };
  const r = await runVerbalizedSampling({ basePrompt: 'x', systemPrompt: 'sys', routing: { provider: 'openrouter' }, config: { ...VS_DEFAULTS, k: 3 }, complete });
  assert.equal(calls, 3, 'one VS attempt + one retry + one direct fallback');
  assert.equal(r.degraded, true);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].text, 'DIRECT PROSE');
});

test('runVerbalizedSampling passes the resolved routing through to complete', async () => {
  let seen: any = null;
  const complete = async (req: any) => { seen = req; return { text: `<take p="0.06">A.</take><take p="0.07">B.</take>` }; };
  await runVerbalizedSampling({ basePrompt: 'x', systemPrompt: 'sys', routing: { provider: 'claude', model: 'anthropic/claude-sonnet-5', temperature: 0.9 }, config: { ...VS_DEFAULTS, k: 2 }, complete });
  assert.equal(seen.provider, 'claude');
  assert.equal(seen.model, 'anthropic/claude-sonnet-5');
  assert.equal(seen.temperature, 0.9);
});
