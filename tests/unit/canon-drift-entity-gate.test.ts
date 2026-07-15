import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPlaces, entityGate } from '../../gateway/src/services/canon-drift.js';

const ANCHOR = `## Setting
The story is set in Surf City on Long Beach Island. Scenes unfold along
Long Beach Boulevard, the main road through town. The Rusty Anchor Cafe sits
on the boulevard near the marina.`;

test('extractPlaces pulls town + road names, ignoring businesses', () => {
  const p = extractPlaces(ANCHOR);
  assert.ok(p.towns.includes('Surf City'), 'Surf City is a town');
  assert.ok(p.roads.includes('Long Beach Boulevard'), 'the boulevard is a road');
  assert.ok(!p.towns.includes('Rusty Anchor Cafe') && !p.roads.includes('Rusty Anchor Cafe'),
    'a fictional business is not a place');
});

test('entityGate flags an unknown road-class place and swaps to the anchor road', () => {
  const doc = 'They walked the Bay Haven boardwalk at sunset, hand in hand.';
  const r = entityGate(doc, [ANCHOR]);
  assert.equal(r.ambiguous.length, 0);
  assert.equal(r.edits.length, 1);
  assert.deepEqual(r.edits[0], {
    op: 'swap',
    find: 'Bay Haven boardwalk',
    replace: 'Long Beach Boulevard',
    reason: 'canon-drift: "Bay Haven boardwalk" is not in the verified place list; nearest canonical road is Long Beach Boulevard',
  });
});

test('entityGate passes a clean doc (no unknown places)', () => {
  const doc = 'They strolled down Long Beach Boulevard in Surf City.';
  assert.deepEqual(entityGate(doc, [ANCHOR]).edits, []);
});

test('entityGate ignores fictional business names (not a discrepancy)', () => {
  const doc = 'They shared coffee at the Driftwood Bakery on the boulevard.';
  assert.deepEqual(entityGate(doc, [ANCHOR]).edits, []);
});

test('entityGate no-ops when there is no anchor text (fail-soft)', () => {
  assert.deepEqual(entityGate('Anywhere in Bay Haven.', []).edits, []);
  assert.deepEqual(entityGate('Anywhere in Bay Haven.', ['']).edits, []);
});

test('entityGate does NOT flag bare cue words or determiner-led common nouns', () => {
  // Beach-romance prose is full of these; none is an invented place, so none may be
  // swapped. Before the fix each was misread as an unknown road/town and rewritten.
  const doc = 'The Boardwalk was empty. She loved the Island in winter. The Bay glittered. The Pier creaked.';
  assert.deepEqual(entityGate(doc, [ANCHOR]).edits, []);
});

test('entityGate keeps a KNOWN place written with a leading determiner (no false positive)', () => {
  const doc = 'The Surf City council met on Long Beach Boulevard.';
  assert.deepEqual(entityGate(doc, [ANCHOR]).edits, []);
});
