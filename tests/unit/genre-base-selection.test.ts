/**
 * Flagship Plan 7, Task 4: genre -> base pipeline + casting-sheet selection.
 *
 * Exercises the REAL POST /api/books route (mountBooks) against the REAL
 * repo library/ directory (builtin dir), not a synthetic fixture — proving
 * that creating a book with only a `genre` (no explicit pipeline/sequence)
 * actually resolves the genre's base pipeline sequence through
 * baseSequenceNameForGenre + the real `sequence` library entries created in
 * Task 2, and that loadCastingSheet(genre) independently returns the matching
 * validated sheet from Task 1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'net';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import { mountBooks } from '../../gateway/src/api/routes/books.routes.js';
import { loadCastingSheet, clearCastingSheetCache } from '../../gateway/src/services/casting/casting-sheet.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

async function makeApp(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  // Builtin dir points at the REAL repo library/ (not a synthetic fixture) —
  // the same library.get('pipeline'|'sequence', ...) resolution a live book uses.
  const lib = new LibraryService('library', join(root, 'overlay'), fakeSkills);
  await lib.loadAll();
  const books = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await books.initialize();
  const gateway: any = { getProjectEngine: () => null, getServices: () => ({ books, library: lib }) };
  const app = express();
  app.use(express.json());
  mountBooks(app as any, gateway, root);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise<void>((r) => server.close(() => r())) };
}

for (const [genre, expectedPipelines] of [
  ['techno-thriller', ['technothriller-planning', 'technothriller-production']],
  ['romantasy', ['romantasy-planning', 'romantasy-production']],
] as const) {
  test(`creating a book with genre '${genre}' and no explicit pipeline selects the ${genre} base`, async () => {
    const root = mkdtempSync(join(tmpdir(), `bookclaw-genrebase-${genre}-`));
    const { url, close } = await makeApp(root);
    try {
      const res = await fetch(`${url}/api/books`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Test ${genre} Book`, author: 'default', voice: 'default', genre }),
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      assert.deepEqual(body.book.pipelineSequence, expectedPipelines);

      // The casting sheet for this genre resolves and validates independently
      // (real loadCastingSheet, not a hand-built object).
      clearCastingSheetCache();
      const sheet = loadCastingSheet(genre);
      assert.ok(sheet, `loadCastingSheet('${genre}') must return a sheet`);
      assert.equal(sheet!.genre, genre);
    } finally {
      await close();
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("creating a book with genre 'science-fiction' and no explicit pipeline selects the mundane-sci-fi (MSF) base", async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-genrebase-scifi-'));
  const { url, close } = await makeApp(root);
  try {
    const res = await fetch(`${url}/api/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test scifi Book', author: 'default', voice: 'default', genre: 'science-fiction' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(body.book.pipelineSequence, [
      'msf-phase1-ideation', 'msf-phase2-developmental', 'msf-phase3-outline',
      'msf-phase4-prose', 'msf-phase5-summary-bible', 'msf-phase6-finalize',
    ]);

    clearCastingSheetCache();
    const sheet = loadCastingSheet('science-fiction');
    assert.ok(sheet, "loadCastingSheet('science-fiction') must return a sheet");
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('an explicit pipeline still wins over the genre default (backward compatible)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-genrebase-explicit-'));
  const { url, close } = await makeApp(root);
  try {
    const res = await fetch(`${url}/api/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Explicit Pipeline Book', author: 'default', voice: 'default', genre: 'techno-thriller', pipeline: 'novel-pipeline' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.deepEqual(body.book.pipelineSequence, ['novel-pipeline']);
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('a genre with no mapped base (e.g. romance, which ships two ambiguous variants) still requires an explicit pipeline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-genrebase-romance-'));
  const { url, close } = await makeApp(root);
  try {
    const res = await fetch(`${url}/api/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Romance Book', author: 'default', voice: 'default', genre: 'romance' }),
    });
    const body = await res.json();
    assert.equal(res.status, 400);
    assert.match(body.error, /pipeline.*required/i);
  } finally {
    await close();
    rmSync(root, { recursive: true, force: true });
  }
});
