import { api } from '@bookclaw/shared';
import { socket } from '@bookclaw/shared';

export type FindingCategory = 'contradiction' | 'continuity' | 'impossibility' | 'canon-divergence';
export type Severity = 'high' | 'medium' | 'low';

export interface FindingRef { chapter: string; scene: number; quote: string; }
export interface CanonRef { canonSource: string; quote: string; }

export interface ConsistencyFinding {
  category: FindingCategory;
  severity: Severity;
  entity: string;
  attribute: string;
  a: FindingRef;
  b: FindingRef | CanonRef;
  explanation: string;
  suggestedFix: string;
}

export interface ConsistencyReport {
  findings: ConsistencyFinding[];
  chaptersScanned: number;
  factCount: number;
  /** Each (entity, attribute) → chapters that dramatize it (canon-flagged). Optional: older reports omit it. */
  reverseIndex?: ReverseIndexEntry[];
  /** Canon/bible facts no chapter dramatizes (Chekhov's-gun candidates). Optional: older reports omit it. */
  orphanFacts?: OrphanFact[];
  generatedAt: string;
}

export interface ReverseIndexEntry { entity: string; attribute: string; chapters: string[]; isCanon: boolean; }
export interface OrphanFact { entity: string; attribute: string; valueRaw: string; world: string | null; }

export const runConsistencyAudit = (slug: string) =>
  api<{ status: string; slug: string }>(
    `/api/books/${encodeURIComponent(slug)}/consistency-audit`,
    { method: 'POST', body: '{}' },
  );

export const getConsistencyReport = (slug: string) =>
  api<{ report: ConsistencyReport | null }>(
    `/api/books/${encodeURIComponent(slug)}/consistency-report`,
  ).then((r) => r.report);

export interface ConsistencyProgressEvent { slug: string; message: string; }
export interface ConsistencyCompleteEvent { slug: string; report: ConsistencyReport; }
export interface ConsistencyErrorEvent { slug: string; error: string; }

export interface ConsistencyHandlers {
  onProgress: (e: ConsistencyProgressEvent) => void;
  onComplete: (e: ConsistencyCompleteEvent) => void;
  onError: (e: ConsistencyErrorEvent) => void;
}

/** Subscribe to consistency audit socket events; returns an unsubscribe fn. */
export function subscribeConsistency({ onProgress, onComplete, onError }: ConsistencyHandlers): () => void {
  const s = socket();
  s.on('consistency-progress', onProgress);
  s.on('consistency-complete', onComplete);
  s.on('consistency-error', onError);
  return () => {
    s.off('consistency-progress', onProgress);
    s.off('consistency-complete', onComplete);
    s.off('consistency-error', onError);
  };
}
