/**
 * Unit tests for the AI router (gateway/src/ai/router.ts).
 *
 * Run via: npm run test:unit  (node --test through tsx)
 *
 * These exercise the PURE routing/budget logic with no network and no real
 * vault: a fake vault reports which API keys "exist" (so initialize() registers
 * the matching providers — every provider except Ollama is key-presence only,
 * no network call), Ollama is disabled in config so initialize() never makes
 * its one network probe, and a fake cost tracker drives the over-budget gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIRouter, getOutputBudget, getRecommendedThinking } from '../../gateway/src/ai/router.js';

// All provider keys the router knows how to register from the vault.
const ALL_KEYS = ['gemini_api_key', 'deepseek_api_key', 'anthropic_api_key', 'openai_api_key', 'openrouter_api_key'];

/**
 * Build an initialized router with a chosen set of present API keys.
 * Ollama is force-disabled so initialize() stays network-free and deterministic.
 */
async function makeRouter(opts: { keys?: string[]; overBudget?: boolean; config?: Record<string, unknown> } = {}): Promise<AIRouter> {
  const present = new Set(opts.keys ?? ALL_KEYS);
  const vault = { get: async (k: string) => (present.has(k) ? 'test-value' : null) };
  const costs = { isOverBudget: () => opts.overBudget ?? false };
  const config = { ollama: { enabled: false }, ...(opts.config ?? {}) };
  const router = new AIRouter(config, vault as never, costs as never);
  await router.initialize();
  return router;
}

// ── Pure helpers ──────────────────────────────────────────────────────────

test('getOutputBudget returns the per-task budget, 4096 for unknown tasks', () => {
  assert.equal(getOutputBudget('outline'), 16384);
  assert.equal(getOutputBudget('creative_writing'), 16384);
  assert.equal(getOutputBudget('book_bible'), 12288);
  assert.equal(getOutputBudget('general'), 4096);
  assert.equal(getOutputBudget('totally-unknown-task'), 4096);
});

test('getRecommendedThinking elevates reasoning-heavy tasks only', () => {
  assert.equal(getRecommendedThinking('consistency'), 'high');
  assert.equal(getRecommendedThinking('final_edit'), 'high');
  assert.equal(getRecommendedThinking('revision'), 'medium');
  // Length-heavy tasks intentionally get no thinking budget.
  assert.equal(getRecommendedThinking('outline'), undefined);
  assert.equal(getRecommendedThinking('creative_writing'), undefined);
  assert.equal(getRecommendedThinking('general'), undefined);
});

// ── initialize(): provider registration from vault keys ─────────────────────

test('initialize registers exactly the providers whose keys are present', async () => {
  const router = await makeRouter({ keys: ['gemini_api_key', 'openrouter_api_key'] });
  const active = router.getActiveProviders().map(p => p.id).sort();
  assert.deepEqual(active, ['gemini', 'openrouter']);
});

test('initialize with no keys and Ollama disabled registers nothing', async () => {
  const router = await makeRouter({ keys: [] });
  assert.deepEqual(router.getActiveProviders(), []);
});

// ── selectProvider(): tier routing ──────────────────────────────────────────

test('selectProvider routes free-tier tasks to the first available free provider', async () => {
  // free order: gemini, ollama, deepseek, openrouter, openai, claude
  const router = await makeRouter();
  assert.equal(router.selectProvider('general').id, 'gemini');
  assert.equal(router.selectProvider('research').id, 'gemini');
});

test('selectProvider routes premium tasks to the first available premium provider', async () => {
  // premium order: claude, openai, openrouter, gemini, deepseek, ollama
  const router = await makeRouter();
  assert.equal(router.selectProvider('final_edit').id, 'claude');
});

test('selectProvider routes mid-tier tasks per the mid order', async () => {
  // mid order: gemini, deepseek, openrouter, claude, openai, ollama
  const router = await makeRouter();
  assert.equal(router.selectProvider('creative_writing').id, 'gemini');
});

test('selectProvider treats an unknown task type as the general (free) tier', async () => {
  const router = await makeRouter();
  assert.equal(router.selectProvider('no-such-task').id, 'gemini');
});

test('selectProvider falls through the tier order when higher-priority providers are absent', async () => {
  // premium order is claude, openai, openrouter, ...; with only openrouter present
  // it should be chosen for a premium task.
  const router = await makeRouter({ keys: ['openrouter_api_key'] });
  assert.equal(router.selectProvider('final_edit').id, 'openrouter');
});

// ── selectProvider(): preferred-provider override ───────────────────────────

