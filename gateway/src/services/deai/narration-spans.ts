/**
 * Narration-only span mask shared by the banned-terms replace and the ban-only
 * forbidden-words injection. Marks dialogue (quoted spans) and Markdown
 * (headers, horizontal rules, *italic* markers) as PROTECTED so the author's
 * voice filters never touch character speech or structure. Mirrors the de-AI
 * audit skill's "never flag dialogue or Markdown" rule.
 *
 * Reuses the quote-character set from dialogue-parser.ts (`" “ ”`). That module
 * detects dialogue at the *paragraph* level (startsWithQuote); here we need
 * *inline* quote spans, so this is a distinct char-range mask — the single
 * source of "what counts as protected" for both the replace and the injection.
 */

/** Half-open [start,end) ranges to skip, in ascending order (may overlap). */
export function protectedRanges(text: string): Array<[number, number]> {
  const src = String(text ?? '');
  const ranges: Array<[number, number]> = [];

  // 1) Dialogue: any run from an opening quote char to the next quote char.
  const quote = /["“”][^"“”]*["“”]/g;
  for (let m; (m = quote.exec(src)); ) ranges.push([m.index, m.index + m[0].length]);

  // 2) Markdown line-level: header lines (#, ##, ...) and horizontal rules (---).
  const lineRe = /^[ \t]*(#{1,6}\s.*|-{3,}\s*)$/gm;
  for (let m; (m = lineRe.exec(src)); ) ranges.push([m.index, m.index + m[0].length]);

  // 3) Markdown inline emphasis: *italic* / **bold** spans.
  const em = /\*{1,2}[^*\n]+\*{1,2}/g;
  for (let m; (m = em.exec(src)); ) ranges.push([m.index, m.index + m[0].length]);

  return ranges.sort((a, b) => a[0] - b[0]);
}

export function isProtected(ranges: Array<[number, number]>, index: number): boolean {
  for (const [s, e] of ranges) {
    if (index >= s && index < e) return true;
    if (s > index) break; // sorted — no later range can contain index
  }
  return false;
}
