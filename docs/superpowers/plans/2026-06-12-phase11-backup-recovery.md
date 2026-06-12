# Phase 11 — Backup & Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repo conventions override the generic skill steps:** NO `git commit` / `git push` — the final task writes a `commit_message` file; the maintainer runs `./push.sh`. Work directly on `main` in the live working tree (the Mercury deploy builds the working tree). Imports use `.js` extensions on `.ts` files (NodeNext).

**Goal:** Default-ON local mirror snapshots with keep-N pruning, whole-workspace + per-book restore (always pre-snapshotting), opt-in confirmation-gated cloud zip push (directory-drop / rclone / hook), scheduled + on-completion + manual triggers. **This is the release gate.**

**Spec:** `docs/superpowers/specs/2026-06-12-phase11-backup-recovery-design.md` — read it first; it is the contract.

**Architecture:** One new `BackupService` owning snapshot/prune/restore/cloud/triggers, wired in the init sequence (fail-soft), exposed via a new `backups.routes.ts` mounter, surfaced as one new card on the studio Settings page. Backups live OUTSIDE the workspace (second host bind-mount in Docker).

**Tech stack:** Node 22 `fs` (cpSync/renameSync), AdmZip (existing dep), `child_process.spawn` (no shell), Express mounter pattern, `node --test` via tsx.

**Verification gates (every task):** `npx tsc --noEmit` clean + `node --import tsx --test tests/unit/*.test.ts` all green. Frontend task adds `npm run build:frontend`.

---

### Task 1: `BackupService` — snapshot, scope/exclusions, prune (TDD)

**Files:**
- Create: `gateway/src/services/backup.ts`
- Create: `tests/unit/backup.test.ts`

- [ ] **Step 1: Write the failing tests.** Create `tests/unit/backup.test.ts`. Test harness: a temp workspace fixture + a mutable cfg object. Match the style of `tests/unit/channel-books.test.ts` (node:test + assert, mkdtemp, cleanup in `after`).

```ts
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BackupService, SNAPSHOT_RE, type BackupCfg } from '../../gateway/src/services/backup.js';
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
    svc = new BackupService(ws, root, () => cfg);
    await svc.initialize();
  });
  afterEach(() => { svc.stop(); rmSync(ws, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); });

  test('standard snapshot includes books/library/.config/soul/memory, excludes vault/audit/audio/sqlite', async () => {
    const snap = await svc.snapshot('manual');
    const d = join(root, snap.name);
    assert.ok(existsSync(join(d, 'books', 'alpha', 'book.json')));
    assert.ok(existsSync(join(d, 'library', 'entry.md')));
    assert.ok(existsSync(join(d, '.config', 'active-book.json')));
    assert.ok(existsSync(join(d, 'soul', 'SOUL.md')));
    assert.ok(existsSync(join(d, 'memory', 'notes.md')));
    assert.ok(!existsSync(join(d, '.vault')));
    assert.ok(!existsSync(join(d, '.audit')));
    assert.ok(!existsSync(join(d, 'audio')));
    assert.ok(!existsSync(join(d, 'memory', 'index.sqlite')));
    const meta = JSON.parse(readFileSync(join(d, 'snapshot.json'), 'utf-8'));
    assert.equal(meta.reason, 'manual');
    assert.equal(meta.scope, 'standard');
  });

  test('full snapshot includes audio and vault.enc, still excludes sqlite', async () => {
    cfg.scope = 'full';
    const snap = await svc.snapshot('manual');
    const d = join(root, snap.name);
    assert.ok(existsSync(join(d, 'audio', 'x.mp3')));
    assert.ok(existsSync(join(d, '.vault', 'vault.enc'))); // offsite copy; key lives outside workspace
    assert.ok(!existsSync(join(d, 'memory', 'index.sqlite')));
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

  test('snapshotIfStale skips within the guard window', async () => {
    await svc.snapshot('manual');
    assert.equal(await svc.snapshotIfStale('on-completion'), null);
  });
});
```

- [ ] **Step 2: Run to verify failure.** `node --import tsx --test tests/unit/backup.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `gateway/src/services/backup.ts`** (restore + cloud methods come in Tasks 2–3; this step ships snapshot/list/prune/timers):

```ts
/**
 * BackupService (book-container Phase 11) — point-in-time recovery.
 *
 * Local snapshots are uncompressed mirrors under <root>/<YYYY-MM-DDTHH-mm-ss>/
 * (tmp-then-rename, so a crashed copy never looks valid), pruned to keep-N.
 * Restore is whole-workspace or per-book and always pre-snapshots current
 * state. Cloud push (opt-in) zips a snapshot to directory/rclone/hook
 * destinations, fail-soft per layer; BookClaw never deletes remote data.
 * The backup root must live OUTSIDE the workspace.
 */
import { cpSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { basename, join, relative, resolve, sep } from 'path';
import { spawn } from 'child_process';
import AdmZip from 'adm-zip';
import { SLUG_RE } from './book-types.js';
import type { BookService } from './book.js';

export const SNAPSHOT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d{3})?$/;

/** Top-level workspace dirs in the default ("standard") scope. */
const STANDARD_TOPS = ['books', 'library', '.config', 'soul', 'memory'];
/** Excluded from "full" scope (regenerable/partial-write hazards). Standard scope is allowlist-based, so these only matter for full. */
const FULL_SKIP = (name: string) => name.startsWith('.tmp');
/** File-level exclusions in any scope. */
const FILE_SKIP = (name: string) => name.includes('.sqlite') || name.startsWith('.tmp');

export interface BackupCfg {
  enabled: boolean;
  scope: 'standard' | 'full';
  keep: number;
  intervalHours: number;
  onCompletion: boolean;
  cloud: { enabled: boolean; destinations: string[]; hook: string | null };
}
export interface SnapshotInfo { name: string; at: string; reason: string; scope: string; books: string[] }
export interface CloudResult { layer: string; ok: boolean; detail?: string }
export interface LastRun { at: string; ok: boolean; reason: string; error?: string; cloud?: CloudResult[] }

export class BackupService {
  private workspaceDir: string;
  private root: string;
  private cfg: () => BackupCfg;
  private books: BookService | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  lastRun: LastRun | null = null;

  constructor(workspaceDir: string, backupRoot: string, cfg: () => BackupCfg) {
    this.workspaceDir = resolve(workspaceDir);
    this.root = resolve(backupRoot);
    this.cfg = cfg;
  }

  setBooks(books: BookService): void { this.books = books; }

