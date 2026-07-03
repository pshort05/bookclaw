/**
 * Integration test for Flagship Plan 3, Task 4: the auto-execute loop
 * (mountProjects /api/projects/:id/auto-execute — the same site Plan 2 wired
 * heat_check/STORY CANON into) must (a) inject buildCanonBlock's ledger block
 * into the prompt BEFORE a draft-role chapter generates, and (b) run
 * checkChapter AFTER generation and attach its flags to
 * `step.continuityFlags`. Both are behind a book-has-bible guard: fail-soft
 * (no throw, step still completes) when the consistency store is unavailable.
 *
 * Drives the REAL route with a REAL ConsistencyStore (temp db) — not a stub
 * that can't fail the way production does. `gateway.handleMessage` (the
 * drafting call) is mocked directly, matching safety-floor-route-integration
 * .test.ts's established harness pattern; `services.aiRouter.complete` (the
 * ONLY AI call checkChapter's extractor makes here) is real-shaped JSON.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { mountProjects } from '../../gateway/src/api/routes/projects.routes.js';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import type { LedgerFact } from '../../gateway/src/services/consistency/types.js';

function fact(p: Partial<LedgerFact>): LedgerFact {
  return {
    world: null, bookSlug: 'continuity-book', entity: 'Anna', aliases: ['Anna'], attribute: 'eye_color',
    type: 'immutable', valueRaw: 'brown eyes', valueNorm: 'brown', storyTime: 0, storyElapsed: 0, timeLabel: null,
    transition: null, chapter: 'chapter-1', scene: 0, source: 'manuscript', evidence: 'brown eyes', canonical: true, ...p,
  };
}

function makeProject() {
  return {
    id: 'p1', title: 'Continuity Test', bookSlug: 'continuity-book', context: {},
    steps: [{
      id: 'p1-step-1', label: 'Write Chapter 2', status: 'active', role: 'draft',
      chapterNumber: 2, prompt: 'Draft it.', taskType: 'creative_writing',
    }],
  };
}

function makeHarness(opts: { store: ConsistencyStore | undefined; draftText: string; extractorJson: string; auditRunning?: boolean }) {
  const project = makeProject();
  let capturedContext = '';
  const engine = {
    getProject: () => project,
    buildProjectContext: async () => '',
    completeStep: (_pid: string, _sid: string, _resp: string) => { project.steps[0].status = 'completed'; return null; },
    failStep: () => {},
    tryStartDriving: () => true,
    stopDriving: () => {},
  };
  const gateway = {
    getProjectEngine: () => engine,
    getServices: () => ({
      books: {
        open: async () => ({ manifest: { pulledFrom: {} } }),
        dataDirOf: () => null,
        activeDataDir: () => null,
      },
      consistencyStore: opts.store,
      aiRouter: {
        complete: async () => ({ text: opts.extractorJson }),
        selectProvider: () => ({ id: 'gemini' }),
      },
      confirmationGate: null,
      activityLog: null,
      heartbeat: { addWords() {} },
    }),
    // M3 guard: the checkChapter caller consults this to skip persistence
    // while a full/import consistency audit is in flight for the book.
    consistencyJobs: { isRunning: () => opts.auditRunning === true },
    handleMessage: async (_m: string, _c: string, cb: (t: string) => void, context: string) => {
      capturedContext = context;
      cb(opts.draftText);
    },
  };
  return { project, gateway, getCapturedContext: () => capturedContext };
}

async function runAutoExecute(gateway: any) {
  const baseDir = mkdtempSync(join(tmpdir(), 'bookclaw-continuity-int-'));
  const app = express();
  app.use(express.json());
  mountProjects(app as any, gateway, baseDir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/projects/p1/auto-execute`, { method: 'POST' });
    return { status: resp.status, body: await resp.json() };
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(baseDir, { recursive: true, force: true });
  }
}

const draftText = "Anna's blue eyes shone bright in the moonlight over the harbor, and she smiled at the memory.";
const extractorJson = JSON.stringify({
  scenes: [{ timeLabel: null, canonical: true }],
  facts: [{
    entity: 'Anna', aliases: ['Anna'], attribute: 'eye_color', type: 'immutable',
    valueRaw: "Anna's blue eyes", valueNorm: 'blue', scene: 0, transition: null, evidence: "Anna's blue eyes",
  }],
  knowledgeEvents: [],
});

test('a draft-role chapter gets the canon-ledger block pre-draft and continuityFlags post-draft', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-int-store-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    store.insertFacts([fact({ chapter: 'chapter-1' })]);

    const { project, gateway, getCapturedContext } = makeHarness({ store, draftText, extractorJson });
    const result = await runAutoExecute(gateway);

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.match(getCapturedContext(), /CONTINUITY LEDGER/, 'pre-draft prompt carries the canon-ledger block');
    assert.match(getCapturedContext(), /Anna\.eye_color: brown eyes/);

    const flags = (project.steps[0] as any).continuityFlags;
    assert.ok(Array.isArray(flags) && flags.length > 0, 'post-draft continuity flags attached to the step');
    assert.equal(flags[0].kind, 'contradiction');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// M3 (bug-review #22 hazard, now live post-C1): while a full/import audit is
// in flight for the book, checkChapter's own persistence is skipped so its
// clear+insert doesn't race the audit's clearBookFacts()+reinsert. Detection
// still runs (continuityFlags still attach), only the write-back is skipped.
test('M3: while a full consistency audit is in flight, the chapter\'s facts are NOT persisted (but flags still attach)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-int-skip-persist-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    store.insertFacts([fact({ chapter: 'chapter-1' })]);

    const { project, gateway } = makeHarness({ store, draftText, extractorJson, auditRunning: true });
    const result = await runAutoExecute(gateway);

    assert.equal(result.status, 200);
    const flags = (project.steps[0] as any).continuityFlags;
    assert.ok(Array.isArray(flags) && flags.length > 0, 'detection still runs and attaches flags');

    // No chapter-2 row was written while the audit was "running".
    const priors = store.priorFacts({ world: null, bookSlug: 'continuity-book' }, 'Anna', 'eye_color');
    assert.ok(!priors.some(p => p.chapter === 'chapter-2'), 'chapter facts not persisted while a full audit is in flight');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('fail-soft: no consistency store -> step still completes, no continuityFlags, no throw', async () => {
  const { project, gateway, getCapturedContext } = makeHarness({ store: undefined, draftText, extractorJson });
  const result = await runAutoExecute(gateway);

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.doesNotMatch(getCapturedContext(), /CONTINUITY LEDGER/);
  assert.equal((project.steps[0] as any).continuityFlags, undefined);
});

test('a non-draft step (e.g. marketing) is not run through canon injection or continuity check', async () => {
  const { project, gateway, getCapturedContext } = makeHarness({ store: undefined, draftText, extractorJson });
  project.steps[0].role = 'marketing';
  const result = await runAutoExecute(gateway);

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.doesNotMatch(getCapturedContext(), /CONTINUITY LEDGER/);
  assert.equal((project.steps[0] as any).continuityFlags, undefined);
});
