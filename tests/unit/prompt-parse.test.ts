import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrompt } from '../../gateway/src/services/prompt-parse.ts';
test('parsePrompt accepts a valid prompt', () => {
  const p = parsePrompt({ name: 'copy-editor', label: 'Copy Editor', description: 'd', systemPrompt: 'You are a copy editor.', temperature: 0.4 });
  assert.equal(p.name, 'copy-editor');
  assert.equal(p.systemPrompt, 'You are a copy editor.');
  assert.equal(p.schemaVersion, 1);
  assert.equal(p.temperature, 0.4);
});
test('parsePrompt rejects empty + clamps temperature', () => {
  assert.throws(() => parsePrompt({ name: '', systemPrompt: 'x' }));
  assert.throws(() => parsePrompt({ name: 'x', systemPrompt: '' }));
  assert.equal(parsePrompt({ name: 'x', systemPrompt: 'y', temperature: 9 }).temperature, 2);
});
