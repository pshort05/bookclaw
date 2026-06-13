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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { cp, rm } from 'fs/promises';
import { basename, join, relative, resolve, sep } from 'path';
import { spawn } from 'child_process';
import AdmZip from 'adm-zip';
import { SLUG_RE } from './book-types.js';
import type { BookService } from './book.js';

export const SNAPSHOT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-\d{3})?$/;

/** Top-level workspace dirs in the default ("standard") scope. */
const STANDARD_TOPS = ['books', 'library', '.config', 'soul', 'memory', 'documents', 'projects', '.bookclaw'];
/** Excluded from "full" scope (regenerable/partial-write hazards). Standard scope is allowlist-based, so these only matter for full. */
const FULL_SKIP = (name: string) => name.startsWith('.tmp');
/**
 * File-level exclusions in any scope. Takes the FULL source path so the live
 * memory-index SQLite db (incl. WAL/SHM sidecars) is anchored to memory/ rather
 * than a global `.sqlite`/`.db` basename substring — a user file named e.g.
 * `notes.db` elsewhere must not be silently dropped from backups. .tmp* names
 * (partial writes) are skipped anywhere.
 */
const FILE_SKIP = (srcPath: string): boolean => {
  const name = basename(srcPath);
  if (name.startsWith('.tmp')) return true;
  // Anchor the memory-index exclusion to the memory/ subtree.
  const inMemory = srcPath.includes(`${sep}memory${sep}`);
  if (inMemory && (name.includes('.sqlite') || name.endsWith('.db') || name.endsWith('-wal') || name.endsWith('-shm'))) {
    return true;
  }
  return false;
};

