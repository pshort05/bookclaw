/**
 * View Book accelerator guard (design §9). The shortcut is a BARE `b`, so the
 * guard is the whole safety story: typing "b" in the raw editor, a chat box or
 * any other text field must never open a board, and a modifier combination
 * belongs to the browser. The predicate is pure so this runs without React or
 * a DOM. Run via: node --import tsx --test tests/unit/book-view-shortcut.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  opensBookView,
  isTextEntryTarget,
} from '../../frontend/studio/src/book-view/useBookViewShortcut.js';

const bare = { key: 'b', metaKey: false, ctrlKey: false, altKey: false, isComposing: false };

test('a bare b outside a text field opens the view', () => {
  assert.equal(opensBookView(bare, null), true);
  assert.equal(opensBookView(bare, { tagName: 'BODY' }), true);
  assert.equal(opensBookView(bare, { tagName: 'BUTTON' }), true);
  assert.equal(opensBookView({ ...bare, key: 'B' }, null), true, 'shift-b still reads as the key');
});

test('another key never opens the view', () => {
  for (const key of ['a', 'v', 'Escape', 'Enter', ' ']) {
    assert.equal(opensBookView({ ...bare, key }, null), false, `${key} must not open the view`);
  }
});

test('a modifier hands the key back to the browser', () => {
  assert.equal(opensBookView({ ...bare, metaKey: true }, null), false, 'Cmd+B is the bookmarks sidebar');
  assert.equal(opensBookView({ ...bare, ctrlKey: true }, null), false, 'Ctrl+B is the bookmarks sidebar');
  assert.equal(opensBookView({ ...bare, altKey: true }, null), false, 'Alt+B is a browser/OS combination');
});

test('an IME composition is typing, not a command', () => {
  assert.equal(opensBookView({ ...bare, isComposing: true }, null), false);
});

test('focus in a text-entry field suppresses the shortcut', () => {
  assert.equal(opensBookView(bare, { tagName: 'INPUT' }), false);
  assert.equal(opensBookView(bare, { tagName: 'TEXTAREA' }), false);
  assert.equal(opensBookView(bare, { tagName: 'textarea' }), false, 'tagName casing must not matter');
  assert.equal(opensBookView(bare, { tagName: 'DIV', isContentEditable: true }), false);
});

test('isTextEntryTarget is tolerant of a missing / odd target', () => {
  assert.equal(isTextEntryTarget(null), false);
  assert.equal(isTextEntryTarget(undefined), false);
  assert.equal(isTextEntryTarget({}), false);
  assert.equal(isTextEntryTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTextEntryTarget({ tagName: 'DIV', isContentEditable: false }), false);
});
