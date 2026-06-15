/**
 * Unit tests for EditorService: list/get delegation to the library, per-channel
 * active-editor pointers (set/get/clear), persistence to
 * .config/channel-editors.json, restore across a fresh instance, and stale-prune
 * on init when a pointer references a now-unknown editor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
    assert.deepEqual(svc.list(), [{ name: 'maeve', label: undefined, description: 'd' }]);
    assert.equal(svc.get('maeve')?.systemPrompt, 'p');
    assert.equal(svc.get('nope'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('set/get/clear channel editor pointers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-edsvc-'));
  try {
    const svc = new EditorService(join(root, 'workspace'), stubLibrary);
    await svc.initialize();
    await svc.setChannelEditor('web', 'maeve', true);
    assert.deepEqual(svc.getChannelEditor('web'), { editor: 'maeve', withBook: true });
    await svc.clearChannelEditor('web');
    assert.equal(svc.getChannelEditor('web'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a pointer persists across a fresh instance over the same dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-edsvc-'));
  try {
    const svc = new EditorService(join(root, 'workspace'), stubLibrary);
    await svc.initialize();
    await svc.setChannelEditor('web', 'maeve', true);
    const svc2 = new EditorService(join(root, 'workspace'), stubLibrary);
    await svc2.initialize();
    assert.deepEqual(svc2.getChannelEditor('web'), { editor: 'maeve', withBook: true });
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
