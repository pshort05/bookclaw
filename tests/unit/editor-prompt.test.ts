/**
 * Unit tests for composeEditorPrompt: the pure helper that frames an editor
 * persona as the system prompt while in editor mode. It must surface the editor
 * persona, optionally append a "Active book context" block (and only when a
 * non-empty manuscript is supplied), and never inject the author soul.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeEditorPrompt, MODE_DIRECTIVE } from '../../gateway/src/services/editor-prompt.ts';

test('composeEditorPrompt surfaces the editor persona', () => {
  const out = composeEditorPrompt('You are Maeve.', {});
  assert.ok(out.includes('You are Maeve.'));
  assert.ok(!out.includes('Active book context'));
});

test('composeEditorPrompt appends the manuscript block when provided', () => {
  const out = composeEditorPrompt('You are Maeve.', { manuscript: 'A rebel sky-sailor.' });
  assert.ok(out.includes('You are Maeve.'));
  assert.ok(out.includes('Active book context'));
  assert.ok(out.includes('A rebel sky-sailor.'));
});

test('composeEditorPrompt adds nothing for an empty manuscript', () => {
  const out = composeEditorPrompt('You are Maeve.', { manuscript: '   ' });
  assert.ok(!out.includes('Active book context'));
});

test('composeEditorPrompt appends memory and heartbeat when present', () => {
  const out = composeEditorPrompt('You are Maeve.', { memories: 'prior chat', heartbeat: 'status line' });
  assert.ok(out.includes('Recent conversation context'));
  assert.ok(out.includes('prior chat'));
  assert.ok(out.includes('status line'));
});

test('composeEditorPrompt defaults to the brainstorm directive', () => {
  const out = composeEditorPrompt('You are Maeve.', {});
  assert.ok(out.includes(MODE_DIRECTIVE.brainstorm));
  assert.ok(!out.includes(MODE_DIRECTIVE.critique));
});

test('composeEditorPrompt appends the critique directive when mode is critique', () => {
  const out = composeEditorPrompt('You are Maeve.', {}, 'critique');
  assert.ok(out.includes(MODE_DIRECTIVE.critique));
  assert.ok(!out.includes(MODE_DIRECTIVE.brainstorm));
});

test('composeEditorPrompt places the mode directive after the persona and before context', () => {
  const out = composeEditorPrompt('You are Maeve.', { memories: 'prior chat' }, 'brainstorm');
  const personaAt = out.indexOf('You are Maeve.');
  const directiveAt = out.indexOf(MODE_DIRECTIVE.brainstorm);
  const memoryAt = out.indexOf('Recent conversation context');
  assert.ok(personaAt >= 0 && directiveAt > personaAt, 'directive follows persona');
  assert.ok(memoryAt > directiveAt, 'context follows the directive');
});

test('composeEditorPrompt injects the worldContext section when provided', () => {
  const out = composeEditorPrompt('You are Jorin.', { worldContext: 'FORMAT: narrative only' });
  assert.ok(out.includes('# World authoring context'));
  assert.ok(out.includes('FORMAT: narrative only'));
});

test('composeEditorPrompt adds nothing for absent or blank worldContext', () => {
  const outAbsent = composeEditorPrompt('You are Jorin.', {});
  assert.ok(!outAbsent.includes('# World authoring context'));
  const outBlank = composeEditorPrompt('You are Jorin.', { worldContext: '   ' });
  assert.ok(!outBlank.includes('# World authoring context'));
});

test('composeEditorPrompt places worldContext after manuscript and before memories', () => {
  const out = composeEditorPrompt('You are Jorin.', {
    manuscript: 'BOOK',
    worldContext: 'WORLD',
    memories: 'MEM',
  });
  const bookAt = out.indexOf('# Active book context');
  const worldAt = out.indexOf('# World authoring context');
  const memAt = out.indexOf('# Recent conversation context');
  assert.ok(bookAt >= 0, '# Active book context present');
  assert.ok(worldAt > bookAt, '# World authoring context follows Active book context');
  assert.ok(memAt > worldAt, '# Recent conversation context follows World authoring context');
});
