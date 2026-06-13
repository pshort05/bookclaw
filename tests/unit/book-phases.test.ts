/**
 * Unit tests for TODO #15 BookService additions: setPhase (the missing
 * post-create writer of book.json `phase`) and phasesForBook (the book's
 * pipeline-derived phase segments for the board).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import { NOVEL_PIPELINE_PHASES } from '../../gateway/src/services/library-types.js';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}
const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'style');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'voice style');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({
    schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [],
  }));
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeBook() {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-phases-'));
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  const m = await svc.create({ title: 'MyBook', author: 'default', voice: 'default', pipeline: 'novel-pipeline', sections: [] });
  return { root, svc, slug: m.slug };
}

test('setPhase writes the phase to book.json so list() reflects it', async () => {
  const { root, svc, slug } = await makeBook();
  try {
    assert.equal(svc.list().find((b) => b.slug === slug)?.phase, 'planning');
    await svc.setPhase(slug, 'production');
    assert.equal(svc.list().find((b) => b.slug === slug)?.phase, 'production');
    const opened = await svc.open(slug);
    assert.equal(opened?.manifest.phase, 'production');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setPhase is a no-op for an unknown book (fail-soft, no throw)', async () => {
  const { root, svc } = await makeBook();
  try {
    await svc.setPhase('does-not-exist', 'production');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('phasesForBook resolves the snapshotted pipeline (novel-pipeline → canonical phases)', async () => {
  const { root, svc, slug } = await makeBook();
  try {
    assert.deepEqual(svc.phasesForBook(slug), [...NOVEL_PIPELINE_PHASES]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('phasesForBook returns [] when no pipeline resolves (frontend falls back to LIFECYCLE_PHASES)', async () => {
  const { root, svc } = await makeBook();
  try {
    assert.deepEqual(svc.phasesForBook('does-not-exist'), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
