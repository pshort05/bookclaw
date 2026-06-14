/**
 * Series Phase B — series-owned world-building (characters/places/lore.md) store.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SeriesBibleService } from '../../gateway/src/services/series-bible.js';

async function svcWithSeries() {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wb-'));
  const svc = new SeriesBibleService(root);
  await svc.initialize();
  const s = await svc.createSeries({ title: 'Saga' });
  return { root, svc, id: s.id };
}

test('set/get worldbuilding round-trips; unset files read as empty', async () => {
  const { root, svc, id } = await svcWithSeries();
  try {
    await svc.setWorldbuilding(id, { characters: 'Captain Vane', lore: 'The Drowned God' });
    const wb = await svc.getWorldbuilding(id);
    assert.equal(wb.characters, 'Captain Vane');
    assert.equal(wb.lore, 'The Drowned God');
    assert.equal(wb.places, '', 'unset file reads as empty');
    assert.ok(existsSync(join(root, 'series', id, 'worldbuilding', 'characters.md')));
    assert.ok(!existsSync(join(root, 'series', id, 'worldbuilding', 'places.md')), 'unset file not written');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('getWorldbuilding returns all-empty for a series with none', async () => {
  const { root, svc, id } = await svcWithSeries();
  try {
    assert.deepEqual(await svc.getWorldbuilding(id), { characters: '', places: '', lore: '' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setWorldbuilding with an empty/whitespace value clears that file', async () => {
  const { root, svc, id } = await svcWithSeries();
  try {
    await svc.setWorldbuilding(id, { characters: 'A', lore: 'L' });
    await svc.setWorldbuilding(id, { characters: '   ' });   // clear characters
    const wb = await svc.getWorldbuilding(id);
    assert.equal(wb.characters, '', 'cleared');
    assert.equal(wb.lore, 'L', 'untouched');
    assert.ok(!existsSync(join(root, 'series', id, 'worldbuilding', 'characters.md')), 'file removed, not left empty');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setWorldbuilding only touches provided keys (partial update)', async () => {
  const { root, svc, id } = await svcWithSeries();
  try {
    await svc.setWorldbuilding(id, { characters: 'A', places: 'B', lore: 'C' });
    await svc.setWorldbuilding(id, { places: 'B2' });   // only places
    const wb = await svc.getWorldbuilding(id);
    assert.deepEqual(wb, { characters: 'A', places: 'B2', lore: 'C' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
