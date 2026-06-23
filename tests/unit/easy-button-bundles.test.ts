import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// Pure-data / pure-fn frontend modules (zero runtime imports), imported with the
// .js specifier so tsx resolves the .ts source. NOT easyApi.ts — that imports
// '@bookclaw/shared' (a Vite alias) which NodeNext can't resolve; the smoke test
// covers easyApi's network wrappers.
import { BUNDLES } from '../../frontend/studio/src/data/bundles.js';
import { bundleToCreateBody } from '../../frontend/studio/src/lib/bundleBody.js';
import { StoryStructureService } from '../../gateway/src/services/story-structures.js';
import { getForm, validateFormFit } from '../../gateway/src/services/story-forms.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lib = (k: string, name: string) => resolve(repoRoot, 'library', k, name);
const structures = new StoryStructureService();

test('three starter bundles ship', () => {
  assert.equal(BUNDLES.length, 3);
  assert.deepEqual(BUNDLES.map((b) => b.id).sort(), ['romance', 'scifi', 'thriller']);
});

test('every bundle references only built-in public library assets (the IP guardrail)', () => {
  for (const b of BUNDLES) {
    assert.ok(existsSync(lib('authors', b.author)), `author ${b.author}`);
    assert.ok(existsSync(lib('voices', b.voice)), `voice ${b.voice}`);
    assert.ok(existsSync(lib('genres', b.genre)), `genre ${b.genre}`);
    assert.ok(existsSync(lib('sequences', `${b.sequence}.json`)), `sequence ${b.sequence}`);
  }
});

test('every bundle has a known structure and an in-band length', () => {
  for (const b of BUNDLES) {
    assert.ok(structures.get(b.format.structure as never), `structure ${b.format.structure}`);
    const form = getForm(b.format.form);
    assert.ok(form, `form ${b.format.form}`);
    const fit = validateFormFit(form!, b.format.chapterCount, b.format.wordsPerChapter);
    assert.ok(fit.ok, `${b.id} length out of band: ${fit.message}`);
    assert.equal(b.modelTier, 'free');
  }
});

test('bundleToCreateBody builds the POST /api/books body from a bundle', () => {
  const b = BUNDLES[0];
  const body = bundleToCreateBody(b, '  My Book  ', ['book-planning', 'book-bible']) as Record<string, unknown>;
  assert.equal(body.title, 'My Book'); // trimmed
  assert.equal(body.author, b.author);
  assert.equal(body.voice, b.voice);
  assert.equal(body.genre, b.genre);
  assert.equal(body.sequence, b.sequence);
  assert.deepEqual(body.pipelineSequence, ['book-planning', 'book-bible']);
  assert.equal(body.structure, b.format.structure);
  assert.equal(body.form, b.format.form);
  assert.equal(body.chapterCount, b.format.chapterCount);
  assert.equal(body.wordsPerChapter, b.format.wordsPerChapter);
});
