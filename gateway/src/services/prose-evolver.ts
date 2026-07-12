/**
 * Prose Evolver — GEPA-style score→reflect→revise loop that iteratively
 * improves a single prose passage against the existing WritingJudgeService,
 * keeping only non-regressing revisions (Pareto floor).
 *
 * Ported from the AuthorAgent fork (gateway/src/services/prose-evolver.ts),
 * adapted to this repo: dropped the fork's MemoryTierService dependency
 * (we have no story-memory tier service — voice grounding comes from
 * SoulService only) and simplified the result/round shape to match our spec.
 *
 * Loop, per round:
 *   1. SCORE   — judge.evaluate() on the current best passage (the fitness
 *                signal: a 0-100 score plus specific weaknesses).
 *   2. REFLECT — one AI call: diagnose the highest-leverage improvements
 *                (a plan, not a rewrite).
 *   3. REVISE  — one AI call ('revision' tier): rewrite applying only those
 *                improvements, preserving the author's voice (soul context
 *                injected) and not changing plot/meaning.
 *   4. RE-SCORE — judge.evaluate() on the candidate.
 *
 * PARETO / NO-REGRESSION RULE: a candidate is accepted as the new best only
 * if its score is >= the running best (never regress onto a worse passage).
 * A round that fails to strictly improve counts toward the plateau; after
 * PLATEAU_STOP consecutive non-improving rounds the loop stops early.
 *
 * Never throws: any AI/judge failure degrades a single round to a no-op
 * (best-so-far retained) rather than aborting the whole evolution.
 */

import type { WritingJudgeService, QualityVerdict } from './writing-judge.js';
import type { SoulService } from './soul.js';
import type { AICompleteFn, AISelectProviderFn } from './context-engine.js';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface EvolveInput {
  /** The prose passage to evolve. */
  text: string;
  /** What the passage is trying to do — steers reflection. Free text. */
  brief?: string;
  /** Number of evolution rounds. Default DEFAULT_ROUNDS, clamped to [1, MAX_ROUNDS]. */
  rounds?: number;
  /** Book slug — informational only; the caller resolves the book-scoped
   *  SoulService context (if any) before calling evolve(). */
  bookSlug?: string;
}

/** One recorded evolution round in the auditable trace. */
export interface EvolveRound {
  /** 1-based round number. */
  round: number;
  /** The candidate's judge score (0-100). Falls back to the prior best's
   *  score when the round produced no scoreable candidate (AI/judge failure). */
  score: number;
  /** The candidate passage text produced this round (unchanged best-so-far
   *  text when the round produced no usable candidate). */
  text: string;
  /** The reflection step's diagnosis of the highest-leverage improvements. */
  reflection: string;
  /** True if this round's candidate became the new best (score >= prior best). */
  accepted: boolean;
}

export interface EvolveResult {
  finalText: string;
  baselineScore: number;
  finalScore: number;
  rounds: EvolveRound[];
  /** True if finalScore strictly beat baselineScore. */
  improved: boolean;
  stoppedReason: 'plateau' | 'max-rounds' | 'no-improvement';
}

// ═══════════════════════════════════════════════════════════
// Tuning constants
// ═══════════════════════════════════════════════════════════

/** Default number of evolution rounds. */
export const DEFAULT_ROUNDS = 3;
/** Hard cap on rounds — cost ceiling. */
export const MAX_ROUNDS = 5;
/** AI/judge calls per round: score + reflect + revise. */
export const CALLS_PER_ROUND = 3;
/** Stop after this many consecutive non-improving rounds (search plateaued). */
export const PLATEAU_STOP = 2;

/** Cap on how much of the soul context is injected into the revise prompt. */
const VOICE_CONTEXT_MAX_CHARS = 3500;

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

