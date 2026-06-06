/**
 * Unit tests for LibraryService's built-in + workspace overlay, override-by-name,
 * source tagging, reload(), and get() across kinds (book-container Phase 1).
 * Mirrors tests/unit/skill-loader.test.ts. Builds throwaway library trees on disk;
 * skills are exercised via an injected fake (LibraryService delegates skills to
 * SkillLoader, which is covered by its own test).
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

// Minimal stand-in for the parts of SkillLoader that LibraryService calls.
const fakeSkills = {
  getSkillCatalog: () => [{ name: 'write', description: 'w', category: 'author', triggers: ['write'], premium: false, source: 'builtin' }],
  getSkillByName: (n: string) => (n === 'write' ? { name: 'write', description: 'w', category: 'author', triggers: ['write'], permissions: [], content: '# write', source: 'builtin' } : undefined),
} as never;

test('LibraryService overlays workspace over built-in and tags source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-library-'));
  try {
    const builtin = join(root, 'library');
    const workspace = join(root, 'workspace', 'library');
    write(builtin, 'genres/romantasy/tropes.md', 'BUILTIN tropes');
    write(builtin, 'pipelines/book-planning.json', JSON.stringify({ schemaVersion: 1, name: 'book-planning', label: 'BP', description: 'd', steps: [] }));
    write(workspace, 'genres/romantasy/tropes.md', 'WORKSPACE tropes'); // overrides built-in by name
    write(workspace, 'genres/scifi/tropes.md', 'new genre');            // new

    const lib = new LibraryService(builtin, workspace, fakeSkills);
    await lib.loadAll();

    const genres = lib.list('genre');
    const romantasy = genres.find((g) => g.name === 'romantasy');
    assert.equal(romantasy?.source, 'workspace', 'workspace genre should win');
    assert.ok(genres.some((g) => g.name === 'scifi' && g.source === 'workspace'));

    const pipelines = lib.list('pipeline');
    assert.ok(pipelines.some((p) => p.name === 'book-planning' && p.source === 'builtin'));

    // get() returns content; genre files are bundled.
    const got = lib.get('genre', 'romantasy');
    assert.equal(got?.source, 'workspace');
    assert.ok(JSON.stringify(got?.files).includes('WORKSPACE tropes'));

    // Skills delegate to the injected SkillLoader.
    assert.ok(lib.list('skill').some((s) => s.name === 'write'));
    assert.ok(lib.get('skill', 'write')?.content?.includes('# write'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('LibraryService loadKind is per-dir fail-soft: one unreadable dir does not abort others', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-library-'));
  try {
    const builtin = join(root, 'library');
    mkdirSync(builtin, { recursive: true });
    // Make the `authors` path a FILE, not a directory, so readdir() throws
    // ENOTDIR for that kind — a deterministic stand-in for an unreadable dir.
    writeFileSync(join(builtin, 'authors'), 'not a directory', 'utf-8');
    // A valid section in the same library, loaded by a later kind.
    write(builtin, 'sections/front-matter.md', 'FRONT');

    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
    await lib.loadAll(); // must NOT throw despite the broken author dir

    assert.equal(lib.list('author').length, 0, 'broken author dir yields no entries, not a crash');
    assert.ok(lib.get('section', 'front-matter')?.content?.includes('FRONT'),
      'a later kind still loads after an earlier kind failed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('LibraryService reload() re-reads disk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-library-'));
  try {
    const builtin = join(root, 'library');
    write(builtin, 'sections/front-matter.md', 'v1');
    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
    await lib.loadAll();
    assert.ok(lib.get('section', 'front-matter')?.content?.includes('v1'));

    write(builtin, 'sections/front-matter.md', 'v2-edited');
    await lib.reload();
    assert.ok(lib.get('section', 'front-matter')?.content?.includes('v2-edited'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
