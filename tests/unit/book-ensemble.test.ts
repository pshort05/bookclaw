/**
 * Ideation Ensemble manifest field (Flagship Plan 8, Task 3): `ensemble` on
 * the book manifest, threaded through BookService.create() the same way
 * costBudget/uncensoredProvider are (plain per-book override, no author
 * inheritance — mirrors tests/unit/book-review-cadence.test.ts's setup).
 *
 * Run: node --import tsx --test tests/unit/book-ensemble.test.ts
 */
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
  return { books, lib };
}

test('a plain book has no ensemble block (off by default)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookensemble-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Plain Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(m.ensemble, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an explicit per-book ensemble override is persisted on the manifest', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookensemble-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({
      title: 'Ensemble Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [],
      ensemble: { enabled: true, panel: ['claude', 'gemini'] },
    });
    assert.deepEqual(m.ensemble, { enabled: true, panel: ['claude', 'gemini'] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
