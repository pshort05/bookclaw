import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ManuscriptHubService } from '../../gateway/src/services/manuscript-hub.js';

// ─────────────────────────────────────────────────────────────────────────────
// Characterization tests for ManuscriptHubService.build() and its deterministic
// aggregation helpers (project summary, word counts, totals, velocity buckets,
// streak, upcoming work). A stub activity log feeds getRecent(); no disk reads.
// ─────────────────────────────────────────────────────────────────────────────

const svc = new ManuscriptHubService();

function project(over: any = {}) {
  return {
    id: over.id ?? 'p1',
    title: over.title ?? 'Book One',
    type: over.type ?? 'novel-pipeline',
    status: over.status ?? 'active',
    progress: over.progress ?? 50,
    preferredProvider: over.preferredProvider,
    updatedAt: over.updatedAt,
    steps: over.steps ?? [],
  };
}

function stubLog(entries: any[]) {
  return {
    log() {},
    getRecent(_count?: number) { return entries; },
  };
}

const todayISO = new Date().toISOString().split('T')[0];

// ── summarizeProject (via build) ──────────────────────────────────────────────

test('summarizeProject: counts words only from COMPLETED writing-phase / chapter steps', async () => {
  const p = project({
    steps: [
      { id: 's1', label: 'Plan', status: 'completed', phase: 'planning', result: 'one two three' },
      { id: 's2', label: 'Chapter 1', status: 'completed', phase: 'writing', result: 'alpha beta gamma delta' }, // 4
      { id: 's3', label: 'Chapter 2', status: 'active', phase: 'writing', result: 'should not count yet' },
      { id: 's4', label: 'Chapter 3', status: 'completed', result: 'one two' }, // matched via /chapter/i label → 2
    ],
  });
  const rep = await svc.build([p], stubLog([]), 1000);
  const summary = rep.projects[0];
  // planning step's words are NOT counted; only completed writing/chapter steps.
  assert.equal(summary.totalWords, 4 + 2);
  assert.equal(summary.chaptersWritten, 2);          // s2 + s4 completed
  assert.equal(summary.chapterTarget, 3);            // s2, s3, s4 are writing/chapter steps
  assert.equal(summary.completedSteps, 3);
  assert.equal(summary.totalSteps, 4);
  assert.equal(summary.activeStepLabel, 'Chapter 2');
});

test('summarizeProject: no active step => activeStepLabel null; passes through provider + updatedAt', async () => {
  const p = project({
    status: 'completed',
    preferredProvider: 'claude',
    updatedAt: '2026-06-01T00:00:00Z',
    steps: [{ id: 's1', label: 'Done', status: 'completed' }],
  });
  const rep = await svc.build([p], stubLog([]), 1000);
  const s = rep.projects[0];
  assert.equal(s.activeStepLabel, null);
  assert.equal(s.preferredProvider, 'claude');
  assert.equal(s.lastActivityAt, '2026-06-01T00:00:00Z');
});

// ── totals ────────────────────────────────────────────────────────────────────

test('totals: aggregates projects/active/completed/words/chapters across projects', async () => {
  const a = project({
    id: 'a', status: 'active',
    steps: [{ id: '1', label: 'Chapter 1', status: 'completed', phase: 'writing', result: 'one two three' }],
  });
  const b = project({
    id: 'b', status: 'completed',
    steps: [{ id: '1', label: 'Chapter 1', status: 'completed', phase: 'writing', result: 'four five' }],
  });
  const rep = await svc.build([a, b], stubLog([]), 1000);
  assert.equal(rep.totals.projects, 2);
  assert.equal(rep.totals.active, 1);
  assert.equal(rep.totals.completed, 1);
  assert.equal(rep.totals.totalWords, 3 + 2);
  assert.equal(rep.totals.totalChaptersWritten, 2);
});

// ── upcoming ──────────────────────────────────────────────────────────────────

test('upcoming: first pending/active step of each active|paused project', async () => {
  const active = project({
    id: 'a', status: 'active',
    steps: [
      { id: '1', label: 'Done step', status: 'completed' },
      { id: '2', label: 'Next pending', status: 'pending' },
    ],
  });
  const paused = project({
    id: 'p', status: 'paused', title: 'Paused Book',
    steps: [{ id: '1', label: 'Active now', status: 'active' }],
  });
  const done = project({ id: 'd', status: 'completed', steps: [{ id: '1', label: 'x', status: 'completed' }] });
  const rep = await svc.build([active, paused, done], stubLog([]), 1000);
  assert.deepEqual(rep.upcoming, [
    { projectId: 'a', projectTitle: 'Book One', stepLabel: 'Next pending' },
    { projectId: 'p', projectTitle: 'Paused Book', stepLabel: 'Active now' },
  ]);
});

