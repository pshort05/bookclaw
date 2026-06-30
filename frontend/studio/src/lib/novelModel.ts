/**
 * Easy Start full-novel model guidance (owner ask 2026-06-30).
 *
 * The "My Third Medical Romance" run on gemini-3.5-flash drifted on character
 * names, the title, and continuity, and truncated whole-manuscript passes. Rather
 * than a brittle hard allowlist, Easy Start surfaces a non-blocking warning when
 * the chosen model looks like a fast/cheap tier. The signal is model STRENGTH (a
 * name heuristic), NOT context window — gemini-flash has a huge context window but
 * still drifted; the failure was weaker instruction-following + unreliable long
 * output, which the fast/lightweight variants share.
 */

// Fast/lightweight model variants + small parameter counts (≤ ~99B). 3-digit
// param counts (e.g. 405b) are intentionally NOT matched — those are strong.
// Left-boundary guard (?<![a-z]) so "mini" doesn't match inside "geMINI", etc.
const WEAK_TIER =
  /(?<![a-z])(?:flash|mini|nano|lite|instant|haiku|small|tiny|gemma|phi)|[-_/ ]\d{1,2}b\b/i;

export function novelModelAdvice(modelId: string): { weak: boolean; note?: string } {
  const id = String(modelId ?? '').toLowerCase().trim();
  if (!id) return { weak: false };
  if (WEAK_TIER.test(id)) {
    return {
      weak: true,
      note: 'This looks like a fast/lightweight model. On a full novel these tend to drift on character names, the title, and continuity, and can truncate long passes. For a whole book, prefer a frontier model (e.g. Claude Sonnet/Opus, a GPT-class model, Gemini Pro, or DeepSeek-V3).',
    };
  }
  return { weak: false };
}
