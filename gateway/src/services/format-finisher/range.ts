/**
 * Resolve a heading-text range to a [start, end) paragraph-index window.
 * `start`/`end` match the first heading whose text contains the marker
 * (case-insensitive); `end` is exclusive. Unmatched markers fall back to the
 * document bounds. Re-run after any transform that changes paragraph count.
 */
import { isHeading, paraText } from './ooxml.js';
import { FinishInputError } from './errors.js';

/**
 * Resolve [start,end) over the body paragraphs. When `strict`, an unmatched
 * start/end marker throws FinishInputError (clean_docx.py aborts rather than
 * silently finishing the whole document); when not strict, an unmatched marker
 * falls back to the document bound (used by per-transform re-resolution).
 */
export function resolveRange(paras: Element[], start?: string, end?: string, strict = false): [number, number] {
  const lc = (s: string) => s.toLowerCase();
  let startIdx = 0;
  if (start) {
    const needle = lc(start);
    const i = paras.findIndex((p) => isHeading(p) && lc(paraText(p)).includes(needle));
    if (i >= 0) startIdx = i;
    else if (strict) throw new FinishInputError(`No heading found containing "${start}"`);
  }
  let endIdx = paras.length;
  if (end) {
    const needle = lc(end);
    const j = paras.findIndex((p, i) => i > startIdx && isHeading(p) && lc(paraText(p)).includes(needle));
    if (j >= 0) endIdx = j;
    else if (strict) throw new FinishInputError(`No heading found containing "${end}"`);
  }
  return [startIdx, endIdx];
}
