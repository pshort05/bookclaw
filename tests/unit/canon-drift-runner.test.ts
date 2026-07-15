import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runCanonDriftGate, type CanonGateStep } from '../../gateway/src/services/canon-drift.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ANCHOR = 'Set in Surf City. Main road: Long Beach Boulevard.';

function stepsFor(bibleText: string, auditJson: string): CanonGateStep[] {
  return [
    { label: 'Setting', skill: 'book-bible', status: 'completed', result: ANCHOR },
    { label: 'Character Bible', skill: 'book-bible', status: 'completed', result: bibleText },
    { label: 'Canon Audit', skill: 'romance-canon-audit', status: 'completed', result: auditJson },
    { label: 'Canon Gate', skill: 'canon-drift-apply', status: 'running' },
  ];
}

test('canonicalizes the base bible IN PLACE; the gate step returns only a summary', async () => {
  const bible = 'She loved the Bay Haven boardwalk. They met nine years ago.';
  const audit = '[{"op":"swap","find":"nine years ago","replace":"last June","reason":"timeline"}]';
  const s = stepsFor(bible, audit);
  const out = await runCanonDriftGate({
    steps: s, step: s[3], loadAnchors: async () => [ANCHOR],
  });
  // The reconciled bible lives on the BASE step (what buildProjectContext feeds
  // downstream) — NOT on the gate step, which now carries a short summary so the
  // whole bible isn't duplicated into every later step's context.
  assert.ok(!s[1].result!.includes('Bay Haven'), 'drift removed from the canonical (base) bible');
  assert.ok(s[1].result!.includes('Long Beach Boulevard'), 'swapped to canonical road');
  assert.ok(s[1].result!.includes('last June'), 'LLM edit applied');
  assert.ok(!out.text.includes('Bay Haven boardwalk'), 'gate summary does not re-emit the drifted bible');
  assert.match(out.text, /reconciled/i);
  assert.equal(out.stats.swaps, 2);
  assert.equal(out.stats.changed, true);
});

test('no anchor → base doc left untouched, flags noAnchor (fail-soft)', async () => {
  const bible = 'She loved the Bay Haven boardwalk.';
  const s = stepsFor(bible, '[]');
  const out = await runCanonDriftGate({ steps: s, step: s[3], loadAnchors: async () => [] });
  assert.equal(s[1].result, bible);           // base unchanged
  assert.equal(out.stats.noAnchor, true);
  assert.equal(out.stats.changed, false);
});

test('ambiguous conflict is routed to onAmbiguous, not auto-applied', async () => {
  const anchor = 'Set in Surf City and Beach Haven.'; // two towns
  const bible = 'They drove to Cedar Cove.';
  const s = stepsFor(bible, '[]'); s[0].result = anchor;
  const seen: string[] = [];
  const out = await runCanonDriftGate({
    steps: s, step: s[3], loadAnchors: async () => [anchor],
    onAmbiguous: async (c) => { seen.push(...c.map(x => x.phrase)); },
  });
  assert.equal(s[1].result, bible);         // Cedar Cove NOT auto-edited
  assert.deepEqual(seen, ['Cedar Cove']);   // routed to the gate
  assert.equal(out.stats.ambiguous, 1);
});

test('loadAnchors throwing does not blow up the pipeline (fail-soft)', async () => {
  const bible = 'She loved the Bay Haven boardwalk.';
  const s = stepsFor(bible, '[]');
  const out = await runCanonDriftGate({ steps: s, step: s[3], loadAnchors: async () => { throw new Error('disk'); } });
  assert.equal(s[1].result, bible);
  assert.equal(out.stats.noAnchor, true);
});

test('a place repeated identically is fully swapped — no leftover drift', async () => {
  const anchor = 'Set in Surf City. Main road: Long Beach Boulevard.';
  const bible = 'She loved Bay Haven. Bay Haven was always home.';
  const s = stepsFor(bible, '[]'); s[0].result = anchor;
  const out = await runCanonDriftGate({ steps: s, step: s[3], loadAnchors: async () => [anchor] });
  assert.ok(!s[1].result!.includes('Bay Haven'), 'BOTH occurrences swapped in the canonical bible');
  assert.equal(out.stats.swaps, 2);
});

