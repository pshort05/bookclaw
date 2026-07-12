/**
 * Unit tests for gateway/src/services/prose-evolver.ts.
 *
 * Network-free: judge, soul, aiComplete, and aiSelectProvider are all fakes.
 * The fake `aiComplete` distinguishes the REFLECT vs REVISE call by looking
 * for the word "REFLECTION" in the system prompt (the two real prompts differ
 * on exactly that word), and the fake judge scores a candidate purely by
 * looking up its text in a caller-supplied score table — so each test scripts
 * the exact score sequence the loop will see.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProseEvolverService,
  DEFAULT_ROUNDS,
  MAX_ROUNDS,
  PLATEAU_STOP,
} from '../../gateway/src/services/prose-evolver.js';
import type { WritingJudgeService, QualityVerdict } from '../../gateway/src/services/writing-judge.js';
import type { SoulService } from '../../gateway/src/services/soul.js';
import type { AICompleteFn, AISelectProviderFn } from '../../gateway/src/services/context-engine.js';

const ORIGINAL_TEXT = 'The original passage text.';

function stubVerdict(score: number): QualityVerdict {
  return {
    score,
    retry: score < 70,
    mechanical: { wordCount: 5, issues: [], score: 100 },
    judge: null,
    dualJudge: null,
    summary: `stub score ${score}`,
    retryFeedback: 'stub feedback: tighten the verbs.',
  };
}

/**
 * Build a fake judge that scores `originalText` at `baselineScore` and any
 * `rev-N` candidate text at `reviseScores[N]` (0-based, in call order).
 */
function makeJudge(baselineScore: number, reviseScores: number[]): WritingJudgeService {
  return {
    async evaluate(text: string): Promise<QualityVerdict> {
      if (text === ORIGINAL_TEXT) return stubVerdict(baselineScore);
      const m = /^rev-(\d+)$/.exec(text);
      const idx = m ? Number(m[1]) : -1;
      const score = idx >= 0 && idx < reviseScores.length ? reviseScores[idx] : 0;
      return stubVerdict(score);
    },
  } as unknown as WritingJudgeService;
}

function makeSoul(): SoulService {
  return { getFullContext: () => 'STUB AUTHOR VOICE' } as unknown as SoulService;
}

/** Fake AI: reflection calls (system mentions "REFLECTION") return a fixed
 *  diagnosis; revise calls return "rev-0", "rev-1", ... in call order. */
function makeAI(): { aiComplete: AICompleteFn; aiSelectProvider: AISelectProviderFn; reviseCalls: () => number } {
  let reviseCount = 0;
  const aiComplete: AICompleteFn = async (req) => {
    if (req.system.includes('REFLECTION')) {
      return { text: 'Tighten the weak verbs.', tokensUsed: 10, estimatedCost: 0, provider: req.provider };
    }
    const text = `rev-${reviseCount++}`;
    return { text, tokensUsed: 10, estimatedCost: 0, provider: req.provider };
  };
  const aiSelectProvider: AISelectProviderFn = (_taskType: string) => ({ id: 'stub-provider' });
  return { aiComplete, aiSelectProvider, reviseCalls: () => reviseCount };
}

// ── Accept / reject on the Pareto floor ─────────────────────────────────────

test('evolve: accepts a non-regressing revision and rejects a regressing one', async () => {
  const svc = new ProseEvolverService();
  const judge = makeJudge(50, [60, 55]); // round1 improves to 60, round2 regresses to 55
  const soul = makeSoul();
  const { aiComplete, aiSelectProvider } = makeAI();

  const result = await svc.evolve({ text: ORIGINAL_TEXT, rounds: 2 }, judge, soul, aiComplete, aiSelectProvider);

  assert.equal(result.baselineScore, 50);
  assert.equal(result.rounds.length, 2);

  assert.equal(result.rounds[0].accepted, true);
  assert.equal(result.rounds[0].score, 60);
  assert.equal(result.rounds[0].text, 'rev-0');

  assert.equal(result.rounds[1].accepted, false);
  assert.equal(result.rounds[1].score, 55);

  // The regressing round-2 candidate must NOT overwrite the accepted best.
  assert.equal(result.finalText, 'rev-0');
  assert.equal(result.finalScore, 60);
  assert.equal(result.improved, true);
});

// ── Plateau early-stop ───────────────────────────────────────────────────────

