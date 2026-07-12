/**
 * Conductor engine (Tier 2/3 feature #6) — pure dependency derivation.
 *
 * Ported from the fork (`authoragent/main:gateway/src/services/
 * project-templates.ts`, `deriveDependencies`). This file owns ONLY the pure
 * rules; the engine/scheduler wiring that reads `dependsOn` to drive
 * bounded-concurrency execution lives in the conductor drive (see the design
 * spec, "#6 Conductor", `conductor.ts` + `index.ts:conductorDrive`).
 *
 * `dependsOn` is now a real additive field on `ProjectStep`, so we operate on
 * `ProjectStep` directly (the earlier `StepWithDeps` alias is gone).
 */
import type { ProjectStep } from '../projects.js';

/**
 * Assign each step a conservative `dependsOn` set (step ids) so the conductor
 * loop can run independent steps concurrently while preserving narrative
 * correctness. Mutates the steps in place.
 *
 * Step-kind detection heuristic (keyed off the fields our real pipeline
 * templates actually set — see `createBookProduction` / `buildNovelPipelineSteps`
 * in `gateway/src/services/projects.ts`):
 *   - Chapter WRITE step: `skill === 'write'` or `phase === 'writing'`, plus a
 *     numeric `chapterNumber`.
 *   - Chapter REVIEW/POLISH step: has a numeric `chapterNumber`, is NOT a
 *     write step, and either `phase` is `'polish'`/`'revision'`, `skill` is
 *     `'revise'`, or the label contains "review"/"polish".
 *   - Terminal/compile step: `phase` is `'assembly'`/`'format'`/`'launch'`, or
 *     the label starts with "compile"/"assemble" (matches our "Compile
 *     manuscript" / "Assemble manuscript & report" steps).
 *
 * Rules (correctness first — "when in doubt, depend on the previous step"):
 *   (a) Chapter WRITING steps are strictly sequential: Write ch N depends on
 *       Write ch N-1 (narrative continuity is sacred). The first chapter keeps
 *       the sequential fallback (its immediately-preceding setup/outline step).
 *   (b) A chapter's SELF-REVIEW / POLISH depends ONLY on its own chapter's
 *       write step — so review of ch3 can run while ch4 drafts.
 *   (c) Every other step falls back to depending on the immediately-preceding
 *       step (sequential = exact prior behavior). This keeps planning/bible/
 *       outline/analysis steps sequential because those consume prior outputs.
 *   (d) Terminal phases (assembly / format / launch) depend on ALL prior
 *       writing + review/revision steps, so they only run once the manuscript
 *       is fully drafted and revised.
 *
 * `revision_apply` steps are treated as sequential (rule c) because each pass
 * rewrites the previous pass's output — they must never parallelize.
 */
export function deriveDependencies(steps: ProjectStep[]): void {
  if (!Array.isArray(steps) || steps.length === 0) return;

  const isChapterWrite = (s: ProjectStep): boolean =>
    (s.skill === 'write' || s.phase === 'writing') && typeof s.chapterNumber === 'number';

  const isChapterReview = (s: ProjectStep): boolean => {
    if (typeof s.chapterNumber !== 'number' || isChapterWrite(s)) return false;
    const phase = String(s.phase || '').toLowerCase();
    const skill = String(s.skill || '').toLowerCase();
    const label = String(s.label || '').toLowerCase();
    return phase === 'polish' || phase === 'revision' || skill === 'revise' ||
      label.includes('review') || label.includes('polish');
  };

  const isTerminalPhase = (s: ProjectStep): boolean => {
    const phase = String(s.phase || '').toLowerCase();
    const label = String(s.label || '').toLowerCase();
    return phase === 'assembly' || phase === 'format' || phase === 'launch' ||
      label.startsWith('compile') || label.startsWith('assemble');
  };

  const isUpstreamOfTerminal = (s: ProjectStep): boolean => {
    if (isChapterWrite(s) || isChapterReview(s)) return true;
    const phase = String(s.phase || '').toLowerCase();
    return phase === 'writing' || phase === 'polish' || phase === 'revision';
  };

  // Index write steps by chapter number for the sequential-chain lookup.
  const writeByChapter = new Map<number, ProjectStep>();
  for (const s of steps) {
    if (isChapterWrite(s) && typeof s.chapterNumber === 'number') {
      writeByChapter.set(s.chapterNumber, s);
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const prev = i > 0 ? steps[i - 1] : undefined;
    let deps: string[] = prev ? [prev.id] : [];

    if (isChapterWrite(s)) {
      const prevWrite = writeByChapter.get((s.chapterNumber as number) - 1);
      if (prevWrite) deps = [prevWrite.id];
      // First chapter (no prior write): keep the sequential fallback so it
      // waits for the outline/setup step that immediately precedes it.
    } else if (isChapterReview(s)) {
      const own = writeByChapter.get(s.chapterNumber as number);
      if (own) deps = [own.id];
    } else if (isTerminalPhase(s)) {
      const upstream = steps.slice(0, i).filter(isUpstreamOfTerminal);
      if (upstream.length > 0) {
        deps = Array.from(new Set(upstream.map(x => x.id)));
      }
    }

    s.dependsOn = deps;
  }
}
