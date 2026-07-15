import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBannedTermsForBook } from '../../gateway/src/services/deai/banned-terms.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'deai-loader-')); }

test('missing global + seed absent → empty registry (no-op)', () => {
  const ws = tmp();
  try {
    const b = loadBannedTermsForBook(ws, 'my-book', join(ws, 'no-seed.csv'));
    assert.deepEqual(b, { fixed: [], banOnly: [] });
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('seed is copied to global on first load (create-if-absent)', () => {
  const ws = tmp();
  const seed = join(ws, 'seed.csv');
  writeFileSync(seed, 'find,replace\nphone buzzed,phone vibrated\ndelve,\n');
  try {
    const b = loadBannedTermsForBook(ws, 'my-book', seed);
    assert.ok(existsSync(join(ws, '.config', 'banned-terms.csv')), 'global created from seed');
    assert.deepEqual(b.fixed, [{ find: 'phone buzzed', replace: 'phone vibrated' }]);
    assert.deepEqual(b.banOnly, ['delve']);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('per-book overlay overrides the global by find', () => {
  const ws = tmp();
  mkdirSync(join(ws, '.config'), { recursive: true });
  writeFileSync(join(ws, '.config', 'banned-terms.csv'), 'find,replace\nphone buzzed,phone vibrated\n');
  mkdirSync(join(ws, 'books', 'my-book'), { recursive: true });
  writeFileSync(join(ws, 'books', 'my-book', 'banned-terms.csv'), 'find,replace\nPhone Buzzed,phone rang\n');
  try {
    const b = loadBannedTermsForBook(ws, 'my-book', join(ws, 'no-seed.csv'));
    assert.deepEqual(b.fixed, [{ find: 'Phone Buzzed', replace: 'phone rang' }]);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('existing global is never overwritten by the seed', () => {
  const ws = tmp();
  mkdirSync(join(ws, '.config'), { recursive: true });
  writeFileSync(join(ws, '.config', 'banned-terms.csv'), 'find,replace\nkept,retained\n');
  const seed = join(ws, 'seed.csv');
  writeFileSync(seed, 'find,replace\nphone buzzed,phone vibrated\n');
  try {
    const b = loadBannedTermsForBook(ws, 'my-book', seed);
    assert.deepEqual(b.fixed, [{ find: 'kept', replace: 'retained' }]);
    assert.equal(readFileSync(join(ws, '.config', 'banned-terms.csv'), 'utf8').includes('kept'), true);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});
