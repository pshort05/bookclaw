/**
 * Unit tests for checkZipBudget's size-0-with-payload guard (bug L14).
 *
 * A crafted zip can patch its central/local uncompressed-size fields to 0. That
 * defeats adm-zip's per-entry inflation cap (which only sets zlib
 * maxOutputLength when the declared size > 0), so a small compressed payload can
 * inflate to a bomb in memory before any BookClaw guard fires. checkZipBudget
 * must reject an entry that declares empty but carries a compressed payload.
 *
 * Run: node --import tsx --test tests/unit/transfer-security-zip-budget.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkZipBudget } from '../../gateway/src/services/transfer-security.js';

test('rejects the size-0-with-payload lie (defeats adm-zip inflation cap)', () => {
  const err = checkZipBudget([{ isDirectory: false, header: { size: 0, compressedSize: 100000 } }]);
  assert.equal(typeof err, 'string');
  assert.ok(err && err.length > 0);
});

test('allows a legitimately empty entry (size 0, no payload)', () => {
  assert.equal(checkZipBudget([{ isDirectory: false, header: { size: 0, compressedSize: 0 } }]), null);
});

test('allows a normal entry (declared size > 0)', () => {
  assert.equal(checkZipBudget([{ isDirectory: false, header: { size: 1024, compressedSize: 200 } }]), null);
});
