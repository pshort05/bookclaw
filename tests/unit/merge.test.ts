/**
 * Unit tests for the pure 3-way text merge helper used by book re-pull.
 * Run via: npm run test:unit  (node --test through tsx)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeText } from '../../gateway/src/services/merge.js';

test('disjoint edits merge cleanly (no conflict)', () => {
  const base = 'line1\nline2\nline3\n';
  const book = 'BOOK\nline2\nline3\n';      // edited line1
  const library = 'line1\nline2\nLIB\n';    // edited line3
  const { merged, hadConflicts } = mergeText(base, book, library);
  assert.equal(hadConflicts, false);
  assert.ok(merged.includes('BOOK'));
  assert.ok(merged.includes('LIB'));
});

test('overlapping edits produce git-style conflict markers', () => {
  const base = 'line1\nline2\nline3\n';
  const book = 'line1\nBOOKEDIT\nline3\n';
  const library = 'line1\nLIBEDIT\nline3\n';
  const { merged, hadConflicts } = mergeText(base, book, library);
  assert.equal(hadConflicts, true);
  assert.ok(merged.includes('<<<<<<< book'));
  assert.ok(merged.includes('>>>>>>> library'));
  assert.ok(merged.includes('BOOKEDIT'));
  assert.ok(merged.includes('LIBEDIT'));
});

test('identical edits on both sides do not conflict', () => {
  const base = 'a\nb\n';
  const same = 'a\nCHANGED\n';
  const { merged, hadConflicts } = mergeText(base, same, same);
  assert.equal(hadConflicts, false);
  assert.ok(merged.includes('CHANGED'));
});
