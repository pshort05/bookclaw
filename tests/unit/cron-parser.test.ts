/**
 * Characterization tests for CronParser (gateway/src/services/cron-scheduler.ts).
 *
 * Covers the pure static methods CronParser.parse() / .matches() / .nextRun(),
 * plus the missed-run recovery semantics the scheduler relies on. All date math
 * is UTC and every nextRun assertion passes an explicit `from` reference time —
 * nothing here reads the wall clock, so the suite is deterministic.
 *
 * NOTE on the exported surface: CronParser was made `export` solely so these
 * deterministic tests can pass a fixed `from` date into nextRun() (the public
 * validateCronExpression() helper only computes nextRun from `new Date()`).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CronParser } from '../../gateway/src/services/cron-scheduler.js';

// A fixed reference instant. 2026-06-15 is a Monday (UTC day-of-week = 1).
const MON_2026_06_15_0000 = new Date('2026-06-15T00:00:00.000Z');

describe('CronParser.parse — field validation', () => {
  test('rejects an expression that is not exactly 5 fields', () => {
    assert.equal(CronParser.parse('* * * *'), null);        // 4 fields
    assert.equal(CronParser.parse('* * * * * *'), null);    // 6 fields
    assert.equal(CronParser.parse(''), null);               // empty
  });

  test('parses all-star "* * * * *" into full ranges per field', () => {
    const p = CronParser.parse('* * * * *');
    assert.ok(p);
    assert.equal(p!.minute.values.size, 60);  // 0..59
    assert.equal(p!.hour.values.size, 24);    // 0..23
    assert.equal(p!.dom.values.size, 31);     // 1..31
    assert.equal(p!.month.values.size, 12);   // 1..12
    assert.equal(p!.dow.values.size, 7);      // 0..6
  });

  test('parses a single number to a one-element set', () => {
    const p = CronParser.parse('30 9 * * *');
    assert.ok(p);
    assert.deepEqual([...p!.minute.values], [30]);
    assert.deepEqual([...p!.hour.values], [9]);
  });

  test('parses a range a-b inclusive', () => {
    const p = CronParser.parse('* 9-11 * * *');
    assert.deepEqual([...p!.hour.values].sort((a, b) => a - b), [9, 10, 11]);
  });

  test('parses a comma list', () => {
    const p = CronParser.parse('0,15,30,45 * * * *');
    assert.deepEqual([...p!.minute.values].sort((a, b) => a - b), [0, 15, 30, 45]);
  });

  test('parses a step over star: */15 → 0,15,30,45', () => {
    const p = CronParser.parse('*/15 * * * *');
    assert.deepEqual([...p!.minute.values].sort((a, b) => a - b), [0, 15, 30, 45]);
  });

  test('parses a step over a range: 0-30/10 → 0,10,20,30', () => {
    const p = CronParser.parse('0-30/10 * * * *');
    assert.deepEqual([...p!.minute.values].sort((a, b) => a - b), [0, 10, 20, 30]);
  });

  test('rejects an out-of-range value (minute 60)', () => {
    assert.equal(CronParser.parse('60 * * * *'), null);
  });

  test('rejects an inverted range (from > to)', () => {
    assert.equal(CronParser.parse('* 11-9 * * *'), null);
  });

  test('rejects a zero step', () => {
    assert.equal(CronParser.parse('*/0 * * * *'), null);
  });

  test('rejects garbage tokens', () => {
    assert.equal(CronParser.parse('abc * * * *'), null);
  });

  // NOTE: characterizing actual behavior — month uses range 1..12, dom 1..31,
  // so month 0 and dom 0 are rejected (below their min), unlike minute/hour/dow.
  test('rejects month 0 and day-of-month 0 (their min is 1)', () => {
    assert.equal(CronParser.parse('* * 0 * *'), null);
    assert.equal(CronParser.parse('* * * 0 *'), null);
  });
});

describe('CronParser.nextRun — basic forward scan (UTC, inclusive of next minute)', () => {
  test('"* * * * *" from 00:00:00 returns the very next minute (00:01)', () => {
    const next = CronParser.nextRun(CronParser.parse('* * * * *'), MON_2026_06_15_0000);
    assert.ok(next);
    assert.equal(next!.toISOString(), '2026-06-15T00:01:00.000Z');
  });

  // NOTE: nextRun bumps to the NEXT minute before scanning (setUTCMinutes+1),
  // so a `from` that already sits exactly on a matching minute is skipped — the
  // match returned is the following occurrence, not `from` itself.
  test('a daily 09:00 job, asked at exactly 09:00, returns the NEXT day 09:00', () => {
    const from = new Date('2026-06-15T09:00:00.000Z');
    const next = CronParser.nextRun(CronParser.parse('0 9 * * *'), from);
    assert.equal(next!.toISOString(), '2026-06-16T09:00:00.000Z');
  });

  test('a daily 09:00 job, asked at 08:30, returns same-day 09:00', () => {
    const from = new Date('2026-06-15T08:30:00.000Z');
    const next = CronParser.nextRun(CronParser.parse('0 9 * * *'), from);
    assert.equal(next!.toISOString(), '2026-06-15T09:00:00.000Z');
  });

  test('seconds/millis on `from` are zeroed before scanning', () => {
    const from = new Date('2026-06-15T08:59:45.123Z');
    const next = CronParser.nextRun(CronParser.parse('0 9 * * *'), from);
    assert.equal(next!.toISOString(), '2026-06-15T09:00:00.000Z');
  });

  test('a monthly job (00:00 on the 1st) rolls into next month', () => {
    const from = new Date('2026-06-15T12:00:00.000Z');
    const next = CronParser.nextRun(CronParser.parse('0 0 1 * *'), from);
    assert.equal(next!.toISOString(), '2026-07-01T00:00:00.000Z');
  });

  test('returns null for an impossible expression (Feb 30) within the 4-year cap', () => {
    const next = CronParser.nextRun(CronParser.parse('0 0 30 2 *'), MON_2026_06_15_0000);
    assert.equal(next, null);
  });
});

