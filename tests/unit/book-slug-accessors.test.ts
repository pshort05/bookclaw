/**
 * Unit tests for the slug-parameterised BookService accessors added in Phase 8:
 * authorDirOf, voiceDirOf, dataDirOf, pipelineOf, genreGuideOf.
 *
 * All tests use a book that is CREATED but NOT set as the active book, so the
 * results can only come from the slug-based path, not the active-book pointer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function seedLibrary(root: string, withGenre = true): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'default soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice style');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({
    schemaVersion: 1, name: 'novel-pipeline', label: 'Novel',
    description: 'd', dynamic: true, steps: [],
  }));
  if (withGenre) {
    write(builtin, 'genres/romantasy/tropes.md', 'TROPES-BODY');
    write(builtin, 'genres/romantasy/themes.md', 'THEMES-BODY');
  }
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

test('authorDirOf returns path ending in templates/author for a created book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-slug-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const m = await svc.create({ title: 'MyBook', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: [] });
    // NOT calling setActiveBook — active book stays null
    const result = svc.authorDirOf(m.slug);
    assert.ok(result !== null, 'should be non-null');
    assert.ok(result!.endsWith(join('templates', 'author')), `expected path ending in templates/author, got: ${result}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('voiceDirOf returns path ending in templates/voice for a created book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-slug-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const m = await svc.create({ title: 'MyBook', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: [] });
    const result = svc.voiceDirOf(m.slug);
    assert.ok(result !== null, 'should be non-null');
    assert.ok(result!.endsWith(join('templates', 'voice')), `expected path ending in templates/voice, got: ${result}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('dataDirOf returns path ending in data for a created book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-slug-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const m = await svc.create({ title: 'MyBook', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: [] });
    const result = svc.dataDirOf(m.slug);
    assert.ok(result !== null, 'should be non-null');
    assert.ok(result!.endsWith('data'), `expected path ending in data, got: ${result}`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('all five ...Of accessors return null for null slug', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-slug-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    assert.equal(svc.authorDirOf(null), null, 'authorDirOf(null)');
    assert.equal(svc.voiceDirOf(null), null, 'voiceDirOf(null)');
    assert.equal(svc.dataDirOf(null), null, 'dataDirOf(null)');
    assert.equal(svc.pipelineOf(null), null, 'pipelineOf(null)');
    assert.equal(svc.genreGuideOf(null), null, 'genreGuideOf(null)');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('all five ...Of accessors return null for a non-existent slug', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-slug-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    assert.equal(svc.authorDirOf('no-such-book'), null, 'authorDirOf(no-such-book)');
    assert.equal(svc.voiceDirOf('no-such-book'), null, 'voiceDirOf(no-such-book)');
    assert.equal(svc.dataDirOf('no-such-book'), null, 'dataDirOf(no-such-book)');
    assert.equal(svc.pipelineOf('no-such-book'), null, 'pipelineOf(no-such-book)');
    assert.equal(svc.genreGuideOf('no-such-book'), null, 'genreGuideOf(no-such-book)');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('genreGuideOf composes two genre files in canonical order with headers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-slug-'));
  try {
    const lib = seedLibrary(root, true); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const m = await svc.create({ title: 'GenreBook', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: [] });
    // NOT activating the book
    const guide = svc.genreGuideOf(m.slug);
    assert.ok(guide !== null, 'guide should be non-null for a book with genre files');
    assert.ok(guide!.includes('## Genre Guide — Tropes'), 'should have Tropes header');
    assert.ok(guide!.includes('## Genre Guide — Themes'), 'should have Themes header');
    assert.ok(guide!.includes('TROPES-BODY'), 'should include tropes body');
    assert.ok(guide!.includes('THEMES-BODY'), 'should include themes body');
    // Canonical order: tropes before themes
    assert.ok(guide!.indexOf('Tropes') < guide!.indexOf('Themes'), 'tropes before themes in canonical order');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('genreGuideOf returns null for a genre-less book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-slug-'));
  try {
    const lib = seedLibrary(root, false); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const m = await svc.create({ title: 'NoGenreBook', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(svc.genreGuideOf(m.slug), null, 'genre-less book → null');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pipelineOf returns parsed pipeline for a created book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-slug-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const m = await svc.create({ title: 'PipeBook', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const pipeline = svc.pipelineOf(m.slug);
    assert.ok(pipeline !== null, 'pipeline should be non-null');
    assert.equal(pipeline!.name, 'novel-pipeline', 'pipeline name matches');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
