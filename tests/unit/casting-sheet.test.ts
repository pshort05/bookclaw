import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCastingSheet, loadCastingSheet, clearCastingSheetCache } from '../../gateway/src/services/casting/casting-sheet.js';

const SHEET = {
  genre: 'romance',
  roleModels: {
    scene_brief: { provider: 'openrouter', model: 'anthropic/claude-opus', temperature: 1 },
    draft: { provider: 'openrouter', model: 'anthropic/claude-opus', temperature: 1 },
    improve: { provider: 'openrouter', model: 'google/gemini-3-pro', temperature: 0.7 },
  },
  proseRoles: ['scene_brief', 'draft'],
  heatLadder: { eroticaThreshold: 7, uncensoredByLevel: [{ minSpice: 7, provider: 'grok' }], rerouteRoles: ['draft', 'intimacy'], fallbackOrder: ['grok', 'venice', 'ollama'] },
};

test('validateCastingSheet accepts a well-formed sheet', () => {
  const s = validateCastingSheet(SHEET);
  assert.equal(s.genre, 'romance');
  assert.equal(s.roleModels.draft?.provider, 'openrouter');
  assert.deepEqual(s.proseRoles, ['scene_brief', 'draft']);
});

test('validateCastingSheet rejects an unknown role key', () => {
  assert.throws(() => validateCastingSheet({ ...SHEET, roleModels: { bogus: { provider: 'x' } } }), /unknown role/i);
});

test('validateCastingSheet rejects a role model with no provider', () => {
  assert.throws(() => validateCastingSheet({ ...SHEET, roleModels: { draft: { model: 'x' } } }), /provider/i);
});

test('loadCastingSheet reads builtin then overlay overrides it', () => {
  const root = mkdtempSync(join(tmpdir(), 'casting-'));
  const builtin = join(root, 'library', 'casting');
  const overlay = join(root, 'workspace', 'library', 'casting');
  mkdirSync(builtin, { recursive: true });
  mkdirSync(overlay, { recursive: true });
  writeFileSync(join(builtin, 'romance.json'), JSON.stringify(SHEET));
  writeFileSync(join(overlay, 'romance.json'), JSON.stringify({ ...SHEET, proseRoles: ['draft'] }));
  const s = loadCastingSheet('romance', { builtinDir: builtin, overlayDir: overlay });
  assert.deepEqual(s?.proseRoles, ['draft'], 'overlay wins');
  assert.equal(loadCastingSheet('nope', { builtinDir: builtin, overlayDir: overlay }), null);
});

test('loadCastingSheet rejects a genre with path-traversal characters and does not read outside the dir', () => {
  const root = mkdtempSync(join(tmpdir(), 'casting-'));
  const builtin = join(root, 'library', 'casting');
  const overlay = join(root, 'workspace', 'library', 'casting');
  mkdirSync(builtin, { recursive: true });
  mkdirSync(overlay, { recursive: true });
  // A file that a "../../" traversal from builtin would reach (two levels up
  // from library/casting lands at root/secret.json).
  writeFileSync(join(root, 'secret.json'), JSON.stringify(SHEET));
  assert.equal(loadCastingSheet('../../secret', { builtinDir: builtin, overlayDir: overlay }), null);
  assert.equal(loadCastingSheet('../../etc/passwd', { builtinDir: builtin, overlayDir: overlay }), null);
});

test('loadCastingSheet caches the resolved sheet per genre+dirs', () => {
  const root = mkdtempSync(join(tmpdir(), 'casting-'));
  const builtin = join(root, 'library', 'casting');
  const overlay = join(root, 'workspace', 'library', 'casting');
  mkdirSync(builtin, { recursive: true });
  mkdirSync(overlay, { recursive: true });
  writeFileSync(join(builtin, 'fantasy.json'), JSON.stringify(SHEET));

  const first = loadCastingSheet('fantasy', { builtinDir: builtin, overlayDir: overlay });
  assert.deepEqual(first?.proseRoles, ['scene_brief', 'draft']);

  // Rewrite the file on disk — a cached load must NOT see this change.
  writeFileSync(join(builtin, 'fantasy.json'), JSON.stringify({ ...SHEET, proseRoles: ['draft'] }));
  const second = loadCastingSheet('fantasy', { builtinDir: builtin, overlayDir: overlay });
  assert.deepEqual(second?.proseRoles, ['scene_brief', 'draft'], 'still the cached value');

  // clearCastingSheetCache() invalidates the cache so the fresh file is read.
  clearCastingSheetCache();
  const third = loadCastingSheet('fantasy', { builtinDir: builtin, overlayDir: overlay });
  assert.deepEqual(third?.proseRoles, ['draft'], 'cache cleared, fresh file read');
});

test('validateCastingSheet coerces a non-numeric role-model temperature to undefined', () => {
  const s = validateCastingSheet({ ...SHEET, roleModels: { draft: { provider: 'openrouter', model: 'x', temperature: '0.7' } } });
  assert.equal(s.roleModels.draft?.temperature, undefined);
});
