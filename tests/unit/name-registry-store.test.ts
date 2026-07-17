/**
 * Unit tests for the per-book name-registry store (Task 1): fail-soft load,
 * atomic save/round-trip, malformed-JSON tolerance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, saveRegistry } from '../../gateway/src/services/registry/store.js';
import type { NameRegistry } from '../../gateway/src/services/registry/types.js';

test('loadRegistry on an absent file returns an empty registry (fail-soft)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reg-'));
  try {
    assert.deepEqual(loadRegistry(dir), { characters: [], locations: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('saveRegistry then loadRegistry round-trips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reg-'));
  try {
    const reg: NameRegistry = {
      characters: [{ canonical: 'Rosa Marchetti', tier: 'tertiary', role: 'regular customer', aliases: [], driftMap: ['Dottie'], firstChapter: 1 }],
      locations: [],
    };
    saveRegistry(dir, reg);
    assert.deepEqual(loadRegistry(dir), reg);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadRegistry on malformed JSON returns empty (fail-soft, no throw)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reg-'));
  try {
    writeFileSync(join(dir, 'name-registry.json'), '{ not json');
    assert.deepEqual(loadRegistry(dir), { characters: [], locations: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
