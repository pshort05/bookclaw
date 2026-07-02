/**
 * Regression test for bug-review finding #3: the Telegram bridge authorized ALL
 * users when allowedUsers was empty (the shipped default), exposing an
 * internet-reachable bot. It must FAIL CLOSED — an empty allowlist authorizes
 * no one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTelegramUserAuthorized } from '../../gateway/src/bridges/telegram.js';

test('an empty allowlist authorizes NO ONE (fail closed)', () => {
  assert.equal(isTelegramUserAuthorized([], '12345'), false);
  assert.equal(isTelegramUserAuthorized([], ''), false);
});

test('a non-empty allowlist authorizes only listed users', () => {
  assert.equal(isTelegramUserAuthorized(['12345'], '12345'), true);
  assert.equal(isTelegramUserAuthorized(['12345'], '99999'), false);
  assert.equal(isTelegramUserAuthorized(['a', 'b', 'c'], 'b'), true);
});
