/**
 * Flagship Plan 3, Task 3: seed the consistency ledger from a completed
 * bible-role step. Mirrors the pattern in book-phase-hook.test.ts /
 * project-step-hook.test.ts — the EXACT hook body from
 * init/phase-06-content.ts is copied here, driving a real ProjectEngine +
 * real ConsistencyStore (temp db) so a wiring regression is caught here, not
 * only in prod.
 *
 * Run: node --import tsx --test tests/unit/consistency-seed-bible-hook.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import { ConsistencyJobRegistry } from '../../gateway/src/services/consistency/job-registry.js';
import { extractChapterFacts } from '../../gateway/src/services/consistency/extractor.js';
import { CONSISTENCY_PROVIDERS } from '../../gateway/src/services/consistency/model-selection.js';
import type { LedgerFact } from '../../gateway/src/services/consistency/types.js';

const flush = () => new Promise<void>((r) => setImmediate(r));

const PIPELINE = {
  schemaVersion: 1, name: 'book-bible', label: 'Book Bible', description: 'd', dynamic: false,
  steps: [
    { label: 'Character Bible', taskType: 'book_bible', promptTemplate: 'a', role: 'bible' },
    { label: 'Outline',         taskType: 'outline',    promptTemplate: 'b', role: 'outline' },
  ],
} as const;

/** M1: two consecutive bible-role steps — the shape that exposed the coarse
 *  full-audit mutex dropping a later step's canon. */
const TWO_BIBLE_PIPELINE = {
  schemaVersion: 1, name: 'book-bible', label: 'Book Bible', description: 'd', dynamic: false,
  steps: [
    { label: 'Character Bible', taskType: 'book_bible', promptTemplate: 'a', role: 'bible' },
    { label: 'World Bible',     taskType: 'book_bible', promptTemplate: 'b', role: 'bible' },
    { label: 'Outline',         taskType: 'outline',    promptTemplate: 'c', role: 'outline' },
  ],
} as const;

