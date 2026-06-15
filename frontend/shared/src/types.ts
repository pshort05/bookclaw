// Hand-mirrored from the server contracts — keep in sync when the source changes:
//   BookStatus / BookSummary → gateway/src/services/book-types.ts
//   Status                    → GET /api/status (gateway/src/api/routes/core.routes.ts)
//   Costs                     → CostTracker.getStatus() (gateway/src/services/costs.ts)
// (No build-time link between the two trees; a mismatch is only a narrower type, not an error.)

/** BookStatus gate outcome for a book on open. */
export type BookStatus = 'ok' | 'readonly' | 'quarantined';

/** Live generation state for a book (book-container Phase 9) — present when a bound project is running. */
export interface BookLive {
  stepLabel: string;
  progress: number;
}

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
  pipeline?: string;
  series?: string;   // series title (Series Phase C) — shown in the board card byline
  // Phase 9 board enrichment (GET /api/books). Optional so older callers/tests still typecheck.
  next?: NextStep | null;
  live?: BookLive | null;
  // TODO #15: the book's pipeline-derived phase segments for the board progress bar.
  phases?: string[];
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
  skills?: { total: number; author?: number; premium?: number; premiumInstalled?: number };
  [k: string]: unknown;
}

/** Shape returned by GET /api/costs (and embedded in Status.costs). */
export interface Costs {
  daily: number;
  monthly: number;
  total: number;
  overBudget: boolean;
  dailyLimit: number;
  monthlyLimit: number;
  byBook: Record<string, number>;
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

/** Suggested next action for a book — returned by GET /api/books/:slug/next. */
export interface NextStep {
  phase: string;
  hasOutput: boolean;
  label: string;
  hint: string;
}

/** Response from GET /api/books/:slug (descriptions are additive; absent when no sidecars). */
export interface BookDetail {
  book: BookManifest;
  status: BookStatus;
  descriptions?: {
    author?: string;
    voice?: string;
    genre?: string;
  };
  // TODO #15: pipeline-derived phase segments for the drawer timeline.
  phases?: string[];
}

/** Full book.json manifest — returned by GET /api/books/:slug. */
export interface BookManifest {
  id: string;
  slug: string;
  title: string;
  schemaVersion: number;
  phase: string;
  pipelineSequence?: string[];   // v2: ordered pipeline names the book runs
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

/** A single step within a project — mirrors the projects API step shape. */
export interface ProjectStep {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped';
  phase?: string;
  skill?: string;
  chapterNumber?: number;
  wordCountTarget?: number;
  modelOverride?: { provider: string; model?: string } | null;
}

/** Project shape from GET /api/projects/list and GET /api/projects/:id. */
export interface Project {
  id: string;
  title: string;
  type: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'paused';
  progress: number;
  steps: ProjectStep[];
  [k: string]: unknown;
}

export type LibraryKind = 'author' | 'voice' | 'genre' | 'pipeline' | 'section' | 'skill' | 'sequence' | 'editor';
export interface LibraryEntry {
  kind: LibraryKind;
  name: string;
  source: 'builtin' | 'workspace' | 'synthetic';
  description?: string;
}

export interface LibraryPipelineStep {
  label: string; skill?: string; toolSuggestion?: string; taskType: string;
  promptTemplate: string; phase?: string; wordCountTarget?: number; chapterNumber?: number;
}
export interface LibraryPipeline {
  schemaVersion: number; name: string; label: string; description: string;
  dynamic?: boolean; steps: LibraryPipelineStep[];
}
export interface LibraryEditor {
  schemaVersion?: number; name: string; label?: string; description?: string;
  systemPrompt: string; model?: string; temperature?: number;
}
export interface LibraryEntryFull extends LibraryEntry {
  files?: Record<string, string>;
  content?: string;
  pipeline?: LibraryPipeline;
  editor?: LibraryEditor;
}
export type RepullStatus = 'in-sync'|'library-updated'|'locally-edited'|'diverged'|'library-removed'|'no-baseline';
export interface RepullAsset { kind: LibraryKind; name: string; status: RepullStatus; libraryPresent: boolean; hasBaseline: boolean; wired: boolean; }

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
