// tests/unit/world-bind-orchestration.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import { WorldService } from '../../gateway/src/services/world.js';
import { bindBookWorld, unbindBookWorld, AUTO_PROPOSE_CAP } from '../../gateway/src/api/routes/world-bind.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

function worldDoc(title: string, code: string): string {
  return `---\ntitle: ${title}\ntype: field-guide\nclassification: ${code}\nclearance: General Access\ndomain: GEO\ntags: [geo]\nsummary: ${title} summary\n---\n\nBODY ${title}\n`;
}

async function harness(root: string) {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', '# A\n\nsoul');
  write(builtin, 'authors/default/PERSONALITY.md', 'p');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 's');
  write(builtin, 'voices/default/VOICE-PROFILE.md', 'v');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  // World overlay in the workspace library: world.json + 20 docs (to exercise the cap).
  const wsLib = join(root, 'workspace', 'library');
  write(wsLib, 'worlds/test-world/world.json', JSON.stringify({
    schemaVersion: 1, name: 'test-world', label: 'Test World',
    documentTypes: [{ id: 'field-guide', label: 'Field Guide' }],
    domains: ['GEO'], clearanceLevels: ['General Access'],
    classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}', formatDirective: 'narrative only',
  }));
  for (let i = 1; i <= 20; i++) {
    const code = `fg-geo-${String(i).padStart(4, '0')}`;
    write(wsLib, `worlds/test-world/documents/${code}.md`, worldDoc(`Doc ${i}`, code.toUpperCase()));
  }
  const lib = new LibraryService(builtin, wsLib, fakeSkills);
  await lib.loadAll();
  const books = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await books.initialize();
  const world = new WorldService(lib, wsLib);
  // Stub router: force proposeWorldDocs into its fail-soft fallback (returns full catalog).
  const aiRouter = { complete: async () => { throw new Error('no ai in test'); }, selectProvider: () => ({ id: 'stub' }) };
  const services = { books, world, library: lib, aiRouter };
  return { services, books, world };
}

test('bindBookWorld sets pulledFrom.world + caps the auto-proposed bible', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bind-'));
  try {
    const { services, books } = await harness(root);
    const book = await books.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const res = await bindBookWorld(services, book.slug, 'test-world');
    assert.equal(res.world, 'test-world');
    assert.equal(res.worldDocs.length, AUTO_PROPOSE_CAP); // 20 docs in catalog, capped to 15
    const opened = await books.open(book.slug);
    assert.equal(opened!.manifest.pulledFrom.world!.name, 'test-world');
    assert.equal(opened!.manifest.worldDocs!.length, AUTO_PROPOSE_CAP);
    const bdir = join(root, 'workspace', 'books', book.slug);
    assert.ok(existsSync(join(bdir, 'templates', 'world', 'world.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bindBookWorld throws on unknown world', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bind-'));
  try {
    const { services, books } = await harness(root);
    const book = await books.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await assert.rejects(() => bindBookWorld(services, book.slug, 'no-such-world'), /not found/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unbindBookWorld clears pulledFrom.world + worldDocs + removes templates/world', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bind-'));
  try {
    const { services, books } = await harness(root);
    const book = await books.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await bindBookWorld(services, book.slug, 'test-world');
    const ok = await unbindBookWorld(services, book.slug);
    assert.equal(ok, true);
    const opened = await books.open(book.slug);
    assert.equal(opened!.manifest.pulledFrom.world, null);
    assert.deepEqual(opened!.manifest.worldDocs, []);
    assert.ok(!existsSync(join(root, 'workspace', 'books', book.slug, 'templates', 'world')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
