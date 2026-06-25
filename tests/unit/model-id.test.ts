import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidModelId } from '../../gateway/src/ai/model-id.js';

test('accepts real model ids', () => {
  for (const m of ['google/gemini-2.5-flash', 'claude-sonnet-4-5-20250929', 'gpt-4o', 'anthropic/claude-3.5-sonnet:beta', 'llama3.2']) {
    assert.equal(isValidModelId(m), true, m);
  }
});

test('rejects empty, oversized, control chars, whitespace, URL metachars, traversal', () => {
  assert.equal(isValidModelId(''), false);
  assert.equal(isValidModelId('a'.repeat(201)), false);
  assert.equal(isValidModelId('foo\nbar'), false);          // control char
  assert.equal(isValidModelId('foo bar'), false);            // whitespace
  assert.equal(isValidModelId('foo?key=x'), false);          // query metachar
  assert.equal(isValidModelId('models/../secret'), false);   // path traversal
  assert.equal(isValidModelId(123 as any), false);           // non-string
});
