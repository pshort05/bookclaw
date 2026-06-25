/**
 * BookClaw Book Transfer Service (book-container Phase 5).
 *
 * Book ⇆ .zip, safely. export() zips a whitelist (book.json + templates/ +
 * data/) — never .baseline/, never anything outside the book dir (so the vault,
 * which lives outside the tree, is structurally unreachable). The import side
 * (later tasks) extracts to an isolated staging dir, validates structure
 * (zip-slip guarded), classifies the schema version, and scans every
 * prompt-bearing file with InjectionDetector before anything lands.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, renameSync, cpSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import AdmZip from 'adm-zip';
import type { BookService } from './book.js';
import type { InjectionDetector } from '../security/injection.js';
import { classifyVersion, SLUG_RE, type BookManifest } from './book-types.js';
import { isUnsafeEntry, isSymlinkEntry, scannableFiles, scanStagedText, checkZipBudget, assertInflatedSize, type ImportFinding } from './transfer-security.js';

export type { ImportFinding } from './transfer-security.js';

export interface StageResult {
  stagingId: string;
  manifest?: BookManifest;
  findings: ImportFinding[];
  versionStatus: 'ok' | 'readonly' | 'quarantined' | 'unknown';
  structuralError?: string;
}

/** Top-level paths allowed inside an exported/imported book zip. */
const WHITELIST_PREFIXES = ['book.json', 'templates/', 'data/'];
/** Directory roots zipped on export and walked on scan — derived from the whitelist so they stay in sync. */
const ZIP_DIRS = WHITELIST_PREFIXES.filter(p => p.endsWith('/')).map(p => p.replace(/\/$/, ''));

export class BookTransferService {
  constructor(
    private booksDir: string,
    private books: BookService,
    private injection: InjectionDetector,
    private stagingDir: string,
  ) {}

  /** Zip a book's whitelist (book.json + templates/ + data/). Throws if missing. */
  export(slug: string): Buffer {
    if (!SLUG_RE.test(slug)) throw new Error(`Invalid slug: ${slug}`);
    const dir = join(this.booksDir, slug);
    if (!existsSync(join(dir, 'book.json'))) throw new Error(`Book not found: ${slug}`);
    const zip = new AdmZip();
    zip.addLocalFile(join(dir, 'book.json'));
    for (const sub of ZIP_DIRS) {
      const p = join(dir, sub);
      if (existsSync(p)) zip.addLocalFolder(p, sub);
    }
    return zip.toBuffer();
  }

  /** Scan every prompt-bearing/text file under a staged book dir. */
  scan(baseDir: string): ImportFinding[] {
    return scanStagedText(baseDir, scannableFiles(baseDir, ZIP_DIRS, ['book.json']), this.injection);
  }

  // ── Import: validate + stage (the zip is UNTRUSTED) ─────────────────────────

