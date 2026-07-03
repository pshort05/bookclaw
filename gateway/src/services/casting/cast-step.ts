import { PROSE_ROLES, type StepRole } from './roles.js';
import type { CastingSheet } from './casting-sheet.js';
import { isValidModelId } from '../../ai/model-id.js';

export interface CastInputs {
  step: { role?: StepRole; modelOverride?: { provider?: string; model?: string; temperature?: number } };
  sheet: CastingSheet | null;
  proseModel?: { provider: string; model?: string };
  spiceRoute?: { provider: string; model?: string } | null;
}
export interface CastResult {
  provider?: string;
  model?: string;
  temperature?: number;
  source: 'spice' | 'manual' | 'prose-pick' | 'sheet' | 'tier-fallback';
}

/** Drop a model id that would be unsafe to send to a provider API; keep the provider. */
function clean(provider: string | undefined, model: string | undefined, temperature: number | undefined, source: CastResult['source']): CastResult {
  if (model && !isValidModelId(model)) {
    console.warn(`  ⚠ casting: dropping invalid model id "${model}" (role fell back to provider default)`);
  }
  const safeModel = model && isValidModelId(model) ? model : undefined;
  return { provider, model: safeModel, temperature, source };
}

export function castStep(inputs: CastInputs): CastResult {
  const { step, sheet, proseModel, spiceRoute } = inputs;
  const role = step.role;
  const mo = step.modelOverride;

  const result = ((): CastResult => {
    // 1. Spice re-route (a scene flagged over the ceiling) wins over everything,
    //    so a flagged explicit scene never lands on a refusing/ban-risk model.
    if (spiceRoute) return clean(spiceRoute.provider, spiceRoute.model, undefined, 'spice');

    // 2. Manual per-step pin (the existing escape hatch).
    if (mo && (mo.provider || mo.model)) return clean(mo.provider, mo.model, mo.temperature, 'manual');

    // 3. The author's prose-model pick, applied to prose roles only.
    const proseRoles = sheet?.proseRoles?.length ? new Set(sheet.proseRoles) : PROSE_ROLES;
    if (proseModel && role && proseRoles.has(role)) {
      return clean(proseModel.provider, proseModel.model, undefined, 'prose-pick');
    }

    // 4. Genre casting-sheet default for the role.
    const rm = role && sheet?.roleModels?.[role];
    if (rm) return clean(rm.provider, rm.model, rm.temperature, 'sheet');

    // 5. Nothing pinned → tier routing decides downstream.
    return { provider: undefined, model: undefined, temperature: undefined, source: 'tier-fallback' };
  })();

  // A manual temperature ALWAYS applies on top of whichever model source won —
  // a temperature-only override must not be dropped just because it has no
  // provider/model to pin (branch 2's guard above only fires on provider/model).
  if (typeof mo?.temperature === 'number') result.temperature = mo.temperature;

  return result;
}
