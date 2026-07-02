import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CostTracker } from '../../gateway/src/services/costs.ts';

test('flush() forces the debounced write so late spend is not lost on shutdown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'costs-flush-'));
  const persistPath = join(dir, 'costs.json');
  try {
    const c = new CostTracker({ persistPath });
    c.record('openrouter', 1000, 0.10, 'book-a'); // schedules a 2s debounce, no write yet
    assert.equal(existsSync(persistPath), false, 'debounced write has not fired within the window');

    await c.flush(); // shutdown path: cancel debounce + force write

    assert.equal(existsSync(persistPath), true, 'flush wrote the state file');
    const state = JSON.parse(readFileSync(persistPath, 'utf-8'));
    assert.equal(state.totalSpend, 0.10);
    assert.equal(state.byBook['book-a'], 0.10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('record accumulates total and attributes per book', () => {
  const c = new CostTracker({});
  c.record('openrouter', 1000, 0.10, 'book-a');
  c.record('openrouter', 1000, 0.20, 'book-b');
  c.record('openrouter', 1000, 0.05); // no slug -> unattributed
  const s = c.getStatus();
  assert.equal(s.total, 0.35);
  assert.equal(s.byBook['book-a'], 0.10);
  assert.equal(s.byBook['book-b'], 0.20);
  assert.equal(s.byBook['unattributed'], 0.05);
});

test('total and byBook survive the budget reset() (daily/monthly only)', async () => {
  const c = new CostTracker({});
  c.record('openrouter', 1000, 0.10, 'book-a');
  await c.reset();
  const s = c.getStatus();
  assert.equal(s.daily, 0);
  assert.equal(s.monthly, 0);
  assert.equal(s.total, 0.10);
  assert.equal(s.byBook['book-a'], 0.10);
});

test('resetLifetime zeroes total and only the listed books', async () => {
  const c = new CostTracker({});
  c.record('openrouter', 1000, 0.10, 'book-a');
  c.record('openrouter', 1000, 0.20, 'book-b');
  c.record('openrouter', 1000, 0.05); // unattributed
  await c.resetLifetime({ books: ['book-a'], unattributed: true });
  const s = c.getStatus();
  assert.equal(s.total, 0);
  assert.equal(s.byBook['book-a'], undefined);
  assert.equal(s.byBook['unattributed'], undefined);
  assert.equal(s.byBook['book-b'], 0.20); // untouched
});

test('getStatus exposes total and byBook shape', () => {
  const c = new CostTracker({});
  const s = c.getStatus();
  assert.equal(s.total, 0);
  assert.deepEqual(s.byBook, {});
});

test('sub-cent spend is preserved at 4-decimal resolution (not floored to $0.00)', () => {
  const c = new CostTracker({});
  c.record('openrouter', 1000, 0.0003, 'book-a'); // cheap-model run
  const s = c.getStatus();
  assert.equal(s.total, 0.0003);
  assert.equal(s.byBook['book-a'], 0.0003);
});

test('setLimits updates the live limits so a config change takes effect without restart', () => {
  const c = new CostTracker({ dailyLimit: 5, monthlyLimit: 50 });
  c.record('claude', 0, 10);            // $10 spent — over the $5 default daily
  assert.equal(c.isOverBudget(), true, 'over the $5 default');
  c.setLimits(100, 500);                // user raises limits in Settings
  assert.equal(c.dailyLimit, 100);
  assert.equal(c.monthlyLimit, 500);
  assert.equal(c.isOverBudget(), false, '$10 is under the new $100 daily — takes effect immediately');
  assert.equal(c.getStatus().dailyLimit, 100, 'getStatus reflects the new limit');
});

test('setLimits ignores non-finite / negative values (keeps the prior limit)', () => {
  const c = new CostTracker({ dailyLimit: 5, monthlyLimit: 50 });
  c.setLimits(NaN, -3);
  assert.equal(c.dailyLimit, 5, 'NaN ignored');
  assert.equal(c.monthlyLimit, 50, 'negative ignored');
  c.setLimits(20, undefined as any);
  assert.equal(c.dailyLimit, 20, 'daily updated');
  assert.equal(c.monthlyLimit, 50, 'undefined monthly leaves prior value');
});