  async initialize(): Promise<void> {
    const rel = relative(this.workspaceDir, this.root);
    if (rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel))) {
      throw new Error(`Backup root ${this.root} is inside the workspace — backups would back themselves up. Set BOOKCLAW_BACKUP_DIR or backup.localPath outside ${this.workspaceDir}.`);
    }
    mkdirSync(this.root, { recursive: true });
  }

  /** false when backups are disabled (caller logs the loud warning). */
  start(): boolean {
    const cfg = this.cfg();
    if (!cfg.enabled) return false;
    const ms = Math.max(1, cfg.intervalHours) * 3_600_000;
    this.timer = setInterval(() => { void this.safeSnapshot('scheduled'); }, ms);
    this.timer.unref?.();
    const newest = this.listNames().at(-1);
    if (!newest || Date.now() - this.nameTime(newest) > ms) {
      this.bootTimer = setTimeout(() => { void this.safeSnapshot('scheduled'); }, 30_000);
      this.bootTimer.unref?.();
    }
    return true;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.timer = this.bootTimer = null;
  }

  async snapshot(reason: string, at: Date = new Date()): Promise<SnapshotInfo> {
    const cfg = this.cfg();
    const name = this.uniqueName(at);
    const tmp = join(this.root, `.tmp-${name}`);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const tops = cfg.scope === 'full'
      ? readdirSync(this.workspaceDir).filter(t => !FULL_SKIP(t))
      : STANDARD_TOPS.filter(t => existsSync(join(this.workspaceDir, t)));
    for (const top of tops) {
      cpSync(join(this.workspaceDir, top), join(tmp, top), {
        recursive: true,
        filter: (src) => !FILE_SKIP(basename(src)),
      });
    }
    const meta = { name, at: at.toISOString(), reason, scope: cfg.scope };
    writeFileSync(join(tmp, 'snapshot.json'), JSON.stringify(meta, null, 2));
    renameSync(tmp, join(this.root, name));
    this.lastRun = { at: meta.at, ok: true, reason };
    this.prune();
    if (cfg.cloud.enabled) this.lastRun.cloud = await this.pushCloud(name);
    return { ...meta, books: this.booksIn(name) };
  }

  /** Trigger wrapper that records failures instead of throwing (timers, hooks). */
  async safeSnapshot(reason: string): Promise<SnapshotInfo | null> {
    try { return await this.snapshot(reason); }
    catch (e: any) {
      this.lastRun = { at: new Date().toISOString(), ok: false, reason, error: e.message };
      console.log(`  ⚠ Backup (${reason}) failed: ${e.message}`);
      return null;
    }
  }

  /** On-completion guard: skip if a snapshot landed in the last `minMinutes`. */
  async snapshotIfStale(reason: string, minMinutes = 10): Promise<SnapshotInfo | null> {
    const newest = this.listNames().at(-1);
    if (newest && Date.now() - this.nameTime(newest) < minMinutes * 60_000) return null;
    return this.safeSnapshot(reason);
  }

  list(): SnapshotInfo[] {
    return this.listNames().map((name) => {
      let meta: any = {};
      try { meta = JSON.parse(readFileSync(join(this.root, name, 'snapshot.json'), 'utf-8')); } catch { /* tolerated */ }
      return { name, at: meta.at ?? '', reason: meta.reason ?? '', scope: meta.scope ?? '', books: this.booksIn(name) };
    });
  }

  getStatus(): { enabled: boolean; root: string; lastRun: LastRun | null; count: number } {
    return { enabled: this.cfg().enabled, root: this.root, lastRun: this.lastRun, count: this.listNames().length };
  }

  prune(): number {
    const keep = Math.max(1, this.cfg().keep || 10);
    const names = this.listNames();
    const excess = names.slice(0, Math.max(0, names.length - keep));
    for (const n of excess) rmSync(join(this.root, n), { recursive: true, force: true });
    return excess.length;
  }

  // ── internals ──
  private listNames(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).filter(n => SNAPSHOT_RE.test(n)).sort();
  }

  private uniqueName(at: Date): string {
    const base = at.toISOString().slice(0, 19).replace(/:/g, '-');
    if (!existsSync(join(this.root, base))) return base;
    for (let i = 2; ; i++) {
      const n = `${base}-${String(i).padStart(3, '0')}`;
      if (!existsSync(join(this.root, n))) return n;
    }
  }

  private nameTime(name: string): number {
    const iso = name.slice(0, 19).replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})$/, '$1:$2:$3');
    return Date.parse(`${iso}Z`) || 0;
  }

  private booksIn(name: string): string[] {
    const d = join(this.root, name, 'books');
    if (!existsSync(d)) return [];
    return readdirSync(d).filter(s => existsSync(join(d, s, 'book.json'))).sort();
  }

  // restore() lands in Task 2; pushCloud() in Task 3 — stubs keep tsc green:
  async restore(_id: string, _opts: { book?: string } = {}): Promise<{ preSnapshot: string; restartRecommended: boolean }> {
    throw new Error('not implemented');
  }
  private async pushCloud(_name: string): Promise<CloudResult[]> { return []; }
}
```

- [ ] **Step 4: Run the new tests** — `node --import tsx --test tests/unit/backup.test.ts` → all 8 PASS.
- [ ] **Step 5: Gates** — `npx tsc --noEmit` clean; full suite `node --import tsx --test tests/unit/*.test.ts` green (was 164; now 172).

### Task 2: Restore — per-book + whole-workspace + pre-restore snapshot + version gate

**Files:**
- Modify: `gateway/src/services/backup.ts` (replace the `restore` stub)
- Modify: `tests/unit/backup.test.ts` (append tests)

- [ ] **Step 1: Write the failing tests** (append inside the `describe` block):

```ts
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
  });
```

  *Note:* `classifyVersion(0)` returns `'quarantined'` only if `BOOK_MIN_SUPPORTED > 0` — check `book-types.ts`; if `0` is currently supported, assert with a negative version or assert the exact status the constant implies. The point under test: restore writes the manifest byte-for-byte and the existing gate does the classifying.

- [ ] **Step 2: Run to verify failure** — the 4 new tests FAIL (`not implemented`).

- [ ] **Step 3: Replace the `restore` stub:**

```ts
  /**
   * Restore from a snapshot. Per-book ({book}) replaces one book dir; whole-
   * workspace replaces every top-level entry present in the snapshot EXCEPT
   * .vault and .audit (credentials + tamper chain are never part of in-app
   * point-in-time recovery). Always snapshots current state first.
   */
  async restore(id: string, opts: { book?: string } = {}): Promise<{ preSnapshot: string; restartRecommended: boolean }> {
    if (!SNAPSHOT_RE.test(id) || !existsSync(join(this.root, id))) throw new Error(`Unknown snapshot: ${id}`);
    const snapDir = join(this.root, id);
    if (opts.book !== undefined && !SLUG_RE.test(opts.book)) throw new Error(`Invalid slug: ${opts.book}`);
    if (opts.book && !existsSync(join(snapDir, 'books', opts.book, 'book.json'))) {
      throw new Error(`Snapshot ${id} has no book "${opts.book}"`);
    }
    const pre = await this.snapshot('pre-restore');
    if (opts.book) {
      const live = join(this.workspaceDir, 'books', opts.book);
      rmSync(live, { recursive: true, force: true });
      cpSync(join(snapDir, 'books', opts.book), live, { recursive: true });
      await this.books?.initialize();
      return { preSnapshot: pre.name, restartRecommended: false };
    }
    for (const top of readdirSync(snapDir)) {
      if (top === 'snapshot.json' || top === '.vault' || top === '.audit') continue;
      const live = join(this.workspaceDir, top);
      rmSync(live, { recursive: true, force: true });
      cpSync(join(snapDir, top), live, { recursive: true });
    }
    await this.books?.initialize();
    return { preSnapshot: pre.name, restartRecommended: true };
  }
