// tests/unit/spine-inject.test.ts
// H2 fix: the pre-draft canon-ledger injection + post-draft continuity
// detection, factored out of the studio /auto-execute route so the headless
// autonomous driver (startAndRunProject in index.ts) can reuse the exact same
// guarded, fail-soft logic instead of leaving Plan 3's continuity spine inert
// on that path. Mirrors the ConsistencyStore-backed test style already used
// by canon-inject.test.ts / continuity-check.test.ts (real store, tmpdir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import { buildContinuityInjection, detectPostDraftContinuity } from '../../gateway/src/services/consistency/spine-inject.js';
import type { LedgerFact } from '../../gateway/src/services/consistency/types.js';

function fact(p: Partial<LedgerFact>): LedgerFact {
  return {
    world: null, bookSlug: 'b1', entity: 'Anna', aliases: ['Anna'], attribute: 'eye_color',
    type: 'immutable', valueRaw: 'brown eyes', valueNorm: 'brown', storyTime: 0, storyElapsed: 0, timeLabel: null,
    transition: null, chapter: 'chapter-1', scene: 0, source: 'manuscript', evidence: 'brown eyes', canonical: true, ...p,
  };
}

/** Faithful fake AI: only "claude" is "registered" — any other provider id
 *  throws, exactly like the real aiRouter.complete's `providers.get(id)` ->
 *  undefined -> throw. Never a permissive stub. */
const REGISTERED = new Set(['claude']);
async function fakeAiComplete(r: any) {
  if (!REGISTERED.has(r?.provider)) throw new Error(`Provider ${r?.provider} not found`);
  return {
    text: JSON.stringify({
      scenes: [{ timeLabel: null, canonical: true }],
      facts: [{
        entity: 'Anna', aliases: ['Anna'], attribute: 'eye_color', type: 'immutable',
        valueRaw: "Anna's blue eyes", valueNorm: 'blue', scene: 0, transition: null,
        evidence: "Anna's blue eyes",
      }],
      knowledgeEvents: [],
    }),
  };
}
const fakeAiSelect = () => ({ id: 'claude' });

async function withStore(fn: (store: ConsistencyStore) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'spine-inject-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    await fn(store);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// ── buildContinuityInjection ──

test('buildContinuityInjection: returns the canon block for role=draft with an available store + seeded facts', async () => {
  await withStore(async (store) => {
    store.insertFacts([fact({ chapter: 'chapter-1', valueRaw: 'brown eyes', valueNorm: 'brown' })]);
    const block = buildContinuityInjection({ slug: 'b1', role: 'draft', chapterNumber: 2, store, world: null });
    assert.notEqual(block, '');
    assert.match(block, /CONTINUITY LEDGER/);
    assert.match(block, /Anna\.eye_color: brown eyes/);
  });
});

test('buildContinuityInjection: returns "" for a non-draft role even with facts seeded', async () => {
  await withStore(async (store) => {
    store.insertFacts([fact({ chapter: 'chapter-1' })]);
    const block = buildContinuityInjection({ slug: 'b1', role: 'improve', chapterNumber: 2, store, world: null });
    assert.equal(block, '');
  });
});

test('buildContinuityInjection: returns "" when the store is unavailable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spine-inject-unavail-'));
  try {
    const store = new ConsistencyStore(join(root, 'nonexistent'), join(root, 'db'));
    // Not initialized -> isAvailable() is false.
    const block = buildContinuityInjection({ slug: 'b1', role: 'draft', chapterNumber: 2, store, world: null });
    assert.equal(block, '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('buildContinuityInjection: returns "" when the store is absent (undefined)', () => {
  const block = buildContinuityInjection({ slug: 'b1', role: 'draft', chapterNumber: 2, store: undefined as any, world: null });
  assert.equal(block, '');
});

// ── detectPostDraftContinuity ──

test('detectPostDraftContinuity: persists the chapter\'s facts when skipPersist is false', async () => {
  await withStore(async (store) => {
    store.insertFacts([fact({ chapter: 'chapter-1', valueRaw: 'brown eyes', valueNorm: 'brown' })]);

    const { flags } = await detectPostDraftContinuity({
      slug: 'b1', role: 'draft', chapterNumber: 2, text: "Anna's blue eyes shone in the lamplight.",
      store, aiComplete: fakeAiComplete, aiSelect: fakeAiSelect, world: null, skipPersist: false,
    });

    assert.equal(flags.length, 1);
    assert.equal(flags[0].kind, 'contradiction');

    // The new fact was actually written to the ledger — proof persistence ran.
    const priors = store.priorFacts({ world: null, bookSlug: 'b1' }, 'Anna', 'eye_color');
    assert.ok(priors.some(p => p.chapter === 'chapter-2' && p.valueNorm === 'blue'));
  });
});

test('detectPostDraftContinuity: does NOT persist when skipPersist is true', async () => {
  await withStore(async (store) => {
    store.insertFacts([fact({ chapter: 'chapter-1', valueRaw: 'brown eyes', valueNorm: 'brown' })]);

    const { flags } = await detectPostDraftContinuity({
      slug: 'b1', role: 'draft', chapterNumber: 2, text: "Anna's blue eyes shone in the lamplight.",
      store, aiComplete: fakeAiComplete, aiSelect: fakeAiSelect, world: null, skipPersist: true,
    });

    // Detection still ran against the ledger as it stood...
    assert.equal(flags.length, 1);
    // ...but nothing was written for chapter-2.
    const priors = store.priorFacts({ world: null, bookSlug: 'b1' }, 'Anna', 'eye_color');
    assert.ok(!priors.some(p => p.chapter === 'chapter-2'));
  });
});

test('detectPostDraftContinuity: returns {flags:[]} for a non-draft role and never calls the AI', async () => {
  await withStore(async (store) => {
    store.insertFacts([fact({ chapter: 'chapter-1' })]);
    let called = false;
    const result = await detectPostDraftContinuity({
      slug: 'b1', role: 'editorial', chapterNumber: 2, text: 'Some prose.',
      store,
      aiComplete: async () => { called = true; throw new Error('must not be called'); },
      aiSelect: () => { called = true; throw new Error('must not be called'); },
      world: null, skipPersist: false,
    });
    assert.deepEqual(result.flags, []);
    assert.equal(called, false);
  });
});

test('detectPostDraftContinuity: returns {flags:[]} when the store is absent (undefined)', async () => {
  const result = await detectPostDraftContinuity({
    slug: 'b1', role: 'draft', chapterNumber: 2, text: 'Some prose.',
    store: undefined as any,
    aiComplete: async () => { throw new Error('must not be called'); },
    aiSelect: () => { throw new Error('must not be called'); },
    world: null, skipPersist: false,
  });
  assert.deepEqual(result.flags, []);
});
