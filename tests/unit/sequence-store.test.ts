import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../gateway/src/services/sequence-parse.ts';

test('parseSequence accepts a valid sequence', () => {
  const s = parseSequence({ name: 'novel', label: 'Novel', pipelines: ['book-planning', 'book-production'] });
  assert.deepEqual(s.pipelines, ['book-planning', 'book-production']);
  assert.equal(s.schemaVersion, 1);
});
test('parseSequence rejects empty/invalid pipelines', () => {
  assert.throws(() => parseSequence({ name: 'x', pipelines: [] }));
  assert.throws(() => parseSequence({ name: 'x', pipelines: ['ok', 3] as any }));
  assert.throws(() => parseSequence({ name: 'x' } as any));
});