test('upcoming: active project with no pending/active step is dropped', async () => {
  const p = project({ status: 'active', steps: [{ id: '1', label: 'x', status: 'completed' }] });
  const rep = await svc.build([p], stubLog([]), 1000);
  assert.equal(rep.upcoming.length, 0);
});

// ── velocity + recent ─────────────────────────────────────────────────────────

test('recent: 14 contiguous day buckets, ascending, with file_saved/step_completed counted', async () => {
  const log = stubLog([
    { type: 'file_saved', timestamp: new Date().toISOString(), metadata: { wordCount: 800 } },
    { type: 'step_completed', timestamp: new Date().toISOString() },
    { type: 'chat_message', timestamp: new Date().toISOString(), metadata: { wordCount: 999 } }, // ignored type
  ]);
  const rep = await svc.build([], log, 1000);
  assert.equal(rep.recent.length, 14);
  // ascending by date
  const dates = rep.recent.map(d => d.date);
  assert.deepEqual([...dates].sort(), dates);
  const today = rep.recent.find(d => d.date === todayISO)!;
  assert.equal(today.wordCount, 800);      // only file_saved word count
  assert.equal(today.stepsCompleted, 1);   // bug #23: steps come from step_completed only (file_saved + chat ignored)
});

test('recent: entries older than the cutoff window are excluded', async () => {
  const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const log = stubLog([{ type: 'file_saved', timestamp: old, metadata: { wordCount: 500 } }]);
  const rep = await svc.build([], log, 1000);
  const totalWords = rep.recent.reduce((s, d) => s + d.wordCount, 0);
  assert.equal(totalWords, 0);
});

test('goal: todayWords drives pctOfDaily (capped at 100)', async () => {
  const log = stubLog([{ type: 'file_saved', timestamp: new Date().toISOString(), metadata: { wordCount: 1500 } }]);
  const rep = await svc.build([], log, 1000);
  assert.equal(rep.goal.todayWords, 1500);
  assert.equal(rep.goal.pctOfDaily, 100); // min(100, 150)
  assert.equal(rep.goal.daily, 1000);
});

test('goal: daily goal of 0 yields pctOfDaily 0 and streak 0 (no divide-by-zero)', async () => {
  const log = stubLog([{ type: 'file_saved', timestamp: new Date().toISOString(), metadata: { wordCount: 500 } }]);
  const rep = await svc.build([], log, 0);
  assert.equal(rep.goal.pctOfDaily, 0);
  assert.equal(rep.goal.streakDays, 0);
});

test('streak: counts consecutive goal-hitting days back from today; breaks at first miss', async () => {
  // Today and yesterday hit a 100-word goal; the day before is below → streak 2.
  const day = (offset: number) =>
    new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString();
  const log = stubLog([
    { type: 'file_saved', timestamp: day(0), metadata: { wordCount: 200 } },
    { type: 'file_saved', timestamp: day(1), metadata: { wordCount: 150 } },
    { type: 'file_saved', timestamp: day(2), metadata: { wordCount: 10 } }, // below goal
  ]);
  const rep = await svc.build([], log, 100);
  assert.equal(rep.goal.streakDays, 2);
});

test('streak: a below-goal today breaks the streak immediately (returns 0)', async () => {
  const day = (offset: number) =>
    new Date(Date.now() - offset * 24 * 60 * 60 * 1000).toISOString();
  const log = stubLog([
    { type: 'file_saved', timestamp: day(0), metadata: { wordCount: 10 } },  // today below goal
    { type: 'file_saved', timestamp: day(1), metadata: { wordCount: 500 } }, // yesterday hit
  ]);
  const rep = await svc.build([], log, 100);
  assert.equal(rep.goal.streakDays, 0);
});

test('build: tolerates an activity log whose getRecent returns a Promise', async () => {
  const log = {
    log() {},
    getRecent: async () => [
      { type: 'file_saved', timestamp: new Date().toISOString(), metadata: { wordCount: 42 } },
    ],
  };
  const rep = await svc.build([], log, 1000);
  assert.equal(rep.goal.todayWords, 42);
});
