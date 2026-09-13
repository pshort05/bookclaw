/**
 * Deterministic (zero-AI) budget-conflict detection for premise intake.
 *
 * A premise document usually states its own length ("24–28 chapters, based on
 * 80,000–90,000 words"). Intake also proposes a chapterCount × wordsPerChapter.
 * When the two disagree nothing used to notice: the figure stayed in the blueprint
 * seed, the outline prompt treated the blueprint as canon, and a 60,000-word book
 * came back outlined at ~90,000 (Firefly Pond, production).
 *
 * This module finds the length claims in the seed TEXT and compares them with the
 * chosen settings. It is deliberately conservative — a false alarm at intake costs
 * the author a decision on every new book, so an ambiguous figure is ignored:
 *  - lines that name a segment (Act 2, Part I, Chapters 1–8) are skipped entirely,
 *    because their word figures are subtotals, not whole-book totals;
 *  - a "total" under MIN_TOTAL_WORDS is treated as a section note, not a book length.
 */

export type BudgetKind = 'total' | 'chapters' | 'perChapter';
export interface BudgetConflict {
  kind: BudgetKind;
  claimed: string;   // the figure as the premise wrote it, e.g. "80,000–90,000 words"
  chosen: string;    // the chosen setting, e.g. "60,000 words (25 chapters × 2,400)"
  detail: string;    // the line the claim was found on
}

const TOTAL_TOLERANCE = 0.15;     // single stated total vs chosen total
const CHAPTERS_TOLERANCE = 0.10;  // single stated chapter count vs chosen count
const PER_CHAPTER_TOLERANCE = 0.15;
const MIN_TOTAL_WORDS = 15_000;   // below this a "N words" figure is a section note
const MIN_CHAPTER_CLAIM = 5;      // below this a "N chapters" figure is not a book length
const MIN_PER_CHAPTER_WORDS = 500;
const MAX_PER_CHAPTER_WORDS = 20_000;
const MAX_DETAIL_CHARS = 200;

// A line that scopes its figures to one part of the book — its numbers are subtotals.
const SEGMENT_LINE =
  /\b(?:acts?|parts?|sections?|sequences?|episodes?|movements?|chapters?|ch\.)\s*#?\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|viii|vii|iii|ii|iv|ix|vi|xi|i|v|x)\b/i;
const PER_SEGMENT = /\bper[- ](?:act|part|section|scene)\b|\beach\s+(?:act|part|section|scene)\b/i;
// Context around a word figure that scopes it to a single chapter.
const PER_CHAPTER_CUE = /per[- ]chapter|(?:a|each|every)\s+chapter|chapters?\s+of|chapter\s+length|\/\s*chapters?/i;

const NUM = String.raw`\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?`;
const APPROX = String.raw`(?:~|about|approx(?:\.|imately)?|around|roughly|circa|est\.?)?\s*`;
const RANGE = String.raw`\s*(?:–|—|-|to)\s*`;
const FIGURE = `${APPROX}(${NUM})(k\\b)?(?:${RANGE}(${NUM})(k\\b)?)?`;
const WORDS_RE = new RegExp(`${FIGURE}[\\s-]*words?\\b`, 'gi');
const CHAPTERS_RE = new RegExp(`${FIGURE}\\s*chapters?\\b`, 'gi');

const toNumber = (raw: string, k?: string): number => {
  const n = parseFloat(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? (k ? n * 1000 : n) : NaN;
};
const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

interface Claim { lo: number; hi: number; text: string; line: string; }

/** Every `<figure> <unit>` claim on a line, with its matched text and range bounds. */
function claimsOnLine(line: string, re: RegExp): Array<Claim & { start: number; end: number }> {
  const out: Array<Claim & { start: number; end: number }> = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const lo = toNumber(m[1], m[2]);
    const hi = m[3] ? toNumber(m[3], m[4]) : lo;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo <= 0) continue;
    out.push({ lo: Math.min(lo, hi), hi: Math.max(lo, hi), text: m[0].trim(), line, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** A range conflicts when the chosen value falls outside it; a single figure when it is off by more than `tolerance`. */
function conflicts(claim: Claim, chosen: number, tolerance: number): boolean {
  if (claim.hi > claim.lo) return chosen < claim.lo || chosen > claim.hi;
  return Math.abs(chosen - claim.lo) / claim.lo > tolerance;
}

const detail = (line: string): string => {
  const t = line.trim();
  return t.length > MAX_DETAIL_CHARS ? `${t.slice(0, MAX_DETAIL_CHARS)}…` : t;
};

export function detectBudgetConflicts(seedText: string, chapterCount: number, wordsPerChapter: number): BudgetConflict[] {
  try {
    if (typeof seedText !== 'string' || !seedText.trim()) return [];
    if (!Number.isFinite(chapterCount) || !Number.isFinite(wordsPerChapter) || chapterCount <= 0 || wordsPerChapter <= 0) return [];
    const chosenTotal = chapterCount * wordsPerChapter;
    const chosenTotalLabel = `${fmt(chosenTotal)} words (${fmt(chapterCount)} chapters × ${fmt(wordsPerChapter)})`;

    const found: BudgetConflict[] = [];
    const seen = new Set<string>();
    const add = (kind: BudgetKind, claim: Claim, chosen: string) => {
      const key = `${kind}|${claim.lo}|${claim.hi}`;
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ kind, claimed: claim.text, chosen, detail: detail(claim.line) });
    };

    for (const line of seedText.split(/\r?\n/)) {
      if (!line.trim() || SEGMENT_LINE.test(line) || PER_SEGMENT.test(line)) continue;

      for (const claim of claimsOnLine(line, WORDS_RE)) {
        const before = line.slice(Math.max(0, claim.start - 40), claim.start);
        const after = line.slice(claim.end, claim.end + 25);
        if (PER_CHAPTER_CUE.test(before) || PER_CHAPTER_CUE.test(after)) {
          if (claim.lo < MIN_PER_CHAPTER_WORDS || claim.hi > MAX_PER_CHAPTER_WORDS) continue;
          if (conflicts(claim, wordsPerChapter, PER_CHAPTER_TOLERANCE)) add('perChapter', claim, `${fmt(wordsPerChapter)} words per chapter`);
          continue;
        }
        if (claim.lo < MIN_TOTAL_WORDS) continue;
        if (conflicts(claim, chosenTotal, TOTAL_TOLERANCE)) add('total', claim, chosenTotalLabel);
      }

      for (const claim of claimsOnLine(line, CHAPTERS_RE)) {
        if (claim.lo < MIN_CHAPTER_CLAIM) continue;
        if (conflicts(claim, chapterCount, CHAPTERS_TOLERANCE)) add('chapters', claim, `${fmt(chapterCount)} chapters`);
      }
    }
    return found;
  } catch {
    return []; // fail-soft: a detection bug must never break intake
  }
}