describe('CronParser POSIX day-of-month / day-of-week OR-semantics', () => {
  // When BOTH dom and dow are restricted (neither is the full set), POSIX cron
  // fires when EITHER matches. 2026-06-15 is a Monday.
  test('"0 0 1 * 5" (1st OR Friday) matches the next Friday before the next 1st', () => {
    // From Mon 2026-06-15, the next Friday is 2026-06-19; the next 1st is
    // 2026-07-01. OR-semantics → the Friday wins.
    const from = new Date('2026-06-15T00:00:00.000Z');
    const next = CronParser.nextRun(CronParser.parse('0 0 1 * 5'), from);
    assert.equal(next!.toISOString(), '2026-06-19T00:00:00.000Z'); // Friday
  });

  test('matches() OR-semantics: a date that is the 1st but NOT the chosen weekday still matches', () => {
    const parsed = CronParser.parse('0 0 1 * 5'); // 1st OR Friday
    // 2026-07-01 is a Wednesday (dow 3): dom matches, dow does not → OR true.
    const firstOfJuly = new Date('2026-07-01T00:00:00.000Z');
    assert.equal(firstOfJuly.getUTCDay(), 3);
    assert.equal(CronParser.matches(firstOfJuly, parsed), true);
  });

  test('AND-semantics when only ONE of dom/dow is restricted: "0 0 15 * 1" needs the 15th AND a Monday', () => {
    // dom restricted (={15}), dow = '*' (full set) → AND. So it only fires on a
    // 15th. 2026-06-15 is itself a Monday but dow is unrestricted, so the gate
    // is simply "the 15th at 00:00".
    const parsed = CronParser.parse('0 0 15 * *');
    assert.equal(CronParser.matches(new Date('2026-06-15T00:00:00.000Z'), parsed), true);
    assert.equal(CronParser.matches(new Date('2026-07-15T00:00:00.000Z'), parsed), true);
    assert.equal(CronParser.matches(new Date('2026-06-16T00:00:00.000Z'), parsed), false);
  });

  test('genuine AND case: "0 0 13 * 5" (13th AND nothing else restricted on dow=*) — both restricted picks OR', () => {
    // Both dom={13} and dow={5} restricted → OR. Friday the 13th OR any 13th OR
    // any Friday. From 2026-06-15: next Friday 2026-06-19 comes first.
    const next = CronParser.nextRun(CronParser.parse('0 0 13 * 5'), new Date('2026-06-15T00:00:00.000Z'));
    assert.equal(next!.toISOString(), '2026-06-19T00:00:00.000Z');
  });
});

describe('CronParser missed-run recovery (scheduler initialize semantics)', () => {
  // The scheduler computes the next run AFTER a job's lastRunAt; if that instant
  // is already in the past relative to "now", it is treated as a missed slot to
  // be fired on catch-up. This mirrors initialize() in CronSchedulerService.
  test('nextRun from a past lastRunAt lands in the past (a missed slot) for a daily job', () => {
    const lastRunAt = new Date('2026-06-10T09:00:00.000Z'); // job last ran 5 days ago
    const now = new Date('2026-06-15T12:00:00.000Z');
    const missed = CronParser.nextRun(CronParser.parse('0 9 * * *'), lastRunAt);
    assert.ok(missed);
    // The slot immediately after the last run is 2026-06-11 09:00 — in the past.
    assert.equal(missed!.toISOString(), '2026-06-11T09:00:00.000Z');
    assert.ok(missed!.getTime() <= now.getTime(), 'missed slot should be <= now (catch-up fires)');
  });

  test('nextRun from a recent lastRunAt lands in the FUTURE (no catch-up needed)', () => {
    const lastRunAt = new Date('2026-06-15T09:00:00.000Z'); // ran today at 9
    const now = new Date('2026-06-15T12:00:00.000Z');
    const next = CronParser.nextRun(CronParser.parse('0 9 * * *'), lastRunAt);
    assert.equal(next!.toISOString(), '2026-06-16T09:00:00.000Z');
    assert.ok(next!.getTime() > now.getTime(), 'next slot should be in the future (no catch-up)');
  });
});
