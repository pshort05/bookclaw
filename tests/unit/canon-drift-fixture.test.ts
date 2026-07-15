import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCanonDriftGate, type CanonGateStep } from '../../gateway/src/services/canon-drift.js';

// Clean seeds.setting anchor as verified against the live project-75 book:
// Surf City / Long Beach Boulevard on LBI; zero "Bay Haven".
const VERIFIED_CANON = `# Verified Canon

## Verified Real-World Geography
The novel is set in Surf City on Long Beach Island (LBI), New Jersey. The main
commercial artery is Long Beach Boulevard, which runs the length of the island.
Surf City faces the Atlantic to the east and Barnegat Bay to the west. The
economy is a compressed summer season.`;

// Real drift the character bible (generated BEFORE setting) introduced:
const DRIFTED_CHARACTER_BIBLE = `# Character Bible

## Mara Whitfield
Mara grew up walking the Bay Haven boardwalk every summer with her grandmother,
selling saltwater taffy from a cart. She still knows every plank of the Bay Haven
boardwalk by heart.

## Daniel Reyes
Daniel returned to town to reopen his father's shop on Long Beach Boulevard.`;

function fixtureSteps(): CanonGateStep[] {
  return [
    { label: 'Setting', skill: 'book-bible', status: 'completed', result: VERIFIED_CANON },
    { label: 'Character Bible', skill: 'book-bible', status: 'completed', result: DRIFTED_CHARACTER_BIBLE },
    { label: 'Canon Audit — Characters', skill: 'romance-canon-audit', status: 'completed', result: '[]' }, // LLM finds nothing extra
    { label: 'Canon Gate — Characters', skill: 'canon-drift-apply', status: 'running' },
  ];
}

test('Gate B removes the invented Bay Haven boardwalk, swapping to Long Beach Boulevard', async () => {
  const steps = fixtureSteps();
  const out = await runCanonDriftGate({
    steps, step: steps[3],
    loadAnchors: async () => [VERIFIED_CANON],
  });
  // The reconciled bible is canonicalized onto the BASE (Character Bible) step —
  // the single copy downstream steps read — not onto the gate step.
  const canonical = steps[1].result!;
  assert.ok(!canonical.includes('Bay Haven'), 'no invented town remains');
  assert.ok(canonical.includes('Long Beach Boulevard'), 'canonical road present');
  assert.equal(out.stats.swaps >= 2, true, 'both Bay Haven mentions swapped'); // 2 occurrences
  assert.equal(out.stats.noAnchor, false);
  assert.equal(out.stats.changed, true);
  // The rest of the bible is untouched (surgical apply).
  assert.ok(canonical.includes('Mara Whitfield') && canonical.includes('saltwater taffy'));
});
