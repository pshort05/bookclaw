import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNewestSonnet, NEWEST_SONNET_SENTINEL, SONNET_FLOOR, pickNewestHaiku, NEWEST_HAIKU_SENTINEL, HAIKU_FLOOR, pickNewestOpus, NEWEST_OPUS_SENTINEL, OPUS_FLOOR } from '../../gateway/src/ai/newest-sonnet.js';

test('pickNewestSonnet chooses the highest version (5 > 4.6 > 4.5 > 4)', () => {
  const ids = ['anthropic/claude-sonnet-4', 'anthropic/claude-sonnet-4.6', 'anthropic/claude-sonnet-5', 'anthropic/claude-sonnet-4.5', 'anthropic/claude-opus-4.8', 'openai/gpt-4o'];
  assert.equal(pickNewestSonnet(ids), 'anthropic/claude-sonnet-5');
});

test('pickNewestSonnet ignores date suffixes and prefers the stable (shorter) slug on ties', () => {
  const ids = ['anthropic/claude-sonnet-4.5-20250929', 'anthropic/claude-sonnet-4.5'];
  assert.equal(pickNewestSonnet(ids), 'anthropic/claude-sonnet-4.5');
});

test('pickNewestSonnet understands the older claude-3.5-sonnet naming', () => {
  const ids = ['anthropic/claude-3.5-sonnet', 'anthropic/claude-3-sonnet'];
  assert.equal(pickNewestSonnet(ids), 'anthropic/claude-3.5-sonnet');
});

test('pickNewestSonnet returns null when there is no sonnet', () => {
  assert.equal(pickNewestSonnet(['openai/gpt-4o', 'anthropic/claude-opus-4.8']), null);
});

test('sentinel + floor constants are exported', () => {
  assert.equal(NEWEST_SONNET_SENTINEL, 'auto:newest-sonnet');
  assert.match(SONNET_FLOOR, /claude-sonnet/);
});

test('pickNewestHaiku chooses the highest version (4.5 > 3.5 > 3) and ignores non-Haiku', () => {
  const ids = ['anthropic/claude-3-haiku', 'anthropic/claude-haiku-4.5', 'anthropic/claude-3.5-haiku', 'anthropic/claude-sonnet-5', 'openai/gpt-4o'];
  assert.equal(pickNewestHaiku(ids), 'anthropic/claude-haiku-4.5');
});

test('pickNewestHaiku ignores date suffixes and prefers the stable (shorter) slug on ties', () => {
  const ids = ['anthropic/claude-haiku-4.5-20251001', 'anthropic/claude-haiku-4.5'];
  assert.equal(pickNewestHaiku(ids), 'anthropic/claude-haiku-4.5');
});

test('pickNewestHaiku returns null when there is no haiku, and does not match sonnet', () => {
  assert.equal(pickNewestHaiku(['anthropic/claude-sonnet-5', 'openai/gpt-4o']), null);
});

test('newest-haiku sentinel + floor constants are exported', () => {
  assert.equal(NEWEST_HAIKU_SENTINEL, 'auto:newest-haiku');
  assert.match(HAIKU_FLOOR, /claude-haiku/);
});

test('pickNewestOpus chooses the highest version and ignores non-Opus', () => {
  const ids = ['anthropic/claude-opus-4', 'anthropic/claude-opus-4.8', 'anthropic/claude-sonnet-5', 'openai/gpt-4o'];
  assert.equal(pickNewestOpus(ids), 'anthropic/claude-opus-4.8');
});

test('pickNewestOpus ignores date suffixes and prefers the stable (shorter) slug on ties', () => {
  const ids = ['anthropic/claude-opus-4.8-20260501', 'anthropic/claude-opus-4.8'];
  assert.equal(pickNewestOpus(ids), 'anthropic/claude-opus-4.8');
});

test('pickNewestOpus returns null when there is no opus, and does not match sonnet/haiku', () => {
  assert.equal(pickNewestOpus(['anthropic/claude-sonnet-5', 'anthropic/claude-haiku-4.5']), null);
});

test('newest-opus sentinel + floor constants are exported', () => {
  assert.equal(NEWEST_OPUS_SENTINEL, 'auto:newest-opus');
  assert.match(OPUS_FLOOR, /claude-opus/);
});
