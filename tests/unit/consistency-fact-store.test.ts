// tests/unit/consistency-fact-store.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import type { LedgerFact, KnowledgeEvent } from '../../gateway/src/services/consistency/types.js';

function ke(p: Partial<KnowledgeEvent>): KnowledgeEvent {
  return {
    world: null, bookSlug: 'b1', knower: 'Elena', factKey: 'Marsh killer_identity guilty',
    kind: 'use', source: 'reference', storyTime: 3, chapter: 'ch4', scene: 0, canonical: true,
    evidence: 'Elena said Marsh did it', ...p,
  };
}

function fact(p: Partial<LedgerFact>): LedgerFact {
  return {
    world: null, bookSlug: 'b1', entity: 'John', aliases: ['John'], attribute: 'eye_color',
    type: 'immutable', valueRaw: 'blue', valueNorm: 'blue', storyTime: 0, storyElapsed: 0, timeLabel: null,
    transition: null, chapter: 'ch1', scene: 0, source: 'manuscript', evidence: 'his blue eyes', canonical: true, ...p,
  };
}

test('insert + priorFacts returns scoped rows newest-first; idempotent rebuild', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-store-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    s.insertFacts([
      fact({ chapter: 'ch1', storyTime: 0, valueNorm: 'blue' }),
      fact({ chapter: 'ch10', storyTime: 9, valueNorm: 'green' }),
      fact({ bookSlug: 'OTHER', chapter: 'x', valueNorm: 'red' }), // different book — must not leak
      fact({ world: 'w1', bookSlug: null, source: 'canon', storyTime: -1, valueNorm: 'blue' }), // world canon
    ]);

    const priors = s.priorFacts({ world: 'w1', bookSlug: 'b1' }, 'John', 'eye_color');
    // b1 rows + w1 canon row; NOT the OTHER book row
    assert.equal(priors.length, 3);
    assert.equal(priors[0].storyTime >= priors[1].storyTime, true, 'newest-first');
    assert.ok(priors.some(p => p.source === 'canon'));
    assert.ok(!priors.some(p => p.bookSlug === 'OTHER'));

    // Idempotent rebuild: clearing b1 leaves canon + OTHER intact.
    s.clearBookFacts('b1');
    assert.equal(s.priorFacts({ world: 'w1', bookSlug: 'b1' }, 'John', 'eye_color').length, 1); // only canon
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('priorFacts does not leak another worldless book\'s book-keyed canon (H1)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-h1-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    // Two worldless books, same entity/attribute canon, different values.
    s.insertFacts([
      fact({ bookSlug: 'b1', world: null, source: 'canon', chapter: 'CANON', storyTime: -1, valueNorm: 'blue' }),
      fact({ bookSlug: 'b2', world: null, source: 'canon', chapter: 'CANON', storyTime: -1, valueNorm: 'green' }),
    ]);
    const p1 = s.priorFacts({ world: null, bookSlug: 'b1' }, 'John', 'eye_color');
    assert.equal(p1.length, 1, 'b1 sees only its own canon');
    assert.equal(p1[0].valueNorm, 'blue');
    assert.ok(!p1.some(p => p.bookSlug === 'b2'), 'no cross-contamination from b2');

    const p2 = s.priorFacts({ world: null, bookSlug: 'b2' }, 'John', 'eye_color');
    assert.equal(p2.length, 1);
    assert.equal(p2[0].valueNorm, 'green');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('storyElapsed round-trips through insert + priorFacts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-store-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    s.insertFacts([fact({ chapter: 'ch1', storyTime: 5, storyElapsed: 42, valueNorm: 'blue' })]);
    const priors = s.priorFacts({ world: null, bookSlug: 'b1' }, 'John', 'eye_color');
    assert.equal(priors.length, 1);
    assert.equal(priors[0].storyElapsed, 42);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('priorFacts excludes non-canonical rows', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-canon-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) return;
    s.insertFacts([
      fact({ chapter: 'ch1', storyTime: 0, valueNorm: 'blue', canonical: true }),
      fact({ chapter: 'ch2-dream', storyTime: 1, valueNorm: 'red', canonical: false }), // dream — must not be a prior
    ]);
    const priors = s.priorFacts({ world: null, bookSlug: 'b1' }, 'John', 'eye_color');
    assert.equal(priors.length, 1);
    assert.equal(priors[0].valueNorm, 'blue');
    assert.equal(priors[0].canonical, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('knowledge insert/query scoped by book; per-book clear', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-know-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) return;
    s.insertKnowledge([
      ke({ kind: 'acquire', storyTime: 1, chapter: 'ch2' }),
      ke({ kind: 'use', storyTime: 3, chapter: 'ch4' }),
      ke({ bookSlug: 'OTHER', chapter: 'x' }),
    ]);
    const rows = s.knowledgeForBook({ world: null, bookSlug: 'b1' });
    assert.equal(rows.length, 2);
    assert.ok(!rows.some(r => r.bookSlug === 'OTHER'));
    s.clearBookKnowledge('b1');
    assert.equal(s.knowledgeForBook({ world: null, bookSlug: 'b1' }).length, 0);
    assert.equal(s.knowledgeForBook({ world: null, bookSlug: 'OTHER' }).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('canon seed hash + report round-trip', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-store-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) return;
    assert.equal(s.canonSeedHash('w1'), null);
    s.setCanonSeed('w1', 'hash-abc');
    assert.equal(s.canonSeedHash('w1'), 'hash-abc');
    s.saveReport('b1', { findings: [1, 2] });
    assert.deepEqual(s.getReport('b1'), { findings: [1, 2] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('reverseIndex maps each entity+attribute to the chapters that assert it (canon-flagged, CANON excluded)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-rev-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    s.insertFacts([
      fact({ entity: 'Rob', attribute: 'eye_color', chapter: 'chapter-1' }),
      fact({ entity: 'Rob', attribute: 'eye_color', chapter: 'chapter-10', valueNorm: 'grey' }),
      fact({ entity: 'Rob', attribute: 'eye_color', chapter: 'chapter-3', valueNorm: 'grey' }),
      fact({ entity: 'Rob', attribute: 'eye_color', chapter: 'chapter-2', valueNorm: 'blue' }),
      fact({ entity: 'Rob', attribute: 'eye_color', chapter: 'chapter-1' }), // duplicate chapter
      fact({ entity: 'Rob', attribute: 'location', chapter: 'chapter-2', valueNorm: 'pier' }),
      fact({ world: 'w1', bookSlug: null, source: 'canon', chapter: 'CANON', entity: 'Rob', attribute: 'eye_color', valueNorm: 'blue' }),
      fact({ bookSlug: 'OTHER', entity: 'Zed', attribute: 'x', chapter: 'c1' }), // different book — must not leak
    ]);
    const idx = s.reverseIndex({ world: 'w1', bookSlug: 'b1' });
    const rob = idx.find(r => r.entity === 'Rob' && r.attribute === 'eye_color');
    assert.ok(rob, 'Rob/eye_color present');
    assert.deepEqual(rob!.chapters, ['chapter-1', 'chapter-2', 'chapter-3', 'chapter-10'], 'distinct + NUMERIC sort (10 after 2), CANON excluded');
    assert.equal(rob!.isCanon, true, 'backed by a canon fact');
    assert.equal(idx.find(r => r.attribute === 'location')!.isCanon, false);
    assert.ok(!idx.some(r => r.entity === 'Zed'), 'other book excluded');
    assert.ok(!idx.some(r => r.chapters.includes('CANON')), 'CANON pseudo-chapter never listed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('orphanCanonFacts lists canon facts never dramatized in the manuscript (alias-aware)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-orph-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    s.insertFacts([
      // world canon: Rob Vane eye_color (dramatized via alias) + Sword material (orphan)
      fact({ world: 'w1', bookSlug: null, source: 'canon', chapter: 'CANON', entity: 'Rob Vane', aliases: ['Rob Vane', 'Rob'], attribute: 'eye_color', valueRaw: 'blue' }),
      fact({ world: 'w1', bookSlug: null, source: 'canon', chapter: 'CANON', entity: 'Sword', aliases: ['Sword'], attribute: 'material', valueRaw: 'steel' }),
      // manuscript dramatizes Rob (an alias of canon Rob Vane) eye_color
      fact({ entity: 'Rob', aliases: ['Rob'], attribute: 'eye_color', chapter: 'chapter-1' }),
      // a different book's canon must not leak
      fact({ bookSlug: 'OTHER', source: 'canon', chapter: 'CANON', entity: 'Wand', attribute: 'wood', valueRaw: 'oak' }),
    ]);
    const orphans = s.orphanCanonFacts({ world: 'w1', bookSlug: 'b1' });
    assert.deepEqual(orphans.map(o => `${o.entity}/${o.attribute}`), ['Sword/material'], 'only the undramatized canon fact');
    assert.equal(orphans[0].valueRaw, 'steel');
    assert.ok(!orphans.some(o => o.attribute === 'eye_color'), 'alias match means Rob Vane eye_color is NOT orphan');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
