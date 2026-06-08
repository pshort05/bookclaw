/**
 * Unit tests for library description sidecars (book-container Phase 6e):
 * author/voice/genre use <dir>/meta.json; section uses <name>.meta.json.
 * Overlay shadows builtin; writeEntry persists the sidecar to the overlay.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

const fakeSkills = {
  getSkillCatalog: () => [{ name: 'write', description: 'w', category: 'author', triggers: ['write'], premium: false, source: 'builtin' }],
  getSkillByName: (n: string) => (n === 'write' ? { name: 'write', description: 'w', category: 'author', triggers: ['write'], permissions: [], content: '# write', source: 'builtin' } : undefined),
} as never;

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'default soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice style');
  write(builtin, 'genres/romantasy/tropes.md', 'romantasy tropes');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  write(builtin, 'sections/front-matter.md', 'FRONT');
  write(builtin, 'sections/back-matter.md', 'BACK');
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

test('library reads description from an author meta.json sidecar', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libdesc-'));
  try {
    const lib = seedLibrary(root);
    // add a sidecar next to the builtin author dir
    write(join(root, 'library'), 'authors/default/meta.json', JSON.stringify({ description: 'A warm romantasy pen-name.' }));
    await lib.loadAll();
    const entry = lib.list('author').find((e) => e.name === 'default');
    assert.equal(entry?.description, 'A warm romantasy pen-name.');
    const full = lib.get('author', 'default');
    assert.equal(full?.description, 'A warm romantasy pen-name.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('library section reads description from <name>.meta.json sidecar', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libdesc-'));
  try {
    const lib = seedLibrary(root);
    write(join(root, 'library'), 'sections/front-matter.meta.json', JSON.stringify({ description: 'Title page + copyright.' }));
    await lib.loadAll();
    assert.equal(lib.list('section').find((e) => e.name === 'front-matter')?.description, 'Title page + copyright.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeEntry persists a description sidecar to the overlay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libdesc-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    await lib.writeEntry('genre', 'romantasy', { description: 'Dragons + slow-burn romance.' });
    await lib.reload();
    assert.equal(lib.list('genre').find((e) => e.name === 'romantasy')?.description, 'Dragons + slow-burn romance.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Fix 1: description-only writeEntry must not create a files-less overlay shadow.
test('writeEntry description-only for builtin author preserves .md files in overlay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libdesc-'));
  try {
    const lib = seedLibrary(root);
    await lib.loadAll();
    // Description-only write to a builtin-only entry (no files supplied).
    await lib.writeEntry('author', 'default', { description: 'x' });
    await lib.reload();
    const full = lib.get('author', 'default');
    // Must carry the builtin's files through into the overlay copy.
    assert.equal(full?.files?.['SOUL.md'], 'default soul', 'SOUL.md must survive description-only write');
    assert.equal(full?.description, 'x', 'description must be set');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Route contract guard: createEntry must persist description alongside files.
test('createEntry persists description alongside files (route contract)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libdesc-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    await lib.createEntry('voice', 'breezy', { files: { 'STYLE-GUIDE.md': 'breezy' }, description: 'Light and fast.' });
    await lib.reload();
    assert.equal(lib.list('voice').find((e) => e.name === 'breezy')?.description, 'Light and fast.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Fix 2: description resolution falls back overlay→builtin.
test('loadKind inherits builtin description when workspace overlay has no meta.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libdesc-'));
  try {
    const builtin = join(root, 'library');
    // Builtin romantasy WITH a description sidecar.
    write(builtin, 'genres/romantasy/tropes.md', 'romantasy tropes');
    write(builtin, 'genres/romantasy/meta.json', JSON.stringify({ description: 'B' }));
    const workspace = join(root, 'workspace', 'library');
    // Workspace overlay has a tropes.md but NO meta.json.
    write(workspace, 'genres/romantasy/tropes.md', 'overlay tropes');
    const lib = new LibraryService(builtin, workspace, fakeSkills);
    await lib.loadAll();
    const entry = lib.list('genre').find((e) => e.name === 'romantasy');
    assert.equal(entry?.description, 'B', 'description must fall back to builtin when overlay has none');
    const full = lib.get('genre', 'romantasy');
    assert.equal(full?.files?.['tropes.md'], 'overlay tropes', 'overlay file content must be used');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
