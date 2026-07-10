/**
 * Romance Workflow Foundation, Task 2: `seeds` on the book manifest — plain
 * per-book field threaded through BookService.create() the same way
 * ensemble/costBudget/uncensoredProvider are (mirrors
 * tests/unit/book-ensemble.test.ts's setup). `councilSelection` is persisted
 * only here; it is wired to no behavior until a later sub-project.
 *
 * Run: node --import tsx --test tests/unit/book-seeds.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
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
  write(b, 'voices/default/STYLE-GUIDE.md', 'style');
  write(b, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  const lib = new LibraryService(b, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  const books = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await books.initialize();
  return { books, lib };
}

test('a plain book has no seeds block', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookseeds-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Plain Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(m.seeds, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BookService.create persists seeds onto the manifest and book.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookseeds-'));
  try {
    const { books } = await setup(root);
    const manifest = await books.create({
      title: 'Seeded Romance', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [],
      seeds: { storyArc: 'ARC_X', characters: 'CHAR_X', setting: 'SETTING_X', blueprint: 'BLUEPRINT_X', councilSelection: 'auto' },
    } as any);
    assert.deepEqual(manifest.seeds, { storyArc: 'ARC_X', characters: 'CHAR_X', setting: 'SETTING_X', blueprint: 'BLUEPRINT_X', councilSelection: 'auto' });

    const onDisk = JSON.parse(readFileSync(join(root, 'workspace', 'books', manifest.slug, 'book.json'), 'utf-8'));
    assert.equal(onDisk.seeds.characters, 'CHAR_X');
    assert.equal(onDisk.seeds.councilSelection, 'auto');
    assert.equal(onDisk.seeds.blueprint, 'BLUEPRINT_X');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
