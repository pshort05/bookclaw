import type { LedgerFact, ConsistencyFinding, FindingRef, CanonRef, KnowledgeEvent } from './types.js';
import { computeFindingId } from './finding-id.js';
import { normalizeFactValue } from './extractor.js';

export type Gap = 'same' | 'day' | 'longer' | 'unknown';

/** Elapsed weight per inter-scene Gap, summed into a cumulative story-time clock
 *  (consumed by audit.ts accumulateElapsed). Co-located with ELAPSED_THRESHOLD so
 *  the two stay in sync. */
export const GAP_WEIGHT: Record<Gap, number> = { same: 0, day: 1, longer: 30, unknown: 0 };

/** Elapsed story-time distance beyond which a stateful change is a legitimate
 *  reset rather than a continuity error. One explicit multi-unit jump ("…later")
 *  excuses it; derived from GAP_WEIGHT so they cannot drift apart. */
export const ELAPSED_THRESHOLD = GAP_WEIGHT.longer;

/** Story-time band width per chapter: a fact's storyTime is
 *  `chapterNumber * CHAPTER_STORY_BAND + sceneIndex`. Both writers into the
 *  ledger — the live per-chapter check and the full audit — MUST use this same
 *  band, because check-engine compares rows across the two without knowing
 *  which produced them (two scales made every cross-writer comparison
 *  meaningless: see the knowledge-timeline rule below). 1000 leaves room for
 *  any realistic scene count while keeping chapters disjoint. */
export const CHAPTER_STORY_BAND = 1000;

/** Sentinel for "this fact has no elapsed-story-time clock". The live
 *  per-chapter path never computes one (only the audit accumulates elapsed
 *  across scenes), and writing 0 there would claim "day zero" — which the
 *  reset rule below would then read as a real, comparable distance and use to
 *  excuse genuine contradictions. Negative so it can never collide with a real
 *  cumulative clock, and it round-trips through the INTEGER column unchanged. */
export const ELAPSED_UNKNOWN = -1;

/** A fact carries a usable elapsed clock (not the UNKNOWN sentinel, not NaN). */
const hasElapsed = (f: LedgerFact): boolean => Number.isFinite(f.storyElapsed) && f.storyElapsed >= 0;

const refOf = (f: LedgerFact): FindingRef => ({ chapter: f.chapter, scene: f.scene, quote: f.evidence });
const canonRefOf = (f: LedgerFact): CanonRef => ({ canonSource: f.sourceLabel ?? f.evidence, quote: f.evidence });

function finding(
  category: ConsistencyFinding['category'], severity: ConsistencyFinding['severity'],
  fact: LedgerFact, prior: LedgerFact, explanation: string, suggestedFix: string,
): ConsistencyFinding {
  const f: ConsistencyFinding = {
    category, severity, entity: fact.entity, attribute: fact.attribute,
    a: refOf(fact), b: prior.source === 'canon' ? canonRefOf(prior) : refOf(prior),
    explanation, suggestedFix,
  };
  f.id = computeFindingId(f);
  return f;
}

