/**
 * Restart-hydration test for gateway/src/services/context-engine.ts (C4 from
 * docs/BOOK-GENERATION-REVIEW-2026-07-10.md).
 *
 * The engine persists per-project context to workspace/context/<id>.json, but
 * the synchronous generation-path getters (getRelevantContext / getSummaries /
 * getEntities) read ONLY the in-memory map. After a gateway restart the map is
 * empty, so a resumed book's next chapter was generated with zero story context
 * even though the disk file held everything.
 *
 * Fix under test: `ensureLoaded(projectId)` hydrates the map from disk when it
 * has no entry, fail-soft. Network-free; contexts are seeded through the real
 * code paths (loadContext + persistContext), never hand-written JSON.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ContextEngine, type ProjectContext } from '../../gateway/src/services/context-engine.js';

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'ctx-restart-'));
}

function summary(over: Partial<ProjectContext['summaries'][number]>): ProjectContext['summaries'][number] {
  return {
    chapterId: 'c1', chapterNumber: 1, title: 'T', summary: 'S',
    wordCount: 100, characters: [], locations: [], timelineMarker: '',
    plotThreads: [], endingState: 'end', ...over,
  };
}

function entity(over: Partial<ProjectContext['entities'][number]>): ProjectContext['entities'][number] {
  return {
    name: 'X', type: 'character', aliases: [], description: 'd',
    firstAppearance: 'c1', lastSeen: 'c1', attributes: {}, changes: [], ...over,
  };
}

test('ensureLoaded: a fresh instance hydrates persisted context from disk (restart survival)', async () => {
  const dir = tempWorkspace();
  try {
    // Instance A — populate via the real code paths and persist to disk.
    const a = new ContextEngine(dir);
    const ctx = await a.loadContext('proj-1');
    ctx.summaries.push(summary({
      chapterId: 'c1', title: 'The Lighthouse',
      summary: 'Marlow finds the hidden ledger in the lighthouse.',
      endingState: 'The ledger is open on the table.',
    }));
    ctx.entities.push(entity({ name: 'Marlow', description: 'the detective' }));
    await a.persistContext('proj-1');
    assert.ok(existsSync(join(dir, 'context', 'proj-1.json')), 'context file persisted');

    // Instance B — a FRESH engine over the same workspace (simulated restart).
    const b = new ContextEngine(dir);

    // Pins the bug: cold cache → the generation-path getter returns nothing
    // even though the disk file holds everything.
    assert.equal(b.getRelevantContext('proj-1', 'c2', 'Marlow returns', 12000), '');
    assert.equal(b.getSummaries('proj-1').length, 0);

    // The fix: ensureLoaded hydrates from disk, then the getters see the data.
    await b.ensureLoaded('proj-1');
    const out = b.getRelevantContext('proj-1', 'c2', 'Marlow returns', 12000);
    assert.ok(out.length > 0, 'context is non-empty after ensureLoaded');
    assert.match(out, /Previous Chapter: The Lighthouse/);
    assert.match(out, /The ledger is open on the table\./);
    assert.match(out, /\*\*Marlow\*\*: the detective/);
    assert.equal(b.getSummaries('proj-1').length, 1);
    assert.equal(b.getEntities('proj-1').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureLoaded: no disk file is harmless (fresh-project path unchanged)', async () => {
  const dir = tempWorkspace();
  try {
    const e = new ContextEngine(dir);
    await e.ensureLoaded('brand-new');
    assert.equal(e.getRelevantContext('brand-new', 'c1', 'anything', 5000), '');
    assert.deepEqual(e.getSummaries('brand-new'), []);
    assert.deepEqual(e.getEntities('brand-new'), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureLoaded: a corrupt disk file does not throw into generation (fail-soft)', async () => {
  const dir = tempWorkspace();
  try {
    mkdirSync(join(dir, 'context'), { recursive: true });
    writeFileSync(join(dir, 'context', 'proj-bad.json'), '{not valid json');
    const e = new ContextEngine(dir);
    // Capture the fail-soft warning instead of letting it hit stdout — the
    // node:test runner's IPC parser can choke on interleaved console output —
    // and assert the failure is logged, not swallowed silently.
    const logged: string[] = [];
    const realLog = console.log;
    console.log = (...args: unknown[]) => { logged.push(args.join(' ')); };
    try {
      await e.ensureLoaded('proj-bad'); // must not throw
    } finally {
      console.log = realLog;
    }
    assert.equal(e.getRelevantContext('proj-bad', 'c1', 'anything', 5000), '');
    assert.ok(logged.some(l => l.includes('failed to load context for proj-bad')), 'warning is logged');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
