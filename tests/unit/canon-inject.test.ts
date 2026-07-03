// tests/unit/canon-inject.test.ts
// Flagship Plan 3, Task 1: pre-draft canon-ledger injection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import { buildCanonBlock } from '../../gateway/src/services/consistency/canon-inject.js';
import type { LedgerFact, KnowledgeEvent } from '../../gateway/src/services/consistency/types.js';

function fact(p: Partial<LedgerFact>): LedgerFact {
  return {
    world: null, bookSlug: 'b1', entity: 'Anna', aliases: ['Anna'], attribute: 'eye_color',
    type: 'immutable', valueRaw: 'brown eyes', valueNorm: 'brown', storyTime: 0, storyElapsed: 0, timeLabel: null,
    transition: null, chapter: 'chapter-1', scene: 0, source: 'manuscript', evidence: 'brown eyes', canonical: true, ...p,
  };
}

function ke(p: Partial<KnowledgeEvent>): KnowledgeEvent {
  return {
    world: null, bookSlug: 'b1', knower: 'Anna', factKey: 'Marsh\0killer_identity\0guilty',
    kind: 'acquire', source: 'witnessed', storyTime: 0, chapter: 'chapter-2', scene: 0, canonical: true,
    evidence: 'Anna saw Marsh do it', ...p,
  };
}

test('returns "" when the store is unavailable/empty', async () => {
  const root = mkdtempSync(join(tmpdir(), 'canon-inject-empty-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    const block = buildCanonBlock({ slug: 'b1', chapterNumber: 5, store });
    assert.equal(block, '');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('includes facts up to chapterNumber, excludes later-chapter facts from the canon section, and includes the knowledge matrix', async () => {
  const root = mkdtempSync(join(tmpdir(), 'canon-inject-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    store.insertFacts([
      fact({ chapter: 'chapter-1', attribute: 'eye_color', valueRaw: 'brown eyes', valueNorm: 'brown' }),
      fact({ chapter: 'chapter-3', entity: 'Rob', attribute: 'location', valueRaw: 'the pier', valueNorm: 'pier' }),
      fact({ chapter: 'chapter-8', entity: 'Rob', attribute: 'true_identity', valueRaw: 'the killer', valueNorm: 'killer' }), // future spoiler
    ]);
    store.insertKnowledge([
      ke({ knower: 'Anna', factKey: 'Marsh\0secret\0affair', chapter: 'chapter-2', kind: 'acquire' }),
      ke({ knower: 'Rob', factKey: 'Anna\0true_identity\0killer', chapter: 'chapter-9', kind: 'acquire' }), // future — not known yet at ch5
    ]);

    const block = buildCanonBlock({ slug: 'b1', chapterNumber: 5, store });
    assert.notEqual(block, '');
    assert.match(block, /Anna\.eye_color: brown eyes/);
    assert.match(block, /Rob\.location: the pier/);
    // Future (chapter-8) fact must not leak its VALUE into the usable canon.
    assert.doesNotMatch(block, /the killer/);
    // But it should be flagged as a forbidden move (entity/attribute only, no value).
    assert.match(block, /FORBIDDEN MOVES/);
    assert.match(block, /Rob\.true_identity/);
    // Knowledge matrix: Anna's chapter-2 acquisition is known by chapter 5; Rob's
    // chapter-9 acquisition is not yet and must not appear.
    assert.match(block, /CHARACTER KNOWLEDGE MATRIX/);
    assert.match(block, /Anna: .*secret/);
    assert.doesNotMatch(block, /Rob: .*true_identity/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
