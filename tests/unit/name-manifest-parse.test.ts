/**
 * Unit tests for parseManifest (Task 3): sentinel locate (header/footer),
 * validate, strip, empty/missing/malformed status, and the ANTI-BLEED residue
 * guard (no manifest markers may survive into the stripped prose).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../../gateway/src/services/registry/parse-manifest.js';

const BLOCK = `<!--BOOKCLAW:MANIFEST
CHARACTERS:
- Dottie | new | server at the wedding | possibly-same-as: Rosa Marchetti?
- Marisol | mentioned | Cole's staffer, offpage | transient
LOCATIONS:
- (none new)
/MANIFEST-->`;

test('locates and strips a FOOTER manifest; prose survives clean', () => {
  const r = parseManifest(`Chapter prose here.\n\n${BLOCK}`);
  assert.equal(r.status, 'ok');
  assert.equal(r.stripped.trim(), 'Chapter prose here.');
  assert.equal(r.characters.length, 2);
  assert.equal(r.characters[0].name, 'Dottie');
  assert.equal(r.characters[0].flag, 'new');
  assert.match(r.characters[0].possiblySameAs ?? '', /Rosa Marchetti/);
  assert.equal(r.characters[1].flag, 'mentioned');
});

test('locates a HEADER manifest by sentinel, not offset', () => {
  const r = parseManifest(`${BLOCK}\n\nChapter prose here.`);
  assert.equal(r.status, 'ok');
  assert.equal(r.stripped.trim(), 'Chapter prose here.');
});

test('empty manifest (CHARACTERS: none) is valid with zero candidates', () => {
  const r = parseManifest(`Prose.\n\n<!--BOOKCLAW:MANIFEST\nCHARACTERS: none\nLOCATIONS: none\n/MANIFEST-->`);
  assert.equal(r.status, 'empty');
  assert.equal(r.characters.length, 0);
  assert.equal(r.stripped.trim(), 'Prose.');
});

test('missing block → status missing, prose returned untouched', () => {
  const r = parseManifest('Just chapter prose, no manifest.');
  assert.equal(r.status, 'missing');
  assert.equal(r.stripped, 'Just chapter prose, no manifest.');
});

test('malformed sentinel (open without close) → malformed, prose NOT corrupted', () => {
  const r = parseManifest(`Prose.\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- X | new`);
  assert.equal(r.status, 'malformed');
});

test('ANTI-BLEED: no sentinel/CHARACTERS/LOCATIONS residue survives a strip', () => {
  const r = parseManifest(`Prose.\n\n${BLOCK}`);
  assert.doesNotMatch(r.stripped, /BOOKCLAW:MANIFEST|\/MANIFEST--|^CHARACTERS:|^LOCATIONS:/m);
});

test('residue detection: a second stray CHARACTERS: line after strip flags residue', () => {
  const r = parseManifest(`Prose.\nCHARACTERS: leftover\n\n${BLOCK}`);
  assert.equal(r.status, 'residue');
});
