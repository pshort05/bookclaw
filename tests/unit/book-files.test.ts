/**
 * Unit tests for BookService.listFiles() — lists a book's data/ output files.
 * Phase 6 follow-up backing GET /api/books/:slug/files, so the Write OutlinePane
 * and the Chat "what you've made" list can show a book's prior outputs without a
 * bound project (Phase 8 will bind projects to books).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
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

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'default soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice style');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

test('listFiles returns [] for a fresh book (empty data/)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bookfiles-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.deepEqual(svc.listFiles('b'), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('listFiles lists real top-level files newest-first, skipping dotfiles and subdirs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bookfiles-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const dataDir = join(root, 'workspace', 'books', 'b', 'data');
    writeFileSync(join(dataDir, 'older.md'), 'hello');           // 5 bytes
    writeFileSync(join(dataDir, 'newer.md'), 'manuscript text'); // 15 bytes
    writeFileSync(join(dataDir, '.hidden'), 'x');                // dotfile → skipped
    mkdirSync(join(dataDir, 'sub'));                             // subdir → skipped
    // Force deterministic mtimes so the newest-first ordering is testable.
    utimesSync(join(dataDir, 'older.md'), new Date(1000), new Date(1000));
    utimesSync(join(dataDir, 'newer.md'), new Date(2000), new Date(2000));

    const files = svc.listFiles('b');
    assert.ok(files, 'files is not null');
    assert.deepEqual(files!.map(f => f.name), ['newer.md', 'older.md']);
    assert.equal(files![0].bytes, 15);
    assert.equal(files![1].bytes, 5);
    assert.ok(typeof files![0].modified === 'string' && files![0].modified.length > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('listFiles returns null for an invalid slug or a missing book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bookfiles-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    assert.equal(svc.listFiles('../etc'), null);   // invalid slug (path traversal)
    assert.equal(svc.listFiles('no-such-book'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