export class ProseEvolverService {
  /** Evolve a prose passage. Never throws. */
  async evolve(
    input: EvolveInput,
    judge: WritingJudgeService,
    soul: SoulService,
    aiComplete: AICompleteFn,
    aiSelectProvider: AISelectProviderFn,
  ): Promise<EvolveResult> {
    const rounds = this.clampRounds(input.rounds);
    const text = (input.text ?? '').toString();
    const voiceContext = this.buildVoiceContext(soul);

    const baselineVerdict = await this.scoreSafe(text, judge, aiComplete, aiSelectProvider);
    const baselineScore = baselineVerdict?.score ?? 0;

    let best = { text, score: baselineScore, verdict: baselineVerdict };
    const trace: EvolveRound[] = [];
    let nonImproving = 0;
    let stoppedReason: EvolveResult['stoppedReason'] | null = null;

    for (let round = 1; round <= rounds; round++) {
      const weaknesses = this.extractWeaknesses(best.verdict);
      const reflection = await this.reflect(
        { text: best.text, weaknesses, brief: input.brief },
        aiComplete,
        aiSelectProvider,
      );

      if (!reflection) {
        trace.push({ round, score: best.score, text: best.text, reflection: '', accepted: false });
        nonImproving++;
        if (nonImproving >= PLATEAU_STOP) { stoppedReason = 'plateau'; break; }
        continue;
      }

      const candidateText = await this.revise(
        { text: best.text, reflection, brief: input.brief, voiceContext },
        aiComplete,
        aiSelectProvider,
      );

      if (!candidateText) {
        trace.push({ round, score: best.score, text: best.text, reflection, accepted: false });
        nonImproving++;
        if (nonImproving >= PLATEAU_STOP) { stoppedReason = 'plateau'; break; }
        continue;
      }

      const candidateVerdict = await this.scoreSafe(candidateText, judge, aiComplete, aiSelectProvider);
      const candidateScore = candidateVerdict?.score ?? best.score;
      const accepted = candidateScore >= best.score;
      const strictlyImproved = candidateScore > best.score;

      trace.push({ round, score: candidateScore, text: candidateText, reflection, accepted });

      if (accepted) {
        best = { text: candidateText, score: candidateScore, verdict: candidateVerdict };
      }
      nonImproving = strictlyImproved ? 0 : nonImproving + 1;

      if (nonImproving >= PLATEAU_STOP) { stoppedReason = 'plateau'; break; }
    }

    if (!stoppedReason) {
      stoppedReason = best.score > baselineScore ? 'max-rounds' : 'no-improvement';
    }

    return {
      finalText: best.text,
      baselineScore,
      finalScore: best.score,
      rounds: trace,
      improved: best.score > baselineScore,
      stoppedReason,
    };
  }

  private clampRounds(rounds: number | undefined): number {
    if (typeof rounds !== 'number' || !Number.isFinite(rounds)) return DEFAULT_ROUNDS;
    return Math.max(1, Math.min(MAX_ROUNDS, Math.floor(rounds)));
  }

  // ─────────────────────────────────────────────────────────
  // Scoring (fitness) — wraps WritingJudge.evaluate defensively
  // ─────────────────────────────────────────────────────────

  private async scoreSafe(
    text: string,
    judge: WritingJudgeService,
    aiComplete: AICompleteFn,
    aiSelectProvider: AISelectProviderFn,
  ): Promise<QualityVerdict | null> {
    try {
      return await judge.evaluate(text, {
        aiComplete,
        aiSelectProvider,
        runLLMJudge: true,
        // Single-judge (craft) scoring keeps the per-round cost at ~3 calls.
        dualJudge: false,
      });
    } catch {
      return null;
    }
  }

  /** Pull the judge's specific weaknesses into a compact steering string. */
  private extractWeaknesses(verdict: QualityVerdict | null): string {
    if (!verdict) return '(no judge feedback available — infer weaknesses from the prose itself)';
    if (verdict.retryFeedback && verdict.retryFeedback.trim().length > 0) {
      return verdict.retryFeedback.trim();
    }
    const top = verdict.judge?.topIssues ?? verdict.dualJudge?.craft.topIssues ?? [];
    if (top.length > 0) return top.map(t => `- ${t}`).join('\n');
    return '(the judge found no specific weaknesses — look for the single highest-leverage improvement)';
  }

  // ─────────────────────────────────────────────────────────
  // Reflection (GEPA credit assignment) — one AI call
  // ─────────────────────────────────────────────────────────

