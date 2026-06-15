export interface PipelineVars extends Record<string, string | number> {
  title: string; description: string;
  chapterCount: number; wordsPerChapter: number;
  setupEnd: number; incitingEnd: number; midpoint: number;
  twist75: number; climaxStart: number; climaxEnd: number;
}

export function buildPipelineVars(ctx: Record<string, any>): PipelineVars {
  const title = String(ctx.title ?? '');
  const description = String(ctx.description ?? '');
  const chapterCount = Math.min(Math.max(Number(ctx.targetChapters) || 25, 1), 200);
  const wordsPerChapter = Math.max(Number(ctx.targetWordsPerChapter) || 3000, 100);
  const setupEnd = Math.max(Math.round(chapterCount * 0.12), 1);
  const incitingEnd = Math.max(Math.round(chapterCount * 0.20), setupEnd + 1);
  const midpoint = Math.round(chapterCount * 0.50);
  const twist75 = Math.round(chapterCount * 0.75);
  const climaxStart = chapterCount - 2;
  const climaxEnd = chapterCount - 1;
  return { ...ctx, title, description, chapterCount, wordsPerChapter, setupEnd, incitingEnd, midpoint, twist75, climaxStart, climaxEnd };
}
