/**
 * Regression: an accepted phrase must match regardless of the casing stored.
 *
 * `acceptedPlacePhrases` returns the phrase as the author's confirmation
 * carried it, out of a durable per-book JSON store that survives restarts and
 * redeploys. `entityGate`'s known-set test used `normPhrase` (whitespace only),
 * while `canonDriftAudit`'s LLM-edit filter lowercased — so the two halves of
 * one feature disagreed, and a stored phrase whose casing differed from the
 * scan's would silently go on being flagged after the author accepted it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entityGate } from '../../gateway/src/services/canon-drift.js';

const ANCHOR = 'Summitville Village and Wurtsboro Village are here.';
const DOC = 'They drove into Botany Village.';

for (const stored of ['Botany Village', 'botany village', 'BOTANY VILLAGE', '  Botany   Village  ']) {
  test(`an accepted phrase stored as ${JSON.stringify(stored)} stops being flagged`, () => {
    const r = entityGate(DOC, [ANCHOR], [stored]);
    assert.deepEqual(r.ambiguous, [], 'the accepted place must not raise a gate');
    assert.deepEqual(r.unverifiable, []);
    assert.deepEqual(r.edits, [], 'accepting must never make it a swap target');
  });
}

test('a DIFFERENT place is still flagged when one is accepted', () => {
  const r = entityGate('They drove from Botany Village to Pine Cove Village.', [ANCHOR], ['BOTANY VILLAGE']);
  assert.equal(r.ambiguous.length, 1);
  assert.match(r.ambiguous[0].phrase, /Pine Cove Village/i);
});
