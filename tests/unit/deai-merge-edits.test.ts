import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeWindowEdits } from '../../gateway/src/services/deai/merge-edits.js';
import type { DeAiEdit } from '../../gateway/src/services/deterministic-apply.js';

test('unions windows and drops duplicate finds', () => {
  const a: DeAiEdit[] = [{ op: 'swap', find: 'utilized', replace: 'used' }];
  const b: DeAiEdit[] = [
    { op: 'swap', find: 'utilized', replace: 'used' },        // dup of a[0]
    { op: 'swap', find: 'myriad', replace: 'many' },
  ];
  const merged = mergeWindowEdits([a, b]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map(e => e.find), ['utilized', 'myriad']);
});

test('empty windows → empty list', () => {
  assert.deepEqual(mergeWindowEdits([[], []]), []);
});
