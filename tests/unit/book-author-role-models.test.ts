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
  write(b, 'authors/modeled/SOUL.md', 'soul');
  write(b, 'authors/modeled/meta.json', JSON.stringify({
    description: 'A modeled author',
    sceneBriefModel: { provider: 'openrouter', model: 'auto:newest-sonnet' },
    draftModel: { provider: 'openrouter', model: 'auto:newest-opus' },
  }));
  write(b, 'voices/default/STYLE-GUIDE.md', 'style');
  write(b, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  const lib = new LibraryService(b, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  const books = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await books.initialize();
  return { books, lib };
}

test('a book bound to a modeled author inherits sceneBriefModel/draftModel', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookmodel-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Modeled Book', author: 'modeled', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.deepEqual(m.sceneBriefModel, { provider: 'openrouter', model: 'auto:newest-sonnet' });
    assert.deepEqual(m.draftModel, { provider: 'openrouter', model: 'auto:newest-opus' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an explicit per-book draftModel overrides the author default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookmodel-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Override Book', author: 'modeled', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [], draftModel: { provider: 'openrouter', model: 'explicit' } });
    assert.equal(m.draftModel?.model, 'explicit');
    // scene-brief still inherited from the author
    assert.equal(m.sceneBriefModel?.model, 'auto:newest-sonnet');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a book bound to an author with no role models omits the manifest fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookmodel-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Plain Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(m.sceneBriefModel, undefined);
    assert.equal(m.draftModel, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('new books default alternateTakes to sceneTakes ON', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookmodel-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Takes Default', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.deepEqual(m.alternateTakes, { sceneTakes: true, draftOpening: false });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an explicit alternateTakes on create wins over the default', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookmodel-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'No Takes', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [], alternateTakes: { sceneTakes: false, draftOpening: false } });
    assert.equal(m.alternateTakes, undefined); // both false → field omitted
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setModelConfig sets and clears role models', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookmodel-'));
  try {
    const { books } = await setup(root);
    const created = await books.create({ title: 'Cfg Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const slug = created.slug;
    let m = await books.setModelConfig(slug, { draftModel: { provider: 'openrouter', model: 'auto:newest-opus' } });
    assert.deepEqual(m.draftModel, { provider: 'openrouter', model: 'auto:newest-opus' });
    m = await books.setModelConfig(slug, { draftModel: { provider: '' } });
    assert.equal(m.draftModel, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
