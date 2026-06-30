/**
 * novelModelAdvice — Easy Start soft capability warning (owner ask 2026-06-30).
 * Flags fast/cheap model tiers that under-perform on a full novel (the
 * gemini-3.5-flash run drifted on names/title/continuity and truncated whole-
 * manuscript passes). Name-based: the failure mode is model STRENGTH, not context
 * window (flash has huge context but still drifted). Non-blocking guidance only.
 *
 * Run: node --import tsx --test tests/unit/novel-model-advice.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { novelModelAdvice } from '../../frontend/studio/src/lib/novelModel.js';

test('flags fast/cheap tiers as weak for a full novel', () => {
  for (const id of [
    'google/gemini-3.5-flash', 'google/gemini-2.0-flash', 'openai/gpt-4o-mini',
    'anthropic/claude-3-5-haiku', 'google/gemma-3-4b-it', 'microsoft/phi-3-mini',
    'meta-llama/llama-3-8b-instruct', 'mistralai/mistral-7b', 'x/something-nano',
    'foo-lite', 'bar-instant', 'baz-small',
  ]) {
    assert.equal(novelModelAdvice(id).weak, true, `${id} should be flagged weak`);
  }
});

test('does NOT flag frontier / strong models', () => {
  for (const id of [
    'anthropic/claude-sonnet-4.6', 'anthropic/claude-opus-4-8', 'openai/gpt-4o',
    'openai/gpt-4.1', 'google/gemini-2.5-pro', 'deepseek/deepseek-chat',
    'deepseek/deepseek-v3', 'meta-llama/llama-3.1-405b-instruct', 'mistralai/mistral-large',
  ]) {
    assert.equal(novelModelAdvice(id).weak, false, `${id} should NOT be flagged`);
  }
});

test('a flagged model carries a recommendation note; empty input is safe', () => {
  const a = novelModelAdvice('google/gemini-3.5-flash');
  assert.equal(a.weak, true);
  assert.ok(a.note && /frontier|full (novel|book)|drift/i.test(a.note));
  assert.equal(novelModelAdvice('').weak, false);
  assert.equal(novelModelAdvice('   ').weak, false);
});
