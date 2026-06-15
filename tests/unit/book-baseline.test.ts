/**
 * Unit tests for the pristine .baseline/ mirror captured at book create time
 * (book-container Phase 4, enables 3-way re-pull). Network-free; temp dirs.
 * Run via: npm run test:unit
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
  write(builtin, 'authors/default/PERSONALITY.md', 'default personality');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'voices/default/VOICE-PROFILE.md', 'default voice');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeSvc(root: string): Promise<BookService> {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  return svc;
}

test('create() captures a .baseline mirror of templates/', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-baseline-'));
  try {
    const svc = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const bookDir = join(root, 'workspace', 'books', book.slug);
    assert.ok(existsSync(join(bookDir, '.baseline', 'author', 'SOUL.md')));
    assert.ok(existsSync(join(bookDir, '.baseline', 'voice', 'STYLE-GUIDE.md')));
    assert.ok(existsSync(join(bookDir, '.baseline', 'pipeline', 'novel-pipeline.json'))); // v2 per-name layout
    assert.equal(
      readFileSync(join(bookDir, '.baseline', 'author', 'SOUL.md'), 'utf-8'),
      readFileSync(join(bookDir, 'templates', 'author', 'SOUL.md'), 'utf-8'),
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('baselineDir()/templatesDir() resolve under the active book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-baseline-'));
  try {
    const svc = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(svc.templatesDir(book.slug), join(root, 'workspace', 'books', book.slug, 'templates'));
    assert.equal(svc.baselineDir(book.slug), join(root, 'workspace', 'books', book.slug, '.baseline'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