```

- [ ] **Step 4: Run tests** — all 12 backup tests PASS; full suite green.

### Task 3: Cloud push — zip + directory-drop + rclone + hook (fail-soft)

**Files:**
- Modify: `gateway/src/services/backup.ts` (replace the `pushCloud` stub)
- Modify: `tests/unit/backup.test.ts` (append tests)

- [ ] **Step 1: Write the failing tests:**

```ts
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
    cfg.cloud = { enabled: true, destinations: ['/nonexistent bad'], hook: null };
    const snap = await svc.snapshot('manual', new Date('2026-06-12T07:00:00Z'));
    assert.ok(existsSync(join(root, snap.name))); // local snapshot intact
    assert.equal(svc.lastRun?.ok, true);
    assert.equal(svc.lastRun?.cloud?.[0]?.ok, false);
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
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Replace the `pushCloud` stub:**

```ts
  /**
   * Zip <root>/<name> and push to each destination. Layers (each optional,
   * each fail-soft): plain path → copy the zip there (directory-drop, e.g. a
   * Dropbox-synced host folder); "rclone:<remote>[:path]" → `rclone copy`;
   * then the post-backup hook gets the zip path as argv[1]. BookClaw NEVER
   * deletes remote data — the user prunes cloud copies.
   */
  private async pushCloud(name: string): Promise<CloudResult[]> {
    const { destinations, hook } = this.cfg().cloud;
    const results: CloudResult[] = [];
    const zipPath = join(this.root, `.tmp-${name}.zip`);
    try {
      const zip = new AdmZip();
      zip.addLocalFolder(join(this.root, name), name);
      zip.writeZip(zipPath);
      for (const dest of destinations) {
        if (dest.startsWith('rclone:')) {
          results.push(await this.runCmd('rclone', ['copy', zipPath, dest.slice('rclone:'.length)], `rclone ${dest}`));
        } else {
          try {
            mkdirSync(dest, { recursive: true });
            copyFileSync(zipPath, join(dest, `${name}.zip`));
            results.push({ layer: `drop ${dest}`, ok: true });
          } catch (e: any) { results.push({ layer: `drop ${dest}`, ok: false, detail: e.message }); }
        }
      }
      if (hook) results.push(await this.runCmd(hook, [zipPath], `hook ${hook}`));
    } catch (e: any) {
      results.push({ layer: 'zip', ok: false, detail: e.message });
    } finally {
      rmSync(zipPath, { force: true });
    }
    for (const r of results) if (!r.ok) console.log(`  ⚠ Cloud backup layer failed (${r.layer}): ${r.detail ?? ''}`);
    return results;
  }

  /** spawn with fixed argv (no shell). ENOENT (absent rclone/hook) → fail-soft result. */
  private runCmd(cmd: string, args: string[], layer: string): Promise<CloudResult> {
    return new Promise((res) => {
      const p = spawn(cmd, args, { stdio: 'ignore' });
      p.on('error', (e) => res({ layer, ok: false, detail: e.message }));
      p.on('exit', (code) => res({ layer, ok: code === 0, detail: code === 0 ? undefined : `exit ${code}` }));
    });
  }
```

- [ ] **Step 4: Run tests** — all 15 backup tests PASS; `npx tsc --noEmit` clean; full suite green.

### Task 4: Config defaults + init wiring + triggers + posture logging

