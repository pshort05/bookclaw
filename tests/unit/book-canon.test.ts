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
import { formatCanonBlock, extractPovDirective, isStyleRefFile } from '../../gateway/src/services/book-canon.js';

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

// run-review #1: pin the narrative POV so chapters don't flip 1st↔3rd person.
test('formatCanonBlock pins the POV directive + a do-not-switch-person rule', () => {
  const block = formatCanonBlock({
    title: 'T', author: 'A',
    pov: 'Third-person limited, deep POV, one POV character per chapter.',
  });
  assert.match(block, /third-person limited/i);
  assert.match(block, /\bPOV\b|point of view/i);
  // hard rule against switching narrative person between chapters
  assert.match(block, /(do not|don't|never).{0,40}(switch|change).{0,30}(person|narrat|POV)/i);
});

// run-review #2 + #8: reuse already-established names/ages; name-once for unnamed.
test('formatCanonBlock rule forbids inventing a second name for an existing entity', () => {
  const block = formatCanonBlock({ title: 'T', author: 'A', bible: 'Hero: Silas.' });
  assert.match(block, /reuse|already (established|named)|same name/i);
  assert.match(block, /name (it|them) once|do not invent (a )?(new|second|different) name/i);
});

test('extractPovDirective pulls the POV sentence from a style reference', () => {
  const style = [
    '## Voice', 'The tone is warm and accessible.',
    '## POV', 'The novel uses third-person limited, deep point of view, one POV per chapter.',
    'Internal thoughts are italicized.',
  ].join('\n');
  const pov = extractPovDirective(style);
  assert.match(pov, /third-person limited/i);
  // returns '' when the style text says nothing about POV
  assert.equal(extractPovDirective('Just tone notes, nothing about narration.'), '');
  assert.equal(extractPovDirective(''), '');
});

test('first-person style reference is captured too (so the rule matches the book)', () => {
  const pov = extractPovDirective('Narration: first-person, present tense, single narrator.');
  assert.match(pov, /first-person/i);
});

// review #2: don't pin an ABANDONED POV mentioned before the real one.
test('extractPovDirective skips an abandoned POV and picks the one in force', () => {
  const style = 'The earlier draft used first-person, which we dropped. Now write in third-person limited.';
  assert.match(extractPovDirective(style), /third-person/i);
  // if every mention is negated, return '' rather than a wrong pin
  assert.equal(extractPovDirective('We no longer use first-person here.'), '');
});

// review #1: a POV-only canon (no title/bible yet) must still emit the block.
test('formatCanonBlock emits a block when only a POV is pinned', () => {
  const block = formatCanonBlock({ pov: 'Third-person limited, one POV per chapter.' });
  assert.notEqual(block, '');
  assert.match(block, /third-person limited/i);
});

// review #5: style-ref filename match is anchored (excludes "lifestyle.md").
test('isStyleRefFile matches real style refs and not incidental names', () => {
  assert.equal(isStyleRefFile('project-56-step-5-style-tone-reference.md'), true);
  assert.equal(isStyleRefFile('style-guide.md'), true);
  assert.equal(isStyleRefFile('lifestyle.md'), false);
  assert.equal(isStyleRefFile('character-bible.md'), false);
});
