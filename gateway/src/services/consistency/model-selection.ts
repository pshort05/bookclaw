/** Provider/model selection for the consistency audit's fact extraction. */
export const CONSISTENCY_PROVIDERS = ['gemini','deepseek','claude','openai','ollama','openrouter'] as const;

export interface ModelSel { provider?: string; model?: string }

/**
 * Effective selection: per-run override → per-book default → auto.
 * Invalid provider falls back to auto; a model is kept only with a valid provider.
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
