/**
 * World Repository Phase 5 — Appendix render types and helpers.
 *
 * AppendixEntry:      the render-shaped type passed to DOCX/EPUB exporters.
 * stripAppendixCodes: removes in-world classification header lines from a doc body.
 * resolveBookAppendix: turns a book's manifest.appendix[] into ordered AppendixEntry[].
 */

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { BookService } from './book.js';
import type { WorldService } from './world.js';
import { parseWorldDoc } from './world-parse.js';

/** Render-shaped appendix entry passed to DOCX/EPUB exporters. */
export interface AppendixEntry {
  title: string;         // printed heading (manifest title override, else doc meta.title)
  attribution?: string;  // in-world "Compiled by…" line, kept verbatim
  body: string;          // narrative body, codes stripped when the world says so
}

/**
 * Remove in-world classification/clearance/distribution header lines from a
 * document body. These are prose-formatted metadata lines authors may include
 * at the top of a document's narrative section (e.g. "Classification: FG-GEO-0141").
 * Strips lines whose first non-markup token is one of:
 *   Classification:  Distribution:  Access Level:  Clearance:
 * (case-insensitive; tolerant of leading '#', '*', '>', '_', '-', whitespace).
 * Keeps all other lines including the attribution ("Compiled by…") line.
 * Pure; no I/O.
 */
export function stripAppendixCodes(body: string): string {
  const lines = body.split('\n');
  const kept = lines.filter((line) => {
    const probe = line.replace(/^[\s#>*_-]+/, '');
    return !/^(classification|distribution|access level|clearance)\s*:/i.test(probe);
  });
  return kept.join('\n');
}

/**
 * Resolve a book's manifest.appendix[] into ordered AppendixEntry[] for rendering.
 *
 * Resolution order:
 * 1. Snapshot: <templatesDir>/world/<docId>.md (if present and parseable).
 * 2. Live world: WorldService.getDocument(worldName, docId).
 * 3. If neither yields a document, warn and skip (fail-soft).
 *
 * stripAppendixCodes is applied when the world's stripCodesInAppendix !== false (default on).
 * Returns [] when appendix is absent/empty, or when no world is bound.
 * Never throws.
 */
export async function resolveBookAppendix(
  books: BookService,
  worlds: WorldService,
  slug: string,
): Promise<AppendixEntry[]> {
  let opened: Awaited<ReturnType<typeof books.open>>;
  try {
    opened = await books.open(slug);
  } catch {
    return [];
  }
  if (!opened) return [];

  const { manifest } = opened;
  const appendixEntries = manifest.appendix;
  if (!appendixEntries || appendixEntries.length === 0) return [];

  const worldName = manifest.pulledFrom?.world?.name;
  if (!worldName) {
    console.warn('  ⚠ Appendix: book has no bound world — skipping all appendix entries');
    return [];
  }

  // Determine strip setting (default: strip)
  let stripCodes = true;
  try {
    const cfg = worlds.getConfig(worldName);
    if (cfg && cfg.stripCodesInAppendix === false) stripCodes = false;
  } catch {
    // Fail-soft: keep default
  }

  const templDir = books.templatesDir ? books.templatesDir(slug) : null;

  // Sort by order ascending (stable — slice preserves relative order for equal values)
  const sorted = [...appendixEntries].sort((a, b) => a.order - b.order);

  const result: AppendixEntry[] = [];

  for (const entry of sorted) {
    let docTitle: string | undefined;
    let attribution: string | undefined;
    let body: string | undefined;

    // 1. Try snapshot
    if (templDir) {
      const snapshotPath = join(templDir, 'world', `${entry.docId}.md`);
      try {
        const raw = await readFile(snapshotPath, 'utf-8');
        const parsed = parseWorldDoc(raw);
        if (parsed.meta.appendixEligible === false) {
          console.warn(`  ⚠ Appendix: docId "${entry.docId}" is not appendixEligible — skipping`);
          continue;
        }
        docTitle = parsed.meta.title;
        attribution = parsed.meta.attribution;
        body = parsed.body;
      } catch {
        // Fall through to live world
      }
    }

    // 2. Try live world fallback
    if (body === undefined) {
      try {
        const doc = worlds.getDocument(worldName, entry.docId);
        if (doc) {
          if (doc.meta.appendixEligible === false) {
            console.warn(`  ⚠ Appendix: docId "${entry.docId}" is not appendixEligible — skipping`);
            continue;
          }
          docTitle = doc.meta.title;
          attribution = doc.meta.attribution;
          body = doc.body;
        }
      } catch {
        // Fall through to skip
      }
    }

    // 3. Skip if not found
    if (body === undefined) {
      console.warn(`  ⚠ Appendix: docId "${entry.docId}" not found — skipping`);
      continue;
    }

    const resolvedBody = stripCodes ? stripAppendixCodes(body) : body;
    const resolvedTitle = (entry.title && entry.title.length > 0) ? entry.title : (docTitle ?? entry.docId);

    const appendixEntry: AppendixEntry = {
      title: resolvedTitle,
      body: resolvedBody,
    };
    if (attribution) appendixEntry.attribution = attribution;

    result.push(appendixEntry);
  }

  return result;
}
