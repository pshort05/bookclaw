/**
 * Budget re-check (gap in the intake budget-conflict feature): the conflicts
 * POST /api/books/intake returns are computed ONCE, from the chapter/word counts
 * the AI *proposed*. The author then edits those numbers on the review screen, and
 * nothing re-evaluated — which is exactly how the Firefly Pond bug got through:
 * analyze proposed counts that agreed with the blueprint, the author typed 25 and
 * 2,400, and the 80,000–90,000 in the blueprint went unflagged.
 *
 * Covered here: the POST /api/books/intake/budget-check handler logic (against the
 * FINAL counts, not the proposed ones), the `budgetDiscrepancies` refactor that
 * accepts explicit counts without changing the intake path, and the client-side
 * merge/identity helpers the review screen uses to replace-not-append the budget
 * findings and to gate "Start book" on them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'net';
import { budgetCheckBody, mountBooks } from '../../gateway/src/api/routes/books.routes.js';
import { budgetDiscrepancies, type IntakeSeeds, type Discrepancy } from '../../gateway/src/services/premise-intake.js';
import { mergeBudgetDiscrepancies, isBudgetDiscrepancy, discKey } from '../../frontend/studio/src/lib/budgetCheck.js';

const FIREFLY_BLUEPRINT = `## Structure
Dual POV, alternating.

## Chapter Count & Pacing
**Estimated chapter count:** 24–28 chapters (based on 80,000–90,000 words)

## Ending
HEA, on the dock.`;

// Seeds as ANALYZE proposed them: 26 × 3,300 = 85,800 words in 26 chapters, which
// agrees with the blueprint's own "24–28 chapters / 80,000–90,000 words" — so intake
// flags nothing. The author then edits the numbers on the review screen.
const PROPOSED: IntakeSeeds = {
  storyArc: 'She comes home for one summer.', characters: 'Nell, Ruaridh.', setting: 'A lake town.',
  blueprint: FIREFLY_BLUEPRINT, heat: 'sweet', chapterCount: 26, wordsPerChapter: 3300,
};

const ok = (r: ReturnType<typeof budgetCheckBody>): Discrepancy[] => {
  assert.ok(!('error' in r), `expected discrepancies, got ${JSON.stringify(r)}`);
  return (r as { discrepancies: Discrepancy[] }).discrepancies;
};

test('the check runs against the FINAL counts, not the ones analyze proposed', () => {
  // The proposed counts agree with the blueprint — intake saw nothing.
  assert.deepEqual(budgetDiscrepancies(PROPOSED), []);
  // The author types 25 × 2,400 = 60,000. That is the Firefly Pond bug, and it fires.
  const discs = ok(budgetCheckBody({ seeds: PROPOSED, chapterCount: 25, wordsPerChapter: 2400 }));
  assert.equal(discs.length, 1);
  assert.equal(discs[0].status, 'fail');
  assert.equal(discs[0].targetField, 'blueprint');
  assert.match(discs[0].premiseClaim, /80,000/);
  assert.match(discs[0].finding, /60,000/);
  assert.match(discs[0].finding, /2,400/);
});

test('counts edited back into agreement return no conflicts', () => {
  const seeds: IntakeSeeds = { ...PROPOSED, chapterCount: 25, wordsPerChapter: 2400 };
  assert.equal(budgetDiscrepancies(seeds).length, 1, 'the stored seeds conflict');
  assert.deepEqual(ok(budgetCheckBody({ seeds, chapterCount: 26, wordsPerChapter: 3300 })), [],
    'the explicit counts the author has now chosen agree with the premise');
});

// Missing/garbage input is a 400, not an empty list — matching POST /api/books/intake
// ("premise text is required"). An empty list would be indistinguishable from "no
// conflicts found" on the review screen, i.e. a silent pass for a check that never ran.
test('malformed bodies are rejected with a clear message', () => {
  for (const body of [undefined, null, {}, { seeds: null }, { seeds: 'text' }, { seeds: [] }]) {
    const r = budgetCheckBody(body as any);
    assert.ok('error' in r, `expected an error for ${JSON.stringify(body)}`);
    assert.match((r as { error: string }).error, /seeds/);
  }
  for (const body of [{ seeds: PROPOSED }, { seeds: PROPOSED, chapterCount: 0, wordsPerChapter: 2400 },
    { seeds: PROPOSED, chapterCount: '25', wordsPerChapter: 2400 }, { seeds: PROPOSED, chapterCount: NaN, wordsPerChapter: 2400 }]) {
    const r = budgetCheckBody(body as any);
    assert.ok('error' in r, `expected an error for ${JSON.stringify(body)}`);
    assert.match((r as { error: string }).error, /chapterCount/);
  }
  const r = budgetCheckBody({ seeds: PROPOSED, chapterCount: 25, wordsPerChapter: -1 } as any);
  assert.ok('error' in r);
  assert.match((r as { error: string }).error, /wordsPerChapter/);
});

test('seeds missing their text fields are tolerated (no throw, no conflicts)', () => {
  assert.deepEqual(ok(budgetCheckBody({ seeds: {}, chapterCount: 25, wordsPerChapter: 2400 })), []);
});

// The refactor that lets the handler pass explicit counts must not change the
// behaviour of the intake path, which calls budgetDiscrepancies(seeds) with no counts.
test('budgetDiscrepancies keeps its existing single-argument behaviour', () => {
  const seeds: IntakeSeeds = { ...PROPOSED, chapterCount: 25, wordsPerChapter: 2400 };
  const discs = budgetDiscrepancies(seeds);
  assert.equal(discs.length, 1);
  assert.match(discs[0].finding, /60,000/);
  assert.deepEqual(budgetDiscrepancies({ ...PROPOSED }), []);
  assert.deepEqual(budgetDiscrepancies(undefined as unknown as IntakeSeeds), []);
  assert.deepEqual(budgetDiscrepancies({} as IntakeSeeds), []);
});

test('server budget ids carry the prefix the client merge keys on', () => {
  const discs = budgetDiscrepancies({ ...PROPOSED, chapterCount: 25, wordsPerChapter: 2400 });
  assert.ok(discs.every((d) => isBudgetDiscrepancy(d)), 'every budget discrepancy is recognized client-side');
});

test('POST /api/books/intake/budget-check is mounted and returns the conflicts for the posted counts', async () => {
  const app = express();
  app.use(express.json());
  mountBooks(app as any, { getProjectEngine: () => null, getServices: () => ({}) } as any, '');
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/books/intake/budget-check`;
  const post = (body: unknown) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const res = await post({ seeds: PROPOSED, chapterCount: 25, wordsPerChapter: 2400 });
    const body = await res.json() as { discrepancies: Discrepancy[] };
    assert.equal(res.status, 200, JSON.stringify(body));
    assert.equal(body.discrepancies.length, 1);
    assert.match(body.discrepancies[0].finding, /60,000/);

    const clean = await post({ seeds: PROPOSED, chapterCount: 26, wordsPerChapter: 3300 });
    assert.equal(clean.status, 200);
    assert.deepEqual((await clean.json() as { discrepancies: Discrepancy[] }).discrepancies, []);

    const bad = await post({ chapterCount: 25, wordsPerChapter: 2400 });
    assert.equal(bad.status, 400);
    assert.match((await bad.json() as { error: string }).error, /seeds/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ---- client merge / gating helpers (frontend/studio/src/lib/budgetCheck.ts) ----

const GROUNDING: Discrepancy[] = [
  { id: 'disc-1', premiseClaim: 'Main Street runs east', finding: 'It runs north.', status: 'fail', suggestion: 'Say north.', targetField: 'setting' },
  { id: 'disc-2', premiseClaim: 'The bay is tidal', finding: 'Verified.', status: 'pass', targetField: 'setting' },
];
const budgetDisc = (finding: string): Discrepancy =>
  ({ id: 'budget-blueprint-1', premiseClaim: 'blueprint: "…80,000–90,000 words"', finding, status: 'fail', suggestion: 'Settings win.', targetField: 'blueprint' });

test('merging replaces the previous budget findings and never duplicates them', () => {
  const first = mergeBudgetDiscrepancies(GROUNDING, [budgetDisc('…set to 60,000 words')]);
  assert.equal(first.length, 3);
  const second = mergeBudgetDiscrepancies(first, [budgetDisc('…set to 50,000 words')]);
  assert.equal(second.length, 3, 'the second re-check replaces, it does not append');
  assert.equal(second[2].finding, '…set to 50,000 words');
  assert.deepEqual(second.slice(0, 2), GROUNDING, 'grounding findings are untouched, in order');
  assert.deepEqual(mergeBudgetDiscrepancies(second, []), GROUNDING, 'a conflict the author fixed disappears');
});

test('a resolution survives an unchanged re-check, and a changed conflict gates again', () => {
  // Mirrors the screen: resolution is keyed by discKey and "Start book" needs every
  // *currently listed* fail discrepancy resolved.
  const gated = (list: Discrepancy[], res: Record<string, 'applied' | 'kept'>) =>
    list.filter((d) => d.status === 'fail').every((d) => !!res[discKey(d)]);

  const conflict = budgetDisc('…set to 60,000 words');
  let list = mergeBudgetDiscrepancies(GROUNDING, [conflict]);
  const res: Record<string, 'applied' | 'kept'> = { [discKey(GROUNDING[0])]: 'applied' };
  assert.equal(gated(list, res), false, 'a new budget conflict blocks Start book');

  res[discKey(conflict)] = 'kept';
  assert.equal(gated(list, res), true);

  // An identical re-check (same counts) must not un-resolve what the author decided.
  list = mergeBudgetDiscrepancies(list, [budgetDisc('…set to 60,000 words')]);
  assert.equal(gated(list, res), true, 'an unchanged conflict stays resolved');

  // Different numbers → a different finding → a decision is required again.
  list = mergeBudgetDiscrepancies(list, [budgetDisc('…set to 50,000 words')]);
  assert.equal(gated(list, res), false, 'a changed conflict must be re-resolved');

  // The author fixes the numbers: the conflict is gone and its stale resolution
  // cannot leave the button blocked.
  list = mergeBudgetDiscrepancies(list, []);
  assert.equal(gated(list, res), true, 'a disappeared conflict never blocks Start book');
});
