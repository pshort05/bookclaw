import { api } from '@bookclaw/shared';
import { socket } from '@bookclaw/shared';
import { AI_PROVIDERS, PROVIDER_DEFAULT_MODEL } from './providers.js';

export type FindingCategory =
  | 'contradiction' | 'continuity' | 'impossibility' | 'canon-divergence' | 'knowledge-violation';
export type Severity = 'high' | 'medium' | 'low';

// Categories whose findings the apply-fix flow can reconcile by a phrase swap.
// `knowledge-violation` is excluded — it needs a plot change, not a phrase swap.
// Keep in sync with FIXABLE in gateway/src/services/consistency/fix-types.ts
// (cross-package; the studio can't import gateway TS — same pattern as AI_PROVIDERS).
export const FIXABLE_CATEGORIES: ReadonlySet<FindingCategory> =
  new Set<FindingCategory>(['contradiction', 'continuity', 'impossibility', 'canon-divergence']);

export interface FindingRef { chapter: string; scene: number; quote: string; }
export interface CanonRef { canonSource: string; quote: string; }

export interface ConsistencyFinding {
  /** Stable id (backend-computed) — keys the fix toggle + propose/apply round-trip. */
  id: string;
  category: FindingCategory;
  severity: Severity;
  entity: string;
  attribute: string;
  a: FindingRef;
  b: FindingRef | CanonRef;
  explanation: string;
  suggestedFix: string;
}

export interface ChapterSummaryRow {
  chapter: string;
  status: 'scanned' | 'failed' | 'skipped';
  itemsTracked: number;
  high: number;
  medium: number;
  low: number;
}

export interface ConsistencyReport {
  findings: ConsistencyFinding[];
  /** Per-chapter summary chart. Optional: older reports omit it. */
  chapterSummary?: ChapterSummaryRow[];
  chaptersScanned: number;
  /** Total chapter segments found (scanned + failed). Optional: older reports omit it. */
  chaptersTotal?: number;
  /** Chapters whose extraction failed and were skipped. Optional: older reports omit it. */
  chaptersFailed?: number;
  /** Sample failure reasons (deduped) so the UI shows WHY chapters failed. Optional: older reports omit it. */
  failureSamples?: string[];
  /** True when the audit stopped early (first chapters all failed). Optional: older reports omit it. */
  aborted?: boolean;
  /** Estimated USD spent on this audit's AI calls. Optional: older reports omit it. */
  estimatedCost?: number;
  factCount: number;
  /** Each (entity, attribute) → chapters that dramatize it (canon-flagged). Optional: older reports omit it. */
  reverseIndex?: ReverseIndexEntry[];
  /** Canon/bible facts no chapter dramatizes (Chekhov's-gun candidates). Optional: older reports omit it. */
  orphanFacts?: OrphanFact[];
  generatedAt: string;
}

export interface ReverseIndexEntry { entity: string; attribute: string; chapters: string[]; isCanon: boolean; }
export interface OrphanFact { entity: string; attribute: string; valueRaw: string; world: string | null; }

// Consistency excludes Ollama: it lacks the context window to ingest a full
// chapter, so a local model silently fails extraction (see backend
// CONSISTENCY_PROVIDERS in services/consistency/model-selection.ts).
export const CONSISTENCY_PROVIDERS = AI_PROVIDERS.filter((p) => p !== 'ollama');
export { PROVIDER_DEFAULT_MODEL };

export interface ConsistencyModelSelection { provider?: string; model?: string; }

export const saveConsistencyModel = (slug: string, sel: ConsistencyModelSelection) =>
  api(`/api/books/${encodeURIComponent(slug)}/consistency-model`, { method: 'PUT', body: JSON.stringify(sel) });

export const runConsistencyAudit = (slug: string, sel: ConsistencyModelSelection = {}) =>
  api<{ status: string; slug: string }>(
    `/api/books/${encodeURIComponent(slug)}/consistency-audit`,
    { method: 'POST', body: JSON.stringify(sel) },
  );

export interface ConsistencyJobState { slug: string; startedAt: string; lastMessage: string | null; }

/** Report plus whether an audit is currently running (for reconnect rehydration). */
export const getConsistencyReport = (slug: string) =>
  api<{ report: ConsistencyReport | null; running?: boolean; job?: ConsistencyJobState | null; consistencyModel?: ConsistencyModelSelection | null }>(
    `/api/books/${encodeURIComponent(slug)}/consistency-report`,
  );

export interface ConsistencyProgressEvent { slug: string; message: string; }
export interface ConsistencyCompleteEvent { slug: string; report: ConsistencyReport; }
export interface ConsistencyErrorEvent { slug: string; error: string; }

export interface ConsistencyHandlers {
  onProgress: (e: ConsistencyProgressEvent) => void;
  onComplete: (e: ConsistencyCompleteEvent) => void;
  onError: (e: ConsistencyErrorEvent) => void;
  /** Fires on socket (re)connect so the caller can refetch state lost during a drop. */
  onReconnect?: () => void;
}

/** Subscribe to consistency audit socket events; returns an unsubscribe fn. */
export function subscribeConsistency({ onProgress, onComplete, onError, onReconnect }: ConsistencyHandlers): () => void {
  const s = socket();
  s.on('consistency-progress', onProgress);
  s.on('consistency-complete', onComplete);
  s.on('consistency-error', onError);
  if (onReconnect) s.on('connect', onReconnect);
  return () => {
    s.off('consistency-progress', onProgress);
    s.off('consistency-complete', onComplete);
    s.off('consistency-error', onError);
    if (onReconnect) s.off('connect', onReconnect);
  };
}

// ── Apply-fix (propose → confirm → apply) ───────────────────────────────────

/** A model-proposed prose edit for one finding; `anchored:false` will be skipped. */
export interface ProposedEdit {
  findingId: string;
  category: string;
  entity: string;
  attribute: string;
  canonicalValue: string;
  targetChapter: string;
  oldPhrase: string;
  newPhrase: string;
  note: string;
  anchored: boolean;
}

/** The exact edit the author confirmed (subset of a ProposedEdit). */
export interface ConfirmedEdit {
  findingId: string;
  targetChapter: string;
  oldPhrase: string;
  newPhrase: string;
}

export interface ApplyOutcome {
  applied: ConfirmedEdit[];
  skipped: { findingId: string; oldPhrase: string; reason: string }[];
  chaptersWritten: string[];
}

/** Ask the model to propose prose edits for the selected findings (no write). */
export const proposeConsistencyFixes = (
  slug: string,
  findingIds: string[],
  sel: ConsistencyModelSelection = {},
) =>
  api<{ proposals: ProposedEdit[] }>(
    `/api/books/${encodeURIComponent(slug)}/consistency-fix/propose`,
    { method: 'POST', body: JSON.stringify({ findingIds, provider: sel.provider, model: sel.model }) },
  );

/** Apply the author-confirmed edits to the prose (deterministic, version-snapshotted). */
export const applyConsistencyFixes = (slug: string, edits: ConfirmedEdit[]) =>
  api<ApplyOutcome>(
    `/api/books/${encodeURIComponent(slug)}/consistency-fix/apply`,
    { method: 'POST', body: JSON.stringify({ edits }) },
  );
