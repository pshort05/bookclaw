/**
 * Unit tests for VERIFIED Low bugs #29 and #35 (gateway/src/ai/router.ts).
 *
 * #29a — Gemini parsed only parts[0] of a multi-part response, truncating
 *        multi-part generations.
 * #29b — OpenAI o-series (reasoning) requests got no headroom for hidden
 *        reasoning tokens in max_completion_tokens, mirroring the #9 bug
 *        that effectiveMaxOutputTokens already fixed for Gemini/Claude.
 * #35a — Prompt-cache "savedTokens" was a fabricated stat: no caching
 *        directive is ever sent to any provider, so there was nothing to save.
 * #35b — A paid-tier Gemini key's real spend was hardcoded to $0 and never
 *        reached the budget gate; now honors an explicit config opt-in.
 * #35c — Anthropic's 529 (Overloaded) status was not retried by fetchWithRetry.
 * #35d — `thinking` unconditionally swapped a caller-pinned `deepseek-chat`
 *        to `deepseek-reasoner`, silently overriding an explicit model pin.
 * #35e — Budget-exhaustion (providers configured but all over budget) threw
 *        the same message as "nothing configured", misdirecting users.
 * #35f — TASK_OUTPUT_BUDGET.book_bible (12288) contradicted CLAUDE.md's
 *        documented 16K requirement for outline/book_bible/creative_writing.
 *
 * Run via: node --import tsx --test tests/unit/router-low-fixes.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRouter, effectiveMaxOutputTokens, getOutputBudget } from '../../gateway/src/ai/router.js';

const ALL_KEYS = ['gemini_api_key', 'deepseek_api_key', 'anthropic_api_key', 'openai_api_key', 'openrouter_api_key'];

async function makeRouter(opts: { keys?: string[]; overBudget?: boolean; config?: Record<string, unknown> } = {}): Promise<AIRouter> {
  const present = new Set(opts.keys ?? ALL_KEYS);
  const vault = { get: async (k: string) => (present.has(k) ? 'test-value' : null) };
  const costs = { isOverBudget: () => opts.overBudget ?? false };
  const config = { ollama: { enabled: false }, ...(opts.config ?? {}) };
  const router = new AIRouter(config, vault as never, costs as never);
  await router.initialize();
  return router;
}

/** Run `fn` with fetch stubbed to always return `respBody`, capturing the outgoing body. */
async function withCapture(
  respBody: any,
  fn: (getBody: () => any) => Promise<void>,
): Promise<void> {
  let sentBody: any = null;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: any) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '',
    json: async () => { sentBody = JSON.parse(init.body); return respBody; },
  })) as never;
  try { await fn(() => sentBody); } finally { globalThis.fetch = orig; }
}

// ── #29a: Gemini multi-part text join ───────────────────────────────────────

test('Gemini response with multiple text parts joins ALL parts, not just parts[0] (bug #29a)', async () => {
  const router = await makeRouter({ keys: ['gemini_api_key'] });
  await withCapture(
    {
      candidates: [{
        content: { parts: [{ text: 'Hello, ' }, { text: 'world.' }] },
        finishReason: 'STOP',
      }],
      usageMetadata: {},
    },
    async () => {
      const r = await router.complete({ provider: 'gemini', system: 's', messages: [{ role: 'user', content: 'hi' }] });
      assert.equal(r.text, 'Hello, world.');
    },
  );
});

// ── #29b: OpenAI o-series reasoning headroom ────────────────────────────────

