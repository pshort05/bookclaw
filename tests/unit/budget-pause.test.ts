/**
 * Integration tests for the graceful cost-boundary pause (Flagship Plan 6,
 * Task 3), driven through the REAL /auto-execute and /execute routes
 * (mountProjects) with a real ProjectEngine + real CostTracker — not a unit
 * test of checkBudgetPause() in isolation. Pins that a budget trip actually
 * stops the real drive loop BEFORE it generates the next step (no AI call),
 * marks the project paused with a budgetPause reason, and that resuming
 * clears it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { CostTracker } from '../../gateway/src/services/costs.js';
import { mountProjects } from '../../gateway/src/api/routes/projects.routes.js';

function makeProject(overrides: Partial<any> = {}) {
  return {
    id: 'p1', title: 'Test', bookSlug: 'book-a', context: {},
    status: 'active',
    steps: [{ id: 'p1-step-1', label: 'Write Chapter 1', status: 'active', prompt: 'x', taskType: 'creative_writing' }],
    ...overrides,
  };
}

function makeHarness(project: any, costs: CostTracker) {
  const baseDir = mkdtempSync(join(tmpdir(), 'budgetpause-route-'));
  const engine: any = new ProjectEngine(undefined, baseDir);
  engine.getProject = () => project;
  engine.buildProjectContext = async () => '';
  // Mirror real completeStep's effect on the step's status (not a no-op) so the
  // route's while(true) loop actually terminates after the one step — a no-op
  // stub would leave the step 'active' forever and hang the loop.
  engine.completeStep = (_projectId: string, stepId: string) => {
    const step = project.steps.find((s: any) => s.id === stepId);
    if (step) step.status = 'completed';
    return null;
  };
  engine.failStep = () => {};

  const calls = { handleMessage: 0 };
  const gateway: any = {
    getProjectEngine: () => engine,
    getServices: () => ({ books: null, confirmationGate: null, activityLog: null, costs, heartbeat: { addWords() {} } }),
    // Real generation is never reached when the budget gate fires first — this
    // stub proves that by counting how many times it was invoked.
    handleMessage: async (_m: string, _c: string, cb: (t: string) => void) => {
      calls.handleMessage++;
      cb('prose '.repeat(50));
    },
  };
  const app = express();
  app.use(express.json());
  mountProjects(app as any, gateway, baseDir);
  const server = app.listen(0);
  return { server, engine, calls };
}

async function listening(server: import('http').Server): Promise<string> {
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  return `http://127.0.0.1:${port}`;
}

test('/auto-execute pauses at the chapter boundary once the book budget is reached — never calls generation', async () => {
  const costs = new CostTracker({});
  costs.setBookBudget('book-a', 1);
  costs.record('claude', 0, 1, 'book-a'); // already at the $1 cap before this request

  const project = makeProject();
  const { server, calls } = makeHarness(project, costs);
  const url = await listening(server);

  try {
    const res = await fetch(`${url}/api/projects/p1/auto-execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.budgetPause, true, 'response signals the graceful pause');
    assert.equal(calls.handleMessage, 0, 'no generation was attempted — the pause fired BEFORE the chapter started');
    assert.equal(project.status, 'paused');
    assert.equal(project.budgetPause?.scope, 'book');
    assert.equal(project.steps[0].status, 'active', 'the un-started step is untouched, not failed or completed');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/auto-execute pauses gracefully when the GLOBAL daily cap is already tripped (no per-book budget set)', async () => {
  const costs = new CostTracker({ dailyLimit: 5 });
  costs.record('claude', 0, 10, 'book-b'); // over the $5 daily cap

  const project = makeProject({ id: 'p2', bookSlug: 'book-b' });
  const { server, calls } = makeHarness(project, costs);
  const url = await listening(server);

  try {
    const res = await fetch(`${url}/api/projects/p2/auto-execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.budgetPause, true);
    assert.equal(calls.handleMessage, 0);
    assert.equal(project.budgetPause?.scope, 'global');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/execute (single-step) also gates on the budget boundary, not just /auto-execute', async () => {
  const costs = new CostTracker({});
  costs.setBookBudget('book-a', 1);
  costs.record('claude', 0, 1, 'book-a');

  const project = makeProject();
  const { server, calls } = makeHarness(project, costs);
  const url = await listening(server);

  try {
    const res = await fetch(`${url}/api/projects/p1/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.budgetPause, true);
    assert.equal(calls.handleMessage, 0);
    assert.equal(project.status, 'paused');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('resuming a budget-paused project via /auto-execute clears budgetPause and drives forward', async () => {
  const costs = new CostTracker({});
  costs.setBookBudget('book-a', 1);
  costs.record('claude', 0, 1, 'book-a');

  const project = makeProject();
  const { server, calls } = makeHarness(project, costs);
  const url = await listening(server);

  try {
    // First call trips the pause.
    await fetch(`${url}/api/projects/p1/auto-execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(project.status, 'paused');
    assert.ok(project.budgetPause);

    // Raise the budget (simulating a Settings change) and resume.
    costs.setBookBudget('book-a', 100);
    const res = await fetch(`${url}/api/projects/p1/auto-execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.budgetPause, undefined, 'no longer paused once the cap is raised');
    assert.equal(project.budgetPause, undefined, 'resuming cleared the stale pause marker');
    assert.equal(calls.handleMessage, 1, 'generation actually ran once resumed');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
