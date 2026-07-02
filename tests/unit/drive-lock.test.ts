/**
 * Tests for the shared per-project drive lock (bug-review #2/#5/#8): only one
 * runner may drive a project at a time. Covers the ProjectEngine primitives and
 * the /execute + /auto-execute route 409 behavior when the lock is held.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { mountProjects } from '../../gateway/src/api/routes/projects.routes.js';

test('ProjectEngine drive lock is exclusive per project', () => {
  const engine = new ProjectEngine(undefined, mkdtempSync(join(tmpdir(), 'drivelock-')));
  assert.equal(engine.isDriving('p1'), false);
  assert.equal(engine.tryStartDriving('p1'), true, 'first claim succeeds');
  assert.equal(engine.isDriving('p1'), true);
  assert.equal(engine.tryStartDriving('p1'), false, 'second claim fails while held');
  // A different project is independent.
  assert.equal(engine.tryStartDriving('p2'), true);
  engine.stopDriving('p1');
  assert.equal(engine.isDriving('p1'), false);
  assert.equal(engine.tryStartDriving('p1'), true, 'claim succeeds again after release');
});

test('/auto-execute and /execute return 409 while the project is already being driven', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'drivelock-route-'));
  const project: any = {
    id: 'p1', title: 'Test', bookSlug: null, context: {},
    steps: [{ id: 'p1-step-1', label: 'Write', status: 'active', prompt: 'x', taskType: 'creative_writing' }],
  };
  // Real engine to exercise the actual lock; stub only the generation surface.
  const engine: any = new ProjectEngine(undefined, baseDir);
  engine.getProject = () => project;
  engine.buildProjectContext = async () => '';
  engine.completeStep = () => null;
  engine.failStep = () => {};

  const gateway = {
    getProjectEngine: () => engine,
    getServices: () => ({ books: null, confirmationGate: null, activityLog: null, heartbeat: { addWords() {} } }),
    handleMessage: async (_m: string, _c: string, cb: (t: string) => void) => { cb('prose '.repeat(50)); },
  };
  const app = express();
  app.use(express.json());
  mountProjects(app as any, gateway, baseDir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  try {
    // Simulate another runner holding the lock.
    assert.equal(engine.tryStartDriving('p1'), true);

    const exec = await fetch(`${url}/api/projects/p1/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(exec.status, 409, '/execute must 409 while the lock is held');

    const auto = await fetch(`${url}/api/projects/p1/auto-execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(auto.status, 409, '/auto-execute must 409 while the lock is held');

    // Release; now /execute succeeds.
    engine.stopDriving('p1');
    const ok = await fetch(`${url}/api/projects/p1/execute`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(ok.status, 200, '/execute succeeds once the lock is free');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
