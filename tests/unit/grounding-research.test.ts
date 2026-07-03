/**
 * Unit tests for gateway/src/services/pipeline/grounding-research.ts
 * (Flagship Plan 4, Task 1 — grounding research front).
 *
 * `runGroundingResearch` is a pure orchestration function over two injected
 * dependencies shaped like the real services:
 *   - ResearchGate.search(query, maxResults) — gateway/src/services/research.ts
 *   - ResearchLookupService.lookup(query, opts) — gateway/src/services/research-lookup.ts
 *
 * The fakes below mirror the REAL return shapes (checked against the source)
 * so a mis-wire (wrong arg count/shape) would surface here rather than only
 * in production.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGroundingResearch, type ResearchGateLike, type ResearchLookupLike } from '../../gateway/src/services/pipeline/grounding-research.js';

function fakeResearch(overrides?: Partial<ResearchGateLike>): ResearchGateLike {
  return {
    search: async (_query: string, _maxResults?: number) => ({
      results: [{ title: 'Wikipedia: Regency England', url: 'https://en.wikipedia.org/wiki/Regency_era', snippet: 'The Regency era...', source: 'Wikipedia' }],
      blocked: [],
    }),
    ...overrides,
  };
}

function fakeLookup(overrides?: Partial<ResearchLookupLike>): ResearchLookupLike {
  return {
    lookup: async (query: string, _opts?: { maxWords?: number }) => ({
      query,
      answer: 'Regency-era London households employed a butler and cook. [1]',
      citations: [{ title: 'Regency era', url: 'https://en.wikipedia.org/wiki/Regency_era' }],
      provider: 'perplexity-direct' as const,
      hasVerifiedSources: true,
      estimatedCost: 0.002,
    }),
    ...overrides,
  };
}

function writeCollector() {
  const writes: Array<{ path: string; content: string }> = [];
  const writeFile = async (path: string, content: string) => { writes.push({ path, content }); };
  return { writes, writeFile };
}

test('runGroundingResearch: writes a citations file and returns cited facts + sources', async () => {
  const { writes, writeFile } = writeCollector();
  const result = await runGroundingResearch({
    slug: 'my-book',
    signals: { genre: 'historical romance', period: 'Regency England' },
    research: fakeResearch(),
    lookup: fakeLookup(),
    writeFile,
    researchDir: '/tmp/fake-research',
  });

  assert.ok(result.citedFacts.includes('Regency-era London households'));
  assert.ok(result.sources.includes('https://en.wikipedia.org/wiki/Regency_era'));
  assert.equal(writes.length, 1);
  assert.match(writes[0].path, /my-book/);
  assert.ok(writes[0].content.includes('Regency-era London households'));
});

test('runGroundingResearch: dark genres frame the query as documented-facts-for-fiction, not a how-to', async () => {
  let capturedQuery = '';
  const lookup = fakeLookup({
    lookup: async (query: string) => {
      capturedQuery = query;
      return {
        query, answer: 'Documented facts. [1]',
        citations: [{ title: 'x', url: 'https://en.wikipedia.org/wiki/x' }],
        provider: 'perplexity-direct' as const, hasVerifiedSources: true, estimatedCost: 0,
      };
    },
  });
  const { writeFile } = writeCollector();
  await runGroundingResearch({
    slug: 'dark-book',
    signals: { genre: 'thriller', domain: 'poisoning methods' },
    research: fakeResearch(),
    lookup,
    writeFile,
    researchDir: '/tmp/fake-research',
  });

  assert.match(capturedQuery, /publicly documented/i);
  // The query must not itself ask FOR a procedure (e.g. "how to make X" /
  // "steps to X") — it may (and does) explicitly forbid one, which is fine.
  assert.doesNotMatch(capturedQuery, /how to (?:make|obtain|perform|do|create)|steps to\b/i);
});

test('runGroundingResearch: a lookup failure degrades to empty result without throwing', async () => {
  const lookup = fakeLookup({
    lookup: async () => { throw new Error('Perplexity 500: internal error'); },
  });
  const { writes, writeFile } = writeCollector();
  const result = await runGroundingResearch({
    slug: 'my-book',
    signals: { genre: 'fantasy' },
    research: fakeResearch(),
    lookup,
    writeFile,
    researchDir: '/tmp/fake-research',
  });

  assert.deepEqual(result, { citedFacts: '', sources: [] });
  assert.equal(writes.length, 0);
});

test('runGroundingResearch: no verified sources degrades to empty result (no file written)', async () => {
  const lookup = fakeLookup({
    lookup: async (query: string) => ({
      query,
      answer: 'I cannot verify reliable sources on this topic.',
      citations: [],
      provider: 'fallback-llm' as const,
      hasVerifiedSources: false,
      estimatedCost: 0,
    }),
  });
  const { writes, writeFile } = writeCollector();
  const result = await runGroundingResearch({
    slug: 'my-book',
    signals: { genre: 'sci-fi' },
    research: fakeResearch(),
    lookup,
    writeFile,
    researchDir: '/tmp/fake-research',
  });

  assert.deepEqual(result, { citedFacts: '', sources: [] });
  assert.equal(writes.length, 0);
});

// ── Mis-wire detection: a fake that THROWS when given a wrong-shape/undefined
// query mirrors ResearchLookupService.lookup's real behavior (it throws
// `new Error('Query is required')` for an empty query). If the caller ever
// passes an empty/undefined query — e.g. from an undefined `signals.genre` —
// this test fails loudly instead of silently degrading. ──
test('runGroundingResearch: a real-shaped lookup that requires a non-empty query never receives one', async () => {
  const lookup: ResearchLookupLike = {
    lookup: async (query: string, _opts?: { maxWords?: number }) => {
      const clean = String(query || '').trim();
      if (!clean) throw new Error('Query is required');
      return {
        query, answer: `Facts about ${clean}. [1]`,
        citations: [{ title: 'src', url: 'https://en.wikipedia.org/wiki/src' }],
        provider: 'perplexity-direct' as const, hasVerifiedSources: true, estimatedCost: 0,
      };
    },
  };
  const { writeFile } = writeCollector();
  const result = await runGroundingResearch({
    slug: 'my-book',
    signals: { genre: 'fantasy' },
    research: fakeResearch(),
    lookup,
    writeFile,
    researchDir: '/tmp/fake-research',
  });
  // Would throw (uncaught, since this mimics the real service's guard) if the
  // wiring ever called lookup() with an empty query — the test failing on an
  // unhandled rejection is itself the signal.
  assert.ok(result.citedFacts.includes('Facts about'));
});
