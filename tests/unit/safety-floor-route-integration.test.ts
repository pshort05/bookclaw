/**
 * Integration test for Flagship Plan 2 H1 fix: the safety floor
 * (bannedContentCheck + operationalDetailGuard) is non-negotiable and must
 * run on every generative draft/intimacy step regardless of whether the
 * bound book declares a contentCeiling. Previously both checks lived inside
 * `if (intimacy.active)`, which is false for any book with no contentCeiling
 * — so a book with no ceiling set (the common case) got zero safety-floor
 * coverage at all.
 *
 * Drives the real route (mountProjects) with a fake engine + AI router/books
 * service where the book has NO contentCeiling (intimacy routing stays
 * inactive) and the model's response contains a CSAM hard-block marker.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { mountProjects } from '../../gateway/src/api/routes/projects.routes.js';

function makeProject(role: string) {
  return {
    id: 'p1', title: 'Test Romance', bookSlug: 'no-ceiling-book', context: { genre: 'romance' },
    steps: [{ id: 'p1-step-1', label: 'Write Chapter 1', status: 'active', role, prompt: 'A scene brief.', taskType: 'creative_writing' }],
  };
}

function makeHarness(role: string, response: string) {
  const project = makeProject(role);
  const failed: string[] = [];
  const engine = {
    getProject: () => project,
    buildProjectContext: async () => '',
    completeStep: (_pid: string, _sid: string, _resp: string) => { project.steps[0].status = 'completed'; return null; },
    failStep: (_pid: string, _sid: string, reason: string) => { failed.push(reason); },
    tryStartDriving: () => true,
    stopDriving: () => {},
  };
  const gateway = {
    getProjectEngine: () => engine,
    getServices: () => ({
      // Book exists but declares NO contentCeiling — intimacy routing (and,
      // pre-fix, the safety floor riding on it) stays inactive.
      books: {
        open: async (slug: string) => slug === 'no-ceiling-book'
          ? { manifest: { pulledFrom: { genre: { name: 'romance' } } } }
          : null,
        dataDirOf: () => null,
        activeDataDir: () => null,
      },
      aiRouter: {
        complete: async (req: any) => { if (!req.provider) throw new Error('Provider undefined not found'); return { text: '{"spice":0,"violence":0}' }; },
        selectProvider: (_taskType: string) => ({ id: 'gemini' }),
      },
      confirmationGate: null,
      activityLog: null,
      heartbeat: { addWords() {} },
    }),
    handleMessage: async (_m: string, _c: string, cb: (t: string) => void) => { cb(response); },
  };
  return { project, gateway, failed };
}

async function runExecute(gateway: any) {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-safety-floor-'));
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
    return { status: resp.status, body: await resp.json() };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const csamText = 'This scene depicts a sexual encounter involving a minor.'.repeat(1) +
  ' '.repeat(50).replace(/ /g, 'x'); // pad without breaking proximity — well under 120 chars anyway

test('a no-ceiling book draft step still hard-blocks CSAM content via the safety floor', async () => {
  const { gateway, failed } = makeHarness('draft', csamText);
  const result = await runExecute(gateway);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, false);
  assert.match(result.body.error, /Safety floor blocked this draft/);
  assert.ok(failed.length > 0);
});

test('a non-draft/intimacy step (e.g. marketing copy) is not run through the safety floor', async () => {
  const { gateway, failed } = makeHarness('marketing', csamText);
  const result = await runExecute(gateway);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(failed.length, 0);
});
