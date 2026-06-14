/**
 * Series Phase B — book-side world-building: create-time snapshot, worldbuildingOf
 * composition, and applySeriesAssets re-snapshot.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

function w(base: string, rel: string, body: string): void {
  const p = join(base, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body, 'utf-8');
}
const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bwb-'));
  const builtin = join(root, 'library');
  w(builtin, 'authors/default/SOUL.md', 'soul');
  w(builtin, 'authors/default/STYLE-GUIDE.md', 'style');
  w(builtin, 'voices/default/STYLE-GUIDE.md', 'voice');
  w(builtin, 'genres/romantasy/tropes.md', 'tropes');
  w(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  const booksDir = join(root, 'workspace', 'books');
  return { root, svc, booksDir };
}
const base = { author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: [] as string[] };

test('create snapshots worldbuilding into templates + baseline (non-empty only)', async () => {
  const { root, svc, booksDir } = await setup();
  try {
    const m = await svc.create({ ...base, title: 'WB One', worldbuilding: { characters: 'Captain Vane', lore: 'The Drowned God' } });
    const dir = join(booksDir, m.slug);
    assert.equal(readFileSync(join(dir, 'templates', 'worldbuilding', 'characters.md'), 'utf-8'), 'Captain Vane');
    assert.equal(readFileSync(join(dir, 'templates', 'worldbuilding', 'lore.md'), 'utf-8'), 'The Drowned God');
    assert.ok(!existsSync(join(dir, 'templates', 'worldbuilding', 'places.md')), 'empty key not written');
    assert.equal(readFileSync(join(dir, '.baseline', 'worldbuilding', 'characters.md'), 'utf-8'), 'Captain Vane');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('worldbuildingOf composes ordered headers (characters before lore); null when none', async () => {
  const { root, svc } = await setup();
  try {
    const m = await svc.create({ ...base, title: 'WB Two', worldbuilding: { characters: 'Captain Vane', lore: 'The Drowned God' } });
    const out = svc.worldbuildingOf(m.slug)!;
    assert.match(out, /## World-Building — Characters\n\nCaptain Vane/);
    assert.match(out, /## World-Building — Lore\n\nThe Drowned God/);
    assert.ok(out.indexOf('Characters') < out.indexOf('Lore'), 'characters before lore');

    const m2 = await svc.create({ ...base, title: 'No WB' });
    assert.equal(svc.worldbuildingOf(m2.slug), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('applySeriesAssets re-snapshots worldbuilding (rm+rewrite templates + baseline)', async () => {
  const { root, svc, booksDir } = await setup();
  try {
    const m = await svc.create({ ...base, title: 'WB Three', worldbuilding: { characters: 'A', places: 'P', lore: 'L' } });
    await svc.applySeriesAssets(m.slug, {}, { characters: 'B' });
    const dir = join(booksDir, m.slug);
    assert.equal(readFileSync(join(dir, 'templates', 'worldbuilding', 'characters.md'), 'utf-8'), 'B');
    assert.ok(!existsSync(join(dir, 'templates', 'worldbuilding', 'places.md')), 'stale places removed');
    assert.ok(!existsSync(join(dir, 'templates', 'worldbuilding', 'lore.md')), 'stale lore removed');
    assert.equal(readFileSync(join(dir, '.baseline', 'worldbuilding', 'characters.md'), 'utf-8'), 'B');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
