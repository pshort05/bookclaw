/**
 * Unit tests for diffManifest (Task 7): classify manifest characters against the
 * registry. Determinism NEVER auto-merges same-vs-distinct — surname collisions,
 * possibly-same-as self-flags, and mentioned-but-unknown stay AMBIGUOUS.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffManifest } from '../../gateway/src/services/registry/candidates.js';
import type { NameRegistry } from '../../gateway/src/services/registry/types.js';
import type { ParsedManifest } from '../../gateway/src/services/registry/parse-manifest.js';

const reg: NameRegistry = {
  characters: [{ canonical: 'Rosa Marchetti', tier: 'tertiary', role: 'regular', aliases: [], driftMap: [] }],
  locations: [],
};
const mf = (chars: ParsedManifest['characters']): ParsedManifest =>
  ({ status: 'ok', characters: chars, locations: [], stripped: '' });

test('clearly-distinct new name → auto-new-tertiary', () => {
  const c = diffManifest(mf([{ name: 'Bex', flag: 'new', role: 'barista' }]), reg);
  assert.equal(c[0].kind, 'auto-new-tertiary');
});

test('SURNAME collision with a different role → ambiguous, NEVER auto-mapped', () => {
  const c = diffManifest(mf([{ name: 'Angela Marchetti', flag: 'new', role: 'the bride' }]), reg);
  assert.equal(c[0].kind, 'ambiguous');
  assert.match(c[0].reason, /surname/i);
});

test('model self-flag possibly-same-as → ambiguous', () => {
  const c = diffManifest(mf([{ name: 'Dottie', flag: 'new', possiblySameAs: 'Rosa Marchetti?' }]), reg);
  assert.equal(c[0].kind, 'ambiguous');
});

test('transient flag → suggestedTier transient, non-blocking', () => {
  const c = diffManifest(mf([{ name: 'Passerby', flag: 'transient' }]), reg);
  assert.equal(c[0].suggestedTier, 'transient');
});

test('a name already canonical (or an alias) → known, no candidate surfaced', () => {
  const c = diffManifest(mf([{ name: 'Rosa Marchetti', flag: 'mentioned' }]), reg);
  assert.equal(c.filter(x => x.kind !== 'known').length, 0);
});
