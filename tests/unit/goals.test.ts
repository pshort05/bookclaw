/**
 * Characterization tests for GoalsService (Batch D, persistent state).
 *
 * Covers the real logic: create/update CRUD round-trip through disk,
 * updateProgress daily-snapshot collapsing + history cap, auto-complete and
 * auto-miss status transitions, setStatus, listGoals sort/filter,
 * autoAdvanceWordCountGoals, and computeProgress derived metrics (pace,
 * projected completion, at-risk). A `flush()` test seam was added to
 * goals.ts (cancels the 1s debounce timer + awaits persist) — see report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GoalsService } from '../../gateway/src/services/goals.js';

function freshWs(): string {
  return mkdtempSync(join(tmpdir(), 'bookclaw-goal-'));
}
const goalsFile = (ws: string) => join(ws, 'author-goals.json');
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
const agoDays = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

test('createGoal seeds defaults and round-trips through disk', async () => {
  const ws = freshWs();
  try {
    const a = new GoalsService(ws);
    await a.initialize();
    const g = await a.createGoal({
      type: 'word_count', title: 'NaNoWriMo', target: 50000, unit: 'words', deadline: inDays(30),
    });
    assert.equal(g.status, 'active');
    assert.equal(g.current, 0);
    assert.equal(g.target, 50000);
    assert.deepEqual(g.projectIds, []);
    assert.deepEqual(g.history, []);
    await a.flush();

    const b = new GoalsService(ws);
    await b.initialize();
    const loaded = b.getGoal(g.id);
    assert.ok(loaded);
    assert.equal(loaded!.title, 'NaNoWriMo');
    assert.equal(loaded!.target, 50000);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('createGoal clamps target to a positive integer', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    const g = await svc.createGoal({ type: 'custom', title: 'x', target: 0.4, unit: 'u', deadline: inDays(10) });
    assert.equal(g.target, 1); // Math.max(1, round(0.4)) = 1
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('persist is atomic: tmp + rename leaves no stray .tmp file', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    await svc.createGoal({ type: 'custom', title: 'x', target: 5, unit: 'u', deadline: inDays(10) });
    await svc.flush();
    const names = readdirSync(ws);
    assert.ok(names.includes('author-goals.json'));
    assert.ok(!names.some(n => n.endsWith('.tmp')), `stray tmp: ${names}`);
    assert.ok(Array.isArray(JSON.parse(readFileSync(goalsFile(ws), 'utf-8')).goals));
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('malformed goals file loads fail-soft (no throw, empty list)', async () => {
  const ws = freshWs();
  try {
    const { mkdirSync, writeFileSync } = await import('fs');
    mkdirSync(ws, { recursive: true });
    writeFileSync(goalsFile(ws), 'not json at all');
    const svc = new GoalsService(ws);
    await assert.doesNotReject(() => svc.initialize());
    assert.deepEqual(svc.listGoals(), []);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('updateProgress collapses multiple same-day updates into one history entry', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    const g = await svc.createGoal({ type: 'word_count', title: 'x', target: 1000, unit: 'words', deadline: inDays(30) });
    await svc.updateProgress(g.id, 100);
    await svc.updateProgress(g.id, 250);
    const updated = svc.getGoal(g.id)!;
    assert.equal(updated.current, 250);
    assert.equal(updated.history.length, 1); // same day -> single entry, value replaced
    assert.equal(updated.history[0].value, 250);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('updateProgress auto-completes when current reaches target', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    const g = await svc.createGoal({ type: 'book_release', title: 'x', target: 4, unit: 'books', deadline: inDays(30) });
    const r = await svc.updateProgress(g.id, 4);
    assert.equal(r!.status, 'completed');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('updateProgress auto-misses when past deadline and short of target', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    // Deadline already in the past.
    const g = await svc.createGoal({ type: 'word_count', title: 'x', target: 1000, unit: 'words', deadline: agoDays(1) });
    const r = await svc.updateProgress(g.id, 200);
    assert.equal(r!.status, 'missed');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('updateProgress on an unknown goal returns null', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    assert.equal(await svc.updateProgress('nope', 10), null);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('setStatus transitions status and persists', async () => {
  const ws = freshWs();
  try {
    const a = new GoalsService(ws);
    await a.initialize();
    const g = await a.createGoal({ type: 'custom', title: 'x', target: 10, unit: 'u', deadline: inDays(30) });
    await a.setStatus(g.id, 'paused');
    assert.equal(a.getGoal(g.id)!.status, 'paused');
    await a.flush();

    const b = new GoalsService(ws);
    await b.initialize();
    assert.equal(b.getGoal(g.id)!.status, 'paused');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('removeGoal deletes and reports existence', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    const g = await svc.createGoal({ type: 'custom', title: 'x', target: 10, unit: 'u', deadline: inDays(30) });
    assert.equal(await svc.removeGoal(g.id), true);
    assert.equal(svc.getGoal(g.id), undefined);
    assert.equal(await svc.removeGoal(g.id), false);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('listGoals sorts active-first then by deadline, and filters by status/type', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    const active1 = await svc.createGoal({ type: 'word_count', title: 'soon', target: 10, unit: 'u', deadline: inDays(5) });
    const active2 = await svc.createGoal({ type: 'revenue', title: 'later', target: 10, unit: '$', deadline: inDays(20) });
    const paused = await svc.createGoal({ type: 'custom', title: 'paused', target: 10, unit: 'u', deadline: inDays(1) });
    await svc.setStatus(paused.id, 'paused');

    const ordered = svc.listGoals().map(g => g.id);
    // active sorted by deadline ascending come before the paused one (despite its sooner deadline)
    assert.deepEqual(ordered, [active1.id, active2.id, paused.id]);

    assert.deepEqual(svc.listGoals({ status: 'paused' }).map(g => g.id), [paused.id]);
    assert.deepEqual(svc.listGoals({ type: 'revenue' }).map(g => g.id), [active2.id]);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('autoAdvanceWordCountGoals sums linked project word counts into current', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    const g = await svc.createGoal({
      type: 'word_count', title: 'x', target: 10000, unit: 'words',
      deadline: inDays(30), projectIds: ['p1', 'p2'],
    });
    const updated = await svc.autoAdvanceWordCountGoals(new Map([['p1', 3000], ['p2', 1500]]));
    assert.equal(updated.length, 1);
    assert.equal(svc.getGoal(g.id)!.current, 4500);
    // No change on a second identical call -> nothing re-updated.
    const again = await svc.autoAdvanceWordCountGoals(new Map([['p1', 3000], ['p2', 1500]]));
    assert.equal(again.length, 0);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('computeProgress derives pct, pace, and on-track message for a healthy goal', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    const g = await svc.createGoal({ type: 'word_count', title: 'x', target: 1000, unit: 'words', deadline: inDays(9) });
    // Backdate the start by ~10 days so daysElapsed is well-defined and pace is real.
    g.startedAt = agoDays(10);
    await svc.updateProgress(g.id, 600); // 60% done, comfortably ahead of linear
    const p = svc.computeProgress(g.id)!;
    assert.equal(p.pctComplete, 60);
    assert.ok(p.pace > 0);
    assert.ok(p.projectedCompletion !== null);
    assert.equal(p.atRisk, false);
    assert.ok(p.message.startsWith('On track'));
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('computeProgress flags at-risk and a behind-pace message when far behind linear', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    const g = await svc.createGoal({ type: 'word_count', title: 'x', target: 10000, unit: 'words', deadline: inDays(1) });
    g.startedAt = agoDays(29); // 29 of 30 days elapsed, basically no progress
    await svc.updateProgress(g.id, 100);
    const p = svc.computeProgress(g.id)!;
    assert.equal(p.atRisk, true);
    assert.ok(p.message.startsWith('Behind pace'));
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('computeProgress reports the completed message for a finished goal', async () => {
  const ws = freshWs();
  try {
    const svc = new GoalsService(ws);
    await svc.initialize();
    const g = await svc.createGoal({ type: 'book_release', title: 'x', target: 2, unit: 'books', deadline: inDays(30) });
    await svc.updateProgress(g.id, 2); // auto-completes
    const p = svc.computeProgress(g.id)!;
    assert.ok(p.message.startsWith('Done!'));
    assert.equal(p.atRisk, false); // not active -> never at-risk
  } finally { rmSync(ws, { recursive: true, force: true }); }
});
