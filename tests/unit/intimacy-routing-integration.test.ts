/**
 * Integration test for Flagship Plan 2 Task 7: heat_check + intimacy-branch
 * wiring at the /api/projects/:id/execute draft-step path. Drives the real
 * route (mountProjects) with a fake engine + fake AI router/books service,
 * proving the classifyScene → intimacyDecision → spiceRoute chain actually
 * changes which provider handleMessage is called with.
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
    id: 'p1', title: 'Test Romance', bookSlug: 'romance-book', context: { genre: 'romance' },
    steps: [{ id: 'p1-step-1', label: 'Write Chapter 1', status: 'active', role: 'draft', prompt: 'A love scene brief.', taskType: 'creative_writing' }],
  };
}

function makeHarness(opts: { heatScoreText: string; refuseFirst?: boolean; wordyRefusalFirst?: boolean }) {
  const project = makeProject();
  const engine = {
    getProject: () => project,
    buildProjectContext: async () => '',
    completeStep: (_pid: string, _sid: string, _resp: string) => { project.steps[0].status = 'completed'; return null; },
    failStep: () => {},
    tryStartDriving: () => true,
    stopDriving: () => {},
  };
  const calls: Array<{ provider: any; model: any; context: string }> = [];
  const prose = 'A tender, emotionally grounded scene unfolds between them. '.repeat(10);
  let handleMessageCallCount = 0;
  const gateway = {
    getProjectEngine: () => engine,
    getServices: () => ({
      books: {
        open: async (slug: string) => slug === 'romance-book'
          ? { manifest: { contentCeiling: { spice: 10, violence: 5 }, pulledFrom: { genre: { name: 'romance' } } } }
          : null,
        dataDirOf: () => null,
        activeDataDir: () => null,
      },
      // C1 regression guard: the real AIRouter.complete throws
      // `Provider ${provider} not found` when request.provider is undefined
      // (see gateway/src/ai/router.ts). Mirroring that here means a caller
      // that forgets to pass a concrete provider into classifyScene (the
      // original bug) makes the heat_check call throw — caught by
      // classifyScene's fail-soft → {spice:0,violence:0} → the intimacy
      // feature goes inert, and the assertions below (which expect the
      // scored routing to actually take effect) catch it.
      aiRouter: {
        complete: async (req: any) => {
          if (!req.provider) throw new Error(`Provider ${req.provider} not found`);
          return { text: opts.heatScoreText };
        },
        selectProvider: (_taskType: string) => ({ id: 'gemini' }),
      },
      confirmationGate: null,
      activityLog: null,
      heartbeat: { addWords() {} },
    }),
    handleMessage: async (_m: string, _c: string, cb: (t: string) => void, context: string, _tt: any, provider: any, model: any) => {
      handleMessageCallCount++;
      calls.push({ provider, model, context });
      // Simulate an on-page refusal across BOTH the primary attempt and the
      // existing general-routing retry (both stay on the on-page model), so
      // only the intimacy-branch escalation (3rd call, uncensored route) succeeds.
      if (opts.refuseFirst && handleMessageCallCount <= 2) { cb(''); return; }
      // L1: a VERBOSE refusal (not empty, not under the 50-char threshold) —
      // must also trigger the escalation via looksLikeRefusal().
      if (opts.wordyRefusalFirst && handleMessageCallCount <= 2) {
        cb("I'm not comfortable writing this scene in that level of detail. Let me know if you'd like a fade-to-black version instead, and I'm glad to help with that.");
        return;
      }
      cb(prose);
    },
  };

  return { project, engine, gateway, calls };
}

async function runExecute(gateway: any) {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-intimacy-'));
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

test('a high-spice scene (>= eroticaThreshold) re-routes the draft call to the ladder uncensored provider', async () => {
  const { gateway, calls } = makeHarness({ heatScoreText: '{"spice":8,"violence":0}' });
  const result = await runExecute(gateway);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, 'grok');
});

test('a below-threshold scene stays on the sheet draft model and gets the intimacy template', async () => {
  const { gateway, calls } = makeHarness({ heatScoreText: '{"spice":5,"violence":0}' });
  const result = await runExecute(gateway);
  assert.equal(result.status, 200);
  assert.equal(calls.length, 1);
  // romance.json's draft role model (no spice re-route at this level).
  assert.equal(calls[0].provider, 'openrouter');
  assert.equal(calls[0].model, 'anthropic/claude-opus-4.6');
  assert.match(calls[0].context, /Intimacy Framing|emotional stakes/i);
});

test('an on-page refusal (empty completion) escalates to the uncensored route on retry', async () => {
  const { gateway, calls } = makeHarness({ heatScoreText: '{"spice":5,"violence":0}', refuseFirst: true });
  const result = await runExecute(gateway);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  // First call is the on-page Claude draft model, refused (empty). Escalated
  // retry lands on the ladder's uncensored provider.
  assert.equal(calls[0].provider, 'openrouter');
  const last = calls[calls.length - 1];
  assert.equal(last.provider, 'grok');
});

// L1: a wordy refusal is neither empty nor <50 chars, so the old check
// (!response || response.length < 50) let it slip through and get saved as
// the chapter. looksLikeRefusal() must also trigger the same escalation.
test('a verbose refusal (non-empty, >=50 chars) also escalates to the uncensored route', async () => {
  const { gateway, calls } = makeHarness({ heatScoreText: '{"spice":5,"violence":0}', wordyRefusalFirst: true });
  const result = await runExecute(gateway);
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(calls[0].provider, 'openrouter');
  const last = calls[calls.length - 1];
  assert.equal(last.provider, 'grok');
});
