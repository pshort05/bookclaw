/**
 * Banned-terms registry (deterministic, zero-cost de-AI stage).
 *
 * A curated prohibited-terms list applied by pure string replacement before the
 * LLM de-AI passes. Two entry types:
 *   - Fixed substitution `{find, replace}` — hard-replaced in narration
 *     (case-insensitive match, case-preserving replace, word-boundary aware).
 *   - Ban-only `{find}` (blank replace) — NOT hard-replaced (that would flatten
 *     prose); instead injected into the LLM de-AI audit as the forbidden-words
 *     list so the model rewrites it in context.
 *
 * NARRATION ONLY: dialogue and Markdown are skipped for both the replace and the
 * injection (see narration-spans.ts) — these are the *author's* voice filters and
 * must never homogenize character speech.
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { protectedRanges, isProtected } from './narration-spans.js';

export interface BannedTerms {
  fixed: Array<{ find: string; replace: string }>;
  banOnly: string[];
}

/** Split one CSV line into fields, honoring double-quoted fields with commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function parseBannedCsv(csv: string): BannedTerms {
  const fixed: BannedTerms['fixed'] = [];
  const banOnly: string[] = [];
  const lines = String(csv ?? '').split(/\r?\n/).filter(l => l.trim());
  for (const line of lines) {
    let fields: string[];
    try { fields = splitCsvLine(line); }
    catch { console.log(`  ⚠ banned-terms: skipped malformed CSV row: ${line}`); continue; }
    const find = fields[0] ?? '';
    const replace = fields[1] ?? '';
    if (!find) continue;
    if (find.toLowerCase() === 'find') continue; // header
    if (replace) fixed.push({ find, replace });
    else banOnly.push(find);
  }
  return { fixed, banOnly };
}

export function mergeBannedTerms(global: BannedTerms, overlay: BannedTerms): BannedTerms {
  const overlayKeys = new Set<string>([
    ...overlay.fixed.map(e => e.find.toLowerCase()),
    ...overlay.banOnly.map(f => f.toLowerCase()),
  ]);
  const fixed = [
    ...global.fixed.filter(e => !overlayKeys.has(e.find.toLowerCase())),
    ...overlay.fixed,
  ];
  const banOnly = [
    ...global.banOnly.filter(f => !overlayKeys.has(f.toLowerCase())),
    ...overlay.banOnly,
  ];
  return { fixed, banOnly };
}

// --- applyBannedTerms (Task 3) ---

export interface BannedApplyResult { text: string; counts: Record<string, number>; total: number; }

/** Match the casing of `sample` onto `replacement` (all-caps / leading-cap / as-is). */
function preserveCase(sample: string, replacement: string): string {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return replacement.toUpperCase();
  if (sample[0] === sample[0]?.toUpperCase() && sample[0] !== sample[0]?.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/** Word-boundary literal matcher: \b only when the edge char is a word char. */
function termRegex(find: string): RegExp {
  const w = /\w/;
  const lead = w.test(find[0]) ? '\\b' : '';
  const tail = w.test(find[find.length - 1]) ? '\\b' : '';
  return new RegExp(`${lead}${escapeRe(find)}${tail}`, 'gi');
}

export function applyBannedTerms(
  text: string,
  fixed: Array<{ find: string; replace: string }>,
  opts?: { dryRun?: boolean },
): BannedApplyResult {
  let out = String(text ?? '');
  const counts: Record<string, number> = {};
  let total = 0;
  for (const { find, replace } of fixed) {
    if (!find) continue;
    const re = termRegex(find);
    // Recompute protected ranges each iteration — earlier replacements shift indices.
    const ranges = protectedRanges(out);
    let result = '', last = 0, n = 0;
    for (let m; (m = re.exec(out)); ) {
      if (isProtected(ranges, m.index)) continue;      // skip dialogue/markdown
      result += out.slice(last, m.index) + preserveCase(m[0], replace);
      last = m.index + m[0].length;
      n++;
    }
    result += out.slice(last);
    counts[find] = n; total += n;
    if (!opts?.dryRun && n > 0) out = result;
  }
  return { text: opts?.dryRun ? String(text ?? '') : out, counts, total };
}

// --- ban-only forbidden-words injection (Task 4) ---

export function forbiddenWordsInNarration(text: string, banOnly: string[]): string[] {
  const src = String(text ?? '');
  const ranges = protectedRanges(src);
  const present: string[] = [];
  for (const term of banOnly) {
    if (!term) continue;
    const re = termRegex(term);
    let hit = false;
    for (let m; (m = re.exec(src)); ) { if (!isProtected(ranges, m.index)) { hit = true; break; } }
    if (hit) present.push(term);
  }
  return present;
}

export function forbiddenWordsBlock(words: string[]): string {
  if (!words.length) return '';
  return `\n\n## Forbidden words (remove or rewrite in context — do NOT flag them in dialogue)\n`
    + `These appear in the narration and must be removed or rephrased in place:\n`
    + words.map(w => `- ${w}`).join('\n') + '\n';
}

// --- filesystem loader (global + per-book overlay) ---

/**
 * Load the global banned-terms registry (create-if-absent from the committed
 * seed) merged with the per-book overlay. Fail-soft: a missing file → empty
 * registry (no-op); the seed never overwrites an existing global.
 */
export function loadBannedTermsForBook(workspaceDir: string, slug: string, seedCsvPath: string): BannedTerms {
  const globalPath = join(workspaceDir, '.config', 'banned-terms.csv');
  if (!existsSync(globalPath) && seedCsvPath && existsSync(seedCsvPath)) {
    try { mkdirSync(join(workspaceDir, '.config'), { recursive: true }); copyFileSync(seedCsvPath, globalPath); }
    catch { /* fail-soft: run against an empty global */ }
  }
  const readCsv = (p: string): BannedTerms => {
    try { return existsSync(p) ? parseBannedCsv(readFileSync(p, 'utf8')) : { fixed: [], banOnly: [] }; }
    catch { return { fixed: [], banOnly: [] }; }
  };
  const global = readCsv(globalPath);
  const overlay = readCsv(join(workspaceDir, 'books', slug, 'banned-terms.csv'));
  return mergeBannedTerms(global, overlay);
}
