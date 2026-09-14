// tests/unit/continuity-scale-alignment.test.ts
//
// The live per-chapter path (continuity-check.checkChapter) and the full audit
// (audit.runConsistencyAudit) both write into the SAME `knowledge`/`facts`
// tables, and check-engine compares rows across the two without knowing which
// writer produced them. These tests pin the three properties that has to hold:
//
//  1. ONE story-time scale — the audit bands a chapter at `chapterNumber * 1000`
//     exactly like the live path, so an audit-written row and a live-written row
//     for the same chapter are comparable (review FINDING 1).
//  2. An UNKNOWN elapsed clock never excuses a stateful contradiction — the live
//     path has no elapsed clock, so it must not read as "day zero" against an
//     audit prior whose cumulative clock has advanced (review FINDING 2).
//  3. Value normalisation happens on COMPARE, so rows already in the DB under an
//     older key stop fabricating "X here but canon establishes X" (FINDING 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import { runConsistencyAudit } from '../../gateway/src/services/consistency/audit.js';
import { checkChapter } from '../../gateway/src/services/consistency/continuity-check.js';
import {
  evaluateFact, CHAPTER_STORY_BAND, ELAPSED_UNKNOWN, ELAPSED_THRESHOLD,
} from '../../gateway/src/services/consistency/check-engine.js';
import type { LedgerFact } from '../../gateway/src/services/consistency/types.js';

function tmpRoot(name: string): string {
  return mkdtempSync(join(tmpdir(), `continuity-scale-${name}-`));
}

async function withStore(name: string, fn: (store: ConsistencyStore, root: string) => Promise<void>) {
  const root = tmpRoot(name);
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    await fn(store, root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

/** A complete LedgerFact with sensible defaults, as the ledger would hold it. */
function fact(p: Partial<LedgerFact> = {}): LedgerFact {
  return {
    world: null, bookSlug: 'b1', entity: 'Jay', aliases: ['Jay'],
    attribute: 'current_location', type: 'stateful',
    valueRaw: 'the office', valueNorm: 'the office',
    storyTime: 3 * CHAPTER_STORY_BAND, storyElapsed: 0, timeLabel: null, transition: null,
    chapter: 'chapter-3', scene: 0, source: 'manuscript',
    evidence: 'at the office', canonical: true, ...p,
  };
}

/** An aiComplete stub for checkChapter: returns the given facts/knowledge verbatim. */
function aiReturning(
  facts: Array<Record<string, unknown>>,
  knowledgeEvents: Array<Record<string, unknown>> = [],
  sceneCount = 1,
) {
  return async () => ({
    text: JSON.stringify({
      scenes: Array.from({ length: sceneCount }, () => ({ timeLabel: null, canonical: true })),
      facts, knowledgeEvents,
    }),
  });
}

const location = (valueNorm: string, valueRaw: string, scene = 0) => ({
  entity: 'Jay', aliases: ['Jay'], attribute: 'current_location', type: 'stateful',
  valueRaw, valueNorm, scene, transition: null, evidence: valueRaw,
});

const aiSelect = () => ({ id: 'gemini' });

// ---------------------------------------------------------------------------
// FINDING 1 — one story-time scale across both writers.
// ---------------------------------------------------------------------------

test('FINDING 1: the audit bands story times at chapter * 1000, like the live path', async () => {
  await withStore('audit-band', async (store, root) => {
    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    for (const n of [1, 2, 7]) writeFileSync(join(dataDir, `chapter-${n}.md`), `Chapter ${n} prose.`);

    const SCENES = 2;
    const extract = async (text: string, _k: any[], base: number) => ({
      scenes: Array.from({ length: SCENES }, () => ({ storyTime: base, timeLabel: null, canonical: true })),
      facts: Array.from({ length: SCENES }, (_, s) => ({
        entity: 'Jay', aliases: ['Jay'], attribute: `attr-${s}`, type: 'stateful' as const,
        valueRaw: `${text}-${s}`, valueNorm: `${text}-${s}`,
        storyTime: base + s, timeLabel: null, transition: null, scene: s,
        source: 'manuscript' as const, evidence: text,
      })),
    });
    const books = {
      dataDirOf: () => dataDir, worldDocsOf: () => null, worldbuildingOf: () => null,
      open: async () => ({ manifest: { pulledFrom: {} } }),
    };

    const report = await runConsistencyAudit('b1', { store, books, extract } as any);
    assert.equal(report.chaptersScanned, 3);

    const rows = store.factsForBook({ world: null, bookSlug: 'b1' });
    assert.equal(rows.length, 3 * SCENES);
    for (const r of rows) {
      const n = Number(r.chapter.replace('chapter-', ''));
      assert.equal(
        r.storyTime, n * CHAPTER_STORY_BAND + r.scene,
        `${r.chapter} scene ${r.scene}: audit must use the same band as the live path`,
      );
    }
  });
});

test('FINDING 1: canon seeding stays at base 0, before every chapter band', async () => {
  await withStore('canon-base', async (store, root) => {
    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'chapter-1.md'), 'Jay is at the office.');

    const extract = async (text: string, _k: any[], base: number) => ({
      scenes: [{ storyTime: base, timeLabel: null, canonical: true }],
      facts: [{
        entity: 'Jay', aliases: ['Jay'], attribute: 'home_city', type: 'immutable' as const,
        valueRaw: text.includes('canon') ? 'Boston' : 'Boston', valueNorm: 'boston',
        storyTime: base, timeLabel: null, transition: null, scene: 0,
        source: 'manuscript' as const, evidence: text.slice(0, 30),
      }],
    });
    const books = {
      dataDirOf: () => dataDir, worldDocsOf: () => null,
      worldbuildingOf: () => 'canon: Jay lives in Boston.',
      open: async () => ({ manifest: { pulledFrom: {} } }),
    };

    await runConsistencyAudit('b1', { store, books, extract } as any);
    const rows = store.factsForBook({ world: null, bookSlug: 'b1' });
    const canon = rows.filter(r => r.source === 'canon');
    assert.ok(canon.length > 0, 'canon should be seeded');
    for (const c of canon) assert.equal(c.storyTime, 0, 'canon precedes every chapter band');
  });
});

