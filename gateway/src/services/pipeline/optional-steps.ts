/**
 * Optional pipeline steps — work a pipeline declares is already covered by its
 * own writing directions.
 *
 * Today the only one is the de-AI sweep. Measured on Firefly Pond (2026-09-15),
 * chapters 1-12: the sweep matched ZERO entries from its AI-tell list, because
 * romance-*-first-draft/SKILL.md already carries "Avoid these AI tells (write
 * around them from the first draft)" and bans adverbs, clichés, em-dashes and
 * filter language. Having nothing on-task to do, the pass line-edited instead —
 * injecting 4 passages of >=4 words and making 8 pronoun swaps, against its own
 * non-additive contract. A pipeline whose draft skill does NOT carry the
 * directions (romantasy-production, technothriller-production) keeps it.
 *
 * Steps are marked skipped EAGERLY rather than at execution time. That is the
 * load-bearing choice: `computeBoundaries` fires the chapter/act gate on the
 * last step of a chapter, so the skip must be visible before the preceding step
 * completes — otherwise Consistency Apply finishes while the sweep is still
 * 'pending', never registers as last, and the gate is silently lost.
 */

/** Book manifest setting. Absent = follow the pipeline's declaration. */
export type DeaiSweepSetting = 'skip' | 'run';

/** Stamped on steps skipped by this rule, so a hand-skipped step is never revived. */
export const OPTIONAL_SKIP_REASON = 'covered by the writing directions (de-AI is in the draft skill)';

interface StepLike {
  optional?: boolean;
  status?: string;
  skipReason?: string;
}

/**
 * Reconcile a project's optional steps with the book's setting.
 * Returns how many steps changed. Safe to call on every drive: idempotent, and
 * it never touches a step that has run, is running, or failed.
 */
export function applyOptionalSteps(
  project: { steps?: StepLike[] } | null | undefined,
  manifest: { deaiSweep?: DeaiSweepSetting } | null | undefined,
): number {
  const forceRun = manifest?.deaiSweep === 'run';
  let changed = 0;

  for (const step of project?.steps ?? []) {
    if (step?.optional !== true) continue;

    if (forceRun) {
      // Only revive what THIS rule skipped — a step the author skipped by hand
      // stays skipped.
      if (step.status === 'skipped' && step.skipReason === OPTIONAL_SKIP_REASON) {
        step.status = 'pending';
        delete step.skipReason;
        changed++;
      }
      continue;
    }

    if (step.status === 'pending') {
      step.status = 'skipped';
      step.skipReason = OPTIONAL_SKIP_REASON;
      changed++;
    }
  }
  return changed;
}
