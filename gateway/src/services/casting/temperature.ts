import type { StepRole } from './roles.js';

export type TempBucket = 'creative' | 'surgical';

const CREATIVE_ROLES = new Set<StepRole>(['scene_brief', 'draft', 'intimacy', 'approach', 'improve', 'rewrite', 'outline', 'bible', 'marketing']);
const SURGICAL_ROLES = new Set<StepRole>(['humanize', 'editorial', 'analysis', 'continuity', 'format', 'research', 'plan']);
const CREATIVE_TASKS = new Set<string>(['creative_writing', 'outline', 'book_bible', 'marketing', 'style_analysis']);
const SURGICAL_TASKS = new Set<string>(['consistency', 'revision', 'final_edit', 'research']);

/** Classify a step creative vs surgical: role decides when present, taskType is the
 *  fallback for untagged steps. Unknown → creative (a neutral step reads conversational). */
export function temperatureBucket(role: StepRole | undefined, taskType: string | undefined): TempBucket {
  if (role && SURGICAL_ROLES.has(role)) return 'surgical';
  if (role && CREATIVE_ROLES.has(role)) return 'creative';
  if (taskType && SURGICAL_TASKS.has(taskType)) return 'surgical';
  if (taskType && CREATIVE_TASKS.has(taskType)) return 'creative';
  return 'creative';
}

/** The book's temperature for this step's bucket, or undefined when unset. */
export function resolveBucketTemperature(
  temps: { creative?: number; surgical?: number } | undefined,
  role: StepRole | undefined,
  taskType: string | undefined,
): number | undefined {
  if (!temps) return undefined;
  const v = temperatureBucket(role, taskType) === 'creative' ? temps.creative : temps.surgical;
  return typeof v === 'number' ? v : undefined;
}
