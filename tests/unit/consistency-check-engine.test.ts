// tests/unit/consistency-check-engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFact, type Gap } from '../../gateway/src/services/consistency/check-engine.js';
import type { LedgerFact } from '../../gateway/src/services/consistency/types.js';

const F = (p: Partial<LedgerFact>): LedgerFact => ({
  world: null, bookSlug: 'b1', entity: 'John', aliases: ['John'], attribute: 'eye_color',
  type: 'immutable', valueRaw: 'blue', valueNorm: 'blue', storyTime: 5, timeLabel: null,
  transition: null, chapter: 'ch10', scene: 0, source: 'manuscript', evidence: 'green eyes', ...p,
});

test('immutable mismatch -> contradiction (high)', () => {
  const f = F({ valueNorm: 'green', chapter: 'ch10' });
  const prior = F({ valueNorm: 'blue', chapter: 'ch1', storyTime: 0 });
  const finding = evaluateFact(f, [prior], 'longer');
  assert.equal(finding?.category, 'contradiction');
  assert.equal(finding?.severity, 'high');
  assert.equal(finding?.a.chapter, 'ch10');
  assert.equal((finding?.b as any).chapter, 'ch1');
});

test('manuscript fact contradicting canon -> canon-divergence (high)', () => {
  const f = F({ valueNorm: 'green' });
  const canon = F({ valueNorm: 'blue', source: 'canon', world: 'w1', bookSlug: null, evidence: 'Character Bible: blue', chapter: 'CANON' });
  const finding = evaluateFact(f, [canon], 'unknown');
  assert.equal(finding?.category, 'canon-divergence');
  assert.equal((finding?.b as any).canonSource !== undefined, true);
});

test('stateful change WITH transition -> no finding', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean suit', transition: 'changed clothes', chapter: 'ch3' });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', chapter: 'ch2', storyTime: 2 });
  assert.equal(evaluateFact(f, [prior], 'day'), null);
});

test('stateful change WITHOUT transition, small gap -> continuity (medium)', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean suit', transition: null, chapter: 'ch3' });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', chapter: 'ch2', storyTime: 2 });
  const finding = evaluateFact(f, [prior], 'same');
  assert.equal(finding?.category, 'continuity');
  assert.equal(finding?.severity, 'medium');
});

test('stateful change without transition, UNKNOWN gap -> low (review)', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean', transition: null });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', storyTime: 2 });
  assert.equal(evaluateFact(f, [prior], 'unknown')?.severity, 'low');
});

test('stateful change without transition, LONGER gap -> no finding (legit reset)', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean', transition: null });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', storyTime: 2 });
  assert.equal(evaluateFact(f, [prior], 'longer'), null);
});

test('two incompatible stateful values in SAME story_time -> impossibility (high)', () => {
  const f = F({ attribute: 'location', type: 'stateful', valueNorm: 'the docks', storyTime: 4, chapter: 'ch4' });
  const prior = F({ attribute: 'location', type: 'stateful', valueNorm: 'the manor', storyTime: 4, chapter: 'ch4', scene: 1 });
  const finding = evaluateFact(f, [prior], 'same');
  assert.equal(finding?.category, 'impossibility');
  assert.equal(finding?.severity, 'high');
});

test('same value as prior -> no finding', () => {
  assert.equal(evaluateFact(F({ valueNorm: 'blue' }), [F({ valueNorm: 'blue', chapter: 'ch1' })], 'longer'), null);
});

test('no priors -> no finding', () => {
  assert.equal(evaluateFact(F({}), [], 'unknown'), null);
});
