import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY_KINDS } from '../../gateway/src/services/library-types.js';
import { WORLD_SCHEMA_VERSION } from '../../gateway/src/services/world-types.js';

test("'world' is a registered library kind", () => {
  assert.ok(LIBRARY_KINDS.includes('world' as never), "LIBRARY_KINDS must include 'world'");
});

test('WORLD_SCHEMA_VERSION is 1', () => {
  assert.equal(WORLD_SCHEMA_VERSION, 1);
});
