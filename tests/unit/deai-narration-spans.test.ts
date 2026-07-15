import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protectedRanges, isProtected } from '../../gateway/src/services/deai/narration-spans.js';

test('quoted dialogue spans are protected', () => {
  const t = 'She said "the phone buzzed loudly" and left.';
  const r = protectedRanges(t);
  const inside = t.indexOf('phone');
  assert.equal(isProtected(r, inside), true);
  const outside = t.indexOf('left');
  assert.equal(isProtected(r, outside), false);
});

test('markdown header, hrule, and italic markers are protected', () => {
  const t = '# Chapter One\n\n---\n\nShe was *very* tired.';
  const r = protectedRanges(t);
  assert.equal(isProtected(r, t.indexOf('Chapter')), true, 'header line');
  assert.equal(isProtected(r, t.indexOf('---')), true, 'hrule');
  assert.equal(isProtected(r, t.indexOf('very')), true, 'italic span');
  assert.equal(isProtected(r, t.indexOf('tired')), false, 'plain narration');
});

test('curly quotes are protected', () => {
  const t = 'He whispered “delve deeper” then paused.';
  assert.equal(isProtected(protectedRanges(t), t.indexOf('delve')), true);
});
