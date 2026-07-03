/**
 * DriveScheduler (Flagship Plan 6, Task 1): a global semaphore + FIFO queue
 * layered over the existing per-project drive lock
 * (ProjectEngine.tryStartDriving/stopDriving/isDriving — bug-review #2/#5/#8).
 *
 * The drive lock alone only prevents the SAME project being driven by two
 * runners at once; it never limited how many DIFFERENT books drive
 * concurrently. DriveScheduler adds that cap: acquire() claims both a global
 * slot (up to maxConcurrent) and the underlying per-project lock; once the
 * cap is reached, further acquires queue (FIFO) and resolve when a slot
 * frees. This is a wrapper, not a second lock — every acquired slot still
 * goes through the real drive lock, so isDriving()/tryStartDriving() stay the
 * single source of truth for "is this project currently being driven".
 */

/** The minimal drive-lock surface DriveScheduler depends on (ProjectEngine implements this). */
export interface DriveLock {
  tryStartDriving(projectId: string): boolean;
  stopDriving(projectId: string): void;
  isDriving(projectId: string): boolean;
}

interface QueueEntry {
  projectId: string;
  resolve: (acquired: boolean) => void;
  promise: Promise<boolean>;
}

export class DriveScheduler {
  private lock: DriveLock;
  private maxConcurrent: number;
  private runningSet: Set<string> = new Set();
  private queue: QueueEntry[] = [];

  constructor(lock: DriveLock, maxConcurrent: number) {
    this.lock = lock;
    this.maxConcurrent = maxConcurrent > 0 ? Math.floor(maxConcurrent) : 1;
  }

  /**
   * Claim a drive slot for projectId. Resolves true immediately if a slot is
   * free (and the underlying drive lock is claimed); resolves false
   * immediately if the project is already being driven by someone else
   * (same-project reentrancy — mirrors tryStartDriving's own guard); otherwise
   * queues and resolves once a slot frees and this project is dequeued.
   *
   * M3 fix: if this projectId is already sitting in the queue (e.g. the 60s
   * review-resolver sweep re-fires, or a caller retries), returns the SAME
   * pending promise instead of pushing a second queue entry — otherwise the
   * queue can grow unbounded and a stale duplicate can re-drive a project
   * that's already been dequeued and completed.
   */
  acquire(projectId: string): Promise<boolean> {
    if (this.lock.isDriving(projectId)) {
      return Promise.resolve(false);
    }
    if (this.runningSet.size < this.maxConcurrent) {
      return Promise.resolve(this.startNow(projectId));
    }
    const existing = this.queue.find((q) => q.projectId === projectId);
    if (existing) return existing.promise;
    let resolve!: (acquired: boolean) => void;
    const promise = new Promise<boolean>((r) => { resolve = r; });
    this.queue.push({ projectId, resolve, promise });
    return promise;
  }

  /**
   * Non-blocking claim (M2 fix): takes a slot immediately if one is free,
   * otherwise returns false WITHOUT queuing. For HTTP route handlers, which
   * must not hold the connection open behind another book's full drive —
   * unlike acquire(), a caller that gets false here has nothing queued on its
   * behalf and must retry itself.
   */
  tryAcquireNow(projectId: string): boolean {
    if (this.lock.isDriving(projectId)) return false;
    if (this.runningSet.size < this.maxConcurrent) {
      return this.startNow(projectId);
    }
    return false;
  }

  /** Release a previously acquired slot, then drain the queue into freed capacity. */
  release(projectId: string): void {
    if (this.runningSet.has(projectId)) {
      this.runningSet.delete(projectId);
      this.lock.stopDriving(projectId);
    }
    this.drainQueue();
  }

  /** Raise/lower the concurrency cap; a raise immediately drains queued projects into the new capacity. */
  setMaxConcurrent(n: number): void {
    if (!Number.isFinite(n) || n < 1) return;
    this.maxConcurrent = Math.floor(n);
    this.drainQueue();
  }

  /** Project IDs currently queued, in FIFO order. */
  queued(): string[] {
    return this.queue.map((q) => q.projectId);
  }

  /** Project IDs currently holding a drive slot. */
  running(): string[] {
    return Array.from(this.runningSet);
  }

  private startNow(projectId: string): boolean {
    if (!this.lock.tryStartDriving(projectId)) return false;
    this.runningSet.add(projectId);
    return true;
  }

  private drainQueue(): void {
    while (this.runningSet.size < this.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift()!;
      const started = this.startNow(next.projectId);
      next.resolve(started);
    }
  }
}

/**
 * Claim a drive slot via the scheduler when one is wired in, falling back to
 * the raw drive lock directly when it isn't (fail-soft — keeps every
 * pre-existing drive-lock caller/test working unchanged even before a
 * DriveScheduler is constructed). Production wiring always passes a real
 * scheduler (see init/phase-06-content.ts); the fallback exists purely for
 * defensive backward compatibility.
 */
export async function acquireDrive(
  scheduler: DriveScheduler | null | undefined,
  lock: DriveLock,
  projectId: string,
): Promise<boolean> {
  if (scheduler) return scheduler.acquire(projectId);
  return lock.tryStartDriving(projectId);
}

/**
 * Non-blocking claim via the scheduler when one is wired in, falling back to
 * the raw drive lock directly when it isn't — mirrors acquireDrive's
 * scheduler/fallback choice, but never queues (M2 fix). For HTTP route
 * handlers that must not hold the connection open at capacity.
 */
export function tryAcquireDriveNow(
  scheduler: DriveScheduler | null | undefined,
  lock: DriveLock,
  projectId: string,
): boolean {
  if (scheduler) return scheduler.tryAcquireNow(projectId);
  return lock.tryStartDriving(projectId);
}

/** Release a drive slot claimed via acquireDrive — mirror the same scheduler/fallback choice. */
export function releaseDrive(
  scheduler: DriveScheduler | null | undefined,
  lock: DriveLock,
  projectId: string,
): void {
  if (scheduler) { scheduler.release(projectId); return; }
  lock.stopDriving(projectId);
}
