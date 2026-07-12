/**
 * Conductor scheduling core (Tier 2/3 feature #6) — the pure, engine-agnostic
 * bounded DAG supervisor. Extracted here (rather than living as a private method
 * on the gateway class) so it can be unit-tested with a fake engine and no real
 * AI: `index.ts:conductorDrive` and `tests/unit/conductor-drive.test.ts` both
 * drive this same loop.
 *
 * Ported from the fork's `conductorLoop` (`authoragent/main:gateway/src/services/
 * step-executor.ts`), adapted to our seams: the caller supplies a `runStep`
 * closure that activates + runs + completes ONE step (via
 * `startAndRunProject(..., {advance:false})`), and a `getProject` poll that
 * returns the live project each tick.
 */

/** The minimal step/project shape the scheduler reads (structural, not the full ProjectStep). */
export interface ConductorStep {
  id: string;
  status: string;
  dependsOn?: string[];
}
export interface ConductorProject {
  status: string;
  steps: ConductorStep[];
}

export interface ConductorDeps {
  /** Poll the live project each tick (must reflect the latest step statuses). */
  getProject: () => ConductorProject | undefined;
  /** True when dispatch must stop (paused / completed / budget pause). In-flight steps still drain. */
  isPaused: (project: ConductorProject) => boolean;
  /** Activate + run + complete a single step; MUST resolve (never reject) when the step settles. */
  runStep: (stepId: string) => Promise<void>;
  /** Concurrent step cap (already clamped). */
  concurrency: number;
}

/**
 * Resolve + clamp the conductor concurrency from a raw value (env string or
 * number). Default 2, clamped to [1, 3] so a stray config can never spawn a
 * retry storm of concurrent AI calls.
 */
export function clampConcurrency(raw: unknown): number {
  const n = Number(raw);
  const base = Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
  return Math.max(1, Math.min(3, base));
}

/** A step is runnable when every id in its `dependsOn` is completed or skipped. */
function depsSatisfied(project: ConductorProject, step: ConductorStep): boolean {
  const deps = step.dependsOn;
  if (!Array.isArray(deps) || deps.length === 0) return true;
  return deps.every(id => {
    const d = project.steps.find(s => s.id === id);
    return !!d && (d.status === 'completed' || d.status === 'skipped');
  });
}

/**
 * Bounded race-supervisor. Ready set = pending steps whose `dependsOn` are all
 * satisfied. Dispatches up to `concurrency` steps at once, refilling free slots
 * as each settles (`Promise.race`, not `Promise.all`). FIFO: the ready scan is
 * document-order (`steps.find`), so the earliest-declared runnable step goes
 * first. Semantics:
 *   - Pause/stop: stop dispatching new steps the moment `isPaused` is true;
 *     in-flight steps drain, then the loop ends.
 *   - Failure isolates: `runStep` never rejects (the engine fails the step);
 *     a failed/blocked step is simply not 'completed', so its dependents' deps
 *     never satisfy → only that branch stalls. Independent branches keep going.
 *   - Termination: the loop ends when nothing is ready AND nothing is in flight.
 * Total concurrent AI calls are bounded by `concurrency` (each runStep issues
 * its calls sequentially).
 */
export async function runConductor(deps: ConductorDeps): Promise<void> {
  const { getProject, isPaused, runStep, concurrency } = deps;
  const inFlight = new Map<string, Promise<void>>();

  while (true) {
    const project = getProject();
    if (!project) break;

    if (!isPaused(project)) {
      while (inFlight.size < concurrency) {
        const next = project.steps.find(s =>
          s.status === 'pending' && !inFlight.has(s.id) && depsSatisfied(project, s));
        if (!next) break;
        const stepId = next.id;
        // runStep's synchronous prologue (activateStep) flips the step to
        // 'active' before it awaits, so the next scan in this same burst won't
        // re-pick it; the inFlight guard covers the window until then.
        const p = runStep(stepId)
          .catch(() => { /* the engine already failed the step; never abort siblings */ })
          .finally(() => { inFlight.delete(stepId); });
        inFlight.set(stepId, p);
      }
    }

    if (inFlight.size === 0) break;
    await Promise.race(inFlight.values());
  }

  // Drain any stragglers dispatched right before a pause was observed.
  if (inFlight.size > 0) await Promise.all(inFlight.values());
}
