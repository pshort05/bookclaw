/**
 * ProviderThrottle (Flagship Plan 6, Task 2): caps concurrent in-flight AI
 * calls per provider so a burst of parallel steps (a parallel step group, or
 * several books driving at once under DriveScheduler) never storms a
 * rate-limited provider. Excess calls for a provider queue FIFO and run as
 * slots free; different providers never block each other. Wraps
 * AIRouter.complete() (the single funnel every AI call already goes through),
 * not individual call sites — see router.ts.
 */
export class ProviderThrottle {
  private limits: Record<string, number>;
  private defaultLimit: number;
  private inFlight: Map<string, number> = new Map();
  private queues: Map<string, Array<() => void>> = new Map();

  constructor(limits: Record<string, number>) {
    this.limits = limits ?? {};
    this.defaultLimit = this.limits.default ?? 2;
  }

  /** Update the live per-provider limits (e.g. after a Settings change). */
  setLimits(limits: Record<string, number>): void {
    this.limits = limits ?? {};
    this.defaultLimit = this.limits.default ?? this.defaultLimit;
  }

  /** Run fn() once a slot for `provider` is free, queuing if the limit is currently held. */
  async run<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    await this.acquireSlot(provider);
    try {
      return await fn();
    } finally {
      this.releaseSlot(provider);
    }
  }

  private limitFor(provider: string): number {
    return this.limits[provider] ?? this.defaultLimit;
  }

  private acquireSlot(provider: string): Promise<void> {
    const current = this.inFlight.get(provider) ?? 0;
    if (current < this.limitFor(provider)) {
      this.inFlight.set(provider, current + 1);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const q = this.queues.get(provider) ?? [];
      q.push(resolve);
      this.queues.set(provider, q);
    });
  }

  private releaseSlot(provider: string): void {
    const q = this.queues.get(provider);
    if (q && q.length > 0) {
      // Hand the slot directly to the next waiter — inFlight count is unchanged.
      const next = q.shift()!;
      next();
      return;
    }
    const current = this.inFlight.get(provider) ?? 0;
    this.inFlight.set(provider, Math.max(0, current - 1));
  }
}
