import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnthropicModels } from '../../gateway/src/api/routes/models.routes.js';

test('parseAnthropicModels maps id+display_name and sorts by id', () => {
  const out = parseAnthropicModels({
    data: [
      { type: 'model', id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5' },
      { type: 'model', id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5' },
    ],
  });
  assert.deepEqual(out, [
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
  ]);
});

test('parseAnthropicModels falls back to id when display_name is missing', () => {
  assert.deepEqual(parseAnthropicModels({ data: [{ id: 'claude-x' }] }), [
    { id: 'claude-x', name: 'claude-x' },
  ]);
});

test('parseAnthropicModels drops entries with no usable id and tolerates bad input', () => {
  assert.deepEqual(
    parseAnthropicModels({ data: [{ display_name: 'no id' }, { id: '' }, { id: 5 }] }),
    [],
  );
  assert.deepEqual(parseAnthropicModels({}), []);
  assert.deepEqual(parseAnthropicModels(null), []);
});