  /** Extract an uploaded zip into an isolated staging dir, with per-entry guards. */
  validateAndStage(zip: Buffer): StageResult {
    const stagingId = randomUUID();
    const stageDir = join(this.stagingDir, stagingId);
    mkdirSync(stageDir, { recursive: true });
    const fail = (msg: string): StageResult => {
      try { rmSync(stageDir, { recursive: true, force: true }); } catch { /* noop */ }
      return { stagingId, findings: [], versionStatus: 'unknown', structuralError: msg };
    };
    let entries;
    try { entries = new AdmZip(zip).getEntries(); } catch { return fail('not a valid zip'); }
    const budgetError = checkZipBudget(entries);
    if (budgetError) return fail(budgetError);
    let inflatedTotal = 0;
    for (const e of entries) {
      if (e.isDirectory) continue;
      const name = e.entryName;
      // Reject symlink-mode entries (adm-zip writes regular files, but be explicit).
      const attr = (e.header as unknown as { attr?: number })?.attr;
      if (isSymlinkEntry(attr)) return fail(`symlink entry rejected: ${name}`);
      if (isUnsafeEntry(name, stageDir, WHITELIST_PREFIXES)) return fail(`unsafe entry rejected: ${name}`);
      const dest = join(stageDir, name);
      let buf: Buffer;
      try {
        buf = e.getData();
      } catch {
        return fail(`failed to extract entry: ${name}`);
      }
      // The declared sizes checked above are attacker-controlled — re-assert the
      // ACTUAL inflated size so a lying central directory can't smuggle a bomb.
      try {
        inflatedTotal = assertInflatedSize(buf.length, inflatedTotal);
      } catch (err) {
        return fail((err as Error).message);
      }
      try {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, buf);
      } catch {
        return fail(`failed to extract entry: ${name}`);
      }
    }
    const mfPath = join(stageDir, 'book.json');
    if (!existsSync(mfPath)) return fail('book.json missing');
    let manifest: BookManifest;
    try { manifest = JSON.parse(readFileSync(mfPath, 'utf-8')) as BookManifest; } catch { return fail('book.json is not valid JSON'); }
    if (typeof manifest.title !== 'string' || typeof manifest.schemaVersion !== 'number' || typeof manifest.pulledFrom !== 'object' || !manifest.pulledFrom) {
      return fail('book.json missing required fields (title, schemaVersion, pulledFrom)');
    }
    const versionStatus = classifyVersion(manifest.schemaVersion);
    const findings = this.scan(stageDir);
    return { stagingId, manifest, findings, versionStatus };
  }

  /** Delete one staging dir (guarded to the staging root). */
  purgeStaging(stagingId: string): void {
    if (!stagingId || stagingId.includes('/') || stagingId.includes('..')) return;
    const p = join(this.stagingDir, stagingId);
    if (p.startsWith(this.stagingDir + '/')) { try { rmSync(p, { recursive: true, force: true }); } catch { /* noop */ } }
  }

  // ── Import: finalize ────────────────────────────────────────────────────────

  /** Move a staged book into workspace/books under a fresh slug; re-seed .baseline. */
  async finalizeImport(stagingId: string): Promise<BookManifest> {
    if (!stagingId || stagingId.includes('/') || stagingId.includes('..')) throw new Error('invalid stagingId');
    const stageDir = join(this.stagingDir, stagingId);
    const mfPath = join(stageDir, 'book.json');
    if (!existsSync(mfPath)) throw new Error('staged book.json missing (expired?)');
    const manifest = JSON.parse(readFileSync(mfPath, 'utf-8')) as BookManifest;
    // allocateSlug atomically claims an empty books/<slug> dir. If anything below
    // fails before the staged book is moved in, remove that claimed-but-empty dir
    // so a failed import doesn't orphan it and permanently consume the slug.
    const slug = this.books.allocateSlug(manifest.title || 'imported-book');
    const dest = join(this.booksDir, slug);
    try {
      manifest.id = slug;
      manifest.slug = slug;
      writeFileSync(mfPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
      // Build .baseline inside staging FIRST, so the rename lands a complete book
      // (templates + .baseline) atomically — a cp failure leaves staging intact for the caller to purge.
      const stageTemplates = join(stageDir, 'templates');
      const stageBaseline = join(stageDir, '.baseline');
      if (existsSync(stageTemplates)) cpSync(stageTemplates, stageBaseline, { recursive: true });
      else mkdirSync(stageBaseline, { recursive: true });
      try {
        renameSync(stageDir, dest);
      } catch (err) {
        // Fix #7: cross-filesystem fallback (EXDEV) — copy then remove the staging dir.
        if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
          cpSync(stageDir, dest, { recursive: true });
          rmSync(stageDir, { recursive: true, force: true });
        } else { throw err; }
      }
    } catch (err) {
      // Roll back the claimed slug dir only if the move never populated it.
      try { if (!existsSync(join(dest, 'book.json'))) rmSync(dest, { recursive: true, force: true }); } catch { /* best-effort */ }
      throw err;
    }
    return manifest;
  }

  /** Purge every staging dir whose id is NOT in the pending set (orphans). */
  sweepStaging(pendingIds: Set<string>): void {
    if (!existsSync(this.stagingDir)) return;
    const MIN_AGE_MS = 15 * 60 * 1000; // never purge a dir younger than 15min: it may be mid-stage (validateAndStage→createRequest race).
    const now = Date.now();
    for (const e of readdirSync(this.stagingDir, { withFileTypes: true })) {
      if (!e.isDirectory() || pendingIds.has(e.name)) continue;
      try {
        if (now - statSync(join(this.stagingDir, e.name)).mtimeMs < MIN_AGE_MS) continue;
      } catch { continue; }
      this.purgeStaging(e.name);
    }
  }
}
