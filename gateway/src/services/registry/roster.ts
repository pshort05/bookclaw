/**
 * Compact recurring-cast roster builder. Includes recurring tiers
 * (primary/secondary/tertiary), EXCLUDES one-shot transients, and renders
 * `- name — role` lines under a reuse directive. Returns '' for an empty or
 * all-transient registry (so injection is a no-op — no prompt change).
 */

import type { NameRegistry } from './types.js';

const RECURRING = new Set(['primary', 'secondary', 'tertiary']);

export function buildRoster(reg: NameRegistry): string {
  const rows = (reg?.characters ?? [])
    .filter(c => RECURRING.has(c.tier))
    .map(c => `- ${c.canonical}${c.role ? ` — ${c.role}` : ''}`);
  if (!rows.length) return '';
  return 'ESTABLISHED SUPPORTING CAST — reuse these; do not invent new names for these roles:\n' + rows.join('\n');
}
