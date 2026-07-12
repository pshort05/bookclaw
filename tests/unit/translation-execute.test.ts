/**
 * Unit tests for the execution surface of gateway/src/services/translation-pipeline.ts
 * (executeTranslation / setAI / chunking / system-prompt building / per-chunk retry).
 *
 * Network-free: aiComplete + aiSelectProvider are fakes. The fake aiComplete echoes
 * `TRANSLATED:<chunk>` for a successful call, and optionally throws for chunks whose
 * index is in a caller-supplied reject set (used to exercise the retry-then-error-marker
 * path). The chunk index is recovered from the "passage (N of M)" prefix the real
 * translateChunk() prepends to the user message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TranslationPipelineService,
  type AICompleteFn,
  type AISelectProviderFn,
} from '../../gateway/src/services/translation-pipeline.js';

interface CapturedCall {
  system: string;
  user: string;
  provider: string;
}

function chunkIndexOf(userMessage: string): number {
  const m = /passage \((\d+) of \d+\)/.exec(userMessage);
  return m ? Number(m[1]) - 1 : -1;
}

function makeAI(opts: { rejectChunks?: Set<number>; estimatedCost?: number } = {}): {
  aiComplete: AICompleteFn;
  aiSelectProvider: AISelectProviderFn;
  calls: CapturedCall[];
  selectCalls: string[];
} {
  const rejectChunks = opts.rejectChunks || new Set<number>();
  const estimatedCost = opts.estimatedCost ?? 0.01;
  const calls: CapturedCall[] = [];
  const selectCalls: string[] = [];

  const aiComplete: AICompleteFn = async (req) => {
    calls.push({ system: req.system, user: req.messages[0].content, provider: req.provider });
    const idx = chunkIndexOf(req.messages[0].content);
    if (rejectChunks.has(idx)) {
      throw new Error('simulated translation failure');
    }
    return { text: `TRANSLATED:${req.messages[0].content}`, estimatedCost, provider: req.provider };
  };
  const aiSelectProvider: AISelectProviderFn = (taskType: string) => {
    selectCalls.push(taskType);
    return { id: 'stub-provider' };
  };
  return { aiComplete, aiSelectProvider, calls, selectCalls };
}

// ── setAI gating ─────────────────────────────────────────────────────────

test('executeTranslation: throws if setAI was never called', async () => {
  const svc = new TranslationPipelineService();
  await assert.rejects(
    svc.executeTranslation({ manuscript: 'Hello world.', targetLanguage: 'de' }),
    /not wired to AI router/,
  );
});

// ── chunking ─────────────────────────────────────────────────────────────

test('executeTranslation: short manuscript packs into a single chunk => one AI call', async () => {
  const svc = new TranslationPipelineService();
  const { aiComplete, aiSelectProvider, calls } = makeAI();
  svc.setAI(aiComplete, aiSelectProvider);

  const res = await svc.executeTranslation({
    manuscript: 'Hello world.\n\nSecond paragraph.',
    targetLanguage: 'de',
  });

  assert.equal(res.chunkCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(res.failedChunks, 0);
  assert.match(res.translatedText, /^TRANSLATED:/);
});

test('executeTranslation: paragraphs are greedily packed on paragraph boundaries, <=6000 chars/chunk', async () => {
  const svc = new TranslationPipelineService();
  const { aiComplete, aiSelectProvider, calls } = makeAI();
  svc.setAI(aiComplete, aiSelectProvider);

  // p1(2000) + p2(2000) combine (4002 <= 6000). Adding p3(5000) would overflow
  // (4002 + 2 + 5000 = 9004 > 6000), so p3 starts a new chunk; p4(500) then
  // combines with p3 (5502 <= 6000). Expected: 2 chunks: [p1+p2], [p3+p4].
  const p1 = 'A'.repeat(2000);
  const p2 = 'B'.repeat(2000);
  const p3 = 'C'.repeat(5000);
  const p4 = 'D'.repeat(500);
  const manuscript = [p1, p2, p3, p4].join('\n\n');

  const res = await svc.executeTranslation({ manuscript, targetLanguage: 'de' });

  assert.equal(res.chunkCount, 2);
  assert.equal(calls.length, 2);
  const chunk1 = calls[0].user;
  const chunk2 = calls[1].user;
  assert.ok(chunk1.includes(p1) && chunk1.includes(p2) && !chunk1.includes(p3));
  assert.ok(chunk2.includes(p3) && chunk2.includes(p4) && !chunk2.includes(p1));
});

// ── tier routing ─────────────────────────────────────────────────────────

test('executeTranslation: tier "premium" routes selectProvider to task "final_edit"', async () => {
  const svc = new TranslationPipelineService();
  const { aiComplete, aiSelectProvider, selectCalls } = makeAI();
  svc.setAI(aiComplete, aiSelectProvider);

  await svc.executeTranslation({ manuscript: 'Hello.', targetLanguage: 'de', tier: 'premium' });

  assert.deepEqual(selectCalls, ['final_edit']);
});

test('executeTranslation: default tier routes selectProvider to task "revision"', async () => {
  const svc = new TranslationPipelineService();
  const { aiComplete, aiSelectProvider, selectCalls } = makeAI();
  svc.setAI(aiComplete, aiSelectProvider);

  await svc.executeTranslation({ manuscript: 'Hello.', targetLanguage: 'de' });

  assert.deepEqual(selectCalls, ['revision']);
});

// ── glossary in system prompt ────────────────────────────────────────────

test('executeTranslation: glossary entries appear in the captured system prompt', async () => {
  const svc = new TranslationPipelineService();
  const { aiComplete, aiSelectProvider, calls } = makeAI();
  svc.setAI(aiComplete, aiSelectProvider);

  await svc.executeTranslation({
    manuscript: 'Hello world.',
    targetLanguage: 'de',
    glossary: { Kestrel: 'Kestrel', Ironhold: 'Eisenfeste' },
  });

  const system = calls[0].system;
  assert.match(system, /Kestrel → Kestrel \(keep verbatim\)/);
  assert.match(system, /Ironhold → Eisenfeste/);
});

// ── fr disclosure warning ────────────────────────────────────────────────

test('executeTranslation: fr target adds the France disclosure warning', async () => {
  const svc = new TranslationPipelineService();
  const { aiComplete, aiSelectProvider } = makeAI();
  svc.setAI(aiComplete, aiSelectProvider);

  const res = await svc.executeTranslation({ manuscript: 'Bonjour.', targetLanguage: 'fr' });

  assert.ok(res.warnings.some(w => /FRANCE/.test(w) && /Code de la consommation/.test(w)));
});

test('executeTranslation: non-fr target does NOT add the France disclosure warning', async () => {
  const svc = new TranslationPipelineService();
  const { aiComplete, aiSelectProvider } = makeAI();
  svc.setAI(aiComplete, aiSelectProvider);

  const res = await svc.executeTranslation({ manuscript: 'Hallo.', targetLanguage: 'de' });

  assert.ok(!res.warnings.some(w => /FRANCE/.test(w)));
});

// ── per-chunk retry + fail-soft error marker ─────────────────────────────

test('executeTranslation: a chunk that fails twice gets an error marker + original text; other chunks still translate', async () => {
  const svc = new TranslationPipelineService();
  const p1 = 'A'.repeat(4000);
  const p2 = 'B'.repeat(4000);
  const manuscript = [p1, p2].join('\n\n');
  const { aiComplete, aiSelectProvider } = makeAI({ rejectChunks: new Set([0]) });
  svc.setAI(aiComplete, aiSelectProvider);

  const res = await svc.executeTranslation({ manuscript, targetLanguage: 'de' });

  assert.equal(res.chunkCount, 2);
  assert.equal(res.failedChunks, 1);
  assert.match(res.translatedText, /\[TRANSLATION ERROR — original text below, retranslate manually\]/);
  // Failed chunk keeps the ORIGINAL text, not a translated placeholder.
  assert.ok(res.translatedText.includes(p1));
  // The other chunk still translated successfully.
  assert.ok(res.translatedText.includes('TRANSLATED:'));
  assert.ok(res.warnings.some(w => /Chunk 1\/2 failed after retry/.test(w)));
  assert.ok(res.warnings.some(w => /1 of 2 chunk\(s\) could not be translated/.test(w)));
});

// ── cost accounting ───────────────────────────────────────────────────────

test('executeTranslation: estimatedCost 0 from AI falls back to a words-based cost estimate', async () => {
  const svc = new TranslationPipelineService();
  const manuscript = 'word '.repeat(1000).trim();
  const { aiComplete, aiSelectProvider } = makeAI({ estimatedCost: 0 });
  svc.setAI(aiComplete, aiSelectProvider);

  const res = await svc.executeTranslation({ manuscript, targetLanguage: 'de' });

  // Mirrors the service's fallback: words = chars / 5.5; cost = round(words/1000 * 0.015, 2dp).
  const words = manuscript.length / 5.5;
  const expected = Math.round((words / 1000) * 0.015 * 100) / 100;
  assert.equal(res.estimatedCost, expected);
  assert.ok(res.estimatedCost > 0);
});

test('executeTranslation: non-zero router cost is summed across chunks (no fallback)', async () => {
  const svc = new TranslationPipelineService();
  const p1 = 'A'.repeat(4000);
  const p2 = 'B'.repeat(4000);
  const manuscript = [p1, p2].join('\n\n');
  const { aiComplete, aiSelectProvider } = makeAI({ estimatedCost: 0.02 });
  svc.setAI(aiComplete, aiSelectProvider);

  const res = await svc.executeTranslation({ manuscript, targetLanguage: 'de' });

  assert.equal(res.chunkCount, 2);
  assert.equal(res.estimatedCost, 0.04);
});
