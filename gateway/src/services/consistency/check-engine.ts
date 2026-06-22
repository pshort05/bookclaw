import type { LedgerFact, ConsistencyFinding, FindingRef, CanonRef } from './types.js';

export type Gap = 'same' | 'day' | 'longer' | 'unknown';

const refOf = (f: LedgerFact): FindingRef => ({ chapter: f.chapter, scene: f.scene, quote: f.evidence });
const canonRefOf = (f: LedgerFact): CanonRef => ({ canonSource: f.sourceLabel ?? f.evidence, quote: f.evidence });

function finding(
  category: ConsistencyFinding['category'], severity: ConsistencyFinding['severity'],
  fact: LedgerFact, prior: LedgerFact, explanation: string, suggestedFix: string,
): ConsistencyFinding {
  return {
    category, severity, entity: fact.entity, attribute: fact.attribute,
    a: refOf(fact), b: prior.source === 'canon' ? canonRefOf(prior) : refOf(prior),
    explanation, suggestedFix,
  };
}

export function evaluateFact(fact: LedgerFact, priors: LedgerFact[], gap: Gap): ConsistencyFinding | null {
  if (priors.length === 0) return null;
  const diff = priors.filter(p => p.valueNorm !== fact.valueNorm);
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
  // 3c) Change without cause — severity by elapsed gap.
  if (gap === 'longer') return null;                 // enough time passed: legitimate reset
  const severity = gap === 'unknown' ? 'low' : 'medium';
  const prior = diff[0];
  return finding('continuity', severity, fact, prior,
    `${fact.entity}'s ${fact.attribute} changed from "${prior.valueRaw}" (${prior.chapter}) to "${fact.valueRaw}" (${fact.chapter}) with no stated cause.`,
    `${fact.entity}'s ${fact.attribute} was "${prior.valueRaw}" in ${prior.chapter} and is "${fact.valueRaw}" in ${fact.chapter} with nothing in between — add a transition or fix.`);
}
