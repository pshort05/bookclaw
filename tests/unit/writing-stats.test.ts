/**
 * Unit tests for gateway/src/services/writing-stats.ts (WritingStatsStore)
 * and its wiring into HeartbeatService (#8 Writing-Stats Backend port).
 *
 * Covers:
 *  - computeStreaks: contiguous run, gap-broken run, empty array.
 *  - recordWords: accumulation across calls + JSON persistence round-trip
 *    (temp dir, read the file back into a fresh store instance).
 *  - getSnapshot: today/week rollover with an injected `now`.
 *  - null-store degradation: HeartbeatService built with no workspaceDir
 *    doesn't throw on addWords / getWritingStats.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeStreaks, WritingStatsStore } from '../../gateway/src/services/writing-stats.js';
import { HeartbeatService } from '../../gateway/src/services/heartbeat.js';

const memoryStub = {} as never;

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'bookclaw-writing-stats-'));
}

// ── computeStreaks (pure) ─────────────────────────────────────────────────

test('computeStreaks: a contiguous run of days scores current === longest', () => {
  const { current, longest } = computeStreaks(['2026-07-01', '2026-07-02', '2026-07-03']);
  assert.equal(current, 3);
  assert.equal(longest, 3);
});

test('computeStreaks: a gap breaks the run — longest keeps the max, current tracks the trailing run', () => {
  // 07-01,07-02 (run of 2) ... gap ... 07-05,07-06,07-07 (run of 3, trailing)
  const { current, longest } = computeStreaks([
    '2026-07-01', '2026-07-02',
    '2026-07-05', '2026-07-06', '2026-07-07',
  ]);
  assert.equal(longest, 3);
  assert.equal(current, 3);
});

test('computeStreaks: a gap right before the last day drops current to 1 while longest keeps the earlier run', () => {
  const { current, longest } = computeStreaks([
    '2026-07-01', '2026-07-02', '2026-07-03', // run of 3
    '2026-07-10', // isolated, trailing
  ]);
  assert.equal(longest, 3);
  assert.equal(current, 1);
});

test('computeStreaks: empty array returns zero for both', () => {
  const { current, longest } = computeStreaks([]);
  assert.equal(current, 0);
  assert.equal(longest, 0);
});

// ── WritingStatsStore.recordWords: accumulation + persistence round-trip ──

test('recordWords: repeated calls on the same day accumulate', async () => {
  const root = tempWorkspace();
  try {
    const store = new WritingStatsStore(root);
    const now = new Date('2026-07-11T12:00:00.000Z');
    await store.recordWords(500, now);
    await store.recordWords(250, now);
    const snapshot = store.getSnapshot(0, now);
    assert.equal(snapshot.wordsToday, 750);
    assert.equal(snapshot.wordsTotal, 750);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recordWords: persists to disk and a fresh store instance reloads it', async () => {
  const root = tempWorkspace();
  try {
    const now = new Date('2026-07-11T12:00:00.000Z');
    const store1 = new WritingStatsStore(root);
    await store1.recordWords(1200, now);

    const store2 = new WritingStatsStore(root);
    await store2.initialize();
    const snapshot = store2.getSnapshot(0, now);
    assert.equal(snapshot.wordsToday, 1200);
    assert.equal(snapshot.wordsTotal, 1200);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recordWords: non-positive or non-finite counts are ignored', async () => {
  const root = tempWorkspace();
  try {
    const store = new WritingStatsStore(root);
    const now = new Date('2026-07-11T12:00:00.000Z');
    await store.recordWords(0, now);
    await store.recordWords(-5, now);
    await store.recordWords(NaN, now);
    const snapshot = store.getSnapshot(0, now);
    assert.equal(snapshot.wordsToday, 0);
    assert.equal(snapshot.wordsTotal, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── getSnapshot: today/week rollover ───────────────────────────────────────

test('getSnapshot: wordsThisWeek sums the trailing 7 days (rolling window) but wordsToday is just today', async () => {
  const root = tempWorkspace();
  try {
    const store = new WritingStatsStore(root);
    const day = (offset: number) => {
      const d = new Date('2026-07-11T12:00:00.000Z');
      d.setDate(d.getDate() - offset);
      return d;
    };
    await store.recordWords(100, day(0)); // today
    await store.recordWords(100, day(3)); // within week
    await store.recordWords(100, day(10)); // outside week window

    const snapshot = store.getSnapshot(0, day(0));
    assert.equal(snapshot.wordsToday, 100);
    assert.equal(snapshot.wordsThisWeek, 200);
    assert.equal(snapshot.wordsTotal, 300);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getSnapshot: a live streak (written yesterday, nothing yet today) stays current', async () => {
  const root = tempWorkspace();
  try {
    const store = new WritingStatsStore(root);
    const today = new Date('2026-07-11T12:00:00.000Z');
    const yesterday = new Date('2026-07-10T12:00:00.000Z');
    const dayBefore = new Date('2026-07-09T12:00:00.000Z');
    await store.recordWords(100, dayBefore);
    await store.recordWords(100, yesterday);

    const snapshot = store.getSnapshot(0, today);
    assert.equal(snapshot.wordsToday, 0);
    assert.equal(snapshot.currentStreakDays, 2, 'streak survives an unwritten "today" so far');
    assert.equal(snapshot.longestStreakDays, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getSnapshot: a streak with no activity in the last two days resets to zero', async () => {
  const root = tempWorkspace();
  try {
    const store = new WritingStatsStore(root);
    const today = new Date('2026-07-11T12:00:00.000Z');
    const staleDay = new Date('2026-07-01T12:00:00.000Z');
    await store.recordWords(100, staleDay);

    const snapshot = store.getSnapshot(0, today);
    assert.equal(snapshot.currentStreakDays, 0);
    assert.equal(snapshot.longestStreakDays, 1, 'longest is still recorded from history');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('getSnapshot: passes activeProjects through unchanged', async () => {
  const root = tempWorkspace();
  try {
    const store = new WritingStatsStore(root);
    const snapshot = store.getSnapshot(4, new Date('2026-07-11T12:00:00.000Z'));
    assert.equal(snapshot.activeProjects, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── HeartbeatService wiring: null-store degradation + live wiring ─────────

test('HeartbeatService: with no workspaceDir, addWords/getWritingStats never throw and stats stay null', () => {
  const hb = new HeartbeatService({}, memoryStub);
  assert.doesNotThrow(() => hb.addWords(500));
  assert.equal(hb.getWritingStats(0), null);
  // Legacy in-memory today/streak behaviour is unaffected.
  assert.equal(hb.getStats().todayWords, 500);
});

test('HeartbeatService: with a workspaceDir, addWords fires a fire-and-forget recordWords that getWritingStats eventually reflects', async () => {
  const root = tempWorkspace();
  try {
    const hb = new HeartbeatService({}, memoryStub, root);
    hb.addWords(300);
    // addWords is synchronous in-memory but persistence is fire-and-forget;
    // give the microtask/fs write a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const snapshot = hb.getWritingStats(1);
    assert.ok(snapshot, 'stats snapshot should be available once a workspaceDir is wired');
    assert.equal(snapshot!.wordsToday, 300);
    assert.equal(snapshot!.activeProjects, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