**Files:**
- Modify: `config/default.json` (add the `backup` block from the spec, verbatim)
- Modify: `gateway/src/init/phase-06-content.ts` (new block AFTER both `gw.books` and `gw.projectEngine` exist — grep `new BookService` to confirm where books init lives; if it is a later phase, put this block immediately after it instead)
- Modify: `gateway/src/index.ts` (declare the field + expose in `getServices()` at `index.ts:1002`)

- [ ] **Step 1: Add to `config/default.json`:**

```jsonc
"backup": {
  "enabled": true,
  "localPath": "~/bookclaw-backups",
  "scope": "standard",
  "local": { "format": "mirror", "keep": 10 },
  "cloud": { "enabled": false, "format": "zip", "destinations": [], "hook": null },
  "intervalHours": 24,
  "onCompletion": true
}
```

- [ ] **Step 2: Init block** (match the surrounding `✓`/`⚠` fail-soft style; imports: `BackupService` from `../services/backup.js`, `homedir` from `os`, `resolve` from `path`):

```ts
// ── Book-container Phase 11: Backup & recovery ──
try {
  const rawRoot = process.env.BOOKCLAW_BACKUP_DIR || gw.config.get('backup.localPath', '~/bookclaw-backups');
  const backupRoot = rawRoot.startsWith('~') ? join(homedir(), rawRoot.slice(1)) : resolve(rawRoot);
  gw.backup = new BackupService(join(ROOT_DIR, 'workspace'), backupRoot, () => ({
    enabled: gw.config.get('backup.enabled', true),
    scope: gw.config.get('backup.scope', 'standard'),
    keep: gw.config.get('backup.local.keep', 10),
    intervalHours: gw.config.get('backup.intervalHours', 24),
    onCompletion: gw.config.get('backup.onCompletion', true),
    cloud: {
      enabled: gw.config.get('backup.cloud.enabled', false),
      destinations: gw.config.get('backup.cloud.destinations', []),
      hook: gw.config.get('backup.cloud.hook', null),
    },
  }));
  if (gw.books) gw.backup.setBooks(gw.books);
  await gw.backup.initialize();
  if (gw.backup.start()) {
    gw.projectEngine.onProjectCompleted(async () => {
      if (gw.config.get('backup.enabled', true) && gw.config.get('backup.onCompletion', true)) {
        await gw.backup?.snapshotIfStale('on-completion');
      }
    });
    console.log(`  ✓ Backup: ON — keep ${gw.config.get('backup.local.keep', 10)}, every ${gw.config.get('backup.intervalHours', 24)}h, root ${backupRoot}`);
  } else {
    console.log('  ⚠ BACKUPS ARE DISABLED (backup.enabled=false) — no point-in-time recovery. Re-enable in Settings → Backups.');
  }
} catch (e: any) {
  console.log(`  ⚠ Backup service unavailable: ${e.message}`);
  gw.backup = undefined;
}
```

- [ ] **Step 3: `index.ts`** — add `backup?: BackupService;` next to the other service fields (with the import), and `backup: this.backup,` inside `getServices()`.
- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; `npm start` locally for ~10s and confirm the `✓ Backup: ON …` line; set `backup.enabled=false` in `config/user.json` temporarily, restart, confirm the `⚠ BACKUPS ARE DISABLED` line, then revert `config/user.json`.

### Task 5: API routes — `backups.routes.ts` + gated config PUT

**Files:**
- Create: `gateway/src/api/routes/backups.routes.ts`
- Modify: `gateway/src/api/routes.ts` (import + call `mountBackups(app, gateway, baseDir)` alongside the other mounters at `routes.ts:39+`)

- [ ] **Step 1: Implement the mounter** (mirror the header/comment style of `library.routes.ts`; the confirm endpoint mirrors the gated-import finalize pattern at `books.routes.ts:258-270` — read that first and reuse its status-checking shape exactly):

