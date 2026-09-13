/**
 * Contradiction force-gate arithmetic (consistency-feedback design, Feature 2).
 *
 * The continuity ledger (continuity-check.ts) detects flags per chapter but
 * nothing stops the run on them — `maybeOpenCadenceGate` only annotates the
 * gate it was already opening. These three pure helpers answer "does this
 * chapter's contradiction count force a human gate?" so the decision is
 * testable without a project, a gate service, or HTTP.
 *
 * Threshold 6 is empirical, not a guess: on the live production book
 * (project-84) the per-chapter contradiction count peaks at 9, median 3, and
 * none reach 10 — so 6 fires on the four worst chapters (~17% of the book).
 * Overridable via BOOKCLAW_CONTRADICTION_GATE because the right number is
 * book- and genre-dependent.
 *
 * Pure: no I/O, no env reads (the caller passes the env string in), no logging.
 */
import type { ContinuityFlag } from './continuity-check.js';

/** Contradictions per chapter that force a human gate. `0` disables. */
export const CONTRADICTION_GATE_DEFAULT = 6;

/** How many of these flags are hard contradictions — knowledge/timeline flags
 *  are frequently benign and would gate almost every chapter, so they don't count. */
export function countContradictions(flags: Array<Pick<ContinuityFlag, 'kind'>> | undefined): number {
  if (!Array.isArray(flags)) return 0;
  return flags.filter((f) => f?.kind === 'contradiction').length;
}

/** The disable idiom, case-insensitive. An operator typing `off` or `false` is
 *  turning the gate OFF — a strict-integer parse used to fall back to 6 and
 *  turn it ON instead. */
const DISABLE_WORDS = new Set(['0', 'off', 'false', 'no']);

/** Parse BOOKCLAW_CONTRADICTION_GATE: a non-negative integer; `0`/`off`/
 *  `false`/`no` disable; anything else (unset, blank, garbage, negative,
 *  fractional) → the default. */
export function resolveThreshold(env?: string | undefined): number {
  const raw = (env ?? '').trim().toLowerCase();
  if (DISABLE_WORDS.has(raw)) return 0;
  if (!/^\d+$/.test(raw)) return CONTRADICTION_GATE_DEFAULT;
  return Number(raw);
}

/** Threshold 0 ⇒ never gate; otherwise gate at or above it. */
export function shouldForceGate(count: number, threshold: number): boolean {
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  return count >= threshold;
}

/** At most this many flag lines before "+N more". */
export const CONTRADICTION_FINDING_MAX_FLAGS = 10;
/** Hard cap on the whole note (the gate payload's other details cap at 1000). */
export const CONTRADICTION_FINDING_MAX_CHARS = 1200;

/**
 * The gate's contradiction note, as a human-readable STRING — the Confirmations
 * and GatePanel views render a non-string findings value as raw JSON, and one
 * long line there drags the entire findings payload into a JSON blob, degrading
 * the sibling romance/ending/craft notes. Mirrors those siblings' plain-prose
 * shape: the count + threshold, the "found in the draft" caveat, then the flag
 * details as lines, capped.
 */
export function describeContradictions(
  flags: Array<Pick<ContinuityFlag, 'kind' | 'detail'>> | undefined,
  threshold: number,
  chapterNumber?: number,
): string {
  const details = (Array.isArray(flags) ? flags : [])
    .filter((f) => f?.kind === 'contradiction')
    .map((f) => String(f?.detail ?? '').trim())
    .filter(Boolean);
  const count = countContradictions(flags);
  const where = typeof chapterNumber === 'number' ? ` in chapter ${chapterNumber}` : '';
  const head = `${count} contradiction${count === 1 ? '' : 's'}${where} — at or above the review threshold of ${threshold}.`
    + ' These were found in the DRAFT; the rewrite pass may have already fixed some.';
  const shown = details.slice(0, CONTRADICTION_FINDING_MAX_FLAGS).map((d) => `- ${d}`);
  const more = details.length > CONTRADICTION_FINDING_MAX_FLAGS
    ? [`+${details.length - CONTRADICTION_FINDING_MAX_FLAGS} more`]
    : [];
  const text = [head, ...shown, ...more].join('\n');
  if (text.length <= CONTRADICTION_FINDING_MAX_CHARS) return text;
  // Real flag details run long (the live ch18 payload overflows on 9 flags), so
  // cut back to a whole line rather than mid-sentence.
  const suffix = '\n… (truncated)';
  const cut = text.slice(0, CONTRADICTION_FINDING_MAX_CHARS - suffix.length);
  const lastLine = cut.lastIndexOf('\n');
  return (lastLine > 0 ? cut.slice(0, lastLine) : cut) + suffix;
}
