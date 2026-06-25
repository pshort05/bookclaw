import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPrompt } from '../../gateway/src/services/prompt-runner.js';

function deps(selImpl: (t: string, p?: string) => { id: string }, capture: { pref?: string; model?: string }) {
  return {
    prompts: { get: (_n: string) => ({ systemPrompt: 'sys' } as any) },
    aiRouter: {
      selectProvider: (t: string, p?: string) => { capture.pref = p; return selImpl(t, p); },
      complete: async (r: any) => { capture.model = r.model; return { text: 'out', tokensUsed: 1, estimatedCost: 0, model: r.model }; },
    },
  };
}

test('per-run override: provider to select, model to complete', async () => {
  const cap: any = {};
  const d = deps((_t, p) => ({ id: p ?? 'x' }), cap);
  await runPrompt(d as any, 'p', 'content', undefined, { provider: 'claude', model: 'claude-x' });
  assert.equal(cap.pref, 'claude');
  assert.equal(cap.model, 'claude-x');
});

test('override model dropped when select falls back to another provider', async () => {
  const cap: any = {};
  const d = deps((_t, _p) => ({ id: 'ollama' }), cap);
  await runPrompt(d as any, 'p', 'content', undefined, { provider: 'gemini', model: 'gemini-2.5-flash' });
  assert.equal(cap.model, undefined);
});

test('no override falls back to the prompt asset model (openrouter)', async () => {
  const cap: any = {};
  const d = {
    prompts: { get: (_n: string) => ({ systemPrompt: 'sys', model: 'anthropic/x' } as any) },
    aiRouter: {
      selectProvider: (t: string, p?: string) => { cap.pref = p; return { id: 'openrouter' }; },
      complete: async (r: any) => { cap.model = r.model; return { text: 'out', model: r.model }; },
    },
  };
  await runPrompt(d as any, 'p', 'content');
  assert.equal(cap.pref, 'openrouter');
  assert.equal(cap.model, 'anthropic/x');
});
