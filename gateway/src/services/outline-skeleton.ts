import { computeBeats } from './pipeline-vars.js';

/**
 * Two-tier outline context (C1). The deterministic romance pipeline's per-chapter
 * steps ran on the DEFAULT branch of buildProjectContext, where the outline reached
 * them only as a head+tail slice of the outline step — so the middle chapters
 * ("[...middle omitted...]") never reached the Scene Brief and the back half
 * re-plotted (audit: "outline only runs through Chapter 9"). This module builds a
 * deterministic, truncation-proof block for chapter N: a SHORT skeleton of the whole
 * book (every chapter, with its structural beat label) plus the FULL prior/current/
 * next chapter sections sliced from the detailed outline. No model call — pure code,
 * so the arc and the ending beats are always legible and cannot drift.
 */

const HEADING_RE = /^\s*(?:#{1,6}\s*)?\*{0,2}\s*Chapter\s+(\d+)\s*[—–:-]\s*(.+?)\s*\*{0,2}\s*$/gim;

/** Options for the skeleton/block builders. `spicy` gates the "Intimate scene" tag. */
export interface OutlineOpts { chapterCount?: number; spicy?: boolean; }

/**
 * The romance structural beat for chapter `n` of a book with `chapterCount`
 * chapters, using the same beat boundaries the outline was generated against
 * (computeBeats). The final chapter is always the HEA/HFN landing.
 */
export function beatForChapter(n: number, chapterCount: number): string {
  if (!Number.isFinite(chapterCount) || chapterCount <= 0) return '';
  if (n >= chapterCount) return 'HEA / HFN';
  const b = computeBeats(chapterCount);
  if (n <= b.setupEnd) return n === 1 ? 'Meet-cute' : 'Setup';
  if (n <= b.incitingEnd) return 'Inciting connection';
  if (n < b.midpoint) return 'Rising attraction';
  if (n === b.midpoint) return 'Midpoint shift';
  if (n < b.twist75) return 'Complications';
  if (n === b.twist75) return 'Black moment';
  if (n < b.climaxStart) return 'Fallout';
  return 'Grovel & reunion';
}

/**
 * Slice a single chapter's section out of a joined outline block: from its
 * "Chapter <n>" heading up to the next chapter heading (or end). Returns null when
 * no heading for that chapter exists (callers fail soft). (Moved here from
 * projects.ts so the outline helpers live together.)
 */
export function extractOutlineChapterSection(outlineText: string, chapterNum: number): string | null {
  const re = new RegExp(HEADING_RE.source, 'gim');
  let match: RegExpExecArray | null;
  let start = -1;
  let end = outlineText.length;
  while ((match = re.exec(outlineText)) !== null) {
    if (start === -1) {
      if (Number(match[1]) === chapterNum) start = match.index;
      continue;
    }
    end = match.index;
    break;
  }
  if (start === -1) return null;
  return outlineText.slice(start, end).trim();
}

/** Highest chapter number that has a heading in the outline (the real arc length). */
export function outlineChapterCount(outlineText: string): number {
  const re = new RegExp(HEADING_RE.source, 'gim');
  let m: RegExpExecArray | null;
  let max = 0;
  while ((m = re.exec(outlineText)) !== null) max = Math.max(max, Number(m[1]));
  return max;
}

// Pull a single outline field ("- **Goal:** …") from a chapter section, condensed
// to its first sentence and capped so the skeleton stays compact.
function field(section: string, name: string, cap = 160): string {
  const m = section.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`, 'i'));
  if (!m) return '';
  let v = m[1].trim();
  const dot = v.search(/(?<=\.)\s/); // first sentence boundary
  if (dot > 0 && dot < cap) v = v.slice(0, dot).trim();
  return v.length > cap ? v.slice(0, cap).trimEnd() + '…' : v;
}

// Content-derived beat detection (romance). The outline states these beats in
// explicit, consistent language ("first kiss", "First sex scene", "THE GROVEL /
// reunion"), so we surface them in the skeleton — the exact beats the audit found
// the drafts dropping (mandated intimate scenes, the reunion/HEA).
const KISS_RE = /\bfirst kiss\b|\bthey (?:finally )?kiss\b|\bthe real (?:one|kiss)\b|\bfinally kiss(?:es|ed)?\b|\bkiss(?:es|ed)? (?:her|him)\b/i;
const INTIMATE_RE = /\b(?:sex scene|intimate scene|makes? love|making love|consummat\w*|sleep together|slept together|first time together)\b/i;
const REUNION_RE = /\breunion\b|\breconcil\w*|\breunit\w*|\bgrovel\b|gets? back together|wins? (?:her|him) back/i;

// The full (uncondensed) value of an outline field, used for detection.
function rawField(section: string, name: string): string {
  const m = section.match(new RegExp(`\\*\\*${name}:\\*\\*\\s*(.+)`, 'i'));
  return m ? m[1].trim() : '';
}

// Detect the content beats present in one chapter section. Kiss/intimacy are read
// from the Outcome (what actually HAPPENS) so a setup chapter's "sets up the first
// kiss" is not mistaken for the kiss; reunion is read from the whole section
// (it is often stated in Plot Threads).
function contentBeats(section: string, spicy: boolean): { kiss: boolean; intimate: boolean; reunion: boolean } {
  const outcome = rawField(section, 'Outcome') || section;
  return {
    kiss: KISS_RE.test(outcome),
    intimate: spicy && INTIMATE_RE.test(outcome),
    reunion: REUNION_RE.test(section),
  };
}

function chapterTitle(section: string): { num: number; title: string } | null {
  const re = new RegExp(HEADING_RE.source, 'im');
  const m = section.match(re);
  if (!m) return null;
  return { num: Number(m[1]), title: (m[2] || '').trim() };
}

/**
 * The SHORT skeleton: one compact entry per chapter — heading + structural beat
 * label + a condensed "POV · goal → outcome" line. Every chapter is present (never
 * truncated), so the whole arc and the ending beats are always in view.
 */
export function deriveShortOutline(outlineText: string, opts: OutlineOpts = {}): string {
  const total = opts.chapterCount && opts.chapterCount > 0 ? opts.chapterCount : outlineChapterCount(outlineText);
  const spicy = !!opts.spicy;
  const lines: string[] = [];
  let firstKissDone = false;
  for (let n = 1; n <= total; n++) {
    const section = extractOutlineChapterSection(outlineText, n);
    const head = section ? chapterTitle(section) : null;
    const title = head?.title || '';
    const tags: string[] = [beatForChapter(n, total)];
    if (section) {
      const cb = contentBeats(section, spicy);
      if (cb.kiss && !firstKissDone) { tags.push('First Kiss'); firstKissDone = true; }
      if (cb.intimate) tags.push('Intimate scene');
      if (cb.reunion && n < total) tags.push('Reunion'); // the final chapter is the HEA, not a reunion beat
    }
    lines.push(`Chapter ${n} — ${title}  [Beat: ${tags.join(' · ')}]`);
    if (section) {
      const pov = field(section, 'POV', 40);
      const goal = field(section, 'Goal');
      const outcome = field(section, 'Outcome');
      const parts: string[] = [];
      if (pov) parts.push(`POV ${pov}`);
      const arc = [goal, outcome].filter(Boolean).join(' → ');
      if (arc) parts.push(arc);
      if (parts.length) lines.push(`  ${parts.join(' · ')}`);
    }
  }
  return lines.join('\n');
}

/**
 * The full two-tier block injected into a per-chapter step's context: the short
 * whole-book skeleton, then the FULL prior/current/next chapter sections from the
 * detailed outline. For the final chapter, the "next" slot instructs the model to
 * deliver the ending now (there is no chapter after it to defer to).
 */
export function buildTwoTierOutlineBlock(outlineText: string, chapterNumber: number, opts: OutlineOpts = {}): string {
  const total = opts.chapterCount && opts.chapterCount > 0 ? opts.chapterCount : outlineChapterCount(outlineText);
  const skeleton = deriveShortOutline(outlineText, { chapterCount: total, spicy: opts.spicy });
  const cur = extractOutlineChapterSection(outlineText, chapterNumber);
  const prev = chapterNumber > 1 ? extractOutlineChapterSection(outlineText, chapterNumber - 1) : null;
  const next = chapterNumber < total ? extractOutlineChapterSection(outlineText, chapterNumber + 1) : null;

  let out = `## Story skeleton — every chapter and its beat (the whole arc; stay on it)\n\n${skeleton}\n\n`;
  out += `## Outline detail for this chapter (write to THIS beat)\n\n`;
  out += `### ← Chapter ${chapterNumber - 1} (previous — already written)\n${prev ?? '(none — this is the first chapter)'}\n\n`;
  out += `### ▶ Chapter ${chapterNumber} — write this chapter\n${cur ?? '(this chapter has no outline section — follow the skeleton beat)'}\n\n`;
  if (next) {
    out += `### → Chapter ${chapterNumber + 1} (next — set up, do NOT resolve here)\n${next}\n`;
  } else {
    out += `### → (none — this is the FINAL chapter: deliver the ending/HEA now; do not defer it to a later chapter)\n`;
  }
  return out;
}
