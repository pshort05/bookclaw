import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResearchLookupService, coerceResearchToMarkdown } from '../../gateway/src/services/research-lookup.js';

// ── The JSON→Markdown guard (Gemini sometimes returns JSON where prose was asked) ──

test('coerceResearchToMarkdown: plain Markdown passes through untouched', () => {
  const md = '## Long Beach Island\n\nA barrier island off NJ. [1]\n\nSources:\n[1] https://example.com';
  assert.equal(coerceResearchToMarkdown(md), md.trim());
});

test('coerceResearchToMarkdown: a bare JSON object yields its prose + a Sources list', () => {
  const json = JSON.stringify({ answer: 'LBI is an 18-mile barrier island. [1]', sources: [{ title: 'NJ Atlas', url: 'https://nj.gov/atlas' }] });
  const out = coerceResearchToMarkdown(json);
  assert.match(out, /18-mile barrier island/);
  assert.match(out, /Sources:/);
  assert.match(out, /nj\.gov\/atlas/);
  assert.doesNotMatch(out, /^\s*[{[]/); // no longer a serialized object
});

test('coerceResearchToMarkdown: a ```json fenced object is unwrapped and extracted', () => {
  const fenced = '```json\n' + JSON.stringify({ summary: 'Surf City sits mid-island.', citations: ['https://a.test'] }) + '\n```';
  const out = coerceResearchToMarkdown(fenced);
  assert.match(out, /Surf City sits mid-island/);
  assert.match(out, /a\.test/);
});

test('coerceResearchToMarkdown: non-JSON that merely starts with a brace is returned as-is', () => {
  const text = '{not json} but still the model\'s prose answer.';
  assert.equal(coerceResearchToMarkdown(text), text);
});

// ── The Gemini-Pro pin on the no-live-web fallback ──

function fakeRouter(capture: { req?: any }) {
  return {
    selectProvider: (_task: string, preferredId?: string) => ({ id: preferredId === 'openrouter' ? 'openrouter' : 'gemini' }),
    complete: async (req: any) => { capture.req = req; return { text: 'A factual geography summary. [1]\n\nSources:\n[1] https://src.test', estimatedCost: 0.004 }; },
  };
}

test('fallback research pins Gemini Pro via OpenRouter with an anti-hallucination + Markdown prompt', async () => {
  const capture: { req?: any } = {};
  const svc = new ResearchLookupService();
  // No API keys → skip both Perplexity paths and land on the pinned fallback.
  svc.setDependencies({ get: async () => null } as any, fakeRouter(capture) as any);

  const r = await svc.lookup('Real geography of Long Beach Island, New Jersey');
  assert.equal(capture.req.provider, 'openrouter');
  assert.equal(capture.req.model, 'google/gemini-2.5-pro');
  assert.match(capture.req.system, /NEVER fabricate/i);
  assert.match(capture.req.system, /Markdown PROSE/i);
  assert.equal(r.provider, 'fallback-llm');
  assert.equal(r.hasVerifiedSources, false);   // no live web — honestly flagged
  assert.match(r.answer, /factual geography summary/);
});

test('an OpenRouter-Perplexity result with no verified sources falls through to Gemini Pro', async () => {
  const capture: { req?: any } = {};
  const svc = new ResearchLookupService();
  // OpenRouter key present → the Perplexity-via-OpenRouter path runs first.
  svc.setDependencies({ get: async (k: string) => (k === 'openrouter_api_key' ? 'or-key' : null) } as any, fakeRouter(capture) as any);

  const realFetch = globalThis.fetch;
  // Perplexity-shaped response but with NO citations → hasVerifiedSources=false.
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'Uncited prose.' } }] }) })) as any;
  try {
    await svc.lookup('Real geography of Long Beach Island, New Jersey');
  } finally {
    globalThis.fetch = realFetch;
  }
  // Fell through to the pinned Gemini fallback rather than returning the empty result.
  assert.equal(capture.req?.provider, 'openrouter');
  assert.equal(capture.req?.model, 'google/gemini-2.5-pro');
});
