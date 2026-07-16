import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAvailablePassModel } from '../../gateway/src/services/deai/sweep.js';

test('keeps the request when its provider is available', () => {
  assert.deepEqual(
    resolveAvailablePassModel({ provider: 'openrouter', model: 'x/y' }, ['openrouter', 'claude']),
    { provider: 'openrouter', model: 'x/y', fellBack: false });
});

test('native gemini unavailable -> falls back to OpenRouter Gemini slug (family preserved)', () => {
  assert.deepEqual(
    resolveAvailablePassModel({ provider: 'gemini', model: 'auto:newest-gemini' }, ['openrouter', 'claude']),
    { provider: 'openrouter', model: 'google/gemini-2.5-flash', fellBack: true });
});

test('provider unavailable and no OpenRouter -> last-resort first available, router-default model', () => {
  assert.deepEqual(
    resolveAvailablePassModel({ provider: 'gemini', model: 'auto:newest-gemini' }, ['ollama']),
    { provider: 'ollama', model: '', fellBack: true });
});

test('no provider available at all -> null', () => {
  assert.equal(resolveAvailablePassModel({ provider: 'gemini', model: 'x' }, []), null);
});
