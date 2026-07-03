/**
 * Human-Gate Cadence (Flagship Plan 5, Task 1).
 *
 * Pure, no-I/O helpers for deciding WHEN the autonomous pipeline must pause
 * for a human-review gate. `resolveCadence` implements the book > author >
 * genre > default precedence; `shouldGate` maps a cadence + boundary to a
 * yes/no. Both are consumed by the execution-loop wiring (Task 4), which
 * reuses the existing ConfirmationGateService + Human-Review pause/resume
 * machinery (services/human-review.ts) to actually open the gate — this file
 * has no side effects and knows nothing about projects, steps, or I/O.
 *
 * `isActBoundary` / `computeBoundaries` are an ADAPTATION beyond the plan's
 * literal Task 1 interface: the codebase has no "act" concept anywhere (no
 * act field on a step, no act metadata in library pipelines) — only
 * `ProjectStep.phase` ('premise'|'bible'|'outline'|'writing'|'revision'|
 * 'revision_apply'|'assembly'), `role`/`skill`, and `chapterNumber`. Rather
 * than invent new manifest/step fields for acts (out of scope — "no new gate
 * machinery"), an act boundary is derived deterministically from chapter
 * position: the end of each third of a project's chapters (a plain
 * three-act stand-in).
 *
 * `computeBoundaries` keys off `role`/`skill`/`chapterNumber` — NOT the
 * literal `phase` strings the code-generated `createNovelPipeline` /
 * book-production.json happen to use. The shipped multi-stage library
 * pipelines (romance-spicy.json, romantasy-production.json) emit ~6
 * role-tagged steps per chapter (brief/draft/improve/rewrite/humanize/
 * intimacy) sharing one `chapterNumber`, never a `phase` of 'writing'; and
 * book-planning.json's outline step has no `phase` at all, only
 * `role`/`skill: 'outline'`. Keying on `phase` alone left the gate inert for
 * those pipelines — see tests/unit/gate-cadence-real-pipelines.test.ts.
 */

export type Cadence = 'per_act' | 'per_chapter' | 'outline_only' | 'autonomous';
export type Boundary = 'outline_approved' | 'chapter' | 'act' | 'pre_export';

/** Book > author > genre > 'per_act' (today's assumed behavior, unchanged). */
export function resolveCadence(
  book?: { review?: { cadence?: Cadence } } | null,
  authorDefault?: Cadence,
  genreDefault?: Cadence,
): Cadence {
  return book?.review?.cadence ?? authorDefault ?? genreDefault ?? 'per_act';
}

/**
 * outline_approved and pre_export are always-on gates (every cadence except
 * nothing skips them); chapter/act boundaries only gate under their matching
 * cadence.
 */
export function shouldGate(cadence: Cadence, boundary: Boundary): boolean {
  if (boundary === 'outline_approved' || boundary === 'pre_export') return true;
  if (boundary === 'chapter') return cadence === 'per_chapter';
  if (boundary === 'act') return cadence === 'per_act';
  return false;
}

/** The end of each third of the chapters (a plain three-act stand-in — see file header). */
export function isActBoundary(chapterNumber: number, totalChapters: number): boolean {
  if (!Number.isFinite(chapterNumber) || !Number.isFinite(totalChapters)) return false;
  if (chapterNumber <= 0 || totalChapters <= 0) return false;
  return chapterNumber === Math.ceil(totalChapters / 3)
    || chapterNumber === Math.ceil((totalChapters * 2) / 3)
    || chapterNumber === totalChapters;
}

/** Minimal step shape computeBoundaries needs — matches ProjectStep's relevant fields. */
export interface BoundaryStep {
  phase?: string;
  chapterNumber?: number;
  role?: string;
  skill?: string;
  label?: string;
}

const isOutlineStep = (s: BoundaryStep): boolean => s.role === 'outline' || s.skill === 'outline';

/** The assembly/compile step: role or skill 'format'/'assembly', phase 'assembly'
 *  (createNovelPipeline / book-production.json), or a label like "Compile
 *  manuscript" / "Assemble manuscript & report". */
const isAssemblyStep = (s: BoundaryStep): boolean =>
  s.phase === 'assembly' ||
  s.role === 'format' || s.role === 'assembly' ||
  s.skill === 'format' || s.skill === 'assembly' ||
  (typeof s.label === 'string' && /compile|assemble/i.test(s.label));

/**
 * Derive the boundary label(s) the step at `stepIndex` corresponds to, given
 * its position among `allSteps`. A step can satisfy more than one boundary
 * (e.g. the last chapter of an act is both 'chapter' and 'act' — a
 * per_chapter cadence must still gate on it even though it's also an act
 * end). Returns [] when the step isn't a gate-relevant boundary.
 *
 * Keys off `role`/`skill`/`chapterNumber`, not `phase` — see file header.
 */
export function computeBoundaries(stepIndex: number, allSteps: BoundaryStep[]): Boundary[] {
  const step = allSteps[stepIndex];
  if (!step) return [];
  const out: Boundary[] = [];

  // OUTLINE: the last step tagged role/skill 'outline' (book-planning.json
  // tags both its outline and synopsis steps this way — only the final one gates).
  if (isOutlineStep(step) && !allSteps.some((s, i) => i > stepIndex && isOutlineStep(s))) {
    out.push('outline_approved');
  }

  // CHAPTER / ACT: the LAST step bearing this chapterNumber (a multi-stage
  // pipeline emits several role-tagged steps per chapter sharing one number).
  if (typeof step.chapterNumber === 'number') {
    const isLastOfChapter = !allSteps.some((s, i) => i > stepIndex && s.chapterNumber === step.chapterNumber);
    if (isLastOfChapter) {
      const totalChapters = new Set(
        allSteps.filter((s) => typeof s.chapterNumber === 'number').map((s) => s.chapterNumber),
      ).size;
      out.push('chapter');
      if (isActBoundary(step.chapterNumber, totalChapters)) out.push('act');
    }
  }

  // PRE_EXPORT: the step immediately before the assembly/compile step.
  const assemblyIndex = allSteps.findIndex(isAssemblyStep);
  if (assemblyIndex > 0 && stepIndex === assemblyIndex - 1) out.push('pre_export');

  return out;
}