export function evaluateFact(fact: LedgerFact, priors: LedgerFact[]): ConsistencyFinding | null {
  if (priors.length === 0) return null;
  // Normalise on COMPARE, not only on write: rows persisted before the extractor
  // normalised `value_norm` still hold the old key, and nothing rewrites them —
  // world-keyed canon in particular is hash-gated, so a stale canon row survives
  // every re-audit indefinitely and fabricates `X here but canon establishes X`.
  // Applying the same normaliser here makes the fix retroactive for every row.
  const valueNorm = normalizeFactValue(fact.valueNorm);
  const diff = priors.filter(p => normalizeFactValue(p.valueNorm) !== valueNorm);
  if (diff.length === 0) return null; // consistent with everything

  // 1) Canon divergence — any seeded canon value differs.
  const canon = diff.find(p => p.source === 'canon');
  if (canon) {
    return finding('canon-divergence', 'high', fact, canon,
      `${fact.entity}'s ${fact.attribute} is "${fact.valueRaw}" here but canon establishes "${canon.valueRaw}".`,
      `Chapter ${fact.chapter} says ${fact.entity}'s ${fact.attribute} is "${fact.valueRaw}"; the bible establishes "${canon.valueRaw}" — reconcile.`);
  }

  // 2) Immutable mismatch — an immutable attribute changed value.
  if (fact.type === 'immutable') {
    const prior = diff.find(p => p.type === 'immutable') ?? diff[0];
    return finding('contradiction', 'high', fact, prior,
      `${fact.entity}'s ${fact.attribute} is "${fact.valueRaw}" but was "${prior.valueRaw}" in ${prior.chapter}.`,
      `${fact.entity}'s ${fact.attribute} should not change: "${prior.valueRaw}" (${prior.chapter}) vs "${fact.valueRaw}" (${fact.chapter}) — reconcile.`);
  }

  // 3) Stateful.
  // 3a) Impossibility — incompatible value at the SAME story_time.
  const sameTime = diff.find(p => p.storyTime === fact.storyTime);
  if (sameTime) {
    return finding('impossibility', 'high', fact, sameTime,
      `${fact.entity}'s ${fact.attribute} is both "${fact.valueRaw}" and "${sameTime.valueRaw}" at the same point in the story.`,
      `Same moment, two values for ${fact.entity}'s ${fact.attribute}: "${sameTime.valueRaw}" vs "${fact.valueRaw}" — pick one.`);
  }
  // 3b) A transition justifies the change.
  if (fact.transition) return null;
  // 3c) Stateful change without cause — excuse when every differing prior is far
  // enough back in elapsed story time; otherwise flag the nearest recent prior.
  // An elapsed distance can only be measured when BOTH sides carry a clock: the
  // live per-chapter path has none (ELAPSED_UNKNOWN), and treating that as 0
  // would put it a full threshold away from any audit-written prior whose
  // cumulative clock had advanced — silently excusing real contradictions.
  const factElapsed = hasElapsed(fact);
  const farBack = (p: LedgerFact) =>
    factElapsed && hasElapsed(p) && Math.abs(fact.storyElapsed - p.storyElapsed) >= ELAPSED_THRESHOLD;
  const recent = diff.filter(p => !farBack(p));
  if (recent.length === 0) return null;              // all differing priors are far back: legitimate reset
  const prior = recent.reduce((m, p) => (p.storyElapsed > m.storyElapsed ? p : m));
  // Some explicit elapsed time but below the reset threshold → a real unexplained
  // change over a short span (medium, like the old "day" gap). Zero elapsed — or
  // no clock at all — means no time signal (e.g. label-free prose, or the live
  // per-chapter path) → a soft review note (low, like the old "unknown" gap) so
  // ordinary unlabeled manuscripts aren't flooded medium.
  const measurable = factElapsed && hasElapsed(prior);
  const severity: ConsistencyFinding['severity'] =
    !measurable || Math.abs(fact.storyElapsed - prior.storyElapsed) === 0 ? 'low' : 'medium';
  return finding('continuity', severity, fact, prior,
    `${fact.entity}'s ${fact.attribute} changed from "${prior.valueRaw}" (${prior.chapter}) to "${fact.valueRaw}" (${fact.chapter}) with no stated cause.`,
    `${fact.entity}'s ${fact.attribute} was "${prior.valueRaw}" in ${prior.chapter} and is "${fact.valueRaw}" in ${fact.chapter} with nothing in between — add a transition or fix.`);
}

/**
 * Deterministic knowledge-timeline check. For each `use` event, a character must
 * have a CANONICAL `acquire` of the same fact at an earlier-or-equal story_time.
 * Dream/flashback (non-canonical) acquisitions do not count as learning.
 */
export function evaluateKnowledge(events: KnowledgeEvent[]): ConsistencyFinding[] {
  const byKey = new Map<string, KnowledgeEvent[]>();
  for (const e of events) {
    const k = `${e.knower} ${e.factKey}`;
    const bucket = byKey.get(k);
    if (bucket) bucket.push(e);
    else byKey.set(k, [e]);
  }

  const findings: ConsistencyFinding[] = [];
  for (const group of byKey.values()) {
    const acquires = group.filter(e => e.kind === 'acquire' && e.canonical);
    const firstAcquire = acquires.length
      ? acquires.reduce((m, e) => (e.storyTime < m.storyTime ? e : m))
      : null;
    for (const use of group.filter(e => e.kind === 'use')) {
      const learned = firstAcquire !== null && firstAcquire.storyTime <= use.storyTime;
      if (learned) continue;
      const attribute = use.factKey.split('\0')[1] ?? use.factKey;
      const severity: ConsistencyFinding['severity'] =
        firstAcquire === null ? 'high' : use.source === 'reference' ? 'high' : use.source === 'act_on' ? 'medium' : 'low';
      const a: FindingRef = { chapter: use.chapter, scene: use.scene, quote: use.evidence };
      const b: FindingRef | CanonRef = firstAcquire
        ? { chapter: firstAcquire.chapter, scene: firstAcquire.scene, quote: firstAcquire.evidence }
        : { canonSource: 'never learned in-story', quote: '' };
      const where = firstAcquire ? `not until ${firstAcquire.chapter}` : 'at no point in the story';
      const kf: ConsistencyFinding = {
        category: 'knowledge-violation', severity, entity: use.knower, attribute, a, b,
        explanation: `${use.knower} uses knowledge of "${attribute}" in ${use.chapter} but learns it ${where}.`,
        suggestedFix: `Move ${use.knower}'s discovery of "${attribute}" before ${use.chapter}, or cut the reference.`,
      };
      kf.id = computeFindingId(kf);
      findings.push(kf);
    }
  }
  return findings;
}
