/**
 * Unit tests for the pure editor-command helpers: parseEditorCommand (turns the
 * `/editor …` argument string into an intent) and buildEditorMenu (renders the
 * numbered selection menu). Both are pure so the index.ts command handler stays a
 * thin adapter over them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEditorCommand, buildEditorMenu, resolveMode, editorNumberSelection } from '../../gateway/src/services/editor-command.ts';

test('bare args request the menu', () => {
  assert.deepEqual(parseEditorCommand(''), { kind: 'show' });
  assert.deepEqual(parseEditorCommand('   '), { kind: 'show' });
});

test('off / none / exit clear the session', () => {
  for (const w of ['off', 'none', 'exit', 'OFF']) {
    assert.deepEqual(parseEditorCommand(w), { kind: 'off' });
  }
});

test('a name with no mode asks for the mode and preserves the book token', () => {
  assert.deepEqual(parseEditorCommand('maeve'), { kind: 'need-mode', name: 'maeve', withBook: false });
  assert.deepEqual(parseEditorCommand('Maeve book'), { kind: 'need-mode', name: 'maeve', withBook: true });
});

test('a name with a recognized mode enters that mode', () => {
  assert.deepEqual(parseEditorCommand('maeve brainstorm'), { kind: 'enter', name: 'maeve', mode: 'brainstorm', withBook: false });
  assert.deepEqual(parseEditorCommand('maeve critique book'), { kind: 'enter', name: 'maeve', mode: 'critique', withBook: true });
});

test('mode synonyms resolve', () => {
  assert.equal(resolveMode('bs'), 'brainstorm');
  assert.equal(resolveMode('ideas'), 'brainstorm');
  assert.equal(resolveMode('edit'), 'critique');
  assert.equal(resolveMode('review'), 'critique');
  assert.equal(resolveMode('nonsense'), null);
});

test('an unrecognized second token is treated as no mode given', () => {
  assert.deepEqual(parseEditorCommand('maeve sideways'), { kind: 'need-mode', name: 'maeve', withBook: false });
});

test('buildEditorMenu numbers editors with name, specialty, and both commands', () => {
  const menu = buildEditorMenu(
    [
      { name: 'rosalind', label: 'Rosalind — Romance Editor', specialty: 'Contemporary Romance' },
      { name: 'maeve', label: 'Maeve — Romantasy Editor', specialty: 'Romantasy' },
    ],
    null,
  );
  assert.ok(menu.includes('1.'));
  assert.ok(menu.includes('Rosalind'));
  assert.ok(menu.includes('Contemporary Romance'));
  assert.ok(menu.includes('2.'));
  assert.ok(menu.includes('Romantasy'));
  assert.ok(menu.includes('/editor rosalind brainstorm'));
  assert.ok(menu.includes('/editor rosalind critique'));
});

test('buildEditorMenu falls back to label when no specialty, and notes the active editor', () => {
  const menu = buildEditorMenu(
    [{ name: 'neil', label: 'Neil Ashford — Hard-SF Developmental Editor' }],
    { editor: 'neil', mode: 'critique', label: 'Neil Ashford — Hard-SF Developmental Editor' },
  );
  assert.ok(menu.includes('Neil Ashford'));
  assert.ok(/critique/i.test(menu));
});

test('buildEditorMenu reports when none exist', () => {
  assert.ok(/no editors/i.test(buildEditorMenu([], null)));
});

test('editorNumberSelection: a bare number after the menu picks the Nth editor (1-based)', () => {
  const names = ['lily', 'maeve', 'neil', 'rosalind', 'sarah', 'world-author', 'fanfiction', 'luminarch-adept'];
  assert.equal(editorNumberSelection(names, '7'), 'fanfiction');
  assert.equal(editorNumberSelection(names, '1'), 'lily');
  assert.equal(editorNumberSelection(names, ' 8 '), 'luminarch-adept');
  assert.equal(editorNumberSelection(names, '#7'), 'fanfiction');
  // out of range / non-numeric / empty → null (falls through to normal chat)
  assert.equal(editorNumberSelection(names, '9'), null);
  assert.equal(editorNumberSelection(names, '0'), null);
  assert.equal(editorNumberSelection(names, 'write the next chapter'), null);
  assert.equal(editorNumberSelection(names, ''), null);
  assert.equal(editorNumberSelection(names, '7 please'), null);
});
