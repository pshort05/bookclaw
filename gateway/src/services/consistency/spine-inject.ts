/**
 * Flagship Plan 3 consistency spine, factored out for reuse (H2 fix).
 *
 * The studio `/auto-execute` route (projects.routes.ts) has an inline guarded
 * pre-draft/post-draft continuity block. The headless/autonomous step-driver
 * (`startAndRunProject` in index.ts) needs the identical guarded, fail-soft
 * behavior so a headless novel run also gets the continuity ledger injected
 * and persists chapter facts during drafting. These two helpers encapsulate
 * that logic so it's unit-testable and shared rather than duplicated ad-hoc.
 *
 * projects.routes.ts still has its own inline equivalent — it should later
 * converge on these helpers, but that file is out of scope for this change.
 */
import { isStepRole } from '../casting/roles.js';
import { buildCanonBlock } from './canon-inject.js';
import { checkChapter, type ContinuityFlag } from './continuity-check.js';
import type { ConsistencyStore } from './fact-store.js';

/** Pre-draft: the ledger block to append to a draft step's prompt context, or
 *  '' when the step isn't a draft step, the store is absent/unavailable, or
 *  buildCanonBlock throws (fail-soft — must never block drafting). */
export function buildContinuityInjection(args: {
  slug: string;
  role: unknown;
  chapterNumber: number;
  store: ConsistencyStore | undefined;
  world: string | null;
}): string {
  const { slug, role, chapterNumber, store, world } = args;
  if (!isStepRole(role) || role !== 'draft') return '';
  if (!store?.isAvailable?.()) return '';
  try {
    return buildCanonBlock({ slug, chapterNumber, store, world });
  } catch {
    return '';
  }
}

/** Post-draft: run continuity detection (and, unless skipPersist, persist the
 *  chapter's facts) against the just-drafted text, or `{flags:[]}` when the
 *  step isn't a draft step, the store is absent/unavailable, or checkChapter
 *  throws (fail-soft — must never block step completion). */
export async function detectPostDraftContinuity(args: {
  slug: string;
  role: unknown;
  chapterNumber: number;
  text: string;
  store: ConsistencyStore | undefined;
  aiComplete: (r: any) => Promise<any>;
  aiSelect: (taskType: string, preferredId?: string) => any;
  world: string | null;
  skipPersist: boolean;
}): Promise<{ flags: ContinuityFlag[] }> {
  const { slug, role, chapterNumber, text, store, aiComplete, aiSelect, world, skipPersist } = args;
  if (!isStepRole(role) || role !== 'draft') return { flags: [] };
  if (!store?.isAvailable?.()) return { flags: [] };
  try {
    return await checkChapter({ slug, chapterNumber, text, store, aiComplete, aiSelect, world, skipPersist });
  } catch {
    return { flags: [] };
  }
}
