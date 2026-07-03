/**
 * Integration-seam tests for `resolveGroundingBlock` (gateway/src/api/routes/_shared.ts) —
 * the phase seam that wires Task 1's `runGroundingResearch` into the book-bible
 * phase, mirroring how `resolveIntimacyRouting` (Plan 2) is tested directly
 * with a fake `services` object rather than through the Express route.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGroundingBlock } from '../../gateway/src/api/routes/_shared.js';

function fakeServices(overrides: any = {}) {
  return {
    books: {
      open: async (_slug: string) => ({ manifest: { pulledFrom: { genre: { name: 'historical romance' } } } }),
    },
    research: {
      search: async () => ({ results: [], blocked: [] }),
    },
    researchLookup: {
      lookup: async (query: string) => {
        const clean = String(query || '').trim();
        // Mirrors ResearchLookupService.lookup's real guard — throws on an
        // empty query, so a mis-wire that loses the genre/signals surfaces here.
        if (!clean) throw new Error('Query is required');
        return {
          query, answer: `Sourced facts about ${clean.includes('historical romance') ? 'the Regency era' : 'the topic'}. [1]`,
          citations: [{ title: 'Regency era', url: 'https://en.wikipedia.org/wiki/Regency_era' }],
          provider: 'perplexity-direct', hasVerifiedSources: true, estimatedCost: 0,
        };
      },
    },
    ...overrides,
  };
}

function fakeProject(context: any = {}) {
  return { id: 'p1', bookSlug: 'my-book', description: 'A Regency romance', context };
}

const bibleStep = { id: 'step-1', role: 'bible' };
const draftStep = { id: 'step-2', role: 'draft' };

test('resolveGroundingBlock: injects sourced facts for a bible-role step', async () => {
  const project = fakeProject();
  const result = await resolveGroundingBlock({
    services: fakeServices(),
    project,
    step: bibleStep,
    researchDir: '/tmp/fake-research-seam',
    writeFile: async () => {},
  });
  assert.ok(result.groundingBlock.includes('Sourced facts about the Regency era'));
});

test('resolveGroundingBlock: no-op for a non-bible step role', async () => {
  const project = fakeProject();
  const result = await resolveGroundingBlock({
    services: fakeServices(),
    project,
    step: draftStep,
    researchDir: '/tmp/fake-research-seam',
    writeFile: async () => {},
  });
  assert.equal(result.groundingBlock, '');
});

test('resolveGroundingBlock: no-op when the book has grounding.enabled === false', async () => {
  const services = fakeServices({
    books: { open: async () => ({ manifest: { pulledFrom: { genre: { name: 'romance' } }, grounding: { enabled: false } } }) },
  });
  const project = fakeProject();
  const result = await resolveGroundingBlock({
    services, project, step: bibleStep, researchDir: '/tmp/fake-research-seam', writeFile: async () => {},
  });
  assert.equal(result.groundingBlock, '');
});

test('resolveGroundingBlock: caches on project.context so a second bible step does not re-run the lookup', async () => {
  let lookupCalls = 0;
  const services = fakeServices({
    researchLookup: {
      lookup: async (query: string) => {
        lookupCalls++;
        return {
          query, answer: 'Cached-worthy facts. [1]', citations: [{ title: 'x', url: 'https://en.wikipedia.org/wiki/x' }],
          provider: 'perplexity-direct', hasVerifiedSources: true, estimatedCost: 0,
        };
      },
    },
  });
  const project = fakeProject();
  const first = await resolveGroundingBlock({ services, project, step: bibleStep, researchDir: '/tmp/fake-research-seam', writeFile: async () => {} });
  const second = await resolveGroundingBlock({ services, project, step: { id: 'step-3', role: 'bible' }, researchDir: '/tmp/fake-research-seam', writeFile: async () => {} });
  assert.equal(lookupCalls, 1);
  assert.equal(first.groundingBlock, second.groundingBlock);
});

test('resolveGroundingBlock: a lookup failure degrades to an empty block without throwing', async () => {
  const services = fakeServices({
    researchLookup: { lookup: async () => { throw new Error('Perplexity 500'); } },
  });
  const project = fakeProject();
  const result = await resolveGroundingBlock({ services, project, step: bibleStep, researchDir: '/tmp/fake-research-seam', writeFile: async () => {} });
  assert.equal(result.groundingBlock, '');
});

test('resolveGroundingBlock: records the lookup cost via services.costs (M2)', async () => {
  const recorded: Array<[string, number, number | undefined, string | undefined]> = [];
  const services = fakeServices({
    costs: { record: (provider: string, tokens: number, cost?: number, slug?: string) => { recorded.push([provider, tokens, cost, slug]); } },
  });
  const project = fakeProject();
  await resolveGroundingBlock({ services, project, step: bibleStep, researchDir: '/tmp/fake-research-seam', writeFile: async () => {} });
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], ['perplexity-direct', 0, 0, 'my-book']);
});

test('resolveGroundingBlock: a lookup failure records no cost (nothing to bill)', async () => {
  const recorded: Array<unknown[]> = [];
  const services = fakeServices({
    researchLookup: { lookup: async () => { throw new Error('Perplexity 500'); } },
    costs: { record: (...args: unknown[]) => { recorded.push(args); } },
  });
  const project = fakeProject();
  await resolveGroundingBlock({ services, project, step: bibleStep, researchDir: '/tmp/fake-research-seam', writeFile: async () => {} });
  assert.equal(recorded.length, 0);
});

test('resolveGroundingBlock: populates the setting signal from project.context.setting (L3)', async () => {
  let capturedQuery = '';
  const services = fakeServices({
    researchLookup: {
      lookup: async (query: string) => {
        capturedQuery = query;
        return {
          query, answer: 'Sourced facts. [1]', citations: [{ title: 'x', url: 'https://en.wikipedia.org/wiki/x' }],
          provider: 'perplexity-direct', hasVerifiedSources: true, estimatedCost: 0,
        };
      },
    },
  });
  const project = fakeProject({ setting: 'a floating city above the clouds' });
  await resolveGroundingBlock({ services, project, step: bibleStep, researchDir: '/tmp/fake-research-seam', writeFile: async () => {} });
  assert.match(capturedQuery, /floating city above the clouds/);
});
