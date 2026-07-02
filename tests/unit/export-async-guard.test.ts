/**
 * Regression test for bug L9: the beta-reader and dialogue-audit handlers await
 * gatherChapters outside any try/catch and were not wrapped in asyncHandler, so a
 * gatherChapters rejection (e.g. project.title.toLowerCase() throwing on an
 * undefined title) became an unhandled rejection and the HTTP response was never
 * sent — the client hung. asyncHandler routes the rejection to the global error
 * middleware → 500.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { mountExport } from '../../gateway/src/api/routes/export.routes.js';

// Mirror production (index.ts): swallow unhandled rejections so a not-yet-fixed
// handler's rejection doesn't tear down the test runner before we assert.
const swallow = () => {};
process.on('unhandledRejection', swallow);

test('POST /api/projects/:id/dialogue-audit responds (does not hang) when gatherChapters rejects', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-export-async-'));

  const app = express();
  app.use(express.json());
  const gateway = {
    getServices: () => ({ dialogueAuditor: {} }),
    // title: undefined → gatherChapters throws on project.title.toLowerCase()
    getProjectEngine: () => ({ getProject: () => ({ id: 'x', steps: [], title: undefined, bookSlug: null }) }),
  };
  mountExport(app as any, gateway, baseDir);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: String(err?.message || err) });
  });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(`http://127.0.0.1:${port}/api/projects/x/dialogue-audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    assert.equal(resp.status, 500, 'a gatherChapters rejection should surface as 500, not a hung request');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    process.off('unhandledRejection', swallow);
  }
});
