/**
 * Unit tests for the book entity (book-container Phase 2): slug derivation,
 * the version-gate classification, and BookService create/list/open over a
 * real temp library + books dir. Network-free.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify, classifyVersion, BOOK_SCHEMA_VERSION } from '../../gateway/src/services/book-types.js';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

test('slugify normalizes titles and is non-empty', () => {
  assert.equal(slugify("The Dragon's Heir"), 'the-dragon-s-heir');
  assert.equal(slugify('  Hello,  World!! '), 'hello-world');
  assert.equal(slugify('***'), 'book'); // empty result falls back
  assert.equal(slugify('a'.repeat(100)).length, 60); // capped
});

test('classifyVersion gates by supported range', () => {
  assert.equal(classifyVersion(BOOK_SCHEMA_VERSION), 'ok');
  assert.equal(classifyVersion(BOOK_SCHEMA_VERSION + 1), 'readonly'); // too new → read-only
  assert.equal(classifyVersion(0), 'quarantined');                    // too old → quarantine
});

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'default soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'genres/romantasy/tropes.md', 'romantasy tropes');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  write(builtin, 'sections/front-matter.md', 'FRONT');
  write(builtin, 'sections/back-matter.md', 'BACK');
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

test('BookService.create snapshots selected templates and writes a manifest', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const booksDir = join(root, 'workspace', 'books');
    const svc = new BookService(booksDir, lib, '9.9.9');
    const created = await svc.create({ title: "The Dragon's Heir", author: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: ['front-matter', 'back-matter'] });
    assert.equal(created.slug, 'the-dragon-s-heir');
    const dir = join(booksDir, created.slug);
    const manifest = JSON.parse(readFileSync(join(dir, 'book.json'), 'utf-8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.title, "The Dragon's Heir");
    assert.equal(manifest.pulledFrom.author.name, 'default');
    assert.equal(manifest.pulledFrom.pipeline.name, 'novel-pipeline');
    assert.deepEqual(manifest.pulledFrom.sections, ['front-matter', 'back-matter']);
    assert.ok(readFileSync(join(dir, 'templates/author/SOUL.md'), 'utf-8').includes('default soul'));
    assert.ok(readFileSync(join(dir, 'templates/genre/tropes.md'), 'utf-8').includes('romantasy tropes'));
    assert.ok(existsSync(join(dir, 'templates/pipeline.json')));
    assert.ok(readFileSync(join(dir, 'templates/sections/front-matter.md'), 'utf-8').includes('FRONT'));
    assert.ok(existsSync(join(dir, 'data')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BookService.create de-duplicates slugs and validates inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const a = await svc.create({ title: 'Same', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const b = await svc.create({ title: 'Same', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(a.slug, 'same');
    assert.equal(b.slug, 'same-2');
    await assert.rejects(() => svc.create({ title: 'X', author: 'nope', genre: null, pipeline: 'novel-pipeline', sections: [] }), /author/i);
    await assert.rejects(() => svc.create({ title: 'X', author: 'default', genre: null, pipeline: 'nope', sections: [] }), /pipeline/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BookService.list returns summaries with computed gate status', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const booksDir = join(root, 'workspace', 'books');
    const svc = new BookService(booksDir, lib, '9.9.9');
    await svc.create({ title: 'Good Book', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const dir = join(booksDir, 'future-book');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'book.json'), JSON.stringify({ slug: 'future-book', title: 'Future', phase: 'planning', schemaVersion: 999, createdAt: '2026-01-01T00:00:00Z' }));
    const list = svc.list();
    assert.equal(list.find(b => b.slug === 'good-book')?.status, 'ok');
    assert.equal(list.find(b => b.slug === 'future-book')?.status, 'readonly');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BookService.create with no genre omits the genre snapshot + records null', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const booksDir = join(root, 'workspace', 'books');
    const svc = new BookService(booksDir, lib, '9.9.9');
    const created = await svc.create({ title: 'No Genre', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const dir = join(booksDir, created.slug);
    assert.equal(existsSync(join(dir, 'templates/genre')), false, 'no genre dir when genre is null');
    const manifest = JSON.parse(readFileSync(join(dir, 'book.json'), 'utf-8'));
    assert.equal(manifest.pulledFrom.genre, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BookService.open returns manifest+status, quarantines too-old, undefined when absent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const booksDir = join(root, 'workspace', 'books');
    const svc = new BookService(booksDir, lib, '9.9.9');
    const created = await svc.create({ title: 'Openable', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });

    const ok = await svc.open(created.slug);
    assert.equal(ok?.status, 'ok');
    assert.equal(ok?.manifest.title, 'Openable');

    // A book written by an older schema (0) → quarantined on open.
    const oldDir = join(booksDir, 'ancient');
    mkdirSync(oldDir, { recursive: true });
    writeFileSync(join(oldDir, 'book.json'), JSON.stringify({ slug: 'ancient', title: 'Ancient', phase: 'planning', schemaVersion: 0, createdAt: '2020-01-01T00:00:00Z' }));
    assert.equal((await svc.open('ancient'))?.status, 'quarantined');

    // Missing book → undefined.
    assert.equal(await svc.open('nope'), undefined);

    // Path-traversal slug (Express decodes %2e%2e%2f → ../) → rejected, no escape.
    assert.equal(await svc.open('../../etc'), undefined);
    assert.equal(await svc.open('..'), undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
