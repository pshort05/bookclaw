import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsafeEditReason } from '../../gateway/src/services/deai/validate-edit.js';

test('rejects the real de-AI corruptions', () => {
  // Proper-noun / POV-intrusion (ch16/18/20): a name appears that wasn't in the find.
  assert.match(unsafeEditReason('I said nothing', 'Addi said nothing')!, /proper noun "addi"/);
  // First → third person flip.
  assert.match(unsafeEditReason('I walk to the door', 'she walks to the door')!, /first-person to third/);
  // Duplicated word (ch17 "involuntary, involuntary").
  assert.match(unsafeEditReason('an involuntary shiver', 'an involuntary, involuntary shiver')!, /duplicates/);
  // Number injection (age "thirty-one" for a 27-year-old).
  assert.match(unsafeEditReason('a young man', 'a thirty-one-year-old man')!, /number "thirty-one"/);
  assert.match(unsafeEditReason('years old', '31 years old')!, /number "31"/);
});

test('allows legitimate de-AI rephrases (no false positives)', () => {
  assert.equal(unsafeEditReason("let out a breath she didn't know she was holding", 'exhaled'), null);
  assert.equal(unsafeEditReason('the specific way he moved', 'how he moved'), null);
  assert.equal(unsafeEditReason('a warmth spread through her chest', 'warmth spread through her'), null);
  // Keeps the same name -> fine.
  assert.equal(unsafeEditReason('Cole watched her, the way he always did', 'Cole watched her'), null);
  // A sentence-initial capital that is not a name (adverb) is allowed.
  assert.equal(unsafeEditReason('and then the door opened', 'Suddenly the door opened'), null);
});

test('catches a POV flip in a mixed-person sentence (HIGH #1)', () => {
  // First-person narration mixes persons ("I ... her ..."); the pure-person check
  // missed this. The narrator "I" is flipped to a third-person subject.
  assert.match(unsafeEditReason('I reached for her hand', 'She reached for her hand')!, /first-person to third/);
  // Sentence-initial, capitalized first-person pronoun (case-insensitive detection, #3).
  assert.match(unsafeEditReason('We left the house', 'They left the house')!, /first-person to third/);
  // A first-person narrator displaced by a name at sentence start.
  assert.match(unsafeEditReason('I said nothing', 'Addi said nothing')!, /proper noun "addi"/);
});

test('catches a third→first flip (#1)', () => {
  assert.match(unsafeEditReason('she walked to the door', 'I walked to the door')!, /third-person to first/);
});

test('does not flag sentence-initial common words as injected names (#5)', () => {
  assert.equal(unsafeEditReason('and the room was warm', 'Warmth filled the room'), null);
  assert.equal(unsafeEditReason('he moved quickly', 'Quickly he moved'), null);
  assert.equal(unsafeEditReason('the door opened slowly', 'Slowly the door opened'), null);
});
