// tests/unit/consistency-fact-store.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import type { LedgerFact } from '../../gateway/src/services/consistency/types.js';

function fact(p: Partial<LedgerFact>): LedgerFact {
  return {
    world: null, bookSlug: 'b1', entity: 'John', aliases: ['John'], attribute: 'eye_color',
    type: 'immutable', valueRaw: 'blue', valueNorm: 'blue', storyTime: 0, timeLabel: null,
    transition: null, chapter: 'ch1', scene: 0, source: 'manuscript', evidence: 'his blue eyes', ...p,
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
