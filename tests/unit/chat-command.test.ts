/**
 * Unit tests for isChatCommand: the shared predicate deciding whether a chat
 * message is dispatched as a command (slash command or a natural-language
 * project-advance verb) vs. sent to the AI as prose. Used by both /api/chat and
 * the Socket.IO message handler so the two surfaces behave identically.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChatCommand } from '../../gateway/src/services/chat-command.ts';

test('slash-prefixed messages are commands', () => {
  assert.equal(isChatCommand('/editors'), true);
  assert.equal(isChatCommand('/editor maeve brainstorm'), true);
  assert.equal(isChatCommand('/novel a baker romance'), true);
});

test('natural-language advance verbs are commands (case/space-insensitive)', () => {
  for (const w of ['continue', 'next', 'go', 'resume', '  NEXT  ', 'Resume']) {
    assert.equal(isChatCommand(w), true, w);
  }
});

test('ordinary prose is not a command', () => {
  assert.equal(isChatCommand('write the next chapter'), false);
  assert.equal(isChatCommand('what happens next?'), false);
  assert.equal(isChatCommand('tell me about the villain'), false);
  assert.equal(isChatCommand(''), false);
});
