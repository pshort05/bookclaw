import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;
function write(base: string, rel: string, body: string): void {
  const p = join(base, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body, 'utf-8');
}
function newLib(root: string) {
  return new LibraryService(join(root, 'library'), join(root, 'workspace', 'library'), fakeSkills);
}

test('author meta.json role models are parsed into the entry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'librm-'));
  try {
    write(join(root, 'library'), 'authors/modeled/SOUL.md', 'soul');
    write(join(root, 'library'), 'authors/modeled/meta.json', JSON.stringify({
      description: 'A test author',
      sceneBriefModel: { provider: 'openrouter', model: 'auto:newest-sonnet' },
      draftModel: { provider: 'openrouter', model: 'auto:newest-opus' },
    }));
    const lib = newLib(root); await lib.loadAll();
    const e = lib.get('author', 'modeled');
    assert.deepEqual(e?.sceneBriefModel, { provider: 'openrouter', model: 'auto:newest-sonnet' });
    assert.deepEqual(e?.draftModel, { provider: 'openrouter', model: 'auto:newest-opus' });
    assert.equal(e?.description, 'A test author');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeEntry merges a role model into meta.json without dropping description', async () => {
  const root = mkdtempSync(join(tmpdir(), 'librm-'));
  try {
    write(join(root, 'library'), 'authors/modeled/SOUL.md', 'soul');
    write(join(root, 'library'), 'authors/modeled/meta.json', JSON.stringify({ description: 'orig' }));
    const lib = newLib(root); await lib.loadAll();
    await lib.writeEntry('author', 'modeled', { draftModel: { provider: 'openrouter', model: 'auto:newest-opus' } });
    await lib.loadAll();
    const e = lib.get('author', 'modeled');
    assert.deepEqual(e?.draftModel, { provider: 'openrouter', model: 'auto:newest-opus' });
    assert.equal(e?.description, 'orig');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeEntry with empty provider clears a role model on an overlay author but keeps description', async () => {
  const root = mkdtempSync(join(tmpdir(), 'librm-'));
  try {
    // A workspace-overlay author (the real place named personas live): the overlay
    // meta.json is the same file writeEntry edits, so clearing truly removes it.
    write(join(root, 'workspace', 'library'), 'authors/modeled/SOUL.md', 'soul');
    write(join(root, 'workspace', 'library'), 'authors/modeled/meta.json', JSON.stringify({ description: 'orig', draftModel: { provider: 'openrouter', model: 'auto:newest-opus' } }));
    const lib = newLib(root); await lib.loadAll();
    assert.equal(lib.get('author', 'modeled')?.draftModel?.model, 'auto:newest-opus');
    await lib.writeEntry('author', 'modeled', { draftModel: { provider: '' } });
    await lib.loadAll();
    const e = lib.get('author', 'modeled');
    assert.equal(e?.draftModel, undefined);
    assert.equal(e?.description, 'orig');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a malformed role model in meta.json is dropped fail-soft', async () => {
  const root = mkdtempSync(join(tmpdir(), 'librm-'));
  try {
    write(join(root, 'library'), 'authors/modeled/SOUL.md', 'soul');
    write(join(root, 'library'), 'authors/modeled/meta.json', JSON.stringify({ draftModel: { model: 'x' } }));
    const lib = newLib(root); await lib.loadAll();
    assert.equal(lib.get('author', 'modeled')?.draftModel, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
