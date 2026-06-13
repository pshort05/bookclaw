/**
 * Word-counting helpers shared by the project execution loops.
 *
 * `String.split(/\s+/)` overcounts because a leading whitespace char yields an
 * empty first token; this filters empties so the count is the actual number of
 * whitespace-delimited words.
 */

/** Count whitespace-delimited words, ignoring empty tokens. */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.split(/\s+/).filter((t) => t.length > 0).length;
}

/**
 * Append a continuation to existing prose, trimming a duplicated overlap where
 * the continuation re-emits the tail of what came before. Finds the longest
 * suffix of `existing` that is also a prefix of `continuation` (capped) and
 * drops it from the continuation before joining.
 */
export function appendContinuation(existing: string, continuation: string): string {
  const trimmedCont = continuation.replace(/^\s+/, '');
  const maxOverlap = Math.min(2000, existing.length, trimmedCont.length);
  const tail = existing.slice(existing.length - maxOverlap);
  // Walk from the longest possible overlap down to a meaningful minimum.
  for (let len = maxOverlap; len >= 40; len--) {
    if (tail.slice(tail.length - len) === trimmedCont.slice(0, len)) {
      return existing + trimmedCont.slice(len);
    }
  }
  return existing + '\n\n' + trimmedCont;
}

/** Shared cap on multi-pass continuation rounds (both execution loops). */
export const MAX_CONTINUATION_PASSES = 6;
