// Hand-mirrored from the server contracts — keep in sync when the source changes:
//   BookStatus / BookSummary → gateway/src/services/book-types.ts
//   Status                    → GET /api/status (gateway/src/api/routes/core.routes.ts)
//   Costs                     → CostTracker.getStatus() (gateway/src/services/costs.ts)
// (No build-time link between the two trees; a mismatch is only a narrower type, not an error.)

/** BookStatus gate outcome for a book on open. */
export type BookStatus = 'ok' | 'readonly' | 'quarantined';

/** Summary row returned by GET /api/books — lighter than the full manifest. */
export interface BookSummary {
  slug: string;
  title: string;
  phase: string;
  schemaVersion: number;
  status: BookStatus;
  createdAt: string;
  author?: string;
  voice?: string;
  genre?: string | null;
}

/**
 * Response from GET /api/status.
 * Only the fields the studio UI consumes are typed; the rest are captured by the index signature.
 */
export interface Status {
  version?: string;
  soul?: string;
  providers?: Array<{ id: string; name: string; model: string; tier: string }>;
  costs?: Costs;
  permissions?: string;
  [k: string]: unknown;
}

/** Shape returned by GET /api/costs (and embedded in Status.costs). */
export interface Costs {
  daily: number;
  monthly: number;
  overBudget: boolean;
  dailyLimit: number;
  monthlyLimit: number;
}

/** Activity feed — mirrors gateway/src/services/activity-log.ts (ActivityEntry). */
export type ActivityType =
  | 'project_created' | 'project_planned' | 'goal_created' | 'goal_planned'
  | 'step_started' | 'step_completed' | 'step_failed' | 'chat_message'
  | 'skill_matched' | 'file_saved' | 'provider_selected'
  | 'preference_detected' | 'lesson_learned' | 'error' | 'system';

export type ActivitySource = 'telegram' | 'dashboard' | 'api' | 'internal';

export interface ActivityEntry {
  timestamp: string;          // ISO 8601
  type: ActivityType;
  source: ActivitySource;
  goalId?: string;
  stepLabel?: string;
  message: string;
  metadata?: Record<string, unknown>;   // provider, tokens, cost, wordCount, fileName, skillName, …
}

/** Provenance for one snapshotted component (mirrors PulledRef). */
export interface PulledRef {
  name: string;
  source: 'builtin' | 'workspace' | 'synthetic';
  version?: number;
}

/** Full book.json manifest — returned by GET /api/books/:slug. */
export interface BookManifest {
  id: string;
  slug: string;
  title: string;
  schemaVersion: number;
  phase: string;
  createdAt: string;
  pulledFrom: {
    author: PulledRef;
    voice?: PulledRef;
    genre?: PulledRef | null;
    pipeline: PulledRef;
    sections: string[];
    skills?: string[];
  };
  history: Array<{ at: string; event: string; detail?: string }>;
}

export type LibraryKind = 'author' | 'voice' | 'genre' | 'pipeline' | 'section' | 'skill';
export interface LibraryEntry {
  kind: LibraryKind;
  name: string;
  source: 'builtin' | 'workspace' | 'synthetic';
  description?: string;
}

/** ConfirmationGate queue — mirrors gateway/src/services/confirmation-gate.ts (only fields the UI reads). */
export type ConfirmationStatus =
  | 'pending' | 'approved' | 'rejected' | 'completed' | 'failed' | 'expired';

export interface ConfirmationRequest {
  id: string;
  createdAt: string;
  expiresAt: string;
  service: string;
  action: string;
  platform: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  isReversible: boolean;
  disclosures: string[];
  estimatedCost?: number;
  status: ConfirmationStatus;
  decidedAt?: string;
}
