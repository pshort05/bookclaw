/**
 * Resolve the ContextEngine summary target for a completed step.
 *
 * Two call sites (the studio auto-execute hook in projects.routes.ts and the
 * bridge hook in index.ts) summarize canonical chapter prose. Both must:
 *   - label the summary by the step's OWN chapterNumber (write/polish steps
 *     carry it), NOT a running count of completed steps — the count numbered
 *     "Polish Chapter 1" as chapter 2, "Write Chapter 2" as chapter 3, etc.
 *   - key a canonical chapter's summary on the CHAPTER, so the polish pass
 *     replaces the write pass's summary instead of appending a duplicate
 *     (write/polish have distinct step ids; the summary upserts on chapterId).
 *
 * Shared here so the two sites can't drift (bug-review finding #17).
 */
export interface SummaryStep {
  id: string;
  chapterNumber?: number;
}

export interface SummaryProject {
  id: string;
  steps: Array<{ status: string; id: string }>;
}

export function chapterSummaryTarget(
  project: SummaryProject,
  step: SummaryStep,
  isCanonicalChapter: boolean,
): { chapterNum: number; summaryId: string } {
  const stepChapterNum = step.chapterNumber;
  const chapterNum = stepChapterNum ?? (
    project.steps.filter(s => s.status === 'completed' && s.id !== step.id).length + 1
  );
  const summaryId = (isCanonicalChapter && stepChapterNum != null)
    ? `${project.id}-chapter-${stepChapterNum}`
    : step.id;
  return { chapterNum, summaryId };
}
