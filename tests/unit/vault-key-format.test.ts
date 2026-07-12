/**
 * Unit tests for gateway/src/api/routes/_shared.ts validateKeyFormat — a
 * pure, non-blocking sanity check on a vault credential's shape against its
 * provider slot. The save always happens regardless of the result; this only
 * verifies the advisory ok/warning it returns.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateKeyFormat } from '../../gateway/src/api/routes/_shared.js';

test('correct-shape OpenAI key is accepted with no warning', () => {
  const result = validateKeyFormat('openai_api_key', 'sk-abcdefghijklmnop');
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined);
});

test('correct-shape Anthropic key is accepted with no warning', () => {
  const result = validateKeyFormat('anthropic_api_key', 'sk-ant-abcdefghijklmnop');
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined);
});

test('correct-shape Gemini key is accepted with no warning', () => {
  const result = validateKeyFormat('gemini_api_key', 'AIzaSyABCDEFGHIJKLMNOP');
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined);
});

test('a Gemini key pasted into the OpenAI slot is flagged and names Gemini', () => {
  const result = validateKeyFormat('openai_api_key', 'AIzaSyABCDEFGHIJKLMNOP');
  assert.equal(result.ok, false);
  assert.match(result.warning ?? '', /Gemini/);
});

test('an Anthropic key pasted into the OpenAI slot is flagged and names Anthropic', () => {
  const result = validateKeyFormat('openai_api_key', 'sk-ant-abcdefghijklmnop');
  assert.equal(result.ok, false);
  assert.match(result.warning ?? '', /Anthropic/);
});

test('a plain sk- key in the Anthropic slot is flagged', () => {
  const result = validateKeyFormat('anthropic_api_key', 'sk-abcdefghijklmnop');
  assert.equal(result.ok, false);
  assert.ok(result.warning);
});

test('openrouter accepts a bare sk- key with no warning', () => {
  const result = validateKeyFormat('openrouter_api_key', 'sk-abcdefghijklmnop');
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined);
});

test('openrouter flags a clear Google-prefixed cross-provider paste', () => {
  const result = validateKeyFormat('openrouter_api_key', 'AIzaSyABCDEFGHIJKLMNOP');
  assert.equal(result.ok, false);
  assert.match(result.warning ?? '', /Gemini/);
});

test('openrouter flags a clear Anthropic-prefixed cross-provider paste', () => {
  const result = validateKeyFormat('openrouter_api_key', 'sk-ant-abcdefghijklmnop');
  assert.equal(result.ok, false);
  assert.match(result.warning ?? '', /Anthropic/);
});

test('correct-shape Telegram bot token is accepted with no warning', () => {
  const result = validateKeyFormat('telegram_bot_token', '123456789:ABCdefGhIJKlmNoPQRstuVWXyz');
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined);
});

test('a malformed Telegram bot token is flagged', () => {
  const result = validateKeyFormat('telegram_bot_token', 'not-a-telegram-token');
  assert.equal(result.ok, false);
  assert.ok(result.warning);
});

test('an unknown key name (e.g. deepseek_api_key) is always ok', () => {
  const result = validateKeyFormat('deepseek_api_key', 'anything-at-all');
  assert.equal(result.ok, true);
  assert.equal(result.warning, undefined);
});

test('validateKeyFormat never throws on empty/undefined-ish values', () => {
  assert.doesNotThrow(() => validateKeyFormat('openai_api_key', ''));
  assert.doesNotThrow(() => validateKeyFormat('unknown_key', ''));
});
