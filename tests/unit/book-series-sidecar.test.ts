/**
 * Unit test for Bug L12: applySeriesAssets (series pull) rm's templates/<kind>
 * including the description meta.json sidecar and only rewrites the .md files,
 * silently dropping the author/voice/genre description. The fix restores the
 * sidecar from the library entry after the rewrite.
 * Run via: node --import tsx --test tests/unit/book-series-sidecar.test.ts
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

test('applySeriesAssets preserves the author description sidecar', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-ss-'));
  try {
    const b = join(root, 'library');
    write(b, 'authors/default/SOUL.md', 'soul v1\n');
    write(b, 'authors/default/meta.json', JSON.stringify({ description: 'The house author voice' }));
    write(b, 'voices/default/STYLE-GUIDE.md', 'style v1');
    write(b, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
    const lib = new LibraryService(b, join(root, 'workspace', 'library'), fakeSkills);
    await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.initialize();

    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    // Sanity: create() persisted the description sidecar.
    assert.equal(svc.readTemplate(book.slug, 'author')?.description, 'The house author voice');

    // Series pull re-snapshots the author asset.
    await svc.applySeriesAssets(book.slug, { author: { name: 'default', source: 'builtin' } });

    // The description sidecar must survive the re-snapshot.
    assert.equal(svc.readTemplate(book.slug, 'author')?.description, 'The house author voice');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
