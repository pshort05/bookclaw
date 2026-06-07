/**
 * Unit tests for book-container Phase 3a: the global active-book pointer
 * (persisted to workspace/.config/active-book.json) and the Default Book seed.
 * Network-free; runs over a real temp library + books dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', '# Default Author\n\ndefault soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeSvc(root: string): Promise<BookService> {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  return svc;
}

test('getActiveBook is null on a fresh workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-active-'));
  try {
    const svc = await makeSvc(root);
    assert.equal(svc.getActiveBook(), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setActiveBook persists and survives a reload', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-active-'));
  try {
    const svc = await makeSvc(root);
    const book = await svc.create({ title: 'My Novel', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await svc.setActiveBook(book.slug);
    assert.equal(svc.getActiveBook(), book.slug);
    // Persisted to disk
    const ptr = JSON.parse(readFileSync(join(root, 'workspace', '.config', 'active-book.json'), 'utf-8'));
    assert.equal(ptr.slug, book.slug);
    // A fresh service instance reads the same pointer
    const svc2 = await makeSvc(root);
    assert.equal(svc2.getActiveBook(), book.slug);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setActiveBook rejects an unknown slug', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-active-'));
  try {
    const svc = await makeSvc(root);
    await assert.rejects(() => svc.setActiveBook('does-not-exist'));
    assert.equal(svc.getActiveBook(), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('seedDefaultBook creates + activates a Default Book on an empty workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-active-'));
  try {
    const svc = await makeSvc(root);
    const slug = await svc.seedDefaultBook();
    assert.ok(slug, 'returns the active slug');
    assert.equal(svc.getActiveBook(), slug);
    assert.equal(svc.list().length, 1);
    assert.ok(existsSync(join(root, 'workspace', 'books', slug!, 'templates', 'author', 'SOUL.md')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('seedDefaultBook activates the newest book when books exist but none active', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-active-'));
  try {
    const svc = await makeSvc(root);
    await svc.create({ title: 'Older', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const newer = await svc.create({ title: 'Newer', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const slug = await svc.seedDefaultBook();
    assert.equal(slug, newer.slug); // list() sorts newest-first
    assert.equal(svc.list().length, 2); // did NOT create a Default Book
  } finally { rmSync(root, { recursive: true, force: true }); }
});
