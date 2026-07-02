/**
 * Tests for bug-review finding #4: word-target continuation passes must show the
 * model its own draft. runWordTargetContinuation now hands the accumulated text
 * to the continue callback, and continuationAnchor wraps its tail for the prompt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWordTargetContinuation, continuationAnchor } from '../../gateway/src/util/generation-step.js';

test('continuationAnchor wraps the tail of the draft and instructs no-repeat', () => {
  const draft = 'A'.repeat(5000) + 'THE-VERY-END-OF-THE-CHAPTER';
  const anchor = continuationAnchor(draft, 100);
  assert.match(anchor, /THE-VERY-END-OF-THE-CHAPTER/, 'includes the tail');
  assert.ok(!anchor.includes('A'.repeat(200)), 'only the tail, not the whole draft');
  assert.match(anchor, /do NOT repeat/i);
});

test('continuationAnchor is empty when there is no prior prose', () => {
  assert.equal(continuationAnchor(''), '');
  assert.equal(continuationAnchor('   \n\t'), '');
});

test('runWordTargetContinuation passes the accumulated text to the continue callback', async () => {
  const seen: string[] = [];
  const result = await runWordTargetContinuation({
    initialText: 'Chapter start. ' + 'word '.repeat(10), // ~12 words
    wordCountTarget: 200,
    maxPasses: 5,
    continue: async ({ textSoFar, pass }) => {
      seen.push(textSoFar);
      // Return a chunk >MIN_CONTINUATION_CHARS (100) so it appends and loops;
      // vary it per pass so overlap-dedup never drops the whole thing.
      return `Continuation pass ${pass}: the scene continues onward through new prose that carries the narrative forward across many additional words of story. `.repeat(2);
    },
  });
  assert.ok(seen.length >= 1, 'the continue callback ran at least once');
  // First pass must see the initial draft; a later pass must see the grown draft.
  assert.match(seen[0], /Chapter start/, 'first pass sees the initial draft tail');
  assert.ok(seen.length > 1, 'the continuation loops more than once for this target');
  assert.ok(seen[1].length > seen[0].length, 'later pass sees the accumulated (longer) draft');
  assert.ok(result.passes >= 1);
});
