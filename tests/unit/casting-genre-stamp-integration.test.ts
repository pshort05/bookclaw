/**
 * Integration test for H1: stepRouting resolves genre as
 * `project?.genre ?? project?.context?.genre`, but nothing ever populates
 * `context.genre` on the real /execute route — so `loadCastingSheet(undefined)`
 * returns null and every tagged step runs on tier-default, making the entire
 * per-role casting layer inert. This drives the REAL /execute route with a
 * fake books service whose open(slug) returns a manifest carrying
 * pulledFrom.genre.name, and deliberately does NOT hand-set
 * project.context.genre — that omission is exactly the condition production
 * never satisfies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { mountProjects } from '../../gateway/src/api/routes/projects.routes.js';

function makeProject() {
  return {
    // No top-level `genre` and no `context.genre` — production never stamps
    // either at project-create; only `bookSlug` + the book's manifest carry
    // the genre.
    id: 'p1', title: 'Test SF Novel', bookSlug: 'sf-book', context: {},
    steps: [{ id: 'p1-step-1', label: 'Write Chapter 1', status: 'active', role: 'draft', prompt: 'A first-contact scene brief.', taskType: 'creative_writing' }],
  };
}

function makeHarness() {
  const project = makeProject();
  const engine = {
    getProject: () => project,
    buildProjectContext: async () => '',
    completeStep: (_pid: string, _sid: string, _resp: string) => { project.steps[0].status = 'completed'; return null; },
    failStep: () => {},
    tryStartDriving: () => true,
    isDriving: () => false,
    stopDriving: () => {},
  };
  const calls: Array<{ provider: any; model: any }> = [];
  const prose = 'The airlock hissed open onto a world that should not exist. '.repeat(10);
  const gateway = {
    getProjectEngine: () => engine,
    getServices: () => ({
      books: {
        // No contentCeiling → intimacy routing stays inactive; the manifest's
        // pulledFrom.genre.name is the ONLY genre signal available.
        open: async (slug: string) => slug === 'sf-book'
          ? { manifest: { pulledFrom: { genre: { name: 'science-fiction' } } } }
          : null,
        dataDirOf: () => null,
        activeDataDir: () => null,
      },
      aiRouter: {
        complete: async () => { throw new Error('classifyScene should not be called: no contentCeiling set'); },
        selectProvider: (_taskType: string) => ({ id: 'gemini' }),
      },
      confirmationGate: null,
      activityLog: null,
      heartbeat: { addWords() {} },
    }),
    handleMessage: async (_m: string, _c: string, cb: (t: string) => void, _context: string, _tt: any, provider: any, model: any) => {
      calls.push({ provider, model });
      cb(prose);
    },
  };

  return { project, gateway, calls };
}

async function runExecute(gateway: any) {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-genre-stamp-'));
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

// library/casting/science-fiction.json's draft role model — the expected
// route ONLY if the per-role casting sheet actually loads.
test('a tagged draft step on a bound book routes to the genre casting sheet, not the tier default (H1)', async () => {
  const { project, gateway, calls } = makeHarness();
  assert.equal(project.context.genre, undefined, 'test setup must not hand-set context.genre');
  const result = await runExecute(gateway);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'openrouter');
  assert.equal(calls[0].model, 'anthropic/claude-opus-4-7');
});
