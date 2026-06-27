/**
 * Unit tests for the Try-Fail & Escalation Auditor deterministic core
 * (gateway/src/services/try-fail/score.ts). Pure functions over fixture
 * AuditExtraction shapes — network-free.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessEscalation,
  detectEarlyEasyWin,
  detectFlatEscalation,
  detectEasyResolutions,
  detectNoTryFail,
  assessCrucible,
  buildLadders,
  assembleReport,
} from '../../gateway/src/services/try-fail/score.js';
import type { AttemptRecord, AuditExtraction, ProtagonistLadder } from '../../gateway/src/services/try-fail/types.js';

function attempt(over: Partial<AttemptRecord>): AttemptRecord {
  return {
    protagonist: 'Hero',
    chapter: 1,
    goal: 'goal',
    conflict: 'conflict',
    outcome: 'failure',
    cost: 'medium',
    personalStakes: 2,
    peopleAffected: 1,
    ...over,
  };
}

function ladderOf(attempts: AttemptRecord[]): ProtagonistLadder {
  const ladders = buildLadders({ protagonists: ['Hero'], attempts, crucibleSignals: [] });
  return ladders[0];
}

// --- assessEscalation -------------------------------------------------------

test('assessEscalation: deepens true when personalStakes rise', () => {
  const r = assessEscalation([
    attempt({ chapter: 1, personalStakes: 1, peopleAffected: 1 }),
    attempt({ chapter: 5, personalStakes: 4, peopleAffected: 1 }),
  ]);
  assert.equal(r.deepens, true);
});

test('assessEscalation: broadens true when peopleAffected rise', () => {
  const r = assessEscalation([
    attempt({ chapter: 1, personalStakes: 2, peopleAffected: 1 }),
    attempt({ chapter: 5, personalStakes: 2, peopleAffected: 50 }),
  ]);
  assert.equal(r.broadens, true);
});

test('assessEscalation: deepens & broadens false when flat', () => {
  const r = assessEscalation([
    attempt({ chapter: 1, personalStakes: 2, peopleAffected: 3 }),
    attempt({ chapter: 5, personalStakes: 2, peopleAffected: 3 }),
  ]);
  assert.equal(r.deepens, false);
  assert.equal(r.broadens, false);
});

test('assessEscalation: false with fewer than 2 attempts', () => {
  const r = assessEscalation([attempt({ personalStakes: 1, peopleAffected: 1 })]);
  assert.equal(r.deepens, false);
  assert.equal(r.broadens, false);
});

// --- detectEarlyEasyWin -----------------------------------------------------

test('detectEarlyEasyWin: first attempt success + low cost → high', () => {
  const ladder = ladderOf([
    attempt({ chapter: 1, outcome: 'success', cost: 'low' }),
    attempt({ chapter: 3, outcome: 'failure', cost: 'high' }),
  ]);
  const f = detectEarlyEasyWin(ladder);
  assert.ok(f);
  assert.equal(f!.severity, 'high');
  assert.equal(f!.category, 'early_easy_win');
});

test('detectEarlyEasyWin: first attempt failure → null', () => {
  const ladder = ladderOf([attempt({ chapter: 1, outcome: 'failure', cost: 'low' })]);
  assert.equal(detectEarlyEasyWin(ladder), null);
});

test('detectEarlyEasyWin: first attempt success with high cost → null', () => {
  const ladder = ladderOf([attempt({ chapter: 1, outcome: 'success', cost: 'high' })]);
  assert.equal(detectEarlyEasyWin(ladder), null);
});

// --- detectFlatEscalation ---------------------------------------------------

test('detectFlatEscalation: ≥3 attempts, no deepen/broaden → medium', () => {
  const ladder = ladderOf([
    attempt({ chapter: 1, personalStakes: 2, peopleAffected: 1 }),
    attempt({ chapter: 2, personalStakes: 2, peopleAffected: 1 }),
    attempt({ chapter: 3, personalStakes: 2, peopleAffected: 1 }),
  ]);
  const f = detectFlatEscalation(ladder);
  assert.ok(f);
  assert.equal(f!.severity, 'medium');
  assert.equal(f!.category, 'flat_escalation');
});

test('detectFlatEscalation: ≥3 attempts that deepen → null', () => {
  const ladder = ladderOf([
    attempt({ chapter: 1, personalStakes: 1, peopleAffected: 1 }),
    attempt({ chapter: 2, personalStakes: 3, peopleAffected: 1 }),
    attempt({ chapter: 3, personalStakes: 5, peopleAffected: 1 }),
  ]);
  assert.equal(detectFlatEscalation(ladder), null);
});

test('detectFlatEscalation: only 2 attempts → null', () => {
  const ladder = ladderOf([
    attempt({ chapter: 1, personalStakes: 2, peopleAffected: 1 }),
    attempt({ chapter: 2, personalStakes: 2, peopleAffected: 1 }),
  ]);
  assert.equal(detectFlatEscalation(ladder), null);
});

// --- detectEasyResolutions --------------------------------------------------

test('detectEasyResolutions: success + none cost on high stakes → medium finding', () => {
  const findings = detectEasyResolutions([
    attempt({ chapter: 2, outcome: 'success', cost: 'none', personalStakes: 5 }),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'medium');
  assert.equal(findings[0].category, 'easy_resolution');
});

test('detectEasyResolutions: success + none cost on low stakes → none', () => {
  const findings = detectEasyResolutions([
    attempt({ chapter: 2, outcome: 'success', cost: 'none', personalStakes: 2 }),
  ]);
  assert.equal(findings.length, 0);
});

test('detectEasyResolutions: success with a cost on high stakes → none', () => {
  const findings = detectEasyResolutions([
    attempt({ chapter: 2, outcome: 'success', cost: 'high', personalStakes: 5 }),
  ]);
  assert.equal(findings.length, 0);
});

// --- detectNoTryFail --------------------------------------------------------

test('detectNoTryFail: attempts with no failure/partial → medium', () => {
  const ladder = ladderOf([
    attempt({ chapter: 1, outcome: 'success', cost: 'high' }),
    attempt({ chapter: 2, outcome: 'none', cost: 'low' }),
  ]);
  const f = detectNoTryFail(ladder);
  assert.ok(f);
  assert.equal(f!.severity, 'medium');
  assert.equal(f!.category, 'no_try_fail_cycle');
});

test('detectNoTryFail: a failure present → null', () => {
  const ladder = ladderOf([
    attempt({ chapter: 1, outcome: 'success', cost: 'high' }),
    attempt({ chapter: 2, outcome: 'failure', cost: 'low' }),
  ]);
  assert.equal(detectNoTryFail(ladder), null);
});

test('detectNoTryFail: a partial present → null', () => {
  const ladder = ladderOf([attempt({ chapter: 1, outcome: 'partial' })]);
  assert.equal(detectNoTryFail(ladder), null);
});

// --- assessCrucible ---------------------------------------------------------

test('assessCrucible: no signals → not present, high finding', () => {
  const c = assessCrucible({ protagonists: [], attempts: [], crucibleSignals: [] });
  assert.equal(c.present, false);
  assert.equal(c.strongest, 'none');
  assert.ok(c.finding);
  assert.equal(c.finding!.severity, 'high');
  assert.equal(c.finding!.category, 'missing_crucible');
});

test('assessCrucible: only weak signal → present but high finding', () => {
  const c = assessCrucible({
    protagonists: [],
    attempts: [],
    crucibleSignals: [{ kind: 'setting', description: 'a wall', strength: 'weak', chapter: 1 }],
  });
  assert.equal(c.strongest, 'weak');
  assert.ok(c.finding);
  assert.equal(c.finding!.severity, 'high');
});

test('assessCrucible: strong signal → present, no finding', () => {
  const c = assessCrucible({
    protagonists: [],
    attempts: [],
    crucibleSignals: [
      { kind: 'duty', description: 'oath', strength: 'moderate', chapter: 1 },
      { kind: 'relationship', description: 'bond', strength: 'strong', chapter: 4 },
    ],
  });
  assert.equal(c.present, true);
  assert.equal(c.strongest, 'strong');
  assert.equal(c.finding, undefined);
});

// --- buildLadders -----------------------------------------------------------

test('buildLadders: groups by protagonist and orders by chapter', () => {
  const ex: AuditExtraction = {
    protagonists: ['Hero', 'Rival'],
    attempts: [
      attempt({ protagonist: 'Hero', chapter: 5 }),
      attempt({ protagonist: 'Rival', chapter: 2 }),
      attempt({ protagonist: 'Hero', chapter: 1 }),
    ],
    crucibleSignals: [],
  };
  const ladders = buildLadders(ex);
  const hero = ladders.find((l) => l.protagonist === 'Hero')!;
  assert.deepEqual(hero.attempts.map((a) => a.chapter), [1, 5]);
  assert.equal(hero.firstAttemptOutcome, hero.attempts[0].outcome);
  const rival = ladders.find((l) => l.protagonist === 'Rival')!;
  assert.equal(rival.attempts.length, 1);
});

// --- assembleReport ---------------------------------------------------------

test('assembleReport: aggregated findings sorted high→low, summary non-empty', () => {
  const ex: AuditExtraction = {
    protagonists: ['Hero'],
    attempts: [
      // first-attempt easy win (high) + the only outcome is success (no try-fail, medium)
      attempt({ chapter: 1, outcome: 'success', cost: 'low', personalStakes: 1, peopleAffected: 1 }),
      attempt({ chapter: 2, outcome: 'success', cost: 'none', personalStakes: 5, peopleAffected: 1 }),
    ],
    crucibleSignals: [], // → high missing-crucible
  };
  const r = assembleReport('my-book', ex, false, { provider: 'gemini', model: 'g-2' });
  assert.equal(r.bookSlug, 'my-book');
  assert.equal(r.condensed, false);
  assert.deepEqual(r.model, { provider: 'gemini', model: 'g-2' });
  assert.ok(r.summary.length > 0);
  // sorted by severity, high first
  const order = { high: 0, medium: 1, low: 2 } as const;
  for (let i = 1; i < r.findings.length; i++) {
    assert.ok(order[r.findings[i - 1].severity] <= order[r.findings[i].severity]);
  }
  // at least one high from missing crucible + early easy win
  assert.ok(r.findings.some((f) => f.severity === 'high'));
});

// --- review fixes (2026-06-27) ---------------------------------------------

test('assessEscalation: a mid-arc peak (1→5→2) counts as deepened, not flat', () => {
  const r = assessEscalation([
    attempt({ personalStakes: 1, peopleAffected: 1, chapter: 1 }),
    attempt({ personalStakes: 5, peopleAffected: 8, chapter: 2 }),
    attempt({ personalStakes: 2, peopleAffected: 2, chapter: 3 }),
  ]);
  assert.equal(r.deepens, true);
  assert.equal(r.broadens, true);
});

test('assessEscalation: a pure decline (5→3→1) is not escalation', () => {
  const r = assessEscalation([
    attempt({ personalStakes: 5, peopleAffected: 5, chapter: 1 }),
    attempt({ personalStakes: 1, peopleAffected: 1, chapter: 2 }),
  ]);
  assert.equal(r.deepens, false);
  assert.equal(r.broadens, false);
});

test('assembleReport: an empty manuscript raises no spurious high missing-crucible finding', () => {
  const r = assembleReport('slug', { protagonists: [], attempts: [], crucibleSignals: [] }, false);
  assert.equal(r.protagonists.length, 0);
  assert.equal(r.findings.filter((f) => f.severity === 'high').length, 0);
  assert.equal(r.crucible.finding, undefined);
});
