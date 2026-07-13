import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNewestSonnet, NEWEST_SONNET_SENTINEL, SONNET_FLOOR } from '../../gateway/src/ai/newest-sonnet.js';

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
