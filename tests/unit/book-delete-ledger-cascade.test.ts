/**
 * Regression: DELETE /api/books/:slug must cascade to the consistency ledger.
 *
 * `facts` and `knowledge` are keyed by book_slug, and a recreated book reuses the
 * slug — so without this cascade the new book is fact-checked against the deleted
 * one's rows (measured live: firefly-pond kept 460 facts across chapters 1-25 and
 * flagged chapter 1 against a "chapter-24" that does not exist in the new run).
 *
 * Driven through the real route (mountBooks) against a real temp ConsistencyStore.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'net';
import { mountBooks } from '../../gateway/src/api/routes/books.routes.js';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import type { LedgerFact, KnowledgeEvent } from '../../gateway/src/services/consistency/types.js';

const WORLD = 'shattered-cradle';

function fact(p: Partial<LedgerFact>): LedgerFact {
  return {
    world: null, bookSlug: 'book-a', entity: 'Addi Green', aliases: ['Addi'], attribute: 'hair_color',
    type: 'immutable', valueRaw: 'teal', valueNorm: 'teal', storyTime: 0, storyElapsed: 0, timeLabel: null,
    transition: null, chapter: 'ch1', scene: 0, source: 'manuscript', evidence: 'her teal hair',
    canonical: true, ...p,
  };
}

function knows(p: Partial<KnowledgeEvent>): KnowledgeEvent {
  return {
    world: null, bookSlug: 'book-a', knower: 'Addi', factKey: 'Addi hair_color teal',
    kind: 'use', source: 'reference', storyTime: 0, chapter: 'ch1', scene: 0, canonical: true,
    evidence: 'she mentions her hair', ...p,
  };
}

/** Rows still in the ledger for a book, counted through the store's own API. */
function ledgerCounts(store: ConsistencyStore, slug: string) {
  const facts = store.reverseIndex({ world: null, bookSlug: slug })
    .reduce((n, r) => n + r.chapters.length, 0);
  const knowledge = store.knowledgeForBook({ world: null, bookSlug: slug }).length;
  return { facts, knowledge };
}

/** Minimal gateway/services fake for the DELETE route, plus a live express server. */
async function harness(consistencyStore: any, opts: { reapPending?: (scope: any, reason: string) => Promise<void> } = {}) {
  const deleted: string[] = [];
  const books = new Set(['book-a', 'book-b']);
  const gateway: any = {
    getProjectEngine: () => ({ deleteProjectsByBook: () => 2 }),
    getServices: () => ({
      books: {
        exists: (s: string) => books.has(s),
        getActiveBook: () => null,
        delete: async (s: string) => { books.delete(s); deleted.push(s); return { active: null }; },
      },
      confirmationGate: opts.reapPending ? { reapPending: opts.reapPending } : undefined,
      consistencyStore,
    }),
  };
  const app = express();
  mountBooks(app as any, gateway, '/tmp');
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    deleted,
    exists: (s: string) => books.has(s),
    close: () => new Promise<void>((r) => { server.close(() => r()); }),
  };
}

async function makeStore(root: string): Promise<ConsistencyStore | null> {
  const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
  await store.initialize();
  if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return null; }
  store.insertFacts([
    fact({ chapter: 'ch1' }), fact({ chapter: 'ch16', valueNorm: 'dark red' }), fact({ chapter: 'ch24', valueNorm: 'dark red' }),
    fact({ bookSlug: 'book-b', chapter: 'ch1', entity: 'Mara' }),
    // World canon seeded from book-a's bible (init/phase-06-content.ts writes BOTH
    // `world` and `bookSlug`) — every sibling book in the world reads these rows.
    fact({ world: WORLD, bookSlug: 'book-a', source: 'canon', chapter: 'CANON', entity: 'Ilm', attribute: 'capital_of', valueRaw: 'the Cradle', valueNorm: 'the cradle' }),
    // book-a's own worldless canon — belongs to book-a alone, goes with it.
    fact({ world: null, bookSlug: 'book-a', source: 'canon', chapter: 'CANON', entity: 'Addi Green', attribute: 'origin', valueRaw: 'Ilm', valueNorm: 'ilm' }),
  ]);
  store.insertKnowledge([
    knows({ chapter: 'ch1' }), knows({ chapter: 'ch16' }),
    knows({ bookSlug: 'book-b', chapter: 'ch1', knower: 'Mara' }),
  ]);
  return store;
}

