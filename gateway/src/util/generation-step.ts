/**
 * Generation-step helpers (extracted from index.ts + projects.routes.ts, coverage
 * Batch B). These isolate the previously-inline, untested generation-loop logic so
 * it can be unit-tested deterministically (the continuation fn is injected — no AI
 * provider needed) and so the three call sites (bridge startAndRunProject, the
 * studio /execute, and /auto-execute) share one implementation instead of three
 * copies that can drift.
 */
import { countWords, appendContinuation, MAX_CONTINUATION_PASSES } from './wordcount.js';

/** Min chars a continuation must return to be appended; shorter → stop (matches the inline loops). */
export const MIN_CONTINUATION_CHARS = 100;

export interface StepClassification {
  /** True when the response is usable (not a provider-failure sentinel and not too short). */
  ok: boolean;
  /** Set when the response is the handleMessage `[AI provider failure]` sentinel. */
  providerFailure?: boolean;
  /** Extracted failure detail (sentinel stripped, capped) — present iff providerFailure. */
  detail?: string;
  /** Human-readable reason for a too-short/empty response — present iff !ok && !providerFailure. */
  reason?: string;
}

/**
 * Classify a step's AI response. Mirrors the (previously duplicated) guards in the
 * bridge + /execute + /auto-execute handlers: the `[AI provider failure]` sentinel
 * (both primary and fallback errored) must fail the step with its real reason
 * rather than being written into the manuscript file; an unusably short response
 * is also a failure. The caller decides whether to act on the too-short case (e.g.
 * executable-skill output is exempt) — this stays a pure classifier.
 */
export function classifyStepResponse(
  response: string | undefined | null,
  opts?: { minChars?: number },
): StepClassification {
  const minChars = opts?.minChars ?? 50;
  if (response && response.startsWith('[AI provider failure]')) {
    return {
      ok: false,
      providerFailure: true,
      detail: response.replace(/^\[AI provider failure\]\s*/, '').substring(0, 500),
    };
  }
  if (!response || response.length < minChars) {
    return {
      ok: false,
      reason:
        `AI returned an unusably short response (${response?.length ?? 0} chars). ` +
        `This usually means the chosen provider hit a safety filter, ran out of context, or the model is misconfigured. ` +
        `Try a different provider in Settings, shorten the project description, or split the task.`,
    };
  }
  return { ok: true };
}

/**
 * Multi-pass word-target continuation. While the text is under `wordCountTarget`
 * (and under the pass cap), it asks `continue` for the next chunk and appends it
 * (de-duplicating overlap via appendContinuation). A continuation that comes back
 * `<= minContinuationChars`, or a `continue` that throws, stops the loop and keeps
 * whatever has accumulated so far (never discards prior prose). Faithful to the
 * inline loops it replaces (same threshold, same MAX_CONTINUATION_PASSES cap,
 * same break-on-short / break-on-throw semantics, pass counted before the call).
 */
/**
 * Build the "here's the END of what you wrote — continue from it" anchor a
 * continuation prompt appends so the model picks up seamlessly. Returns the last
 * `maxChars` characters of the draft wrapped with instructions, or '' when there
 * is no prior prose. Both continuation call sites use it so the model always
 * sees its own tail instead of restarting the chapter (bug-review #4).
 */
export function continuationAnchor(textSoFar: string, maxChars = 3000): string {
  const tail = (textSoFar || '').slice(-maxChars);
  if (!tail.trim()) return '';
  return `\n\nHere is the END of what you have written so far — continue seamlessly from this exact point, do NOT repeat any of it:\n\n"""\n${tail}\n"""`;
}

export async function runWordTargetContinuation(opts: {
  initialText: string;
  wordCountTarget: number;
  maxPasses?: number;
  minContinuationChars?: number;
  /**
   * Produce the next continuation chunk for the given progress. `textSoFar` is
   * the full draft accumulated so far — the caller MUST anchor the continuation
   * prompt on its tail, otherwise the model (called on a clean project channel
   * with no history) has no view of what it already wrote and restarts the
   * chapter from the top (bug-review #4).
   */
  continue: (ctx: { wordsSoFar: number; remaining: number; pass: number; textSoFar: string }) => Promise<string>;
}): Promise<{ text: string; passes: number; finalWordCount: number }> {
  const maxPasses = opts.maxPasses ?? MAX_CONTINUATION_PASSES;
  const minChars = opts.minContinuationChars ?? MIN_CONTINUATION_CHARS;
  let text = opts.initialText;
  let wc = countWords(text);
  let passes = 0;
  while (wc < opts.wordCountTarget && passes < maxPasses) {
    passes++;
    const remaining = opts.wordCountTarget - wc;
    let cont: string;
    try {
      cont = await opts.continue({ wordsSoFar: wc, remaining, pass: passes, textSoFar: text });
    } catch {
      break; // continuation failed — keep what we have
    }
    if (cont && cont.length > minChars) {
      text = appendContinuation(text, cont);
      wc = countWords(text);
    } else {
      break; // too short — stop trying
    }
  }
  return { text, passes, finalWordCount: wc };
}