  private async reflect(
    args: { text: string; weaknesses: string; brief?: string },
    aiComplete: AICompleteFn,
    aiSelectProvider: AISelectProviderFn,
  ): Promise<string> {
    const system = `You are a ruthless line editor performing REFLECTION, not rewriting.

Given a prose passage and the automated judge's specific weaknesses, identify the 2-3 HIGHEST-LEVERAGE, concrete improvements that would most raise the prose quality.

RULES:
- Do NOT rewrite the passage. Diagnose only.
- Each point must be SPECIFIC and actionable — name the exact problem and the exact fix direction (quote the offending phrase where useful).
- Prioritize ruthlessly: 2-3 changes that matter, not a laundry list.
- Never propose changes that would alter the plot, meaning, or the author's voice.
- Output as a short numbered list. No preamble, no rewrite.`;

    const briefLine = args.brief && args.brief.trim().length > 0
      ? `AUTHOR BRIEF: ${args.brief.trim()}\n\n`
      : '';

    const user = `${briefLine}JUDGE'S WEAKNESSES:\n${args.weaknesses}\n\nPASSAGE:\n${args.text}\n\nList the 2-3 highest-leverage improvements.`;

    try {
      const provider = aiSelectProvider('revision');
      const res = await aiComplete({
        provider: provider.id,
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: 500,
        temperature: 0.4,
      });
      return (res?.text || '').trim();
    } catch {
      return '';
    }
  }

  // ─────────────────────────────────────────────────────────
  // Revision (mutation operator) — one AI call, 'revision' tier
  // ─────────────────────────────────────────────────────────

  private async revise(
    args: { text: string; reflection: string; brief?: string; voiceContext: string },
    aiComplete: AICompleteFn,
    aiSelectProvider: AISelectProviderFn,
  ): Promise<string> {
    const voiceBlock = args.voiceContext.trim().length > 0
      ? `PRESERVE THE AUTHOR'S VOICE. The revised passage MUST read as if the same author wrote it. Match diction, rhythm, sentence shape, and tone to the profile below. Do not smooth the prose into generic "correct" writing.\n\n=== AUTHOR VOICE / STYLE GUIDE ===\n${args.voiceContext.trim()}\n=== END VOICE ===\n\n`
      : `PRESERVE THE AUTHOR'S VOICE — match the diction, rhythm, sentence shape, and tone already present in the passage. Do not smooth it into generic "correct" prose.\n\n`;

    const briefLine = args.brief && args.brief.trim().length > 0
      ? `AUTHOR BRIEF (honor it): ${args.brief.trim()}\n\n`
      : '';

    const system = `You are a master prose reviser executing a targeted edit pass.

${voiceBlock}Apply ONLY the specific improvements listed below. Do not add new plot, new events, or new meaning. Do not change what happens or what anything means — only HOW it is written. Keep the passage the same length or tighter.

Return ONLY the revised passage. No commentary, no preamble, no markdown code fences, no notes about what you changed.`;

    const user = `${briefLine}IMPROVEMENTS TO APPLY (and nothing else):\n${args.reflection}\n\nORIGINAL PASSAGE:\n${args.text}\n\nReturn the revised passage now.`;

    try {
      const provider = aiSelectProvider('revision');
      const res = await aiComplete({
        provider: provider.id,
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: 4000,
        temperature: 0.7,
      });
      let text = (res?.text || '').trim();
      // Defensive: strip accidental code fences the model may add despite the
      // instruction, so downstream scoring sees clean prose.
      text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
      return text;
    } catch {
      return '';
    }
  }

  // ─────────────────────────────────────────────────────────
  // Voice context — best-effort, never throws
  // ─────────────────────────────────────────────────────────

  private buildVoiceContext(soul: SoulService): string {
    try {
      const full = soul.getFullContext?.() || '';
      // Cap so a huge soul doc doesn't blow the revise prompt budget.
      return full.length > VOICE_CONTEXT_MAX_CHARS ? full.slice(0, VOICE_CONTEXT_MAX_CHARS) : full;
    } catch {
      return '';
    }
  }
}
