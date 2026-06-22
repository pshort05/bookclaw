/**
 * Unit tests for World Repository Phase 3 — binding, snapshot, composition,
 * and 3-way re-pull of curated world docs. Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import { WorldService } from '../../gateway/src/services/world.js';
import { serializeWorldDoc } from '../../gateway/src/services/world-parse.js';
import { WIRED_KINDS, type BookManifest } from '../../gateway/src/services/book-types.js';
import type { RepullAsset } from '../../gateway/src/services/book.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body, 'utf-8');
}

const WORLD_JSON = JSON.stringify({
  schemaVersion: 1,
  name: 'test-world',
  label: 'Test World',
  description: 'A test world.',
  documentTypes: [{ id: 'field-guide', label: 'Field Guide' }],
  domains: ['GEO'],
  clearanceLevels: ['General Access'],
  classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}',
  formatDirective: 'Narrative prose only.',
});

function seedLibrary(root: string): LibraryService {
  const b = join(root, 'library');
  write(b, 'authors/default/SOUL.md', 'soul v1\n');
  write(b, 'voices/default/STYLE-GUIDE.md', 'style v1');
  write(b, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  write(b, 'worlds/test-world/world.json', WORLD_JSON);
  return new LibraryService(b, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeSvc(root: string): Promise<{ svc: BookService; lib: LibraryService; world: WorldService }> {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  const world = new WorldService(lib, join(root, 'workspace', 'library'));
  svc.setWorldService(world);
  return { svc, lib, world };
}

function metaOf(title: string, classification: string, summary: string) {
  return { title, type: 'field-guide', classification, clearance: 'General Access', domain: 'GEO', tags: ['t'], summary };
}

test('binding types: BookManifest gains pulledFrom.world + worldDocs; WIRED_KINDS + RepullAsset gain world', () => {
  // Type-level assertions: these literals must compile.
  const m: BookManifest = {
    id: 'b', slug: 'b', title: 'B', schemaVersion: 2,
    createdByApp: 'x', lastWrittenByApp: 'x', phase: 'planning',
    createdAt: new Date().toISOString(),
    pulledFrom: {
      author: { name: 'default', source: 'builtin' },
      pipeline: { name: 'novel-pipeline', source: 'builtin' },
      sections: [],
      world: { name: 'test-world', source: 'builtin' },
    },
    worldDocs: ['fg-geo-0001'],
    history: [],
  };
  assert.equal(m.pulledFrom.world?.name, 'test-world');
  assert.deepEqual(m.worldDocs, ['fg-geo-0001']);

  const asset: RepullAsset = { kind: 'world', name: 'fg-geo-0001', status: 'in-sync', libraryPresent: true, hasBaseline: true, wired: true };
  assert.equal(asset.kind, 'world');
  assert.equal(WIRED_KINDS.has('world'), true);
});

test('worldDocsOf composes curated doc bodies under headers, in docId order, excluding world.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wb-'));
  try {
    const { svc } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const wdir = join(root, 'workspace', 'books', book.slug, 'templates', 'world');
    mkdirSync(wdir, { recursive: true });
    writeFileSync(join(wdir, 'world.json'), WORLD_JSON, 'utf-8');
    writeFileSync(join(wdir, 'fg-geo-0001.md'), serializeWorldDoc(metaOf('Alpha Geography', 'FG-GEO-0001', 's1'), 'BODY ALPHA'), 'utf-8');
    writeFileSync(join(wdir, 'fg-geo-0002.md'), serializeWorldDoc(metaOf('Beta Geography', 'FG-GEO-0002', 's2'), 'BODY BETA'), 'utf-8');

    const out = svc.worldDocsOf(book.slug);
    assert.ok(out, 'worldDocsOf returned a string');
    assert.ok(out!.includes('## World Document — Alpha Geography'));
    assert.ok(out!.includes('BODY ALPHA'));
    assert.ok(out!.includes('## World Document — Beta Geography'));
    assert.ok(out!.includes('BODY BETA'));
    assert.ok(!out!.includes('classificationScheme'), 'world.json content not included');
    // docId order: alpha header precedes beta header
    assert.ok(out!.indexOf('Alpha Geography') < out!.indexOf('Beta Geography'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('worldGuide concatenation: worldbuilding first, world docs second; null pass-through', () => {
  // Mimics the index.ts worldGuide assembly.
  const combine = (wb: string | undefined, wd: string | undefined): string | undefined =>
    [wb, wd].filter(Boolean).join('\n\n') || undefined;
  assert.equal(combine('WB', 'WD'), 'WB\n\nWD');
  assert.equal(combine('WB', undefined), 'WB');
  assert.equal(combine(undefined, 'WD'), 'WD');
  assert.equal(combine(undefined, undefined), undefined);
});

test('snapshotWorldDocs writes templates + baseline, sets manifest, returns missing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wb-'));
  try {
    const { svc, world } = await makeSvc(root);
    world.createDocument('test-world', { meta: metaOf('Geo A', 'FG-GEO-0001', 'sa'), body: 'BODY A' });
    world.createDocument('test-world', { meta: metaOf('Geo B', 'FG-GEO-0002', 'sb'), body: 'BODY B' });
    const catalog = world.listDocuments('test-world');
    const idA = catalog.find((r) => r.classification === 'FG-GEO-0001')!.docId;
    const idB = catalog.find((r) => r.classification === 'FG-GEO-0002')!.docId;

    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const cfgFn = (n: string) => { const c = world.getConfig(n); return c ? JSON.stringify(c, null, 2) : null; };
    const docFn = (n: string, id: string) => { const d = world.getDocument(n, id); return d ? serializeWorldDoc(d.meta, d.body) : null; };

    const result = await svc.snapshotWorldDocs(book.slug, { name: 'test-world', source: 'workspace' }, [idA, idB, 'no-such-doc'], cfgFn, docFn);
    assert.deepEqual(result.written.sort(), [idA, idB].sort());
    assert.deepEqual(result.missing, ['no-such-doc']);

    const bdir = join(root, 'workspace', 'books', book.slug);
    assert.ok(existsSync(join(bdir, 'templates', 'world', 'world.json')));
    assert.ok(existsSync(join(bdir, 'templates', 'world', `${idA}.md`)));
    assert.ok(existsSync(join(bdir, '.baseline', 'world', `${idA}.md`)));
    assert.equal(
      readFileSync(join(bdir, '.baseline', 'world', `${idA}.md`), 'utf-8'),
      readFileSync(join(bdir, 'templates', 'world', `${idA}.md`), 'utf-8'),
    );
    const m = JSON.parse(readFileSync(join(bdir, 'book.json'), 'utf-8'));
    assert.equal(m.pulledFrom.world.name, 'test-world');
    assert.deepEqual(m.worldDocs.sort(), [idA, idB].sort());
    assert.ok(m.history.some((h: { event: string }) => h.event === 'world-pull'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('re-pull of a world doc 3-way merges local + library edits and advances baseline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wb-'));
  try {
    const { svc, world } = await makeSvc(root);
    world.createDocument('test-world', { meta: metaOf('Geo A', 'FG-GEO-0001', 'sa'), body: 'line1\nline2\nline3\n' });
    const idA = world.listDocuments('test-world')[0].docId;
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const cfgFn = (n: string) => { const c = world.getConfig(n); return c ? JSON.stringify(c, null, 2) : null; };
    const docFn = (n: string, id: string) => { const d = world.getDocument(n, id); return d ? serializeWorldDoc(d.meta, d.body) : null; };
    await svc.snapshotWorldDocs(book.slug, { name: 'test-world', source: 'workspace' }, [idA], cfgFn, docFn);

    // (a) local edit on the book's snapshot
    const bookDoc = join(root, 'workspace', 'books', book.slug, 'templates', 'world', `${idA}.md`);
    const localEdited = readFileSync(bookDoc, 'utf-8').replace('line1', 'line1 LOCAL');
    writeFileSync(bookDoc, localEdited, 'utf-8');
    // (b) library-side edit on a different line
    world.updateDocument('test-world', idA, { meta: metaOf('Geo A', 'FG-GEO-0001', 'sa'), body: 'line1\nline2\nline3 LIBRARY\n' });

    const status = await svc.repullStatus(book.slug);
    const wAsset = status.find((a) => a.kind === 'world' && a.name === idA);
    assert.equal(wAsset?.status, 'diverged');

    const r = await svc.repull(book.slug, 'world', idA, {});
    assert.equal(r.hadConflicts, false);
    const merged = readFileSync(bookDoc, 'utf-8');
    assert.ok(merged.includes('line1 LOCAL'), 'kept local edit');
    assert.ok(merged.includes('line3 LIBRARY'), 'took library edit');
    const baseline = readFileSync(join(root, 'workspace', 'books', book.slug, '.baseline', 'world', `${idA}.md`), 'utf-8');
    assert.ok(baseline.includes('line3 LIBRARY'), 'baseline advanced to library version');

    // pulledFrom.world provenance refreshed
    const m = JSON.parse(readFileSync(join(root, 'workspace', 'books', book.slug, 'book.json'), 'utf-8'));
    assert.equal(m.pulledFrom.world.name, 'test-world');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
