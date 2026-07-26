/**
 * Alternate Takes (Verbalized Sampling) pipeline gate. A vs-enabled decision step
 * is handled here instead of the ordinary single-completion executor:
 * `maybeRunTakesStep` generates k candidate takes, stores them on the
 * `project.takes` marker, and parks for a human pick. Modelled exactly on
 * services/council-gate.ts (`maybeRunCouncilStep`) and called by BOTH drivers at
 * the same site they call the council check. See
 * docs/superpowers/specs/2026-07-26-verbalized-sampling-design.md.
 */
import { isVsEnabled } from '../sampling/vs-roles.js';

/** A step is a Takes gate iff VS is enabled AND its role is allowlisted. */
export function isTakesStep(step: { role?: any; vs?: any } | null | undefined): boolean {
  return isVsEnabled(step as any);
}

interface EngineLike {
  getProject(id: string): any;
  completeStep(projectId: string, stepId: string, result: string): void;
  parkForReview(id: string): void;
  persistStepResultFile?(projectId: string, stepId: string, result: string): Promise<void>;
}
interface Deps {
  engine: EngineLike;
  generateTakes: (project: any, step: any) => Promise<{ candidates: Array<{ index: number; text: string }>; degraded: boolean; config: { k: number; variant: string; threshold: number }; provider?: string; model?: string }>;
}

/**
 * Returns:
 *   { handled:false, gated:false } — not a VS step (or generation threw); run the step normally.
 *   { handled:true,  gated:false } — degraded: step completed directly with the single fallback.
 *   { handled:true,  gated:true  } — takes generated (or re-entry): project parked awaiting a pick.
 * Idempotent: if project.takes is already set (re-entry after park), re-parks without regenerating.
 */
export async function maybeRunTakesStep(deps: Deps, project: any, step: any): Promise<{ handled: boolean; gated: boolean }> {
  if (!isTakesStep(step)) return { handled: false, gated: false };
  if (project.takes) { deps.engine.parkForReview(project.id); return { handled: true, gated: true }; }

  let result;
  try {
    result = await deps.generateTakes(project, step);
  } catch (err) {
    console.log(`  ⚠ Alternate Takes: generateTakes threw for project ${project?.id} — running the step directly: ${(err as Error)?.message || err}`);
    return { handled: false, gated: false }; // let the normal executor run the step
  }

  if (result.degraded) {
    const text = result.candidates[0]?.text ?? '';
    deps.engine.completeStep(project.id, step.id, text);
    await deps.engine.persistStepResultFile?.(project.id, step.id, text);
    return { handled: true, gated: false };
  }

  project.takes = {
    stepId: step.id, role: step.role,
    candidates: result.candidates,
    config: result.config,
    provider: result.provider, model: result.model,
    createdAt: new Date().toISOString(),
  };
  deps.engine.parkForReview(project.id);
  return { handled: true, gated: true };
}
