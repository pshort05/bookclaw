import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPrompt } from '../../gateway/src/services/prompt-runner.ts';

test('runPrompt meta: full provider response includes all meta fields', async () => {
  const aiRouter = {
    selectProvider: () => ({ id: 'ollama' }),
    complete: async () => ({ text: 'OUT', promptTokens: 10, completionTokens: 90, tokensUsed: 100, estimatedCost: 0.0012, model: 'gemma3:4b' }),
  };
  const prompts = { get: (n: string) => (n === 'p' ? { schemaVersion: 1, name: 'p', label: 'P', systemPrompt: 'sys' } as any : null) };
  const costs = { record() {} };

  const result = await runPrompt({ prompts, aiRouter, costs }, 'p', 'some content');
  assert.ok(result !== null, 'expected a result, got null');
  assert.equal(result.text, 'OUT');

  const { meta } = result;
  assert.equal(meta.provider, 'ollama');
  assert.equal(meta.model, 'gemma3:4b');
  assert.equal(meta.promptTokens, 10);
  assert.equal(meta.completionTokens, 90);
  assert.equal(meta.tokensUsed, 100);
  assert.equal(meta.estimatedCost, 0.0012);
  assert.equal(typeof meta.ms, 'number');
  assert.ok(meta.ms >= 0);
  // tokensPerSecond is computed only when completionTokens is known and ms > 0;
  // in a synchronous stub ms may be 0, so accept either a finite number or undefined.
  if (meta.tokensPerSecond !== undefined) {
    assert.ok(Number.isFinite(meta.tokensPerSecond));
  }
});

test('runPrompt meta: partial response (no split tokens) falls back correctly', async () => {
  const aiRouter = {
    selectProvider: () => ({ id: 'ollama' }),
    complete: async () => ({ text: 'X', tokensUsed: 5, estimatedCost: 0 }),
  };
  const prompts = { get: (n: string) => (n === 'p' ? { schemaVersion: 1, name: 'p', label: 'P', systemPrompt: 'sys' } as any : null) };

  const result = await runPrompt({ prompts, aiRouter }, 'p', 'some content');
  assert.ok(result !== null);
  assert.equal(result.text, 'X');

  const { meta } = result;
  assert.equal(meta.tokensUsed, 5);
  assert.equal(meta.promptTokens, undefined);
  assert.equal(meta.completionTokens, undefined);
  assert.equal(meta.tokensPerSecond, undefined);
});

test('runPrompt meta: unknown prompt returns null', async () => {
  const aiRouter = { complete: async () => { throw new Error('should not be called'); } };
  const prompts = { get: () => null };

  const result = await runPrompt({ prompts, aiRouter }, 'missing', 'x');
  assert.equal(result, null);
});
