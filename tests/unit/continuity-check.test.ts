// tests/unit/continuity-check.test.ts
// Flagship Plan 3, Task 2: post-draft continuity detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import { checkChapter, aggregateActContinuity } from '../../gateway/src/services/consistency/continuity-check.js';
import type { LedgerFact } from '../../gateway/src/services/consistency/types.js';

function fact(p: Partial<LedgerFact>): LedgerFact {
  return {
    world: null, bookSlug: 'b1', entity: 'Anna', aliases: ['Anna'], attribute: 'eye_color',
    type: 'immutable', valueRaw: 'brown eyes', valueNorm: 'brown', storyTime: 0, storyElapsed: 0, timeLabel: null,
    transition: null, chapter: 'chapter-1', scene: 0, source: 'manuscript', evidence: 'brown eyes', canonical: true, ...p,
  };
}

test('fail-soft: store unavailable -> {flags: []}, never throws', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-check-unavail-'));
  try {
    const store = new ConsistencyStore(join(root, 'nonexistent-dir-that-forces-nothing'), join(root, 'db'));
    // Do NOT initialize — store.isAvailable() is false without initialize().
    const result = await checkChapter({
      slug: 'b1', chapterNumber: 2, text: 'Anything.', store,
      aiComplete: async () => { throw new Error('must not be called'); },
      aiSelect: () => { throw new Error('must not be called'); },
    });
    assert.deepEqual(result.flags, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// C1 (CRITICAL) regression test: production wired checkChapter's extractor with
// a hardcoded `select: () => ({ id: 'default' })` stub. The real router has no
// provider registered under the id "default" — `providers.get('default')`
// returns undefined and `aiRouter.complete` throws "Provider default not
// found". checkChapter's own extraction try/catch swallowed that throw and
// always returned `{flags: []}`, so detection was permanently inert AND the
// chapter's facts were never persisted (the early return happens before the
// insert block). This fake mirrors that real failure mode: it throws for any
// provider id that isn't actually "registered", so a caller that still passes
// a stub id (instead of routing through the real aiSelect) gets caught by the
// same swallowing catch and fails this assertion. On the OLD hardcoded-'default'
// code this test fails (result.flags.length === 0, no persisted fact); after
// wiring aiSelect through to a real selector it passes.
test('checkChapter routes extraction through a real provider selector, not a hardcoded stub id (C1)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-check-real-selector-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    store.insertFacts([fact({ chapter: 'chapter-1', valueRaw: 'brown eyes', valueNorm: 'brown' })]);

    // Only "gemini" is a "registered" provider in this fake router — any other
    // id (e.g. the old hardcoded "default" stub) throws, exactly like the real
    // aiRouter.complete's `providers.get(id)` -> undefined -> throw.
    const REGISTERED = new Set(['gemini']);
    const aiComplete = async (r: any) => {
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
    };
    const aiSelect = () => ({ id: 'gemini' });

    const result = await checkChapter({
      slug: 'b1', chapterNumber: 2, text: "Anna's blue eyes shone in the lamplight.",
      store, aiComplete, aiSelect,
    });

    assert.equal(result.flags.length, 1);
    assert.equal(result.flags[0].kind, 'contradiction');

    // The new fact was actually persisted so a later chapter sees it as a prior
    // — proof extraction really ran, not just that flags happened to be non-empty.
    const priors = store.priorFacts({ world: null, bookSlug: 'b1' }, 'Anna', 'eye_color');
    assert.ok(priors.some(p => p.chapter === 'chapter-2' && p.valueNorm === 'blue'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ledger says Anna has brown eyes; chapter text says blue eyes -> a contradiction flag', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-check-contra-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    store.insertFacts([fact({ chapter: 'chapter-1', valueRaw: 'brown eyes', valueNorm: 'brown' })]);

    const aiComplete = async () => ({
      text: JSON.stringify({
        scenes: [{ timeLabel: null, canonical: true }],
        facts: [{
          entity: 'Anna', aliases: ['Anna'], attribute: 'eye_color', type: 'immutable',
          valueRaw: "Anna's blue eyes", valueNorm: 'blue', scene: 0, transition: null,
          evidence: "Anna's blue eyes",
        }],
        knowledgeEvents: [],
      }),
    });

    const result = await checkChapter({
      slug: 'b1', chapterNumber: 2, text: "Anna's blue eyes shone in the lamplight.",
      store, aiComplete, aiSelect: () => ({ id: 'gemini' }),
    });
    assert.equal(result.flags.length, 1);
    assert.equal(result.flags[0].kind, 'contradiction');
    assert.match(result.flags[0].detail, /eye_color/);

    // The new fact was persisted so a later chapter sees it as a prior.
    const priors = store.priorFacts({ world: null, bookSlug: 'b1' }, 'Anna', 'eye_color');
    assert.ok(priors.some(p => p.chapter === 'chapter-2' && p.valueNorm === 'blue'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a character acts on knowledge they never acquired -> a knowledge flag', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-check-know-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    const aiComplete = async () => ({
      text: JSON.stringify({
        scenes: [{ timeLabel: null, canonical: true }],
        facts: [],
        knowledgeEvents: [{
          knower: 'Bob', factEntity: 'Council', factAttribute: 'plan', factValueNorm: 'attack_at_dawn',
          kind: 'use', source: 'act_on', scene: 0, evidence: 'Bob attacked at dawn, exactly per the secret plan',
        }],
      }),
    });

    const result = await checkChapter({
      slug: 'b1', chapterNumber: 3, text: 'Bob attacked at dawn, exactly per the secret plan.',
      store, aiComplete, aiSelect: () => ({ id: 'gemini' }),
    });
    assert.equal(result.flags.length, 1);
    assert.equal(result.flags[0].kind, 'knowledge');
    assert.match(result.flags[0].detail, /Bob/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a chapter consistent with the ledger produces no flags', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-check-clean-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    store.insertFacts([fact({ chapter: 'chapter-1', valueRaw: 'brown eyes', valueNorm: 'brown' })]);

    const aiComplete = async () => ({
      text: JSON.stringify({
        scenes: [{ timeLabel: null, canonical: true }],
        facts: [{
          entity: 'Anna', aliases: ['Anna'], attribute: 'eye_color', type: 'immutable',
          valueRaw: 'brown eyes', valueNorm: 'brown', scene: 0, transition: null, evidence: 'brown eyes',
        }],
        knowledgeEvents: [],
      }),
    });

    const result = await checkChapter({
      slug: 'b1', chapterNumber: 2, text: 'Her brown eyes.', store, aiComplete,
      aiSelect: () => ({ id: 'gemini' }),
    });
    assert.deepEqual(result.flags, []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// M3: persistence must be skippable (fail-soft) when a full/import audit is
// in flight for this book, so its clearBookFacts()/clearBookKnowledge() +
// reinsert doesn't race this chapter's own clear+insert. Detection still runs
// — only the write-back is suppressed.
test('skipPersist: detection still runs, but no facts are written to the ledger', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-check-skip-persist-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    store.insertFacts([fact({ chapter: 'chapter-1', valueRaw: 'brown eyes', valueNorm: 'brown' })]);

    const aiComplete = async () => ({
      text: JSON.stringify({
        scenes: [{ timeLabel: null, canonical: true }],
        facts: [{
          entity: 'Anna', aliases: ['Anna'], attribute: 'eye_color', type: 'immutable',
          valueRaw: "Anna's blue eyes", valueNorm: 'blue', scene: 0, transition: null,
          evidence: "Anna's blue eyes",
        }],
        knowledgeEvents: [],
      }),
    });

    const result = await checkChapter({
      slug: 'b1', chapterNumber: 2, text: "Anna's blue eyes shone in the lamplight.",
      store, aiComplete, aiSelect: () => ({ id: 'gemini' }), skipPersist: true,
    });

    // Detection ran and found the contradiction against the ledger as it stood.
    assert.equal(result.flags.length, 1);
    assert.equal(result.flags[0].kind, 'contradiction');

    // But the chapter's own fact was NOT written — no chapter-2 row exists.
    const priors = store.priorFacts({ world: null, bookSlug: 'b1' }, 'Anna', 'eye_color');
    assert.ok(!priors.some(p => p.chapter === 'chapter-2'), 'no persisted chapter-2 fact while skipPersist is set');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// L1: clearChapterKnowledge must be unconditional. A chapter that previously
// had a knowledge event, then is re-drafted with none, must not leave a stale
// knowledge row behind.
test('re-drafting a chapter that no longer has knowledge events clears its stale knowledge rows (L1)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'continuity-check-knowledge-clear-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    // First pass: chapter 3 has a knowledge event -> persisted.
    const withKnowledge = async () => ({
      text: JSON.stringify({
        scenes: [{ timeLabel: null, canonical: true }],
        facts: [],
        knowledgeEvents: [{
          knower: 'Bob', factEntity: 'Council', factAttribute: 'plan', factValueNorm: 'attack_at_dawn',
          kind: 'use', source: 'act_on', scene: 0, evidence: 'Bob attacked at dawn, exactly per the secret plan',
        }],
      }),
    });
    await checkChapter({
      slug: 'b1', chapterNumber: 3, text: 'Bob attacked at dawn, exactly per the secret plan.',
      store, aiComplete: withKnowledge, aiSelect: () => ({ id: 'gemini' }),
    });
    assert.equal(store.knowledgeForBook({ world: null, bookSlug: 'b1' }).length, 1);

    // Re-draft: the same chapter is rewritten with no knowledge events at all.
    const withoutKnowledge = async () => ({
      text: JSON.stringify({ scenes: [{ timeLabel: null, canonical: true }], facts: [], knowledgeEvents: [] }),
    });
    await checkChapter({
      slug: 'b1', chapterNumber: 3, text: 'Bob just went to the market.',
      store, aiComplete: withoutKnowledge, aiSelect: () => ({ id: 'gemini' }),
    });

    assert.equal(store.knowledgeForBook({ world: null, bookSlug: 'b1' }).length, 0, 'stale knowledge row cleared on redraft');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Flagship Plan 3, Task 5: act-boundary mini-audit — pure aggregation (no gate
// exists yet to wire it into; Plan 5 will attach this to its gate payload).
test('aggregateActContinuity: totals + byKind + only flagged chapters, in order', () => {
  const summary = aggregateActContinuity([
    { chapterNumber: 1, flags: [] },
    { chapterNumber: 2, flags: [{ kind: 'contradiction', detail: 'a' }, { kind: 'knowledge', detail: 'b' }] },
    { chapterNumber: 3, flags: [] },
    { chapterNumber: 4, flags: [{ kind: 'timeline', detail: 'c' }] },
  ]);
  assert.equal(summary.totalFlags, 3);
  assert.deepEqual(summary.byKind, { contradiction: 1, timeline: 1, knowledge: 1, red_herring: 0 });
  assert.deepEqual(summary.chapters.map(c => c.chapterNumber), [2, 4]);
});

test('aggregateActContinuity: no flags across the act -> zeroed summary, empty chapters', () => {
  const summary = aggregateActContinuity([
    { chapterNumber: 1, flags: [] },
    { chapterNumber: 2, flags: [] },
  ]);
  assert.equal(summary.totalFlags, 0);
  assert.deepEqual(summary.chapters, []);
});
