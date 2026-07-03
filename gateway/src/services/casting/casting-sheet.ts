import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { isStepRole, type StepRole } from './roles.js';

export interface RoleModel { provider: string; model?: string; temperature?: number }
export interface HeatLadder {
  eroticaThreshold: number;
  uncensoredByLevel: Array<{ minSpice: number; provider: string; model?: string }>;
  rerouteRoles: StepRole[];
  fallbackOrder: string[];
}
export interface CastingSheet {
  genre: string;
  roleModels: Partial<Record<StepRole, RoleModel>>;
  proseRoles: StepRole[];
  heatLadder?: HeatLadder;
  ensemblePanel?: string[];
}

export function validateCastingSheet(raw: unknown): CastingSheet {
  const r = raw as any;
  if (!r || typeof r !== 'object') throw new Error('casting sheet must be an object');
  if (typeof r.genre !== 'string' || !r.genre) throw new Error('casting sheet: genre required');
  const roleModels: Partial<Record<StepRole, RoleModel>> = {};
  for (const [key, val] of Object.entries(r.roleModels || {})) {
    if (!isStepRole(key)) throw new Error(`casting sheet: unknown role "${key}"`);
    const v = val as any;
    if (!v || typeof v.provider !== 'string' || !v.provider) throw new Error(`casting sheet: role "${key}" needs a provider`);
    roleModels[key] = { provider: v.provider, model: v.model, temperature: typeof v.temperature === 'number' ? v.temperature : undefined };
  }
  const proseRoles = Array.isArray(r.proseRoles) && r.proseRoles.every(isStepRole)
    ? (r.proseRoles as StepRole[]) : (['scene_brief', 'draft'] as StepRole[]);
  return { genre: r.genre, roleModels, proseRoles, heatLadder: r.heatLadder, ensemblePanel: r.ensemblePanel };
}

// stepRouting resolves the sheet on every tagged step; cache the parsed
// result per (genre, dirs) so a multi-step pipeline doesn't re-read + re-parse
// the same JSON file over and over.
const sheetCache = new Map<string, CastingSheet | null>();

/** Test-only: clear the module-level casting-sheet cache. */
export function clearCastingSheetCache(): void {
  sheetCache.clear();
}

/** Load `<genre>.json` from the workspace overlay if present, else the builtin dir. */
export function loadCastingSheet(
  genre: string,
  opts: { builtinDir?: string; overlayDir?: string } = {},
): CastingSheet | null {
  if (!/^[a-z0-9_-]+$/i.test(genre)) return null;
  const builtinDir = opts.builtinDir ?? join(process.cwd(), 'library', 'casting');
  const overlayDir = opts.overlayDir ?? join(process.cwd(), 'workspace', 'library', 'casting');
  const cacheKey = `${genre}|${builtinDir}|${overlayDir}`;
  if (sheetCache.has(cacheKey)) return sheetCache.get(cacheKey)!;

  let result: CastingSheet | null = null;
  for (const dir of [overlayDir, builtinDir]) {
    const p = join(dir, `${genre}.json`);
    if (existsSync(p)) {
      try { result = validateCastingSheet(JSON.parse(readFileSync(p, 'utf-8'))); break; }
      catch { /* fall through to the next dir */ }
    }
  }
  sheetCache.set(cacheKey, result);
  return result;
}
