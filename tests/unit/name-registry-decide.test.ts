/**
 * Unit tests for applyRegistryDecision (Task 10): human-blessed registry
 * mutation. `map` records a driftMap entry (dedup) on the target canonical,
 * `add` inserts a new character, `ignore` is a no-op. Determinism never merges
 * without an explicit `map` decision.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRegistryDecision } from '../../gateway/src/services/registry/decide.js';

test('map decision records a driftMap entry on the target canonical', () => {
  const reg = { characters: [{ canonical: 'Rosa Marchetti', tier: 'tertiary' as const, role: 'regular', aliases: [], driftMap: [] }], locations: [] };
  const out = applyRegistryDecision(reg, { name: 'Dottie', action: 'map', toCanonical: 'Rosa Marchetti' });
  assert.deepEqual(out.characters[0].driftMap, ['Dottie']);
});

test('map decision de-dups an already-recorded drift', () => {
  const reg = { characters: [{ canonical: 'Rosa Marchetti', tier: 'tertiary' as const, role: 'regular', aliases: [], driftMap: ['Dottie'] }], locations: [] };
  const out = applyRegistryDecision(reg, { name: 'Dottie', action: 'map', toCanonical: 'Rosa Marchetti' });
  assert.deepEqual(out.characters[0].driftMap, ['Dottie']);
});

test('add decision inserts a new tertiary character', () => {
  const out = applyRegistryDecision({ characters: [], locations: [] }, { name: 'Bex', action: 'add', tier: 'tertiary', role: 'barista' });
  assert.equal(out.characters[0].canonical, 'Bex');
  assert.equal(out.characters[0].tier, 'tertiary');
});

test('ignore decision changes nothing', () => {
  const reg = { characters: [], locations: [] };
  assert.deepEqual(applyRegistryDecision(reg, { name: 'X', action: 'ignore' }), reg);
});
