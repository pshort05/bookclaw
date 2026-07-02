/**
 * Regression test for bug-review finding #20: the mutating document handlers
 * (upload / delete / project-upload) had no try/catch and were not wrapped in
 * asyncHandler, so an FS-level rejection (EACCES / EISDIR / ENOSPC) became an
 * unhandled rejection and the HTTP response was never sent — the client hung.
 *
 * We drive the DELETE handler against a path that is a DIRECTORY, so unlink()
 * rejects (EISDIR/EPERM). With asyncHandler + an error middleware, the client
 * must get a prompt error status instead of hanging.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { mountDocuments } from '../../gateway/src/api/routes/documents.routes.js';

// Mirror production (index.ts): swallow unhandled rejections so a not-yet-fixed
// handler's rejection doesn't tear down the test runner before we assert.
const swallow = () => {};
process.on('unhandledRejection', swallow);

test('DELETE /api/documents/:filename responds (does not hang) when unlink fails', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-del-'));
  const docsDir = join(baseDir, 'workspace', 'documents');
  mkdirSync(docsDir, { recursive: true });
  // A directory under documents/: existsSync passes, but unlink() on a dir rejects.
  mkdirSync(join(docsDir, 'adir'), { recursive: true });

  const app = express();
  app.use(express.json());
  const gateway = { getServices: () => ({}), sandbox: { sanitizeFilename: (n: string) => n } };
  mountDocuments(app as any, gateway, baseDir);
  // Error middleware mirroring init/phase-11-http.ts.
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: String(err?.message || err) });
  });
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(`http://127.0.0.1:${port}/api/documents/adir`, {
      method: 'DELETE',
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    assert.equal(resp.status, 500, 'FS error should surface as 500, not a hung request');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    process.off('unhandledRejection', swallow);
  }
});