test('FINDING 1: an audit-written acquire in a LATER chapter still fails a live use in an EARLIER one', async () => {
  await withStore('cross-writer-knowledge', async (store, root) => {
    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    for (let n = 1; n <= 12; n++) writeFileSync(join(dataDir, `chapter-${n}.md`), `Chapter ${n} prose.`);

    // Only chapter 12 contains the discovery; nothing else produces events.
    const extract = async (text: string, _k: any[], base: number) => ({
      scenes: [{ storyTime: base, timeLabel: null, canonical: true }],
      facts: [],
      knowledge: /Chapter 12 /.test(text) ? [{
        knower: 'Jay', factKey: 'Mira\0secret\0the affair',
        kind: 'acquire' as const, source: 'told' as const,
        storyTime: base, scene: 0, canonical: true, evidence: 'Mira told him',
      }] : [],
    });
    const books = {
      dataDirOf: () => dataDir, worldDocsOf: () => null, worldbuildingOf: () => null,
      open: async () => ({ manifest: { pulledFrom: {} } }),
    };
    await runConsistencyAudit('b1', { store, books, extract } as any);

    // The live path now drafts chapter 3, in which Jay references the secret he
    // does not learn until chapter 12 — a used-before-learned violation.
    const result = await checkChapter({
      slug: 'b1', chapterNumber: 3, text: 'Jay brought up the affair.', store,
      aiComplete: aiReturning([], [{
        knower: 'Jay', factEntity: 'Mira', factAttribute: 'secret', factValueNorm: 'the affair',
        kind: 'use', source: 'reference', scene: 0, evidence: 'Jay brought up the affair',
      }]),
      aiSelect,
    });

    assert.ok(
      result.flags.some(f => f.kind === 'knowledge'),
      `used-before-learned must survive the audit/live scale mix, got: ${JSON.stringify(result.flags)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// FINDING 2 — an unknown elapsed clock must not excuse anything.
// ---------------------------------------------------------------------------

test('FINDING 2: an unknown elapsed clock never excuses a differing prior', () => {
  const live = fact({ valueNorm: 'the rooftop', valueRaw: 'the rooftop', storyElapsed: ELAPSED_UNKNOWN });
  const auditPrior = fact({
    chapter: 'chapter-12', storyTime: 12 * CHAPTER_STORY_BAND,
    valueNorm: 'the office', valueRaw: 'the office', storyElapsed: ELAPSED_THRESHOLD,
  });

  const finding = evaluateFact(live, [auditPrior]);
  assert.ok(finding, 'a real stateful contradiction must not be excused when elapsed is unknown');
  assert.equal(finding!.category, 'continuity');
});

test('FINDING 2: two KNOWN elapsed clocks a threshold apart are still a legitimate reset', () => {
  const later = fact({ valueNorm: 'the rooftop', valueRaw: 'the rooftop', storyElapsed: 40 });
  const prior = fact({
    chapter: 'chapter-1', storyTime: CHAPTER_STORY_BAND,
    valueNorm: 'the office', valueRaw: 'the office', storyElapsed: 5,
  });
  assert.equal(evaluateFact(later, [prior]), null, 'an explicit long jump still excuses the change');
});

test('FINDING 2: the live path records elapsed as UNKNOWN, not as day zero', async () => {
  await withStore('live-elapsed', async (store) => {
    await checkChapter({
      slug: 'b1', chapterNumber: 4, text: 'Jay stood on the rooftop.', store,
      aiComplete: aiReturning([location('the rooftop', 'the rooftop')]), aiSelect,
    });
    const rows = store.factsForBook({ world: null, bookSlug: 'b1' });
    assert.equal(rows.length, 1);
    assert.equal(
      rows[0].storyElapsed, ELAPSED_UNKNOWN,
      'the live path has no elapsed clock — 0 would read as a real "day zero"',
    );
  });
});

test('FINDING 2 (production shape): an audit-written prior + a live fact still raises a flag', async () => {
  await withStore('mixed-writers', async (store) => {
    // Exactly what the DB looks like after a full audit followed by a re-draft:
    // an audit row on the chapter band with a NON-ZERO cumulative elapsed clock.
    store.insertFacts([fact({
      chapter: 'chapter-1', scene: 0, storyTime: CHAPTER_STORY_BAND,
      storyElapsed: ELAPSED_THRESHOLD + 5,
      valueRaw: 'the office', valueNorm: 'the office',
    })]);

    const result = await checkChapter({
      slug: 'b1', chapterNumber: 2, text: 'Jay stood on the rooftop.', store,
      aiComplete: aiReturning([location('the rooftop', 'the rooftop')]), aiSelect,
    });

    assert.ok(
      result.flags.some(f => f.kind === 'timeline' || f.kind === 'contradiction'),
      `the audit prior's elapsed clock must not silence the live check, got: ${JSON.stringify(result.flags)}`,
    );
  });
});

