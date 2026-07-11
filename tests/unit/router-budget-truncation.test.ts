/**
 * Unit tests for two router bugs (gateway/src/ai/router.ts):
 *
 * #9  — Gemini high-reasoning starves its own output. The Gemini path set
 *       generationConfig.maxOutputTokens to the visible-output budget alone,
 *       without adding the thinking budget on top (the Claude path already
 *       does this correctly). On Gemini 2.5/3, thinking tokens are deducted
 *       from the same maxOutputTokens pool, so a high-thinking request could
 *       spend the whole cap thinking and return empty visible text.
 *
 * #10 — Truncated output was never detected. No completion path checked the
 *       provider's max-tokens/length finish reason, so a non-empty but
 *       truncated response returned as ordinary success. Separately, the
 *       DeepSeek clamp silently halves a 16384-token request to 8192 with no
 *       visible signal.
 *
 * Run via: node --import tsx --test tests/unit/router-budget-truncation.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRouter, effectiveMaxOutputTokens } from '../../gateway/src/ai/router.js';

async function makeRouter(opts: { keys?: string[] } = {}): Promise<AIRouter> {
  const ALL_KEYS = ['gemini_api_key', 'deepseek_api_key', 'anthropic_api_key', 'openai_api_key', 'openrouter_api_key'];
  const present = new Set(opts.keys ?? ALL_KEYS);
  const vault = { get: async (k: string) => (present.has(k) ? 'test-value' : null) };
  const costs = { isOverBudget: () => false };
  const config = { ollama: { enabled: false } };
  const router = new AIRouter(config, vault as never, costs as never);
  await router.initialize();
  return router;
}

/** Run `fn` with fetch stubbed to a Gemini-shaped response, capturing the outgoing body. */
async function withGeminiCapture(
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

// ── #9: pure helper ─────────────────────────────────────────────────────────

test('effectiveMaxOutputTokens adds the thinking budget on top of the visible-output budget', () => {
  assert.equal(effectiveMaxOutputTokens(8192, 16384), 8192 + 16384);
  assert.equal(effectiveMaxOutputTokens(4096, 1024), 4096 + 1024);
});

test('effectiveMaxOutputTokens returns the plain maxTokens when no thinking budget is given', () => {
  assert.equal(effectiveMaxOutputTokens(8192, null), 8192);
  assert.equal(effectiveMaxOutputTokens(8192, undefined), 8192);
});

// ── #9: Gemini path wires the helper into the actual request body ──────────

test('Gemini high-reasoning request adds the thinking budget on top of maxOutputTokens (bug #9)', async () => {
  const router = await makeRouter({ keys: ['gemini_api_key'] });
  await withGeminiCapture(
    { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: {} },
    async (getBody) => {
      await router.complete({
        provider: 'gemini', system: 's', messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 8192, thinking: 'high',
      });
      assert.equal(getBody().generationConfig.thinkingConfig.thinkingBudget, 16384);
      assert.equal(getBody().generationConfig.maxOutputTokens, 8192 + 16384);
    },
  );
});

test('Gemini request with no thinking leaves maxOutputTokens unchanged', async () => {
  const router = await makeRouter({ keys: ['gemini_api_key'] });
  await withGeminiCapture(
    { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: {} },
    async (getBody) => {
      await router.complete({
        provider: 'gemini', system: 's', messages: [{ role: 'user', content: 'hi' }],
        maxTokens: 8192,
      });
      assert.equal(getBody().generationConfig.maxOutputTokens, 8192);
      assert.equal(getBody().generationConfig.thinkingConfig, undefined);
    },
  );
});

// ── #10: truncation detection per provider ──────────────────────────────────

test('Gemini response with finishReason MAX_TOKENS sets CompletionResponse.truncated (bug #10)', async () => {
  const router = await makeRouter({ keys: ['gemini_api_key'] });
  await withGeminiCapture(
    { candidates: [{ content: { parts: [{ text: 'partial answer...' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: {} },
    async () => {
      const r = await router.complete({ provider: 'gemini', system: 's', messages: [{ role: 'user', content: 'hi' }] });
      assert.equal(r.truncated, true);
    },
  );
});

test('Gemini response with finishReason STOP leaves truncated falsy', async () => {
  const router = await makeRouter({ keys: ['gemini_api_key'] });
  await withGeminiCapture(
    { candidates: [{ content: { parts: [{ text: 'complete answer.' }] }, finishReason: 'STOP' }], usageMetadata: {} },
    async () => {
      const r = await router.complete({ provider: 'gemini', system: 's', messages: [{ role: 'user', content: 'hi' }] });
      assert.ok(!r.truncated);
    },
  );
});

test('Claude response with stop_reason max_tokens sets CompletionResponse.truncated (bug #10)', async () => {
  const router = await makeRouter({ keys: ['anthropic_api_key'] });
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '',
    json: async () => ({ content: [{ type: 'text', text: 'partial...' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'max_tokens' }),
  })) as never;
  try {
    const r = await router.complete({ provider: 'claude', system: 's', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.truncated, true);
  } finally {
    globalThis.fetch = orig;
  }
});

test('Claude response with stop_reason end_turn leaves truncated falsy', async () => {
  const router = await makeRouter({ keys: ['anthropic_api_key'] });
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '',
    json: async () => ({ content: [{ type: 'text', text: 'complete.' }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }),
  })) as never;
  try {
    const r = await router.complete({ provider: 'claude', system: 's', messages: [{ role: 'user', content: 'hi' }] });
    assert.ok(!r.truncated);
  } finally {
    globalThis.fetch = orig;
  }
});

test('OpenAI-compatible response with finish_reason length sets CompletionResponse.truncated (bug #10)', async () => {
  const router = await makeRouter({ keys: ['openrouter_api_key'] });
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '',
    json: async () => ({ choices: [{ message: { content: 'partial...' }, finish_reason: 'length' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
  })) as never;
  try {
    const r = await router.complete({ provider: 'openrouter', system: 's', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.truncated, true);
  } finally {
    globalThis.fetch = orig;
  }
});

test('OpenAI-compatible response with finish_reason stop leaves truncated falsy', async () => {
  const router = await makeRouter({ keys: ['openrouter_api_key'] });
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '',
    json: async () => ({ choices: [{ message: { content: 'complete.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
  })) as never;
  try {
    const r = await router.complete({ provider: 'openrouter', system: 's', messages: [{ role: 'user', content: 'hi' }] });
    assert.ok(!r.truncated);
  } finally {
    globalThis.fetch = orig;
  }
});

// ── #10: DeepSeek clamp is observable ───────────────────────────────────────

test('DeepSeek clamping the requested budget down logs a warning', async () => {
  const router = await makeRouter({ keys: ['deepseek_api_key'] });
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '',
    json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
  })) as never;
  const origWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
  try {
    await router.complete({
      provider: 'deepseek', system: 's', messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 16384,
    });
    assert.ok(warnings.some(w => w.includes('⚠') && /clamp/i.test(w)), `expected a clamp warning, got: ${JSON.stringify(warnings)}`);
  } finally {
    globalThis.fetch = orig;
    console.warn = origWarn;
  }
});

test('DeepSeek NOT clamping (request within cap) logs no clamp warning', async () => {
  const router = await makeRouter({ keys: ['deepseek_api_key'] });
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '',
    json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
  })) as never;
  const origWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
  try {
    await router.complete({
      provider: 'deepseek', system: 's', messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 4096,
    });
    assert.ok(!warnings.some(w => /clamp/i.test(w)), `expected no clamp warning, got: ${JSON.stringify(warnings)}`);
  } finally {
    globalThis.fetch = orig;
    console.warn = origWarn;
  }
});
