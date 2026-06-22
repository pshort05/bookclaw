/**
 * Unit tests for World Repository Phase 3 — proposeWorldDocs (hybrid
 * relevance-pull) with a FAKE router: ranking/reasons happy path + two
 * fail-soft paths (AI rejects; AI returns garbage). Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { WorldService } from '../../gateway/src/services/world.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

const WORLD_JSON = JSON.stringify({
  schemaVersion: 1,
  name: 'test-world',
  documentTypes: [{ id: 'field-guide', label: 'Field Guide' }],
  domains: ['GEO'],
  clearanceLevels: ['General Access'],
  classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}',
  formatDirective: 'Narrative prose only.',
});

function metaOf(title: string, classification: string) {
  return { title, type: 'field-guide', classification, clearance: 'General Access', domain: 'GEO', tags: ['t'], summary: `summary for ${title}` };
}

async function setup(root: string) {
  const builtin = join(root, 'library');
  const workspace = join(root, 'workspace', 'library');
  mkdirSync(join(builtin, 'worlds', 'test-world'), { recursive: true });
  writeFileSync(join(builtin, 'worlds', 'test-world', 'world.json'), WORLD_JSON, 'utf-8');
  const lib = new LibraryService(builtin, workspace, fakeSkills);
  await lib.loadAll();
  const world = new WorldService(lib, workspace);
  // Seed three documents d1, d2, d3 (explicit classifications → predictable docIds).
  const d1 = world.createDocument('test-world', { meta: metaOf('Doc One', 'FG-GEO-0001'), body: 'b1' });
  const d2 = world.createDocument('test-world', { meta: metaOf('Doc Two', 'FG-GEO-0002'), body: 'b2' });
  const d3 = world.createDocument('test-world', { meta: metaOf('Doc Three', 'FG-GEO-0003'), body: 'b3' });
  return { world, d1: d1.docId, d2: d2.docId, d3: d3.docId };
}

const signals = { title: 'My Book', description: 'A premise.', genre: 'fantasy', knownEntities: 'Alice, Bravos' };

test('proposeWorldDocs maps a ranked AI response against the catalog (titles from catalog; unproposed dropped)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-prop-'));
  try {
    const { world, d1, d2, d3 } = await setup(root);
    const ai = {
      complete: async () => ({ content: JSON.stringify([
        { docId: d2, rank: 1, reason: 'central conflict' },
        { docId: d1, rank: 2, reason: 'setting' },
      ]) }),
      select: () => ({ id: 'ollama' }),
    };
    const out = await world.proposeWorldDocs('my-book', signals, 'test-world', ai);
    assert.equal(out.length, 2);
    assert.equal(out[0].docId, d2);
    assert.equal(out[0].rank, 1);
    assert.equal(out[0].reason, 'central conflict');
    assert.equal(out[0].title, 'Doc Two');
    assert.equal(out[1].docId, d1);
    assert.equal(out[1].reason, 'setting');
    assert.equal(out[1].title, 'Doc One');
    assert.ok(!out.some((r) => r.docId === d3), 'unproposed d3 absent');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('proposeWorldDocs falls back to the full catalog (reason manual) when AI rejects', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-prop-'));
  try {
    const { world, d1, d2, d3 } = await setup(root);
    const ai = {
      complete: async () => { throw new Error('provider down'); },
      select: () => ({ id: 'ollama' }),
    };
    const out = await world.proposeWorldDocs('my-book', signals, 'test-world', ai);
    assert.deepEqual(out.map((r) => r.docId), [d1, d2, d3]);
    assert.ok(out.every((r) => r.reason === 'manual'));
    assert.deepEqual(out.map((r) => r.rank), [0, 1, 2]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('proposeWorldDocs falls back to the full catalog (reason manual) on unparseable JSON', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-prop-'));
  try {
    const { world, d1, d2, d3 } = await setup(root);
    const ai = {
      complete: async () => ({ content: 'not json' }),
      select: () => ({ id: 'ollama' }),
    };
    const out = await world.proposeWorldDocs('my-book', signals, 'test-world', ai);
    assert.deepEqual(out.map((r) => r.docId), [d1, d2, d3]);
    assert.ok(out.every((r) => r.reason === 'manual'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