// ---------------------------------------------------------------------------
// FINDING 3 — normalise on compare, so pre-existing rows are covered.
// ---------------------------------------------------------------------------

test('FINDING 3: a stale un-normalised prior no longer contradicts an identical value', () => {
  const now = fact({ valueRaw: 'the sixth floor office', valueNorm: 'the sixth floor office' });
  // A row written before write-time normalisation existed: same value, old key.
  const stale = fact({
    chapter: 'CANON', source: 'canon', storyTime: 0,
    valueRaw: 'the sixth floor office', valueNorm: 'The sixth floor office.',
  });
  assert.equal(
    evaluateFact(now, [stale]), null,
    'normalisation must apply on COMPARE so rows already in the DB are covered',
  );
});

test('FINDING 3: a genuinely different value is still reported', () => {
  const now = fact({ valueRaw: 'the rooftop', valueNorm: 'the rooftop' });
  const canon = fact({
    chapter: 'CANON', source: 'canon', storyTime: 0,
    valueRaw: 'the sixth floor office', valueNorm: 'The sixth floor office.',
  });
  const finding = evaluateFact(now, [canon]);
  assert.ok(finding, 'a real divergence must still fire');
  assert.equal(finding!.category, 'canon-divergence');
});

test('FINDING 3: a stale canon row in the ledger no longer flags the live path', async () => {
  await withStore('stale-canon', async (store) => {
    store.insertFacts([fact({
      world: null, bookSlug: 'b1', chapter: 'CANON', source: 'canon', storyTime: 0, storyElapsed: 0,
      valueRaw: 'the sixth floor office', valueNorm: 'The sixth floor office.',
      sourceLabel: 'Book canon',
    })]);

    const result = await checkChapter({
      slug: 'b1', chapterNumber: 5, text: 'Jay crossed the sixth floor office.', store,
      aiComplete: aiReturning([location('the sixth floor office', 'the sixth floor office')]),
      aiSelect,
    });

    assert.deepEqual(
      result.flags.filter(f => /canon establishes/.test(f.detail)), [],
      `a hash-gated stale canon row must not fabricate a divergence: ${JSON.stringify(result.flags)}`,
    );
  });
});