test('#6: canonicalization rewrites the base step + its archival file; the drifted phrase is gone from what downstream reads', async () => {
  const anchor = 'Set in Surf City. Main road: Long Beach Boulevard.';
  const bible = 'She loved the Bay Haven boardwalk.';
  const s = stepsFor(bible, '[]'); s[0].result = anchor;
  (s[1] as any).id = 'p1-step-2';
  const persisted: Array<{ id?: string; text: string }> = [];
  const out = await runCanonDriftGate({
    steps: s, step: s[3], loadAnchors: async () => [anchor],
    persistCanonical: async (step, text) => { persisted.push({ id: step.id, text }); },
  });
  // Base step (the ONLY copy buildProjectContext feeds downstream) is reconciled…
  assert.ok(!s[1].result!.includes('Bay Haven'));
  // …the gate step's own result is a short summary, not a second copy of the bible…
  assert.ok(out.text.length < s[1].result!.length + 200);
  assert.ok(!out.text.includes('Bay Haven boardwalk'));
  // …and the archival file is rewritten with the SAME canonical text.
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].id, 'p1-step-2');
  assert.ok(!persisted[0].text.includes('Bay Haven'));
});

test('#6: no change → base untouched and persistCanonical NOT called (no disk churn)', async () => {
  const anchor = 'Set in Surf City. Main road: Long Beach Boulevard.';
  const bible = 'She strolled down Long Beach Boulevard in Surf City.'; // already clean
  const s = stepsFor(bible, '[]'); s[0].result = anchor;
  let calls = 0;
  const out = await runCanonDriftGate({
    steps: s, step: s[3], loadAnchors: async () => [anchor],
    persistCanonical: async () => { calls++; },
  });
  assert.equal(s[1].result, bible);
  assert.equal(calls, 0);
  assert.equal(out.stats.changed, false);
});

test('Gate A: the setting bible does not anchor itself; drift vs verified-canon is caught', async () => {
  const verified = 'Verified geography: Surf City on LBI. Main road Long Beach Boulevard.';
  const settingBible = 'The town of Bay Haven sits on the shore.'; // invented town in the SETTING bible
  const steps: CanonGateStep[] = [
    { label: 'Setting', skill: 'book-bible', status: 'completed', result: settingBible },
    { label: 'Canon Audit — Setting', skill: 'romance-canon-audit', status: 'completed', result: '[]' },
    { label: 'Canon Gate — Setting', skill: 'canon-drift-apply', status: 'running' },
  ];
  // loadAnchors mirrors the dispatch site: verified-canon PLUS the completed Setting
  // step — which, for Gate A, is the base doc and must not anchor itself.
  const out = await runCanonDriftGate({
    steps, step: steps[2], loadAnchors: async () => [verified, settingBible],
  });
  assert.ok(!steps[0].result!.includes('Bay Haven'), 'invented setting town reconciled to verified canon');
  assert.equal(out.stats.noAnchor, false);
  assert.equal(out.stats.swaps, 1);
});

test('Gate B does not apply the setting-audit edit list to the character bible', async () => {
  const anchor = 'Set in Surf City. Main road: Long Beach Boulevard.';
  const settingAudit = '[{"op":"swap","find":"grew up","replace":"WRONG-SETTING-EDIT","reason":"x"}]';
  const charBible = 'Mara grew up in Surf City.';
  const steps: CanonGateStep[] = [
    { label: 'Setting', skill: 'book-bible', status: 'completed', result: anchor },
    { label: 'Canon Audit — Setting', skill: 'romance-canon-audit', status: 'completed', result: settingAudit },
    { label: 'Canon Gate — Setting', skill: 'canon-drift-apply', status: 'completed', result: anchor },
    { label: 'Character Bible', skill: 'book-bible', status: 'completed', result: charBible },
    { label: 'Canon Audit — Characters', skill: 'romance-canon-audit', status: 'completed', result: '[]' },
    { label: 'Canon Gate — Characters', skill: 'canon-drift-apply', status: 'running' },
  ];
  await runCanonDriftGate({ steps, step: steps[5], loadAnchors: async () => [anchor] });
  assert.ok(!steps[3].result!.includes('WRONG-SETTING-EDIT'), "Gate A's setting-audit edit is out of Gate B scope");
  assert.equal(steps[3].result, charBible); // no character-bible drift → base unchanged
});

test('canon-drift-apply is dispatched at all three sites', () => {
  const files = [
    'gateway/src/index.ts',
    'gateway/src/api/routes/projects.routes.ts',
  ];
  let count = 0;
  for (const rel of files) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    count += (src.match(/canon-drift-apply/g) ?? []).length;
  }
  assert.ok(count >= 3, `expected >=3 canon-drift-apply dispatch refs, found ${count}`);
});
