/**
 * Unit tests for sweepManifestRemnant (Task 4): the conditional light-model
 * fallback fires ONLY when the deterministic parse fails; the happy path makes
 * zero model calls; a model failure degrades fail-soft.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepManifestRemnant } from '../../gateway/src/services/registry/remnant-sweep.js';

const CLEAN = `Prose.\n\n<!--BOOKCLAW:MANIFEST\nCHARACTERS: none\nLOCATIONS: none\n/MANIFEST-->`;

test('happy path (clean manifest) fires ZERO model calls', async () => {
  let calls = 0;
  const r = await sweepManifestRemnant({ text: CLEAN, aiComplete: async () => { calls++; return { text: '' }; } });
  assert.equal(calls, 0);
  assert.equal(r.stripped.trim(), 'Prose.');
});

test('malformed remnant → light model strips it; result parses clean', async () => {
  const malformed = `Prose stays.\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- X | new`;
  const r = await sweepManifestRemnant({
    text: malformed,
    aiComplete: async () => ({ text: 'Prose stays.' }),
  });
  assert.equal(r.stripped.trim(), 'Prose stays.');
});

test('model failure → fail-soft: returns best-effort deterministic strip, no throw', async () => {
  const malformed = `Prose.\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- X`;
  const r = await sweepManifestRemnant({ text: malformed, aiComplete: async () => { throw new Error('down'); } });
  assert.ok(typeof r.stripped === 'string');
});

// Regression: a chapter that never carried a manifest (every romance/library
// pipeline whose draft prompt lacks the contract) must NOT be round-tripped
// through the light model — that would risk truncating/paraphrasing good prose.
test('MISSING manifest with no markers fires ZERO model calls; prose untouched', async () => {
  let calls = 0;
  const plain = 'A perfectly clean chapter of prose, no manifest anywhere in it.';
  const r = await sweepManifestRemnant({ text: plain, aiComplete: async () => { calls++; return { text: 'MANGLED SHORTER PROSE' }; } });
  assert.equal(calls, 0);
  assert.equal(r.stripped, plain);
});

// Regression (anti-bleed on the failure path): a two-block manifest (e.g. from a
// multi-pass continuation) leaves residue after the deterministic strip. If the
// model sweep then FAILS, the fallback must be a deterministic HARD strip that
// removes EVERY manifest marker — never a best-effort strip that leaks a block.
test('residue + model failure → deterministic hard strip leaves NO manifest residue', async () => {
  const twoBlocks =
    `Prose pass one.\n\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- A | new\n/MANIFEST-->\n\n` +
    `Prose pass two.\n\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- B | new\n/MANIFEST-->`;
  const r = await sweepManifestRemnant({ text: twoBlocks, aiComplete: async () => { throw new Error('down'); } });
  assert.doesNotMatch(r.stripped, /BOOKCLAW:MANIFEST|\/MANIFEST--|^CHARACTERS:|^LOCATIONS:/m);
  assert.match(r.stripped, /Prose pass one\./);
  assert.match(r.stripped, /Prose pass two\./);
});

// Regression: if the model "cleans" the text but LEAVES residue, distrust it and
// fall back to the deterministic hard strip.
test('model returns residue → hard-strip fallback still yields residue-free prose', async () => {
  const malformed = `Prose.\n\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- A | new\n/MANIFEST-->`;
  const r = await sweepManifestRemnant({
    text: malformed,
    aiComplete: async () => ({ text: `Prose.\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- A | new\n/MANIFEST-->` }),
  });
  assert.doesNotMatch(r.stripped, /BOOKCLAW:MANIFEST|\/MANIFEST--/);
});