test(`evolve: stops after ${PLATEAU_STOP} consecutive non-improving rounds with stoppedReason 'plateau'`, async () => {
  const svc = new ProseEvolverService();
  // rounds=5 requested, but both rounds regress below baseline → plateau after 2.
  const judge = makeJudge(50, [45, 40, 35, 30, 25]);
  const soul = makeSoul();
  const { aiComplete, aiSelectProvider } = makeAI();

  const result = await svc.evolve({ text: ORIGINAL_TEXT, rounds: 5 }, judge, soul, aiComplete, aiSelectProvider);

  assert.equal(result.stoppedReason, 'plateau');
  assert.equal(result.rounds.length, PLATEAU_STOP);
  assert.equal(result.improved, false);
  assert.equal(result.finalText, ORIGINAL_TEXT);
  assert.equal(result.finalScore, 50);
});

// ── Rounds clamping ──────────────────────────────────────────────────────────

test('evolve: rounds clamps to [1, MAX_ROUNDS]', async () => {
  const svc = new ProseEvolverService();
  const soul = makeSoul();

  // Above the cap: keeps improving every round, so it must stop at MAX_ROUNDS,
  // not the requested 10.
  {
    const scores = [60, 70, 80, 90, 100, 110]; // more than MAX_ROUNDS entries available
    const judge = makeJudge(50, scores);
    const { aiComplete, aiSelectProvider } = makeAI();
    const result = await svc.evolve({ text: ORIGINAL_TEXT, rounds: 10 }, judge, soul, aiComplete, aiSelectProvider);
    assert.equal(result.rounds.length, MAX_ROUNDS);
  }

  // Below the floor: rounds=0 clamps to 1 round.
  {
    const judge = makeJudge(50, [45]); // single non-improving round
    const { aiComplete, aiSelectProvider } = makeAI();
    const result = await svc.evolve({ text: ORIGINAL_TEXT, rounds: 0 }, judge, soul, aiComplete, aiSelectProvider);
    assert.equal(result.rounds.length, 1);
  }
});

test('evolve: default rounds is DEFAULT_ROUNDS when omitted', async () => {
  const svc = new ProseEvolverService();
  const soul = makeSoul();
  // Keeps improving so it never plateaus — runs exactly DEFAULT_ROUNDS rounds.
  const judge = makeJudge(50, [60, 70, 80]);
  const { aiComplete, aiSelectProvider } = makeAI();
  const result = await svc.evolve({ text: ORIGINAL_TEXT }, judge, soul, aiComplete, aiSelectProvider);
  assert.equal(result.rounds.length, DEFAULT_ROUNDS);
});

// ── max-rounds: keeps improving to the cap ──────────────────────────────────

test("evolve: stoppedReason 'max-rounds' when it keeps improving to the cap", async () => {
  const svc = new ProseEvolverService();
  const soul = makeSoul();
  const judge = makeJudge(50, [55, 60, 65, 70, 75]); // strictly improves every round
  const { aiComplete, aiSelectProvider } = makeAI();

  const result = await svc.evolve({ text: ORIGINAL_TEXT, rounds: MAX_ROUNDS }, judge, soul, aiComplete, aiSelectProvider);

  assert.equal(result.rounds.length, MAX_ROUNDS);
  assert.equal(result.stoppedReason, 'max-rounds');
  assert.equal(result.improved, true);
  assert.equal(result.finalScore, 75);
  assert.equal(result.finalText, 'rev-4');
});

// ── no-improvement: single round, no plateau reached, no gain ──────────────

test("evolve: stoppedReason 'no-improvement' when the loop ends without ever beating baseline", async () => {
  const svc = new ProseEvolverService();
  const soul = makeSoul();
  // rounds=1: not enough rounds to reach PLATEAU_STOP=2, and the one round
  // ties the baseline (accepted via the >= floor, but not a strict improvement).
  const judge = makeJudge(50, [50]);
  const { aiComplete, aiSelectProvider } = makeAI();

  const result = await svc.evolve({ text: ORIGINAL_TEXT, rounds: 1 }, judge, soul, aiComplete, aiSelectProvider);

  assert.equal(result.rounds.length, 1);
  assert.equal(result.rounds[0].accepted, true); // tie is accepted (no-regression floor)
  assert.equal(result.stoppedReason, 'no-improvement');
  assert.equal(result.improved, false); // but not a strict improvement
  assert.equal(result.finalScore, 50);
});
