import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeProviderError } from '../../gateway/src/api/routes/books.routes.js';

test('maps an OpenRouter out-of-credits error to an actionable message', () => {
  const raw = 'OpenRouter HTTP 402: {"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402}}';
  const msg = describeProviderError(raw)!;
  assert.match(msg, /OpenRouter/);
  assert.match(msg, /out of credits/);
});

test('names the provider and the fix for auth / rate-limit / server errors', () => {
  assert.match(describeProviderError('OpenRouter HTTP 401: bad key')!, /rejected the API key/);
  assert.match(describeProviderError('OpenRouter HTTP 429: slow down')!, /rate-limited/);
  assert.match(describeProviderError('Gemini HTTP 503: unavailable')!, /server error \(HTTP 503\)/);
  assert.match(describeProviderError('Gemini HTTP 503: unavailable')!, /Gemini/);
});

test('catches a credits error with no HTTP code, via the credit-hint fallback', () => {
  assert.match(describeProviderError('Insufficient credits on the account')!, /out of credits/);
});

test('returns null for a non-provider error so the caller stays generic', () => {
  assert.equal(describeProviderError('PREMISE_INTAKE_PARSE_FAILED'), null);
  assert.equal(describeProviderError('some random failure'), null);
  assert.equal(describeProviderError(''), null);
});
