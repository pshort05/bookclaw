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
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice style');
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
    const created = await svc.create({ title: "The Dragon's Heir", author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: ['front-matter', 'back-matter'] });
    assert.equal(created.slug, 'the-dragon-s-heir');
    const dir = join(booksDir, created.slug);
    const manifest = JSON.parse(readFileSync(join(dir, 'book.json'), 'utf-8'));
    assert.equal(manifest.schemaVersion, BOOK_SCHEMA_VERSION); // v2: created with the current schema
    assert.deepEqual(manifest.pipelineSequence, ['novel-pipeline']);
    assert.equal(manifest.title, "The Dragon's Heir");
    assert.equal(manifest.pulledFrom.author.name, 'default');
    assert.equal(manifest.pulledFrom.pipeline.name, 'novel-pipeline');
    assert.deepEqual(manifest.pulledFrom.sections, ['front-matter', 'back-matter']);
    assert.ok(readFileSync(join(dir, 'templates/author/SOUL.md'), 'utf-8').includes('default soul'));
    assert.ok(readFileSync(join(dir, 'templates/genre/tropes.md'), 'utf-8').includes('romantasy tropes'));
    assert.ok(existsSync(join(dir, 'templates/pipeline/novel-pipeline.json'))); // v2 per-name snapshot layout
    assert.ok(readFileSync(join(dir, 'templates/sections/front-matter.md'), 'utf-8').includes('FRONT'));
    assert.ok(existsSync(join(dir, 'data')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BookService.create de-duplicates slugs and validates inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const a = await svc.create({ title: 'Same', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const b = await svc.create({ title: 'Same', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(a.slug, 'same');
    assert.equal(b.slug, 'same-2');
    await assert.rejects(() => svc.create({ title: 'X', author: 'nope', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] }), /author/i);
    await assert.rejects(() => svc.create({ title: 'X', author: 'default', voice: 'default', genre: null, pipeline: 'nope', sections: [] }), /pipeline/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BookService.list returns summaries with computed gate status', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const booksDir = join(root, 'workspace', 'books');
    const svc = new BookService(booksDir, lib, '9.9.9');
    await svc.create({ title: 'Good Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const dir = join(booksDir, 'future-book');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'book.json'), JSON.stringify({ slug: 'future-book', title: 'Future', phase: 'planning', schemaVersion: 999, createdAt: '2026-01-01T00:00:00Z' }));
    const list = svc.list();
    assert.equal(list.find(b => b.slug === 'good-book')?.status, 'ok');
    assert.equal(list.find(b => b.slug === 'future-book')?.status, 'readonly');
    const good = list.find(b => b.slug === 'good-book');
    assert.equal(good?.author, 'default');
    assert.equal(good?.voice, 'default');
    assert.equal(good?.genre, null);
    // future-book.json has no pulledFrom — byline fields must be absent, not a crash:
    const future = list.find(b => b.slug === 'future-book');
    assert.equal(future?.author, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BookService.create with no genre omits the genre snapshot + records null', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const booksDir = join(root, 'workspace', 'books');
    const svc = new BookService(booksDir, lib, '9.9.9');
    const created = await svc.create({ title: 'No Genre', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const dir = join(booksDir, created.slug);
    assert.equal(existsSync(join(dir, 'templates/genre')), false, 'no genre dir when genre is null');
    const manifest = JSON.parse(readFileSync(join(dir, 'book.json'), 'utf-8'));
    assert.equal(manifest.pulledFrom.genre, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('create() snapshots voice + pipeline-referenced skills into templates/', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-booksnap-'));
  try {
    const builtin = join(root, 'library');
    write(builtin, 'authors/default/SOUL.md', '# A\nidentity');
    write(builtin, 'voices/default/STYLE-GUIDE.md', 'style');
    write(builtin, 'pipelines/mini.json', JSON.stringify({
      schemaVersion: 1, name: 'mini', label: 'Mini', description: 'd',
      steps: [{ id: 's1', label: 'Outline', taskType: 'outline', skill: 'outline-helper', promptTemplate: 'Write {{title}}' }],
    }));
    const skills = {
      getSkillCatalog: () => [{ name: 'outline-helper', description: 'd', source: 'builtin' as const }],
      getSkillByName: (n: string) => n === 'outline-helper' ? { content: 'SKILL BODY', description: 'd', source: 'builtin' as const } : undefined,
    } as never;
    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), skills);
    await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.initialize();

    const m = await svc.create({ title: 'T', author: 'default', voice: 'default', genre: null, pipeline: 'mini', sections: [] });
    const dir = join(root, 'workspace', 'books', m.slug);
    assert.ok(existsSync(join(dir, 'templates', 'voice', 'STYLE-GUIDE.md')), 'voice snapshot');
    assert.equal(readFileSync(join(dir, 'templates', 'skills', 'outline-helper', 'SKILL.md'), 'utf-8'), 'SKILL BODY');
    assert.equal(m.pulledFrom.voice.name, 'default');
    assert.deepEqual(m.pulledFrom.skills, ['outline-helper']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('create() rejects an unknown voice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-booksnap2-'));
  try {
    const builtin = join(root, 'library');
    write(builtin, 'authors/default/SOUL.md', '# A\nx');
    write(builtin, 'voices/default/STYLE-GUIDE.md', 'style');
    write(builtin, 'pipelines/mini.json', JSON.stringify({ schemaVersion: 1, name: 'mini', label: 'M', description: 'd', dynamic: true, steps: [] }));
    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), { getSkillCatalog: () => [], getSkillByName: () => undefined } as never);
    await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.initialize();
    await assert.rejects(() => svc.create({ title: 'T', author: 'default', voice: 'nope', genre: null, pipeline: 'mini', sections: [] }), /voice/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BookService.open returns manifest+status, quarantines too-old, undefined when absent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const booksDir = join(root, 'workspace', 'books');
    const svc = new BookService(booksDir, lib, '9.9.9');
    const created = await svc.create({ title: 'Openable', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });

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