test('a global preferred provider wins regardless of task tier', async () => {
  const router = await makeRouter();
  router.setGlobalPreferredProvider('openai');
  // 'general' is free-tier and would normally route to gemini.
  assert.equal(router.selectProvider('general').id, 'openai');
  assert.equal(router.selectProvider('final_edit').id, 'openai');
});

test('a per-call preferred id overrides the global preference', async () => {
  const router = await makeRouter();
  router.setGlobalPreferredProvider('openai');
  assert.equal(router.selectProvider('general', 'deepseek').id, 'deepseek');
});

test('an unavailable preferred provider falls back to tier routing', async () => {
  // Prefer claude, but no anthropic key present → fall back to the free-tier route.
  const router = await makeRouter({ keys: ['gemini_api_key'] });
  router.setGlobalPreferredProvider('claude');
  assert.equal(router.selectProvider('general').id, 'gemini');
});

// ── selectProvider(): budget gate ───────────────────────────────────────────

test('over budget, selectProvider skips paid providers in favor of a free one', async () => {
  // premium order: claude(paid, skipped), openai(paid, skipped), openrouter(cheap,
  // skipped — non-free), gemini(free) → gemini.
  const router = await makeRouter({ overBudget: true });
  assert.equal(router.selectProvider('final_edit').id, 'gemini');
});

test('over budget with only paid providers, selectProvider fails closed (matches getFallbackProvider)', async () => {
  // Only claude present (paid). Over budget, the tier loop skips it and the
  // absolute fallback no longer returns a paid provider — it throws rather than
  // silently burning budget, mirroring getFallbackProvider's fail-closed return.
  // (Code-review 2026-06-12, finding F17: the absolute fallback must honor the
  // budget cap instead of bypassing it.)
  const router = await makeRouter({ keys: ['anthropic_api_key'], overBudget: true });
  assert.throws(() => router.selectProvider('final_edit'), /No AI providers available/);
});

test('selectProvider throws when no providers are available', async () => {
  const router = await makeRouter({ keys: [] });
  assert.throws(() => router.selectProvider('general'), /No AI providers available/);
});

// ── getFallbackProvider() ───────────────────────────────────────────────────

test('getFallbackProvider prefers a free provider and excludes the current one', async () => {
  const router = await makeRouter();
  const fb = router.getFallbackProvider('claude');
  assert.ok(fb, 'expected a fallback provider');
  assert.equal(fb!.tier, 'free');
  assert.notEqual(fb!.id, 'claude');
});

test('getFallbackProvider returns null when over budget and no free provider exists', async () => {
  const router = await makeRouter({ keys: ['anthropic_api_key', 'openai_api_key'], overBudget: true });
  // current = claude; only paid providers remain and we are over budget → fail closed.
  assert.equal(router.getFallbackProvider('claude'), null);
});

test('getFallbackProvider returns a paid provider when under budget and no free one exists', async () => {
  const router = await makeRouter({ keys: ['anthropic_api_key', 'openai_api_key'], overBudget: false });
  const fb = router.getFallbackProvider('claude');
  assert.ok(fb);
  assert.equal(fb!.id, 'openai');
});

// ── complete(): per-call model override ─────────────────────────────────────
// complete() makes a real fetch, so stub it to capture the model on the wire.

/** Run `fn` with global fetch stubbed to capture the outgoing request body. */
async function withFetchCapture(fn: (getBody: () => any) => Promise<void>): Promise<void> {
  let sentBody: any = null;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: any) => ({
    ok: true,
    json: async () => { sentBody = JSON.parse(init.body); return { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }; },
    text: async () => '',
  })) as never;
  try {
    await fn(() => sentBody);
  } finally {
    globalThis.fetch = orig;
  }
}

test('complete sends the per-call model override on the wire', async () => {
  const router = await makeRouter({ keys: ['openrouter_api_key'] });
  await withFetchCapture(async (getBody) => {
    await router.complete({
      provider: 'openrouter',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      model: 'meta-llama/llama-3.3-70b-instruct',
    });
    assert.equal(getBody().model, 'meta-llama/llama-3.3-70b-instruct');
  });
});

