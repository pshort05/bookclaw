import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConsistencyModel, CONSISTENCY_PROVIDERS } from '../../gateway/src/services/consistency/model-selection.js';

test('per-run beats per-book', () => {
  const r = resolveConsistencyModel({ provider: 'claude', model: 'claude-x' }, { provider: 'gemini' });
  assert.deepEqual(r, { provider: 'claude', model: 'claude-x' });
});
test('falls back to per-book, then auto', () => {
  assert.deepEqual(resolveConsistencyModel(undefined, { provider: 'gemini' }), { provider: 'gemini', model: undefined });
  assert.deepEqual(resolveConsistencyModel(undefined, undefined), { provider: undefined, model: undefined });
});
test('an empty per-run override object still consults the per-book default (regression: perRun ?? perBook)', () => {
  assert.deepEqual(
    resolveConsistencyModel({ provider: undefined, model: undefined }, { provider: 'gemini', model: 'gemini-2.5-flash' }),
    { provider: 'gemini', model: 'gemini-2.5-flash' },
  );
});
test('invalid provider -> auto (and drops its model)', () => {
  assert.deepEqual(resolveConsistencyModel({ provider: 'bogus', model: 'm' }, undefined), { provider: undefined, model: undefined });
});
test('model without a provider is dropped; whitespace model dropped', () => {
  assert.deepEqual(resolveConsistencyModel({ model: 'm' }, undefined), { provider: undefined, model: undefined });
  assert.deepEqual(resolveConsistencyModel({ provider: 'openrouter', model: '   ' }, undefined), { provider: 'openrouter', model: undefined });
});
test('provider set is the six known providers', () => {
  assert.deepEqual([...CONSISTENCY_PROVIDERS].sort(), ['claude','deepseek','gemini','ollama','openai','openrouter']);
});
