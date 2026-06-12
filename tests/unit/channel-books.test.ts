/**
 * Unit tests for the Phase 10 per-channel active-book override layer on
 * BookService: getChannelBook / resolveBook / setChannelBook / clearChannelBook,
 * persistence to .config/channel-books.json, stale-prune on init, and
 * delete()-cleanup of overrides pointing at a removed book.
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
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeSvcWithTwoBooks(root: string) {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  const a = await svc.create({ title: 'Book A', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
  const b = await svc.create({ title: 'Book B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
  return { lib, svc, a: a.slug, b: b.slug };
}

test('resolveBook falls back to the global active book when no override is set', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { svc, b } = await makeSvcWithTwoBooks(root);
    await svc.setActiveBook(b);
    assert.equal(svc.resolveBook('webchat'), b);
    assert.equal(svc.getChannelBook('webchat'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a channel override is isolated from the global pointer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { svc, a, b } = await makeSvcWithTwoBooks(root);
    await svc.setActiveBook(b);                 // global = B (web default)
    await svc.setChannelBook('telegram:1', a);  // telegram override = A
    assert.equal(svc.resolveBook('telegram:1'), a, 'telegram resolves to its override');
    assert.equal(svc.resolveBook('webchat'), b, 'web still resolves to the global default');
    assert.equal(svc.getChannelBook('telegram:1'), a);
    assert.equal(svc.getChannelBook('webchat'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setChannelBook throws on an unknown slug', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { svc } = await makeSvcWithTwoBooks(root);
    await assert.rejects(() => svc.setChannelBook('telegram:1', 'no-such-book'), /Unknown book/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('overrides persist across a fresh BookService over the same dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { lib, svc, a, b } = await makeSvcWithTwoBooks(root);
    await svc.setActiveBook(b);
    await svc.setChannelBook('telegram:1', a);
    const svc2 = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc2.initialize();
    assert.equal(svc2.getChannelBook('telegram:1'), a, 'override restored after reload');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('clearChannelBook removes the override', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { svc, a } = await makeSvcWithTwoBooks(root);
    await svc.setChannelBook('telegram:1', a);
    await svc.clearChannelBook('telegram:1');
    assert.equal(svc.getChannelBook('telegram:1'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a stale override (book deleted) is pruned on init and on delete()', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { lib, svc, a, b } = await makeSvcWithTwoBooks(root);
    await svc.setActiveBook(b);
    await svc.setChannelBook('telegram:1', a);
    await svc.delete(a);                                   // live override dropped now
    assert.equal(svc.getChannelBook('telegram:1'), null, 'delete() drops the live override');
    // And a reload must not resurrect it.
    const svc2 = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc2.initialize();
    assert.equal(svc2.getChannelBook('telegram:1'), null, 'init prunes a stale override');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('init prunes a malformed/traversal slug and keeps a valid one (code-review hardening)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { lib, a } = await makeSvcWithTwoBooks(root);
    // Hand-write a channel-books.json with one valid entry and one malformed
    // (path-traversal-shaped) slug that must never be loaded into memory.
    write(join(root, 'workspace'), '.config/channel-books.json',
      JSON.stringify({ 'telegram:good': a, 'telegram:evil': '../escaped' }));
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.initialize();
    assert.equal(svc.getChannelBook('telegram:good'), a, 'valid override is loaded');
    assert.equal(svc.getChannelBook('telegram:evil'), null, 'malformed slug is rejected on load');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('init treats a non-object channel-books.json as empty (no crash)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { lib } = await makeSvcWithTwoBooks(root);
    write(join(root, 'workspace'), '.config/channel-books.json', JSON.stringify(['not', 'an', 'object']));
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.initialize();
    assert.equal(svc.getChannelBook('telegram:1'), null, 'array file yields no overrides, no throw');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
