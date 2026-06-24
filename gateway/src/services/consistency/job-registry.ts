/**
 * In-memory registry of in-flight consistency audits, keyed by book slug.
 *
 * The audit runs in the background after the POST route responds, and its first
 * step wipes the book's prior facts (`store.clearBookFacts`). Two concurrent
 * runs for the same book would interleave that wipe with each other's inserts
 * and corrupt the ledger. This registry is the single source of truth for
 * "is an audit running for this book?" so the route can reject a concurrent
 * start (HTTP 409) and the report endpoint can report running state — letting a
 * reconnecting client rehydrate instead of offering to start a second run.
 *
 * Lives on the gateway instance (process-local). Audits are not durable across
 * a restart; a crash mid-audit simply clears the registry, which is correct —
 * nothing is running after a restart.
 */
export interface ConsistencyJobState {
  slug: string;
  startedAt: string;          // ISO-8601
  lastMessage: string | null; // most recent progress line, for UI rehydration
}

export class ConsistencyJobRegistry {
  private jobs = new Map<string, ConsistencyJobState>();

  /**
   * Atomically claim the audit slot for `slug`. Returns true if claimed,
   * false if an audit for this slug is already running (caller should 409).
   */
  start(slug: string): boolean {
    if (this.jobs.has(slug)) return false;
    this.jobs.set(slug, { slug, startedAt: new Date().toISOString(), lastMessage: null });
    return true;
  }

  /** Record the latest progress message on a running job (no-op if not running). */
  progress(slug: string, message: string): void {
    const job = this.jobs.get(slug);
    if (job) job.lastMessage = message;
  }

  /** Release the audit slot for `slug`. Idempotent. */
  finish(slug: string): void {
    this.jobs.delete(slug);
  }

  isRunning(slug: string): boolean {
    return this.jobs.has(slug);
  }

  /** The running job's state, or null when idle. */
  get(slug: string): ConsistencyJobState | null {
    return this.jobs.get(slug) ?? null;
  }
}
