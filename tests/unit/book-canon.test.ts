/**
 * Story-canon injection (run-review fix). The reviewed run drifted because each
 * phase is a separate project, so writing/revision steps never saw the bible's
 * name registry or the manifest title — and the model re-invented the title,
 * heroine, hero, town, and hospital at every step. formatCanonBlock builds a
 * pinned canon header to inject into every generation step.
 *
 * Run: node --import tsx --test tests/unit/book-canon.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCanonBlock } from '../../gateway/src/services/book-canon.js';

test('formatCanonBlock pins title + author and the bible/registry/outline with hard rules', () => {
  const block = formatCanonBlock({
    title: 'The Saturday Remedy',
    author: 'Jane Doe',
    bible: 'Heroine: June Albright (nurse). Hero: Ethan Vance (surgeon).',
    registry: 'June Albright — protagonist. Julian Vance — June\'s toxic EX (NOT the hero).',
    outline: 'Ch1: meet-cute at the bakery.',
  });
  assert.match(block, /STORY CANON/i);
  assert.match(block, /The Saturday Remedy/);
  assert.match(block, /Jane Doe/);
  assert.match(block, /June Albright/);
  assert.match(block, /Julian Vance/);
  assert.match(block, /meet-cute at the bakery/);
  // Hard instruction present
  assert.match(block, /exactly|never (rename|invent)|do not (rename|invent|retitle)/i);
});

test('formatCanonBlock returns empty string when there is no canon to pin', () => {
  assert.equal(formatCanonBlock({ title: '', author: '' }), '');
});

test('formatCanonBlock works with only a title (no bible yet)', () => {
  const block = formatCanonBlock({ title: 'My Book', author: 'A. Writer' });
  assert.match(block, /My Book/);
  assert.match(block, /A\. Writer/);
  assert.match(block, /exactly/i);
});

test('formatCanonBlock truncates very long sections so the prompt stays bounded', () => {
  const huge = 'x '.repeat(20000);
  const block = formatCanonBlock({ title: 'T', author: 'A', bible: huge });
  assert.ok(block.length < 20000, 'long bible is truncated');
});
