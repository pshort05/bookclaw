import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { WorldService } from '../../gateway/src/services/world.js';

const fakeSkills = {
  getSkillCatalog: () => [] as Array<{ name: string; description: string; source: 'builtin' }>,
  getSkillByName: () => undefined,
};

const WORLD_JSON = JSON.stringify({
  schemaVersion: 1,
  name: 'shattered-cradle',
  label: 'The Shattered Cradle',
  description: 'A test world.',
  documentTypes: [{ id: 'field-guide', label: 'Field Guide' }, { id: 'codex', label: 'Codex' }],
  domains: ['GEO', 'MAG'],
  clearanceLevels: ['General Access', 'Restricted'],
  classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}',
  formatDirective: 'Narrative prose only.',
});

async function setup(root: string) {
  const builtin = join(root, 'library');
  const workspace = join(root, 'workspace', 'library');
  // Seed a built-in world config so getConfig/list resolve through the library.
  mkdirSync(join(builtin, 'worlds', 'shattered-cradle'), { recursive: true });
  writeFileSync(join(builtin, 'worlds', 'shattered-cradle', 'world.json'), WORLD_JSON, 'utf-8');
  const lib = new LibraryService(builtin, workspace, fakeSkills);
  await lib.loadAll();
  const world = new WorldService(lib, workspace);
  return { lib, world, workspace };
}

test('list / getConfig resolve a world through the library', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-world-'));
  try {
    const { world } = await setup(root);
    const rows = world.list();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'shattered-cradle');
    assert.equal(rows[0].label, 'The Shattered Cradle');
    const cfg = world.getConfig('shattered-cradle');
    assert.equal(cfg?.domains.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('createDocument auto-classifies, then read/update/delete round-trip', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-world-'));
  try {
    const { world, workspace } = await setup(root);
    const created = world.createDocument('shattered-cradle', {
      meta: { title: 'Geography', type: 'field-guide', clearance: 'General Access', domain: 'GEO', tags: ['geo'], summary: 'A guide.' },
      body: 'Body one.',
    });
    assert.equal(created.meta.classification, 'FG-GEO-0001');
    assert.ok(existsSync(join(workspace, 'worlds', 'shattered-cradle', 'documents', `${created.docId}.md`)));

    const second = world.createDocument('shattered-cradle', {
      meta: { title: 'More Geography', type: 'field-guide', clearance: 'General Access', domain: 'GEO', tags: [], summary: 'Another.' },
      body: 'Body two.',
    });
    assert.equal(second.meta.classification, 'FG-GEO-0002');

    const catalog = world.listDocuments('shattered-cradle');
    assert.equal(catalog.length, 2);
    assert.ok(catalog.every((r) => !r.body));

    const got = world.getDocument('shattered-cradle', created.docId);
    assert.equal(got?.body, 'Body one.');
    assert.equal(got?.meta.title, 'Geography');

    const updated = world.updateDocument('shattered-cradle', created.docId, {
      meta: { ...created.meta, summary: 'Revised.' },
      body: 'Body one revised.',
    });
    assert.equal(updated.meta.summary, 'Revised.');
    assert.equal(world.getDocument('shattered-cradle', created.docId)?.body, 'Body one revised.');

    assert.equal(world.deleteDocument('shattered-cradle', created.docId), true);
    assert.equal(world.getDocument('shattered-cradle', created.docId), undefined);
    assert.equal(world.listDocuments('shattered-cradle').length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('createDocument honors an explicit classification', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-world-'));
  try {
    const { world } = await setup(root);
    const doc = world.createDocument('shattered-cradle', {
      meta: { title: 'Pinned', type: 'codex', classification: 'CO-MAG-0099', clearance: 'Restricted', domain: 'MAG', tags: [], summary: 'Pinned code.' },
      body: 'B.',
    });
    assert.equal(doc.meta.classification, 'CO-MAG-0099');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a bad document file surfaces as needsAttention, never throws', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-world-'));
  try {
    const { world, workspace } = await setup(root);
    const docsDir = join(workspace, 'worlds', 'shattered-cradle', 'documents');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, 'broken.md'), 'no frontmatter at all', 'utf-8');
    const catalog = world.listDocuments('shattered-cradle');
    const broken = catalog.find((r) => r.docId === 'broken');
    assert.ok(broken?.needsAttention, 'broken doc flagged needsAttention');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
