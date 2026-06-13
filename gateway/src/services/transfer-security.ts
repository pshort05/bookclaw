/**
 * Shared zip-staging security guards (book-container Phases 5 + 12).
 * Both transfer services (book, library-entry) extract UNTRUSTED zips into an
 * isolated staging dir and scan the staged text for prompt-injection and HTML
 * payloads. The guards live here once so a hardening fix can't drift apart.
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { InjectionDetector } from '../security/injection.js';

export interface ImportFinding { path: string; type: string; confidence: number; pattern: string; }

/** Extensions whose content is scanned for injection (text only). */
export const SCAN_EXTS: readonly string[] = ['.md', '.txt', '.json'];

// Detects raw HTML/script payloads that the prompt-injection detector doesn't cover.
// These could execute in the studio origin (which holds the auth token) via the
// markdown preview's dangerouslySetInnerHTML, even after DOMPurify — defense-in-depth.
export const HTML_RE = /<\s*(script|iframe|object|embed|svg|base|form|link|meta)\b/i;
export const EVENT_RE = /\son\w+\s*=/i;

// Zip-bomb / disk-exhaustion budget. Checked against the central-directory
// declared sizes BEFORE any entry is inflated to memory or written to disk.
export const MAX_ZIP_ENTRIES = 500;
export const MAX_ENTRY_BYTES = 25 * 1024 * 1024;          // 25MB/entry
export const MAX_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024;  // 100MB total

/** Returns an error string if the zip's declared sizes/count exceed budget, else null. Checks BEFORE extraction. */
export function checkZipBudget(entries: Array<{ isDirectory: boolean; header: { size: number } }>): string | null {
  if (entries.length > MAX_ZIP_ENTRIES) return `too many entries (${entries.length} > ${MAX_ZIP_ENTRIES})`;
  let total = 0;
  for (const e of entries) {
    if (e.isDirectory) continue;
    const size = e.header.size;
    if (size > MAX_ENTRY_BYTES) return `entry too large (${size} > ${MAX_ENTRY_BYTES} bytes)`;
    total += size;
    if (total > MAX_TOTAL_UNCOMPRESSED) return `total uncompressed too large (> ${MAX_TOTAL_UNCOMPRESSED} bytes)`;
  }
  return null;
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
      findings.push({ path: rel, type: r.type || 'unknown', confidence: r.confidence || 0, pattern: r.pattern || '' });
      continue; // already flagged — no need for the HTML check
    }
    if (HTML_RE.test(text) || EVENT_RE.test(text)) {
      findings.push({ path: rel, type: 'html_payload', confidence: 0.9, pattern: 'html/event-handler tag' });
    }
  }
  return findings;
}
