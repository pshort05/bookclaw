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
