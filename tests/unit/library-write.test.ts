/**
 * Unit tests for the library overlay write path (book-container Phase 4):
 * writeEntry / createEntry / deleteOverlayEntry against the workspace overlay,
 * with built-ins read-only and delete-reverts-to-builtin. Network-free.
 * Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;
function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}
async function makeLib(root: string): Promise<LibraryService> {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'builtin soul');
  write(builtin, 'genres/romantasy/tropes.md', 'builtin tropes');
  const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  return lib;
}

test('writeEntry overlays a built-in (source flips to workspace)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    assert.equal(lib.get('author', 'default')!.source, 'builtin');
    await lib.writeEntry('author', 'default', { files: { 'SOUL.md': 'edited soul' } });
    await lib.reload();
    const e = lib.get('author', 'default')!;
    assert.equal(e.source, 'workspace');
    assert.equal(e.files!['SOUL.md'], 'edited soul');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('deleteOverlayEntry reverts to the built-in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    await lib.writeEntry('genre', 'romantasy', { files: { 'tropes.md': 'edited' } });
    await lib.reload();
    assert.equal(lib.get('genre', 'romantasy')!.source, 'workspace');
    const removed = await lib.deleteOverlayEntry('genre', 'romantasy');
    assert.equal(removed, true);
    await lib.reload();
    const e = lib.get('genre', 'romantasy')!;
    assert.equal(e.source, 'builtin');
    assert.equal(e.files!['tropes.md'], 'builtin tropes');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('deleteOverlayEntry returns false for a builtin-only entry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    const removed = await lib.deleteOverlayEntry('author', 'default');
    assert.equal(removed, false); // nothing in the overlay to delete
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('createEntry rejects a name that exists as a built-in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    await assert.rejects(() => lib.createEntry('author', 'default', { files: { 'SOUL.md': 'x' } }), /already exists/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('editing one file of a built-in multi-file author preserves siblings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const builtin = join(root, 'library');
    write(builtin, 'authors/multi/SOUL.md', 'soul orig');
    write(builtin, 'authors/multi/PERSONALITY.md', 'persona orig');
    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
    await lib.loadAll();
    // edit ONLY SOUL.md
    await lib.writeEntry('author', 'multi', { files: { 'SOUL.md': 'soul EDITED' } });
    await lib.reload();
    const e = lib.get('author', 'multi')!;
    assert.equal(e.source, 'workspace');
    assert.equal(e.files!['SOUL.md'], 'soul EDITED');
    assert.equal(e.files!['PERSONALITY.md'], 'persona orig'); // sibling preserved
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pipeline step modelOverride (incl. temperature-only) round-trips', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    const pipeline = {
      schemaVersion: 1, name: 'mp', label: 'MP', description: 'd',
      steps: [
        { label: 'A', taskType: 'creative_writing', promptTemplate: 'a', modelOverride: { provider: 'claude', model: 'claude-sonnet-4-5', temperature: 0.4 } },
        { label: 'B', taskType: 'creative_writing', promptTemplate: 'b', modelOverride: { temperature: 0.9 } }, // temp-only, no provider
      ],
    };
    await lib.createEntry('pipeline', 'mp', { content: JSON.stringify(pipeline) });
    await lib.reload();
    const steps = lib.get('pipeline', 'mp')!.pipeline!.steps as Array<{ modelOverride?: { provider?: string; model?: string; temperature?: number } }>;
    assert.equal(steps[0].modelOverride!.provider, 'claude');
    assert.equal(steps[0].modelOverride!.temperature, 0.4);
    assert.equal(steps[1].modelOverride!.provider, undefined);
    assert.equal(steps[1].modelOverride!.temperature, 0.9);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('createEntry writes a sequence; empty pipelines rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    // A valid sequence (≥1 pipeline) is creatable in the overlay — this is the
    // kind the studio "Add Sequence" button creates (regression: it was blocked
    // by a route allowlist that omitted "sequence").
    await lib.createEntry('sequence', 'my-seq', {
      content: JSON.stringify({ schemaVersion: 1, name: 'my-seq', label: 'My Seq', description: 'd', pipelines: ['novel-pipeline'] }),
    });
    await lib.reload();
    assert.deepEqual(lib.get('sequence', 'my-seq')!.sequence!.pipelines, ['novel-pipeline']);

    // An empty-pipelines body must be rejected (the old starter JSON sent this).
    await assert.rejects(
      () => lib.createEntry('sequence', 'empty-seq', { content: JSON.stringify({ schemaVersion: 1, name: 'empty-seq', pipelines: [] }) }),
      /non-empty/i,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('createEntry writes a section and a pipeline; bad JSON rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    await lib.createEntry('section', 'epilogue', { content: '# Epilogue' });
    await lib.reload();
    assert.equal(lib.get('section', 'epilogue')!.content, '# Epilogue');

    await lib.createEntry('pipeline', 'mini', { content: JSON.stringify({ schemaVersion: 1, name: 'mini', label: 'Mini', description: 'd', steps: [] }) });
    await lib.reload();
    assert.equal(lib.get('pipeline', 'mini')!.pipeline!.name, 'mini');

    await assert.rejects(() => lib.createEntry('pipeline', 'broken', { content: '{ not json' }));
    await assert.rejects(() => lib.createEntry('pipeline', 'noSteps', { content: '{"schemaVersion":1}' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
