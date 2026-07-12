import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LLM_PRICING, getLLMPrice } from '../../gateway/src/ai/pricing.ts';

test('getLLMPrice returns the exact listed price + confidence for a known model', () => {
  const price = getLLMPrice('claude-opus-4-8');
  assert.equal(price.costPer1kInput, 0.005);
  assert.equal(price.costPer1kOutput, 0.025);
  assert.equal(price.confidence, 'listed');
});

test('getLLMPrice falls back to the caller-supplied numbers for an unknown model, marked rough', () => {
  const price = getLLMPrice('some-future-model-xyz', { costPer1kInput: 0.009, costPer1kOutput: 0.009 });
  assert.equal(price.costPer1kInput, 0.009);
  assert.equal(price.costPer1kOutput, 0.009);
  assert.equal(price.confidence, 'rough');
});

test('getLLMPrice defaults to 0/0 for an unknown model with no fallback supplied', () => {
  const price = getLLMPrice('some-future-model-xyz');
  assert.equal(price.costPer1kInput, 0);
  assert.equal(price.costPer1kOutput, 0);
  assert.equal(price.confidence, 'rough');
});

test('every LLM_PRICING row has a lastVerified date and a non-empty note', () => {
  for (const [model, price] of Object.entries(LLM_PRICING)) {
    assert.ok(price.lastVerified, `${model} missing lastVerified`);
    assert.ok(price.note && price.note.trim().length > 0, `${model} missing note`);
  }
});
