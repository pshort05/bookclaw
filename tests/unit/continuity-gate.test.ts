/**
 * Contradiction force-gate arithmetic (consistency-feedback design, Feature 2).
 * Pure: counting, threshold resolution, and the gate predicate — no project,
 * no HTTP, no env mutation beyond what each case passes in explicitly.
 *
 * Run: node --import tsx --test tests/unit/continuity-gate.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTRADICTION_GATE_DEFAULT,
  CONTRADICTION_FINDING_MAX_CHARS,
  CONTRADICTION_FINDING_MAX_FLAGS,
  countContradictions,
  describeContradictions,
  resolveThreshold,
  shouldForceGate,
} from '../../gateway/src/services/consistency/continuity-gate.js';

// ── countContradictions ─────────────────────────────────────────────────────

test('countContradictions counts only kind === "contradiction"', () => {
  const flags = [
    { kind: 'contradiction', detail: 'eye colour changed' },
    { kind: 'knowledge', detail: 'knows a secret she was never told' },
    { kind: 'timeline', detail: 'Tuesday twice' },
    { kind: 'contradiction', detail: 'the bar is on the other street' },
    { kind: 'red_herring', detail: 'reserved kind' },
  ];
  assert.equal(countContradictions(flags), 2);
});

test('countContradictions is 0 for undefined / empty / non-array input', () => {
  assert.equal(countContradictions(undefined), 0);
  assert.equal(countContradictions([]), 0);
  assert.equal(countContradictions('nope' as any), 0);
  assert.equal(countContradictions([{} as any, null as any]), 0);
});

// ── resolveThreshold ────────────────────────────────────────────────────────

test('resolveThreshold defaults to 6', () => {
  assert.equal(CONTRADICTION_GATE_DEFAULT, 6);
  assert.equal(resolveThreshold(undefined), 6);
  assert.equal(resolveThreshold(''), 6);
  assert.equal(resolveThreshold('   '), 6);
});

test('resolveThreshold honours an integer override', () => {
  assert.equal(resolveThreshold('3'), 3);
  assert.equal(resolveThreshold(' 12 '), 12);
});

test('resolveThreshold treats 0 as "disabled"', () => {
  assert.equal(resolveThreshold('0'), 0);
});

// An operator typing `off`/`false`/`no` is trying to turn the gate OFF; the
// strict-integer parse used to fall back to 6 and turn it ON instead.
test('resolveThreshold treats off/false/no as disabled, case-insensitively', () => {
  for (const off of ['0', 'off', 'OFF', 'Off', 'false', 'FALSE', 'no', 'NO', ' off ']) {
    assert.equal(resolveThreshold(off), 0, `"${off}" should disable the gate`);
  }
});

test('resolveThreshold falls back to the default on garbage', () => {
  for (const bad of ['abc', '3.7', '-2', 'NaN', '1e3', '6six']) {
    assert.equal(resolveThreshold(bad), 6, `"${bad}" should fall back`);
  }
});

// ── shouldForceGate ─────────────────────────────────────────────────────────

test('shouldForceGate fires at or above the threshold', () => {
  assert.equal(shouldForceGate(5, 6), false);
  assert.equal(shouldForceGate(6, 6), true);
  assert.equal(shouldForceGate(7, 6), true);
  assert.equal(shouldForceGate(0, 6), false);
});

test('shouldForceGate never fires when the threshold is 0 (disabled)', () => {
  assert.equal(shouldForceGate(0, 0), false);
  assert.equal(shouldForceGate(99, 0), false);
});

// ── describeContradictions ──────────────────────────────────────────────────
// The gate payload renders each findings value as text (a non-string value is
// JSON.stringify'd into one unreadable line and, past ~300 chars, drags the
// WHOLE findings payload into a raw JSON block) — so this key ships as prose.

const manyContradictions = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ kind: 'contradiction' as const, detail: `contradiction ${i + 1}` }));

test('describeContradictions states the count, the threshold and the draft caveat', () => {
  const text = describeContradictions(
    [...manyContradictions(2), { kind: 'timeline', detail: 'Tuesday twice' } as any],
    6, 18,
  );
  assert.match(text, /^2 contradictions in chapter 18\b/);
  assert.match(text, /threshold of 6/);
  assert.match(text, /found in the draft/i);
  assert.match(text, /rewrite pass may have/i);
  assert.match(text, /^- contradiction 1$/m);
  assert.match(text, /^- contradiction 2$/m);
  assert.doesNotMatch(text, /Tuesday twice/, 'only contradictions are listed');
});

test('describeContradictions caps the list at 10 flags and the string at 1200 chars', () => {
  assert.equal(CONTRADICTION_FINDING_MAX_FLAGS, 10);
  assert.equal(CONTRADICTION_FINDING_MAX_CHARS, 1200);
  const text = describeContradictions(manyContradictions(25), 6, 3);
  assert.equal(text.split('\n').filter((l) => l.startsWith('- ')).length, 10);
  assert.match(text, /\+15 more/);
  assert.ok(text.length <= 1200, `expected <= 1200 chars, got ${text.length}`);

  const huge = describeContradictions(
    Array.from({ length: 10 }, (_, i) => ({ kind: 'contradiction' as const, detail: 'x'.repeat(400) + i })),
    6, 3,
  );
  assert.ok(huge.length <= 1200, `expected <= 1200 chars, got ${huge.length}`);
});

test('describeContradictions is a plain string even with no usable details', () => {
  const text = describeContradictions([{ kind: 'contradiction' } as any], 6);
  assert.equal(typeof text, 'string');
  assert.match(text, /^1 contradiction —/);
});

test('describeContradictions truncates on a whole line, not mid-sentence', () => {
  const long = Array.from({ length: 9 }, (_, i) =>
    ({ kind: 'contradiction' as const, detail: `Gia Ferraro's current_location is both "A${i}" and "B${i}" at the same point in the story.`.padEnd(200, '.') }));
  const text = describeContradictions(long, 6, 18);
  assert.ok(text.length <= CONTRADICTION_FINDING_MAX_CHARS);
  assert.match(text, /… \(truncated\)$/);
  for (const line of text.split('\n').slice(1, -1)) {
    assert.match(line, /\.+$/, 'every listed flag line is whole');
  }
});
