/**
 * Unit tests for processDraftManifest (Task 9): the extracted draft-completion
 * seam helper. Strips the manifest off the DRAFT before it becomes canonical
 * prose (anti-bleed), surfaces new-name candidates, and fails soft when no
 * manifest is present (prose untouched, zero candidates).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDraftManifest } from '../../gateway/src/services/registry/pipeline.js';
import type { NameRegistry } from '../../gateway/src/services/registry/types.js';

const reg: NameRegistry = {
  characters: [{ canonical: 'Rosa Marchetti', tier: 'tertiary', role: 'regular', aliases: [], driftMap: [] }],
  locations: [],
};
const DRAFT = `Rosa greeted the newcomer.\n\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- Bex | new | barista\nLOCATIONS: none\n/MANIFEST-->`;

test('strips the manifest off the DRAFT before it becomes canonical; prose only', async () => {
  const r = await processDraftManifest({ chapter: DRAFT, registry: reg, aiComplete: async () => ({ text: '' }) });
  assert.equal(r.chapter.trim(), 'Rosa greeted the newcomer.');
  assert.doesNotMatch(r.chapter, /BOOKCLAW:MANIFEST/);
});

test('surfaces the new name as a candidate', async () => {
  const r = await processDraftManifest({ chapter: DRAFT, registry: reg, aiComplete: async () => ({ text: '' }) });
  assert.equal(r.candidates.find(c => c.name === 'Bex')?.kind, 'auto-new-tertiary');
});

test('a chapter with no manifest fails soft: prose untouched, zero candidates, ZERO model calls', async () => {
  let calls = 0;
  const r = await processDraftManifest({ chapter: 'Plain prose.', registry: reg, aiComplete: async () => { calls++; return { text: 'mangled' }; } });
  assert.equal(r.chapter, 'Plain prose.');
  assert.equal(r.candidates.length, 0);
  assert.equal(calls, 0); // a manifest-free chapter must never hit the light model
});
