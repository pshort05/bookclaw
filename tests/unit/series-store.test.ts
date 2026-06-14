/**
 * Series Phase A — per-series-directory storage + migration of the legacy flat
 * workspace/series.json. (SeriesBibleService evolves into a book-centric container.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SeriesBibleService } from '../../gateway/src/services/series-bible.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'bookclaw-series-'));

test('createSeries writes a per-series dir and round-trips', async () => {
  const root = tmp();
  try {
    const svc = new SeriesBibleService(root);
    await svc.initialize();
    const s = await svc.createSeries({ title: 'Emberglass Saga' });
    assert.ok(existsSync(join(root, 'series', s.id, 'series.json')), 'series.json written under workspace/series/<id>/');
    assert.equal(svc.getSeries(s.id)?.title, 'Emberglass Saga');
    assert.deepEqual(svc.getSeries(s.id)?.bookSlugs, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('initialize migrates the legacy flat series.json into per-series dirs', async () => {
  const root = tmp();
  try {
    writeFileSync(join(root, 'series.json'), JSON.stringify({ series: [{
      id: 'series-legacy-1', title: 'Old', description: 'd',
      projectIds: ['project-1'], readingOrder: ['project-1'],
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }] }));
    const svc = new SeriesBibleService(root);
    await svc.initialize();
    const list = svc.listSeries();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, 'Old');
    assert.deepEqual(list[0].projectIds, ['project-1'], 'legacy projectIds preserved for report back-compat');
    assert.ok(existsSync(join(root, 'series', 'series-legacy-1', 'series.json')));
    assert.ok(existsSync(join(root, 'series.json.migrated')), 'old flat file renamed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('initialize is fail-soft on a corrupt flat series.json', async () => {
  const root = tmp();
  try {
    writeFileSync(join(root, 'series.json'), 'not json{');
    const svc = new SeriesBibleService(root);
    await svc.initialize();
    assert.deepEqual(svc.listSeries(), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
