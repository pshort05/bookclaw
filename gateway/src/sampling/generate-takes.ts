import { runVerbalizedSampling, type VsComplete, type VsRouting } from './verbalized-sampling.js';
import { resolveVsConfig } from './vs-roles.js';

/**
 * Build the `generateTakes` function the Takes gate injects. It resolves the
 * step's production routing, assembles the SAME per-step context the normal
 * executor would (system = buildProjectContext, user = buildStepUserMessage) so
 * candidates are canon-aware, runs Verbalized Sampling, and returns the candidate
 * takes + the resolved config + the routing (for the preference log). The VS
 * module fails open internally, so this never throws for a routing/parse problem.
 */
export function makeGenerateTakes(deps: {
  complete: VsComplete;
  resolveRouting: (project: any, step: any) => VsRouting;
  buildContext?: (project: any, step: any) => Promise<{ system: string; user: string }>;
}) {
  return async (project: any, step: any) => {
    const config = resolveVsConfig(step);
    const routing = deps.resolveRouting(project, step);
    const ctx = deps.buildContext ? await deps.buildContext(project, step) : { system: '', user: step.prompt ?? '' };
    const r = await runVerbalizedSampling({
      basePrompt: ctx.user, systemPrompt: ctx.system,
      routing, config, complete: deps.complete,
    });
    return {
      candidates: r.candidates, degraded: r.degraded,
      config: { k: config.k, variant: config.variant, threshold: config.probabilityThreshold },
      provider: routing.provider, model: routing.model ?? '',
    };
  };
}
