/**
 * Series Phase A — asset refs + book membership + reading order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SeriesBibleService } from '../../gateway/src/services/series-bible.js';

async function svcWithSeries() {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-series-'));
  const svc = new SeriesBibleService(root);
  await svc.initialize();
  const s = await svc.createSeries({ title: 'Saga' });
  return { root, svc, id: s.id };
}

test('setRefs persists the shared library asset refs', async () => {
  const { root, svc, id } = await svcWithSeries();
  try {
    await svc.setRefs(id, { author: { name: 'ada', source: 'builtin' }, genre: { name: 'fantasy', source: 'builtin' } });
    const s = svc.getSeries(id)!;
    assert.equal(s.pulledFrom.author?.name, 'ada');
    assert.equal(s.pulledFrom.genre?.name, 'fantasy');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('addBook is idempotent and tracks reading order; removeBook clears both', async () => {
  const { root, svc, id } = await svcWithSeries();
  try {
    await svc.addBook(id, 'book-a');
    await svc.addBook(id, 'book-a'); // dup ignored
    await svc.addBook(id, 'book-b');
    let s = svc.getSeries(id)!;
    assert.deepEqual(s.bookSlugs, ['book-a', 'book-b']);
    assert.deepEqual(s.readingOrder, ['book-a', 'book-b']);
    await svc.removeBook(id, 'book-a');
    s = svc.getSeries(id)!;
    assert.deepEqual(s.bookSlugs, ['book-b']);
    assert.deepEqual(s.readingOrder, ['book-b']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setReadingOrder keeps only member-book slugs', async () => {
  const { root, svc, id } = await svcWithSeries();
  try {
    await svc.addBook(id, 'book-a');
    await svc.addBook(id, 'book-b');
    await svc.setReadingOrder(id, ['book-b', 'not-a-member', 'book-a']);
    assert.deepEqual(svc.getSeries(id)!.readingOrder, ['book-b', 'book-a']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
