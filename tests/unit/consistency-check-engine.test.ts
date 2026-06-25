// tests/unit/consistency-check-engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFact, evaluateKnowledge } from '../../gateway/src/services/consistency/check-engine.js';
import type { LedgerFact, KnowledgeEvent } from '../../gateway/src/services/consistency/types.js';

const F = (p: Partial<LedgerFact>): LedgerFact => ({
  world: null, bookSlug: 'b1', entity: 'John', aliases: ['John'], attribute: 'eye_color',
  type: 'immutable', valueRaw: 'blue', valueNorm: 'blue', storyTime: 5, storyElapsed: 0, timeLabel: null,
  transition: null, chapter: 'ch10', scene: 0, source: 'manuscript', evidence: 'green eyes', ...p,
});

test('immutable mismatch -> contradiction (high)', () => {
  const f = F({ valueNorm: 'green', chapter: 'ch10' });
  const prior = F({ valueNorm: 'blue', chapter: 'ch1', storyTime: 0 });
  const finding = evaluateFact(f, [prior]);
  assert.equal(finding?.category, 'contradiction');
  assert.equal(finding?.severity, 'high');
  assert.equal(finding?.a.chapter, 'ch10');
  assert.equal((finding?.b as any).chapter, 'ch1');
});

test('manuscript fact contradicting canon -> canon-divergence (high)', () => {
  const f = F({ valueNorm: 'green' });
  const canon = F({ valueNorm: 'blue', source: 'canon', world: 'w1', bookSlug: null, evidence: 'Character Bible: blue', chapter: 'CANON' });
  const finding = evaluateFact(f, [canon]);
  assert.equal(finding?.category, 'canon-divergence');
  assert.equal((finding?.b as any).canonSource !== undefined, true);
});

test('stateful change WITH transition -> no finding', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean suit', transition: 'changed clothes', chapter: 'ch3', storyElapsed: 3 });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', chapter: 'ch2', storyTime: 2, storyElapsed: 2 });
  assert.equal(evaluateFact(f, [prior]), null);
});

test('stateful change WITHOUT transition, no elapsed time (label-free) -> continuity (low)', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean suit', transition: null, chapter: 'ch3', storyElapsed: 2 });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', chapter: 'ch2', storyTime: 2, storyElapsed: 2 });
  const finding = evaluateFact(f, [prior]);
  assert.equal(finding?.category, 'continuity');
  assert.equal(finding?.severity, 'low');   // distance 0: no time signal -> soft note
});

test('stateful change WITHOUT transition, some elapsed gap (below threshold) -> medium', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean', transition: null, storyElapsed: 5 });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', storyTime: 2, storyElapsed: 2 });
  assert.equal(evaluateFact(f, [prior])?.severity, 'medium');   // 0 < 3 < 30: real unexplained change over a short span
});

test('stateful change WITHOUT transition, large elapsed gap -> no finding (legit reset across time skip)', () => {
  const f = F({ attribute: 'mood', type: 'stateful', valueNorm: 'warm', transition: null, chapter: 'ch30', storyTime: 60, storyElapsed: 210 });
  const prior = F({ attribute: 'mood', type: 'stateful', valueNorm: 'distant', chapter: 'ch8', storyTime: 2, storyElapsed: 12 });
  assert.equal(evaluateFact(f, [prior]), null);   // |210-12| = 198 >= 30
});

test('large elapsed prior but ALSO a recent differing prior -> still flags the recent one', () => {
  const f = F({ attribute: 'mood', type: 'stateful', valueNorm: 'warm', transition: null, chapter: 'ch30', storyTime: 60, storyElapsed: 210 });
  const far = F({ attribute: 'mood', type: 'stateful', valueNorm: 'distant', chapter: 'ch8', storyTime: 2, storyElapsed: 12 });
  const near = F({ attribute: 'mood', type: 'stateful', valueNorm: 'furious', chapter: 'ch29', storyTime: 58, storyElapsed: 205 });
  const finding = evaluateFact(f, [near, far]);
  assert.equal(finding?.category, 'continuity');
  assert.equal((finding?.b as any).chapter, 'ch29');   // nearest recent prior
});

test('two incompatible stateful values in SAME story_time -> impossibility (high)', () => {
  const f = F({ attribute: 'location', type: 'stateful', valueNorm: 'the docks', storyTime: 4, storyElapsed: 10, chapter: 'ch4' });
  const prior = F({ attribute: 'location', type: 'stateful', valueNorm: 'the manor', storyTime: 4, storyElapsed: 10, chapter: 'ch4', scene: 1 });
  const finding = evaluateFact(f, [prior]);
  assert.equal(finding?.category, 'impossibility');
  assert.equal(finding?.severity, 'high');
});

test('same value as prior -> no finding', () => {
  assert.equal(evaluateFact(F({ valueNorm: 'blue' }), [F({ valueNorm: 'blue', chapter: 'ch1' })]), null);
});

test('no priors -> no finding', () => {
  assert.equal(evaluateFact(F({}), []), null);
});

const K = (p: Partial<KnowledgeEvent>): KnowledgeEvent => ({
  world: null, bookSlug: 'b1', knower: 'Elena', factKey: 'Marsh killer guilty',
  kind: 'use', source: 'reference', storyTime: 5, chapter: 'ch5', scene: 0, canonical: true,
  evidence: 'Elena named Marsh', ...p,
});

test('use before acquire -> knowledge-violation', () => {
  const acquire = K({ kind: 'acquire', source: 'told', storyTime: 9, chapter: 'ch9' });
  const use = K({ kind: 'use', source: 'reference', storyTime: 5, chapter: 'ch5' });
  const findings = evaluateKnowledge([acquire, use]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, 'knowledge-violation');
  assert.equal(findings[0].severity, 'high'); // reference
  assert.equal(findings[0].entity, 'Elena');
});

test('use after acquire -> no finding', () => {
  const acquire = K({ kind: 'acquire', storyTime: 2, chapter: 'ch2' });
  const use = K({ kind: 'use', storyTime: 5, chapter: 'ch5' });
  assert.deepEqual(evaluateKnowledge([acquire, use]), []);
});

test('no acquire anywhere -> high violation', () => {
  const use = K({ kind: 'use', source: 'act_on', storyTime: 5 });
  const findings = evaluateKnowledge([use]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'high'); // never learned
});

test('only a non-canonical (dream) acquire before use -> still flags', () => {
  const dream = K({ kind: 'acquire', source: 'witnessed', storyTime: 1, canonical: false });
  const use = K({ kind: 'use', source: 'act_on', storyTime: 5 });
  const findings = evaluateKnowledge([dream, use]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'high'); // dream doesn't count -> no real acquire
});

test('act_on before acquire -> medium', () => {
  const acquire = K({ kind: 'acquire', storyTime: 9 });
  const use = K({ kind: 'use', source: 'act_on', storyTime: 5 });
  assert.equal(evaluateKnowledge([acquire, use])[0].severity, 'medium');
});
