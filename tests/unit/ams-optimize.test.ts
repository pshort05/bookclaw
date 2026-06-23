import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMSAdsService, KeywordPerformance } from '../../gateway/src/services/ams-ads.ts';

const svc = new AMSAdsService();

function kw(over: Partial<KeywordPerformance>): KeywordPerformance {
  return {
    keyword: 'k',
    matchType: 'broad',
    impressions: 1000,
    clicks: 50,
    spendUSD: 10,
    salesUSD: 100,
    acos: 0.1,
    currentBidUSD: 0.5,
    ...over,
  };
}

test('clicks < 5 => keep (no action without data, even with zero sales)', () => {
  const r = svc.optimize({
    performance: [kw({ keyword: 'cold', clicks: 4, salesUSD: 0, spendUSD: 5, acos: 0 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 100,
    currentDailySpendUSD: 0,
  });
  assert.equal(r.recommendations[0].action, 'keep');
  assert.equal(r.recommendations[0].proposedBidUSD, 0.5);
  assert.match(r.recommendations[0].rationale, /Not enough data/);
});

test('zero sales + spend >= 3 => pause, proposedBid 0', () => {
  const r = svc.optimize({
    performance: [kw({ keyword: 'dud', clicks: 10, salesUSD: 0, spendUSD: 6, acos: 0 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 100,
    currentDailySpendUSD: 0,
  });
  assert.equal(r.recommendations[0].action, 'pause');
  assert.equal(r.recommendations[0].proposedBidUSD, 0);
});

test('zero sales but spend < 3 with enough clicks => NOT paused (falls through to keep)', () => {
  // clicks>=5 so not "no data"; sales 0 but spend 2 < 3 so the pause gate is skipped;
  // acos 0 so no high-acos branch; ends at the default keep.
  const r = svc.optimize({
    performance: [kw({ keyword: 'cheap', clicks: 8, salesUSD: 0, spendUSD: 2, acos: 0 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 100,
    currentDailySpendUSD: 0,
  });
  assert.equal(r.recommendations[0].action, 'keep');
});

test('high ACoS (>100%) with clicks <= 20 => decrease_bid, bid cut 50% (floored at 0.02)', () => {
  const r = svc.optimize({
    performance: [kw({ keyword: 'bleeder', clicks: 15, salesUSD: 5, spendUSD: 10, acos: 2.0, currentBidUSD: 0.6 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 100,
    currentDailySpendUSD: 0,
  });
  assert.equal(r.recommendations[0].action, 'decrease_bid');
  assert.equal(r.recommendations[0].proposedBidUSD, 0.3); // 0.6 * 0.5
});

test('high ACoS (>100%) with clicks > 20 => pause', () => {
  const r = svc.optimize({
    performance: [kw({ keyword: 'bigbleeder', clicks: 40, salesUSD: 5, spendUSD: 20, acos: 4.0, currentBidUSD: 0.6 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 100,
    currentDailySpendUSD: 0,
  });
  assert.equal(r.recommendations[0].action, 'pause');
  assert.equal(r.recommendations[0].proposedBidUSD, 0.3); // newBid still computed as 0.5x
});

test('ACoS above target*1.3 (but <=100%) => decrease_bid, bid cut 20%', () => {
  // target 30 => threshold 39%. acos 0.5 = 50% > 39%.
  const r = svc.optimize({
    performance: [kw({ keyword: 'warm', clicks: 50, salesUSD: 20, spendUSD: 10, acos: 0.5, currentBidUSD: 0.5 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 100,
    currentDailySpendUSD: 0,
  });
  assert.equal(r.recommendations[0].action, 'decrease_bid');
  assert.equal(r.recommendations[0].proposedBidUSD, 0.4); // 0.5 * 0.8
});

test('ACoS well below target/2 with sales => increase_bid, never more than 1.5x (the 2x rail)', () => {
  // proposed = min(bid*2, bid*1.5) = bid*1.5 — the 2x cap is the outer bound, 1.5x is what ships.
  const r = svc.optimize({
    performance: [kw({ keyword: 'star', clicks: 50, salesUSD: 200, spendUSD: 10, acos: 0.05, currentBidUSD: 0.5 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 1000,
    currentDailySpendUSD: 0,
  });
  assert.equal(r.recommendations[0].action, 'increase_bid');
  assert.equal(r.recommendations[0].proposedBidUSD, 0.75); // 0.5 * 1.5, never above 0.5*2=1.0
});

test('broad winner: acos < target, clicks >= 30 => promote_to_exact at 1.1x bid', () => {
  // Must avoid the increase_bid branch (acos < target*0.5). Use acos between target/2 and target.
  // target 30 => increase needs acos < 15. Use acos 20% (<30 but >15).
  const r = svc.optimize({
    performance: [kw({ keyword: 'promote', matchType: 'broad', clicks: 40, salesUSD: 50, spendUSD: 10, acos: 0.2, currentBidUSD: 0.5 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 100,
    currentDailySpendUSD: 0,
  });
  assert.equal(r.recommendations[0].action, 'promote_to_exact');
  assert.equal(r.recommendations[0].proposedBidUSD, 0.5 * 1.1);
});

test('SPEND-CAP suppression: increase_bid recs roll back to keep when budget ceiling would be exceeded', () => {
  // One profitable keyword wants an increase. budgetDelta = (newBid-bid)*max(1,clicks/30).
  // bid 0.5 -> 0.75, delta 0.25; clicks 60 => 0.25 * 2 = 0.5. currentDailySpend 99.8 + 0.5 = 100.3 > 100.
  const r = svc.optimize({
    performance: [kw({ keyword: 'star', clicks: 60, salesUSD: 200, spendUSD: 10, acos: 0.05, currentBidUSD: 0.5 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 100,
    currentDailySpendUSD: 99.8,
  });
  const rec = r.recommendations[0];
  assert.equal(rec.action, 'keep'); // suppressed
  assert.equal(rec.proposedBidUSD, rec.currentBidUSD);
  assert.match(rec.rationale, /suppressed/);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /exceeding your ceiling/);
});

test('within ceiling => increase_bid is NOT suppressed', () => {
  const r = svc.optimize({
    performance: [kw({ keyword: 'star', clicks: 60, salesUSD: 200, spendUSD: 10, acos: 0.05, currentBidUSD: 0.5 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 1000,
    currentDailySpendUSD: 10,
  });
  assert.equal(r.recommendations[0].action, 'increase_bid');
  assert.equal(r.warnings.length, 0);
});

test('report aggregates: overallACoS rounded to 1dp, totals rounded to cents', () => {
  const r = svc.optimize({
    performance: [
      kw({ keyword: 'a', clicks: 50, spendUSD: 10, salesUSD: 30, acos: 0.333 }),
      kw({ keyword: 'b', clicks: 50, spendUSD: 5, salesUSD: 15, acos: 0.333 }),
    ],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 100,
    currentDailySpendUSD: 0,
  });
  // total spend 15, total sales 45 => ACoS 33.33% -> 33.3
  assert.equal(r.totalSpendUSD, 15);
  assert.equal(r.totalSalesUSD, 45);
  assert.equal(r.overallACoS, 33.3);
});

test('no sales anywhere => overallACoS 0 (guarded division)', () => {
  const r = svc.optimize({
    performance: [kw({ keyword: 'z', clicks: 2, spendUSD: 5, salesUSD: 0, acos: 0 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 100,
    currentDailySpendUSD: 0,
  });
  assert.equal(r.overallACoS, 0);
});

test('wouldIncreaseDailySpendBy is never negative (clamped to 0 even when pauses lower budget)', () => {
  const r = svc.optimize({
    performance: [kw({ keyword: 'dud', clicks: 10, salesUSD: 0, spendUSD: 30, acos: 0 })],
    acosTargetPct: 30,
    dailyBudgetCeilingUSD: 100,
    currentDailySpendUSD: 0,
  });
  // pause subtracts from budgetDelta; the report clamps to >= 0.
  assert.equal(r.recommendations[0].action, 'pause');
  assert.equal(r.wouldIncreaseDailySpendBy, 0);
});
