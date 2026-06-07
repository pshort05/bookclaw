/**
 * Unit tests for per-asset re-pull (book-container Phase 4): status
 * classification + 3-way merge / whole-asset pipeline / no-baseline fallback.
 * Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;
function write(base: string, rel: string, body: string): void {
  const p = join(base, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body, 'utf-8');
}
function seedLibrary(root: string): LibraryService {
  const b = join(root, 'library');
  write(b, 'authors/default/SOUL.md', 'soul v1\nline2\nline3\n');
  write(b, 'voices/default/STYLE-GUIDE.md', 'style v1');
  write(b, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  return new LibraryService(b, join(root, 'workspace', 'library'), fakeSkills);
}
async function makeSvc(root: string): Promise<{ svc: BookService; lib: LibraryService; builtin: string }> {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  return { svc, lib, builtin: join(root, 'library') };
}

test('repullStatus reports in-sync right after create', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-rp-'));
  try {
    const { svc } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const status = await svc.repullStatus(book.slug);
    const author = status.find(a => a.kind === 'author');
    assert.equal(author!.status, 'in-sync');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('library-updated asset re-pulls cleanly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-rp-'));
  try {
    const { svc, builtin, lib } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    write(builtin, 'authors/default/SOUL.md', 'soul v1\nline2 CHANGED\nline3\n');
    await lib.reload();
    const status = await svc.repullStatus(book.slug);
    assert.equal(status.find(a => a.kind === 'author')!.status, 'library-updated');
    const r = await svc.repull(book.slug, 'author', 'default', {});
    assert.equal(r.hadConflicts, false);
    const merged = readFileSync(join(root, 'workspace', 'books', book.slug, 'templates', 'author', 'SOUL.md'), 'utf-8');
    assert.ok(merged.includes('line2 CHANGED'));
    const baseline = readFileSync(join(root, 'workspace', 'books', book.slug, '.baseline', 'author', 'SOUL.md'), 'utf-8');
    assert.ok(baseline.includes('line2 CHANGED'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('diverged asset with overlapping edits produces conflict markers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-rp-'));
  try {
    const { svc, builtin, lib } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const tdir = join(root, 'workspace', 'books', book.slug, 'templates', 'author', 'SOUL.md');
    writeFileSync(tdir, 'soul v1\nBOOK EDIT\nline3\n', 'utf-8');
    write(builtin, 'authors/default/SOUL.md', 'soul v1\nLIB EDIT\nline3\n');
    await lib.reload();
    assert.equal((await svc.repullStatus(book.slug)).find(a => a.kind === 'author')!.status, 'diverged');
    const r = await svc.repull(book.slug, 'author', 'default', {});
    assert.equal(r.hadConflicts, true);
    assert.ok(readFileSync(tdir, 'utf-8').includes('<<<<<<< book'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no-baseline book falls back to take-library and creates a baseline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-rp-'));
  try {
    const { svc } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    rmSync(join(root, 'workspace', 'books', book.slug, '.baseline'), { recursive: true, force: true });
    assert.equal((await svc.repullStatus(book.slug)).find(a => a.kind === 'author')!.status, 'no-baseline');
    const r = await svc.repull(book.slug, 'author', 'default', { resolution: 'take-library' });
    assert.equal(r.hadConflicts, false);
    assert.ok(existsSync(join(root, 'workspace', 'books', book.slug, '.baseline', 'author', 'SOUL.md')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pipeline take-library rewrites templates + advances baseline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-rp-'));
  try {
    const { svc, builtin, lib } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    // library pipeline gains a step
    write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd2', dynamic: true, steps: [{ label: 'Draft', taskType: 'creative_writing', promptTemplate: 'go' }] }));
    await lib.reload();
    assert.equal((await svc.repullStatus(book.slug)).find(a => a.kind === 'pipeline')!.status, 'library-updated');
    const r = await svc.repull(book.slug, 'pipeline', 'novel-pipeline', { resolution: 'take-library' });
    assert.equal(r.hadConflicts, false);
    const tpl = JSON.parse(readFileSync(join(root, 'workspace', 'books', book.slug, 'templates', 'pipeline.json'), 'utf-8'));
    assert.equal(tpl.steps.length, 1);
    // baseline advanced → now in-sync
    assert.equal((await svc.repullStatus(book.slug)).find(a => a.kind === 'pipeline')!.status, 'in-sync');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
