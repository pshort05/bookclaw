/**
 * C1 fix (Flagship Plan 6 code review): the per-book budget was inert —
 * CostTracker.setBookBudget had zero production callers, so a book's
 * manifest.costBudget was never pushed into the tracker and
 * wouldExceedBook() always returned false. costs.test.ts only proved
 * wouldExceedBook works when the TEST calls setBookBudget directly, which
 * masked the bug (nothing in production ever called it).
 *
 * These tests exercise the real manifest -> tracker wiring end to end,
 * WITHOUT calling costs.setBookBudget from the test itself:
 *  1. Creating a book via the real POST /api/books route with a costBudget
 *     must make the RUNNING CostTracker enforce it immediately.
 *  2. Re-opening books at boot (applyBookBudgets) must re-seed the tracker
 *     for a book that already has a costBudget on disk from a prior run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'net';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import { CostTracker } from '../../gateway/src/services/costs.js';
import { mountBooks } from '../../gateway/src/api/routes/books.routes.js';
import { applyBookBudgets } from '../../gateway/src/init/phase-05-research-skills.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', '# Default Author\n\ndefault soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice style');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeBookSvc(root: string): Promise<BookService> {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  return svc;
}

test('POST /api/books with costBudget wires the manifest into the RUNNING CostTracker (no direct setBookBudget call)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-budget-wiring-'));
  try {
    const books = await makeBookSvc(root);
    const costs = new CostTracker({});
    const lib = seedLibrary(root);
    await lib.loadAll();

    const gateway: any = {
      getProjectEngine: () => null,
      getServices: () => ({ books, costs, library: lib }),
    };

    const app = express();
    app.use(express.json());
    mountBooks(app as any, gateway, root);
    const server = app.listen(0);
    await new Promise<void>((r) => server.once('listening', () => r()));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const res = await fetch(`${url}/api/books`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Budgeted Book', author: 'default', voice: 'default', pipeline: 'novel-pipeline', costBudget: 1 }),
      });
      const body = await res.json();
      assert.equal(res.status, 200, JSON.stringify(body));
      const slug = body.book.slug;
      assert.equal(body.book.costBudget, 1);

      // Record spend directly on the tracker (recording spend is not the thing
      // under test — the wiring of the BUDGET is). No setBookBudget call here.
      costs.record('claude', 0, 1, slug);
      assert.equal(costs.wouldExceedBook(slug, 0), true, 'the route must have wired manifest.costBudget into the tracker');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('applyBookBudgets re-seeds a fresh CostTracker from every book manifest on boot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-budget-boot-'));
  try {
    const books = await makeBookSvc(root);
    // Create the book with costBudget set directly through BookService (as if
    // it were created on a prior boot) — no CostTracker involved yet.
    const manifest = await books.create({
      title: 'Boot Budget Book', author: 'default', voice: 'default', genre: null,
      pipeline: 'novel-pipeline', sections: [], costBudget: 2,
    });
    assert.equal(manifest.costBudget, 2);

    // Simulate a restart: a brand-new CostTracker with no in-memory budgets.
    const freshCosts = new CostTracker({});
    assert.equal(freshCosts.wouldExceedBook(manifest.slug, 0), false, 'fresh tracker has no budget yet');

    await applyBookBudgets(books, freshCosts);

    freshCosts.record('claude', 0, 2, manifest.slug);
    assert.equal(freshCosts.wouldExceedBook(manifest.slug, 0), true, 'boot re-apply must have seeded the budget from the manifest');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
