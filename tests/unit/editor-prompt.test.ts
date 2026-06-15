/**
 * Unit tests for composeEditorPrompt: the pure helper that frames an editor
 * persona as the system prompt while in editor mode. It must surface the editor
 * persona, optionally append a "Active book context" block (and only when a
 * non-empty manuscript is supplied), and never inject the author soul.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeEditorPrompt } from '../../gateway/src/services/editor-prompt.ts';

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
