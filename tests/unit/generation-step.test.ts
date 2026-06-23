/**
 * Unit tests for the extracted generation-step helpers (coverage Batch B). These
 * pull the previously-inline, untested generation-loop logic — the multi-pass
 * word-target continuation and the [AI provider failure]/too-short response
 * classification — out of index.ts + projects.routes.ts into a deterministically
 * testable seam with an injected continuation fn (no AI provider needed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStepResponse, runWordTargetContinuation } from '../../gateway/src/util/generation-step.js';
import { MAX_CONTINUATION_PASSES, countWords } from '../../gateway/src/util/wordcount.js';

// A long, distinct continuation chunk (>100 chars, no 40-char overlap with the
// seeds below, so appendContinuation joins rather than dedupes).
const LONG = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '); // 40 words, >100 chars

// ── classifyStepResponse ──────────────────────────────────────────────

test('classifyStepResponse flags the [AI provider failure] sentinel and extracts the detail', () => {
  const c = classifyStepResponse('[AI provider failure]\nPrimary (ollama): boom\nFallback (gemini): bust');
  assert.equal(c.ok, false);
  assert.equal(c.providerFailure, true);
  assert.ok(c.detail && c.detail.startsWith('Primary (ollama): boom'), `detail was: ${c.detail}`);
});

test('classifyStepResponse caps the provider-failure detail at 500 chars', () => {
  const c = classifyStepResponse('[AI provider failure] ' + 'x'.repeat(900));
  assert.equal(c.providerFailure, true);
  assert.ok((c.detail?.length ?? 0) <= 500);
});

test('classifyStepResponse treats empty/undefined/too-short as a non-provider failure', () => {
  for (const r of ['', undefined, null, 'short']) {
    const c = classifyStepResponse(r as any);
    assert.equal(c.ok, false, `${JSON.stringify(r)} should be not-ok`);
    assert.ok(!c.providerFailure, `${JSON.stringify(r)} should not be a providerFailure`);
    assert.ok(c.reason, `${JSON.stringify(r)} should carry a reason`);
  }
});

test('classifyStepResponse uses a <50-char boundary by default (50 passes, 49 fails)', () => {
  assert.equal(classifyStepResponse('a'.repeat(49)).ok, false);
  assert.equal(classifyStepResponse('a'.repeat(50)).ok, true);
});

test('classifyStepResponse honors a custom minChars', () => {
  assert.equal(classifyStepResponse('abcdefghijk', { minChars: 10 }).ok, true); // 11 >= 10
  assert.equal(classifyStepResponse('abc', { minChars: 10 }).ok, false);
});

// ── runWordTargetContinuation ─────────────────────────────────────────

test('runWordTargetContinuation is a no-op when already at/over target', async () => {
  let called = 0;
  const r = await runWordTargetContinuation({
    initialText: 'one two three four five',  // 5 words
    wordCountTarget: 5,
    continue: async () => { called++; return LONG; },
  });
  assert.equal(called, 0);
  assert.equal(r.passes, 0);
  assert.equal(r.text, 'one two three four five');
  assert.equal(r.finalWordCount, 5);
});

test('runWordTargetContinuation appends until the word target is reached', async () => {
  const r = await runWordTargetContinuation({
    initialText: 'alpha beta gamma',   // 3 words
    wordCountTarget: 20,
    continue: async () => LONG,         // +40 words on the first pass
  });
  assert.equal(r.passes, 1);
  assert.ok(r.finalWordCount >= 20);
  assert.equal(r.finalWordCount, countWords(r.text));
  assert.ok(r.text.includes('alpha') && r.text.includes('word0'));
});

test('runWordTargetContinuation stops on a too-short continuation (<= minChars) without appending', async () => {
  const r = await runWordTargetContinuation({
    initialText: 'alpha beta',
    wordCountTarget: 100,
    continue: async () => 'tiny',       // < 100 default threshold → break
  });
  assert.equal(r.passes, 1);
  assert.equal(r.text, 'alpha beta');   // unchanged
});

test('runWordTargetContinuation stops (keeping prior text) when the continuation fn throws', async () => {
  const r = await runWordTargetContinuation({
    initialText: 'alpha beta',
    wordCountTarget: 100,
    continue: async () => { throw new Error('provider down'); },
  });
  assert.equal(r.passes, 1);
  assert.equal(r.text, 'alpha beta');
});

test('runWordTargetContinuation never exceeds MAX_CONTINUATION_PASSES', async () => {
  let called = 0;
  const r = await runWordTargetContinuation({
    initialText: 'x',
    wordCountTarget: 1_000_000,         // unreachable
    continue: async () => { called++; return LONG; },
  });
  assert.equal(r.passes, MAX_CONTINUATION_PASSES);
  assert.equal(called, MAX_CONTINUATION_PASSES);
});

test('runWordTargetContinuation honors a custom maxPasses', async () => {
  let called = 0;
  const r = await runWordTargetContinuation({
    initialText: 'x',
    wordCountTarget: 1_000_000,
    maxPasses: 2,
    continue: async () => { called++; return LONG; },
  });
  assert.equal(r.passes, 2);
  assert.equal(called, 2);
});

test('runWordTargetContinuation passes accurate progress (remaining/pass) to the continuation fn', async () => {
  const seen: Array<{ wordsSoFar: number; remaining: number; pass: number }> = [];
  await runWordTargetContinuation({
    initialText: 'a b c',               // 3 words
    wordCountTarget: 50,
    continue: async (ctx) => { seen.push(ctx); return LONG; },  // +40/pass
  });
  assert.equal(seen[0].pass, 1);
  assert.equal(seen[0].wordsSoFar, 3);
  assert.equal(seen[0].remaining, 47);
  // second pass starts at 3 + 40 = 43 words, 7 remaining
  assert.equal(seen[1].pass, 2);
  assert.equal(seen[1].wordsSoFar, 43);
  assert.equal(seen[1].remaining, 7);
});
