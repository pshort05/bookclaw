/**
 * Scene-heat routing decision (Flagship Plan 2).
 *
 * A per-chapter heat_check scores a scene brief {spice, violence} 0-10.
 * intimacyDecision() is a PURE function combining that score with the book's
 * content ceiling and the casting sheet's heatLadder to decide whether a
 * flagged scene stays on-page (Claude, fade-to-black framing or emotional
 * intimacy template) or re-routes to an uncensored provider. Ceiling clamps
 * a scene so it is never written more explicit than the author's brand.
 */

export interface HeatScore { spice: number; violence: number }

export interface HeatLadderLike {
  eroticaThreshold: number;
  uncensoredByLevel: Array<{ minSpice: number; provider: string; model?: string }>;
  rerouteRoles: string[];
}

export interface IntimacyDecision {
  mode: 'fade' | 'onpage_claude' | 'uncensored';
  spiceRoute: { provider: string; model?: string } | null;
  effectiveSpice: number;
  template: string | null;
}

function ladderModel(ladder: HeatLadderLike, spice: number): { provider: string; model?: string } | null {
  const eligible = ladder.uncensoredByLevel.filter(e => spice >= e.minSpice).sort((a, b) => b.minSpice - a.minSpice);
  return eligible[0] ? { provider: eligible[0].provider, model: eligible[0].model } : null;
}

/** The ladder's least-explicit uncensored rung — the guaranteed fallback when a
 * refusal forces escalation even though the score never crossed a spice threshold
 * (Claude can refuse content well below the erotica line). */
function lowestRungModel(ladder: HeatLadderLike): { provider: string; model?: string } | null {
  const sorted = [...ladder.uncensoredByLevel].sort((a, b) => a.minSpice - b.minSpice);
  return sorted[0] ? { provider: sorted[0].provider, model: sorted[0].model } : null;
}

// Same allowlist casting-sheet.ts's loadCastingSheet() uses for genre-derived
// file paths — genre is user-controlled and feeds a template path
// (library/craft/intimacy/${genre}.md) that _shared.ts reads unsanitized, so
// an invalid genre must never produce a template to read (M3: path traversal).
const GENRE_RE = /^[a-z0-9_-]+$/i;

// L1: a provider can refuse an on-page scene with a wordy explanation rather
// than an empty/short response, which slipped past the existing
// empty/<50-char escalation check. Deliberately conservative (specific
// first-person refusal phrasing) to avoid mistaking in-story dialogue like a
// character saying "I won't do this" for a real refusal.
const REFUSAL_RE = /\bI'?m not (?:comfortable|able)\b|\bI can'?t (?:write|create|continue|generate)\b|\bI won'?t (?:write|create|continue|generate)\b/i;

/** True when a response reads as a refusal rather than actual prose. */
export function looksLikeRefusal(text: string | undefined | null): boolean {
  return REFUSAL_RE.test(text || '');
}

export function intimacyDecision(args: { score: HeatScore; ceiling: { spice: number; violence: number } | null; ladder: HeatLadderLike | null; refusalEscalated?: boolean; genre: string }): IntimacyDecision {
  const { score, ceiling, ladder, refusalEscalated, genre } = args;
  if (!ceiling || ceiling.spice <= 0) return { mode: 'fade', spiceRoute: null, effectiveSpice: 0, template: null };
  const effectiveSpice = Math.min(score.spice, ceiling.spice);
  if (effectiveSpice <= 0) return { mode: 'fade', spiceRoute: null, effectiveSpice: 0, template: null };
  const template = GENRE_RE.test(genre) ? `library/craft/intimacy/${genre}.md` : null;
  const atErotica = !!ladder && effectiveSpice >= ladder.eroticaThreshold;
  if (atErotica || refusalEscalated) {
    const route = ladder ? (atErotica ? ladderModel(ladder, effectiveSpice) : lowestRungModel(ladder)) : null;
    if (route) return { mode: 'uncensored', spiceRoute: route, effectiveSpice, template };
    // No uncensored model configured but needed → keep on-page Claude (the caller's
    // fallback ladder / human-review pause handles a hard refusal downstream).
  }
  return { mode: 'onpage_claude', spiceRoute: null, effectiveSpice, template };
}
