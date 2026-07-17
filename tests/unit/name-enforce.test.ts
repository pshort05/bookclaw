/**
 * Unit tests for registry→AiNameMap enforcement (Task 6): driftMap compiles to
 * longest-first find/replace rows, enforcement replaces all occurrences incl.
 * dialogue while a distinct same-surname character is untouched, and
 * mergeAiNameMaps overlays by find.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registryToAiNameMap, mergeAiNameMaps } from '../../gateway/src/services/registry/enforce.js';
import { applyAiNames } from '../../gateway/src/services/deai/ai-names.js';
import type { NameRegistry } from '../../gateway/src/services/registry/types.js';

const reg: NameRegistry = {
  characters: [
    { canonical: 'Rosa Marchetti', tier: 'tertiary', role: 'regular', aliases: [], driftMap: ['Dottie Marchetti', 'Dottie'] },
    { canonical: 'Angela Marchetti', tier: 'secondary', role: 'the bride', aliases: [], driftMap: [] },
  ],
  locations: [],
};

test('driftMap compiles to find/replace rows, longest-first to avoid partial hits', () => {
  const map = registryToAiNameMap(reg);
  assert.deepEqual(map, [
    { find: 'Dottie Marchetti', replace: 'Rosa Marchetti' },
    { find: 'Dottie', replace: 'Rosa Marchetti' },
  ]);
});

test('ENFORCEMENT: driftMap replaces ALL occurrences incl. dialogue; distinct surname untouched', () => {
  const map = registryToAiNameMap(reg);
  const text = 'Dottie smiled. "Thanks, Dottie," said Angela Marchetti.';
  const out = applyAiNames(text, map).text;
  assert.equal(out, 'Rosa Marchetti smiled. "Thanks, Rosa Marchetti," said Angela Marchetti.');
});

test('mergeAiNameMaps: overlay overrides base by find', () => {
  const merged = mergeAiNameMaps([{ find: 'Dottie', replace: 'X' }], [{ find: 'Dottie', replace: 'Rosa' }]);
  assert.deepEqual(merged, [{ find: 'Dottie', replace: 'Rosa' }]);
});

test('FIXTURE (project-77 Ch3): registry driftMap yields a Rosa-only chapter; Angela untouched', () => {
  // Registry: Rosa Marchetti with driftMap [Dottie Marchetti, Dottie]. A Ch3-style
  // draft containing both "Rosa Marchetti" and "Dottie Marchetti" (plus the bride
  // "Angela Marchetti") must enforce to a single canonical Rosa; Angela stays.
  const map = registryToAiNameMap(reg);
  const draft = 'Rosa Marchetti wiped the counter. Later, Dottie Marchetti rang up the order. '
    + '"See you tomorrow, Dottie," Cole said. Angela Marchetti, the bride, waved from the door.';
  const out = applyAiNames(draft, map).text;
  assert.doesNotMatch(out, /Dottie/);
  assert.match(out, /Angela Marchetti, the bride/);
  // Every drift collapsed to the one canonical name.
  assert.equal((out.match(/Rosa Marchetti/g) || []).length, 3);
});
