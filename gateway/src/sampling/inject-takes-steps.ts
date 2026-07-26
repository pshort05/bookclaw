import type { ResolvedStepInput } from '../services/pipeline-expand.js';

export interface AlternateTakesFlags { sceneTakes?: boolean; draftOpening?: boolean }

/**
 * Per-book Alternate Takes injection (pure). Given the already-expanded pipeline
 * steps and a book's opt-in flags, insert a short vs-enabled decision step before
 * each target:
 *   - sceneTakes  → a `approach` "Scene Takes" step before each `scene_brief`
 *   - draftOpening → a short `draft` "Draft Opening" step before each `draft`
 * The chosen take feeds the following step via the normal step-result chaining.
 * Returns the input array unchanged when both flags are falsy. Pipelines on disk
 * are never modified — this is a per-book runtime overlay.
 */
export function injectTakesSteps(steps: ResolvedStepInput[], flags: AlternateTakesFlags): ResolvedStepInput[] {
  if (!flags?.sceneTakes && !flags?.draftOpening) return steps;
  const out: ResolvedStepInput[] = [];
  for (const step of steps) {
    if (flags.sceneTakes && step.role === 'scene_brief') {
      out.push(sceneTakesStep(step));
    } else if (flags.draftOpening && step.role === 'draft') {
      out.push(draftOpeningStep(step));
    }
    out.push(step);
  }
  return out;
}

function chapterSuffix(step: ResolvedStepInput): string {
  return typeof step.chapterNumber === 'number' ? ` — Chapter ${step.chapterNumber}` : '';
}

function sceneTakesStep(next: ResolvedStepInput): ResolvedStepInput {
  return {
    label: `Scene Takes${chapterSuffix(next)}`,
    taskType: 'outline',
    role: 'approach',
    prompt: `Propose distinct directions for how this scene could go — what actually HAPPENS in it. Each candidate is a different narrative choice (a different beat, turn, or emotional move), stated in two or three sentences. Use the story canon and prior chapters in your context; stay consistent with them. Do not write prose — these are approaches to choose from.`,
    ...(next.chapterNumber !== undefined ? { chapterNumber: next.chapterNumber } : {}),
    ...(next.phase ? { phase: next.phase } : {}),
    vs: { enabled: true },
  } as ResolvedStepInput;
}

function draftOpeningStep(next: ResolvedStepInput): ResolvedStepInput {
  return {
    label: `Draft Opening${chapterSuffix(next)}`,
    taskType: 'creative_writing',
    role: 'draft',
    prompt: `Write distinct OPENINGS (about 150 words each) for this chapter, based on the scene brief in your context. Each opening should start the chapter a genuinely different way — a different image, line, or point of entry. Prose, first ~150 words only; the full chapter is written afterward from the chosen opening.`,
    wordCountTarget: 150,
    ...(next.chapterNumber !== undefined ? { chapterNumber: next.chapterNumber } : {}),
    ...(next.phase ? { phase: next.phase } : {}),
    vs: { enabled: true },
  } as ResolvedStepInput;
}
