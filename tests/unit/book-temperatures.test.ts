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
  return { books };
}

test('setTemperatures sets and clears the manifest field', async () => {
  const root = mkdtempSync(join(tmpdir(), 'booktemp-'));
  try {
    const { books } = await setup(root);
    const created = await books.create({ title: 'Temp Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const slug = created.slug;
    let m = await books.setTemperatures(slug, { creative: 0.9, surgical: 0.25 });
    assert.deepEqual(m.temperatures, { creative: 0.9, surgical: 0.25 });
    // partial (only creative)
    m = await books.setTemperatures(slug, { creative: 0.75 });
    assert.deepEqual(m.temperatures, { creative: 0.75 });
    // clear
    m = await books.setTemperatures(slug, {});
    assert.equal(m.temperatures, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
