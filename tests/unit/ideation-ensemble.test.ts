/**
 * Task 1 (runIdeationEnsemble fan-out) + Task 3 (panel resolution) tests
 * (gateway/src/services/pipeline/ideation-ensemble.ts).
 *
 * Per the "inert in production" lesson from Plans 1-6: the fake `complete`
 * here THROWS on an unregistered/undefined provider id — mirroring the real
 * AIRouter.complete's `Provider ${id} not found` — instead of a permissive
 * stub that would silently accept a wrong-shape request and mask a bad
 * panel-member -> provider mapping.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runIdeationEnsemble,
  resolvePanelMemberProvider,
  resolveEnsemblePanel,
  DEFAULT_ENSEMBLE_PANEL,
  loadIdeationAngles,
} from '../../gateway/src/services/pipeline/ideation-ensemble.js';
import { AI_PROVIDER_IDS } from '../../gateway/src/ai/router.js';

const ANGLES = {
  'mvp-first': 'lean, proven, low-risk',
  'risk-first': 'bold, high-risk',
  'character-first': 'psychology-driven',
  'world-first': 'setting-driven',
};

/** Mirrors the real router: throws for any provider id it doesn't recognize. */
const REGISTERED = new Set<string>(AI_PROVIDER_IDS);
function throwingRouterComplete(): (req: any) => Promise<{ text: string }> {
  return async (req: any) => {
    if (!req.provider || !REGISTERED.has(req.provider)) {
      throw new Error(`Provider ${req.provider} not found`);
    }
    return { text: `pitch from ${req.provider}/${req.model ?? 'default'}` };
  };
}

test('4-member default panel yields 4 pitches with distinct angles, each on a REAL registered provider', async () => {
  const complete = throwingRouterComplete();
  const pitches = await runIdeationEnsemble({
    premise: 'A lighthouse keeper discovers the sea is keeping a secret.',
    genre: 'fantasy',
    panel: [...DEFAULT_ENSEMBLE_PANEL],
    angles: ANGLES,
    complete,
    resolveModel: resolvePanelMemberProvider,
  });
  assert.equal(pitches.length, 4);
  const angles = new Set(pitches.map(p => p.angle));
  assert.equal(angles.size, 4, 'each panel member should get a distinct angle');
  for (const p of pitches) {
    assert.ok(p.pitch.length > 0);
    assert.ok(typeof p.member === 'string' && p.member.length > 0);
  }
});

test('each default panel member resolves to a real router-registered provider id', () => {
  for (const member of DEFAULT_ENSEMBLE_PANEL) {
    const { provider } = resolvePanelMemberProvider(member);
    assert.ok(REGISTERED.has(provider), `panel member "${member}" mapped to unregistered provider "${provider}"`);
  }
});

test('a member whose complete() rejects is dropped; the rest still return', async () => {
  const flaky = async (req: any) => {
    if (req.provider === 'openai') throw new Error('openai down');
    return { text: `ok from ${req.provider}` };
  };
  const pitches = await runIdeationEnsemble({
    premise: 'seed',
    genre: 'romance',
    panel: [...DEFAULT_ENSEMBLE_PANEL], // gpt(openai) fails, grok/gemini/claude succeed
    angles: ANGLES,
    complete: flaky,
    resolveModel: resolvePanelMemberProvider,
  });
  assert.equal(pitches.length, 3);
  assert.ok(!pitches.some(p => p.member === 'gpt'));
});

test('an unknown panel member (resolveModel throws) is dropped, not fatal to the rest', async () => {
  const complete = throwingRouterComplete();
  const pitches = await runIdeationEnsemble({
    premise: 'seed',
    genre: 'sci-fi',
    panel: ['claude', 'not-a-real-member', 'gemini'],
    angles: ANGLES,
    complete,
    resolveModel: resolvePanelMemberProvider,
  });
  assert.equal(pitches.length, 2);
  assert.deepEqual(pitches.map(p => p.member).sort(), ['claude', 'gemini']);
});

test('an empty panel returns []', async () => {
  const pitches = await runIdeationEnsemble({
    premise: 'seed',
    genre: 'romance',
    panel: [],
    angles: ANGLES,
    complete: throwingRouterComplete(),
    resolveModel: resolvePanelMemberProvider,
  });
  assert.deepEqual(pitches, []);
});

test('a request with an undefined provider (unmapped member reaching complete) would throw, mirroring the real router — proves the fake is not permissive', async () => {
  const complete = throwingRouterComplete();
  await assert.rejects(() => complete({ provider: undefined, system: 's', messages: [] }));
  await assert.rejects(() => complete({ provider: 'grok', system: 's', messages: [] })); // 'grok' is a panel member name, not a provider id
});

// ── Task 3: panel resolution ──

test('resolveEnsemblePanel: falls back to the hardcoded default when neither manifest nor sheet has a panel', () => {
  assert.deepEqual(resolveEnsemblePanel({}), [...DEFAULT_ENSEMBLE_PANEL]);
});

test('resolveEnsemblePanel: inherits the genre sheet\'s ensemblePanel when the book has none of its own', () => {
  const panel = resolveEnsemblePanel({ sheetPanel: ['claude', 'gemini'] });
  assert.deepEqual(panel, ['claude', 'gemini']);
});

test('resolveEnsemblePanel: an explicit book/manifest panel overrides the genre sheet', () => {
  const panel = resolveEnsemblePanel({ manifestPanel: ['claude'], sheetPanel: ['claude', 'gemini', 'gpt', 'grok'] });
  assert.deepEqual(panel, ['claude']);
});

test('loadIdeationAngles: reads the real library/craft/ideation-angles.json with at least 4 distinct angles', () => {
  const angles = loadIdeationAngles();
  assert.ok(Object.keys(angles).length >= 4);
  for (const v of Object.values(angles)) assert.ok(typeof v === 'string' && v.length > 0);
});

test('loadIdeationAngles: fails soft to a non-empty default set when the file is missing', () => {
  const angles = loadIdeationAngles('/tmp/definitely-not-a-real-dir-for-bookclaw-tests');
  assert.ok(Object.keys(angles).length > 0);
});
