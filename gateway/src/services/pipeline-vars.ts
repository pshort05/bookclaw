export interface PipelineVars extends Record<string, string | number> {
  title: string; description: string;
  chapterCount: number; wordsPerChapter: number;
  setupEnd: number; incitingEnd: number; midpoint: number;
  twist75: number; climaxStart: number; climaxEnd: number;
}

/**
 * Bug #33a: compute the outline's structural beat boundaries so they are
 * monotonically increasing and gap-free for any chapterCount, with sensible
 * clamping for small books (no negative/backwards ranges, no unassigned
 * middle chapters). Two passes:
 *  1. Forward — grow each boundary at least one (or two, for midpoint/twist75,
 *     so their surrounding "-1"/"+1" ranges in the outline template can never
 *     go backward) past the previous one; climaxStart sits immediately after
 *     twist75 so no chapters are left unassigned between them.
 *  2. Backward — clamp everything down so it never exceeds chapterCount - 1
 *     (chapter `chapterCount` is always reserved for the Resolution beat),
 *     collapsing boundaries together for books too small to fit every beat
 *     distinctly rather than producing a boundary past the book's end.
 */
function computeBeats(chapterCount: number) {
  let setupEnd = Math.max(Math.round(chapterCount * 0.12), 1);
  let incitingEnd = Math.max(Math.round(chapterCount * 0.20), setupEnd + 1);
  let midpoint = Math.max(Math.round(chapterCount * 0.50), incitingEnd + 2);
  let twist75 = Math.max(Math.round(chapterCount * 0.75), midpoint + 2);
  let climaxStart = twist75 + 1;
  let climaxEnd = Math.max(climaxStart, chapterCount - 1);

  const cap = Math.max(chapterCount - 1, 1);
  climaxEnd = Math.min(climaxEnd, cap);
  climaxStart = Math.min(climaxStart, climaxEnd);
  twist75 = Math.min(twist75, climaxStart);
  midpoint = Math.min(midpoint, twist75);
  incitingEnd = Math.min(incitingEnd, midpoint);
  setupEnd = Math.min(setupEnd, incitingEnd);

  return { setupEnd, incitingEnd, midpoint, twist75, climaxStart, climaxEnd };
}

export function buildPipelineVars(ctx: Record<string, any>): PipelineVars {
  const title = String(ctx.title ?? '');
  const description = String(ctx.description ?? '');
  const chapterCount = Math.min(Math.max(Number(ctx.targetChapters) || 25, 1), 200);
  const wordsPerChapter = Math.max(Number(ctx.targetWordsPerChapter) || 3000, 100);
  const beats = computeBeats(chapterCount);
  return { ...ctx, title, description, chapterCount, wordsPerChapter, ...beats };
}
