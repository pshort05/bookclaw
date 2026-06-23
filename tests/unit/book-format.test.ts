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
  write(b, 'voices/default/STYLE-GUIDE.md', 'style');
  write(b, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  const lib = new LibraryService(b, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  const books = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await books.initialize();
  return { books };
}

test('setFormat persists and formatGuideFor derives generation inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookfmt-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Fmt Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await books.setFormat(m.slug, { structureId: 'four_act', formId: 'novella', chapterCount: 20, wordsPerChapter: 1500, totalTarget: 30000 });
    const guide = books.formatGuideFor(m.slug);
    assert.equal(guide?.chapterCount, 20);
    assert.equal(guide?.wordsPerChapter, 1500);
    assert.match(guide!.structureRail, /Four-Act|Setup|Midpoint/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('formatGuideFor returns null when no format set', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookfmt-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'No Fmt', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(books.formatGuideFor(m.slug), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('create() with a format persists it in the manifest', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookfmt-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'With Fmt', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [], format: { structureId: 'three_act', formId: 'novel', chapterCount: 30, wordsPerChapter: 2000, totalTarget: 60000 } });
    assert.equal(m.format?.formId, 'novel');
    assert.equal(m.format?.totalTarget, 60000);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
