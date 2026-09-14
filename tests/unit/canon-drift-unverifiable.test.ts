import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entityGate, canonDriftAudit, runCanonDriftGate, type CanonGateStep } from '../../gateway/src/services/canon-drift.js';

// The live production anchor shape: a grounded hamlet with NO road list at all.
// (Phillipsport, NY — the real book's anchor; the grounding sources name towns but
// not a single street.)
const HAMLET_NO_ROADS = `## Verified Canon
The grounded anchor is Phillipsport Village in Sullivan County, on the old
Delaware and Hudson Canal.`;

// The same anchor family, but with the four candidate towns the live gate reported.
const HAMLET_FOUR_TOWNS = `## Verified Canon
Grounded in Phillipsport Village, Sullivan County. Nearby: Summitville Village,
Wurtsboro Village, Ellenville City.`;

// One town, one road — the original fixture shape, where an unknown road has a
// single canonical target and is swapped automatically.
const SINGLE_ROAD_ANCHOR = `## Setting
The story is set in Surf City on Long Beach Island. Scenes unfold along
Long Beach Boulevard, the main road through town.`;

test('regression: an anchor with ZERO roads makes real streets unverifiable, not ambiguous', () => {
  // The live bug: 16 of the 17 flags were genuine Manhattan/Queens streets reported
  // as drift purely because the rural anchor lists no roads. There is nothing to
  // reconcile them TO, so they must never reach the author-facing gate.
  const doc = 'She walked from Ludlow Street to Delancey Street, then took Queens Boulevard home.';
  const r = entityGate(doc, [HAMLET_NO_ROADS]);
  assert.deepEqual(r.ambiguous, [], 'zero-candidate places are not author-facing conflicts');
  assert.deepEqual(r.edits, [], 'and nothing is auto-swapped either');
  assert.deepEqual(r.unverifiable.map(u => u.phrase).sort(),
    ['Delancey Street', 'Ludlow Street', 'Queens Boulevard']);
  assert.match(r.unverifiable[0].reason, /unverifiable road/);
  assert.match(r.unverifiable[0].reason, /anchor lists no roads/);
});

// These two guard UNCHANGED behaviour, so the pre-existing assertions come first:
// a regression in the swap/ambiguous behaviour must be what fails, not the shape
// assertion on the new `unverifiable` field.
test('an anchor with exactly one road still auto-swaps (unchanged behaviour)', () => {
  const doc = 'They walked the Bay Haven boardwalk at sunset, hand in hand.';
  const r = entityGate(doc, [SINGLE_ROAD_ANCHOR]);
  assert.equal(r.edits.length, 1);
  assert.equal(r.edits[0].replace, 'Long Beach Boulevard');
  assert.deepEqual(r.ambiguous, []);
  assert.deepEqual(r.unverifiable, []);
});

test('several candidate towns + an unknown town is still ambiguous (the human decides)', () => {
  const doc = 'The bus stopped in Botany Village before dusk.';
  const r = entityGate(doc, [HAMLET_FOUR_TOWNS]);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0].phrase, 'Botany Village');
  assert.match(r.ambiguous[0].reason, /4 candidate towns/);
  assert.deepEqual(r.unverifiable, [], 'the anchor DOES know towns — this is not unverifiable');
});

test('mixed pass: zero roads → unverifiable, several towns → ambiguous', () => {
  const doc = 'She drove from Botany Village down Ludlow Street to the canal.';
  const r = entityGate(doc, [HAMLET_FOUR_TOWNS]);
  assert.deepEqual(r.ambiguous.map(a => a.phrase), ['Botany Village']);
  assert.deepEqual(r.unverifiable.map(u => u.phrase), ['Ludlow Street']);
  assert.deepEqual(r.edits, []);
});

test('canonDriftAudit surfaces the unverifiable channel alongside ambiguous', () => {
  const doc = 'She walked Ludlow Street to Botany Village.';
  const r = canonDriftAudit(doc, [HAMLET_FOUR_TOWNS], '[]');
  assert.deepEqual(r.ambiguous.map(a => a.phrase), ['Botany Village']);
  assert.deepEqual(r.unverifiable.map(u => u.phrase), ['Ludlow Street']);
});

