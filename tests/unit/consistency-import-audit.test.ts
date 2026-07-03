/**
 * Flagship Plan 3, Task 6: POST /api/books/:slug/consistency/import-audit —
 * import a manuscript file (from the book's data dir or the document
 * library) and run the SAME runConsistencyAudit implementation the manual
 * /consistency-audit route uses (registry-guarded). Drives the real
 * mountConsistency route with a real ConsistencyStore (temp db) and a real
 * runConsistencyAudit call (stubbed only at the AI-extraction boundary,
 * mirroring consistency-audit.test.ts's established pattern).
 *
 * Auth: the route itself adds no auth logic — it inherits the global
 * `/api/*` bearer gate (index.ts). Since that gate is private to the running
 * gateway and not importable standalone, this test reproduces its exact
 * posture (Authorization: Bearer <token>, or ?token= fallback) as harness
 * middleware ahead of mountConsistency, so a request with no token still
 * gets a real 401 before reaching the route.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { mountConsistency } from '../../gateway/src/api/routes/consistency.routes.js';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import { runConsistencyAudit } from '../../gateway/src/services/consistency/audit.js';
import { ConsistencyJobRegistry } from '../../gateway/src/services/consistency/job-registry.js';

const TOKEN = 'test-token-123';

function authGate(req: any, res: any, next: any) {
  const header = String(req.headers['authorization'] || '');
  const headerToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  const token = headerToken || queryToken;
  if (token !== TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

async function startHarness(gateway: any, baseDir: string) {
  const app = express();
  app.use(express.json());
  app.use(authGate);
  mountConsistency(app as any, gateway, baseDir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// Stub extractor: chapters containing "blue" or "green" eyes conflict, same
// pattern as tests/unit/consistency-audit.test.ts.
const extract = async (text: string, _k: any[], base: number) => ({
  scenes: [{ storyTime: base, timeLabel: null }],
  facts: text.includes('eyes') ? [{
    entity: 'John', aliases: ['John'], attribute: 'eye_color', type: 'immutable' as const,
    valueRaw: text.includes('blue') ? 'blue' : 'green', valueNorm: text.includes('blue') ? 'blue' : 'green',
    storyTime: base, timeLabel: null, transition: null, scene: 0, source: 'manuscript' as const, evidence: text,
  }] : [],
});

function makeGateway(store: ConsistencyStore, dataDir: string, slug: string) {
  const books = {
    exists: (s: string) => s === slug,
    dataDirOf: (s: string) => (s === slug ? dataDir : null),
    worldDocsOf: () => null,
    worldbuildingOf: () => null,
    open: async () => ({ manifest: { pulledFrom: {} } }),
  };
  return {
    consistencyJobs: new ConsistencyJobRegistry(),
    getServices: () => ({
      books,
      consistencyStore: store,
      consistencyAudit: (s: string) => runConsistencyAudit(s, { store, books, extract }),
    }),
  };
}

test('401 without a bearer token', async () => {
  const root = mkdtempSync(join(tmpdir(), 'import-audit-401-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    const gateway = makeGateway(store, dataDir, 'my-book');
    const { port, close } = await startHarness(gateway, root);
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/books/my-book/consistency/import-audit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: 'old-novel.md' }),
      });
      assert.equal(resp.status, 401);
    } finally { await close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('imports a 3-chapter manuscript from the document library and reuses runConsistencyAudit (planted contradiction found)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'import-audit-ok-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    // The book's data dir is otherwise EMPTY (a fresh container for an import) —
    // the source file lives in the document library, as the "or an uploaded doc" path.
    const docsDir = join(root, 'workspace', 'documents');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, 'old-novel.md'), [
      '# Chapter 1', 'John has blue eyes.', '',
      '# Chapter 2', 'Nothing changes here.', '',
      '# Chapter 3', 'John has green eyes.',
    ].join('\n'));

    const gateway = makeGateway(store, dataDir, 'my-book');
    const { port, close } = await startHarness(gateway, root);
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/books/my-book/consistency/import-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ filename: 'old-novel.md' }),
      });
      assert.equal(resp.status, 200);
      const body = await resp.json();
      assert.equal(body.report.chaptersScanned, 3);
      const c = body.report.findings.find((f: any) => f.category === 'contradiction' && f.attribute === 'eye_color');
      assert.ok(c, 'planted eye-color contradiction reported');
    } finally { await close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('404 when the named file does not exist anywhere', async () => {
  const root = mkdtempSync(join(tmpdir(), 'import-audit-404-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    const gateway = makeGateway(store, dataDir, 'my-book');
    const { port, close } = await startHarness(gateway, root);
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/books/my-book/consistency/import-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ filename: 'nope.md' }),
      });
      assert.equal(resp.status, 404);
    } finally { await close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// M2: runConsistencyAudit prefers per-chapter chapter-N.md files over a
// combined manuscript.md. Importing into a book that already has generated
// chapters would silently audit those EXISTING chapters instead of the
// imported text — reject instead.
test('M2: 409 when the book already has generated per-chapter files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'import-audit-has-chapters-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'chapter-1.md'), '# Chapter 1\nExisting generated prose.');

    const docsDir = join(root, 'workspace', 'documents');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, 'old-novel.md'), '# Chapter 1\nImported prose.');

    const gateway = makeGateway(store, dataDir, 'my-book');
    const { port, close } = await startHarness(gateway, root);
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/books/my-book/consistency/import-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ filename: 'old-novel.md' }),
      });
      assert.equal(resp.status, 409);
      // The existing chapter file must be untouched.
      const { readFileSync } = await import('fs');
      assert.equal(readFileSync(join(dataDir, 'chapter-1.md'), 'utf-8'), '# Chapter 1\nExisting generated prose.');
    } finally { await close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// M2: never clobber an existing manuscript.md — the second import into the
// same book must not silently overwrite whatever was there before.
test('M2: 409 when manuscript.md already exists in the book\'s data dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'import-audit-existing-manuscript-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'manuscript.md'), '# Chapter 1\nOriginal imported prose — must survive.');

    const docsDir = join(root, 'workspace', 'documents');
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, 'second-novel.md'), '# Chapter 1\nA different manuscript entirely.');

    const gateway = makeGateway(store, dataDir, 'my-book');
    const { port, close } = await startHarness(gateway, root);
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/api/books/my-book/consistency/import-audit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ filename: 'second-novel.md' }),
      });
      assert.equal(resp.status, 409);
      const { readFileSync } = await import('fs');
      assert.equal(
        readFileSync(join(dataDir, 'manuscript.md'), 'utf-8'),
        '# Chapter 1\nOriginal imported prose — must survive.',
        'existing manuscript.md must not be overwritten',
      );
    } finally { await close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
