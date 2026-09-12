/**
 * Chapter version resolution (View Book §4). ONE answer to "which step, and
 * which file, is chapter N" — for every pipeline.
 *
 * The `romance-*-deterministic` pipelines write seven steps per chapter (scene
 * brief → first draft → improvement plan → rewrite → consistency audit →
 * consistency apply → de-AI sweep), four of which are full prose. Older
 * pipelines write `Write Chapter N` / `Polish Chapter N`. Anything that matches
 * on "the label contains 'chapter'" therefore collects briefs and JSON audit
 * reports and several prose passes at once; anything that matches only
 * `write|polish` misses the deterministic pipelines entirely.
 *
 * Classification is by ROLE, parsed from the step label (or, on disk, from the
 * slugified step-output file name, which is the same label). Non-prose versions
 * stay in the trail — the reading surface shows all seven — but never satisfy
 * `latestProseStep`, so assembly and analysis get exactly one file per chapter.
 *
 * Pure: no I/O, no logging.
 */

export type ChapterRole = 'scene-brief' | 'first-draft' | 'improvement-plan' | 'rewrite'
  | 'consistency-audit' | 'consistency-apply' | 'humanize' | 'humanize-pass' | 'intimacy'
  | 'apply-edits' | 'write' | 'polish' | 'unknown';

export interface ChapterVersion {
  id: string;          // step id
  label: string;       // step label
  role: ChapterRole;
  isProse: boolean;
  createdAt?: string;
  latest: boolean;     // true only on the last PROSE version
}

/** Roles whose output IS the chapter text. The rest are briefs/plans/reports. */
const PROSE_ROLES: ReadonlySet<ChapterRole> = new Set<ChapterRole>([
  'first-draft', 'rewrite', 'consistency-apply', 'humanize', 'humanize-pass', 'intimacy',
  'apply-edits', 'write', 'polish',
]);

/** Role markers, matched against the slugified label. First match wins, so the
 * two-word roles are listed before any single-word role they contain.
 * Every pattern below answers a label a SHIPPED pipeline actually writes (see
 * library/pipelines/*.json) — a prose label missing from this table classifies
 * as `unknown`, which drops its chapter out of assembly, export and the
 * reading surface. */
const ROLE_PATTERNS: ReadonlyArray<[ChapterRole, RegExp]> = [
  ['scene-brief', /(^|-)scene-brief(-|$)/],
  ['improvement-plan', /(^|-)improvement-plan(-|$)/],
  ['consistency-audit', /(^|-)consistency-audit(-|$)/],
  ['consistency-apply', /(^|-)consistency-apply(-|$)/],
  // "Humanize — De-AI Sweep" and the legacy "Humanize (Deterministic)".
  ['humanize', /(^|-)humanize(-|$)/],
  // humanize-claude/gemini: "Pass 7: Weak-Language Cleanup — Chapter N" (and
  // "Pass 8.5: …"). Each pass rewrites the whole chapter; the last one ships.
  // Not anchored at the start: on disk the slug is prefixed with the step id.
  ['humanize-pass', /(^|-)pass-\d/],
  // romance-*-full / romance-spicy / romance-sweet: the FINAL pass, after humanize.
  ['intimacy', /(^|-)intimacy(-|$)/],
  // editorial-*: "Apply Copyedits / Line Edits / Developmental Edits /
  // Proofreading Fixes / Alpha-Read Revisions / Fingerprint Fixes — Chapter N"
  // (their critique/audit siblings carry no "apply" and stay non-prose).
  // Listed after consistency-apply so that role keeps its own identity.
  ['apply-edits', /(^|-)apply(-|$)/],
  // scene-drafter writes the first draft as "Draft Scene — Chapter N".
  ['first-draft', /(^|-)(first-draft|draft-scene)(-|$)/],
  ['rewrite', /(^|-)rewrite(-|$)/],
  ['polish', /(^|-)polish(-|$)/],
  ['write', /(^|-)write(-|$)/],
];

/** The slug form a step label takes on disk (see the step-file writer). */
const slugify = (s: string): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** True when the role's output is chapter prose rather than a brief/plan/report. */
export function isProseRole(role: ChapterRole): boolean {
  return PROSE_ROLES.has(role);
}

