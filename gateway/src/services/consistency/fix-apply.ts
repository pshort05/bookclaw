/**
 * Deterministic, pure find/replace for consistency fixes. The model is never in
 * the write path — it only proposes `oldPhrase → newPhrase` pairs; this applies
 * them. Each edit's `oldPhrase` must occur EXACTLY ONCE in the CURRENT working
 * text: zero occurrences → skipped `not-found`, two or more → skipped `ambiguous`
 * (we never guess which occurrence to change). A matching edit replaces that
 * single occurrence and the next edit anchors against the updated text. Never
 * throws — odd input (empty phrase, empty text) is reported as a skip or no-op.
 */

interface Edit {
  findingId: string;
  oldPhrase: string;
  newPhrase: string;
}

export interface ApplyResult {
  newText: string;
  applied: { findingId: string; oldPhrase: string; newPhrase: string }[];
  skipped: { findingId: string; oldPhrase: string; reason: 'not-found' | 'ambiguous' }[];
}

/** Count non-overlapping occurrences of `needle` in `haystack`. Empty needle → 0. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

export function applyEditsToText(text: string, edits: Edit[]): ApplyResult {
  let working = text;
  const applied: ApplyResult['applied'] = [];
  const skipped: ApplyResult['skipped'] = [];

  for (const e of edits) {
    const occurrences = countOccurrences(working, e.oldPhrase);
    if (occurrences === 0) {
      skipped.push({ findingId: e.findingId, oldPhrase: e.oldPhrase, reason: 'not-found' });
      continue;
    }
    if (occurrences >= 2) {
      skipped.push({ findingId: e.findingId, oldPhrase: e.oldPhrase, reason: 'ambiguous' });
      continue;
    }
    const idx = working.indexOf(e.oldPhrase);
    working = working.slice(0, idx) + e.newPhrase + working.slice(idx + e.oldPhrase.length);
    applied.push({ findingId: e.findingId, oldPhrase: e.oldPhrase, newPhrase: e.newPhrase });
  }

  return { newText: working, applied, skipped };
}
