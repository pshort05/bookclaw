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

test('setConsistencyModel persists a provider+model selection and clears it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consistency-set-'));
  try {
    const { books } = await setup(root);
    const created = await books.create({ title: 'Consistency Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const slug = created.slug;

    await books.setConsistencyModel(slug, { provider: 'openrouter', model: 'google/gemini-2.5-flash' });
    const afterSet = await books.open(slug);
    assert.deepEqual(afterSet?.manifest.consistency, { provider: 'openrouter', model: 'google/gemini-2.5-flash' });

    await books.setConsistencyModel(slug, {});
    const afterClear = await books.open(slug);
    assert.equal(afterClear?.manifest.consistency, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
