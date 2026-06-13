/**
 * Unit tests for gateway/src/util/wordcount.ts — the word-count + continuation
 * de-dupe helpers shared by the project execution loops. Network-free, pure.
 *
 * The overlap de-dupe in appendContinuation is the bug-prone part: it finds the
 * longest suffix of `existing` that is also a prefix of the (left-trimmed)
 * continuation and drops it before joining, but only down to a 40-char floor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countWords, appendContinuation, MAX_CONTINUATION_PASSES } from '../../gateway/src/util/wordcount.js';

test('countWords: empty string is 0', () => {
  assert.equal(countWords(''), 0);
});

test('countWords: whitespace-only string is 0', () => {
  assert.equal(countWords('   \n\t  '), 0);
});

test('countWords: ignores leading/trailing whitespace and multiple spaces', () => {
  assert.equal(countWords('  hello   world  '), 2);
  assert.equal(countWords('one\t\ttwo\n\nthree'), 3);
  assert.equal(countWords('single'), 1);
});

test('appendContinuation: no overlap joins with a blank-line separator', () => {
  // Both sides shorter than the 40-char floor → no overlap is even considered.
  const out = appendContinuation('First part.', 'Second part.');
  assert.equal(out, 'First part.\n\nSecond part.');
});

test('appendContinuation: left-trims the continuation before joining', () => {
  const out = appendContinuation('abc', '   xyz');
  assert.equal(out, 'abc\n\nxyz');
});

test('appendContinuation: trims a duplicated tail/head overlap (no doubled paragraph)', () => {
  // overlap must be >= 40 chars to be detected.
  const overlap = 'The quick brown fox jumped over the lazy dog.'; // 45 chars
  const existing = 'Opening sentence that sets things up. ' + overlap;
  const continuation = overlap + ' And then the story continued onward.';
  const out = appendContinuation(existing, continuation);
  // The repeated overlap appears exactly once.
  const firstIdx = out.indexOf(overlap);
  const lastIdx = out.lastIndexOf(overlap);
  assert.equal(firstIdx, lastIdx, 'overlap should appear exactly once');
  assert.equal(out, existing + ' And then the story continued onward.');
});

test('appendContinuation: a fully-duplicate continuation does not double the text', () => {
  // continuation === existing, and existing is long enough that the whole thing
  // is the overlap (capped at min(2000, len, len)).
  const existing = 'X'.repeat(120);
  const out = appendContinuation(existing, existing);
  assert.equal(out, existing, 'duplicate continuation should be fully trimmed');
});

test('appendContinuation: short overlap (< 40 chars) is NOT trimmed — falls through to separator', () => {
  // A real shared tail/head but under the 40-char floor: dedupe is intentionally
  // skipped, so the two are joined verbatim with the separator.
  const existing = 'ends with tail';
  const continuation = 'tail then more';
  const out = appendContinuation(existing, continuation);
  assert.equal(out, existing + '\n\n' + continuation);
});

test('appendContinuation: empty/short inputs are safe', () => {
  assert.equal(appendContinuation('', ''), '\n\n');
  assert.equal(appendContinuation('abc', ''), 'abc\n\n');
  assert.equal(appendContinuation('', 'abc'), '\n\nabc');
});

test('MAX_CONTINUATION_PASSES is the documented cap', () => {
  assert.equal(MAX_CONTINUATION_PASSES, 6);
});
