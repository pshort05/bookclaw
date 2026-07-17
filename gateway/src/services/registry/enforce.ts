/**
 * Compile a per-book registry's driftMaps into an AiNameMap for deterministic
 * enforcement through the SHIPPED applyAiNames (deai/ai-names.ts) — its contract
 * is untouched; enforcement rides the existing map. Each character's/location's
 * drift strings become { find, replace: canonical }, sorted LONGEST-FIRST within
 * an entry so a longer drift ("Dottie Marchetti") replaces before its prefix
 * ("Dottie"). mergeAiNameMaps overlays by `find` (overlay wins).
 */

import type { AiNameMap } from '../deai/ai-names.js';
import type { NameRegistry } from './types.js';

export function registryToAiNameMap(reg: NameRegistry): AiNameMap {
  const out: AiNameMap = [];
  const emit = (canonical: string, drifts: string[]) => {
    for (const find of [...(drifts ?? [])].sort((a, b) => b.length - a.length)) {
      const f = String(find ?? '').trim();
      if (f) out.push({ find: f, replace: canonical });
    }
  };
  for (const c of reg?.characters ?? []) emit(c.canonical, c.driftMap);
  for (const l of reg?.locations ?? []) emit(l.canonical, l.driftMap);
  return out;
}

export function mergeAiNameMaps(base: AiNameMap, overlay: AiNameMap): AiNameMap {
  const byFind = new Map<string, { find: string; replace: string }>();
  for (const row of base ?? []) byFind.set(row.find, row);
  for (const row of overlay ?? []) byFind.set(row.find, row);
  return [...byFind.values()];
}
