/**
 * Unit tests for the configurable FTS-index DB location (BOOKCLAW_DB_DIR).
 * Pure path resolution — no better-sqlite3 / native dependency required, so it
 * runs everywhere. Verifies the DB can be relocated off the workspace while the
 * conversation source dir it indexes stays in the workspace.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySearchService } from '../../gateway/src/services/memory-search.js';

test('DB defaults inside the workspace when no dbDir is given', () => {
  const ws = '/some/workspace';
  const svc = new MemorySearchService(ws);
  assert.equal(svc.getDbPath(), join(ws, 'memory', 'memory-search.db'));
});

test('DB relocates to dbDir when provided, keeping the same basename', () => {
  const ws = '/some/workspace';
  const dbDir = '/local/disk/bookclaw-db';
  const svc = new MemorySearchService(ws, dbDir);
  assert.equal(svc.getDbPath(), join(dbDir, 'memory-search.db'));
  // The relocated DB must NOT be under the (possibly synced) workspace.
  assert.ok(!svc.getDbPath().startsWith(join(ws, 'memory')));
});

test('initialize() creates the DB under the relocated dir, not the workspace', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'bc-ws-'));
  const dbDir = mkdtempSync(join(tmpdir(), 'bc-db-'));
  try {
    const svc = new MemorySearchService(ws, dbDir);
    await svc.initialize();
    if (svc.isAvailable()) {
      // better-sqlite3 present → the DB file lands in the relocated dir only.
      assert.ok(existsSync(join(dbDir, 'memory-search.db')), 'DB created in dbDir');
      assert.ok(!existsSync(join(ws, 'memory', 'memory-search.db')), 'no DB in workspace');
    } else {
      // No native binary on this host — service degrades gracefully; path still resolves.
      assert.equal(svc.getDbPath(), join(dbDir, 'memory-search.db'));
    }
  } finally {
    rmSync(ws, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  }
});