function makeEngine(pipeline: any = PIPELINE): ProjectEngine {
  const e = new ProjectEngine(undefined, join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
  e.setPipelineResolver((name) => (name === 'book-bible' ? pipeline : null));
  return e;
}

/** The exact hook body from init/phase-06-content.ts (Task 3 + M1 fix): a
 *  per-book promise chain serializes consecutive bible-role seeds among
 *  themselves, only skipping (not slot-contending) when a full audit is
 *  already running for the book. */
function registerBibleSeedHook(e: ProjectEngine, gw: any) {
  const bibleSeedChains = new Map<string, Promise<void>>();
  e.onStepCompleted(async (project: any, completedStep: any) => {
    if (!gw.consistencyStore?.isAvailable?.() || !project?.bookSlug || completedStep?.role !== 'bible') return;
    const result = String(completedStep?.result ?? '').trim();
    if (!result) return;
    const slug = project.bookSlug;

    const seedOne = async () => {
      if (gw.consistencyJobs.isRunning(slug)) return;
      try {
        const manifest = (await gw.books?.open?.(slug).catch(() => null))?.manifest;
        const world = manifest?.pulledFrom?.world?.name ?? null;
        const extracted = await extractChapterFacts(
          {
            ai: {
              complete: async (r: any) => {
                const resp = await gw.aiRouter.complete(r);
                try { gw.costs.record(resp.provider ?? r.provider, resp.tokensUsed, resp.estimatedCost, slug); } catch { /* best-effort */ }
                return resp;
              },
              select: (t: string, pref?: string) => {
                const p = gw.aiRouter.selectProvider(t, pref);
                if (!(CONSISTENCY_PROVIDERS as readonly string[]).includes(p.id)) {
                  throw new Error(`Consistency requires a large-context model; "${p.id}" is not supported.`);
                }
                return p;
              },
            },
          },
          result, [], 0,
        );
        const facts: LedgerFact[] = extracted.facts.map(f => ({
          ...f, world, bookSlug: slug, chapter: 'CANON', source: 'canon',
          sourceLabel: `Bible: ${completedStep.label}`, canonical: f.canonical !== false, storyElapsed: 0,
        }));
        gw.consistencyStore.insertFacts(facts);
      } catch { /* fail-soft: seeding must never break the pipeline */ }
    };

    const prior = bibleSeedChains.get(slug) ?? Promise.resolve();
    const chained = prior.then(seedOne, seedOne);
    bibleSeedChains.set(slug, chained);
    await chained;
  });
}

function fakeGateway(store: ConsistencyStore, aiComplete: (r: any) => Promise<any>) {
  return {
    consistencyStore: store,
    consistencyJobs: new ConsistencyJobRegistry(),
    aiRouter: { complete: aiComplete, selectProvider: () => ({ id: 'gemini' }) },
    costs: { record: () => {} },
    books: { open: async () => ({ manifest: { pulledFrom: {} } }) },
  };
}

test('a completed bible-role step seeds canon facts into the ledger', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bible-seed-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    const aiComplete = async () => ({
      text: JSON.stringify({
        scenes: [{ timeLabel: null, canonical: true }],
        facts: [{
          entity: 'Anna', aliases: ['Anna'], attribute: 'eye_color', type: 'immutable',
          valueRaw: 'brown eyes', valueNorm: 'brown', scene: 0, transition: null, evidence: 'brown eyes',
        }],
        knowledgeEvents: [],
      }),
      provider: 'gemini', tokensUsed: 100, estimatedCost: 0.001,
    });

    const e = makeEngine();
    const gw = fakeGateway(store, aiComplete);
    registerBibleSeedHook(e, gw);

    const p = e.createProjectResolved('book-bible' as any, 'My Book — Bible', 'desc', { bookSlug: 'my-book' } as any);
    e.startProject(p.id);
    e.completeStep(p.id, p.steps[0].id, 'Anna has brown eyes and works at the hospital.');
    await flush();

    const priors = store.priorFacts({ world: null, bookSlug: 'my-book' }, 'Anna', 'eye_color');
    assert.equal(priors.length, 1);
    assert.equal(priors[0].valueNorm, 'brown');
    assert.equal(priors[0].source, 'canon');
    clearTimeout((e as any).saveDebounceTimer);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a completed non-bible step (e.g. outline) does not seed the ledger', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bible-seed-skip-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    let calls = 0;
    const aiComplete = async () => { calls++; return { text: '{}' }; };

    const e = makeEngine();
    const gw = fakeGateway(store, aiComplete);
    registerBibleSeedHook(e, gw);

    const p = e.createProjectResolved('book-bible' as any, 'My Book — Bible', 'desc', { bookSlug: 'my-book' } as any);
    e.startProject(p.id);
    e.completeStep(p.id, p.steps[0].id, ''); // empty bible result — nothing to seed
    e.completeStep(p.id, p.steps[1].id, 'Outline text');
    await flush();

    assert.equal(calls, 0, 'no extraction call for an empty bible result or a non-bible step');
    clearTimeout((e as any).saveDebounceTimer);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('skips (fail-soft) when a consistency audit is already running for the book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bible-seed-busy-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    let calls = 0;
    const aiComplete = async () => { calls++; return { text: '{}' }; };

    const e = makeEngine();
    const gw = fakeGateway(store, aiComplete);
    gw.consistencyJobs.start('my-book'); // simulate an in-flight full audit
    registerBibleSeedHook(e, gw);

    const p = e.createProjectResolved('book-bible' as any, 'My Book — Bible', 'desc', { bookSlug: 'my-book' } as any);
    e.startProject(p.id);
    e.completeStep(p.id, p.steps[0].id, 'Anna has brown eyes.');
    await flush();

    assert.equal(calls, 0);
    assert.equal(store.priorFacts({ world: null, bookSlug: 'my-book' }, 'Anna', 'eye_color').length, 0);
    clearTimeout((e as any).saveDebounceTimer);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// M1 regression: the pipeline runs MULTIPLE consecutive bible-role steps.
// Gating each seed on the single per-book full-audit consistencyJobs slot
// meant the second step's `start()` call returned false (the first step's
// extraction was still in flight) and its canon was silently dropped. The
// first extraction is deliberately slow so the second step's hook fires
// while the first is still awaited — the exact race this fix serializes
// instead of dropping.
test('M1: two bible steps completing in quick succession both seed their facts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bible-seed-race-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    const aiComplete = async (r: any) => {
      const content = String(r?.messages?.[0]?.content ?? '');
      const isFirst = content.includes('Anna has brown eyes');
      if (isFirst) await new Promise((res) => setTimeout(res, 30));
      const entity = isFirst ? 'Anna' : 'Marcus';
      const attribute = isFirst ? 'eye_color' : 'occupation';
      const value = isFirst ? 'brown' : 'blacksmith';
      return {
        text: JSON.stringify({
          scenes: [{ timeLabel: null, canonical: true }],
          facts: [{
            entity, aliases: [entity], attribute, type: 'immutable',
            valueRaw: value, valueNorm: value, scene: 0, transition: null, evidence: value,
          }],
          knowledgeEvents: [],
        }),
        provider: 'gemini', tokensUsed: 100, estimatedCost: 0.001,
      };
    };

    const e = makeEngine(TWO_BIBLE_PIPELINE);
    const gw = fakeGateway(store, aiComplete);
    registerBibleSeedHook(e, gw);

    const p = e.createProjectResolved('book-bible' as any, 'My Book — Bible', 'desc', { bookSlug: 'my-book' } as any);
    e.startProject(p.id);
    e.completeStep(p.id, p.steps[0].id, 'Anna has brown eyes and works at the hospital.');
    e.completeStep(p.id, p.steps[1].id, 'Marcus is a blacksmith in town.');
    await new Promise((res) => setTimeout(res, 100)); // let the chained seeds finish

    const annaFacts = store.priorFacts({ world: null, bookSlug: 'my-book' }, 'Anna', 'eye_color');
    const marcusFacts = store.priorFacts({ world: null, bookSlug: 'my-book' }, 'Marcus', 'occupation');
    assert.equal(annaFacts.length, 1, 'first bible step canon seeded');
    assert.equal(marcusFacts.length, 1, 'second bible step canon NOT dropped by the first step still being in flight');
    clearTimeout((e as any).saveDebounceTimer);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