test('complete uses the provider default model when no override is given', async () => {
  const router = await makeRouter({ keys: ['openrouter_api_key'], config: { openrouter: { model: 'default/model-x' } } });
  await withFetchCapture(async (getBody) => {
    await router.complete({
      provider: 'openrouter',
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(getBody().model, 'default/model-x');
  });
});

// ── complete(): real cost (usage.cost) + 429 retry ──────────────────────────

/** A minimal OpenAI-compatible JSON response with the given usage object. */
function okResponse(usage: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '',
    json: async () => ({ choices: [{ message: { content: 'ok' } }], usage }),
  };
}

/** Run `fn` with global fetch replaced by `stub`, restoring it afterward. */
async function withFetch(stub: (...args: unknown[]) => unknown, fn: () => Promise<void>): Promise<void> {
  const orig = globalThis.fetch;
  globalThis.fetch = stub as never;
  try { await fn(); } finally { globalThis.fetch = orig; }
}

test('complete reports the provider-supplied usage.cost when present', async () => {
  const router = await makeRouter({ keys: ['openrouter_api_key'] });
  // 1000+1000 tokens would estimate to 0.018 via the placeholder; the real
  // reported cost (0.0123) must win.
  await withFetch(async () => okResponse({ prompt_tokens: 1000, completion_tokens: 1000, cost: 0.0123 }), async () => {
    const r = await router.complete({ provider: 'openrouter', system: 's', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.estimatedCost, 0.0123);
  });
});

test('complete falls back to the placeholder estimate when no usage.cost is given', async () => {
  const router = await makeRouter({ keys: ['openrouter_api_key'] });
  // openrouter placeholder: 0.003/1k in + 0.015/1k out → 1*0.003 + 1*0.015.
  await withFetch(async () => okResponse({ prompt_tokens: 1000, completion_tokens: 1000 }), async () => {
    const r = await router.complete({ provider: 'openrouter', system: 's', messages: [{ role: 'user', content: 'hi' }] });
    assert.ok(Math.abs(r.estimatedCost - 0.018) < 1e-9, `expected ~0.018, got ${r.estimatedCost}`);
  });
});

test('complete retries once on HTTP 429 and then succeeds', async () => {
  const router = await makeRouter({ keys: ['openrouter_api_key'] });
  let calls = 0;
  const stub = async () => {
    calls++;
    if (calls === 1) {
      return { ok: false, status: 429, headers: { get: () => null }, text: async () => 'rate limited' };
    }
    return okResponse({ prompt_tokens: 1, completion_tokens: 1 });
  };
  await withFetch(stub, async () => {
    const r = await router.complete({ provider: 'openrouter', system: 's', messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(r.text, 'ok');
    assert.equal(calls, 2, 'expected exactly one retry after the 429');
  });
});

// ── completeClaude: thinking budget + empty-completion guard ─────────────────

/**
 * Run `fn` with fetch stubbed to a Claude-shaped response carrying `respContent`
 * as the `content` block array. Captures the outgoing request body for asserts.
 */
async function withClaudeCapture(
  respContent: unknown[],
  fn: (getBody: () => any) => Promise<void>,
  stopReason = 'end_turn',
): Promise<void> {
  let sentBody: any = null;
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: any) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => '',
    json: async () => { sentBody = JSON.parse(init.body); return { content: respContent, usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: stopReason }; },
  })) as never;
  try { await fn(() => sentBody); } finally { globalThis.fetch = orig; }
}

test('Claude thinking budget is added on top of the output budget, not subtracted from it (finding 13)', async () => {
  // high → 16384 thinking budget; the visible output budget (8192) must survive
  // in full, so max_tokens = 8192 + 16384. The old Math.max(maxTokens,
  // thinkingBudget+2048) left only ~2048 visible tokens.
  const router = await makeRouter({ keys: ['anthropic_api_key'] });
  await withClaudeCapture([{ type: 'text', text: 'ok' }], async (getBody) => {
    await router.complete({
      provider: 'claude', system: 's', messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 8192, thinking: 'high',
    });
    assert.equal(getBody().thinking.budget_tokens, 16384);
    assert.equal(getBody().max_tokens, 8192 + 16384);
  });
});

test('Claude throws on an empty completion so the caller fallback fires (finding 14)', async () => {
  // A thinking-only response (max_tokens exhausted mid-CoT) has no text block.
  // Every other provider throws on empty; Claude must too, not return ''.
  const router = await makeRouter({ keys: ['anthropic_api_key'] });
  await withClaudeCapture([{ type: 'thinking', thinking: 'reasoning...' }], async () => {
    await assert.rejects(
      router.complete({ provider: 'claude', system: 's', messages: [{ role: 'user', content: 'hi' }], thinking: 'high' }),
      /empty completion/i,
    );
  }, 'max_tokens');
});

test('DeepSeek max_tokens is clamped to the provider cap, not the task budget (finding 15)', async () => {
  // DeepSeek caps output at 8192; passing the 16384 task budget unclamped makes
  // the API reject the call. The router must clamp to provider.maxTokens.
  const router = await makeRouter({ keys: ['deepseek_api_key'] });
  await withFetchCapture(async (getBody) => {
    await router.complete({
      provider: 'deepseek', system: 's', messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 16384,
    });
    assert.equal(getBody().max_tokens, 8192);
  });
});
