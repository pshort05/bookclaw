/**
 * Types for the Try-Fail & Escalation Auditor (TODO #15).
 *
 * A per-book, per-protagonist structure check: detects discrete try-fail cycles
 * (attempt → outcome), verifies early attempts genuinely fail, confirms each
 * conflict deepens (higher personal/emotional stakes) and/or broadens (affects
 * more people), flags conflicts that resolve too easily, and runs a lightweight
 * crucible check (is there a binding force that stops characters walking away?).
 *
 * The valuable logic lives in a pure deterministic core (score.ts), fed by a
 * single structured-JSON LLM extraction over the manuscript (the I/O boundary).
 */

export type AttemptOutcome = 'success' | 'partial' | 'failure' | 'none';
export type Cost = 'none' | 'low' | 'medium' | 'high';

export interface AttemptRecord {
  protagonist: string;
  chapter: number;
  goal: string;
  conflict: string;
  outcome: AttemptOutcome;
  cost: Cost;
  personalStakes: number;   // 0–5 emotional/personal stakes (deepen axis)
  peopleAffected: number;   // breadth count (broaden axis)
}

export interface CrucibleSignal {
  kind: 'setting' | 'relationship' | 'duty' | 'other';
  description: string;
  strength: 'weak' | 'moderate' | 'strong';
  chapter: number;
}

export type FindingSeverity = 'high' | 'medium' | 'low';

export type FindingCategory =
  | 'early_easy_win' | 'flat_escalation' | 'easy_resolution'
  | 'missing_crucible' | 'no_try_fail_cycle';

export interface TryFailFinding {
  severity: FindingSeverity;
  category: FindingCategory;
  protagonist?: string;
  chapter?: number;
  detail: string;
}

export interface ProtagonistLadder {
  protagonist: string;
  attempts: AttemptRecord[];      // ordered by chapter
  deepens: boolean;
  broadens: boolean;
  firstAttemptOutcome: AttemptOutcome;
  findings: TryFailFinding[];
}

export interface CrucibleAssessment {
  present: boolean;
  strongest: 'none' | 'weak' | 'moderate' | 'strong';
  signals: CrucibleSignal[];
  finding?: TryFailFinding;
}

export interface TryFailReport {
  bookSlug: string;
  protagonists: ProtagonistLadder[];
  crucible: CrucibleAssessment;
  findings: TryFailFinding[];      // aggregated, sorted high→low
  summary: string;
  condensed: boolean;
  generatedAt: string;
  model?: { provider: string; model?: string };
}

// Raw LLM extraction shape (one call over the whole manuscript):
export interface AuditExtraction {
  protagonists: string[];
  attempts: AttemptRecord[];
  crucibleSignals: CrucibleSignal[];
}
