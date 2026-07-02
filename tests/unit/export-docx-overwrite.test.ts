/**
 * Regression test for bug-review finding #9: POST /api/projects/:id/export-docx
 * overwrites the SOURCE file with DOCX bytes when the source name is not a .md
 * (e.g. a compiled `.docx` manuscript), because `.replace(/\.md$/i,'.docx')` is
 * a no-op and docxName === filename. Mounts the real documents route module on a
 * bare Express app and drives it over HTTP.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { mountDocuments } from '../../gateway/src/api/routes/documents.routes.js';

/** Mount documents routes with a fake gateway/engine and return a live base URL + cleanup. */
async function serve(baseDir: string, project: any): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(express.json());
  const gateway = {
    getServices: () => ({ books: null }),
    getProjectEngine: () => ({ getProject: (id: string) => (id === project.id ? project : null) }),
  };
  mountDocuments(app as any, gateway, baseDir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test('export-docx refuses a non-.md source and does NOT overwrite it', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-docx-'));
  const project = { id: 'p1', title: 'Test Book', bookSlug: null };
  // Legacy per-project dir: workspace/projects/<title-slug>/
  const projectDir = join(baseDir, 'workspace', 'projects', 'test-book');
  mkdirSync(projectDir, { recursive: true });
  const srcName = 'p1-manuscript.docx';
  const srcPath = join(projectDir, srcName);
  const original = Buffer.from('ORIGINAL-COMPILED-MANUSCRIPT-BYTES');
  writeFileSync(srcPath, original);

  const { url, close } = await serve(baseDir, project);
  try {
    const resp = await fetch(`${url}/api/projects/p1/export-docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: srcName }),
    });
    assert.equal(resp.status, 400, 'a non-.md source must be rejected with 400');
    assert.ok(existsSync(srcPath), 'source file must still exist');
    assert.deepEqual(readFileSync(srcPath), original, 'source file must be byte-for-byte unchanged');
  } finally {
    await close();
  }
});

test('export-docx still works for a .md source (writes a sibling .docx, source intact)', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-docx-'));
  const project = { id: 'p2', title: 'Test Book', bookSlug: null };
  const projectDir = join(baseDir, 'workspace', 'projects', 'test-book');
  mkdirSync(projectDir, { recursive: true });
  const srcName = 'p2-chapter.md';
  const srcPath = join(projectDir, srcName);
  writeFileSync(srcPath, '# Chapter\n\nHello world.');

  const { url, close } = await serve(baseDir, project);
  try {
    const resp = await fetch(`${url}/api/projects/p2/export-docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: srcName }),
    });
    assert.equal(resp.status, 200);
    assert.equal(readFileSync(srcPath, 'utf-8'), '# Chapter\n\nHello world.', 'source .md unchanged');
    assert.ok(existsSync(join(projectDir, 'p2-chapter.docx')), 'a sibling .docx was written');
  } finally {
    await close();
  }
});
