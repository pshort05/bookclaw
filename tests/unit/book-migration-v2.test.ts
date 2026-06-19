/**
 * Unit tests for the lazy v1 -> v2 book migration (config-not-code pipelines,
 * Task 8). A v1 book has a single templates/pipeline.json and no pipelineSequence;
 * on open() it is migrated to the templates/pipeline/<name>.json layout with
 * pipelineSequence + schemaVersion bumped, persisted, and idempotent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}
const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'soul');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'voice');
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

/** Hand-build a v1 book dir: schemaVersion 1, single templates/pipeline.json, no pipelineSequence. */
function makeV1Book(root: string, slug: string, pipelineName: string): string {
  const booksDir = join(root, 'workspace', 'books');
  const dir = join(booksDir, slug);
  mkdirSync(join(dir, 'templates'), { recursive: true });
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'templates', 'pipeline.json'), JSON.stringify({
    schemaVersion: 1, name: pipelineName, label: 'L', description: 'd',
    steps: [{ label: 'S', taskType: 'general', promptTemplate: 'do', phase: 'revision' }],
  }, null, 2));
  writeFileSync(join(dir, 'book.json'), JSON.stringify({
    id: slug, slug, title: 'Legacy', schemaVersion: 1, createdByApp: '1.0.0', lastWrittenByApp: '1.0.0',
    phase: 'planning', createdAt: '2026-01-01T00:00:00.000Z',
    pulledFrom: { author: { name: 'default', source: 'builtin' }, pipeline: { name: pipelineName, source: 'builtin' }, sections: [] },
    history: [],
  }, null, 2));
  return dir;
}

test('open() migrates a v1 book to v2 (sequence layout + schemaVersion bump)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-mig-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const dir = makeV1Book(root, 'legacy', 'deep-revision');

    const opened = await svc.open('legacy');
    assert.ok(opened);
    assert.equal(opened!.manifest.schemaVersion, 2);
    assert.deepEqual(opened!.manifest.pipelineSequence, ['deep-revision']);

    // The new layout file exists; book.json persisted the bump.
    assert.ok(existsSync(join(dir, 'templates', 'pipeline', 'deep-revision.json')));
    const persisted = JSON.parse(readFileSync(join(dir, 'book.json'), 'utf-8'));
    assert.equal(persisted.schemaVersion, 2);
    assert.deepEqual(persisted.pipelineSequence, ['deep-revision']);

    // The snapshot accessor reads the migrated pipeline.
    assert.equal(svc.snapshotPipelineOf('legacy', 'deep-revision')?.name, 'deep-revision');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('migration is idempotent (a second open() is a no-op)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-mig-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    makeV1Book(root, 'legacy', 'deep-revision');
    await svc.open('legacy');
    const opened2 = await svc.open('legacy');
    assert.equal(opened2!.manifest.schemaVersion, 2);
    assert.deepEqual(opened2!.manifest.pipelineSequence, ['deep-revision']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('migration relocates the legacy .baseline/pipeline.json to the v2 path (F3)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-mig-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const dir = makeV1Book(root, 'legacy', 'deep-revision');
    // A v1 pristine baseline at the legacy single-file path, with DISTINCT content.
    const baselineBody = JSON.stringify({ schemaVersion: 1, name: 'deep-revision', label: 'PRISTINE', steps: [] }, null, 2);
    write(dir, '.baseline/pipeline.json', baselineBody);

    await svc.open('legacy');

    const p = join(dir, '.baseline', 'pipeline', 'deep-revision.json');
    assert.ok(existsSync(p), 'baseline relocated to the v2 per-name path');
    assert.equal(readFileSync(p, 'utf-8'), baselineBody, 'pristine baseline content preserved (relocated, not reseeded)');
    const rp = (await svc.repullStatus('legacy')).find(a => a.kind === 'pipeline' && a.name === 'deep-revision');
    assert.ok(rp); assert.equal(rp!.hasBaseline, true);
    assert.notEqual(rp!.status, 'no-baseline');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('migration seeds .baseline/pipeline/<name>.json from templates when no legacy baseline exists (F3)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-mig-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const dir = makeV1Book(root, 'legacy', 'deep-revision'); // no .baseline/ at all

    await svc.open('legacy');

    const p = join(dir, '.baseline', 'pipeline', 'deep-revision.json');
    assert.ok(existsSync(p), 'baseline seeded at the v2 per-name path');
    assert.equal(
      readFileSync(p, 'utf-8'),
      readFileSync(join(dir, 'templates', 'pipeline', 'deep-revision.json'), 'utf-8'),
      'seeded from the migrated templates pipeline content',
    );
    const rp = (await svc.repullStatus('legacy')).find(a => a.kind === 'pipeline' && a.name === 'deep-revision');
    assert.ok(rp); assert.equal(rp!.hasBaseline, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('migration falls back to "pipeline" name when the legacy file has none', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-mig-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const booksDir = join(root, 'workspace', 'books');
    const dir = join(booksDir, 'noname');
    mkdirSync(join(dir, 'templates'), { recursive: true });
    writeFileSync(join(dir, 'templates', 'pipeline.json'), JSON.stringify({ schemaVersion: 1, steps: [] }));
    writeFileSync(join(dir, 'book.json'), JSON.stringify({
      id: 'noname', slug: 'noname', title: 'NN', schemaVersion: 1, createdByApp: '1', lastWrittenByApp: '1',
      phase: 'planning', createdAt: '2026-01-01T00:00:00.000Z',
      pulledFrom: { author: { name: 'default', source: 'builtin' }, pipeline: { name: 'x', source: 'builtin' }, sections: [] },
      history: [],
    }));
    const opened = await svc.open('noname');
    assert.deepEqual(opened!.manifest.pipelineSequence, ['pipeline']);
    assert.ok(existsSync(join(dir, 'templates', 'pipeline', 'pipeline.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
