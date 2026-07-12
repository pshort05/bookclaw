/**
 * Shared zip-staging security guards (book-container Phases 5 + 12).
 * Both transfer services (book, library-entry) extract UNTRUSTED zips into an
 * isolated staging dir and scan the staged text for prompt-injection and HTML
 * payloads. The guards live here once so a hardening fix can't drift apart.
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { InjectionDetector } from '../security/injection.js';

// severity mirrors InjectionDetector's ('block' hard-gates the import; 'warn' is
// advisory-only, e.g. narrative prose). The HTML/event-handler payload check
// below is a separate, always-'block' guard (not part of the injection severity
// model).
export interface ImportFinding { path: string; type: string; confidence: number; pattern: string; severity: 'block' | 'warn'; }

/**
 * Extensions whose content is scanned for injection + HTML payloads (text only).
 * Includes the markup formats (.html/.htm/.xml/.svg) that could carry an
 * executable payload and be rendered in the studio origin — binaries (docx,
 * epub, images) are intentionally excluded. Findings are advisory (surfaced for
 * import review), so flagging a legitimate markup file is acceptable.
 */
export const SCAN_EXTS: readonly string[] = ['.md', '.markdown', '.txt', '.json', '.html', '.htm', '.xml', '.svg'];

// Detects raw HTML/script payloads that the prompt-injection detector doesn't cover.
// These could execute in the studio origin (which holds the auth token) via the
// markdown preview's dangerouslySetInnerHTML, even after DOMPurify — defense-in-depth.
export const HTML_RE = /<\s*(script|iframe|object|embed|svg|base|form|link|meta)\b/i;
export const EVENT_RE = /[\s/]on\w+\s*=/i;

// Zip-bomb / disk-exhaustion budget. Checked against the central-directory
// declared sizes BEFORE any entry is inflated to memory or written to disk —
// so a decompression bomb is rejected on its cheap declared size, never by
// allocating the inflated payload first.
export const MAX_ZIP_ENTRIES = 500;
export const MAX_ENTRY_BYTES = 25 * 1024 * 1024;          // 25MB/entry
export const MAX_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024;  // 100MB total

// A zip entry whose declared uncompressed size is 0 defeats adm-zip's per-entry
// inflation cap (it only sets zlib maxOutputLength when the declared size > 0),
// so a small compressed payload can inflate to a bomb before any guard fires. A
// genuinely empty entry has an empty compressed payload too; anything above this
// tiny slack is a lie we reject up front.
export const MAX_EMPTY_COMPRESSED = 64;

/** Returns an error string if the zip's declared sizes/count exceed budget, else null. Checks the cheap central-directory header.size BEFORE any entry is inflated, so a decompression bomb is rejected without allocating its payload. */
export function checkZipBudget(entries: Array<{ isDirectory: boolean; header: { size: number; compressedSize: number } }>): string | null {
  if (entries.length > MAX_ZIP_ENTRIES) return `too many entries (${entries.length} > ${MAX_ZIP_ENTRIES})`;
  let total = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const size = e.header.size;
    if (size <= 0 && e.header.compressedSize > MAX_EMPTY_COMPRESSED) return `entry declares empty but carries compressed payload (${e.header.compressedSize} bytes)`;
    if (size > MAX_ENTRY_BYTES) return `entry too large (${size} > ${MAX_ENTRY_BYTES} bytes)`;
    total += size;
    if (total > MAX_TOTAL_UNCOMPRESSED) return `total uncompressed too large (> ${MAX_TOTAL_UNCOMPRESSED} bytes)`;
  }
  return null;
}

/**
 * Post-inflation size guard. checkZipBudget() trusts the central-directory
 * declared sizes, which an attacker controls — a crafted zip can lie about
 * entry size and still inflate to a bomb. Call this with the ACTUAL inflated
 * buffer length and the running total inflated so far; it throws if either the
 * per-entry or the total uncompressed cap is exceeded. Returns the new running
 * total so the caller can thread it through the loop.
 */
export function assertInflatedSize(bufLen: number, runningTotal: number): number {
  if (bufLen > MAX_ENTRY_BYTES) {
    throw new Error(`entry too large after inflation (${bufLen} > ${MAX_ENTRY_BYTES} bytes)`);
  }
  const total = runningTotal + bufLen;
  if (total > MAX_TOTAL_UNCOMPRESSED) {
    throw new Error(`total uncompressed too large after inflation (> ${MAX_TOTAL_UNCOMPRESSED} bytes)`);
  }
  return total;
}

/** True if a relative zip entry name is unsafe (traversal / absolute / off-whitelist / escapes stage). */
export function isUnsafeEntry(name: string, stageDir: string, whitelistPrefixes: readonly string[]): boolean {
  if (!name || name.startsWith('/') || name.includes('\0')) return true;             // absolute / NUL
  if (name.split('/').some(seg => seg === '..')) return true;                         // traversal
  const onWhitelist = whitelistPrefixes.some(p => p.endsWith('/') ? name.startsWith(p) : name === p);
  if (!onWhitelist) return true;   // off-whitelist (exact match for files like book.json; prefix for dirs)
  const resolved = join(stageDir, name);
  if (resolved !== stageDir && !resolved.startsWith(stageDir + '/')) return true;     // resolved escapes
  // Defense-in-depth: restrict entry names to a safe character set (path
  // segments of letters/digits/dot/dash/underscore, separated by '/').
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return true;
  return false;
}

/** True if a zip entry's header attr encodes a symlink (adm-zip writes regular files, but be explicit). */
export function isSymlinkEntry(attr: number | undefined): boolean {
  return !!attr && (((attr >>> 16) & 0o170000) === 0o120000);
}

/** Recursively collect scannable text files (relative paths) under the given roots of baseDir. Never follows symlinks. */
export function scannableFiles(baseDir: string, roots: readonly string[], extraFiles: readonly string[] = []): string[] {
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
  for (const root of roots) walk(root);
  for (const f of extraFiles) {
    if (existsSync(join(baseDir, f))) out.push(f);
  }
  return out;
}

/** InjectionDetector + HTML/event-handler scan over the staged files. */
export function scanStagedText(baseDir: string, files: readonly string[], injection: InjectionDetector): ImportFinding[] {
  const findings: ImportFinding[] = [];
  for (const rel of files) {
    let text = '';
    try { text = readFileSync(join(baseDir, rel), 'utf-8'); } catch { continue; }
    const r = injection.scan(text);
    if (r.detected) {
      findings.push({ path: rel, type: r.type || 'unknown', confidence: r.confidence || 0, pattern: r.pattern || '', severity: r.severity || 'block' });
      continue; // already flagged — no need for the HTML check
    }
    if (HTML_RE.test(text) || EVENT_RE.test(text)) {
      findings.push({ path: rel, type: 'html_payload', confidence: 0.9, pattern: 'html/event-handler tag', severity: 'block' });
    }
  }
  return findings;
}
