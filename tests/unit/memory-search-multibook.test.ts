/**
 * Regression test for bug-review finding #24: reindexAll indexed only the single
 * globally-active book's data/ dir, so a concurrently-run non-active book's
 * chapters were never searchable. It must index EVERY book's data dir. Requires
 * better-sqlite3 (native) — skips the assertions gracefully when unavailable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySearchService } from '../../gateway/src/services/memory-search.js';

test('reindexAll indexes every book data dir, not just the active one (finding 24)', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'bc-multibook-'));
  try {
    const bookA = join(ws, 'books', 'a', 'data');
    const bookB = join(ws, 'books', 'b', 'data');
    mkdirSync(bookA, { recursive: true });
    mkdirSync(bookB, { recursive: true });
    // Distinct, searchable content in each book.
    writeFileSync(join(bookA, 'projA-step-1-chapter.md'), '# Chapter\n\nAARDVARK_UNIQUE_TOKEN appears only in book A.');
    writeFileSync(join(bookB, 'projB-step-1-chapter.md'), '# Chapter\n\nZEBRA_UNIQUE_TOKEN appears only in book B.');

    const svc = new MemorySearchService(ws, mkdtempSync(join(tmpdir(), 'bc-multibook-db-')));
    await svc.initialize();
    if (!svc.isAvailable()) return; // no native binary on this host — skip assertions

    // Resolver returns BOTH book data dirs (book B is the "non-active" one).
    svc.setDataDirsResolver(() => [bookA, bookB]);
    const { indexed } = await svc.reindexAll({ force: true });
    assert.ok(indexed >= 2, `expected both books indexed, got ${indexed}`);

    const aHits = svc.search('AARDVARK_UNIQUE_TOKEN');
    const bHits = svc.search('ZEBRA_UNIQUE_TOKEN');
    assert.ok(aHits.length > 0, 'book A content is searchable');
    assert.ok(bHits.length > 0, 'book B (non-active) content is searchable');
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
