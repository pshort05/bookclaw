/**
 * Unit tests for gateway/src/services/writing-judge.ts.
 *
 * Two layers under test, both network-free:
 *   1. `mechanicalScreen(text)` — the deterministic regex/lexicon screen that
 *      turns prose into categorized issues + a 0-100 composite score.
 *   2. `evaluate(text, opts)` — the combined `mechanical*0.3 + judge*0.7` score
 *      and the `retry = combined < threshold` decision. The LLM judge is driven
 *      by a stubbed `aiComplete` that returns canned JSON (no network), and a
 *      stub `aiSelectProvider`. Also covers the dual-judge fallback when one of
 *      the two judges returns null.
 *
 * Characterization: assertions encode the code's ACTUAL behavior, including the
 * weight table (error -18, warning -8, info -3) and the rate thresholds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WritingJudgeService } from '../../gateway/src/services/writing-judge.js';

const judge = new WritingJudgeService();

const selectProvider = (_task: string) => ({ id: 'stub-provider' });

/** Build a craft/market judge JSON payload whose dimensions all share one score. */
function judgeJson(score: number, dimCount = 6): string {
  const dims = Array.from({ length: dimCount }, (_, i) => ({
    name: `dim_${i}`,
    score,
    issues: [`issue ${i}`],
  }));
  return JSON.stringify({ dimensions: dims });
}

// ── mechanicalScreen: clean prose ───────────────────────────────────────────

test('mechanicalScreen: clean prose scores 100 with no issues', () => {
  const text = 'The dog ran across the yard and barked at the mailman. ' +
    'He chased the bicycle down the street and then trotted home for dinner.';
  const r = judge.mechanicalScreen(text);
  assert.deepEqual(r.issues, []);
  assert.equal(r.score, 100);
});

test('mechanicalScreen: empty text does not divide by zero (wordCount floored to 1)', () => {
  const r = judge.mechanicalScreen('');
  assert.equal(r.wordCount, 1);
  assert.equal(r.score, 100);
});

// ── mechanicalScreen: AI-tell detection ─────────────────────────────────────

test('mechanicalScreen: a single AI-tell phrase is a warning (-8)', () => {
  // One "tapestry of" → ai_tell, count 1 → severity warning.
  // The lone "was" also trips weak_verb (rate 71.4/1000 > 50 → warning), so the
  // composite drops by two warnings (8 + 8) → 84, not 92. Avoid "was" if you want
  // to isolate the ai_tell penalty.
  const r = judge.mechanicalScreen('The story was a tapestry of lives woven together over many years and seasons.');
  const aiTell = r.issues.find(i => i.category === 'ai_tell');
  assert.ok(aiTell, 'expected an ai_tell issue');
  assert.equal(aiTell!.severity, 'warning');
  assert.equal(aiTell!.count, 1);
  assert.equal(r.score, 84); // 100 - 8 (ai_tell) - 8 (weak_verb from "was")

  // Isolated ai-tell with no weak verb → exactly -8.
  const clean = judge.mechanicalScreen('They wove a tapestry of lives across many quiet years and changing seasons.');
  assert.equal(clean.issues.length, 1);
  assert.equal(clean.score, 92);
});

test('mechanicalScreen: more than 3 AI-tell phrases escalate to error (-18)', () => {
  const text = 'A tapestry of dreams. A testament to courage. We delve into the realm of myth. ' +
    'It was a beacon of hope and a paradigm of grace.';
  const r = judge.mechanicalScreen(text);
  const aiTell = r.issues.find(i => i.category === 'ai_tell');
  assert.ok(aiTell);
  assert.ok(aiTell!.count > 3, `expected >3 ai-tell hits, got ${aiTell!.count}`);
  assert.equal(aiTell!.severity, 'error');
});

// ── mechanicalScreen: banned cliché detection ───────────────────────────────

