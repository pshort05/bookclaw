/**
 * Unit tests for the library overlay write path (book-container Phase 4):
 * writeEntry / createEntry / deleteOverlayEntry against the workspace overlay,
 * with built-ins read-only and delete-reverts-to-builtin. Network-free.
 * Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;
function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}
async function makeLib(root: string): Promise<LibraryService> {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'builtin soul');
  write(builtin, 'genres/romantasy/tropes.md', 'builtin tropes');
  const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  return lib;
}

test('writeEntry overlays a built-in (source flips to workspace)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    assert.equal(lib.get('author', 'default')!.source, 'builtin');
    await lib.writeEntry('author', 'default', { files: { 'SOUL.md': 'edited soul' } });
    await lib.reload();
    const e = lib.get('author', 'default')!;
    assert.equal(e.source, 'workspace');
    assert.equal(e.files!['SOUL.md'], 'edited soul');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('deleteOverlayEntry reverts to the built-in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    await lib.writeEntry('genre', 'romantasy', { files: { 'tropes.md': 'edited' } });
    await lib.reload();
    assert.equal(lib.get('genre', 'romantasy')!.source, 'workspace');
    const removed = await lib.deleteOverlayEntry('genre', 'romantasy');
    assert.equal(removed, true);
    await lib.reload();
    const e = lib.get('genre', 'romantasy')!;
    assert.equal(e.source, 'builtin');
    assert.equal(e.files!['tropes.md'], 'builtin tropes');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('deleteOverlayEntry returns false for a builtin-only entry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    const removed = await lib.deleteOverlayEntry('author', 'default');
    assert.equal(removed, false); // nothing in the overlay to delete
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('createEntry rejects a name that exists as a built-in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    await assert.rejects(() => lib.createEntry('author', 'default', { files: { 'SOUL.md': 'x' } }), /already exists/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('editing one file of a built-in multi-file author preserves siblings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const builtin = join(root, 'library');
    write(builtin, 'authors/multi/SOUL.md', 'soul orig');
    write(builtin, 'authors/multi/PERSONALITY.md', 'persona orig');
    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
    await lib.loadAll();
    // edit ONLY SOUL.md
    await lib.writeEntry('author', 'multi', { files: { 'SOUL.md': 'soul EDITED' } });
    await lib.reload();
    const e = lib.get('author', 'multi')!;
    assert.equal(e.source, 'workspace');
    assert.equal(e.files!['SOUL.md'], 'soul EDITED');
    assert.equal(e.files!['PERSONALITY.md'], 'persona orig'); // sibling preserved
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('createEntry writes a section and a pipeline; bad JSON rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    await lib.createEntry('section', 'epilogue', { content: '# Epilogue' });
    await lib.reload();
    assert.equal(lib.get('section', 'epilogue')!.content, '# Epilogue');

    await lib.createEntry('pipeline', 'mini', { content: JSON.stringify({ schemaVersion: 1, name: 'mini', label: 'Mini', description: 'd', steps: [] }) });
    await lib.reload();
    assert.equal(lib.get('pipeline', 'mini')!.pipeline!.name, 'mini');

    await assert.rejects(() => lib.createEntry('pipeline', 'broken', { content: '{ not json' }));
    await assert.rejects(() => lib.createEntry('pipeline', 'noSteps', { content: '{"schemaVersion":1}' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
