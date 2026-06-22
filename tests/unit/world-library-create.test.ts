/**
 * Unit tests for creating/editing a `world` library entry through LibraryService
 * (regression for "POST /api/library/world → 400": world was missing from the
 * route WRITABLE list and from writeEntry's per-kind branches). A world entry is
 * a directory holding world.json. Network-free; temp dirs. Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  mkdirSync(builtin, { recursive: true });
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

const WORLD_JSON = JSON.stringify({
  schemaVersion: 1,
  name: 'test-world',
  label: 'Test World',
  description: 'A world made via the library API.',
  documentTypes: [{ id: 'field-guide', label: 'Field Guide' }],
  domains: ['GEO'],
  clearanceLevels: ['General Access'],
  classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}',
  formatDirective: 'Narrative prose only.',
}, null, 2);

test('createEntry("world", …) writes worlds/<name>/world.json and loads it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-worldlib-'));
  try {
    const lib = seedLibrary(root);
    await lib.loadAll();
    await lib.createEntry('world', 'test-world', { content: WORLD_JSON });
    await lib.reload();

    const cfgPath = join(root, 'workspace', 'library', 'worlds', 'test-world', 'world.json');
    assert.ok(existsSync(cfgPath), 'world.json written inside worlds/<name>/');

    const entry = lib.get('world', 'test-world');
    assert.ok(entry?.world, 'world config loaded through LibraryService');
    assert.equal(entry!.world!.name, 'test-world');
    assert.equal(entry!.world!.label, 'Test World');
    assert.deepEqual(entry!.world!.domains, ['GEO']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('createEntry("world", …) rejects invalid world.json', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-worldlib-'));
  try {
    const lib = seedLibrary(root);
    await lib.loadAll();
    // Missing required fields (only a name) → parseWorldJson throws.
    await assert.rejects(
      () => lib.createEntry('world', 'bad-world', { content: '{"schemaVersion":1,"name":"bad-world"}' }),
      /documentTypes|domains|clearanceLevels|classificationScheme|formatDirective/i,
    );
    assert.ok(!existsSync(join(root, 'workspace', 'library', 'worlds', 'bad-world', 'world.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeEntry("world", …) edits an existing world config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-worldlib-'));
  try {
    const lib = seedLibrary(root);
    await lib.loadAll();
    await lib.createEntry('world', 'test-world', { content: WORLD_JSON });
    const edited = WORLD_JSON.replace('"Test World"', '"Renamed World"');
    await lib.writeEntry('world', 'test-world', { content: edited });
    await lib.reload();
    assert.equal(lib.get('world', 'test-world')!.world!.label, 'Renamed World');
    assert.equal(
      readFileSync(join(root, 'workspace', 'library', 'worlds', 'test-world', 'world.json'), 'utf-8').includes('Renamed World'),
      true,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});
