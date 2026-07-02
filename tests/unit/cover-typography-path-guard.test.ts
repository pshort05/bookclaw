/**
 * Regression test for bug L8: POST /api/covers/apply-typography confined
 * `imagePath` with a raw prefix check `resolved.startsWith(resolve(workspaceDir))`
 * (no trailing separator), so a sibling directory whose name merely begins with
 * "workspace" — e.g. `<baseDir>/workspace-evil/cover.png` — passed the guard and
 * was read/written by the typography service. The fix uses the repo's
 * separator-aware confinement pattern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { mountExport } from '../../gateway/src/api/routes/export.routes.js';

async function serve(baseDir: string, captured: { imagePath?: string }): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  const gateway = {
    getServices: () => ({
      coverTypography: {
        apply: async (opts: any) => { captured.imagePath = opts.imagePath; return { success: true }; },
      },
    }),
  };
  mountExport(app as any, gateway, baseDir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test('apply-typography rejects a workspace-prefixed sibling directory', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-typo-'));
  const captured: { imagePath?: string } = {};
  const { url, close } = await serve(baseDir, captured);
  try {
    const resp = await fetch(`${url}/api/covers/apply-typography`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'T', author: 'A', imagePath: join(baseDir, 'workspace-evil', 'cover.png') }),
    });
    assert.equal(resp.status, 400, 'a workspace-prefixed sibling must be rejected');
    assert.equal(captured.imagePath, undefined, 'typography service must not be called for an escaped path');
  } finally {
    await close();
  }
});

test('apply-typography allows a real path inside workspace/', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-typo-'));
  const captured: { imagePath?: string } = {};
  const { url, close } = await serve(baseDir, captured);
  try {
    const legit = join(baseDir, 'workspace', 'covers', 'cover.png');
    const resp = await fetch(`${url}/api/covers/apply-typography`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'T', author: 'A', imagePath: legit }),
    });
    assert.equal(resp.status, 200, 'a real workspace descendant must be allowed');
    assert.equal(captured.imagePath, legit, 'typography service must receive the resolved path');
  } finally {
    await close();
  }
});
