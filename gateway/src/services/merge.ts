/**
 * Pure 3-way text merge for book re-pull (book-container Phase 4).
 *
 * Wraps node-diff3's line-based merge: auto-merges non-conflicting changes and
 * wraps genuine collisions in git-style markers labelled `book` (the book's
 * edited snapshot) and `library` (the current library version). No fs, no
 * globals — unit-testable in isolation. Pipeline JSON does NOT use this (it is
 * merged whole-asset; see BookService.repull).
 */
import { merge as diff3Merge } from 'node-diff3';

export interface MergeResult {
  merged: string;
  hadConflicts: boolean;
}

/**
 * 3-way merge of two edited versions against their common baseline.
 * @param baseline pristine version pulled at create/last-repull time
 * @param mine     the book's current (possibly edited) snapshot
 * @param theirs   the current library version
 */
export function mergeText(baseline: string, mine: string, theirs: string): MergeResult {
  const toLines = (s: string): string[] => s.split('\n');
  // node-diff3 merge(a, o, b): a + b are the two changed sides, o the ancestor.
  const r = diff3Merge(toLines(mine), toLines(baseline), toLines(theirs), {
    label: { a: 'book', b: 'library' },
  });
  return { merged: r.result.join('\n'), hadConflicts: r.conflict };
}
