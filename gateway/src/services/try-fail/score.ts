/**
 * Deterministic core of the Try-Fail & Escalation Auditor (TODO #15).
 *
 * Pure, side-effect-free functions over the LLM extraction (AuditExtraction).
 * The valuable, novel logic lives here and is unit-tested with fixtures: the
 * try-fail ladder, escalation scoring (deepen/broaden), the easy-win / flat /
 * easy-resolution / no-cycle detectors, and the crucible assessment.
 */
import type {
  AttemptRecord,
  AuditExtraction,
  CrucibleAssessment,
  ProtagonistLadder,
  TryFailFinding,
  TryFailReport,
} from './types.js';

/**
 * Escalation verdict over a protagonist's ordered attempts.
 * `deepens` = personalStakes rise (last meaningfully > first);
 * `broadens` = peopleAffected rise. ≥2 attempts required to assess.
 */
export function assessEscalation(attempts: AttemptRecord[]): { deepens: boolean; broadens: boolean } {
  if (attempts.length < 2) return { deepens: false, broadens: false };
  const first = attempts[0];
  // Escalation is a peak-vs-opening judgement, not endpoints: a mid-arc rise
  // (e.g. stakes 1→5→2) still escalated. Comparing only first-vs-last would
  // misreport such an arc as flat.
  const peakStakes = Math.max(...attempts.map((a) => a.personalStakes));
  const peakAffected = Math.max(...attempts.map((a) => a.peopleAffected));
  return {
    deepens: peakStakes > first.personalStakes,
    broadens: peakAffected > first.peopleAffected,
  };
}

/**
 * First attempt succeeds with little or no cost → a win on the first try isn't
 * earned (high). Null when the first attempt failed or the win cost something.
 */
export function detectEarlyEasyWin(ladder: ProtagonistLadder): TryFailFinding | null {
  const first = ladder.attempts[0];
  if (!first) return null;
  if (first.outcome === 'success' && (first.cost === 'none' || first.cost === 'low')) {
    return {
      severity: 'high',
      category: 'early_easy_win',
      protagonist: ladder.protagonist,
      chapter: first.chapter,
      detail: `${ladder.protagonist}'s first attempt (chapter ${first.chapter}) succeeds at ${first.cost} cost — a win on the first try isn't earned.`,
    };
  }
  return null;
}

/**
 * ≥3 attempts but the conflict neither deepens nor broadens → flat arc (medium).
 */
export function detectFlatEscalation(ladder: ProtagonistLadder): TryFailFinding | null {
  if (ladder.attempts.length < 3) return null;
  if (ladder.deepens || ladder.broadens) return null;
  return {
    severity: 'medium',
    category: 'flat_escalation',
    protagonist: ladder.protagonist,
    detail: `${ladder.protagonist} makes ${ladder.attempts.length} attempts but the conflict neither deepens (personal stakes) nor broadens (people affected).`,
  };
}

/**
 * A high-stakes conflict (personalStakes >= 4) resolved with `success` at `none`
 * cost → resolved too easily (medium), one finding per offending attempt.
 */
export function detectEasyResolutions(attempts: AttemptRecord[]): TryFailFinding[] {
  const out: TryFailFinding[] = [];
  for (const a of attempts) {
    if (a.outcome === 'success' && a.cost === 'none' && a.personalStakes >= 4) {
      out.push({
        severity: 'medium',
        category: 'easy_resolution',
        protagonist: a.protagonist,
        chapter: a.chapter,
        detail: `${a.protagonist}'s high-stakes conflict (personal stakes ${a.personalStakes}) in chapter ${a.chapter} resolves at no cost.`,
      });
    }
  }
  return out;
}

/**
 * A protagonist with attempts but no `failure`/`partial` outcome anywhere has no
 * real try-fail cycle (medium).
 */
export function detectNoTryFail(ladder: ProtagonistLadder): TryFailFinding | null {
  if (ladder.attempts.length === 0) return null;
  const hasSetback = ladder.attempts.some((a) => a.outcome === 'failure' || a.outcome === 'partial');
  if (hasSetback) return null;
  return {
    severity: 'medium',
    category: 'no_try_fail_cycle',
    protagonist: ladder.protagonist,
    detail: `${ladder.protagonist} never fails or partially fails — there is no real try-fail cycle driving the arc.`,
  };
}