test('OpenAI o-series max_completion_tokens adds the reasoning budget on top (bug #29b)', async () => {
  const router = await makeRouter({ keys: ['openai_api_key'] });
  await withCapture(
    { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    async (getBody) => {
      await router.complete({
        provider: 'openai', system: 's', messages: [{ role: 'user', content: 'hi' }],
        model: 'o1-mini', thinking: 'high', maxTokens: 4096,
      });
      const body = getBody();
      assert.equal(body.max_completion_tokens, effectiveMaxOutputTokens(4096, 16384));
      assert.equal(body.max_tokens, undefined);
    },
  );
});

test('OpenAI non-reasoning model (gpt-4o) with thinking set uses plain max_tokens, no headroom added', async () => {
  const router = await makeRouter({ keys: ['openai_api_key'], config: { openai: { model: 'gpt-4o' } } });
  await withCapture(
    { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    async (getBody) => {
      await router.complete({
        provider: 'openai', system: 's', messages: [{ role: 'user', content: 'hi' }],
        thinking: 'high', maxTokens: 4096,
      });
      const body = getBody();
      assert.equal(body.max_tokens, 4096);
      assert.equal(body.max_completion_tokens, undefined);
    },
  );
});

// ── #35a: no fabricated cache savings ────────────────────────────────────────

test('getCacheStats reports real hit/miss counts but no fabricated savedTokens stat (bug #35a)', async () => {
  const router = await makeRouter({ keys: ['openrouter_api_key'] });
  await withCapture(
    { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    async () => {
      // Same system prompt twice → second call is a cache "hit" (local dedup).
      await router.complete({ provider: 'openrouter', system: 'same-system-prompt', messages: [{ role: 'user', content: 'a' }] });
      await router.complete({ provider: 'openrouter', system: 'same-system-prompt', messages: [{ role: 'user', content: 'b' }] });
      const stats: any = router.getCacheStats();
      assert.equal(stats.hits, 1);
      assert.equal(stats.misses, 1);
      assert.equal('savedTokens' in stats, false, `expected no savedTokens field, got: ${JSON.stringify(stats)}`);
    },
  );
});

// ── #35b: paid-tier Gemini spend ─────────────────────────────────────────────

test('Gemini stays free-tier ($0 cost) by default with no config signal (bug #35b, regression)', async () => {
  const router = await makeRouter({ keys: ['gemini_api_key'] });
  assert.equal(router.getActiveProviders().find(p => p.id === 'gemini')?.tier, 'free');
  await withCapture(
    { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1000 } },
    async () => {
      const r = await router.complete({ provider: 'gemini', system: 's', messages: [{ role: 'user', content: 'hi' }] });
      assert.equal(r.estimatedCost, 0);
    },
  );
});

test('Gemini honors an explicit paidTier config signal and reports real estimatedCost (bug #35b)', async () => {
  const router = await makeRouter({
    keys: ['gemini_api_key'],
    config: { gemini: { paidTier: true, costPer1kInput: 0.001, costPer1kOutput: 0.002 } },
  });
  assert.equal(router.getActiveProviders().find(p => p.id === 'gemini')?.tier, 'paid');
  await withCapture(
    { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1000 } },
    async () => {
      const r = await router.complete({ provider: 'gemini', system: 's', messages: [{ role: 'user', content: 'hi' }] });
      assert.ok(Math.abs(r.estimatedCost - 0.003) < 1e-9, `expected ~0.003, got ${r.estimatedCost}`);
    },
  );
});

// ── #35c: Anthropic 529 retried ──────────────────────────────────────────────

test('fetchWithRetry (via complete) retries on Anthropic 529 and then succeeds (bug #35c)', async () => {
  const router = await makeRouter({ keys: ['anthropic_api_key'] });
  let calls = 0;
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) {
      return { ok: false, status: 529, headers: { get: () => null }, text: async () => 'overloaded' };
    }
    return {
      ok: true, status: 200, headers: { get: () => null }, text: async () => '',
      json: async () => ({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }),
    };
  }) as never;
  try {
    const r = await router.complete({ provider: 'claude', system: 's', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.text, 'ok');
    assert.equal(calls, 2, 'expected exactly one retry after the 529');
  } finally {
    globalThis.fetch = orig;
  }
});

// ── #35d: pinned deepseek model not swapped by thinking ─────────────────────

test('thinking does NOT swap an explicitly pinned deepseek-chat to deepseek-reasoner (bug #35d)', async () => {
  const router = await makeRouter({ keys: ['deepseek_api_key'] });
  await withCapture(
    { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    async (getBody) => {
      await router.complete({
        provider: 'deepseek', system: 's', messages: [{ role: 'user', content: 'hi' }],
        model: 'deepseek-chat', thinking: 'high',
      });
      assert.equal(getBody().model, 'deepseek-chat');
    },
  );
});

test('thinking DOES swap the default (unpinned) deepseek model to deepseek-reasoner', async () => {
  const router = await makeRouter({ keys: ['deepseek_api_key'] });
  await withCapture(
    { choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    async (getBody) => {
      await router.complete({
        provider: 'deepseek', system: 's', messages: [{ role: 'user', content: 'hi' }],
        thinking: 'high',
      });
      assert.equal(getBody().model, 'deepseek-reasoner');
    },
  );
});

// ── #35e: budget-exhausted vs not-configured error messages ────────────────

test('selectProvider throws a "not configured" message when no providers exist at all (bug #35e, regression)', async () => {
  const router = await makeRouter({ keys: [] });
  assert.throws(() => router.selectProvider('general'), /configure/i);
});

test('selectProvider throws a budget-exhausted message (not "configure") when providers exist but are all over budget (bug #35e)', async () => {
  const router = await makeRouter({ keys: ['anthropic_api_key'], overBudget: true });
  assert.throws(() => router.selectProvider('general'), /budget/i);
  try {
    router.selectProvider('general');
    assert.fail('expected selectProvider to throw');
  } catch (err: any) {
    assert.ok(!/please configure/i.test(err.message), `message should not blame missing configuration, got: ${err.message}`);
  }
});

// ── #35f: book_bible budget aligned with CLAUDE.md's documented 16K ────────

test('TASK_OUTPUT_BUDGET.book_bible is 32768, matching outline (reasoning-CoT headroom, 2026-07-19)', () => {
  assert.equal(getOutputBudget('book_bible'), 32768);
  assert.equal(getOutputBudget('book_bible'), getOutputBudget('outline'));
});
