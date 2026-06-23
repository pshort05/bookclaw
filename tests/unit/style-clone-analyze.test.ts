// tests/unit/style-clone-analyze.test.ts
//
// Characterization tests for StyleCloneService.analyze() — the pure, no-AI
// 47-marker style fingerprint. Two hand-built, hand-countable fixtures pin
// the exact arithmetic of the implementation (see style-clone.ts):
//
//   FIXTURE A — plain prose, 2 paragraphs, no punctuation tricks. Pins the
//   sentence-structure + density markers (avg/std/median length, length
//   buckets, sentences-per-paragraph, prepositional density).
//
//   FIXTURE B — punctuation- and contraction-heavy. Pins the rate markers
//   that FIXTURE A leaves at zero (em-dash, semicolon, contraction, passive,
//   dialogue density, adverb, hedging, intensifier).
//
// Tokenization the implementation uses (replicated here for hand-counting):
//   words      = text.split(/\s+/).filter(Boolean)
//   sentences  = text.split(/[.!?]+/).map(trim).filter(Boolean)
//   paragraphs = text.split(/\n\s*\n/).filter(non-blank)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StyleCloneService } from '../../gateway/src/services/style-clone.js';

const svc = new StyleCloneService();

// ── FIXTURE A ──────────────────────────────────────────────────────────────
// 129 words, 8 sentences, 2 paragraphs.
// Sentence lengths (words): [14, 6, 2, 17, 28, 11, 21, 30].
const SAMPLE_A = `The cat sat on the mat by the warm fire and watched the rain.
A dog ran in the yard. Birds sang. The old man walked to the door and looked outside at the grey sky above the hills. He felt the cold wind on his face and heard the distant call of a lonely bird that flew over the trees near the river below the bridge.

She said the storm would pass before the morning light returned. The children played in the field with the ball and the kite while the sun broke through the clouds at last. They ran and they laughed and they sang a happy little song about the bright blue sky and the green grass under their bare feet on that fine spring day.`;

// ── FIXTURE B ──────────────────────────────────────────────────────────────
// 101 words, 2 paragraphs, dialogue + em-dash + semicolons + contractions.
const SAMPLE_B = `"I don't think we'll make it," she said — her voice barely a whisper. The door was locked; the window had been shut for hours. Wasn't that strange? It really, truly was. He couldn't help but wonder (just for a moment) whether the room itself was watching them both.

She didn't answer. Instead she very slowly turned the heavy iron key. The lock clicked open. They weren't alone anymore, and the cold air rushed in from the dark hall beyond. Maybe the storm had finally passed; maybe it had only just begun to gather its strength again above the silent house.`;

test('throws below the 100-word minimum sample size', () => {
  assert.throws(
    () => svc.analyze('Too short. ' + 'word '.repeat(50), 'tiny'),
    /at least 100 words/,
  );
});

test('records the raw sample word count from /\\s+/ tokenization', () => {
  const p = svc.analyze(SAMPLE_A, 'A');
  assert.equal(p.sampleWordCount, 129);
});

test('sentence-structure markers match hand-computed lengths [14,6,2,17,28,11,21,30]', () => {
  const m = svc.analyze(SAMPLE_A, 'A').markers;
  // mean = 129 / 8 = 16.125 → round(.,1)
  assert.equal(m.avgSentenceLength, 16.1);
  // population std-dev of the 8 lengths
  assert.equal(m.sentenceLengthStdDev, 9.3);
  // sorted [2,6,11,14,17,21,28,30] → (14+17)/2
  assert.equal(m.medianSentenceLength, 15.5);
  // <10: {6,2} = 2/8; 10..25: {14,17,11,21} = 4/8; >25: {28,30} = 2/8
  assert.equal(m.shortSentencePct, 25);
  assert.equal(m.mediumSentencePct, 50);
  assert.equal(m.longSentencePct, 25);
  // fragments are sentences of length 1..3 → just the length-2 one: 1/129*1000
  assert.equal(m.fragmentRate, 7.75);
});

test('sentencesPerParagraph divides sentence count by paragraph count', () => {
  const m = svc.analyze(SAMPLE_A, 'A').markers;
  // 8 sentences / 2 paragraphs
  assert.equal(m.sentencesPerParagraph, 4);
});

