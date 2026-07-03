/**
 * Safety floor (Flagship Plan 2, Task 4) — non-negotiable, independent of any
 * content ceiling.
 *
 * bannedContentCheck(): deterministic pattern check for CSAM / non-consent
 * markers.
 *   - CSAM (a minor/age marker near a sexual marker) is fail-closed: any
 *     match sets `hardBlock: true` and the caller MUST refuse the draft.
 *   - Non-consent mentions (e.g. "raped") are downgraded to a review `flag`
 *     rather than a hard block — dark romance/thriller legitimately
 *     reference past assault in backstory, and a bare-word block on the
 *     whole chapter was blocking that legitimate prose (M4). The caller may
 *     surface the flag for human review; it must NOT fail the step on it.
 *
 * operationalDetailGuard(): flags draft passages that read as actionable
 * instructions (real code blocks, step-numbered synthesis/procedure) for a
 * consequence-abstraction rewrite pass. This is a flag-and-abstract guard,
 * NOT a hard block — dark content stays consequence-realistic rather than
 * procedure-reproducible.
 */

export interface BannedContentResult {
  /** False only when a hard block fired (CSAM). */
  ok: boolean;
  /** True for a fail-closed hard block — the caller MUST refuse the draft. */
  hardBlock: boolean;
  /** Set when hardBlock is true. */
  reason?: string;
  /** Review-worthy markers that did NOT block the draft (e.g. non-consent mention). */
  flags: string[];
}

// Sexual content combined with an explicit age/minor marker — CSAM.
const MINOR_MARKER_RE = /\b(?:minor|child|children|underage|\d{1,2}[- ]year[- ]old)\b/gi;
const SEXUAL_MARKER_RE = /\b(?:sex(?:ual|ually)?|intercourse|molest(?:ed|ation)?|naked|nude)\b/gi;
// A CSAM hard-block requires the two markers within this many characters of
// each other — anywhere-in-the-same-chapter co-occurrence produced false
// positives (e.g. an unrelated childhood scene earlier in the chapter).
const CSAM_PROXIMITY_WINDOW = 120;

// Explicit non-consent depiction markers — review flag only (see above).
const NON_CONSENT_RE = /\b(?:rape[ds]?|raping|non-?consensual|without (?:her|his|their) consent)\b/i;

/** True when any match of `reA` sits within `window` chars of any match of `reB`. */
function withinProximity(text: string, reA: RegExp, reB: RegExp, window: number): boolean {
  const positionsOf = (re: RegExp): number[] => {
    const positions: number[] = [];
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      positions.push(m.index);
      if (m[0].length === 0) re.lastIndex++; // guard against zero-width infinite loop
    }
    return positions;
  };
  const aPositions = positionsOf(reA);
  if (aPositions.length === 0) return false;
  const bPositions = positionsOf(reB);
  for (const a of aPositions) {
    for (const b of bPositions) {
      if (Math.abs(a - b) <= window) return true;
    }
  }
  return false;
}

export function bannedContentCheck(text: string): BannedContentResult {
  if (withinProximity(text, MINOR_MARKER_RE, SEXUAL_MARKER_RE, CSAM_PROXIMITY_WINDOW)) {
    return { ok: false, hardBlock: true, reason: 'sexual content combined with a minor/age marker (CSAM risk) detected', flags: [] };
  }
  const flags: string[] = [];
  if (NON_CONSENT_RE.test(text)) flags.push('non-consent content marker detected — recommend human review');
  return { ok: true, hardBlock: false, flags };
}

// A fenced code block (```...```) — synthesis "recipes" dressed as code.
const CODE_BLOCK_RE = /```[\s\S]*?```/;
// A numbered step list with 3+ consecutive imperative steps ("1. Mix...", "2. Heat...").
const STEP_LIST_RE = /(?:^|\n)\s*1[.)]\s+\S+[\s\S]*?(?:^|\n)\s*2[.)]\s+\S+[\s\S]*?(?:^|\n)\s*3[.)]\s+\S+/m;

export function operationalDetailGuard(text: string): { flagged: boolean; spans: string[] } {
  const spans: string[] = [];
  const codeMatch = text.match(CODE_BLOCK_RE);
  if (codeMatch) spans.push(codeMatch[0]);
  const stepMatch = text.match(STEP_LIST_RE);
  if (stepMatch) spans.push(stepMatch[0]);
  return { flagged: spans.length > 0, spans };
}