test('mechanicalScreen: a single banned cliché is a warning', () => {
  const r = judge.mechanicalScreen('At the end of the day, none of it really mattered to the two of them.');
  const banned = r.issues.find(i => i.category === 'banned_phrase');
  assert.ok(banned);
  assert.equal(banned!.severity, 'warning');
  assert.equal(banned!.count, 1);
});

test('mechanicalScreen: more than 2 banned clichés escalate to error', () => {
  const text = 'Her heart skipped a beat. It was the calm before the storm. ' +
    'Only time will tell. The deafening silence pressed in.';
  const r = judge.mechanicalScreen(text);
  const banned = r.issues.find(i => i.category === 'banned_phrase');
  assert.ok(banned);
  assert.ok(banned!.count > 2, `expected >2 banned hits, got ${banned!.count}`);
  assert.equal(banned!.severity, 'error');
});

// ── mechanicalScreen: adverb density (rate-based) ───────────────────────────

test('mechanicalScreen: high -ly adverb density is flagged; "really" is excluded', () => {
  // 5 adverbs in ~9 words → ~555/1000, well over the 20 error threshold.
  const r = judge.mechanicalScreen('Quickly slowly loudly harshly coldly the man walked away.');
  const adv = r.issues.find(i => i.category === 'adverb_density');
  assert.ok(adv, 'expected adverb_density issue');
  assert.equal(adv!.severity, 'error'); // rate > 20
  // "really" is on the NON_ADVERB_LY exclusion list — it must not be counted.
  const r2 = judge.mechanicalScreen('really really really really really really really really');
  assert.equal(r2.issues.find(i => i.category === 'adverb_density'), undefined);
});

// ── mechanicalScreen: passive voice ─────────────────────────────────────────

test('mechanicalScreen: passive constructions over the rate threshold are flagged', () => {
  // The regex only catches REGULAR "-ed" participles: "was broken" is NOT matched
  // (irregular participle), so only 3 of the 4 passives count → 3/16 ≈ 187/1000,
  // still over the 14 error threshold.
  const r = judge.mechanicalScreen('The vase was broken. The door was opened. The note was burned. The car was parked.');
  const passive = r.issues.find(i => i.category === 'passive_voice');
  assert.ok(passive, 'expected passive_voice issue');
  assert.equal(passive!.severity, 'error');
  // NOTE: irregular participle "broken" is missed by the /\w+ed\b/ pattern, so
  // count is 3, not 4. (Characterization of a known regex limitation, not a bug.)
  assert.equal(passive!.count, 3);
});

// ── mechanicalScreen: "suddenly" + "started to" (info/warning by count) ──────

test('mechanicalScreen: two "suddenly" trips the suddenly check at info severity', () => {
  const r = judge.mechanicalScreen('Suddenly the lights went out. Then, suddenly, the door slammed shut.');
  const sud = r.issues.find(i => i.category === 'suddenly');
  assert.ok(sud);
  assert.equal(sud!.count, 2);
  assert.equal(sud!.severity, 'info'); // <= 4
});

test('mechanicalScreen: three "started to"/"began to" trip the started_to check', () => {
  const r = judge.mechanicalScreen('She started to run. He began to shout. They started to laugh together.');
  const st = r.issues.find(i => i.category === 'started_to');
  assert.ok(st);
  assert.equal(st!.count, 3);
  assert.equal(st!.severity, 'info'); // <= 6
});

// ── evaluate: mechanical-only (no AI fns) ───────────────────────────────────

test('evaluate: with no AI fns, score is mechanical-only and judge/dualJudge are null', async () => {
  const text = 'The dog ran across the yard and barked. He chased the bike down the street home.';
  const v = await judge.evaluate(text);
  assert.equal(v.judge, null);
  assert.equal(v.dualJudge, null);
  assert.equal(v.score, v.mechanical.score);
  assert.match(v.summary, /mechanical-only/);
});

test('evaluate: mechanical-only clean prose passes (no retry) at the default threshold', async () => {
  const text = 'The dog ran across the yard and barked at the cat. He chased the bike down the street.';
  const v = await judge.evaluate(text);
  assert.equal(v.mechanical.score, 100);
  assert.equal(v.retry, false);
});