function stepsFor(bibleText: string, anchor: string): CanonGateStep[] {
  return [
    { label: 'Setting', skill: 'book-bible', status: 'completed', result: anchor },
    { label: 'Character Bible', skill: 'book-bible', status: 'completed', result: bibleText },
    { label: 'Canon Audit', skill: 'romance-canon-audit', status: 'completed', result: '[]' },
    { label: 'Canon Gate', skill: 'canon-drift-apply', status: 'running' },
  ];
}

test('gate runner: unverifiable places never reach onAmbiguous and are counted separately', async () => {
  const bible = 'She drove from Botany Village down Ludlow Street past Delancey Street.';
  const s = stepsFor(bible, HAMLET_FOUR_TOWNS);
  const seen: string[] = [];
  const out = await runCanonDriftGate({
    steps: s, step: s[3], loadAnchors: async () => [HAMLET_FOUR_TOWNS],
    onAmbiguous: async (c) => { seen.push(...c.map(x => x.phrase)); },
  });
  assert.deepEqual(seen, ['Botany Village'], 'only the genuinely ambiguous town gates the author');
  assert.equal(out.stats.ambiguous, 1);
  assert.equal(out.stats.unverifiable, 2, 'both streets counted on the advisory channel');
  assert.equal(s[1].result, bible, 'nothing auto-edited');
  assert.match(out.text, /2 unverifiable/);
});

test('gate runner: an all-unverifiable pass calls onAmbiguous not at all', async () => {
  const bible = 'She walked from Ludlow Street to Delancey Street.';
  const s = stepsFor(bible, HAMLET_NO_ROADS);
  let calls = 0;
  const out = await runCanonDriftGate({
    steps: s, step: s[3], loadAnchors: async () => [HAMLET_NO_ROADS],
    onAmbiguous: async () => { calls++; },
  });
  assert.equal(calls, 0, 'the author is never gated when there is no basis to judge');
  assert.equal(out.stats.ambiguous, 0);
  assert.equal(out.stats.unverifiable, 2);
});

test('gate runner: the summary NAMES the unverifiable phrases, capped at 8', async () => {
  // The summary IS the gate step's result in the UI, and a bare count tells the
  // author nothing they can act on.
  const bible = 'She walked Ludlow Street, then Delancey Street, then Bleecker Street.';
  const s = stepsFor(bible, HAMLET_NO_ROADS);
  const out = await runCanonDriftGate({ steps: s, step: s[3], loadAnchors: async () => [HAMLET_NO_ROADS] });
  for (const p of ['Ludlow Street', 'Delancey Street', 'Bleecker Street']) assert.match(out.text, new RegExp(p));
  assert.doesNotMatch(out.text, /more/, 'three findings fit — no truncation notice');

  // Twelve findings → the first 8 by name plus a "+4 more" tail.
  const many = Array.from({ length: 12 }, (_, i) => `Road${String.fromCharCode(65 + i)} Street`);
  const s2 = stepsFor(`She walked ${many.join(', then ')}.`, HAMLET_NO_ROADS);
  const out2 = await runCanonDriftGate({ steps: s2, step: s2[3], loadAnchors: async () => [HAMLET_NO_ROADS] });
  assert.equal(out2.stats.unverifiable, 12);
  for (const p of many.slice(0, 8)) assert.match(out2.text, new RegExp(p));
  assert.match(out2.text, /\+4 more/);
  assert.doesNotMatch(out2.text, new RegExp(many[11]), 'the tail is summarised, not listed');
});

test('gate runner: no-anchor no-op reports zero unverifiable', async () => {
  const s = stepsFor('She walked Ludlow Street.', HAMLET_NO_ROADS);
  const out = await runCanonDriftGate({ steps: s, step: s[3], loadAnchors: async () => [] });
  assert.equal(out.stats.noAnchor, true);
  assert.equal(out.stats.unverifiable, 0);
});
