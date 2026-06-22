import type { LedgerFact, ConsistencyFinding, FindingRef, CanonRef, KnowledgeEvent } from './types.js';

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
      findings.push({
        category: 'knowledge-violation', severity, entity: use.knower, attribute, a, b,
        explanation: `${use.knower} uses knowledge of "${attribute}" in ${use.chapter} but learns it ${where}.`,
        suggestedFix: `Move ${use.knower}'s discovery of "${attribute}" before ${use.chapter}, or cut the reference.`,
      });
    }
  }
  return findings;
}
