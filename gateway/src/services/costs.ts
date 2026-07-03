/**
 * BookClaw Cost Tracker
 * Budget monitoring with daily/monthly caps.
 * Persisted to disk so budget survives restarts.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

interface CostConfig {
  dailyLimit: number;
  monthlyLimit: number;
  alertAt: number; // percentage (0-1)
  persistPath?: string;
}

interface PersistedState {
  dailySpend: number;
  monthlySpend: number;
  totalSpend: number;
  byBook: Record<string, number>;
  lastResetDay: string;
  lastResetMonth: string;
}

export class CostTracker {
  dailyLimit: number;
  monthlyLimit: number;
  private alertAt: number;
  private dailySpend = 0;
  private monthlySpend = 0;
  private totalSpend = 0;
  private byBook: Record<string, number> = {};
  private bookBudgets: Record<string, number> = {};
  private lastResetDay: string;
  private lastResetMonth: string;
  private persistPath?: string;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<CostConfig>) {
    this.dailyLimit = config.dailyLimit ?? 5;
    this.monthlyLimit = config.monthlyLimit ?? 50;
    this.alertAt = config.alertAt ?? 0.8;
    this.lastResetDay = new Date().toISOString().split('T')[0];
    this.lastResetMonth = new Date().toISOString().substring(0, 7);
    this.persistPath = config.persistPath;
  }

  /**
   * Update the live spend limits at runtime (e.g. after a Settings change via
   * /api/config/update). Without this the limits are constructor-only, so a
   * changed daily/monthly cap does not take effect — the over-budget guard keeps
   * using the boot-time value until the next restart. Each value is applied only
   * when it is a finite, non-negative number, so a partial/blank update leaves the
   * other limit untouched.
   */
  setLimits(dailyLimit?: number, monthlyLimit?: number): void {
    if (typeof dailyLimit === 'number' && Number.isFinite(dailyLimit) && dailyLimit >= 0) {
      this.dailyLimit = dailyLimit;
    }
    if (typeof monthlyLimit === 'number' && Number.isFinite(monthlyLimit) && monthlyLimit >= 0) {
      this.monthlyLimit = monthlyLimit;
    }
  }

  /**
   * Set (or clear, with undefined) a per-book spend cap (Flagship Plan 6,
   * Task 3). Kept in-memory on the same tracker as byBook — no second cost
   * store — so wouldExceedBook can compare a book's accumulated spend against
   * its own cap without any other service needing to track spend itself.
   */
  setBookBudget(bookSlug: string, budget: number | undefined): void {
    if (typeof budget === 'number' && Number.isFinite(budget) && budget >= 0) {
      this.bookBudgets[bookSlug] = budget;
    } else {
      delete this.bookBudgets[bookSlug];
    }
  }

  /**
   * Whether this book's accumulated spend plus a projected additional cost
   * would meet or exceed its budget. A book with no budget set is always
   * false (unbounded) — callers use this at a chapter boundary to decide
   * whether to gracefully pause before starting the next chapter, not to
   * abort a chapter already in progress.
   */
  wouldExceedBook(bookSlug: string, projected: number): boolean {
    const budget = this.bookBudgets[bookSlug];
    if (budget === undefined) return false;
    const spent = this.byBook[bookSlug] ?? 0;
    return spent + projected >= budget;
  }

  /**
   * Hydrate state from disk. Call once at startup after construction.
   * Silently returns if no persistPath or no existing state file.
   */
  async initialize(): Promise<void> {
    if (!this.persistPath) return;
    try {
      await mkdir(dirname(this.persistPath), { recursive: true });
      if (!existsSync(this.persistPath)) return;
      const raw = await readFile(this.persistPath, 'utf-8');
      const state: PersistedState = JSON.parse(raw);
      this.dailySpend = state.dailySpend || 0;
      this.monthlySpend = state.monthlySpend || 0;
      this.totalSpend = state.totalSpend || 0;
      this.byBook = state.byBook || {};
      this.lastResetDay = state.lastResetDay || this.lastResetDay;
      this.lastResetMonth = state.lastResetMonth || this.lastResetMonth;
      this.checkReset();
    } catch {
      // Corrupted state — start fresh.
    }
  }

  /**
   * Record a cost directly from the router response. Prefer passing the
   * router-supplied `estimatedCost` so we don't disagree with the per-provider
   * pricing table in router.ts.
   */
  record(provider: string, tokens: number, estimatedCost?: number, bookSlug?: string): void {
    this.checkReset();
    let cost = estimatedCost;
    if (cost === undefined || cost === null || isNaN(cost)) {
      // Fallback estimation. Used only if the router didn't provide a cost
      // (older call-sites). Per-1k blended rates kept roughly in line with
      // router.ts's per-provider input/output rates; this path is a coarse
      // safety net, not the source of truth.
      const costPer1k: Record<string, number> = {
        ollama: 0, gemini: 0, deepseek: 0.0003,
        claude: 0.009, openai: 0.006, openrouter: 0.006,
      };
      cost = (tokens / 1000) * (costPer1k[provider] || 0);
    }
    this.dailySpend += cost;
    this.monthlySpend += cost;
    this.totalSpend += cost;
    const key = bookSlug ?? 'unattributed';
    this.byBook[key] = (this.byBook[key] ?? 0) + cost;
    this.schedulePersist();
  }

  isOverBudget(): boolean {
    this.checkReset();
    return this.dailySpend >= this.dailyLimit || this.monthlySpend >= this.monthlyLimit;
  }

  isNearBudget(): boolean {
    this.checkReset();
    return this.dailySpend >= this.dailyLimit * this.alertAt ||
           this.monthlySpend >= this.monthlyLimit * this.alertAt;
  }

  getStatus(): { daily: number; monthly: number; total: number; overBudget: boolean; dailyLimit: number; monthlyLimit: number; byBook: Record<string, number> } {
    this.checkReset();
    // Round all figures to 4 decimals to match the money() renderer's $0.0001
    // resolution — 2dp would floor cheap-model spend to $0.00 and hide it in the
    // Rail lifetime/daily/monthly lines and the BookDrawer per-book row.
    const byBook: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.byBook)) byBook[k] = Math.round(v * 1e4) / 1e4;
    return {
      daily: Math.round(this.dailySpend * 1e4) / 1e4,
      monthly: Math.round(this.monthlySpend * 1e4) / 1e4,
      total: Math.round(this.totalSpend * 1e4) / 1e4,
      overBudget: this.isOverBudget(),
      dailyLimit: this.dailyLimit,
      monthlyLimit: this.monthlyLimit,
      byBook,
    };
  }

  /** Manual reset — used by dashboard "reset budget" button. */
  async reset(): Promise<void> {
    this.dailySpend = 0;
    this.monthlySpend = 0;
    this.lastResetDay = new Date().toISOString().split('T')[0];
    this.lastResetMonth = new Date().toISOString().substring(0, 7);
    await this.persist();
  }

  /** Danger-zone reset: zero the lifetime total and selectively chosen book buckets. */
  async resetLifetime(opts: { books?: string[]; unattributed?: boolean }): Promise<void> {
    this.totalSpend = 0;
    for (const slug of opts.books ?? []) delete this.byBook[slug];
    if (opts.unattributed) delete this.byBook['unattributed'];
    await this.persist();
  }

  private checkReset(): void {
    const today = new Date().toISOString().split('T')[0];
    const month = new Date().toISOString().substring(0, 7);
    let changed = false;
    if (today !== this.lastResetDay) {
      this.dailySpend = 0;
      this.lastResetDay = today;
      changed = true;
    }
    if (month !== this.lastResetMonth) {
      this.monthlySpend = 0;
      this.lastResetMonth = month;
      changed = true;
    }
    if (changed) this.schedulePersist();
  }

  /** Flush any debounced write to disk. Call on shutdown so late spend isn't lost. */
  async flush(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    await this.persist();
  }

  /** Debounced disk write — coalesces rapid `record()` calls into one write. */
  private schedulePersist(): void {
    if (!this.persistPath) return;
    if (this.writeTimer) return; // already scheduled
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      this.persist().catch(() => {});
    }, 2000);
  }

  private async persist(): Promise<void> {
    if (!this.persistPath) return;
    const state: PersistedState = {
      dailySpend: this.dailySpend,
      monthlySpend: this.monthlySpend,
      totalSpend: this.totalSpend,
      byBook: this.byBook,
      lastResetDay: this.lastResetDay,
      lastResetMonth: this.lastResetMonth,
    };
    try {
      await mkdir(dirname(this.persistPath), { recursive: true });
      // Atomic-ish write: write temp, then rename to avoid corruption on crash.
      const tmp = this.persistPath + '.tmp';
      await writeFile(tmp, JSON.stringify(state, null, 2));
      const { rename } = await import('fs/promises');
      await rename(tmp, this.persistPath);
    } catch {
      // Non-fatal — cost tracking continues in memory.
    }
  }
}
