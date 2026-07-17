/**
 * Unit tests for the registry seed builder (Task 2): maps bible characters to
 * registry rows, defaults tier, drops blanks, de-dups by canonical.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedRegistryCharacters } from '../../gateway/src/services/registry/seed.js';

test('seed maps bible characters to registry rows, defaulting tier to secondary', () => {
  const rows = seedRegistryCharacters([
    { name: 'Cole', tier: 'primary', role: 'protagonist, baker' },
    { name: 'Angela Marchetti', role: 'the bride' },
  ]);
  assert.deepEqual(rows, [
    { canonical: 'Cole', tier: 'primary', role: 'protagonist, baker', aliases: [], driftMap: [] },
    { canonical: 'Angela Marchetti', tier: 'secondary', role: 'the bride', aliases: [], driftMap: [] },
  ]);
});

test('seed drops blank names and de-dups by canonical (first wins)', () => {
  const rows = seedRegistryCharacters([{ name: '  ' }, { name: 'Cole', role: 'a' }, { name: 'Cole', role: 'b' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'a');
});
