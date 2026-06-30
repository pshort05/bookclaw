/**
 * Unit tests for generationMeta — the activity-log enrichment that records
 * provider/model/book/skill per AI generation. Regression context: the activity
 * log previously logged only `provider`, so a per-book model pin that silently
 * fell back to a tiny default model was invisible in the feed.
 *
 * Run: node --import tsx --test tests/unit/activity-meta.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generationMeta } from '../../gateway/src/services/activity-meta.js';

test('includes all four fields when set', () => {
  assert.deepEqual(
    generationMeta({ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', bookSlug: 'my-book', skill: 'book-bible' }),
    { provider: 'openrouter', model: 'deepseek/deepseek-v4-pro', bookSlug: 'my-book', skill: 'book-bible' },
  );
});

test('omits undefined and empty-string fields (no blank keys in the feed)', () => {
  assert.deepEqual(generationMeta({ provider: 'ollama', model: undefined, bookSlug: '', skill: undefined }), { provider: 'ollama' });
  assert.deepEqual(generationMeta({}), {});
});

test('the model field — the field that was missing — is surfaced', () => {
  // This is the field whose absence hid the model-fallback bug.
  const m = generationMeta({ provider: 'openrouter', model: 'google/gemma-3-4b-it', bookSlug: 'my-medical-romance' });
  assert.equal(m.model, 'google/gemma-3-4b-it');
  assert.equal(m.bookSlug, 'my-medical-romance');
});
