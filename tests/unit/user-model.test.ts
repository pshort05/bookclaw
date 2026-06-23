/**
 * Characterization tests for UserModelService (Batch D, persistent state).
 *
 * Covers the real logic: atomic persist (tmp + rename, no partial file),
 * malformed-JSON fail-soft load, deterministic metrics/persona computation,
 * the ring-buffer cap + drop-oldest, consolidation throttling/idempotence,
 * and the wipe path. `maybeConsolidate` is exercised with an injected fake
 * AI fn so no real provider is touched.
 *
 * A minimal `flush()` test seam was added to user-model.ts (cancels the 5s
 * debounce timer and awaits the private persist) — see report.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { UserModelService } from '../../gateway/src/services/user-model.js';

function freshWs(): string {
  return mkdtempSync(join(tmpdir(), 'bookclaw-um-'));
}
const modelFile = (ws: string) => join(ws, 'memory', 'user-model.json');

test('observe + flush round-trips through disk into a new instance', async () => {
  const ws = freshWs();
  try {
    const a = new UserModelService(ws);
    await a.initialize();
    a.observe({ type: 'message_sent', personaId: 'pen-a', metadata: { length: 40 } });
    a.observe({ type: 'words_written', personaId: 'pen-a', metadata: { words: 500 } });
    await a.flush();

    const b = new UserModelService(ws);
    await b.initialize();
    const m = b.computeMetrics();
    assert.equal(m.totalMessages, 1);
    assert.equal(m.totalWordsWritten, 500);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('persist is atomic: writes via tmp then rename, leaving no .tmp file', async () => {
  const ws = freshWs();
  try {
    const svc = new UserModelService(ws);
    await svc.initialize();
    svc.observe({ type: 'message_sent', personaId: null, metadata: { length: 10 } });
    await svc.flush();
    const dir = join(ws, 'memory');
    const names = readdirSync(dir);
    assert.ok(names.includes('user-model.json'));
    assert.ok(!names.some(n => n.endsWith('.tmp')), `stray tmp file: ${names}`);
    // The committed file is complete, valid JSON (not a partial write).
    const parsed = JSON.parse(readFileSync(modelFile(ws), 'utf-8'));
    assert.equal(parsed.observations.length, 1);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('malformed JSON on disk loads fail-soft (no throw, starts empty)', async () => {
  const ws = freshWs();
  try {
    mkdirSync(join(ws, 'memory'), { recursive: true });
    writeFileSync(modelFile(ws), '{ this is not json ');
    const svc = new UserModelService(ws);
    await assert.doesNotReject(() => svc.initialize());
    assert.equal(svc.getSnapshot(), null); // no observations -> null snapshot
    assert.equal(svc.computeMetrics().totalMessages, 0);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('initialize on a non-array observations field coerces to empty array', async () => {
  const ws = freshWs();
  try {
    mkdirSync(join(ws, 'memory'), { recursive: true });
    writeFileSync(modelFile(ws), JSON.stringify({ observations: 'oops', snapshot: null }));
    const svc = new UserModelService(ws);
    await svc.initialize();
    assert.equal(svc.computeMetrics().totalMessages, 0);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('computeMetrics derives sessions, completion rate, and preferred hour/day (UTC)', async () => {
  const ws = freshWs();
  try {
    const svc = new UserModelService(ws);
    await svc.initialize();
    // Two session starts both on a Monday 09:00 UTC -> preferred hour 9, Monday.
    // 2026-06-15 is a Monday.
    (svc as any).state.observations = [
      { timestamp: '2026-06-15T09:00:00.000Z', type: 'session_start', personaId: null },
      { timestamp: '2026-06-15T09:30:00.000Z', type: 'session_start', personaId: null },
      { timestamp: '2026-06-15T09:31:00.000Z', type: 'message_sent', personaId: null, metadata: { length: 20 } },
      { timestamp: '2026-06-15T09:32:00.000Z', type: 'message_sent', personaId: null, metadata: { length: 40 } },
      { timestamp: '2026-06-15T09:33:00.000Z', type: 'words_written', personaId: null, metadata: { words: 1000 } },
      { timestamp: '2026-06-15T09:34:00.000Z', type: 'project_completed', personaId: null },
      { timestamp: '2026-06-15T09:35:00.000Z', type: 'project_failed', personaId: null },
    ];
    const m = svc.computeMetrics();
    assert.equal(m.totalSessions, 2);
    assert.equal(m.totalMessages, 2);
    assert.equal(m.avgMessageLength, 30); // (20+40)/2
    assert.equal(m.totalWordsWritten, 1000);
    assert.equal(m.avgWordsPerSession, 500); // 1000 / 2 sessions
    assert.equal(m.completedProjects, 1);
    assert.equal(m.failedProjects, 1);
    assert.equal(m.completionRate, 0.5);
    assert.equal(m.preferredHourOfDay, 9);
    assert.equal(m.preferredDayOfWeek, 'Monday');
    assert.equal(m.activeDays, 1);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('ring buffer caps observations at MAX (5000), dropping oldest', async () => {
  const ws = freshWs();
  try {
    const svc = new UserModelService(ws);
    await svc.initialize();
    // Pre-seed near the cap to avoid 5001 individual observe() calls being slow.
    const seed = [];
    for (let i = 0; i < 5000; i++) {
      seed.push({ timestamp: '2026-06-15T09:00:00.000Z', type: 'message_sent', personaId: null, metadata: { tag: i } });
    }
    (svc as any).state.observations = seed;
    // One more push tips it over the cap.
    svc.observe({ type: 'message_sent', personaId: null, metadata: { tag: 'newest' } });
    const obs = (svc as any).state.observations;
    assert.equal(obs.length, 5000);
    assert.equal(obs[obs.length - 1].metadata.tag, 'newest'); // newest kept
    assert.equal(obs[0].metadata.tag, 1); // oldest (tag 0) dropped
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('getSnapshot returns a metrics-only synthetic snapshot when no narrative exists', async () => {
  const ws = freshWs();
  try {
    const svc = new UserModelService(ws);
    await svc.initialize();
    svc.observe({ type: 'message_sent', personaId: 'pen-a', metadata: { length: 12 } });
    const snap = svc.getSnapshot();
    assert.ok(snap);
    assert.equal(snap!.narrative.confidence, 0);
    assert.ok(snap!.narrative.text.startsWith('(narrative not yet'));
    assert.equal(snap!.observationCount, 1);
    assert.ok('pen-a' in snap!.personas);
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('maybeConsolidate is throttled below both thresholds (recent consolidation, few turns)', async () => {
  const ws = freshWs();
  try {
    const svc = new UserModelService(ws);
    await svc.initialize();
    let calls = 0;
    svc.setAI(async () => { calls++; return { text: 'narrative' }; }, () => ({ id: 'fake' }));
    // A fresh model (lastConsolidationAt=null) treats sinceMs as huge -> day
    // threshold ALWAYS met, so the very first consolidation runs unthrottled.
    // To exercise the throttle we set a recent consolidation time + low turn count.
    (svc as any).state.lastConsolidationAt = new Date().toISOString();
    svc.observe({ type: 'message_sent', personaId: null, metadata: { length: 5 } });
    const result = await svc.maybeConsolidate(); // 1 turn < 20, < 24h since last
    assert.equal(calls, 0); // AI not invoked
    assert.equal(result, null); // no prior snapshot to return
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('a fresh model (no prior consolidation) consolidates on first call — day threshold met', async () => {
  const ws = freshWs();
  try {
    const svc = new UserModelService(ws);
    await svc.initialize();
    let calls = 0;
    svc.setAI(async () => { calls++; return { text: 'first narrative' }; }, () => ({ id: 'fake' }));
    svc.observe({ type: 'message_sent', personaId: null, metadata: { length: 5 } });
    const result = await svc.maybeConsolidate(); // not forced, but lastConsolidationAt=null
    assert.equal(calls, 1);
    assert.equal(result!.narrative.text, 'first narrative');
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('maybeConsolidate(force) calls AI, writes narrative, and is idempotent on the metrics', async () => {
  const ws = freshWs();
  try {
    const svc = new UserModelService(ws);
    await svc.initialize();
    let calls = 0;
    svc.setAI(async () => { calls++; return { text: `narrative ${calls}` }; }, () => ({ id: 'fake' }));
    for (let i = 0; i < 3; i++) svc.observe({ type: 'message_sent', personaId: null, metadata: { length: 10 } });

    const first = await svc.maybeConsolidate(true);
    assert.equal(calls, 1);
    assert.equal(first!.narrative.text, 'narrative 1');
    assert.equal(first!.narrative.consolidationCount, 1);
    assert.equal(first!.metrics.totalMessages, 3);
    assert.equal((svc as any).state.observationsSinceConsolidation, 0); // counter reset

    // Forcing again with no new observations: metrics unchanged, count increments,
    // prior narrative is preserved as input (not lost).
    const second = await svc.maybeConsolidate(true);
    assert.equal(calls, 2);
    assert.equal(second!.narrative.consolidationCount, 2);
    assert.equal(second!.metrics.totalMessages, 3); // observations not collapsed/lost
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('maybeConsolidate keeps the prior snapshot when AI throws (fail-soft)', async () => {
  const ws = freshWs();
  try {
    const svc = new UserModelService(ws);
    await svc.initialize();
    let mode: 'ok' | 'throw' = 'ok';
    svc.setAI(async () => { if (mode === 'throw') throw new Error('boom'); return { text: 'good' }; }, () => ({ id: 'fake' }));
    svc.observe({ type: 'message_sent', personaId: null, metadata: { length: 5 } });
    const good = await svc.maybeConsolidate(true);
    assert.equal(good!.narrative.text, 'good');

    mode = 'throw';
    const after = await svc.maybeConsolidate(true);
    assert.equal(after!.narrative.text, 'good'); // prior snapshot retained, not clobbered
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test('reset wipes state and persists an empty model to disk', async () => {
  const ws = freshWs();
  try {
    const a = new UserModelService(ws);
    await a.initialize();
    a.observe({ type: 'message_sent', personaId: null, metadata: { length: 9 } });
    await a.flush();
    assert.equal(a.computeMetrics().totalMessages, 1);

    await a.reset();
    assert.equal(a.computeMetrics().totalMessages, 0);
    assert.ok(existsSync(modelFile(ws))); // reset persists, doesn't delete

    const b = new UserModelService(ws);
    await b.initialize();
    assert.equal(b.computeMetrics().totalMessages, 0); // wipe survived the reload
  } finally { rmSync(ws, { recursive: true, force: true }); }
});
