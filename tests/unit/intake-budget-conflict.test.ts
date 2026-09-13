import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBudgetConflicts } from '../../gateway/src/services/intake-budget.js';
import { budgetDiscrepancies, type IntakeSeeds } from '../../gateway/src/services/premise-intake.js';

// Production bug (Firefly Pond): intake stored 25 × 2,400 = 60,000 everywhere, but
// the blueprint seed carried the premise's own "80,000–90,000 words" figure. Nothing
// flagged the disagreement, and the outline came back at ~90,000 with 3,200-word
// chapters. Detection is deterministic and AI-free; it must fire here...
const FIREFLY_BLUEPRINT = `## Structure
Dual POV, alternating.

## Chapter Count & Pacing
**Estimated chapter count:** 24–28 chapters (based on 80,000–90,000 words)

## Ending
HEA, on the dock.`;

test('Firefly Pond regression: a blueprint word budget that disagrees with the chosen settings is flagged', () => {
  const conflicts = detectBudgetConflicts(FIREFLY_BLUEPRINT, 25, 2400);
  assert.equal(conflicts.length, 1, 'the 24–28 chapter claim contains the chosen 25 — only the word total conflicts');
  const c = conflicts[0];
  assert.equal(c.kind, 'total');
  assert.match(c.claimed, /80,000/);
  assert.match(c.claimed, /90,000/);
  assert.match(c.chosen, /60,000/);
  assert.match(c.detail, /Estimated chapter count/);
});

// ...and must stay silent on the legitimate per-act subtotals that every real
// blueprint carries (the Three Months of Summer blueprint has exactly these).
const ACT_BLUEPRINT = `## Act Structure
Act 1: 11 chapters (~6,000–7,500 words)
Act 2: 10–12 chapters (~13,500–16,500 words)
Act 3 — Resolution: 10,000 words
Act 4 (Chapters 20–24): 20,000–25,000 words`;

test('no false alarm: per-act subtotals are not whole-book totals', () => {
  assert.deepEqual(detectBudgetConflicts(ACT_BLUEPRINT, 24, 2500), []);
});

test('a single stated total within 15% of the chosen total is silent', () => {
  const text = '## Length\nThe finished novel should run about ~62,000 words.';
  assert.deepEqual(detectBudgetConflicts(text, 24, 2500), []); // 60,000 vs 62,000 → 3.2%
});

test('a single stated total more than 15% off the chosen total conflicts', () => {
  const text = '## Length\nThe finished novel should run about 90,000 words.';
  const conflicts = detectBudgetConflicts(text, 24, 2500);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'total');
  assert.match(conflicts[0].claimed, /90,000/);
});

test('chapter-count claims: inside a stated range is silent, far off a single figure conflicts', () => {
  assert.deepEqual(detectBudgetConflicts('The book runs 24–28 chapters.', 25, 2400), []);
  const conflicts = detectBudgetConflicts('The book runs 40 chapters.', 25, 2400);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'chapters');
  assert.match(conflicts[0].claimed, /40 chapters/);
  assert.match(conflicts[0].chosen, /25 chapters/);
});

test('per-chapter claims conflict when the chosen chapter length is more than 15% off', () => {
  const conflicts = detectBudgetConflicts('Pacing: chapters of about 3,200 words, scene-led.', 25, 2400);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].kind, 'perChapter');
  assert.match(conflicts[0].claimed, /3,200/);
  assert.match(conflicts[0].chosen, /2,400/);
});

test('a per-chapter claim close to the chosen chapter length is silent', () => {
  assert.deepEqual(detectBudgetConflicts('~2,500 words per chapter.', 24, 2400), []);
});

test('text with no numbers, and malformed input, produce no conflicts and never throw', () => {
  assert.deepEqual(detectBudgetConflicts('A summer romance on a quiet lake.', 25, 2400), []);
  assert.deepEqual(detectBudgetConflicts('', 25, 2400), []);
  assert.deepEqual(detectBudgetConflicts(undefined as unknown as string, 25, 2400), []);
  assert.deepEqual(detectBudgetConflicts({ nope: true } as unknown as string, 25, 2400), []);
  assert.deepEqual(detectBudgetConflicts('90,000 words', 0, 0), []);
  assert.deepEqual(detectBudgetConflicts('90,000 words', NaN, 2400), []);
  assert.deepEqual(detectBudgetConflicts('$$$ ,,,, 99999999999999 words words', 25, 2400).length >= 0, true);
});

const seedsWith = (over: Partial<IntakeSeeds>): IntakeSeeds => ({
  storyArc: 'She comes home for one summer.', characters: 'Nell, Ruaridh.', setting: 'A lake town.',
  blueprint: 'Dual POV.', heat: 'sweet', chapterCount: 25, wordsPerChapter: 2400, ...over,
});

test('budgetDiscrepancies names the seed the claim came from', () => {
  const [d] = budgetDiscrepancies(seedsWith({ storyArc: 'A 90,000 word novel about a lake.' }));
  assert.ok(d, 'a conflict in storyArc is reported');
  assert.match(d.premiseClaim, /storyArc/);
  const [b] = budgetDiscrepancies(seedsWith({ blueprint: FIREFLY_BLUEPRINT }));
  assert.match(b.premiseClaim, /blueprint/);
});

test('budgetDiscrepancies assembles the Firefly conflict as a fail discrepancy the review screen shows', () => {
  const discs = budgetDiscrepancies(seedsWith({ blueprint: FIREFLY_BLUEPRINT }));
  assert.equal(discs.length, 1);
  const d = discs[0];
  assert.equal(d.status, 'fail');
  assert.equal(d.targetField, 'blueprint');
  assert.ok(d.id, 'has a stable id for the UI resolution map');
  assert.match(d.premiseClaim, /80,000/);        // quotes the premise text
  assert.match(d.finding, /60,000/);             // states the chosen settings
  assert.match(d.finding, /25/);
  assert.match(d.finding, /2,400/);
  assert.ok(d.suggestion && /override|ignore/i.test(d.suggestion), 'tells the author the settings win');
  assert.deepEqual(budgetDiscrepancies(seedsWith({})), []); // clean seeds → nothing
});

test('budgetDiscrepancies is fail-soft on malformed seeds', () => {
  assert.deepEqual(budgetDiscrepancies(undefined as unknown as IntakeSeeds), []);
  assert.deepEqual(budgetDiscrepancies({} as IntakeSeeds), []);
});