test('DELETE /api/books/:slug clears the deleted book\'s facts and knowledge', async () => {
  const root = mkdtempSync(join(tmpdir(), 'book-del-ledger-'));
  try {
    const store = await makeStore(root);
    if (!store) return;
    assert.equal(ledgerCounts(store, 'book-a').facts, 3, 'fixture: book-a has facts');

    const h = await harness(store);
    try {
      const res = await fetch(`${h.url}/api/books/book-a`, { method: 'DELETE' });
      assert.equal(res.status, 200);
      const counts = ledgerCounts(store, 'book-a');
      assert.equal(counts.facts, 0, 'facts left behind for the deleted slug');
      assert.equal(counts.knowledge, 0, 'knowledge left behind for the deleted slug');
      // The book's own (worldless) canon goes with the book.
      const ownCanon = store.factsForBook({ world: null, bookSlug: 'book-a' })
        .filter(f => f.source === 'canon' && f.world === null);
      assert.equal(ownCanon.length, 0, 'book-keyed canon left behind for the deleted slug');
    } finally { await h.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('DELETE /api/books/:slug clears the deleted book and leaves a sibling\'s rows untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'book-del-ledger-iso-'));
  try {
    const store = await makeStore(root);
    if (!store) return;
    const h = await harness(store);
    try {
      await fetch(`${h.url}/api/books/book-a`, { method: 'DELETE' });
      // Both halves, in the same run — asserting only the survivor passes vacuously
      // against a no-op cascade.
      const gone = ledgerCounts(store, 'book-a');
      assert.equal(gone.facts, 0, 'book-a facts must be gone');
      assert.equal(gone.knowledge, 0, 'book-a knowledge must be gone');
      const other = ledgerCounts(store, 'book-b');
      assert.equal(other.facts, 1, 'book-b facts must survive');
      assert.equal(other.knowledge, 1, 'book-b knowledge must survive');
    } finally { await h.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('deleting a book does NOT destroy the world canon its siblings read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'book-del-ledger-canon-'));
  try {
    const store = await makeStore(root);
    if (!store) return;
    const visibleToB = () => store.factsForBook({ world: WORLD, bookSlug: 'book-b' })
      .filter(f => f.source === 'canon' && f.entity === 'Ilm').length;
    assert.equal(visibleToB(), 1, 'fixture: book-b sees the world canon');

    const h = await harness(store);
    try {
      await fetch(`${h.url}/api/books/book-a`, { method: 'DELETE' });
      // The bible-seed hook only fires for a project that no longer exists and the
      // canon_seed hash still matches, so a delete here is unrecoverable.
      assert.equal(visibleToB(), 1, 'world canon vanished when its seeding book was deleted');
    } finally { await h.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('DELETE /api/books/:slug clears the cached consistency report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'book-del-ledger-report-cache-'));
  try {
    const store = await makeStore(root);
    if (!store) return;
    store.saveReport('book-a', { findings: [{ chapter: 'chapter-24' }] });
    store.saveReport('book-b', { findings: [] });

    const h = await harness(store);
    try {
      await fetch(`${h.url}/api/books/book-a`, { method: 'DELETE' });
      // GET /api/books/:slug/consistency-report gates only on book existence, so a
      // stale report resurfaces in the Consistency panel after delete + recreate.
      assert.equal(store.getReport('book-a'), null, 'stale audit report survived the delete');
      assert.notEqual(store.getReport('book-b'), null, 'a sibling\'s report must survive');
    } finally { await h.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('DELETE /api/books/:slug reports what was cleared', async () => {
  const root = mkdtempSync(join(tmpdir(), 'book-del-ledger-report-'));
  try {
    const store = await makeStore(root);
    if (!store) return;
    const h = await harness(store);
    try {
      const res = await fetch(`${h.url}/api/books/book-a`, { method: 'DELETE' });
      const body: any = await res.json();
      assert.equal(body.deleted, 'book-a');
      assert.equal(body.removedProjects, 2);
      assert.equal(body.removedFacts, 4, '3 manuscript + 1 book-keyed canon (the world canon stays)');
      assert.equal(body.removedKnowledge, 2);
      assert.equal(body.ledgerCleared, true);
    } finally { await h.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the ledger is cleared before anything that can fail mid-cascade', async () => {
  const root = mkdtempSync(join(tmpdir(), 'book-del-ledger-order-'));
  try {
    const store = await makeStore(root);
    if (!store) return;
    // reapPending awaits disk I/O; an ENOSPC/EACCES rejection used to escape AFTER
    // the book dir was gone and BEFORE the ledger clear — orphaning the ledger with
    // no way back (a retry 404s on the exists() guard).
    const h = await harness(store, { reapPending: async () => { throw new Error('ENOSPC: no space left on device'); } });
    try {
      await fetch(`${h.url}/api/books/book-a`, { method: 'DELETE' });
      const counts = ledgerCounts(store, 'book-a');
      assert.equal(counts.facts, 0, 'ledger orphaned by a mid-cascade failure');
      assert.equal(counts.knowledge, 0, 'ledger orphaned by a mid-cascade failure');
    } finally { await h.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('clearBookLedger is atomic — a failed knowledge delete rolls the facts back', async () => {
  const root = mkdtempSync(join(tmpdir(), 'book-del-ledger-tx-'));
  try {
    const store = await makeStore(root);
    if (!store) return;
    const realDb: any = (store as any).db;
    // SQLITE_BUSY on the knowledge delete is realistic under WAL with a concurrent
    // audit. A half-cleared ledger reported as success is worse than a clean failure.
    (store as any).db = new Proxy(realDb, {
      get(target, prop, receiver) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (/DELETE\s+FROM\s+knowledge/i.test(sql)) return { run: () => { throw new Error('SQLITE_BUSY: database is locked'); } };
            return target.prepare(sql);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    assert.throws(() => store.clearBookLedger('book-a'), /SQLITE_BUSY/);
    (store as any).db = realDb;
    const counts = ledgerCounts(store, 'book-a');
    assert.equal(counts.facts, 3, 'facts must roll back when the knowledge delete fails');
    assert.equal(counts.knowledge, 2, 'knowledge must be untouched');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a throwing consistency store never blocks the delete (fail-soft) and says so', async () => {
  const store = {
    isAvailable: () => true,
    clearBookLedger: () => { throw new Error('database is locked'); },
  };
  const h = await harness(store);
  try {
    const res = await fetch(`${h.url}/api/books/book-a`, { method: 'DELETE' });
    assert.equal(res.status, 200, 'a ledger error must not 500 the delete');
    const body: any = await res.json();
    assert.equal(body.deleted, 'book-a');
    assert.equal(h.exists('book-a'), false, 'the book itself must still be gone');
    assert.equal(body.removedFacts, 0);
    assert.equal(body.removedKnowledge, 0);
    // A client must be able to tell a failure from a clean zero.
    assert.equal(body.ledgerCleared, false);
  } finally { await h.close(); }
});

test('delete succeeds — and logs — when the consistency store is unavailable or absent', async () => {
  for (const store of [{ isAvailable: () => false, clearBookLedger: () => { throw new Error('nope'); } }, undefined]) {
    const h = await harness(store);
    const lines: string[] = [];
    const realLog = console.log;
    console.log = (...args: any[]) => { lines.push(args.join(' ')); };
    try {
      const res = await fetch(`${h.url}/api/books/book-a`, { method: 'DELETE' });
      console.log = realLog;
      assert.equal(res.status, 200);
      const body: any = await res.json();
      assert.equal(body.deleted, 'book-a');
      assert.equal(h.exists('book-a'), false);
      assert.equal(body.removedFacts, 0);
      assert.equal(body.removedKnowledge, 0);
      assert.equal(body.ledgerCleared, true, 'no store means there is nothing to clear, not a failure');
      // A deployment where the cascade silently stops running must leave a signal.
      assert.ok(lines.some(l => l.includes('ℹ') && /ledger/i.test(l)), `expected a skip notice, got: ${JSON.stringify(lines)}`);
    } finally { console.log = realLog; await h.close(); }
  }
});