/** Classify a step LABEL (used by the two functions below). */
export function classifyRole(label: string): ChapterRole {
  const slug = slugify(label);
  for (const [role, re] of ROLE_PATTERNS) if (re.test(slug)) return role;
  return 'unknown';
}

/** Chapter number carried by a label (or file-name slug), or null. */
function chapterNumberIn(text: string): number | null {
  const m = /(?:^|-)chapter-(\d+)(?:-|$)/.exec(slugify(text));
  return m ? Number(m[1]) : null;
}

/** The chapter a step belongs to: `step.chapterNumber` first, label as fallback. */
export function stepChapterNumber(step: any): number | null {
  const n = step?.chapterNumber;
  if (typeof n === 'number' && Number.isFinite(n)) return n;
  return chapterNumberIn(step?.label ?? '');
}

/** Classify an on-disk step-output FILENAME → chapter number + role, or null.
 * Null for anything without both a chapter number and a recognised role — so a
 * compile report, a premise step, or a whole-manuscript revision rewrite (which
 * carries no chapter number) is not mistaken for a chapter. */
export function classifyChapterFile(name: string): { number: number; role: ChapterRole } | null {
  const base = String(name ?? '').replace(/\.md$/i, '');
  const number = chapterNumberIn(base);
  if (number === null) return null;
  const role = classifyRole(base);
  if (role === 'unknown') return null;
  return { number, role };
}

/** Every step belonging to one chapter, in pipeline (step-list) order. */
function stepsForChapter(steps: any[], chapterNumber: number): any[] {
  return (steps ?? []).filter((s) => stepChapterNumber(s) === chapterNumber);
}

/** The step holding the chapter's current text, or null. The LAST completed
 * prose step in pipeline order — never a brief, plan, or audit report. */
export function latestProseStep(steps: any[], chapterNumber: number): any | null {
  const mine = stepsForChapter(steps, chapterNumber);
  for (let i = mine.length - 1; i >= 0; i--) {
    const s = mine[i];
    if (s.status === 'completed' && isProseRole(classifyRole(s.label))) return s;
  }
  return null;
}

/** A step result long enough to be a chapter rather than a note or a stub. */
const SUBSTANTIAL_TEXT = 200;

/**
 * The step whose text IS chapter N, for assembly/export — the resolved prose
 * step, degrading to the last completed step for that chapter with substantial
 * text when NO label of that chapter matched a prose role.
 *
 * The fallback is what keeps an unrecognised pipeline exporting: a prose-role-
 * only filter silently returns zero chapters for it (EPUB/DOCX, the beta-reader
 * gate and lesson extraction all go empty). Recognising the real labels above is
 * the first defence; this is the one that can't be outrun by a future pipeline.
 */
export function chapterTextStep(steps: any[], chapterNumber: number): any | null {
  const prose = latestProseStep(steps, chapterNumber);
  if (prose) return prose;
  const mine = stepsForChapter(steps, chapterNumber);
  for (let i = mine.length - 1; i >= 0; i--) {
    const s = mine[i];
    if (s.status === 'completed' && String(s.result ?? '').trim().length > SUBSTANTIAL_TEXT) return s;
  }
  return null;
}

/** Every chapter the project has text for, in chapter order — one step each. */
export function chapterTextSteps(steps: any[]): Array<{ number: number; step: any }> {
  const numbers = [...new Set(
    (steps ?? []).map(stepChapterNumber).filter((n): n is number => n !== null),
  )].sort((a, b) => a - b);
  return numbers
    .map((number) => ({ number, step: chapterTextStep(steps, number) }))
    .filter((c) => c.step !== null);
}

/** Ordered versions (pipeline order) for one chapter, prose + non-prose tagged. */
export function chapterVersions(steps: any[], chapterNumber: number): ChapterVersion[] {
  const mine = stepsForChapter(steps, chapterNumber);
  const latestId = latestProseStep(mine, chapterNumber)?.id;
  return mine.map((s) => {
    const role = classifyRole(s.label);
    return {
      id: s.id,
      label: s.label,
      role,
      isProse: isProseRole(role),
      createdAt: s.completedAt ?? s.createdAt,
      latest: latestId !== undefined && s.id === latestId,
    };
  });
}
