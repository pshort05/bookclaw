/**
 * Tests for Flagship Plan 6, Task 5: GET /api/books/fleet — cross-book state,
 * derived from the real DriveScheduler (running/queued) and project pause
 * markers (budgetPause / review) set elsewhere in this plan. Driven through
 * the real route (mountBooks), not a unit test of a bare helper function.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'net';
import { DriveScheduler } from '../../gateway/src/services/pipeline/scheduler.js';
import { mountBooks } from '../../gateway/src/api/routes/books.routes.js';

function fakeLock() {
  const driving = new Set<string>();
  return {
    tryStartDriving(id: string) { if (driving.has(id)) return false; driving.add(id); return true; },
    stopDriving(id: string) { driving.delete(id); },
    isDriving(id: string) { return driving.has(id); },
  };
}

test('GET /api/books/fleet reports running/queued/paused_budget/paused_review/idle per book', async () => {
  const scheduler = new DriveScheduler(fakeLock(), 1); // cap 1 so the 2nd acquire genuinely queues
  await scheduler.acquire('proj-running'); // book-running now holds the only slot
  const queuedPromise = scheduler.acquire('proj-queued'); // book-queued piles up behind it

  await new Promise((r) => setTimeout(r, 10)); // let the queue settle

  const projects = [
    { id: 'proj-running', bookSlug: 'book-running', status: 'active' },
    { id: 'proj-queued', bookSlug: 'book-queued', status: 'active' },
    { id: 'proj-budget', bookSlug: 'book-budget', status: 'paused', budgetPause: { reason: 'x', scope: 'book', at: '' } },
    { id: 'proj-review', bookSlug: 'book-review', status: 'paused', review: { confirmationId: 'c1', stepId: 's1', kind: 'pipeline-gate' } },
  ];
  const books = [
    { slug: 'book-running', title: 'Running' },
    { slug: 'book-queued', title: 'Queued' },
    { slug: 'book-budget', title: 'Budget Paused' },
    { slug: 'book-review', title: 'Review Paused' },
    { slug: 'book-idle', title: 'Idle' }, // no projects at all
  ];

  const gateway: any = {
    getProjectEngine: () => ({ listProjects: () => projects }),
    getServices: () => ({ books: { list: () => books }, driveScheduler: scheduler }),
  };
  const app = express();
  mountBooks(app as any, gateway, '/tmp');
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const res = await fetch(`${url}/api/books/fleet`);
    assert.equal(res.status, 200);
    const body = await res.json();
    const byBook: Record<string, string> = {};
    for (const b of body.fleet) byBook[b.slug] = b.state;

    assert.equal(byBook['book-running'], 'running');
    assert.equal(byBook['book-queued'], 'queued');
    assert.equal(byBook['book-budget'], 'paused_budget');
    assert.equal(byBook['book-review'], 'paused_review');
    assert.equal(byBook['book-idle'], 'idle');
  } finally {
    scheduler.release('proj-running');
    await queuedPromise;
    scheduler.release('proj-queued');
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// L1 fix: state must be the HIGHEST-priority state across ALL of a book's
// projects, not just the first one in array order.
test('GET /api/books/fleet reports the highest-priority state when a book has multiple projects', async () => {
  const scheduler = new DriveScheduler(fakeLock(), 3);
  await scheduler.acquire('proj-running-2'); // this book's SECOND project is the one actually running

  const projects = [
    // Listed FIRST but lower priority than the running project below it.
    { id: 'proj-budget-1', bookSlug: 'multi-book', status: 'paused', budgetPause: { reason: 'x', scope: 'book', at: '' } },
    { id: 'proj-running-2', bookSlug: 'multi-book', status: 'active' },
  ];
  const books = [{ slug: 'multi-book', title: 'Multi-project book' }];

  const gateway: any = {
    getProjectEngine: () => ({ listProjects: () => projects }),
    getServices: () => ({ books: { list: () => books }, driveScheduler: scheduler }),
  };
  const app = express();
  mountBooks(app as any, gateway, '/tmp');
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const res = await fetch(`${url}/api/books/fleet`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.fleet[0].state, 'running', 'the running project must win over the earlier-listed paused_budget project');
  } finally {
    scheduler.release('proj-running-2');
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('GET /api/books/fleet fails soft with a 500 JSON error when the books service throws', async () => {
  const scheduler = new DriveScheduler(fakeLock(), 3);
  const gateway: any = {
    getProjectEngine: () => ({ listProjects: () => [] }),
    getServices: () => ({
      books: { list: () => { throw new Error('books service unavailable'); } },
      driveScheduler: scheduler,
    }),
  };
  const app = express();
  mountBooks(app as any, gateway, '/tmp');
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const res = await fetch(`${url}/api/books/fleet`);
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.ok(body.error);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('GET /api/books/fleet still resolves /api/books/:slug for a real slug (route ordering)', async () => {
  const scheduler = new DriveScheduler(fakeLock(), 3);
  const gateway: any = {
    getProjectEngine: () => ({ listProjects: () => [] }),
    getServices: () => ({
      books: {
        list: () => [{ slug: 'fleet', title: 'A book literally named fleet' }],
        open: async (slug: string) => (slug === 'fleet' ? { manifest: { title: 'x' }, status: 'active' } : undefined),
      },
      driveScheduler: scheduler,
    }),
  };
  const app = express();
  mountBooks(app as any, gateway, '/tmp');
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // /api/books/fleet (the literal fleet-view route) must win over :slug for the path "fleet"...
    const fleetRes = await fetch(`${url}/api/books/fleet`);
    assert.equal(fleetRes.status, 200);
    const body = await fleetRes.json();
    assert.ok(Array.isArray(body.fleet));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
