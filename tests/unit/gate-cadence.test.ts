/**
 * Human-Gate Cadence (Flagship Plan 5, Task 1): pure cadence resolution +
 * boundary gating + boundary detection. No I/O.
 *
 * Run: node --import tsx --test tests/unit/gate-cadence.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCadence, shouldGate, isActBoundary, computeBoundaries,
  type Cadence, type Boundary,
} from '../../gateway/src/services/pipeline/gate-cadence.js';

// ── resolveCadence ──────────────────────────────────────────────────────────

test('resolveCadence: book value wins over author and genre defaults', () => {
  assert.equal(resolveCadence({ review: { cadence: 'autonomous' } }, 'per_chapter', 'outline_only'), 'autonomous');
});

test('resolveCadence: author default wins when the book has no explicit cadence', () => {
  assert.equal(resolveCadence({}, 'per_chapter', 'outline_only'), 'per_chapter');
  assert.equal(resolveCadence(undefined, 'per_chapter', 'outline_only'), 'per_chapter');
});

test('resolveCadence: genre default wins when book and author are both unset', () => {
  assert.equal(resolveCadence({}, undefined, 'outline_only'), 'outline_only');
});

test('resolveCadence: falls back to per_act when nothing is set (backward compatible)', () => {
  assert.equal(resolveCadence(), 'per_act');
  assert.equal(resolveCadence(null), 'per_act');
  assert.equal(resolveCadence({}), 'per_act');
  assert.equal(resolveCadence({ review: {} }), 'per_act');
});

// ── shouldGate: table test every (cadence, boundary) pair ──────────────────

const CADENCES: Cadence[] = ['per_act', 'per_chapter', 'outline_only', 'autonomous'];
const BOUNDARIES: Boundary[] = ['outline_approved', 'chapter', 'act', 'pre_export'];

const EXPECTED: Record<Cadence, Record<Boundary, boolean>> = {
  per_act:       { outline_approved: true, chapter: false, act: true,  pre_export: true },
  per_chapter:   { outline_approved: true, chapter: true,  act: false, pre_export: true },
  outline_only:  { outline_approved: true, chapter: false, act: false, pre_export: true },
  autonomous:    { outline_approved: true, chapter: false, act: false, pre_export: true },
};

for (const cadence of CADENCES) {
  for (const boundary of BOUNDARIES) {
    test(`shouldGate(${cadence}, ${boundary}) === ${EXPECTED[cadence][boundary]}`, () => {
      assert.equal(shouldGate(cadence, boundary), EXPECTED[cadence][boundary]);
    });
  }
}

// ── isActBoundary (adaptation: no explicit act metadata exists on a step —
//    thirds-of-the-chapter-count is the pure, deterministic stand-in) ───────

test('isActBoundary: thirds of a 9-chapter book land on 3, 6, 9', () => {
  assert.equal(isActBoundary(3, 9), true);
  assert.equal(isActBoundary(6, 9), true);
  assert.equal(isActBoundary(9, 9), true);
  assert.equal(isActBoundary(1, 9), false);
  assert.equal(isActBoundary(4, 9), false);
  assert.equal(isActBoundary(8, 9), false);
});

test('isActBoundary: the final chapter is always a boundary', () => {
  assert.equal(isActBoundary(10, 10), true);
  assert.equal(isActBoundary(1, 1), true);
});

test('isActBoundary: invalid input is never a boundary', () => {
  assert.equal(isActBoundary(0, 9), false);
  assert.equal(isActBoundary(-1, 9), false);
  assert.equal(isActBoundary(3, 0), false);
  assert.equal(isActBoundary(NaN, 9), false);
});

// ── computeBoundaries: derives boundary labels from real step shapes ───────

function chapters(n: number): Array<{ phase: string; chapterNumber: number }> {
  return Array.from({ length: n }, (_, i) => ({ phase: 'writing', chapterNumber: i + 1 }));
}

test('computeBoundaries: an ordinary chapter is only a "chapter" boundary', () => {
  const steps = chapters(9);
  assert.deepEqual(computeBoundaries(3, steps), ['chapter']); // chapter 4 of 9
});

test('computeBoundaries: an act-ending chapter is both "chapter" and "act"', () => {
  const steps = chapters(9);
  assert.deepEqual(computeBoundaries(2, steps), ['chapter', 'act']); // chapter 3 of 9
  assert.deepEqual(computeBoundaries(8, steps), ['chapter', 'act']); // chapter 9 of 9
});

test('computeBoundaries: the last role/skill=outline step is "outline_approved"', () => {
  const steps = [
    { role: 'outline' }, { skill: 'outline' }, ...chapters(3),
  ];
  assert.deepEqual(computeBoundaries(1, steps), ['outline_approved']);
  assert.deepEqual(computeBoundaries(0, steps), []); // first outline step, not the last
});

test('computeBoundaries: the last revision-phase step is "pre_export" when an assembly step follows', () => {
  const steps = [
    ...chapters(2),
    { phase: 'revision' }, { phase: 'revision' },
    { phase: 'assembly' },
  ];
  assert.deepEqual(computeBoundaries(3, steps), ['pre_export']);
  assert.deepEqual(computeBoundaries(2, steps), []); // first revision step, not the last
});

test('computeBoundaries: with no revision phase, the last writing step is "pre_export" too', () => {
  const steps = [...chapters(3), { phase: 'assembly' }];
  assert.deepEqual(computeBoundaries(2, steps), ['chapter', 'act', 'pre_export']); // chapter 3 of 3
});

test('computeBoundaries: with no assembly step downstream, pre_export never fires', () => {
  const steps = [...chapters(2), { phase: 'revision' }];
  assert.deepEqual(computeBoundaries(2, steps), []);
});

test('computeBoundaries: an out-of-range index returns no boundaries', () => {
  assert.deepEqual(computeBoundaries(99, chapters(3)), []);
  assert.deepEqual(computeBoundaries(-1, chapters(3)), []);
});
