/**
 * Unit tests for BookService bug fixes:
 *
 *  - BUG M7: allocateSlug must atomically CLAIM its slug (create the dir), so a
 *    second allocation for the same title returns a different slug — matching
 *    claimSlug's behavior rather than handing back an unclaimed candidate.
 *  - BUG L10: deleting the active book must clear the persisted active-book
 *    pointer file before reseeding, so it never references the deleted slug.
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
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice style');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeSvc(root: string): Promise<BookService> {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  return svc;
}

test('BUG M7: allocateSlug claims atomically — a second call for the same title returns a different slug', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bookbug-'));
  try {
    const svc = await makeSvc(root);
    const s1 = svc.allocateSlug('Same Title');
    const s2 = svc.allocateSlug('Same Title');
    assert.notEqual(s1, s2, 'second allocation must not collide with the first');
    // Both slugs are claimed on disk (dir exists).
    assert.ok(existsSync(join(root, 'workspace', 'books', s1)));
    assert.ok(existsSync(join(root, 'workspace', 'books', s2)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('BUG L10: deleting the active book clears the pointer before reseeding (no stale slug on disk)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bookbug-'));
  try {
    const svc = await makeSvc(root);
    const book = await svc.create({ title: 'Doomed', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await svc.setActiveBook(book.slug);
    const ptrPath = join(root, 'workspace', '.config', 'active-book.json');
    assert.equal(JSON.parse(readFileSync(ptrPath, 'utf-8')).slug, book.slug);

    await svc.delete(book.slug);

    // The pointer must never reference the deleted slug. seedDefaultBook seeds a
    // fresh Default Book and rewrites the pointer to it; the key invariant is the
    // pointer is not the deleted slug.
    if (existsSync(ptrPath)) {
      const ptr = JSON.parse(readFileSync(ptrPath, 'utf-8'));
      assert.notEqual(ptr.slug, book.slug, 'pointer must not reference the deleted book');
    }
    assert.notEqual(svc.getActiveBook(), book.slug);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
