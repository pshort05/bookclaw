/**
 * Unit tests for applyEditsToText (gateway/src/services/consistency/fix-apply.ts):
 * a PURE, deterministic find/replace that requires each oldPhrase to occur EXACTLY
 * ONCE in the current working text. Covers: exact+unique replace; multiple edits in
 * one chapter; not-found skip; ambiguous (non-unique) skip; non-target text byte
 * identical; sequential edits don't corrupt each other; empty edits → unchanged;
 * and that it never throws.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyEditsToText } from '../../gateway/src/services/consistency/fix-apply.js';

const edit = (oldPhrase: string, newPhrase: string, findingId = 'f1') => ({
  findingId,
  oldPhrase,
  newPhrase,
});

describe('applyEditsToText', () => {
  test('replaces an exact, unique oldPhrase', () => {
    const text = 'Her green eyes scanned the room.';
    const r = applyEditsToText(text, [edit('green eyes', 'blue eyes')]);
    assert.equal(r.newText, 'Her blue eyes scanned the room.');
    assert.equal(r.applied.length, 1);
    assert.equal(r.skipped.length, 0);
    assert.deepEqual(r.applied[0], { findingId: 'f1', oldPhrase: 'green eyes', newPhrase: 'blue eyes' });
  });

  test('applies multiple edits in one chapter', () => {
    const text = 'The sword was iron. The cloak was red. The hour was dawn.';
    const r = applyEditsToText(text, [
      edit('iron', 'steel', 'a'),
      edit('red', 'black', 'b'),
      edit('dawn', 'dusk', 'c'),
    ]);
    assert.equal(r.newText, 'The sword was steel. The cloak was black. The hour was dusk.');
    assert.equal(r.applied.length, 3);
    assert.equal(r.skipped.length, 0);
  });

  test('skips a not-found oldPhrase with reason "not-found"', () => {
    const text = 'The castle stood on the hill.';
    const r = applyEditsToText(text, [edit('the dragon', 'the wyrm')]);
    assert.equal(r.newText, text);
    assert.equal(r.applied.length, 0);
    assert.equal(r.skipped.length, 1);
    assert.deepEqual(r.skipped[0], { findingId: 'f1', oldPhrase: 'the dragon', reason: 'not-found' });
  });

  test('skips a non-unique (ambiguous) oldPhrase with reason "ambiguous"', () => {
    const text = 'The wall was tall. The wall was grey.';
    const r = applyEditsToText(text, [edit('The wall', 'The gate')]);
    assert.equal(r.newText, text);
    assert.equal(r.applied.length, 0);
    assert.equal(r.skipped.length, 1);
    assert.deepEqual(r.skipped[0], { findingId: 'f1', oldPhrase: 'The wall', reason: 'ambiguous' });
  });

  test('leaves text outside the replaced phrase byte-identical', () => {
    const text = 'Prefix unchanged. TARGET. Suffix also unchanged.';
    const r = applyEditsToText(text, [edit('TARGET', 'CHANGED')]);
    assert.equal(r.newText, 'Prefix unchanged. CHANGED. Suffix also unchanged.');
    // Everything before the target index and after the replacement is identical.
    assert.ok(r.newText.startsWith('Prefix unchanged. '));
    assert.ok(r.newText.endsWith('. Suffix also unchanged.'));
  });

  test('sequential edits do not corrupt each other', () => {
    // After the first edit makes "alpha" unique-removed, the second edit's
    // anchor still resolves uniquely against the updated text.
    const text = 'one alpha two beta three';
    const r = applyEditsToText(text, [
      edit('alpha', 'ALPHA', 'a'),
      edit('beta', 'BETA', 'b'),
    ]);
    assert.equal(r.newText, 'one ALPHA two BETA three');
    assert.equal(r.applied.length, 2);
  });

  test('an edit can become applicable only after a prior edit', () => {
    // "xx" appears twice initially (ambiguous), but replacing the first
    // occurrence via a more specific anchor leaves "xx" unique for the next edit.
    const text = 'start AxxB then xx end';
    const r = applyEditsToText(text, [
      edit('AxxB', 'AyyB', 'a'),
      edit('xx', 'zz', 'b'),
    ]);
    assert.equal(r.newText, 'start AyyB then zz end');
    assert.equal(r.applied.length, 2);
    assert.equal(r.skipped.length, 0);
  });

  test('empty edits leaves text unchanged', () => {
    const text = 'Nothing to do here.';
    const r = applyEditsToText(text, []);
    assert.equal(r.newText, text);
    assert.equal(r.applied.length, 0);
    assert.equal(r.skipped.length, 0);
  });

  test('never throws on odd input', () => {
    assert.doesNotThrow(() => applyEditsToText('', [edit('x', 'y')]));
    assert.doesNotThrow(() => applyEditsToText('abc', [edit('', 'y')]));
  });
});
