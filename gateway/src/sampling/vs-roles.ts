import type { StepRole } from '../services/casting/roles.js';
import { VS_DEFAULTS, type VsConfig } from './verbalized-sampling.js';

/** Roles VS may attach to. Enforced so VS can never land on a verifiable-answer pass. */
export const VS_ROLES: ReadonlySet<StepRole> = new Set<StepRole>(['approach', 'draft', 'scene_brief']);

export interface VsStepConfig { enabled: true; k?: number; threshold?: number; variant?: 'standard' | 'cot' | 'multi'; }

export function isVsEnabled(step: { role?: StepRole; vs?: VsStepConfig } | null | undefined): boolean {
  if (!step?.vs?.enabled) return false;
  if (!step.role || !VS_ROLES.has(step.role)) {
    console.log(`  ⚠ Alternate Takes: refused vs on role "${step.role ?? '(none)'}" — not an allowlisted decision role`);
    return false;
  }
  return true;
}

export function resolveVsConfig(step: { vs?: VsStepConfig }): VsConfig {
  const v = step.vs;
  const k = Math.max(2, Math.min(8, v?.k ?? VS_DEFAULTS.k));
  const probabilityThreshold = typeof v?.threshold === 'number' ? v.threshold : VS_DEFAULTS.probabilityThreshold;
  const variant = v?.variant ?? VS_DEFAULTS.variant;
  return { k, probabilityThreshold, variant };
}