```ts
import { Application, Request, Response } from 'express';
import { SNAPSHOT_RE } from '../../services/backup.js';

/**
 * Backup & recovery API (book-container Phase 11). List/run snapshots, restore
 * (whole-workspace or per-book), read/update backup config. Adding a cloud
 * destination or hook is an outbound side effect → ConfirmationGate at setup;
 * approved scheduled pushes then run under that approval. Behind bearer auth
 * + IP allowlist like all /api/*.
 */
export function mountBackups(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();
  const unavailable = (res: Response) => res.status(503).json({ error: 'Backup service unavailable (see startup log)' });

  const readCfg = () => ({
    enabled: services.config.get('backup.enabled', true),
    scope: services.config.get('backup.scope', 'standard'),
    local: { format: 'mirror', keep: services.config.get('backup.local.keep', 10) },
    cloud: {
      enabled: services.config.get('backup.cloud.enabled', false),
      format: 'zip',
      destinations: services.config.get('backup.cloud.destinations', []),
      hook: services.config.get('backup.cloud.hook', null),
    },
    intervalHours: services.config.get('backup.intervalHours', 24),
    onCompletion: services.config.get('backup.onCompletion', true),
    localPath: services.config.get('backup.localPath', '~/bookclaw-backups'),
  });

  function validate(body: any): { ok: true; cfg: any } | { ok: false; error: string } {
    const cur = readCfg();
    const cfg = { ...cur, ...body, local: { ...cur.local, ...(body?.local ?? {}) }, cloud: { ...cur.cloud, ...(body?.cloud ?? {}) } };
    if (typeof cfg.enabled !== 'boolean') return { ok: false, error: 'enabled must be boolean' };
    if (!['standard', 'full'].includes(cfg.scope)) return { ok: false, error: 'scope must be standard|full' };
    if (!Number.isInteger(cfg.local.keep) || cfg.local.keep < 1 || cfg.local.keep > 1000) return { ok: false, error: 'local.keep must be 1..1000' };
    if (!Number.isFinite(cfg.intervalHours) || cfg.intervalHours < 1) return { ok: false, error: 'intervalHours must be >= 1' };
    if (!Array.isArray(cfg.cloud.destinations) || cfg.cloud.destinations.some((d: any) => typeof d !== 'string' || !d.trim())) {
      return { ok: false, error: 'cloud.destinations must be non-empty strings' };
    }
    if (cfg.cloud.hook !== null && typeof cfg.cloud.hook !== 'string') return { ok: false, error: 'cloud.hook must be a path or null' };
    return { ok: true, cfg };
  }

  async function persist(cfg: any): Promise<void> {
    await services.config.setAndPersist('backup', {
      enabled: cfg.enabled, localPath: cfg.localPath, scope: cfg.scope,
      local: cfg.local, cloud: cfg.cloud, intervalHours: cfg.intervalHours, onCompletion: cfg.onCompletion,
    });
  }

  // Snapshot list + status.
  app.get('/api/backups', (_req: Request, res: Response) => {
    if (!services.backup) return unavailable(res);
    res.json({ ...services.backup.getStatus(), snapshots: services.backup.list().reverse() });
  });

  // Back up now.
  app.post('/api/backups', async (_req: Request, res: Response) => {
    if (!services.backup) return unavailable(res);
    try { res.json({ ok: true, snapshot: await services.backup.snapshot('manual') }); }
    catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Restore (optional { book } for per-book revert). Pre-snapshots automatically.
  app.post('/api/backups/:id/restore', async (req: Request, res: Response) => {
    if (!services.backup) return unavailable(res);
    const id = String(req.params.id);
    if (!SNAPSHOT_RE.test(id)) return res.status(400).json({ error: 'Invalid snapshot id' });
    const book = req.body?.book !== undefined ? String(req.body.book) : undefined;
    try { res.json({ ok: true, ...(await services.backup.restore(id, { book })) }); }
    catch (e: any) { res.status(/Unknown snapshot|no book|Invalid slug/.test(e.message) ? 404 : 500).json({ error: e.message }); }
  });

  app.get('/api/backups/config', (_req: Request, res: Response) => res.json(readCfg()));

  // Update config. NEW cloud destinations / hook are confirmation-gated.
  app.put('/api/backups/config', async (req: Request, res: Response) => {
    const v = validate(req.body ?? {});
    if (!v.ok) return res.status(400).json({ error: v.error });
    const cur = readCfg();
    const newDests = v.cfg.cloud.destinations.filter((d: string) => !cur.cloud.destinations.includes(d));
    const newHook = v.cfg.cloud.hook && v.cfg.cloud.hook !== cur.cloud.hook ? v.cfg.cloud.hook : null;
    if (newDests.length || newHook) {
      const conf = await services.confirmationGate.createRequest({
        service: 'backup', action: 'enable_backup_destination', platform: 'cloud-backup',
        description: `Enable cloud backup upload to: ${[...newDests, ...(newHook ? [`hook ${newHook}`] : [])].join(', ')}. Future backups (books, library, config) will be copied there automatically until removed.`,
        payload: { config: v.cfg }, riskLevel: 'high', isReversible: true,
      });
      return res.status(202).json({ pendingConfirmation: conf.id });
    }
    await persist(v.cfg);
    res.json({ ok: true, config: readCfg() });
  });

  // Finalize a gated config change AFTER dashboard approval (books.routes.ts pattern).
  app.post('/api/backups/config/confirm/:id', async (req: Request, res: Response) => {
    const conf = services.confirmationGate.getRequest?.(String(req.params.id)) ?? services.confirmationGate.get?.(String(req.params.id));
    if (!conf) return res.status(404).json({ error: 'Unknown confirmation' });
    if (conf.status !== 'approved') return res.status(409).json({ error: `confirmation is ${conf.status} (must be approved)` });
    if (conf.service !== 'backup') return res.status(400).json({ error: 'Not a backup confirmation' });
    await persist(conf.payload.config);
    res.json({ ok: true, config: readCfg() });
  });
}
```

  *Note:* check the actual getter name on `ConfirmationGateService` (`getRequest` vs `get` — see how `books.routes.ts` finalize fetches it) and use that single form, deleting the `??` fallback shown above. Also confirm `sanitizePayload` preserves `payload.config` (books.routes stores its payload the same way).

