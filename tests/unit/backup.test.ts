/**
 * Unit tests for BackupService (book-container Phase 11): snapshot scope +
 * exclusions, keep-N prune, same-second naming, root-inside-workspace refusal,
 * restore (per-book + whole-workspace + pre-restore snapshot + version gate),
 * and cloud push (directory-drop zip, fail-soft layers, post-backup hook).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BackupService, SNAPSHOT_RE, type BackupCfg } from '../../gateway/src/services/backup.js';
import { BookService } from '../../gateway/src/services/book.js';
import { BOOK_SCHEMA_VERSION, classifyVersion } from '../../gateway/src/services/book-types.js';

function makeWorkspace(dir: string): void {
  mkdirSync(join(dir, 'books', 'alpha'), { recursive: true });
  writeFileSync(join(dir, 'books', 'alpha', 'book.json'),
    JSON.stringify({ schemaVersion: BOOK_SCHEMA_VERSION, slug: 'alpha', title: 'Alpha' }));
  mkdirSync(join(dir, 'books', 'alpha', 'data'), { recursive: true });
  writeFileSync(join(dir, 'books', 'alpha', 'data', 'draft.md'), 'original draft');
  mkdirSync(join(dir, 'library'), { recursive: true });
  writeFileSync(join(dir, 'library', 'entry.md'), 'lib');
  mkdirSync(join(dir, '.config'), { recursive: true });
  writeFileSync(join(dir, '.config', 'active-book.json'), '{"slug":"alpha"}');
  mkdirSync(join(dir, 'soul'), { recursive: true });
  writeFileSync(join(dir, 'soul', 'SOUL.md'), 'soul');
  mkdirSync(join(dir, 'memory'), { recursive: true });
  writeFileSync(join(dir, 'memory', 'notes.md'), 'notes');
  writeFileSync(join(dir, 'memory', 'index.sqlite'), 'binary');
  writeFileSync(join(dir, 'memory', 'memory-search.db'), 'binary'); // the live SQLite index (memory-search.ts)
  mkdirSync(join(dir, 'documents'), { recursive: true });
  writeFileSync(join(dir, 'documents', 'manuscript.md'), 'uploaded manuscript');
  mkdirSync(join(dir, '.bookclaw'), { recursive: true });
  writeFileSync(join(dir, '.bookclaw', 'workspace.json'), '{"schemaVersion":1}');
  mkdirSync(join(dir, '.vault'), { recursive: true });
  writeFileSync(join(dir, '.vault', 'vault.enc'), 'secret');
  mkdirSync(join(dir, '.audit'), { recursive: true });
  writeFileSync(join(dir, '.audit', '2026-06-12.jsonl'), '{}');
  mkdirSync(join(dir, 'audio'), { recursive: true });
  writeFileSync(join(dir, 'audio', 'x.mp3'), 'mp3');
}

describe('BackupService', () => {
  let ws: string, root: string, cfg: BackupCfg, svc: BackupService;

  beforeEach(async () => {
    ws = mkdtempSync(join(tmpdir(), 'bc-ws-'));
    root = mkdtempSync(join(tmpdir(), 'bc-bk-'));
    makeWorkspace(ws);
    cfg = {
      enabled: true, scope: 'standard', keep: 10, intervalHours: 24, onCompletion: true,
      cloud: { enabled: false, destinations: [], hook: null },
    };
    svc = new BackupService(ws, root, () => cfg, { appVersion: '1.2.3', workspaceSchemaVersion: 1 });
    await svc.initialize();
  });
  afterEach(() => { svc.stop(); rmSync(ws, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });

  test('standard snapshot includes books/library/.config/soul/memory/documents/.bookclaw, excludes vault/audit/audio/db files', async () => {
    const snap = await svc.snapshot('manual');
    const d = join(root, snap.name);
    assert.ok(existsSync(join(d, 'books', 'alpha', 'book.json')));
    assert.ok(existsSync(join(d, 'library', 'entry.md')));
    assert.ok(existsSync(join(d, '.config', 'active-book.json')));
    assert.ok(existsSync(join(d, 'soul', 'SOUL.md')));
    assert.ok(existsSync(join(d, 'memory', 'notes.md')));
    assert.ok(existsSync(join(d, 'documents', 'manuscript.md')));
    assert.ok(existsSync(join(d, '.bookclaw', 'workspace.json')));
    assert.ok(!existsSync(join(d, '.vault')));
    assert.ok(!existsSync(join(d, '.audit')));
    assert.ok(!existsSync(join(d, 'audio')));
    assert.ok(!existsSync(join(d, 'memory', 'index.sqlite')));
    assert.ok(!existsSync(join(d, 'memory', 'memory-search.db')));
    const meta = JSON.parse(readFileSync(join(d, 'snapshot.json'), 'utf-8'));
    assert.equal(meta.reason, 'manual');
    assert.equal(meta.scope, 'standard');
    assert.equal(meta.appVersion, '1.2.3');
    assert.equal(meta.workspaceSchemaVersion, 1);
  });

  test('full snapshot includes audio and vault.enc, still excludes sqlite/db', async () => {
    cfg.scope = 'full';
    const snap = await svc.snapshot('manual');
    const d = join(root, snap.name);
    assert.ok(existsSync(join(d, 'audio', 'x.mp3')));
    assert.ok(existsSync(join(d, '.vault', 'vault.enc'))); // offsite copy; key lives outside workspace
    assert.ok(!existsSync(join(d, 'memory', 'index.sqlite')));
    assert.ok(!existsSync(join(d, 'memory', 'memory-search.db')));
  });

  test('a leftover .tmp- dir is never listed as a snapshot', async () => {
    mkdirSync(join(root, '.tmp-2026-01-01T00-00-00'), { recursive: true });
    await svc.snapshot('manual');
    assert.equal(svc.list().length, 1);
  });

  test('11th snapshot prunes the oldest; non-matching dirs untouched', async () => {
    mkdirSync(join(root, 'my-unrelated-stuff'));
    const base = Date.parse('2026-06-12T00:00:00Z');
    for (let i = 0; i < 11; i++) await svc.snapshot('manual', new Date(base + i * 60_000));
    const names = svc.list().map(s => s.name);
    assert.equal(names.length, 10);
    assert.ok(!names.includes('2026-06-12T00-00-00')); // oldest pruned
    assert.ok(existsSync(join(root, 'my-unrelated-stuff')));
  });

  test('same-second snapshots get a padded suffix and stay ordered', async () => {
    const at = new Date('2026-06-12T01:00:00Z');
    const a = await svc.snapshot('manual', at);
    const b = await svc.snapshot('manual', at);
    assert.ok(SNAPSHOT_RE.test(a.name) && SNAPSHOT_RE.test(b.name));
    assert.ok(b.name > a.name); // lexicographic == chronological
  });

  test('backup root inside the workspace is refused', async () => {
    const bad = new BackupService(ws, join(ws, 'backups'), () => cfg);
    await assert.rejects(() => bad.initialize(), /inside the workspace/);
  });

  test('start() is a no-op when disabled', () => {
    cfg.enabled = false;
    assert.equal(svc.start(), false);
  });

  test('enabled=false: safeSnapshot writes nothing, but manual snapshot() still works', async () => {
    cfg.enabled = false;
    assert.equal(await svc.safeSnapshot('scheduled'), null);
    assert.equal(svc.list().length, 0);
    const snap = await svc.snapshot('manual'); // explicit user action stays allowed
    assert.ok(existsSync(join(root, snap.name)));
  });

  test('onCompletionSnapshot returns null when onCompletion=false', async () => {
    cfg.onCompletion = false;
    assert.equal(await svc.onCompletionSnapshot(), null);
    assert.equal(svc.list().length, 0);
  });

  test('restart() follows the live enabled flag', () => {
    cfg.enabled = false;
    assert.equal(svc.restart(), false);
    cfg.enabled = true;
    assert.equal(svc.restart(), true);
    svc.stop();
  });

  test('restoring a full snapshot widens the pre-restore snapshot to full scope', async () => {
    cfg.scope = 'full';
    const snap = await svc.snapshot('manual', new Date('2026-01-01T00:00:00Z'));
    cfg.scope = 'standard';
    const r = await svc.restore(snap.name);
    // pre-restore must cover what the full restore overwrote (e.g. audio/, outside STANDARD_TOPS)
    assert.ok(existsSync(join(root, r.preSnapshot, 'audio', 'x.mp3')));
  });

  test('BookService.initialize() resets stale in-memory bindings (restore safety)', async () => {
    // library is only used by create/repull — initialize/pointer paths are fs-only.
    const books = new BookService(join(ws, 'books'), null as any, '1.0.0');
    await books.initialize();
    assert.equal(books.getActiveBook(), 'alpha'); // from the fixture's active-book.json
    await books.setChannelBook('telegram:1', 'alpha');
    // Simulate a whole-workspace restore that removed the book and pointer files.
    rmSync(join(ws, 'books', 'alpha'), { recursive: true, force: true });
    rmSync(join(ws, '.config', 'active-book.json'), { force: true });
    rmSync(join(ws, '.config', 'channel-books.json'), { force: true });
    await books.initialize();
    assert.equal(books.getActiveBook(), null);
    assert.equal(books.getChannelBook('telegram:1'), null);
  });

  test('snapshotIfStale skips within the guard window', async () => {
    await svc.snapshot('manual');
    assert.equal(await svc.snapshotIfStale('on-completion'), null);
  });

  test('per-book restore round-trips a modified book and pre-snapshots first', async () => {
    const snap = await svc.snapshot('manual', new Date('2026-06-12T02:00:00Z'));
    writeFileSync(join(ws, 'books', 'alpha', 'data', 'draft.md'), 'MANGLED');
    const r = await svc.restore(snap.name, { book: 'alpha' });
    assert.equal(readFileSync(join(ws, 'books', 'alpha', 'data', 'draft.md'), 'utf-8'), 'original draft');
    assert.equal(r.restartRecommended, false);
    // the pre-restore snapshot exists and captured the mangled state
    const pre = svc.list().find(s => s.name === r.preSnapshot)!;
    assert.equal(readFileSync(join(root, pre.name, 'books', 'alpha', 'data', 'draft.md'), 'utf-8'), 'MANGLED');
  });

  test('at keep=1 the pre-restore snapshot must not prune the restore source', async () => {
    cfg.keep = 1;
    const snap = await svc.snapshot('manual', new Date('2026-01-01T00:00:00Z')); // safely older than the wall-clock pre-restore name
    writeFileSync(join(ws, 'books', 'alpha', 'data', 'draft.md'), 'MANGLED');
    const r = await svc.restore(snap.name, { book: 'alpha' });
    assert.equal(readFileSync(join(ws, 'books', 'alpha', 'data', 'draft.md'), 'utf-8'), 'original draft');
    // post-restore prune ran: only the (newer) pre-restore snapshot remains
    assert.deepEqual(svc.list().map(s => s.name), [r.preSnapshot]);
  });

  test('restore rejects unknown snapshot, bad slug, and book missing from snapshot', async () => {
    const snap = await svc.snapshot('manual', new Date('2026-06-12T03:00:00Z'));
    await assert.rejects(() => svc.restore('2099-01-01T00-00-00'), /Unknown snapshot/);
    await assert.rejects(() => svc.restore('../../etc' as any), /Unknown snapshot/);
    await assert.rejects(() => svc.restore(snap.name, { book: '../evil' }), /Invalid slug/);
    await assert.rejects(() => svc.restore(snap.name, { book: 'nope' }), /no book/);
  });

  test('whole-workspace restore restores soul + deleted book, never touches .vault/.audit', async () => {
    const snap = await svc.snapshot('manual', new Date('2026-06-12T04:00:00Z'));
    writeFileSync(join(ws, 'soul', 'SOUL.md'), 'corrupted');
    rmSync(join(ws, 'books', 'alpha'), { recursive: true });
    writeFileSync(join(ws, '.vault', 'sentinel'), 'live-secret');
    const r = await svc.restore(snap.name);
    assert.equal(readFileSync(join(ws, 'soul', 'SOUL.md'), 'utf-8'), 'soul');
    assert.ok(existsSync(join(ws, 'books', 'alpha', 'book.json')));
    assert.ok(existsSync(join(ws, '.vault', 'sentinel'))); // restore never deletes/overwrites .vault
    assert.equal(r.restartRecommended, true);
  });

  test('a restored too-old book classifies as quarantined (version gate intact)', async () => {
    mkdirSync(join(ws, 'books', 'old'), { recursive: true });
    writeFileSync(join(ws, 'books', 'old', 'book.json'), JSON.stringify({ schemaVersion: 0, slug: 'old', title: 'Old' }));
    const snap = await svc.snapshot('manual', new Date('2026-06-12T05:00:00Z'));
    rmSync(join(ws, 'books', 'old'), { recursive: true });
    await svc.restore(snap.name, { book: 'old' });
    const m = JSON.parse(readFileSync(join(ws, 'books', 'old', 'book.json'), 'utf-8'));
    assert.notEqual(classifyVersion(m.schemaVersion), 'ok'); // BookService.list() will gate it
    assert.equal(classifyVersion(m.schemaVersion), 'quarantined'); // schemaVersion 0 < BOOK_MIN_SUPPORTED (1)
  });

  test('cloud directory-drop lands a zip that excludes the vault', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'bc-cloud-'));
    try {
      cfg.cloud = { enabled: true, destinations: [dest], hook: null };
      const snap = await svc.snapshot('manual', new Date('2026-06-12T06:00:00Z'));
      const zipPath = join(dest, `${snap.name}.zip`);
      assert.ok(existsSync(zipPath));
      const AdmZip = (await import('adm-zip')).default;
      const entries = new AdmZip(zipPath).getEntries().map(e => e.entryName);
      assert.ok(entries.some(e => e.includes('books/alpha/book.json')));
      assert.ok(!entries.some(e => e.includes('.vault')));
      assert.ok(!existsSync(join(root, `.tmp-${snap.name}.zip`))); // tmp zip cleaned up
    } finally { rmSync(dest, { recursive: true, force: true }); }
  });

  test('cloud layer failure is fail-soft (bad destination does not break the snapshot)', async () => {
    cfg.cloud = { enabled: true, destinations: ['/nonexistent bad'], hook: null };
    const snap = await svc.snapshot('manual', new Date('2026-06-12T07:00:00Z'));
    assert.ok(existsSync(join(root, snap.name))); // local snapshot intact
    assert.equal(svc.lastRun?.ok, true);
    assert.equal(svc.lastRun?.cloud?.[0]?.ok, false);
    assert.ok(svc.lastRun?.error?.includes('drop /nonexistent bad')); // failure surfaced to the UI
  });

  test('post-backup hook receives the zip path', async () => {
    const dest = mkdtempSync(join(tmpdir(), 'bc-hook-'));
    try {
      const hook = join(dest, 'hook.sh');
      writeFileSync(hook, `#!/bin/sh\necho "$1" > ${join(dest, 'seen.txt')}\n`, { mode: 0o755 });
      cfg.cloud = { enabled: true, destinations: [], hook };
      await svc.snapshot('manual', new Date('2026-06-12T08:00:00Z'));
      assert.ok(readFileSync(join(dest, 'seen.txt'), 'utf-8').trim().endsWith('.zip'));
    } finally { rmSync(dest, { recursive: true, force: true }); }
  });
});