// ── evaluate: combined mechanical*0.3 + judge*0.7 ───────────────────────────

test('evaluate: combined score blends mechanical 0.3 and judge 0.7', async () => {
  // Clean text → mechanical 100. Judge all-8s → overall 8 → 80/100.
  // combined = 100*0.3 + 80*0.7 = 30 + 56 = 86.
  const text = 'The dog ran across the yard and barked at the cat. He chased the bike down the street.';
  const aiComplete = async () => ({ text: judgeJson(8) });
  const v = await judge.evaluate(text, { aiComplete, aiSelectProvider: selectProvider });
  assert.ok(v.judge, 'expected a single judge report');
  assert.equal(v.judge!.overall, 8);
  assert.equal(v.score, 86);
  assert.equal(v.retry, false); // 86 >= 70
});

test('evaluate: retry is true when the combined score falls below threshold', async () => {
  // Clean text → mechanical 100. Judge all-5s → 50/100.
  // combined = 100*0.3 + 50*0.7 = 30 + 35 = 65 → below default 70 → retry.
  const text = 'The dog ran across the yard and barked at the cat. He chased the bike down the street.';
  const aiComplete = async () => ({ text: judgeJson(5) });
  const v = await judge.evaluate(text, { aiComplete, aiSelectProvider: selectProvider });
  assert.equal(v.score, 65);
  assert.equal(v.retry, true);
});

test('evaluate: retry boundary — exactly at threshold does NOT retry (strict <)', async () => {
  // Drive combined to exactly 70 with a custom threshold of 70.
  // mechanical 100, judge overall 70-eq: need 100*0.3 + j*0.7 = 70 → j=57.14...
  // Easier: set mechanicalWeight so combined hits the threshold cleanly.
  // With mechWeight 0 → combined = judgeScore100. Judge all-7s → 70.
  const text = 'The dog ran across the yard and barked at the cat. He chased the bike down the street.';
  const aiComplete = async () => ({ text: judgeJson(7) });
  const atThreshold = await judge.evaluate(text, {
    aiComplete, aiSelectProvider: selectProvider, mechanicalWeight: 0, threshold: 70,
  });
  assert.equal(atThreshold.score, 70);
  assert.equal(atThreshold.retry, false, 'retry uses strict <, so == threshold passes');

  // One point lower retries.
  const aiComplete69 = async () => ({ text: judgeJson(6.9) });
  const below = await judge.evaluate(text, {
    aiComplete: aiComplete69, aiSelectProvider: selectProvider, mechanicalWeight: 0, threshold: 70,
  });
  assert.ok(below.score < 70);
  assert.equal(below.retry, true);
});

// ── evaluate: dual-judge mode + fallback ────────────────────────────────────

test('evaluate: dual-judge averages craft + market into combinedOverall100', async () => {
  // Both judges return all-8 → each overall 8 → combined100 = 80, gap 0.
  const text = 'The dog ran across the yard and barked at the cat. He chased the bike down the street.';
  const aiComplete = async () => ({ text: judgeJson(8) });
  const v = await judge.evaluate(text, { aiComplete, aiSelectProvider: selectProvider, dualJudge: true });
  assert.ok(v.dualJudge, 'expected a dual-judge analysis');
  assert.equal(v.judge, null);
  assert.equal(v.dualJudge!.combinedOverall100, 80);
  assert.equal(v.dualJudge!.disagreementGap, 0);
  // combined = mech 100*0.3 + 80*0.7 = 86.
  assert.equal(v.score, 86);
});

