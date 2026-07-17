/**
 * Human-blessed registry decisions. Pure + immutable. The registry only mutates
 * through an explicit review-gate decision:
 *   - `add`    → insert a new character at the chosen tier.
 *   - `map`    → record `name` as a driftMap entry (dedup) on the target
 *                canonical, so enforcement auto-corrects it everywhere.
 *   - `ignore` → no-op (a transient not worth tracking).
 *
 * Determinism NEVER merges same-vs-distinct on its own — a driftMap is written
 * ONLY on an explicit `map` decision from a human.
 */

import type { NameRegistry, NameTier } from './types.js';

export type RegistryDecision =
  | { name: string; action: 'add'; tier: NameTier; role?: string }
  | { name: string; action: 'map'; toCanonical: string }
  | { name: string; action: 'ignore' };

export function applyRegistryDecision(reg: NameRegistry, decision: RegistryDecision): NameRegistry {
  const characters = (reg?.characters ?? []).map(c => ({ ...c, aliases: [...(c.aliases ?? [])], driftMap: [...(c.driftMap ?? [])] }));
  const locations = (reg?.locations ?? []).map(l => ({ ...l, aliases: [...(l.aliases ?? [])], driftMap: [...(l.driftMap ?? [])] }));
  const name = String(decision?.name ?? '').trim();

  if (!name || decision.action === 'ignore') return { characters, locations };

  if (decision.action === 'add') {
    if (characters.some(c => c.canonical.toLowerCase() === name.toLowerCase())) return { characters, locations };
    characters.push({ canonical: name, tier: decision.tier, role: String(decision.role ?? '').trim(), aliases: [], driftMap: [] });
    return { characters, locations };
  }

  // map
  const target = characters.find(c => c.canonical.toLowerCase() === String(decision.toCanonical ?? '').trim().toLowerCase());
  if (target && !target.driftMap.some(d => d.toLowerCase() === name.toLowerCase())) {
    target.driftMap.push(name);
  }
  return { characters, locations };
}
