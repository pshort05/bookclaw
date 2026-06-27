import { api } from '@bookclaw/shared';
import { CONSISTENCY_PROVIDERS, PROVIDER_DEFAULT_MODEL } from './consistencyApi.js';

// The Try-Fail auditor shares the consistency model selection (same
// large-context manuscript-analysis need): Ollama lacks the context window to
// ingest a full book, so the same non-Ollama provider set applies.
export { CONSISTENCY_PROVIDERS as TRYFAIL_PROVIDERS, PROVIDER_DEFAULT_MODEL };

export type AttemptOutcome = 'success' | 'partial' | 'failure' | 'none';
export type Cost = 'none' | 'low' | 'medium' | 'high';
export type FindingSeverity = 'high' | 'medium' | 'low';

export interface AttemptRecord {
  protagonist: string;
  chapter: number;
  goal: string;
  conflict: string;
  outcome: AttemptOutcome;
  cost: Cost;
  personalStakes: number;
  peopleAffected: number;
}

export interface TryFailFinding {
  severity: FindingSeverity;
  category: string;
  protagonist?: string;
  chapter?: number;
  detail: string;
}

export interface ProtagonistLadder {
  protagonist: string;
  attempts: AttemptRecord[];
  deepens: boolean;
  broadens: boolean;
  firstAttemptOutcome: AttemptOutcome;
  findings: TryFailFinding[];
}

export interface CrucibleSignal {
  kind: 'setting' | 'relationship' | 'duty' | 'other';
  description: string;
  strength: 'weak' | 'moderate' | 'strong';
  chapter: number;
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
  findings: TryFailFinding[];
  summary: string;
  condensed: boolean;
  generatedAt: string;
  model?: { provider: string; model?: string };
}

export interface TryFailModelSelection { provider?: string; model?: string; }

export const runTryFailAudit = (slug: string, sel: TryFailModelSelection = {}) =>
  api<TryFailReport>(
    `/api/books/${encodeURIComponent(slug)}/try-fail-audit`,
    { method: 'POST', body: JSON.stringify(sel) },
  );

export const getTryFailReport = (slug: string) =>
  api<{ report: TryFailReport | null }>(
    `/api/books/${encodeURIComponent(slug)}/try-fail-report`,
  );
