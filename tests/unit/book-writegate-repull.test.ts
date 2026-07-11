/**
 * Regression tests for two verified Medium bugs in BookService (book.ts):
 *
 *   #21 write-gate bypasses:
 *     (a) assertWritable must fail CLOSED when open() returns undefined
 *         (unreadable/corrupt manifest) — previously the `opened &&` short-circuit
 *         treated an unreadable book as writable.
 *     (b) setAppendix must enforce assertWritable like its siblings — previously a
 *         readonly (too-new schemaVersion) book was writable via the appendix route.
 *
 *   #22 re-pull staleness + inert series pipeline pull:
 *     (a) repull must clear the target asset dir so a library-side file DELETION
 *         converges (previously a stale file lingered → repullStatus stuck).
 *     (b) a series pipeline pull must update pipelineSequence (previously it set
 *         only pulledFrom.pipeline → the pulled pipeline never ran).
 *     (c) assetsOf/repullStatus must surface ALL sequence pipelines as repullable
 *         (previously only the first/primary pipeline was).
 *
 * Run: node --import tsx --test tests/unit/book-writegate-repull.test.ts
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

function pipelineJson(name: string): string {
  return JSON.stringify({ schemaVersion: 1, name, label: name, description: 'd', dynamic: true, steps: [] });
}

function seedLibrary(root: string): LibraryService {
  const b = join(root, 'library');
  // Author with TWO files so a library-side deletion is observable (#22a).
  write(b, 'authors/default/SOUL.md', 'soul v1\nline2\nline3\n');
  write(b, 'authors/default/PERSONALITY.md', 'personality v1\n');
  write(b, 'voices/default/STYLE-GUIDE.md', 'style v1\n');
  write(b, 'pipelines/novel-pipeline.json', pipelineJson('novel-pipeline'));
  write(b, 'pipelines/romance-pipeline.json', pipelineJson('romance-pipeline'));
  return new LibraryService(b, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeSvc(root: string): Promise<{ svc: BookService; lib: LibraryService; builtin: string }> {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  return { svc, lib, builtin: join(root, 'library') };
}

function booksPath(root: string, slug: string, ...rest: string[]): string {
  return join(root, 'workspace', 'books', slug, ...rest);
}

// ── #21a — assertWritable fails closed on an unreadable manifest ──────────────
// Exercised via setPhase (calls assertWritable before its own withBookLock).
test('#21a setPhase throws on a corrupt manifest (assertWritable fails closed)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wg-'));
  try {
    const { svc } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    // Corrupt the manifest so open() returns undefined.
    writeFileSync(booksPath(root, book.slug, 'book.json'), '{ not json', 'utf-8');
    await assert.rejects(() => svc.setPhase(book.slug, 'bible'), /refusing to write/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── #21b — setAppendix honors the schemaVersion write gate ────────────────────
test('#21b setAppendix throws on a readonly (too-new) book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wg-'));
  try {
    const { svc } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    // Bump schemaVersion above BOOK_SCHEMA_VERSION → classifyVersion → 'readonly'.
    const mfPath = booksPath(root, book.slug, 'book.json');
    const m = JSON.parse(readFileSync(mfPath, 'utf-8'));
    m.schemaVersion = 999;
    writeFileSync(mfPath, JSON.stringify(m, null, 2) + '\n', 'utf-8');
    await assert.rejects(
      () => svc.setAppendix(book.slug, [{ docId: 'x', order: 0 }]),
      /readonly/i,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('#21b setAppendix still succeeds on a normal writable book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wg-'));
  try {
    const { svc } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const manifest = await svc.setAppendix(book.slug, [{ docId: 'a', order: 1 }, { docId: 'b', order: 0 }]);
    assert.ok(manifest);
    assert.deepEqual(manifest!.appendix!.map((e) => e.docId), ['b', 'a']); // sorted by order
    const onDisk = JSON.parse(readFileSync(booksPath(root, book.slug, 'book.json'), 'utf-8'));
    assert.equal(onDisk.appendix.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── #22a — a library file DELETION converges on re-pull (no stale file) ────────
test('#22a repull removes a library-deleted file and converges to in-sync', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wg-'));
  try {
    const { svc, builtin, lib } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    // Drop the baseline so this takes the whole-asset take-library path.
    rmSync(booksPath(root, book.slug, '.baseline'), { recursive: true, force: true });
    // Library deletes PERSONALITY.md.
    rmSync(join(builtin, 'authors', 'default', 'PERSONALITY.md'), { force: true });
    await lib.reload();
    // Sanity: the book still has the stale file before re-pull.
    assert.ok(existsSync(booksPath(root, book.slug, 'templates', 'author', 'PERSONALITY.md')));
    const r = await svc.repull(book.slug, 'author', 'default', { resolution: 'take-library' });
    assert.equal(r.hadConflicts, false);
    // The stale file must be GONE from templates/ (and .baseline/).
    assert.ok(!existsSync(booksPath(root, book.slug, 'templates', 'author', 'PERSONALITY.md')), 'stale templates file should be removed');
    assert.ok(!existsSync(booksPath(root, book.slug, '.baseline', 'author', 'PERSONALITY.md')), 'stale baseline file should be removed');
    // repullStatus converges (not stuck locally-edited/diverged).
    const status = await svc.repullStatus(book.slug);
    assert.equal(status.find((a) => a.kind === 'author')!.status, 'in-sync');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── #22b — a series pipeline pull updates pipelineSequence (so it runs) ────────
test('#22b applySeriesAssets pipeline updates pipelineSequence, not just pulledFrom', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wg-'));
  try {
    const { svc, lib } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    let m = JSON.parse(readFileSync(booksPath(root, book.slug, 'book.json'), 'utf-8'));
    assert.deepEqual(m.pipelineSequence, ['novel-pipeline']);
    const src = lib.get('pipeline', 'romance-pipeline')!.source;
    await svc.applySeriesAssets(book.slug, { pipeline: { name: 'romance-pipeline', source: src } });
    m = JSON.parse(readFileSync(booksPath(root, book.slug, 'book.json'), 'utf-8'));
    assert.equal(m.pulledFrom.pipeline.name, 'romance-pipeline');
    assert.ok(m.pipelineSequence.includes('romance-pipeline'), 'pulled pipeline must be in pipelineSequence');
    assert.ok(!m.pipelineSequence.includes('novel-pipeline'), 'replaced pipeline should leave the sequence');
    // The pulled pipeline snapshot exists on disk (repullable).
    assert.ok(existsSync(booksPath(root, book.slug, 'templates', 'pipeline', 'romance-pipeline.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── #22c — every sequence pipeline surfaces as a repullable asset ─────────────
test('#22c repullStatus surfaces all sequence pipelines (not just the first)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wg-'));
  try {
    const { svc, lib } = await makeSvc(root);
    const novel = lib.get('pipeline', 'novel-pipeline')!.pipeline!;
    const romance = lib.get('pipeline', 'romance-pipeline')!.pipeline!;
    const book = await svc.create({
      title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline',
      pipelines: [{ name: 'novel-pipeline', pipeline: novel }, { name: 'romance-pipeline', pipeline: romance }],
      sections: [],
    });
    const status = await svc.repullStatus(book.slug);
    const pipes = status.filter((a) => a.kind === 'pipeline').map((a) => a.name).sort();
    assert.deepEqual(pipes, ['novel-pipeline', 'romance-pipeline']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
