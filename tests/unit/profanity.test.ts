import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profanityInjection, isInCharacterProfanity } from '../../gateway/src/services/casting/profanity.js';

test('a high-profanity character yields a do-not-sanitize block naming the register', () => {
  const block = profanityInjection({ name: 'Rook', profanity: { level: 8, contexts: ['angry'], register: 'crude street slang' } });
  assert.match(block, /do not sanitize/i);
  assert.match(block, /crude street slang/);
  assert.match(block, /Rook/);
});

test('level 0 or absent profanity yields an empty string', () => {
  assert.equal(profanityInjection({ name: 'Alice' }), '');
  assert.equal(profanityInjection({ name: 'Alice', profanity: { level: 0, contexts: [], register: 'clean' } }), '');
});

test('isInCharacterProfanity whitelists a profane line from a high-profanity character', () => {
  const character = { profanity: { level: 8, contexts: [], register: 'crude' } };
  assert.equal(isInCharacterProfanity('This is fucking ridiculous.', character), true);
});

test('isInCharacterProfanity rejects a profane line from a non-profane character', () => {
  const character = { profanity: { level: 0, contexts: [], register: 'clean' } };
  assert.equal(isInCharacterProfanity('This is fucking ridiculous.', character), false);
});