- [ ] **Step 2: Mount it** in `routes.ts` next to `mountBooks`.
- [ ] **Step 3: Verify by script, not by hand:** `npx tsc --noEmit` clean; full unit suite green; then boot the gateway and curl `GET /api/backups` (200 with `snapshots`), `POST /api/backups` (200, snapshot listed afterward), `PUT /api/backups/config` with a new destination (202 + pending id). These exact checks get committed into feature-smoke in Task 8 — do not leave them as one-off transcript commands.

### Task 6: Studio Settings — "Backups" card

**Files:**
- Modify: `frontend/studio/src/routes/Settings.tsx` (+ its module CSS if the page uses one)
- Modify: the shared API client only if Settings doesn't already use a generic `apiGet`/`apiPost` helper (follow whatever Settings uses today — read the file first and copy an existing card's data-fetch pattern exactly)

- [ ] **Step 1: Read `Settings.tsx`** and identify the existing card structure + fetch helper.
- [ ] **Step 2: Add a "Backups" card** with, in order:
  - Warning banner (prominent, same style as other warnings) when `config.enabled === false`: "Backups are disabled — no point-in-time recovery."
  - Status line: last backup time + ok/error + snapshot count (from `GET /api/backups`).
  - Controls bound to `GET/PUT /api/backups/config`: enabled toggle, keep-N number input, interval-hours number input, scope select (`standard`/`full`).
  - "Back up now" button → `POST /api/backups`, then refresh the list.
  - Snapshot list (newest first): name, reason, contained-books count; per row a **Restore…** control that opens a confirm step offering "Whole workspace" or a book picker (from the row's `books`), POSTs `/api/backups/:id/restore`, and on success shows the `preSnapshot` name + a "restart recommended" notice when `restartRecommended` is true.
  - Cloud section: destinations list with add/remove (text input for a path or `rclone:<remote>`), hook path input. On a 202 response, show "Pending approval in Confirmations" and link to the existing Confirmations UI; after approval the user re-opens Settings and the pending id is finalized via `POST /api/backups/config/confirm/:id` (store the pending id in component state and offer a "Finalize" button).
- [ ] **Step 3: Verify** — `npm run build:frontend` green; `npx tsc --noEmit` clean.

### Task 7: Docker + deploy + env docs

**Files:**
- Modify: `docker/docker-compose.yml` (volumes + environment of the `bookclaw` service)
- Modify: `scripts/deploy.sh` (mirror the workspace-dir handling at `deploy.sh:65-95`)
- Modify: `.env.example`

- [ ] **Step 1: compose** — add under the existing workspace volume line (`docker-compose.yml:17`):

```yaml
      - ${BOOKCLAW_BACKUP_PATH:-/home/paul/bookclaw-backups}:/app/backups
```

  and `BOOKCLAW_BACKUP_DIR=/app/backups` in the service `environment:` block.

- [ ] **Step 2: deploy.sh** — next to the workspace block (`deploy.sh:65-95`): `BACKUP_PATH="${BOOKCLAW_BACKUP_PATH:-$HOME/bookclaw-backups}"`, write `BOOKCLAW_BACKUP_PATH` into `docker/.env` alongside `BOOKCLAW_WORKSPACE_PATH`, `mkdir -p "$BACKUP_PATH"`, and extend the existing chown run to also cover `/app/backups` (same `--user 0 --entrypoint chown` pattern and the same uid-999-bind-mount reason).
- [ ] **Step 3: `.env.example`** — beneath the `BOOKCLAW_WORKSPACE_PATH` line add commented `BOOKCLAW_BACKUP_PATH=/home/paul/bookclaw-backups` (host side) and a note that in-container the service reads `BOOKCLAW_BACKUP_DIR` (set by compose).
- [ ] **Step 4: Verify** — `docker compose -f docker/docker-compose.yml config` renders the new mount; deploy itself is verified in Task 8 on Mercury.

### Task 8: Feature-smoke + docs sync + commit_message

**Files:**
- Modify: `tests/feature-smoke.sh` (new free Tier-A section)
- Modify: `docs/BOOK-CONTAINER-ARCHITECTURE.md` (mark Phase 11 implemented, same style as Phases 0–10)
- Modify: `docs/TODO.md` → `docs/COMPLETED.md` (move the Phase 11 line with date)
- Modify: `CLAUDE.md` (stateful-dirs section: note the backup root + new env vars; bump unit-test count in the Testing section if mentioned)
- Modify: `.remember/remember.md` (handoff)
- Create: `commit_message`

- [ ] **Step 1: Feature-smoke Tier-A additions** (follow the existing `check`/PASS-FAIL helpers; free, no AI):
  - `GET /api/backups` → 200 with `snapshots` array.
  - `PUT /api/backups/config` `{ "local": { "keep": 9 } }` → 200; GET shows 9; PUT back to 10.
  - `POST /api/backups` → 200; GET lists ≥1 snapshot; capture the newest name.
  - Per-book restore round-trip against the Tier-D throwaway book: write a sentinel via the existing book-files API (or re-use the Tier-D output file), `POST /api/backups` → modify → `POST /api/backups/<name>/restore {"book":"<tier-d-slug>"}` → 200 and the file content reverted.
  - `POST /api/backups/2099-01-01T00-00-00/restore` → 404.
  - `PUT /api/backups/config` adding `{"cloud":{"enabled":true,"destinations":["/tmp/bc-smoke-cloud"]}}` → **202** with `pendingConfirmation` (gate engaged); do NOT approve; PUT the original config back (no new destinations → 200).
- [ ] **Step 2: Run all local gates** — `npx tsc --noEmit`, full unit suite (~179), `npm run build:frontend`.
- [ ] **Step 3: Deploy** — `touch build_now`; poll `.build-logs/last-build.status` for a fresh timestamp + `result=PASS`. **Note:** the Mercury host needs the backup dir; the timer runs `deploy.sh` so Task 7's mkdir/chown handles it — verify via the smoke run.
- [ ] **Step 4: Live smoke** — `TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '"'); BASE_URL=http://192.168.1.32:3847 BOOKCLAW_AUTH_TOKEN="$TOKEN" bash tests/feature-smoke.sh` → 0 failed.
- [ ] **Step 5: Docs** — arch doc Phase 11 marked *(Implemented 2026-06-12.)* with the verify results; TODO→COMPLETED move; CLAUDE.md additions; handoff update.
- [ ] **Step 6: Write `commit_message`** (repo format — one line, blank line, dash details):

```
feat(phase11): backup & recovery — local snapshots, restore, gated cloud push

- BackupService: mirror snapshots (keep-N prune, tmp-then-rename), per-book + whole-workspace restore with automatic pre-restore snapshot, scheduled/on-completion/manual triggers
- Cloud push opt-in: zip → directory-drop / rclone / post-backup hook, fail-soft; new destinations confirmation-gated; BookClaw never deletes remote data
- /api/backups list/run/restore/config; studio Settings Backups card with disabled-warning banner
- Docker: second host bind-mount for the backup root (BOOKCLAW_BACKUP_PATH), deploy.sh mkdir+chown
- 15 new unit tests + feature-smoke Tier-A backup checks
```

---

## Self-review checklist (run after drafting, fixed inline)

- Spec coverage: snapshot/scope/exclusions (T1), prune (T1), restore + pre-snapshot + version gate (T2), cloud 3 layers + gate (T3, T5), triggers + posture (T4), API (T5), UI + banner (T6), Docker (T7), smoke + release-gate verify criteria 1–5 (T1: criterion 1–2; T2: 3, 5; T4: 4; T8 live) — all covered.
- No placeholders; type names consistent (`BackupCfg`, `SnapshotInfo`, `CloudResult`, `restore(id,{book})`).
- Two implementer look-ups deliberately delegated (exact `ConfirmationGateService` getter name; exact init phase for `gw.books`) with instructions on where to look — these depend on file state better read at execution time than frozen wrong in the plan.
