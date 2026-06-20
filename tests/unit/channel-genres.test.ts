/**
 * Unit tests for the per-channel genre selection layer on BookService:
 * getChannelGenre / setChannelGenre / clearChannelGenre, persistence to
 * .config/channel-genres.json, and stale-prune on init (a genre that no longer
 * exists in the library is dropped). Mirrors the channel-books override suite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'default soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice style');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({
    schemaVersion: 1, name: 'novel-pipeline', label: 'Novel',
    description: 'd', dynamic: true, steps: [],
  }));
  // Two genres so resolution + isolation can be exercised.
  write(builtin, 'genres/dark-romance/reader-expectations.md', 'expect the dark');
  write(builtin, 'genres/epic-fantasy/reader-expectations.md', 'expect the epic');
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeSvc(root: string) {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  return { lib, svc };
}

test('getChannelGenre is null when no genre is set', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chgenre-'));
  try {
    const { svc } = await makeSvc(root);
    assert.equal(svc.getChannelGenre('webchat'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setChannelGenre stores the canonical name and is isolated per channel', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chgenre-'));
  try {
    const { svc } = await makeSvc(root);
    await svc.setChannelGenre('telegram:1', 'dark-romance');
    await svc.setChannelGenre('webchat', 'epic-fantasy');
    assert.equal(svc.getChannelGenre('telegram:1'), 'dark-romance');
    assert.equal(svc.getChannelGenre('webchat'), 'epic-fantasy');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setChannelGenre throws on a genre that is not in the library', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chgenre-'));
  try {
    const { svc } = await makeSvc(root);
    await assert.rejects(() => svc.setChannelGenre('telegram:1', 'no-such-genre'), /Unknown genre/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a genre selection persists across a fresh BookService over the same dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chgenre-'));
  try {
    const { lib, svc } = await makeSvc(root);
    await svc.setChannelGenre('telegram:1', 'dark-romance');
    const svc2 = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc2.initialize();
    assert.equal(svc2.getChannelGenre('telegram:1'), 'dark-romance', 'selection restored after reload');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('clearChannelGenre removes the selection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chgenre-'));
  try {
    const { svc } = await makeSvc(root);
    await svc.setChannelGenre('telegram:1', 'dark-romance');
    await svc.clearChannelGenre('telegram:1');
    assert.equal(svc.getChannelGenre('telegram:1'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('init prunes a selection whose genre is no longer in the library', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chgenre-'));
  try {
    const { lib } = await makeSvc(root);
    // Hand-write a file with one valid genre and one that does not exist.
    write(join(root, 'workspace'), '.config/channel-genres.json',
      JSON.stringify({ 'telegram:good': 'dark-romance', 'telegram:gone': 'removed-genre' }));
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.initialize();
    assert.equal(svc.getChannelGenre('telegram:good'), 'dark-romance', 'valid selection kept');
    assert.equal(svc.getChannelGenre('telegram:gone'), null, 'missing genre pruned on load');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('getChannelGenreGuide composes the selected genre guide from the library', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chgenre-'));
  try {
    const { svc } = await makeSvc(root);
    assert.equal(svc.getChannelGenreGuide('webchat'), null, 'no selection → null');
    await svc.setChannelGenre('webchat', 'dark-romance');
    const guide = svc.getChannelGenreGuide('webchat');
    assert.ok(guide, 'guide is composed once a genre is selected');
    assert.ok(guide!.includes('## Genre Guide — Reader Expectations'), 'canonical header present');
    assert.ok(guide!.includes('expect the dark'), 'genre file body present');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('init treats a non-object channel-genres.json as empty (no crash)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chgenre-'));
  try {
    const { lib } = await makeSvc(root);
    write(join(root, 'workspace'), '.config/channel-genres.json', JSON.stringify(['not', 'an', 'object']));
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.initialize();
    assert.equal(svc.getChannelGenre('telegram:1'), null, 'array file yields no selections, no throw');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