/**
 * Group attempts by protagonist, order by chapter, set `firstAttemptOutcome`,
 * run escalation + the per-ladder finding detectors. Returns one ladder per
 * protagonist in the roster (and any protagonist that has attempts but is
 * missing from the roster).
 */
export function buildLadders(ex: AuditExtraction): ProtagonistLadder[] {
  const names = new Set<string>(ex.protagonists.filter((p) => typeof p === 'string' && p.trim() !== ''));
  for (const a of ex.attempts) names.add(a.protagonist);

  const ladders: ProtagonistLadder[] = [];
  for (const name of names) {
    const attempts = ex.attempts
      .filter((a) => a.protagonist === name)
      .sort((a, b) => a.chapter - b.chapter);
    const { deepens, broadens } = assessEscalation(attempts);
    const ladder: ProtagonistLadder = {
      protagonist: name,
      attempts,
      deepens,
      broadens,
      firstAttemptOutcome: attempts[0]?.outcome ?? 'none',
      findings: [],
    };
    const findings: TryFailFinding[] = [];
    const easyWin = detectEarlyEasyWin(ladder);
    if (easyWin) findings.push(easyWin);
    const flat = detectFlatEscalation(ladder);
    if (flat) findings.push(flat);
    findings.push(...detectEasyResolutions(attempts));
    const noCycle = detectNoTryFail(ladder);
    if (noCycle) findings.push(noCycle);
    ladder.findings = findings;
    ladders.push(ladder);
  }
  return ladders;
}

const STRENGTH_RANK: Record<'none' | 'weak' | 'moderate' | 'strong', number> = {
  none: 0,
  weak: 1,
  moderate: 2,
  strong: 3,
};

/**
 * Strongest crucible signal across the book. No signals or only `weak` → a
 * missing/weak-crucible finding (high): nothing binds the characters in place.
 */
export function assessCrucible(ex: AuditExtraction): CrucibleAssessment {
  const signals = ex.crucibleSignals;
  let strongest: 'none' | 'weak' | 'moderate' | 'strong' = 'none';
  for (const s of signals) {
    if (STRENGTH_RANK[s.strength] > STRENGTH_RANK[strongest]) strongest = s.strength;
  }
  const present = signals.length > 0;
  const weakOrAbsent = STRENGTH_RANK[strongest] <= STRENGTH_RANK.weak;
  const finding: TryFailFinding | undefined = weakOrAbsent
    ? {
        severity: 'high',
        category: 'missing_crucible',
        detail: present
          ? 'The only binding force (crucible) is weak — characters could plausibly walk away from the conflict.'
          : 'No crucible detected — nothing (setting, relationship, or duty) binds the characters to the conflict, so they could simply walk away.',
      }
    : undefined;
  return { present, strongest, signals, finding };
}

const SEVERITY_RANK: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 1, low: 2 };

/**
 * Assemble the full report: ladders + crucible + aggregated findings (sorted
 * high→low) + a deterministic summary string.
 */
export function assembleReport(
  slug: string,
  ex: AuditExtraction,
  condensed: boolean,
  model?: { provider?: string; model?: string },
): TryFailReport {
  const protagonists = buildLadders(ex);
  const crucible = assessCrucible(ex);
  // Don't raise the (high-severity) missing-crucible alarm when there are no
  // protagonist cycles to assess — an empty/unwritten book has no conflict to
  // bind, so the finding would be a spurious false alarm.
  if (protagonists.length === 0) crucible.finding = undefined;

  const findings: TryFailFinding[] = [];
  for (const l of protagonists) findings.push(...l.findings);
  if (crucible.finding) findings.push(crucible.finding);
  findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  const high = findings.filter((f) => f.severity === 'high').length;
  const medium = findings.filter((f) => f.severity === 'medium').length;
  const low = findings.filter((f) => f.severity === 'low').length;
  const summary =
    protagonists.length === 0
      ? `No protagonist try-fail cycles were detected${condensed ? ' (manuscript condensed)' : ''}.`
      : `${protagonists.length} protagonist(s), ${findings.length} finding(s) (${high} high / ${medium} medium / ${low} low). Crucible: ${crucible.present ? crucible.strongest : 'none'}.${condensed ? ' Manuscript condensed for analysis.' : ''}`;

  const reportModel =
    model && model.provider ? { provider: model.provider, model: model.model } : undefined;

  return {
    bookSlug: slug,
    protagonists,
    crucible,
    findings,
    summary,
    condensed,
    generatedAt: new Date().toISOString(),
    model: reportModel,
  };
}
