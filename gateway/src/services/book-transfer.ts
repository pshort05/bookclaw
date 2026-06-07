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
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, renameSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import AdmZip from 'adm-zip';
import type { BookService } from './book.js';
import type { InjectionDetector } from '../security/injection.js';
import { classifyVersion, SLUG_RE, type BookManifest } from './book-types.js';

export interface ImportFinding { path: string; type: string; confidence: number; pattern: string; }

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
/** Extensions whose content is scanned for injection (text only). */
const SCAN_EXTS = ['.md', '.txt', '.json'];

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

  /** Recursively collect scannable text files (relative paths) under a dir. */
  private scannableFiles(baseDir: string): string[] {
    const out: string[] = [];
    const walk = (rel: string) => {
      const abs = join(baseDir, rel);
      if (!existsSync(abs)) return;
      for (const e of readdirSync(abs, { withFileTypes: true })) {
        if (e.isSymbolicLink()) continue;                          // never follow symlinks in staged/untrusted trees
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(childRel);
        else if (e.isFile() && SCAN_EXTS.some(x => e.name.toLowerCase().endsWith(x))) out.push(childRel);
      }
    };
    for (const root of ZIP_DIRS) walk(root);
    if (existsSync(join(baseDir, 'book.json'))) out.push('book.json');
    return out;
  }

  /** Scan every prompt-bearing/text file under a staged book dir. */
  scan(baseDir: string): ImportFinding[] {
    const findings: ImportFinding[] = [];
    for (const rel of this.scannableFiles(baseDir)) {
      let text = '';
      try { text = readFileSync(join(baseDir, rel), 'utf-8'); } catch { continue; }
      const r = this.injection.scan(text);
      if (r.detected) findings.push({ path: rel, type: r.type || 'unknown', confidence: r.confidence || 0, pattern: r.pattern || '' });
    }
    return findings;
  }

  // ── Import: validate + stage (the zip is UNTRUSTED) ─────────────────────────

  /** True if a relative zip entry name is unsafe (traversal / absolute / off-whitelist / escapes stage). */
  private isUnsafeEntry(name: string, stageDir: string): boolean {
    if (!name || name.startsWith('/') || name.includes('\0')) return true;             // absolute / NUL
    if (name.split('/').some(seg => seg === '..')) return true;                         // traversal
    const onWhitelist = WHITELIST_PREFIXES.some(p => p.endsWith('/') ? name.startsWith(p) : name === p);
    if (!onWhitelist) return true;   // off-whitelist (exact match for files like book.json; prefix for dirs)
    const resolved = join(stageDir, name);
    if (resolved !== stageDir && !resolved.startsWith(stageDir + '/')) return true;     // resolved escapes
    // Defense-in-depth: restrict entry names to a safe character set (path
    // segments of letters/digits/dot/dash/underscore, separated by '/').
    if (!/^[A-Za-z0-9._/-]+$/.test(name)) return true;
    return false;
  }

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
    for (const e of entries) {
      if (e.isDirectory) continue;
      const name = e.entryName;
      // Reject symlink-mode entries (adm-zip writes regular files, but be explicit).
      const attr = (e.header as unknown as { attr?: number })?.attr;
      if (attr && (((attr >>> 16) & 0o170000) === 0o120000)) return fail(`symlink entry rejected: ${name}`);
      if (this.isUnsafeEntry(name, stageDir)) return fail(`unsafe entry rejected: ${name}`);
      const dest = join(stageDir, name);
      try {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, e.getData());
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
    const slug = this.books.allocateSlug(manifest.title || 'imported-book');
    manifest.id = slug;
    manifest.slug = slug;
    writeFileSync(mfPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    // Build .baseline inside staging FIRST, so the rename lands a complete book
    // (templates + .baseline) atomically — a cp failure leaves staging intact for the caller to purge.
    const stageTemplates = join(stageDir, 'templates');
    const stageBaseline = join(stageDir, '.baseline');
    if (existsSync(stageTemplates)) cpSync(stageTemplates, stageBaseline, { recursive: true });
    else mkdirSync(stageBaseline, { recursive: true });
    const dest = join(this.booksDir, slug);
    try {
      renameSync(stageDir, dest);
    } catch (err) {
      // Fix #7: cross-filesystem fallback (EXDEV) — copy then remove the staging dir.
      if ((err as NodeJS.ErrnoException)?.code === 'EXDEV') {
        cpSync(stageDir, dest, { recursive: true });
        rmSync(stageDir, { recursive: true, force: true });
      } else { throw err; }
    }
    return manifest;
  }

  /** Purge every staging dir whose id is NOT in the pending set (orphans). */
  sweepStaging(pendingIds: Set<string>): void {
    if (!existsSync(this.stagingDir)) return;
    for (const e of readdirSync(this.stagingDir, { withFileTypes: true })) {
      if (e.isDirectory() && !pendingIds.has(e.name)) this.purgeStaging(e.name);
    }
  }
}
