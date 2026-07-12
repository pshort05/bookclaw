/**
 * Archival-Recall in Chat (AuthorAgent port item #9).
 *
 * Pure formatting of memory-search hits into a compact system-prompt block
 * so past work (old conversations, project-step output) can inform replies.
 * No AI calls, no I/O — the caller is responsible for running the search.
 */
import type { SearchHit } from './memory-search.js';

export const ARCHIVAL_BLOCK_CAP = 1800;

const HEADING = '# From Your Past Work';

/**
 * Build a heading + one-entry-per-hit block, packing hits whole-or-skip
 * within `budgetChars`. Stops at the first hit that would not fit whole
 * (never emits a truncated hit). Returns '' if `hits` is empty or nothing
 * fits.
 */
export function buildArchivalBlock(hits: SearchHit[], budgetChars: number = ARCHIVAL_BLOCK_CAP): string {
  if (hits.length === 0) return '';

  const entries: string[] = [];
  let length = HEADING.length;

  for (const hit of hits) {
    const entry = formatHit(hit);
    const addedLength = 1 + entry.length; // leading '\n' separator
    if (length + addedLength > budgetChars) break;
    entries.push(entry);
    length += addedLength;
  }

  if (entries.length === 0) return '';

  return [HEADING, ...entries].join('\n');
}

function formatHit(hit: SearchHit): string {
  const title = hit.title?.trim() || hit.sourceRef;
  const snippet = hit.snippet.trim();
  return `- **${title}**: ${snippet}`;
}
