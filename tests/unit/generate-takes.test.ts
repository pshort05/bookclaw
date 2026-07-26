import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGenerateTakes } from '../../gateway/src/sampling/generate-takes.js';

test('makeGenerateTakes resolves routing, runs VS, returns candidates + config', async () => {
  let seenReq: any = null;
  const complete = async (req: any) => { seenReq = req; return { text: `<take p="0.06">A.</take><take p="0.07">B.</take><take p="0.08">C.</take>` }; };
  const gen = makeGenerateTakes({
    complete,
    resolveRouting: () => ({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5', temperature: 0.8 }),
  });
  const out = await gen({ id: 'p' }, { id: 's', role: 'approach', prompt: 'CRAFT', vs: { enabled: true, k: 3 } });
  assert.equal(out.degraded, false);
  assert.equal(out.candidates.length, 3);
  assert.deepEqual(out.config, { k: 3, variant: 'cot', threshold: 0.1 });
  assert.equal(seenReq.provider, 'openrouter');
  assert.equal(seenReq.model, 'anthropic/claude-sonnet-5');
  assert.ok(seenReq.messages[0].content.startsWith('CRAFT'), 'the step prompt is the base prompt');
});

test('makeGenerateTakes uses buildContext (canon-aware system + user) and returns routing', async () => {
  let seenReq: any = null;
  const complete = async (req: any) => { seenReq = req; return { text: `<take p="0.06">A.</take><take p="0.07">B.</take>` }; };
  const gen = makeGenerateTakes({
    complete,
    resolveRouting: () => ({ provider: 'openrouter', model: 'anthropic/claude-opus-4.8' }),
    buildContext: async () => ({ system: 'STORY CANON + PRIOR CHAPTERS', user: 'ASSEMBLED USER MSG WITH SCENE BRIEF' }),
  });
  const out = await gen({ id: 'p' }, { id: 's', role: 'draft', prompt: 'ignored-when-buildContext', vs: { enabled: true, k: 2 } });
  assert.equal(seenReq.system, 'STORY CANON + PRIOR CHAPTERS', 'system prompt from buildContext, not empty');
  assert.ok(seenReq.messages[0].content.startsWith('ASSEMBLED USER MSG WITH SCENE BRIEF'), 'user message from buildContext');
  assert.equal(out.provider, 'openrouter');
  assert.equal(out.model, 'anthropic/claude-opus-4.8');
});

test('makeGenerateTakes surfaces the degraded fallback', async () => {
  const complete = async () => ({ text: 'no blocks at all' });
  const gen = makeGenerateTakes({ complete, resolveRouting: () => ({ provider: 'openrouter' }) });
  const out = await gen({ id: 'p' }, { id: 's', role: 'draft', prompt: 'X', vs: { enabled: true, k: 3 } });
  assert.equal(out.degraded, true);
  assert.equal(out.candidates.length, 1);
});
