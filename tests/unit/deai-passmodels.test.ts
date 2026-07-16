import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDeaiPassModel } from '../../gateway/src/services/deai/sweep.js';

test('defaults: pass1 OpenRouter-routed Gemini, pass2 Haiku', () => {
  assert.deepEqual(resolveDeaiPassModel(undefined, 1), { provider: 'openrouter', model: 'google/gemini-2.5-flash' });
  assert.deepEqual(resolveDeaiPassModel({}, 2), { provider: 'openrouter', model: 'auto:newest-haiku' });
});

test('stageModels slot overrides the default', () => {
  const sm = { deai_pass1: { provider: 'openrouter', model: 'x/y' } };
  assert.deepEqual(resolveDeaiPassModel(sm, 1), { provider: 'openrouter', model: 'x/y' });
});
