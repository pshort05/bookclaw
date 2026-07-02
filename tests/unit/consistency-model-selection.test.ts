import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveConsistencyModel,
  validateConsistencyModelSelection,
  consistencyCapabilityError,
  isLargeContextProvider,
  extractionProviderError,
  CONSISTENCY_PROVIDERS,
  KNOWN_PROVIDERS,
} from '../../gateway/src/services/consistency/model-selection.js';

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
test('consistency provider set excludes ollama (needs large context); known set keeps it', () => {
  assert.deepEqual([...CONSISTENCY_PROVIDERS].sort(), ['claude','deepseek','gemini','openai','openrouter']);
  assert.deepEqual([...KNOWN_PROVIDERS].sort(), ['claude','deepseek','gemini','ollama','openai','openrouter']);
});

test('resolveConsistencyModel drops a stale ollama default to auto', () => {
  assert.deepEqual(resolveConsistencyModel({ provider: 'ollama', model: 'gemma3:4b' }, undefined), { provider: undefined, model: undefined });
  assert.deepEqual(resolveConsistencyModel(undefined, { provider: 'ollama', model: 'gemma3:4b' }), { provider: undefined, model: undefined });
});

test('validateConsistencyModelSelection rejects ollama, accepts capable + empty', () => {
  assert.match(validateConsistencyModelSelection({ provider: 'ollama' }) ?? '', /not supported for consistency/);
  assert.equal(validateConsistencyModelSelection({ provider: 'gemini', model: 'gemini-2.5-flash' }), null);
  assert.equal(validateConsistencyModelSelection({}), null);
  // still inherits the base validator (unknown provider / bad model id)
  assert.match(validateConsistencyModelSelection({ provider: 'bogus' }) ?? '', /Invalid provider/);
});

test('consistencyCapabilityError gates on a configured capable provider', () => {
  // auto + only ollama available → error
  assert.match(consistencyCapabilityError({}, ['ollama']) ?? '', /No model capable/);
  // auto + a capable provider available → ok
  assert.equal(consistencyCapabilityError({}, ['ollama', 'gemini']), null);
  // explicit provider not configured → error
  assert.match(consistencyCapabilityError({ provider: 'claude' }, ['gemini']) ?? '', /not configured/);
  // explicit provider configured → ok
  assert.equal(consistencyCapabilityError({ provider: 'gemini' }, ['gemini']), null);
});

// ── Run-review B6: guard context/summary extraction against an Ollama fallback ──

test('isLargeContextProvider: capable providers true, ollama/unknown/empty false', () => {
  for (const p of CONSISTENCY_PROVIDERS) assert.equal(isLargeContextProvider(p), true);
  assert.equal(isLargeContextProvider('ollama'), false);
  assert.equal(isLargeContextProvider('bogus'), false);
  assert.equal(isLargeContextProvider(undefined), false);
});

test('extractionProviderError: a capable selected provider is always allowed', () => {
  assert.equal(extractionProviderError('deepseek', ['deepseek', 'ollama']), null);
});

test('extractionProviderError: ollama REFUSED when a capable provider is also available (transient fallback)', () => {
  const err = extractionProviderError('ollama', ['ollama', 'gemini']);
  assert.ok(err && /fell back to "ollama"/.test(err), 'refuses the degraded fallback');
});

test('extractionProviderError: ollama ALLOWED when it is the only provider (no regression for Ollama-only)', () => {
  assert.equal(extractionProviderError('ollama', ['ollama']), null);
  assert.equal(extractionProviderError('ollama', []), null);
});