export interface BackupCfg {
  enabled: boolean;
  scope: 'standard' | 'full';
  keep: number;
  intervalHours: number;
  onCompletion: boolean;
  cloud: { enabled: boolean; destinations: string[]; hook: string | null };
}
/** Single source of the backup.* config shape + defaults (init, routes, service all read through this). */
export function readBackupCfg(config: { get(path: string, dflt?: any): any }): BackupCfg {
  return {
    enabled: config.get('backup.enabled', true),
    scope: config.get('backup.scope', 'standard'),
    keep: config.get('backup.local.keep', 10),
    intervalHours: config.get('backup.intervalHours', 24),
    onCompletion: config.get('backup.onCompletion', true),
    cloud: {
      enabled: config.get('backup.cloud.enabled', false),
      destinations: config.get('backup.cloud.destinations', []),
      hook: config.get('backup.cloud.hook', null),
    },
  };
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
  private meta: { appVersion?: string; workspaceSchemaVersion?: number };
  lastRun: LastRun | null = null;

  constructor(workspaceDir: string, backupRoot: string, cfg: () => BackupCfg,
    meta: { appVersion?: string; workspaceSchemaVersion?: number } = {}) {
    this.workspaceDir = resolve(workspaceDir);
    this.root = resolve(backupRoot);
    this.cfg = cfg;
    this.meta = meta;
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
    // Clamp below setInterval's 32-bit ms ceiling (intervalHours > ~596 would otherwise fire every 1ms).
    const ms = Math.min(Math.max(1, cfg.intervalHours) * 3_600_000, 2_147_000_000);
    // Staleness-guarded so a recent manual/on-completion snapshot suppresses a redundant scheduled mirror.
    this.timer = setInterval(() => { void this.snapshotIfStale('scheduled', Math.max(10, (this.cfg().intervalHours * 60) / 2)); }, ms);
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

  /** Re-arm timers off the live config (call after any backup.* config change). */
  restart(): boolean {
    this.stop();
    return this.start();
  }

  async snapshot(reason: string, at: Date = new Date()): Promise<SnapshotInfo> {
    const info = await this.createSnapshot(reason, at);
    await this.prune();
    if (this.cfg().cloud.enabled && this.lastRun) {
      this.lastRun.cloud = await this.pushCloud(info.name);
      // Surface cloud-layer failures (local snapshot succeeded, so ok stays true).
      const failed = this.lastRun.cloud.filter(r => !r.ok).map(r => r.layer);
      if (failed.length) this.lastRun.error = 'cloud: ' + failed.join(', ');
    }
    return info;
  }

  /** Copy + meta + lastRun only — no prune, no cloud push (restore() needs the source to survive). */
  private async createSnapshot(reason: string, at: Date = new Date(), scopeOverride?: 'standard' | 'full'): Promise<SnapshotInfo> {
    const scope = scopeOverride ?? this.cfg().scope;
    const name = this.uniqueName(at);
    const tmp = join(this.root, `.tmp-${name}`);
    await rm(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const tops = scope === 'full'
      ? readdirSync(this.workspaceDir).filter(t => !FULL_SKIP(t))
      : STANDARD_TOPS.filter(t => existsSync(join(this.workspaceDir, t)));
    for (const top of tops) {
      await cp(join(this.workspaceDir, top), join(tmp, top), {
        recursive: true,
        filter: (src) => !FILE_SKIP(src),
      });
    }
    const books = this.booksInDir(tmp);
    const meta = { name, at: at.toISOString(), reason, scope, books, ...this.meta };
    writeFileSync(join(tmp, 'snapshot.json'), JSON.stringify(meta, null, 2));
    renameSync(tmp, join(this.root, name));
    this.lastRun = { at: meta.at, ok: true, reason };
    return { name, at: meta.at, reason, scope, books };
  }

  /** Trigger wrapper that records failures instead of throwing (timers, hooks). Respects the live enabled flag. */
  async safeSnapshot(reason: string): Promise<SnapshotInfo | null> {
    if (!this.cfg().enabled) return null;
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

  /** Project-completion hook entry point: no-op unless backup.onCompletion (and enabled, via safeSnapshot). */
  async onCompletionSnapshot(): Promise<SnapshotInfo | null> {
    if (!this.cfg().onCompletion) return null;
    return this.snapshotIfStale('on-completion');
  }

  list(): SnapshotInfo[] {
    return this.listNames().map((name) => {
      let meta: any = {};
      try { meta = JSON.parse(readFileSync(join(this.root, name, 'snapshot.json'), 'utf-8')); } catch { /* tolerated */ }
      return {
        name, at: meta.at ?? '', reason: meta.reason ?? '', scope: meta.scope ?? '',
        books: Array.isArray(meta.books) ? meta.books : this.booksIn(name), // fallback for pre-meta snapshots
      };
    });
  }

  getStatus(): { enabled: boolean; root: string; lastRun: LastRun | null; count: number } {
    return { enabled: this.cfg().enabled, root: this.root, lastRun: this.lastRun, count: this.listNames().length };
  }

  async prune(): Promise<number> {
    const keep = Math.max(1, this.cfg().keep || 10);
    const names = this.listNames();
    const excess = names.slice(0, Math.max(0, names.length - keep));
    for (const n of excess) await rm(join(this.root, n), { recursive: true, force: true });
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
    return this.booksInDir(join(this.root, name));
  }

  private booksInDir(snapDir: string): string[] {
    const d = join(snapDir, 'books');
    if (!existsSync(d)) return [];
    return readdirSync(d).filter(s => existsSync(join(d, s, 'book.json'))).sort();
  }

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
    // The pre-restore snapshot must cover at least what the restore overwrites:
    // restoring a 'full' snapshot replaces tops outside the standard allowlist,
    // so widen the pre-restore scope to 'full' in that case.
    let targetScope: string | undefined;
    try { targetScope = JSON.parse(readFileSync(join(snapDir, 'snapshot.json'), 'utf-8')).scope; } catch { /* tolerated */ }
    // createSnapshot, not snapshot(): pruning here could delete the restore
    // source (oldest snapshot at keep-N capacity), and a slow cloud upload must
    // not sit between validation and restore — prune runs after the copy below.
    const pre = await this.createSnapshot('pre-restore', new Date(), targetScope === 'full' ? 'full' : undefined);
    if (opts.book) {
      // Capture whether we're reverting the live active book BEFORE re-init: the
      // SoulService singleton isn't owned here, so a restore that touches the
      // active book leaves free chat writing in the just-reverted voice until the
      // operator restarts. We have no soul handle to reload in place, so flag a
      // restart instead. Pipeline steps are unaffected (they read fresh via
      // composeForBook); only the cached active-book Author is stale.
      const wasActive = this.books?.getActiveBook() === opts.book;
      const live = join(this.workspaceDir, 'books', opts.book);
      await rm(live, { recursive: true, force: true });
      await cp(join(snapDir, 'books', opts.book), live, { recursive: true });
      await this.books?.initialize();
      await this.prune();
      return { preSnapshot: pre.name, restartRecommended: wasActive };
    }
    for (const top of readdirSync(snapDir)) {
      if (top === 'snapshot.json' || top === '.vault' || top === '.audit') continue;
      const live = join(this.workspaceDir, top);
      await rm(live, { recursive: true, force: true });
      await cp(join(snapDir, top), live, { recursive: true });
    }
    await this.books?.initialize();
    await this.prune();
    return { preSnapshot: pre.name, restartRecommended: true };
  }
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
}
