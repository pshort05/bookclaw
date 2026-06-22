/**
 * Unit tests for gateway/src/services/world-authoring.ts:
 *   - composeWorldAuthoringContext: pure priming-string composer
 *   - worldForAuthoringEditor: finds which world a given editor name belongs to
 *   - proposedDocToCreateInput: maps a proposed document to WorldService.createDocument input
 *   - write-back round-trip via WorldService.createDocument (Task 4)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  composeWorldAuthoringContext,
  worldForAuthoringEditor,
  proposedDocToCreateInput,
  type ProposedDocument,
} from '../../gateway/src/services/world-authoring.ts';
import type { LibraryWorld, WorldDocCatalogRow } from '../../gateway/src/services/world-types.ts';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeWorld(overrides: Partial<LibraryWorld> = {}): LibraryWorld {
  return {
    schemaVersion: 1,
    name: 'test-world',
    label: 'Test World',
    documentTypes: [{ id: 'field-guide', label: 'Field Guide', note: 'practical' }],
    domains: ['GEO', 'SHD'],
    clearanceLevels: ['General Access', 'Cloister-Only'],
    classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}',
    formatDirective: 'Narrative prose only, never bullet lists.',
    authoringEditor: 'world-author',
    ...overrides,
  };
}

function makeCatalogRow(overrides: Partial<WorldDocCatalogRow> = {}): WorldDocCatalogRow {
  return {
    docId: 'fg-geo-0141-geography',
    title: 'The Geography of the Shattered Cradle',
    type: 'field-guide',
    domain: 'GEO',
    clearance: 'General Access',
    classification: 'FG-GEO-0141',
    summary: "A traveler's guide to the continent.",
    tags: ['geography', 'travel'],
    appendixEligible: true,
    ...overrides,
  };
}

// ── composeWorldAuthoringContext ──────────────────────────────────────────────

test('composeWorldAuthoringContext includes formatDirective', () => {
  const out = composeWorldAuthoringContext(makeWorld(), [makeCatalogRow()]);
  assert.ok(out.includes('Narrative prose only, never bullet lists.'));
});

test('composeWorldAuthoringContext includes document-type label', () => {
  const out = composeWorldAuthoringContext(makeWorld(), [makeCatalogRow()]);
  assert.ok(out.includes('Field Guide'));
});

test('composeWorldAuthoringContext includes clearance level', () => {
  const out = composeWorldAuthoringContext(makeWorld(), [makeCatalogRow()]);
  assert.ok(out.includes('Cloister-Only'));
});

test('composeWorldAuthoringContext includes domain', () => {
  const out = composeWorldAuthoringContext(makeWorld(), [makeCatalogRow()]);
  assert.ok(out.includes('SHD'));
});

test('composeWorldAuthoringContext includes catalog title', () => {
  const out = composeWorldAuthoringContext(makeWorld(), [makeCatalogRow()]);
  assert.ok(out.includes('The Geography of the Shattered Cradle'));
});

test('composeWorldAuthoringContext includes a catalog tag', () => {
  const out = composeWorldAuthoringContext(makeWorld(), [makeCatalogRow()]);
  assert.ok(out.includes('geography'));
});

test('composeWorldAuthoringContext with empty catalog includes formatDirective and document-type label', () => {
  const out = composeWorldAuthoringContext(makeWorld(), []);
  assert.ok(out.includes('Narrative prose only, never bullet lists.'));
  assert.ok(out.includes('Field Guide'));
});

test('composeWorldAuthoringContext with empty catalog includes a "no documents" marker', () => {
  const out = composeWorldAuthoringContext(makeWorld(), []);
  assert.ok(out.toLowerCase().includes('no document'));
});

test('composeWorldAuthoringContext caps catalog at 50 rows and appends tail line', () => {
  const catalog: WorldDocCatalogRow[] = Array.from({ length: 55 }, (_, i) =>
    makeCatalogRow({ docId: `doc-${i}`, title: `Doc ${i}`, classification: `FG-GEO-${String(i).padStart(4, '0')}` }),
  );
  const out = composeWorldAuthoringContext(makeWorld(), catalog);
  // Only the first 50 are listed
  assert.ok(out.includes('Doc 49'), 'row 50 (index 49) should be present');
  assert.ok(!out.includes('Doc 50'), 'row 51 (index 50) should not be listed');
  // Tail line present with correct count
  assert.ok(out.includes('(… 5 more documents not shown — use the documents catalog to find them)'));
});

test('composeWorldAuthoringContext does not append tail line when catalog is exactly 50 rows', () => {
  const catalog: WorldDocCatalogRow[] = Array.from({ length: 50 }, (_, i) =>
    makeCatalogRow({ docId: `doc-${i}`, title: `Doc ${i}`, classification: `FG-GEO-${String(i).padStart(4, '0')}` }),
  );
  const out = composeWorldAuthoringContext(makeWorld(), catalog);
  assert.ok(!out.includes('more documents not shown'));
});

// ── worldForAuthoringEditor ───────────────────────────────────────────────────

test('worldForAuthoringEditor returns config whose authoringEditor matches', () => {
  const cfg = makeWorld();
  const result = worldForAuthoringEditor(
    'world-author',
    [{ name: 'test-world' }],
    (_name) => cfg,
  );
  assert.ok(result !== undefined);
  assert.strictEqual(result!.name, 'test-world');
});

test('worldForAuthoringEditor returns undefined when no world matches', () => {
  const cfg = makeWorld();
  const result = worldForAuthoringEditor(
    'some-other-editor',
    [{ name: 'test-world' }],
    (_name) => cfg,
  );
  assert.strictEqual(result, undefined);
});

test('worldForAuthoringEditor returns undefined for empty world list', () => {
  const result = worldForAuthoringEditor('world-author', [], (_name) => undefined);
  assert.strictEqual(result, undefined);
});

test('worldForAuthoringEditor warns once when multiple worlds share the same authoringEditor', () => {
  const cfgA = makeWorld({ name: 'world-a', authoringEditor: 'shared-editor' });
  const cfgB = makeWorld({ name: 'world-b', authoringEditor: 'shared-editor' });
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
  try {
    const result = worldForAuthoringEditor(
      'shared-editor',
      [{ name: 'world-a' }, { name: 'world-b' }],
      (name) => name === 'world-a' ? cfgA : cfgB,
    );
    assert.strictEqual(result?.name, 'world-a', 'first match wins');
    assert.strictEqual(warnings.length, 1, 'exactly one warning emitted');
    assert.ok(warnings[0].includes('world-a'), 'warning names first world');
    assert.ok(warnings[0].includes('world-b'), 'warning names second world');
    assert.ok(warnings[0].includes('shared-editor'), 'warning names the editor');
  } finally {
    console.warn = origWarn;
  }
});

// ── proposedDocToCreateInput ──────────────────────────────────────────────────

test('proposedDocToCreateInput maps required fields and omits classification', () => {
  const proposed: ProposedDocument = {
    title: 'Test Doc',
    type: 'field-guide',
    clearance: 'General Access',
    domain: 'GEO',
    summary: 'A test.',
    body: 'Some narrative text.',
  };
  const result = proposedDocToCreateInput(proposed);
  assert.strictEqual(result.meta.title, 'Test Doc');
  assert.strictEqual(result.meta.type, 'field-guide');
  assert.strictEqual(result.meta.domain, 'GEO');
  assert.strictEqual(result.body, 'Some narrative text.');
  assert.ok(!('classification' in result.meta), 'classification must be absent');
});

test('proposedDocToCreateInput defaults tags to empty array when omitted', () => {
  const proposed: ProposedDocument = {
    title: 'T', type: 'field-guide', clearance: 'General Access',
    domain: 'GEO', summary: 'S', body: 'B',
  };
  const result = proposedDocToCreateInput(proposed);
  assert.deepStrictEqual(result.meta.tags, []);
});

// ── Write-back round-trip (Task 4) ────────────────────────────────────────────

const fakeSkills = {
  getSkillCatalog: () => [] as Array<{ name: string; description: string; source: 'builtin' }>,
  getSkillByName: () => undefined,
};

const TEST_WORLD_JSON = JSON.stringify({
  schemaVersion: 1, name: 'test-world', label: 'Test World',
  documentTypes: [{ id: 'field-guide', label: 'Field Guide', note: 'practical' }],
  domains: ['GEO'], clearanceLevels: ['General Access', 'Restricted'],
  classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}',
  formatDirective: 'Narrative prose only, never bullet lists.',
  authoringEditor: 'world-author',
});

test('proposedDocToCreateInput → WorldService.createDocument round-trip auto-classifies and persists', async () => {
  // Dynamic imports to avoid top-level side effects
  const { LibraryService } = await import('../../gateway/src/services/library.ts');
  const { WorldService } = await import('../../gateway/src/services/world.ts');
  const { rmSync } = await import('node:fs');

  // Set up a temp workspace with a test-world fixture in the built-in library dir
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-world-test-'));
  try {
    const builtinDir = join(root, 'library');
    const workspaceDir = join(root, 'workspace', 'library');
    mkdirSync(join(builtinDir, 'worlds', 'test-world'), { recursive: true });
    writeFileSync(join(builtinDir, 'worlds', 'test-world', 'world.json'), TEST_WORLD_JSON, 'utf-8');

    const library = new LibraryService(builtinDir, workspaceDir, fakeSkills);
    await library.loadAll();
    const worldSvc = new WorldService(library, workspaceDir);

    const proposed: ProposedDocument = {
      title: 'The Geography of the Test World',
      type: 'field-guide',
      clearance: 'General Access',
      domain: 'GEO',
      summary: 'A geographic overview.',
      body: 'Narrative prose here.',
      tags: ['geography'],
    };

    const { meta: inputMeta, body: inputBody } = proposedDocToCreateInput(proposed);
    const created = worldSvc.createDocument('test-world', { meta: inputMeta, body: inputBody });

    // Auto-classification assigned
    assert.ok(/^FG-GEO-\d{4}$/.test(created.meta.classification), `classification shape: ${created.meta.classification}`);
    assert.strictEqual(created.meta.title, 'The Geography of the Test World');
    assert.ok(created.body.includes('Narrative prose here.'));

    // Document persisted — listDocuments returns the new row
    const catalog = worldSvc.listDocuments('test-world');
    assert.ok(catalog.length === 1, 'catalog should have one entry');
    assert.strictEqual(catalog[0].title, 'The Geography of the Test World');
    assert.ok(/^FG-GEO-\d{4}$/.test(catalog[0].classification));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
