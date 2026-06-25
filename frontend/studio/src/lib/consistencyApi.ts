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

// Keep in sync with CONSISTENCY_PROVIDERS in gateway/src/services/consistency/model-selection.ts
// (the studio build can't import gateway TS across packages).
export const CONSISTENCY_PROVIDERS = ['gemini', 'deepseek', 'claude', 'openai', 'ollama', 'openrouter'] as const;
export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  gemini: 'gemini-2.5-flash', deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4o', ollama: 'llama3.2', openrouter: 'anthropic/claude-sonnet-4-5',
};

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
