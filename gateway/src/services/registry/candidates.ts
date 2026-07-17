/**
 * Candidate resolver: diff a parsed manifest against the registry and classify
 * each named character as `known`, `auto-new-tertiary`, or `ambiguous`.
 *
 * Determinism NEVER decides same-person-vs-two-people. A surname collision
 * (Rosa vs Angela Marchetti), a model `possibly-same-as` self-flag, or a
 * `mentioned` name absent from the registry are all surfaced as `ambiguous`
 * (ask the human) — never auto-merged into a driftMap.
 */

import type { NameRegistry } from './types.js';
import type { ParsedManifest, ManifestCharacter } from './parse-manifest.js';

export type CandidateKind = 'auto-new-tertiary' | 'ambiguous' | 'known';
export interface NameCandidate {
  name: string;
  kind: CandidateKind;
  reason: string;
  suggestedTier?: 'tertiary' | 'transient';
  possiblySameAs?: string;
}

const norm = (s: string): string => String(s ?? '').trim().toLowerCase();
const surname = (s: string): string => norm(s).split(/\s+/).filter(Boolean).pop() ?? '';

function classify(mc: ManifestCharacter, reg: NameRegistry): NameCandidate {
  const name = String(mc?.name ?? '').trim();
  const chars = reg?.characters ?? [];

  const isKnown = chars.some(c =>
    norm(c.canonical) === norm(name) || (c.aliases ?? []).some(a => norm(a) === norm(name)));
  if (isKnown) return { name, kind: 'known', reason: 'already in the registry' };

  if (mc.possiblySameAs) {
    return { name, kind: 'ambiguous', reason: `model flagged possibly-same-as ${mc.possiblySameAs}`, possiblySameAs: mc.possiblySameAs };
  }

  const sn = surname(name);
  const collision = sn && chars.find(c => surname(c.canonical) === sn);
  if (collision) {
    return { name, kind: 'ambiguous', reason: `shares the surname "${sn}" with existing "${collision.canonical}" — distinct person or drift? ask` };
  }

  if (mc.flag === 'mentioned') {
    return { name, kind: 'ambiguous', reason: 'mentioned by name but not in the registry — new or drift? ask' };
  }

  return {
    name,
    kind: 'auto-new-tertiary',
    reason: 'clearly-distinct new name',
    suggestedTier: mc.flag === 'transient' ? 'transient' : 'tertiary',
  };
}

export function diffManifest(manifest: ParsedManifest, reg: NameRegistry): NameCandidate[] {
  return (manifest?.characters ?? []).filter(c => c?.name).map(c => classify(c, reg));
}
