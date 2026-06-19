/**
 * Unit tests for EditorService: list/get delegation to the library, per-channel
 * active-editor pointers (set/get/clear), persistence to
 * .config/channel-editors.json, restore across a fresh instance, and stale-prune
 * on init when a pointer references a now-unknown editor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EditorService } from '../../gateway/src/services/editor.ts';

const stubLibrary = {
  get: (k: string, n: string) =>
    k === 'editor' && n === 'maeve' ? { editor: { name: 'maeve', systemPrompt: 'p' } } : undefined,
  list: () => [{ kind: 'editor', name: 'maeve', description: 'd' }],
} as never;

const emptyLibrary = {
  get: () => undefined,
  list: () => [],
} as never;

test('list and get delegate to the library', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-edsvc-'));
  try {
    const svc = new EditorService(join(root, 'workspace'), stubLibrary);
    await svc.initialize();
    assert.deepEqual(svc.list(), [{ name: 'maeve', label: undefined, description: 'd', specialty: undefined }]);
    assert.equal(svc.get('maeve')?.systemPrompt, 'p');
    assert.equal(svc.get('nope'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('set/get/clear channel editor pointers carry the mode', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-edsvc-'));
  try {
    const svc = new EditorService(join(root, 'workspace'), stubLibrary);
    await svc.initialize();
    await svc.setChannelEditor('web', 'maeve', true, 'critique');
    assert.deepEqual(svc.getChannelEditor('web'), { editor: 'maeve', withBook: true, mode: 'critique' });
    await svc.clearChannelEditor('web');
    assert.equal(svc.getChannelEditor('web'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a pointer persists with its mode across a fresh instance over the same dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-edsvc-'));
  try {
    const svc = new EditorService(join(root, 'workspace'), stubLibrary);
    await svc.initialize();
    await svc.setChannelEditor('web', 'maeve', true, 'critique');
    const svc2 = new EditorService(join(root, 'workspace'), stubLibrary);
    await svc2.initialize();
    assert.deepEqual(svc2.getChannelEditor('web'), { editor: 'maeve', withBook: true, mode: 'critique' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ephemeral webchat:* pointers are pruned on init', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-edsvc-'));
  try {
    const cfgDir = join(root, 'workspace', '.config');
    mkdirSync(cfgDir, { recursive: true });
    // A dead per-socket pointer (socket ids never survive a restart) + a stable one.
    writeFileSync(join(cfgDir, 'channel-editors.json'), JSON.stringify({
      'webchat:abc123': { editor: 'maeve', withBook: false, mode: 'brainstorm' },
      'api': { editor: 'maeve', withBook: false, mode: 'critique' },
    }));
    const svc = new EditorService(join(root, 'workspace'), stubLibrary);
    await svc.initialize();
    assert.equal(svc.getChannelEditor('webchat:abc123'), null);
    assert.deepEqual(svc.getChannelEditor('api'), { editor: 'maeve', withBook: false, mode: 'critique' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a legacy pointer without a mode loads as brainstorm', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-edsvc-'));
  try {
    // Write a pre-mode record (the on-disk shape before this feature).
    const cfgDir = join(root, 'workspace', '.config');
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(join(cfgDir, 'channel-editors.json'), JSON.stringify({ web: { editor: 'maeve', withBook: false } }));
    const svc = new EditorService(join(root, 'workspace'), stubLibrary);
    await svc.initialize();
    assert.deepEqual(svc.getChannelEditor('web'), { editor: 'maeve', withBook: false, mode: 'brainstorm' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a pointer to a now-unknown editor is pruned on init', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-edsvc-'));
  try {
    const svc = new EditorService(join(root, 'workspace'), stubLibrary);
    await svc.initialize();
    await svc.setChannelEditor('web', 'maeve', false);
    // Re-open with a library that no longer knows 'maeve' — the pointer must drop.
    const svc2 = new EditorService(join(root, 'workspace'), emptyLibrary);
    await svc2.initialize();
    assert.equal(svc2.getChannelEditor('web'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
