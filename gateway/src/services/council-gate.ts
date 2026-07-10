/**
 * LLM Council pipeline gate (Romance Workflow sub-project 3, Task 3).
 *
 * A pipeline step whose skill is `council-origination` is handled by the council
 * engine, not the ordinary AI router. `maybeRunCouncilStep` is the single
 * decision point both drivers (the dashboard auto-execute loop and the
 * autonomous heartbeat/startAndRunProject loop) call at the exact site they call
 * isHumanReviewStep today — so the auto-vs-propose decision cannot diverge
 * between the two. Modelled on services/human-review.ts.
 */
export const COUNCIL_SKILL = 'council-origination';

/** A step is a council gate iff its skill is `council-origination`. */
export function isCouncilStep(step: { skill?: string } | null | undefined): boolean {
  return step?.skill === COUNCIL_SKILL;
}

interface EngineLike {
  getProject(id: string): any;
  completeStep(projectId: string, stepId: string, result: string): void;
  parkForReview(id: string): void; // reused: sets status 'paused' AND persists (projects.ts:1102) — no separate persist needed, mirroring human-review.ts's EngineLike
}
interface CouncilLike {
  originate(seeds: any): Promise<{
    candidates: Array<{ id: string; model: string; premise: string; relationshipArc: string; text: string }>;
    ranking: Array<{ id: string; rank: number; rationale: string }>;
    recommendedId: string;
    rationale: string;
  }>;
}
interface Deps { engine: EngineLike; council: CouncilLike; }

/** Minimal seed-derived base story used to degrade gracefully when the council fails. */
function seedFallbackBaseStory(seeds: Record<string, any>): string {
  const storyArc = typeof seeds?.storyArc === 'string' ? seeds.storyArc : '';
  const characters = typeof seeds?.characters === 'string' ? seeds.characters : '';
  return `PREMISE\n${storyArc}\n\nRELATIONSHIP ARC\n${characters}`;
}

/** Build CouncilSeeds from a project's context (Foundation/Premise-Intake seed fields). */
function seedsFromContext(project: any): Record<string, any> {
  const ctx = project?.context ?? {};
  return {
    storyArc: ctx.storyArc ?? '',
    characters: ctx.characters ?? '',
    setting: ctx.setting ?? '',
    blueprint: ctx.blueprint ?? '',
    heat: ctx.heat === 'spicy' ? 'spicy' : 'sweet',
    title: project?.title,
  };
}

/**
 * Called by BOTH drivers at the site they call isHumanReviewStep. Returns:
 *   { handled:false, gated:false }  — not a council step; driver proceeds normally.
 *   { handled:true, gated:false }   — auto mode (or a degraded fallback): step
 *                                      completed with the chosen/fallback base
 *                                      story; driver continues.
 *   { handled:true, gated:true }    — propose mode: project parked awaiting
 *                                      selection; driver STOPS.
 * Idempotent: if project.selection is already set (re-entry after park), returns
 * gated:true without re-running the council.
 * Fail-soft: if council.originate throws (COUNCIL_ORIGINATION_FAILED), completes
 * the step with a minimal seed-derived base story and returns gated:false
 * (degrade to today's straight-through behavior); logs ⚠.
 */
export async function maybeRunCouncilStep(deps: Deps, project: any, step: any): Promise<{ handled: boolean; gated: boolean }> {
  if (!isCouncilStep(step)) return { handled: false, gated: false };

  if (project.selection) {
    deps.engine.parkForReview(project.id);
    return { handled: true, gated: true };
  }

  const seeds = seedsFromContext(project);

  let council;
  try {
    council = await deps.council.originate(seeds);
  } catch (err) {
    console.log(`  ⚠ Council origination failed for project ${project?.id}, degrading to a seed-derived base story: ${(err as Error)?.message || err}`);
    deps.engine.completeStep(project.id, step.id, seedFallbackBaseStory(seeds));
    return { handled: true, gated: false };
  }

  const mode = project.context?.councilSelection === 'propose' ? 'propose' : 'auto';

  if (mode === 'auto') {
    const pick = council.candidates.find(c => c.id === council.recommendedId) ?? council.candidates[0];
    deps.engine.completeStep(project.id, step.id, pick.text);
    return { handled: true, gated: false };
  }

  project.selection = {
    stepId: step.id,
    candidates: council.candidates,
    ranking: council.ranking,
    recommendedId: council.recommendedId,
    rationale: council.rationale,
    createdAt: new Date().toISOString(),
  };
  deps.engine.parkForReview(project.id);
  return { handled: true, gated: true };
}
