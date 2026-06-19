import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEditor } from '../../gateway/src/services/editor-parse.ts';

test('parseEditor accepts a valid editor', () => {
  const e = parseEditor({ name: 'maeve', label: 'Maeve', description: 'd', systemPrompt: 'You are Maeve.', temperature: 0.8 });
  assert.equal(e.name, 'maeve');
  assert.equal(e.systemPrompt, 'You are Maeve.');
  assert.equal(e.schemaVersion, 1);
  assert.equal(e.temperature, 0.8);
});
test('parseEditor rejects empty name or systemPrompt and clamps temperature', () => {
  assert.throws(() => parseEditor({ name: '', systemPrompt: 'x' }));
  assert.throws(() => parseEditor({ name: 'x', systemPrompt: '' }));
  assert.equal(parseEditor({ name: 'x', systemPrompt: 'y', temperature: 9 }).temperature, 2);
});
test('parseEditor passes through specialty when present and omits it otherwise', () => {
  assert.equal(parseEditor({ name: 'x', systemPrompt: 'y', specialty: '  Romantasy  ' }).specialty, 'Romantasy');
  assert.equal(parseEditor({ name: 'x', systemPrompt: 'y' }).specialty, undefined);
});
