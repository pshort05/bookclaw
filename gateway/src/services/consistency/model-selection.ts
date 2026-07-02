import { isValidModelId } from '../../ai/model-id.js';

/** Every provider BookClaw can route to (the shared validator's allowlist). */
export const KNOWN_PROVIDERS = ['gemini','deepseek','claude','openai','ollama','openrouter'] as const;

/**
 * Providers eligible for the consistency audit. Ollama is deliberately EXCLUDED:
 * the extractor sends a whole chapter (often >4k tokens) in one call, and a local
 * model's default context truncates that input on most systems — yielding non-JSON
 * output that silently fails extraction. Consistency needs a large-context model
 * (Gemini, Claude, OpenAI, DeepSeek, or OpenRouter).
 */
export const CONSISTENCY_PROVIDERS = ['gemini','deepseek','claude','openai','openrouter'] as const;

export interface ModelSel { provider?: string; model?: string }

/** True when a provider has the context window to take a whole chapter in one
 *  call (the CONSISTENCY_PROVIDERS set — excludes Ollama/other local models). */
export function isLargeContextProvider(providerId: string | undefined): boolean {
  return !!providerId && (CONSISTENCY_PROVIDERS as readonly string[]).includes(providerId);
}

/**
 * Guard for auto-routed context/summary/entity extraction (run-review 2026-07-01
 * B6). Extraction sends a whole chapter in one call, so a small local model
 * (Ollama) truncates it → failed/garbage extraction that corrupts continuity
 * tracking. Returns an error string when the auto-selected provider should be
 * REFUSED (caller skips the extraction, fail-soft), or null when it's fine.
 *
 * Ollama is refused ONLY when a large-context provider is actually available —
 * i.e. routing transiently fell back to Ollama while a capable provider exists.
 * On an Ollama-only deployment (no capable provider at all) it is allowed, so this
 * never regresses that setup; it just stops a momentary fallback from silently
 * degrading extraction on a deployment that has a large-context model.
 */
export function extractionProviderError(selectedId: string, availableProviderIds: string[]): string | null {
  if (isLargeContextProvider(selectedId)) return null;
  const hasCapable = availableProviderIds.some(id => isLargeContextProvider(id));
  if (!hasCapable) return null;
  return `Extraction skipped: routing fell back to "${selectedId}" while a large-context provider (${CONSISTENCY_PROVIDERS.join(', ')}) is configured but was unavailable for this call — a local model would truncate the chapter.`;
}

/**
 * Validate an optional provider/model selection from a request body. Returns an
 * error string (→ 400) or null when acceptable. Provider, if present, must be a
 * known provider; model, if present, must be a safe id (it reaches the provider
 * API verbatim — for Gemini, the request URL path). Both absent = auto. Shared
 * by the prompt-runner route (which permits Ollama); the consistency route uses
 * the stricter validateConsistencyModelSelection below.
 */
export function validateModelSelection(body: any): string | null {
  const provider = body?.provider;
  const model = body?.model;
  if (provider !== undefined && provider !== null && provider !== '') {
    if (typeof provider !== 'string' || !(KNOWN_PROVIDERS as readonly string[]).includes(provider)) {
      return `Invalid provider. Use one of: ${KNOWN_PROVIDERS.join(', ')}`;
    }
  }
  if (model !== undefined && model !== null && model !== '') {
    if (!isValidModelId(model)) return 'Invalid model id';
  }
  return null;
}

/**
 * Stricter validation for the consistency audit: a valid model selection that
 * additionally rejects providers without the context window for a full chapter
 * (i.e. Ollama). Returns an error string (→ 400) or null.
 */
export function validateConsistencyModelSelection(body: any): string | null {
  const base = validateModelSelection(body);
  if (base) return base;
  const provider = body?.provider;
  if (typeof provider === 'string' && provider && !(CONSISTENCY_PROVIDERS as readonly string[]).includes(provider)) {
    return `Provider "${provider}" is not supported for consistency analysis — it needs a large-context model. Use one of: ${CONSISTENCY_PROVIDERS.join(', ')}`;
  }
  return null;
}

/**
 * Effective selection: per-run override → per-book default → auto.
 * Invalid/unsupported provider falls back to auto; a model is kept only with a
 * valid (consistency-capable) provider — so a stale Ollama default resolves to auto.
 */
export function resolveConsistencyModel(perRun: ModelSel | undefined, perBook: ModelSel | undefined): ModelSel {
  // Per-run wins only when it actually names a provider; otherwise fall through
  // to the per-book default, then to auto. The POST route always passes a
  // non-null override object ({provider:undefined,...}), so we must look past
  // object null-ness to the provider field — a plain `perRun ?? perBook` would
  // make the saved per-book default unreachable.
  const runHasProvider = typeof perRun?.provider === 'string' && perRun.provider.trim().length > 0;
  const pick = runHasProvider ? perRun! : (perBook ?? {});
  const p = pick.provider?.trim();
  const provider = p && (CONSISTENCY_PROVIDERS as readonly string[]).includes(p) ? p : undefined;
  const model = provider && typeof pick.model === 'string' && pick.model.trim() ? pick.model.trim() : undefined;
  return { provider, model };
}

/**
 * Capability gate: given the resolved selection and the currently-available
 * provider ids, return an error string when the audit cannot run with a
 * large-context model, or null when it can. Lets the route fail loudly up front
 * instead of silently dropping every chapter.
 */
export function consistencyCapabilityError(sel: ModelSel, availableProviderIds: string[]): string | null {
  const capable = CONSISTENCY_PROVIDERS as readonly string[];
  if (sel.provider) {
    // resolveConsistencyModel already constrained sel.provider to a capable one;
    // here it just must actually be configured/available.
    if (!availableProviderIds.includes(sel.provider)) {
      return `The selected provider "${sel.provider}" is not configured. Add its API key in Settings, or pick another.`;
    }
    return null;
  }
  if (!availableProviderIds.some(id => capable.includes(id))) {
    return `No model capable of consistency analysis is configured. Add a large-context provider (${capable.join(', ')}) in Settings — Ollama/local models are not supported for this task.`;
  }
  return null;
}