test('prepositionalDensity = prepositions / sentence count', () => {
  const m = svc.analyze(SAMPLE_A, 'A').markers;
  // 17 preposition tokens / 8 sentences = 2.125 → round(.,2)
  assert.equal(m.prepositionalDensity, 2.13);
});

test('avgWordLength counts only [a-zA-Z] characters per token', () => {
  const m = svc.analyze(SAMPLE_A, 'A').markers;
  assert.equal(m.avgWordLength, 3.91);
});

test('uniqueWordRatio and vocabSize derive from the lowercased word set', () => {
  const m = svc.analyze(SAMPLE_A, 'A').markers;
  // 88 unique normalized words / 129 total
  assert.equal(m.vocabSize, 88);
  assert.equal(m.uniqueWordRatio, 0.682);
});

test('FIXTURE A has no punctuation/contraction/passive markers (all zero)', () => {
  // Guards against a fixture-leak false positive — these are exercised in B.
  const m = svc.analyze(SAMPLE_A, 'A').markers;
  assert.equal(m.emDashRate, 0);
  assert.equal(m.semicolonRate, 0);
  assert.equal(m.contractionRate, 0);
  assert.equal(m.passiveVoiceRate, 0);
  assert.equal(m.questionMarkRate, 0);
  assert.equal(m.dialogueDensity, 0);
});

test('third-person pronouns dominate FIXTURE A; tense reads as past', () => {
  const m = svc.analyze(SAMPLE_A, 'A').markers;
  assert.equal(m.firstPersonPronounRate, 0);
  assert.equal(m.thirdPersonPronounRate, 54.3);
  assert.equal(m.pastTenseRate, 46.51);
  assert.equal(m.presentTenseRate, 0);
});

// ── FIXTURE B — punctuation / contraction / dialogue ────────────────────────

test('FIXTURE B word count and rate markers (em-dash, semicolon, contraction)', () => {
  const p = svc.analyze(SAMPLE_B, 'B');
  assert.equal(p.sampleWordCount, 101);
  const m = p.markers;
  // 1 em-dash / 101 * 1000
  assert.equal(m.emDashRate, 9.9);
  // 2 semicolons / 101 * 1000
  assert.equal(m.semicolonRate, 19.8);
  // 1 question mark / 101 * 1000
  assert.equal(m.questionMarkRate, 9.9);
  // 1 parenthetical group / 101 * 1000
  assert.equal(m.parentheticalRate, 9.9);
  // CONTRACTION_RE matches don't/we'll/Wasn't/couldn't/didn't/weren't = 6 / 101 * 1000
  assert.equal(m.contractionRate, 59.41);
});

test('FIXTURE B passive voice and dialogue density', () => {
  const m = svc.analyze(SAMPLE_B, 'B').markers;
  // PASSIVE_VOICE_RE (be-verb + \w+ed): "was locked" → 1 / 101 * 1000
  assert.equal(m.passiveVoiceRate, 9.9);
  // 1 of 2 paragraphs starts with a quote
  assert.equal(m.dialogueDensity, 0.5);
});

test('FIXTURE B adverb, hedging, and intensifier rates', () => {
  const m = svc.analyze(SAMPLE_B, 'B').markers;
  // -ly adverbs (len>3, not in NON_ADVERB_LY): barely, slowly, finally, only = 4 / 101 * 1000
  assert.equal(m.adverbRate, 39.6);
  // HEDGING_WORDS present: "maybe" x2 → 2 / 101 * 1000
  assert.equal(m.hedgingRate, 19.8);
  // INTENSIFIERS present: "really" + "very" → 2 / 101 * 1000
  assert.equal(m.intensifierRate, 19.8);
});

test('profile carries source through and exposes systemPrompt + signature', () => {
  const p = svc.analyze(SAMPLE_A, 'my-source-label');
  assert.equal(p.sampleSource, 'my-source-label');
  assert.ok(p.systemPrompt.startsWith('## Voice Profile'));
  // signature always includes avg sentence + dialogue %, and a POV tag.
  assert.ok(p.signature.includes('avg sentence 16.1w'), p.signature);
  assert.ok(p.signature.includes('dialogue 0%'), p.signature);
  assert.ok(p.signature.includes('3P'), p.signature);
});
