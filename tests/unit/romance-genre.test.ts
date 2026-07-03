/**
 * Combined-review H4: the generic `romance` genre umbrella (built from
 * contemporary-romance) makes a bare `romance` book creatable and its
 * casting sheet + intimacy template reachable. Before this guide existed,
 * BookService.create({ genre: 'romance' }) threw "Unknown genre template:
 * romance" and library/casting/romance.json only loaded via a hardcoded
 * default. Loads through the REAL LibraryService, the same path a live book
 * uses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import { loadCastingSheet } from '../../gateway/src/services/casting/casting-sheet.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

async function realLibrary(root: string) {
  const lib = new LibraryService(join(process.cwd(), 'library'), join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  const books = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await books.initialize();
  return { lib, books };
}

test('the romance genre umbrella loads with the full guide file set', async () => {
  const root = mkdtempSync(join(tmpdir(), 'romance-genre-'));
  try {
    const { lib } = await realLibrary(root);
    const entry = lib.get('genre', 'romance');
    assert.ok(entry, 'romance genre must be present in the library');
    assert.ok(entry?.description && /romance/i.test(entry.description), 'has a description');
    // Same composed file set as any other genre guide (drives composeGenreGuide).
    for (const f of ['reader-expectations.md', 'tropes.md', 'themes.md', 'beats.md', 'must-haves.md', 'genre-killers.md', 'comps.md']) {
      assert.ok(entry?.files?.[f], `romance guide is missing ${f}`);
    }
    // The umbrella-defining difference: the setting section admits variations
    // beyond strict contemporary (historical/paranormal/suspense).
    assert.match(entry!.files!['reader-expectations.md'], /historical|paranormal|romantic-suspense/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a book can be created with genre "romance" (no longer throws Unknown genre template)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'romance-genre-'));
  try {
    const { books } = await realLibrary(root);
    const m = await books.create({ title: 'A Generic Romance', author: 'default', voice: 'default', genre: 'romance', pipeline: 'novel-pipeline', sections: [] });
    assert.equal(m.pulledFrom?.genre?.name, 'romance');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the romance casting sheet + intimacy template are now reachable by the family key', async () => {
  const sheet = loadCastingSheet('romance');
  assert.ok(sheet, 'library/casting/romance.json must load by the "romance" key');
  assert.equal(sheet?.genre, 'romance');
});

test('negative control: a genre with no guide still throws Unknown genre template', async () => {
  const root = mkdtempSync(join(tmpdir(), 'romance-genre-'));
  try {
    const { books } = await realLibrary(root);
    await assert.rejects(
      () => books.create({ title: 'X', author: 'default', voice: 'default', genre: 'no-such-genre-xyz', pipeline: 'novel-pipeline', sections: [] }),
      /Unknown genre template/,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});
