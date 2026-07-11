/**
 * Unit tests for C2 (BOOK-GENERATION-REVIEW-2026-07-10): book.json / pointer-file
 * writes must be crash-safe (temp file + rename in the same dir) and manifest
 * read-modify-write mutators must be serialized per slug so two concurrent
 * mutators (e.g. a pipeline-completion setPhase racing a UI setFormat) can't
 * silently lose one update.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import type { BookFormat } from '../../gateway/src/services/book-types.js';

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
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-atomic-'));
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  const m = await svc.create({ title: 'MyBook', author: 'default', voice: 'default', pipeline: 'novel-pipeline', sections: [] });
  return { root, svc, slug: m.slug };
}

const FORMAT: BookFormat = { structureId: 'three-act', formId: 'novel', chapterCount: 30, wordsPerChapter: 2500, totalTarget: 75000 };

/** All file names under dir, recursively (relative paths). */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

test('concurrent setPhase + setFormat do not lose either update', async () => {
  const { root, svc, slug } = await makeBook();
  try {
    await Promise.all([
      svc.setPhase(slug, 'production'),
      svc.setFormat(slug, FORMAT),
    ]);
    const opened = await svc.open(slug);
    assert.ok(opened, 'book must still open after concurrent writes');
    assert.equal(opened.manifest.phase, 'production', 'setPhase update must survive the concurrent setFormat');
    assert.equal(opened.manifest.format?.formId, 'novel', 'setFormat update must survive the concurrent setPhase');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('concurrent setConsistencyModel + setAppendix do not lose either update', async () => {
  const { root, svc, slug } = await makeBook();
  try {
    await Promise.all([
      svc.setConsistencyModel(slug, { provider: 'ollama', model: 'm1' }),
      svc.setAppendix(slug, [{ docId: 'atlas', order: 1 }]),
    ]);
    const opened = await svc.open(slug);
    assert.ok(opened, 'book must still open after concurrent writes');
    assert.equal(opened.manifest.consistency?.provider, 'ollama', 'setConsistencyModel update must survive');
    assert.equal(opened.manifest.appendix?.[0]?.docId, 'atlas', 'setAppendix update must survive');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('manifest and pointer writes leave no *.tmp behind and stay parseable', async () => {
  const { root, svc, slug } = await makeBook();
  try {
    await svc.setPhase(slug, 'production');
    await svc.setFormat(slug, FORMAT);
    await svc.setActiveBook(slug);
    await svc.setChannelBook('telegram', slug);
    const workspace = join(root, 'workspace');
    const leftovers = filesUnder(workspace).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, [], 'no temp files may remain after writes');
    // The manifest and both pointer files must parse cleanly.
    const m = JSON.parse(readFileSync(join(workspace, 'books', slug, 'book.json'), 'utf-8'));
    assert.equal(m.phase, 'production');
    const ptr = JSON.parse(readFileSync(join(workspace, '.config', 'active-book.json'), 'utf-8'));
    assert.equal(ptr.slug, slug);
    const ch = JSON.parse(readFileSync(join(workspace, '.config', 'channel-books.json'), 'utf-8'));
    assert.equal(ch.telegram, slug);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
