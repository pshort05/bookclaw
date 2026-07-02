import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEphemeralChannel } from '../../gateway/src/index.ts';

test('internal one-shot channels are ephemeral (skip + never replay history)', () => {
  assert.equal(isEphemeralChannel('research'), true, 'Telegram /research synthesis must not accumulate history');
  assert.equal(isEphemeralChannel('projects'), true);
  assert.equal(isEphemeralChannel('project-engine'), true);
  assert.equal(isEphemeralChannel('goal-engine'), true);
  assert.equal(isEphemeralChannel('conductor'), true);
  assert.equal(isEphemeralChannel('api-silent'), true);
});

test('real chat channels retain conversation history', () => {
  assert.equal(isEphemeralChannel('web'), false);
  assert.equal(isEphemeralChannel('telegram:123'), false);
  assert.equal(isEphemeralChannel('discord:abc'), false);
  assert.equal(isEphemeralChannel('api'), false);
});
