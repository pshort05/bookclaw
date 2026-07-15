/**
 * Union per-window de-AI edit lists into one, keeping the FIRST occurrence per
 * exact `find` (drops duplicates a seam surfaced twice). The merged list feeds a
 * single applyDeAiEdits call per pass.
 */

import type { DeAiEdit } from '../deterministic-apply.js';

export function mergeWindowEdits(lists: DeAiEdit[][]): DeAiEdit[] {
  const seen = new Set<string>();
  const out: DeAiEdit[] = [];
  for (const list of lists) {
    for (const e of list) {
      if (!e?.find || seen.has(e.find)) continue;
      seen.add(e.find);
      out.push(e);
    }
  }
  return out;
}