test('evaluate: dual-judge surfaces a disagreement note when the gap is large', async () => {
  // Craft all-9 (overall 9), market all-4 (overall 4) → gap = |9-4|*10 = 50.
  const text = 'The dog ran across the yard and barked at the cat. He chased the bike down the street.';
  const aiComplete = async (req: { system: string }) => {
    // The two judges are distinguished only by their system prompt content.
    const isMarket = /acquiring editor/i.test(req.system);
    return { text: judgeJson(isMarket ? 4 : 9) };
  };
  const v = await judge.evaluate(text, { aiComplete, aiSelectProvider: selectProvider, dualJudge: true });
  assert.ok(v.dualJudge);
  assert.equal(v.dualJudge!.craft.overall, 9);
  assert.equal(v.dualJudge!.market.overall, 4);
  assert.equal(v.dualJudge!.disagreementGap, 50);
  assert.match(v.dualJudge!.disagreementNote, /craft scored higher/i);
  // Large gap (>=15) is surfaced in retry feedback.
  assert.match(v.retryFeedback, /judges disagree/i);
});

test('evaluate: dual-judge falls back to a single judge when one judge returns null', async () => {
  // Market judge returns non-JSON → llmJudge null → fall back to single craft.
  const text = 'The dog ran across the yard and barked at the cat. He chased the bike down the street.';
  const aiComplete = async (req: { system: string }) => {
    const isMarket = /acquiring editor/i.test(req.system);
    return { text: isMarket ? 'sorry, I cannot do that' : judgeJson(8) };
  };
  const v = await judge.evaluate(text, { aiComplete, aiSelectProvider: selectProvider, dualJudge: true });
  assert.equal(v.dualJudge, null, 'one judge failed → no dual analysis');
  assert.ok(v.judge, 'should fall back to the surviving (craft) judge');
  assert.equal(v.judge!.kind, 'craft');
  assert.equal(v.judge!.overall, 8);
});

test('evaluate: when the only judge returns null, falls back to mechanical-only scoring', async () => {
  const text = 'The dog ran across the yard and barked at the cat. He chased the bike down the street.';
  const aiComplete = async () => ({ text: 'not json at all' });
  const v = await judge.evaluate(text, { aiComplete, aiSelectProvider: selectProvider });
  assert.equal(v.judge, null);
  assert.equal(v.dualJudge, null);
  assert.equal(v.score, v.mechanical.score);
  assert.match(v.summary, /mechanical-only/);
});

// ── llmJudge: clamping + topIssues ordering ─────────────────────────────────

test('llmJudge: out-of-range dimension scores are clamped to 1..10', async () => {
  const text = 'Some chapter text that the judge will pretend to read carefully.';
  const payload = JSON.stringify({
    dimensions: [
      { name: 'a', score: 99, issues: ['x'] },   // clamps to 10
      { name: 'b', score: -5, issues: ['y'] },   // clamps to 1
    ],
  });
  const aiComplete = async () => ({ text: payload });
  const report = await judge.llmJudge(text, aiComplete, selectProvider, 'craft');
  assert.ok(report);
  const a = report!.dimensions.find(d => d.name === 'a');
  const b = report!.dimensions.find(d => d.name === 'b');
  assert.equal(a!.score, 10);
  assert.equal(b!.score, 1);
  // overall = (10 + 1) / 2 = 5.5
  assert.equal(report!.overall, 5.5);
  // Lowest-scoring dimension leads topIssues.
  assert.match(report!.topIssues[0], /^\[b 1\/10\]/);
});

test('llmJudge: trailing-comma JSON is recovered via the comma-strip fallback', async () => {
  const text = 'chapter text';
  const payload = '{ "dimensions": [ {"name":"a","score":7,"issues":["x"],} ], }';
  const aiComplete = async () => ({ text: payload });
  const report = await judge.llmJudge(text, aiComplete, selectProvider, 'craft');
  assert.ok(report, 'trailing-comma JSON should still parse after the fallback');
  assert.equal(report!.overall, 7);
});

test('llmJudge: returns null when the AI call throws', async () => {
  const text = 'chapter text';
  const aiComplete = async () => { throw new Error('network down'); };
  const report = await judge.llmJudge(text, aiComplete, selectProvider, 'craft');
  assert.equal(report, null);
});
