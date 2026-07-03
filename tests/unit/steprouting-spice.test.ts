import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRouting } from '../../gateway/src/api/routes/_shared.js';

test('a spiceRoute beats the manual per-step model pin', () => {
  const r = stepRouting(
    { context: { genre: 'romance' } },
    { role: 'draft', modelOverride: { provider: 'openai' } },
    { provider: 'grok' },
  );
  assert.equal(r.provider, 'grok');
});

test('an untagged step ignores spiceRoute (backward compatible)', () => {
  const r = stepRouting({ preferredProvider: 'gemini' }, {}, { provider: 'grok' });
  assert.equal(r.provider, 'gemini');
});

test('no spiceRoute keeps existing tagged-step behavior', () => {
  const r = stepRouting({ context: { genre: 'romance' } }, { role: 'improve' });
  assert.equal(r.provider, 'openrouter');
});
