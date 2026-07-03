/**
 * Human-Gate Cadence (Flagship Plan 5, Task 2): `review.cadence` on the book
 * manifest + author-default inheritance. Mirrors
 * tests/unit/book-content-ceiling.test.ts's contentCeiling/contentBrand
 * precedent exactly (book > author > default), the only existing inheritance
 * pattern of this shape in the codebase.
 *
 * Run: node --import tsx --test tests/unit/book-review-cadence.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;
function write(base: string, rel: string, body: string): void {
  const p = join(base, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body, 'utf-8');
}
async function setup(root: string) {
  const b = join(root, 'library');
  write(b, 'authors/default/SOUL.md', 'soul');
  write(b, 'authors/gated/SOUL.md', 'soul');
  write(b, 'authors/gated/meta.json', JSON.stringify({ reviewCadence: 'per_chapter' }));
  write(b, 'authors/bogus/SOUL.md', 'soul');
  write(b, 'authors/bogus/meta.json', JSON.stringify({ reviewCadence: 'not-a-real-cadence' }));
  write(b, 'voices/default/STYLE-GUIDE.md', 'style');
  write(b, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  const lib = new LibraryService(b, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  const books = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await books.initialize();
  return { books, lib };
}

test('an author template can carry a reviewCadence sidecar field', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookcadence-'));
  try {
    const { lib } = await setup(root);
    const entry = lib.get('author', 'gated');
    assert.equal(entry?.reviewCadence, 'per_chapter');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an invalid reviewCadence value in meta.json is ignored', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookcadence-'));
  try {
    const { lib } = await setup(root);
    const entry = lib.get('author', 'bogus');
    assert.equal(entry?.reviewCadence, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a book bound to an author with a reviewCadence default inherits it when unset', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookcadence-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Gated Book', author: 'gated', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.deepEqual(m.review, { cadence: 'per_chapter' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an explicit per-book reviewCadence overrides the author default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookcadence-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Override Book', author: 'gated', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [], reviewCadence: 'autonomous' });
    assert.deepEqual(m.review, { cadence: 'autonomous' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a book bound to an author with no reviewCadence has no review block (per_act default at read time)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookcadence-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Plain Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(m.review, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
