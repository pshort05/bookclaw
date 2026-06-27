/**
 * Unit tests for computeFindingId (gateway/src/services/consistency/finding-id.ts):
 * a deterministic 16-char sha256 hash over a finding's identifying fields. Covers:
 * the id is stable across repeated calls for the same finding, and distinct
 * findings (differing in category, entity, chapter, or quote) get distinct ids.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeFindingId } from '../../gateway/src/services/consistency/finding-id.js';
import type { ConsistencyFinding } from '../../gateway/src/services/consistency/types.js';

function base(): ConsistencyFinding {
  return {
    category: 'contradiction',
    severity: 'high',
    entity: 'Elena Voss',
    attribute: 'eye_color',
    a: { chapter: 'chapter-3', scene: 1, quote: 'her green eyes' },
    b: { chapter: 'chapter-1', scene: 0, quote: 'her blue eyes' },
    explanation: 'eye color changed',
    suggestedFix: 'reconcile',
  };
}

describe('computeFindingId', () => {
  test('is stable across repeated calls for the same finding', () => {
    const f = base();
    const id1 = computeFindingId(f);
    const id2 = computeFindingId(base());
    assert.equal(id1, id2);
  });

  test('returns a 16-char hex string', () => {
    const id = computeFindingId(base());
    assert.match(id, /^[0-9a-f]{16}$/);
  });

  test('differs when category differs', () => {
    const f = base();
    f.category = 'continuity';
    assert.notEqual(computeFindingId(f), computeFindingId(base()));
  });

  test('differs when entity differs', () => {
    const f = base();
    f.entity = 'John Marsh';
    assert.notEqual(computeFindingId(f), computeFindingId(base()));
  });

  test('differs when a.chapter differs', () => {
    const f = base();
    f.a = { ...f.a, chapter: 'chapter-9' };
    assert.notEqual(computeFindingId(f), computeFindingId(base()));
  });

  test('differs when a.quote differs', () => {
    const f = base();
    f.a = { ...f.a, quote: 'her hazel eyes' };
    assert.notEqual(computeFindingId(f), computeFindingId(base()));
  });

  test('distinguishes a canon b-ref (canonSource) from a chapter b-ref', () => {
    const chap = base();
    const canon: ConsistencyFinding = {
      ...base(),
      b: { canonSource: 'Series bible', quote: 'her blue eyes' },
    };
    assert.notEqual(computeFindingId(chap), computeFindingId(canon));
  });

  test('never throws', () => {
    const f = base();
    assert.doesNotThrow(() => computeFindingId(f));
  });
});
