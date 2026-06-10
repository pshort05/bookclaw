/**
 * Unit tests for BookService.getActiveGenreGuide() (Phase 7 genre wiring):
 * composes the active book's templates/genre/*.md into a single, ordered,
 * header-delimited string injected into generation prompts.
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
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  if (withGenre) {
    write(builtin, 'genres/romantasy/reader-expectations.md', 'EXPECT-BODY');
    write(builtin, 'genres/romantasy/tropes.md', 'TROPES-BODY');
    write(builtin, 'genres/romantasy/themes.md', 'THEMES-BODY');
    write(builtin, 'genres/romantasy/must-haves.md', 'MUSTHAVE-BODY');
  }
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

test('getActiveGenreGuide composes present sections in canonical order with headers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-genre-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.create({ title: 'B', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: [] });
    await svc.setActiveBook('b');

    const guide = svc.getActiveGenreGuide();
    assert.ok(guide, 'guide is not null');
    // Headers present
    assert.ok(guide!.includes('## Genre Guide — Reader Expectations'));
    assert.ok(guide!.includes('## Genre Guide — Tropes'));
    assert.ok(guide!.includes('## Genre Guide — Themes'));
    assert.ok(guide!.includes('## Genre Guide — Must-Haves'));
    // Bodies present
    assert.ok(guide!.includes('EXPECT-BODY') && guide!.includes('TROPES-BODY'));
    // Canonical order: reader-expectations before tropes before themes before must-haves
    const iExp = guide!.indexOf('Reader Expectations');
    const iTrope = guide!.indexOf('Tropes');
    const iTheme = guide!.indexOf('Themes');
    const iMust = guide!.indexOf('Must-Haves');
    assert.ok(iExp < iTrope && iTrope < iTheme && iTheme < iMust, 'sections in canonical order');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('getActiveGenreGuide returns null when there is no active book and when the book is genre-less', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-genre-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    assert.equal(svc.getActiveGenreGuide(), null, 'no active book → null');
    await svc.create({ title: 'NoGenre', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await svc.setActiveBook('nogenre');
    assert.equal(svc.getActiveGenreGuide(), null, 'genre-less active book → null');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('getActiveGenreGuide reads fresh (a genre-file edit is reflected, no stale cache)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-genre-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.create({ title: 'B', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: [] });
    await svc.setActiveBook('b');
    assert.ok(svc.getActiveGenreGuide()!.includes('TROPES-BODY'));
    // Edit the book's snapshot directly, then re-read.
    writeFileSync(join(root, 'workspace', 'books', 'b', 'templates', 'genre', 'tropes.md'), 'TROPES-EDITED', 'utf-8');
    assert.ok(svc.getActiveGenreGuide()!.includes('TROPES-EDITED'), 'edit reflected on next read');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
