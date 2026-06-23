/**
 * Characterization tests for MemoryService (Batch D, persistent state).
 *
 * Covers the real logic: active-project / active-persona accessors persisting
 * to disk and surviving a reload, path-segment sanitization (traversal guard),
 * getRelevant() keyword scoring of book-bible files + summary inclusion, the
 * conversation-turn JSONL append with persona/project tagging, and reset().
 * Persistence here is plain writeFile (no debounce), so round-trips are direct.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { MemoryService } from '../../gateway/src/services/memory.js';

function freshMem(): string {
  return mkdtempSync(join(tmpdir(), 'bookclaw-mem-'));
}

test('active-project + active-persona persist to disk and survive a reload', async () => {
  const dir = freshMem();
  try {
    const a = new MemoryService(dir, {});
    await a.initialize();
    await a.setActiveProject('my-novel');
    await a.setActivePersona('jane-doe');
    assert.equal(a.getActiveProjectId(), 'my-novel');
    assert.equal(a.getActivePersonaId(), 'jane-doe');

    const b = new MemoryService(dir, {});
    await b.initialize();
    assert.equal(b.getActiveProjectId(), 'my-novel');
    assert.equal(b.getActivePersonaId(), 'jane-doe');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('setActivePersona(null) clears the persona and persists the empty pointer', async () => {
  const dir = freshMem();
  try {
    const a = new MemoryService(dir, {});
    await a.initialize();
    await a.setActivePersona('temp');
    await a.setActivePersona(null);
    assert.equal(a.getActivePersonaId(), null);

    const b = new MemoryService(dir, {});
    await b.initialize();
    assert.equal(b.getActivePersonaId(), null); // empty file reloads as null
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('setActiveProject sanitizes path traversal before writing', async () => {
  const dir = freshMem();
  try {
    const svc = new MemoryService(dir, {});
    await svc.initialize();
    await svc.setActiveProject('../../etc/passwd');
    const id = svc.getActiveProjectId()!;
    assert.ok(!id.includes('..'), `traversal not stripped: ${id}`);
    assert.ok(!id.includes('/'), `separator not stripped: ${id}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('getRelevant scores book-bible files by query keyword, highest first', async () => {
  const dir = freshMem();
  try {
    const svc = new MemoryService(dir, {});
    await svc.initialize();
    await svc.setActiveProject('book1');
    // Filename match scores +2, content match +1.
    await svc.saveBookBibleEntry('book1', 'dragon-lore.md', 'Ancient creatures of fire.');
    await svc.saveBookBibleEntry('book1', 'castle.md', 'The dragon sleeps beneath the keep.');
    await svc.saveBookBibleEntry('book1', 'weather.md', 'It rains a lot here.');

    const out = await svc.getRelevant('dragon');
    const dragonIdx = out.indexOf('[dragon-lore.md]');
    const castleIdx = out.indexOf('[castle.md]');
    const weatherIdx = out.indexOf('[weather.md]');
    assert.ok(dragonIdx >= 0 && castleIdx >= 0 && weatherIdx >= 0);
    // dragon-lore.md (filename hit, +2) ranks before castle.md (content hit, +1).
    assert.ok(dragonIdx < castleIdx, 'filename match should outrank content match');
    // both keyword hits rank before the non-matching weather.md
    assert.ok(castleIdx < weatherIdx, 'matching files should outrank non-matching');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('getRelevant prepends recent conversation summaries (last 5)', async () => {
  const dir = freshMem();
  try {
    const svc = new MemoryService(dir, {});
    await svc.initialize();
    // Seed summaries.json directly (the only writer is the summarizer pipeline).
    writeFileSync(join(dir, 'summaries.json'),
      JSON.stringify(['s1', 's2', 's3', 's4', 's5', 's6']));
    await svc.initialize(); // reload to pick up summaries
    const out = await svc.getRelevant('anything');
    assert.ok(out.startsWith('Recent context:'));
    assert.ok(out.includes('s6')); // newest kept
    assert.ok(!out.includes('s1')); // only last 5 -> s1 dropped
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('getRelevant returns empty string with no summaries and no active project', async () => {
  const dir = freshMem();
  try {
    const svc = new MemoryService(dir, {});
    await svc.initialize();
    assert.equal(await svc.getRelevant('hello world'), '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('process() appends a JSONL turn tagged with active persona/project', async () => {
  const dir = freshMem();
  try {
    const svc = new MemoryService(dir, {});
    await svc.initialize();
    await svc.setActivePersona('pen-x');
    await svc.setActiveProject('proj-y');
    await svc.process('hi there', 'hello back');

    const today = new Date().toISOString().split('T')[0];
    const logPath = join(dir, 'conversations', `${today}.jsonl`);
    assert.ok(existsSync(logPath));
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.user, 'hi there');
    assert.equal(entry.assistant, 'hello back');
    assert.equal(entry.personaId, 'pen-x');
    assert.equal(entry.projectId, 'proj-y');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('process() context overrides fall back to active pointers when undefined', async () => {
  const dir = freshMem();
  try {
    const svc = new MemoryService(dir, {});
    await svc.initialize();
    await svc.setActivePersona('default-pen');
    // Explicit null persona overrides the active pointer; project omitted -> falls back.
    await svc.process('u', 'a', { personaId: null });
    const today = new Date().toISOString().split('T')[0];
    const logPath = join(dir, 'conversations', `${today}.jsonl`);
    const entry = JSON.parse(readFileSync(logPath, 'utf-8').trim());
    assert.equal(entry.personaId, null);     // explicit null honored
    assert.equal(entry.projectId, null);     // no active project, falls back to null
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reset() clears conversations + summaries + pointers, preserves book-bible by default', async () => {
  const dir = freshMem();
  try {
    const svc = new MemoryService(dir, {});
    await svc.initialize();
    await svc.setActiveProject('book1');
    await svc.setActivePersona('pen');
    await svc.saveBookBibleEntry('book1', 'lore.md', 'kept');
    await svc.process('u', 'a');

    const { cleared } = await svc.reset();
    assert.ok(cleared.includes('conversations'));
    assert.ok(cleared.includes('active-project'));
    assert.ok(cleared.includes('active-persona'));
    assert.equal(svc.getActiveProjectId(), null);
    assert.equal(svc.getActivePersonaId(), null);
    // book-bible preserved (fullReset defaults to false)
    assert.ok(existsSync(join(dir, 'book-bible', 'book1', 'lore.md')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('reset(true) additionally clears book-bible', async () => {
  const dir = freshMem();
  try {
    const svc = new MemoryService(dir, {});
    await svc.initialize();
    await svc.saveBookBibleEntry('book1', 'lore.md', 'gone');
    const { cleared } = await svc.reset(true);
    assert.ok(cleared.includes('book-bible'));
    assert.ok(!existsSync(join(dir, 'book-bible', 'book1', 'lore.md')));
    assert.ok(existsSync(join(dir, 'book-bible'))); // dir recreated empty
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
