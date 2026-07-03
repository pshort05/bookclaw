/**
 * Regression test for bug-review finding #7: POST /api/projects/:id/execute
 * completed a step without ever writing its `${id}-<label>.md` output file, so a
 * chapter run individually via the "Execute" button silently vanished from the
 * disk-based manuscript assembly. This drives the real route with a fake engine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { mountProjects } from '../../gateway/src/api/routes/projects.routes.js';

test('execute writes the step output file so it lands in the assembled manuscript', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-exec-'));
  const project: any = {
    id: 'p1', title: 'Test Book', bookSlug: null, context: {},
    steps: [{ id: 'p1-step-1', label: 'Write Chapter 1', status: 'active', prompt: 'Write chapter 1', taskType: 'creative_writing' }],
  };
  const engine = {
    getProject: () => project,
    buildProjectContext: async () => '',
    completeStep: (_pid: string, _sid: string, _resp: string) => { project.steps[0].status = 'completed'; return null; },
    failStep: () => {},
    tryStartDriving: () => true,
    isDriving: () => false,
    stopDriving: () => {},
  };
  const prose = 'This is a full chapter of genuine prose. '.repeat(20);
  const gateway = {
    getProjectEngine: () => engine,
    getServices: () => ({ books: null, confirmationGate: null, activityLog: null, heartbeat: { addWords() {} } }),
    handleMessage: async (_m: string, _c: string, cb: (t: string) => void) => { cb(prose); },
  };

  const app = express();
  app.use(express.json());
  mountProjects(app as any, gateway, baseDir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;

  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/projects/p1/execute`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.equal(resp.status, 200);
    const body = await resp.json();
    assert.equal(body.success, true);

    const expected = join(baseDir, 'workspace', 'projects', 'test-book', 'p1-step-1-write-chapter-1.md');
    assert.ok(existsSync(expected), `step output file must be written to ${expected}`);
    assert.match(readFileSync(expected, 'utf-8'), /# Write Chapter 1/);
    assert.match(readFileSync(expected, 'utf-8'), /genuine prose/);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
