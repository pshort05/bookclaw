/**
 * Regression test for bug-review finding #6: POST /api/author-os/format resolved
 * inputFile against several bases and only confined the result to the REPO ROOT
 * (baseDir), so `../.env` climbed out of workspace but stayed under baseDir and
 * passed the guard — leaking the repo-root `.env` (vault key + auth token) into a
 * downloadable export. The confinement must be the workspace, not the repo root.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { mountHeartbeat } from '../../gateway/src/api/routes/heartbeat.routes.js';

async function serve(baseDir: string): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  const gateway = { getServices: () => ({ books: { activeDataDir: () => null } }) };
  mountHeartbeat(app as any, gateway, baseDir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}

test('author-os/format refuses a ../ traversal that escapes the workspace (finding 6)', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-fmt-'));
  mkdirSync(join(baseDir, 'workspace'), { recursive: true });
  // Repo-root .env holding secrets — exactly what must NOT be exportable.
  writeFileSync(join(baseDir, '.env'), 'BOOKCLAW_VAULT_KEY=supersecret\nBOOKCLAW_AUTH_TOKEN=abc123\n');

  const { url, close } = await serve(baseDir);
  try {
    const resp = await fetch(`${url}/api/author-os/format`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputFile: '../.env', formats: ['txt'], title: 'leak' }),
    });
    assert.equal(resp.status, 403, 'a workspace-escaping traversal must be blocked with 403');
    // The secret must never have been written into the exports dir.
    const exportsDir = join(baseDir, 'workspace', 'exports');
    if (existsSync(exportsDir)) {
      for (const f of readdirSync(exportsDir)) {
        assert.ok(!f.includes('leak'), 'no export artifact should be produced from the .env');
      }
    }
  } finally {
    await close();
  }
});

test('author-os/format still formats a legit workspace file (finding 6 no regression)', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-fmt-'));
  mkdirSync(join(baseDir, 'workspace'), { recursive: true });
  writeFileSync(join(baseDir, 'workspace', 'chapter.md'), '# Chapter One\n\nHello.');

  const { url, close } = await serve(baseDir);
  try {
    const resp = await fetch(`${url}/api/author-os/format`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputFile: 'chapter.md', formats: ['txt'], title: 'chapter' }),
    });
    assert.equal(resp.status, 200, 'a normal workspace file must still format');
  } finally {
    await close();
  }
});
