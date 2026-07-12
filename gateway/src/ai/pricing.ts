/**
 * BookClaw LLM Pricing Table
 *
 * Per-model USD pricing so cost tracking reflects the actual model billed,
 * not just a flat per-provider rate. Ported (LLM subset only — no image
 * pricing) from the AuthorAgent fork's `gateway/src/services/pricing.ts` to
 * fix bug #35b: the router bills every non-default-model call at the
 * provider's flat boot rate, which underprices premium models like Opus by
 * roughly 40%.
 *
 * IMPORTANT: These are estimates, not billing-grade figures. Always confirm
 * current pricing on the provider's pricing page before relying on this for
 * financial decisions. `lastVerified` tracks when a row was last checked
 * against provider docs.
 */

/** ISO date this table was last checked against provider pricing pages. */
export const PRICING_LAST_VERIFIED = '2026-07-11';

export type CostConfidence = 'listed' | 'rough';

/**
 * Per-1K-token USD pricing for a single LLM model.
 *
 * `confidence`:
 *   'listed' — taken from the provider's published price sheet.
 *   'rough'  — estimate / not authoritatively verified.
 */
export interface LLMPrice {
  costPer1kInput: number;
  costPer1kOutput: number;
  confidence: CostConfidence;
  /** ISO date this row was last checked against a source. */
  lastVerified: string;
  /** Human-readable note — source, tier, caveats. */
  note: string;
}

/**
 * LLM pricing table, keyed by model id (the exact string sent to the
 * provider). Prices are USD per 1,000 tokens.
 */
export const LLM_PRICING: Record<string, LLMPrice> = {
  // ── Anthropic Claude ──
  'claude-sonnet-4-5': { costPer1kInput: 0.003, costPer1kOutput: 0.015, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'Claude Sonnet 4.5 — $3/$15 per MTok' },
  'claude-sonnet-4-5-20250929': { costPer1kInput: 0.003, costPer1kOutput: 0.015, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'Claude Sonnet 4.5 (dated alias) — $3/$15 per MTok' },
  'claude-opus-4-8': { costPer1kInput: 0.005, costPer1kOutput: 0.025, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'Claude Opus 4.8 — $5/$25 per MTok' },
  'claude-opus-4-5': { costPer1kInput: 0.005, costPer1kOutput: 0.025, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'Claude Opus 4.5 — $5/$25 per MTok' },
  'claude-opus-4-6': { costPer1kInput: 0.005, costPer1kOutput: 0.025, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'Claude Opus 4.6 — $5/$25 per MTok' },
  'claude-opus-4-7': { costPer1kInput: 0.005, costPer1kOutput: 0.025, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'Claude Opus 4.7 — $5/$25 per MTok' },
  'claude-haiku-4-5': { costPer1kInput: 0.001, costPer1kOutput: 0.005, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'Claude Haiku 4.5 — $1/$5 per MTok' },
  'claude-fable-5': { costPer1kInput: 0.010, costPer1kOutput: 0.050, confidence: 'rough', lastVerified: PRICING_LAST_VERIFIED, note: 'Claude Fable 5 — $10/$50 per MTok (above Opus tier); re-verify before budgeting' },

  // ── OpenAI ──
  'gpt-4o': { costPer1kInput: 0.0025, costPer1kOutput: 0.01, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'GPT-4o — $2.50/$10 per MTok' },
  'gpt-4o-mini': { costPer1kInput: 0.00015, costPer1kOutput: 0.0006, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'GPT-4o mini — $0.15/$0.60 per MTok' },

  // ── Google Gemini (free tier = $0) ──
  'gemini-2.5-flash': { costPer1kInput: 0, costPer1kOutput: 0, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'Gemini 2.5 Flash — free tier ($0), rate-limited' },
  'gemini-2.5-pro': { costPer1kInput: 0, costPer1kOutput: 0, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'Gemini 2.5 Pro — free tier ($0), rate-limited' },

  // ── DeepSeek ──
  'deepseek-chat': { costPer1kInput: 0.00014, costPer1kOutput: 0.00028, confidence: 'listed', lastVerified: PRICING_LAST_VERIFIED, note: 'DeepSeek Chat — $0.14/$0.28 per MTok' },
  'deepseek-reasoner': { costPer1kInput: 0.00055, costPer1kOutput: 0.00219, confidence: 'rough', lastVerified: PRICING_LAST_VERIFIED, note: 'DeepSeek Reasoner — rough estimate, re-verify' },
};

/**
 * Resolve per-1K pricing for an LLM model id.
 *
 * Returns the LLM_PRICING row when the model is known. For an unknown model
 * (a custom / future slug the user typed), returns the provided fallback
 * numbers with confidence 'rough' — so cost math keeps working and never
 * throws. Callers pass the provider's current flat rate as the fallback so
 * an unknown model at least bills like that provider's default.
 *
 * @param model    The model id (e.g. 'claude-sonnet-4-5', 'gemini-2.5-pro').
 * @param fallback Optional {costPer1kInput, costPer1kOutput} used when the
 *                 model isn't in LLM_PRICING. Defaults to 0/0.
 */
export function getLLMPrice(
  model: string,
  fallback?: { costPer1kInput: number; costPer1kOutput: number },
): LLMPrice {
  const known = LLM_PRICING[model];
  if (known) return known;

  const fb = fallback ?? { costPer1kInput: 0, costPer1kOutput: 0 };
  return {
    costPer1kInput: fb.costPer1kInput,
    costPer1kOutput: fb.costPer1kOutput,
    confidence: 'rough',
    lastVerified: PRICING_LAST_VERIFIED,
    note: `Unknown model "${model}" — using provider fallback pricing; unverified`,
  };
}
