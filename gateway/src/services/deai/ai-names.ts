/**
 * Deterministic AI-name checker (zero-cost de-AI stage).
 *
 * A curated find/replace map of AI-default character names -> author alternatives,
 * applied by pure string replacement. Unlike banned-terms (narration only), this
 * runs GLOBALLY — INCLUDING dialogue — because a name must read the same in speech
 * and narration. Case-preserving and word-boundary aware (reuses applyBannedTerms
 * in 'global' scope). CSV storage mirrors banned-terms: a versioned seed +
 * workspace global + per-book overlay, columns `find,replace`.
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBannedCsv, mergeBannedTerms, applyBannedTerms, type BannedApplyResult } from './banned-terms.js';

export type AiNameMap = Array<{ find: string; replace: string }>;

/** Apply the AI-name map GLOBALLY (dialogue included). Thin wrapper over
 *  applyBannedTerms in 'global' scope so the case/word-boundary logic is shared. */
export function applyAiNames(text: string, names: AiNameMap): BannedApplyResult {
  return applyBannedTerms(text, names, { scope: 'global' });
}

/**
 * Load the AI-name map: create-if-absent global from the committed seed, merged
 * with the per-book overlay (overlay overrides global by `find`). Fail-soft: a
 * missing file → no entries. Blank-replace rows are dropped (a name map needs a
 * replacement; parseBannedCsv routes those to banOnly, which we ignore).
 */
export function loadAiNamesForBook(workspaceDir: string, slug: string, seedCsvPath: string): AiNameMap {
  const globalPath = join(workspaceDir, '.config', 'ai-names.csv');
  if (!existsSync(globalPath) && seedCsvPath && existsSync(seedCsvPath)) {
    try { mkdirSync(join(workspaceDir, '.config'), { recursive: true }); copyFileSync(seedCsvPath, globalPath); }
    catch { /* fail-soft: run against an empty map */ }
  }
  const readCsv = (p: string) => {
    try { return existsSync(p) ? parseBannedCsv(readFileSync(p, 'utf8')) : { fixed: [], banOnly: [] }; }
    catch { return { fixed: [], banOnly: [] }; }
  };
  const global = readCsv(globalPath);
  const overlay = readCsv(join(workspaceDir, 'books', slug, 'ai-names.csv'));
  return mergeBannedTerms(global, overlay).fixed;
}
