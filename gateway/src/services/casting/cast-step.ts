import { PROSE_ROLES, type StepRole } from './roles.js';
import type { CastingSheet, RoleModel } from './casting-sheet.js';
import { isValidModelId } from '../../ai/model-id.js';

export interface CastInputs {
  step: { role?: StepRole; modelOverride?: { provider?: string; model?: string; temperature?: number } };
  sheet: CastingSheet | null;
  proseModel?: { provider: string; model?: string };
  authorModels?: Partial<Record<StepRole, RoleModel>>;
  bucketTemperature?: number;
  spiceRoute?: { provider: string; model?: string } | null;
}
export interface CastResult {
  provider?: string;
  model?: string;
  temperature?: number;
  source: 'spice' | 'manual' | 'author' | 'prose-pick' | 'sheet' | 'tier-fallback';
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
  const { step, sheet, proseModel, authorModels, bucketTemperature, spiceRoute } = inputs;
  const role = step.role;
  const mo = step.modelOverride;

  const result = ((): CastResult => {
    // 1. Spice re-route (a scene flagged over the ceiling) wins over everything,
    //    so a flagged explicit scene never lands on a refusing/ban-risk model.
    if (spiceRoute) return clean(spiceRoute.provider, spiceRoute.model, undefined, 'spice');

    // 2. Manual per-step pin (the existing escape hatch).
    if (mo && (mo.provider || mo.model)) return clean(mo.provider, mo.model, mo.temperature, 'manual');

    // 3. Author/book per-role model (manifest sceneBriefModel/draftModel), applied
    //    to its exact role. A role-specific pin beats the blunt prose-pick default;
    //    the manual per-step pin above still wins. Temperature is inherited from the
    //    genre sheet's role default so stripping the pipelines' baked temp pins
    //    doesn't silently drop draft to the provider's 0.7 default.
    const am = role ? authorModels?.[role] : undefined;
    if (am) {
      const temp = am.temperature ?? (role ? sheet?.roleModels?.[role]?.temperature : undefined);
      return clean(am.provider, am.model, temp, 'author');
    }

    // 4. The book-level prose-model pick (preferredModel), applied to prose roles only.
    const proseRoles = sheet?.proseRoles?.length ? new Set(sheet.proseRoles) : PROSE_ROLES;
    if (proseModel && role && proseRoles.has(role)) {
      return clean(proseModel.provider, proseModel.model, undefined, 'prose-pick');
    }

    // 5. Genre casting-sheet default for the role.
    const rm = role && sheet?.roleModels?.[role];
    if (rm) return clean(rm.provider, rm.model, rm.temperature, 'sheet');

    // 6. Nothing pinned → tier routing decides downstream.
    return { provider: undefined, model: undefined, temperature: undefined, source: 'tier-fallback' };
  })();

  // Temperature precedence: an explicit per-step pin ALWAYS wins (even temperature-
  // only, which branch 2's provider/model guard skips); else the book's Creative/
  // Surgical bucket temperature overrides whatever the model source set; else the
  // source temp (sheet) stands.
  if (typeof mo?.temperature === 'number') result.temperature = mo.temperature;
  else if (typeof bucketTemperature === 'number') result.temperature = bucketTemperature;

  return result;
}
