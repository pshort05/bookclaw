/**
 * Integration test for Flagship Plan 6, Task 4: DriveScheduler wired into a
 * REAL drive entry point (projects.routes.ts /auto-execute + /execute via
 * mountProjects, the same real Express route real production code runs).
 *
 * This is deliberately NOT a unit test of DriveScheduler in isolation
 * (that's scheduler.test.ts) — it proves the scheduler is actually consulted
 * by the route: with maxConcurrent=3, a 4th book's /auto-execute call gets a
 * non-blocking 429 (M2 fix — an HTTP handler must not hold the connection
 * open behind another book's full drive) while 3 others are mid-drive, and
 * retrying after a release succeeds. A fake-but-realistic generation stub
 * (matching the style of the existing drive-lock.test.ts) drives the real
 * route body end-to-end — not a synthetic fixture that bypasses the
 * scheduler wiring.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { DriveScheduler } from '../../gateway/src/services/pipeline/scheduler.js';
import { mountProjects } from '../../gateway/src/api/routes/projects.routes.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

function makeProject(id: string, bookSlug: string) {
  return {
    id, title: `Test ${id}`, bookSlug, context: {},
    status: 'active',
    steps: [{ id: `${id}-step-1`, label: 'Write Chapter 1', status: 'active', prompt: 'x', taskType: 'creative_writing' }],
  };
}

test('a 4th book gets a non-blocking 429 at maxConcurrent=3 through the REAL /auto-execute route, and a retry succeeds after a release', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'sched-wiring-'));
  const projects: Record<string, any> = {
    p1: makeProject('p1', 'book-1'),
    p2: makeProject('p2', 'book-2'),
    p3: makeProject('p3', 'book-3'),
    p4: makeProject('p4', 'book-4'),
  };

  const engine: any = new ProjectEngine(undefined, baseDir);
  engine.getProject = (id: string) => projects[id];
  engine.buildProjectContext = async () => '';
  engine.completeStep = (projectId: string, stepId: string) => {
    const step = projects[projectId]?.steps.find((s: any) => s.id === stepId);
    if (step) step.status = 'completed';
    return null;
  };
  engine.failStep = () => {};

  const scheduler = new DriveScheduler(engine, 3);

  // book-1/2/3 block mid-generation (simulating a real in-progress drive);
  // book-4 has no gate and resolves immediately.
  const gates: Record<string, ReturnType<typeof deferred>> = {
    'book-1': deferred(), 'book-2': deferred(), 'book-3': deferred(),
  };
  const handleMessageCalls: string[] = [];
  const gateway: any = {
    getProjectEngine: () => engine,
    getServices: () => ({
      books: null, confirmationGate: null, activityLog: null,
      driveScheduler: scheduler,
      heartbeat: { addWords() {} },
    }),
    handleMessage: async (_m: string, _c: string, cb: (t: string) => void, _ctx: string, _tt: unknown, _p: unknown, _mo: unknown, bookSlug: string) => {
      handleMessageCalls.push(bookSlug);
      const gate = gates[bookSlug];
      if (gate) await gate.promise;
      cb('prose '.repeat(50));
    },
  };

  const app = express();
  app.use(express.json());
  mountProjects(app as any, gateway, baseDir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  const post = (id: string) => fetch(`${url}/api/projects/${id}/auto-execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });

  try {
    const f1 = post('p1');
    const f2 = post('p2');
    const f3 = post('p3');

    // Let all three reach their blocked generation call and acquire their slots.
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(scheduler.running().sort(), ['p1', 'p2', 'p3'], 'all three claimed a drive slot via the scheduler');
    assert.deepEqual([...handleMessageCalls].sort(), ['book-1', 'book-2', 'book-3']);

    // 4th book: capacity is full — the request must get a non-blocking 429
    // immediately (M2 fix), not hang, and not proceed (this project has no
    // lock conflict of its own; only the GLOBAL cap should block it — proving
    // the scheduler, not just the pre-existing same-project drive lock, is
    // what's gating here). Nothing gets queued on p4's behalf.
    const r4a = await post('p4');
    assert.equal(r4a.status, 429, 'the 4th book gets 429 at capacity, not a hung connection');
    const body4a = await r4a.json();
    assert.equal(body4a.queued, true);
    assert.deepEqual(scheduler.queued(), [], 'tryAcquireNow never queues');
    assert.equal(handleMessageCalls.includes('book-4'), false, 'book-4 has not started generating');

    // Finish book-1's chapter -> its /auto-execute loop completes the step,
    // finds nothing else active, and releases its slot -> a slot is free.
    gates['book-1'].resolve();
    const r1 = await f1;
    assert.equal(r1.status, 200);
    assert.equal(projects.p1.steps[0].status, 'completed');

    // Retry p4 now that a slot is free — the retry succeeds (the studio
    // PipelineRail poll / caller retry is what re-kicks a 429'd book).
    const r4 = await post('p4');
    assert.equal(r4.status, 200);
    assert.equal(projects.p4.steps[0].status, 'completed', 'the retried book actually ran once a slot freed');
    assert.equal(handleMessageCalls.includes('book-4'), true);

    // Clean up the still-blocked p2/p3 so the process can exit.
    gates['book-2'].resolve();
    gates['book-3'].resolve();
    await Promise.all([f2, f3]);
    assert.deepEqual(scheduler.running(), []);
    assert.deepEqual(scheduler.queued(), []);
  } finally {
    // Resolve every gate unconditionally (in case an assertion above threw
    // before the normal resolve calls ran) so no pending request keeps a
    // keep-alive socket open — otherwise server.close() would hang forever
    // waiting for connections that can never finish.
    for (const g of Object.values(gates)) g.resolve();
    (server as any).closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('same-project reentrancy still 409s through the scheduler-wired route (no regression vs. the raw drive lock)', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'sched-wiring-reentrancy-'));
  const project: any = makeProject('p1', 'book-1');
  const engine: any = new ProjectEngine(undefined, baseDir);
  engine.getProject = () => project;
  engine.buildProjectContext = async () => '';
  engine.completeStep = () => null;
  engine.failStep = () => {};

  const scheduler = new DriveScheduler(engine, 3);
  const gateway: any = {
    getProjectEngine: () => engine,
    getServices: () => ({ books: null, confirmationGate: null, activityLog: null, driveScheduler: scheduler, heartbeat: { addWords() {} } }),
    handleMessage: async (_m: string, _c: string, cb: (t: string) => void) => cb('prose '.repeat(50)),
  };
  const app = express();
  app.use(express.json());
  mountProjects(app as any, gateway, baseDir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  try {
    // Pre-occupy this specific project's lock directly (simulating another runner).
    assert.equal(await scheduler.acquire('p1'), true);

    const exec = await fetch(`${url}/api/projects/p1/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(exec.status, 409, '/execute must still 409 while the same project is already driven');

    const auto = await fetch(`${url}/api/projects/p1/auto-execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(auto.status, 409, '/auto-execute must still 409 while the same project is already driven');
  } finally {
    (server as any).closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ── M1: a throw in the window right after acquiring the drive slot must not leak it ──
//
// The route body has no catch around the post-acquire statements (only a
// finally further down) — a throw there rejects the handler's own promise,
// which Express 4 silently discards (it never awaits/attaches a .catch to an
// async handler's return value; see Layer.prototype.handle_request). Going
// through a real HTTP round-trip would surface that as a process-level
// unhandledRejection unrelated to what M1 fixes. So this test captures the
// REAL registered handler function (the same one Express calls) and invokes
// it directly with a fake req/res, letting the test await + catch its
// rejection itself — proving the finally still runs (slot released) despite
// the throw, without touching the unrelated missing-catch behavior.

test('a throw right after acquiring the slot in /auto-execute still releases it (M1 fix)', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'sched-wiring-m1-'));
  const project: any = {
    id: 'p1', title: 'Test p1', bookSlug: 'book-1', context: {},
    status: 'pending', // routes engine.startProject(), which we make throw below
    steps: [{ id: 'p1-step-1', label: 'Write Chapter 1', status: 'pending', prompt: 'x', taskType: 'creative_writing' }],
  };
  const engine: any = new ProjectEngine(undefined, baseDir);
  engine.getProject = () => project;
  engine.startProject = () => { throw new Error('boom — simulated failure right after acquiring the slot'); };

  const scheduler = new DriveScheduler(engine, 1); // cap 1 so a leaked slot would be immediately observable
  const gateway: any = {
    getProjectEngine: () => engine,
    getServices: () => ({ books: null, confirmationGate: null, activityLog: null, driveScheduler: scheduler, heartbeat: { addWords() {} } }),
    handleMessage: async (_m: string, _c: string, cb: (t: string) => void) => cb('prose '.repeat(50)),
  };

  const routeHandlers: Record<string, (req: any, res: any) => Promise<unknown>> = {};
  const app: any = express();
  const originalPost = app.post.bind(app);
  app.post = (path: string, handler: (req: any, res: any) => Promise<unknown>) => {
    routeHandlers[path] = handler;
    return originalPost(path, handler);
  };
  mountProjects(app, gateway, baseDir);

  const autoExecute = routeHandlers['/api/projects/:id/auto-execute'];
  assert.ok(autoExecute, 'auto-execute handler was registered');

  const req: any = { params: { id: 'p1' }, body: {} };
  const res: any = { status() { return res; }, json() { return res; } };

  await assert.rejects(() => autoExecute(req, res), /boom/, 'the handler propagates the throw (pre-existing — not what M1 fixes)');

  assert.deepEqual(scheduler.running(), [], 'the slot must be released even though the handler threw before its try-body finished');
  assert.equal(scheduler.tryAcquireNow('p1'), true, 'a fresh acquire for the same project now succeeds — the drive lock was released too');
  scheduler.release('p1');
});
