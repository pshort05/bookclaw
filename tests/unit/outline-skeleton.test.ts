import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beatForChapter,
  deriveShortOutline,
  extractOutlineChapterSection,
  buildTwoTierOutlineBlock,
} from '../../gateway/src/services/outline-skeleton.js';

const OUTLINE = `# Chapter Outline

**Chapter 1 — The Meet Cute**
- **POV:** Gia
- **Goal:** Survive the mid-June morning rush without losing ground.
- **Conflict:** Cole shows up with a peace-offering pastry box.
- **Outcome:** She trashes the box; he compliments her sfogliatelle genuinely.
- **Word Count Target:** 2,600

**Chapter 2 — The Weight**
- **POV:** Gia
- **Goal:** Get the day's bake out on a dying oven.
- **Outcome:** She patches the problem herself rather than ask for help.

**Chapter 3 — The Storm**
- **POV:** Gia
- **Goal:** Save the shop from the bay surge.
- **Outcome:** With no path alone, she asks Cole for his kitchen.

**Chapter 4 — One Year Later**
- **POV:** Gia
- **Goal:** Open the merged bakery on the boardwalk.
- **Outcome:** Cole takes her hand; they build it together. A guaranteed HEA.
`;

test('beatForChapter labels the pillar beats across a 25-chapter book', () => {
  assert.equal(beatForChapter(1, 25), 'Meet-cute');
  assert.equal(beatForChapter(13, 25), 'Midpoint shift'); // computeBeats(25).midpoint
  assert.equal(beatForChapter(19, 25), 'Black moment');   // computeBeats(25).twist75
  assert.equal(beatForChapter(25, 25), 'HEA / HFN');      // final chapter
  assert.equal(beatForChapter(22, 25), 'Grovel & reunion');
});

test('beatForChapter: final chapter is always HEA/HFN even for a tiny book', () => {
  assert.equal(beatForChapter(4, 4), 'HEA / HFN');
  assert.equal(beatForChapter(1, 4), 'Meet-cute');
});

test('deriveShortOutline: one entry per chapter, each with a beat label + condensed goal/outcome', () => {
  const sk = deriveShortOutline(OUTLINE);
  // one line-group per chapter (4 chapters)
  assert.equal((sk.match(/^Chapter \d+ —/gm) || []).length, 4);
  assert.match(sk, /Chapter 1 — The Meet Cute\s+\[Beat: Meet-cute\]/);
  assert.match(sk, /Chapter 4 — One Year Later\s+\[Beat: HEA \/ HFN\]/);
  // condensed content is present (POV + goal + outcome), not the full field list
  assert.match(sk, /POV Gia/);
  assert.match(sk, /morning rush/);          // goal fragment
  assert.match(sk, /compliments her sfogliatelle/); // outcome fragment
  assert.doesNotMatch(sk, /Word Count Target/);     // stripped
});

test('extractOutlineChapterSection returns just that chapter, up to the next heading', () => {
  const s3 = extractOutlineChapterSection(OUTLINE, 3);
  assert.match(s3!, /Chapter 3 — The Storm/);
  assert.match(s3!, /asks Cole for his kitchen/);
  assert.doesNotMatch(s3!, /One Year Later/); // stops before ch4
  assert.equal(extractOutlineChapterSection(OUTLINE, 9), null); // absent → null
});

test('buildTwoTierOutlineBlock: full skeleton + prior/current/next full sections, no middle omitted', () => {
  const block = buildTwoTierOutlineBlock(OUTLINE, 3);
  // full skeleton lists ALL chapters (none omitted)
  for (const n of [1, 2, 3, 4]) assert.match(block, new RegExp(`Chapter ${n} —`));
  // current chapter full section (its outcome line present)
  assert.match(block, /asks Cole for his kitchen/);
  // prior + next full sections present
  assert.match(block, /patches the problem herself/); // ch2 outcome (prior)
  assert.match(block, /build it together/);            // ch4 outcome (next)
  // labels the current chapter as the one to write
  assert.match(block, /write this chapter/i);
});

const SPICY = `# Chapter Outline

**Chapter 1 — Meet**
- **POV:** Addi
- **Goal:** Survive a launch-week workday.
- **Outcome:** They meet across the office; sparks, nothing more.

**Chapter 2 — The Porch**
- **POV:** Addi
- **Goal:** Get through the real conversation.
- **Outcome:** The night ends in a slow, terrified first kiss on the porch.

**Chapter 3 — The Cabin**
- **POV:** Jay
- **Goal:** Stop pretending.
- **Outcome:** First sex scene, cabin bedroom — tender, emotionally weighted.

**Chapter 4 — The Break**
- **POV:** Addi
- **Goal:** Name what's wrong.
- **Outcome:** The black moment; she walks out and the door goes dark.

**Chapter 5 — The Grovel**
- **POV:** Jay
- **Goal:** Win her back.
- **Outcome:** He finds her at the dock; a tender, unhurried reunion. Reconciliation completed.

**Chapter 6 — Brooklyn**
- **POV:** Both
- **Goal:** Choose the future on purpose.
- **Outcome:** They move in together. An unambiguous HEA.
`;

test('content tags: First Kiss (first only), Intimate scene (spicy), Reunion (not final)', () => {
  const sk = deriveShortOutline(SPICY, { spicy: true });
  assert.match(sk, /Chapter 2 — The Porch\s+\[Beat:[^\]]*First Kiss/);
  assert.match(sk, /Chapter 3 — The Cabin\s+\[Beat:[^\]]*Intimate scene/);
  assert.match(sk, /Chapter 5 — The Grovel\s+\[Beat:[^\]]*Reunion/);
  // final chapter is HEA/HFN, never tagged Reunion
  assert.match(sk, /Chapter 6 — Brooklyn\s+\[Beat: HEA \/ HFN\]/);
  // First Kiss tagged exactly once
  assert.equal((sk.match(/First Kiss/g) || []).length, 1);
});

test('content tags: sweet books do NOT get an Intimate scene tag', () => {
  const sk = deriveShortOutline(SPICY, { spicy: false });
  assert.doesNotMatch(sk, /Intimate scene/);
  // kiss + reunion are heat-independent and still tagged
  assert.match(sk, /First Kiss/);
  assert.match(sk, /Reunion/);
});

test('content tags do not mistake a setup mention ("sets up the first kiss") for the kiss', () => {
  const setup = `**Chapter 1 — Setup**
- **Goal:** Build tension.
- **Outcome:** They almost touch; nothing lands.
- **Plot Threads:** Sets the stage directly for the first kiss.

**Chapter 2 — The Kiss**
- **Outcome:** They finally kiss — the real one.
`;
  const sk = deriveShortOutline(setup);
  assert.doesNotMatch(sk, /Chapter 1 —[^\n]*First Kiss/); // setup chapter not tagged
  assert.match(sk, /Chapter 2 —[^\n]*First Kiss/);        // the actual kiss is
});

test('buildTwoTierOutlineBlock: final chapter tells the model to deliver the ending now', () => {
  const block = buildTwoTierOutlineBlock(OUTLINE, 4);
  assert.match(block, /final chapter/i);
  assert.match(block, /deliver the ending/i);
  assert.doesNotMatch(block, /Chapter 5 —/); // no next chapter fabricated
});
