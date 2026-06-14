/**
 * Series Phase A — book provenance (pulledFrom.series) + applySeriesAssets
 * (the "pull series assets into book" overwrite).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

function w(base: string, rel: string, body: string): void {
  const p = join(base, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body, 'utf-8');
}
const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-series-book-'));
  const builtin = join(root, 'library');
  w(builtin, 'authors/default/SOUL.md', 'DEFAULT SOUL');
  w(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
  w(builtin, 'authors/alt/SOUL.md', 'ALT SOUL');
  w(builtin, 'authors/alt/STYLE-GUIDE.md', 'alt style');
  w(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice');
  w(builtin, 'genres/romantasy/tropes.md', 'ROMANTASY TROPES');
  w(builtin, 'genres/mystery/tropes.md', 'MYSTERY TROPES');
  w(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  return { root, svc };
}

test('create records pulledFrom.series provenance', async () => {
  const { root, svc } = await setup();
  try {
    const m = await svc.create({ title: 'Book One', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: [], series: { id: 'series-x', title: 'The Saga' } });
    assert.deepEqual(m.pulledFrom.series, { id: 'series-x', title: 'The Saga' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('applySeriesAssets re-snapshots author+genre and updates the manifest refs', async () => {
  const { root, svc } = await setup();
  try {
    const created = await svc.create({ title: 'Book Two', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: [] });
    const slug = created.slug;
    await svc.applySeriesAssets(slug, { author: { name: 'alt', source: 'builtin' }, genre: { name: 'mystery', source: 'builtin' } });

    const opened = await svc.open(slug);
    assert.equal(opened?.manifest.pulledFrom.author.name, 'alt');
    assert.equal(opened?.manifest.pulledFrom.genre?.name, 'mystery');
    assert.equal(opened?.manifest.pulledFrom.voice?.name, 'default', 'untouched kinds unchanged');

    const dir = join(root, 'workspace', 'books', slug);
    assert.equal(readFileSync(join(dir, 'templates', 'author', 'SOUL.md'), 'utf-8'), 'ALT SOUL');
    assert.equal(readFileSync(join(dir, 'templates', 'genre', 'tropes.md'), 'utf-8'), 'MYSTERY TROPES');
    // baseline advanced too (so a later library re-pull diffs against the new asset)
    assert.equal(readFileSync(join(dir, '.baseline', 'author', 'SOUL.md'), 'utf-8'), 'ALT SOUL');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
