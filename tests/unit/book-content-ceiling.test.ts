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
  write(b, 'authors/branded/SOUL.md', 'soul');
  write(b, 'authors/branded/meta.json', JSON.stringify({ contentBrand: { spiceCeiling: 8, violenceCeiling: 4 } }));
  write(b, 'voices/default/STYLE-GUIDE.md', 'style');
  write(b, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  const lib = new LibraryService(b, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  const books = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await books.initialize();
  return { books, lib };
}

test('an author template can carry a contentBrand sidecar field', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookceiling-'));
  try {
    const { lib } = await setup(root);
    const entry = lib.get('author', 'branded');
    assert.deepEqual(entry?.contentBrand, { spiceCeiling: 8, violenceCeiling: 4 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a book bound to a branded author inherits contentCeiling when not explicitly set', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookceiling-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Branded Book', author: 'branded', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.deepEqual(m.contentCeiling, { spice: 8, violence: 4 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an explicit per-book contentCeiling overrides the author brand', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookceiling-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Override Book', author: 'branded', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [], contentCeiling: { spice: 2, violence: 1 } });
    assert.deepEqual(m.contentCeiling, { spice: 2, violence: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a book bound to an unbranded author has no contentCeiling (fade-to-black default)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookceiling-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Plain Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(m.contentCeiling, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
