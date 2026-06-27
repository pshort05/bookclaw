import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenRouterModels } from '../../gateway/src/api/routes/models.routes.js';

test('parseOpenRouterModels maps id+name and sorts by id', () => {
  const out = parseOpenRouterModels({
    data: [
      { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
      { id: 'anthropic/claude-3.7-sonnet', name: 'Anthropic: Claude 3.7 Sonnet' },
    ],
  });
  assert.deepEqual(out, [
    { id: 'anthropic/claude-3.7-sonnet', name: 'Anthropic: Claude 3.7 Sonnet' },
    { id: 'openai/gpt-4o', name: 'OpenAI: GPT-4o' },
  ]);
});

test('parseOpenRouterModels falls back to id when name is missing', () => {
  const out = parseOpenRouterModels({ data: [{ id: 'x/y' }] });
  assert.deepEqual(out, [{ id: 'x/y', name: 'x/y' }]);
});

test('parseOpenRouterModels drops entries with no usable id and tolerates bad input', () => {
  assert.deepEqual(parseOpenRouterModels({ data: [{ name: 'no id' }, { id: '' }, { id: 5 }] }), []);
  assert.deepEqual(parseOpenRouterModels({}), []);
  assert.deepEqual(parseOpenRouterModels(null), []);
});
