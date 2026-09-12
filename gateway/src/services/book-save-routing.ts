/**
 * Save routing for the View Book editor (design §5).
 *
 * A chapter paused at a human-review gate holds its pending text on
 * `project.review.pendingResult`, which is never persisted — the state file
 * keeps only a truncated stub and full text rehydrates from the step's `.md`.
 * So a plain file write on a gated chapter is silently overwritten when the
 * pipeline resumes; that edit has to go through the review action instead.
 * This pure function owns that decision so it can be tested without HTTP.
 */

export type SaveMode =
  | { mode: 'file' }
  | { mode: 'gate-edit' }
  | { mode: 'refuse'; reason: string };

export interface SaveContext {
  versionIsLatest: boolean;
  itemReady: boolean;
  itemIsDerived: boolean;
  gateStepId?: string;
  itemLatestStepId?: string;
  projectIsDriving: boolean;
}

export function decideSave(ctx: SaveContext): SaveMode {
  if (!ctx.versionIsLatest) {
    return { mode: 'refuse', reason: 'Earlier versions are read-only. Switch to the latest version to edit.' };
  }

  if (!ctx.itemReady) {
    return { mode: 'refuse', reason: 'Nothing to edit yet — this has not been written. Run the step that writes it first.' };
  }

  if (ctx.itemIsDerived) {
    return { mode: 'refuse', reason: 'Compiled output is assembled from the chapters. Edit the chapter you want to change, then compile again.' };
  }

  if (ctx.gateStepId && ctx.itemLatestStepId && ctx.gateStepId === ctx.itemLatestStepId) {
    return { mode: 'gate-edit' };
  }

  if (ctx.projectIsDriving) {
    return { mode: 'refuse', reason: 'The pipeline is writing this chapter right now. Wait for the step to finish, then edit.' };
  }

  return { mode: 'file' };
}
