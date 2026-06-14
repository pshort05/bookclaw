import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CostTracker } from '../../gateway/src/services/costs.ts';

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
