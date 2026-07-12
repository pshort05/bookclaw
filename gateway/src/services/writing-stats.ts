/**
 * BookClaw Writing Stats Store
 *
 * Minimal, additive, per-day word tally used to power the writing-stats
 * dashboard (today/week/total words, streaks). This does NOT replace
 * HeartbeatService's in-memory today/streak counters (still used for the
 * Morning Briefing + reminder milestones) — it exists because heartbeat's
 * counters reset on process restart and only ever know about "today".
 *
 * Ported from the AuthorAgent fork's writing-stats.ts, adapted to:
 *  - a local atomic-write helper (the `book.ts` write-temp-then-rename
 *    pattern) instead of the fork's private one,
 *  - a synchronous `getSnapshot` (state is loaded once via `initialize()`,
 *    then read from memory — same pattern as `LessonStore`),
 *  - no debounced writes (the fork's 2s debounce made round-trip tests
 *    fragile for no real benefit at this write frequency); every
 *    `recordWords` call persists immediately.
 *
 * Design goal: never throw. Every public method swallows its own errors so
 * a store hiccup can NEVER break the step-completion write path that calls
 * HeartbeatService.addWords() (see heartbeat.ts).
 */

import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

export interface WritingStatsSnapshot {
  wordsToday: number;
  wordsThisWeek: number;
  wordsTotal: number;
  currentStreakDays: number;
  longestStreakDays: number;
  activeProjects: number;
  lastActiveIso: string;
}

interface WritingStatsData {
  version: 1;
  /** date (YYYY-MM-DD, local) -> words recorded that day */
  days: Record<string, number>;
  lastActiveIso: string | null;
}

const FILE_NAME = 'writing-stats.json';

/** YYYY-MM-DD for a given Date (UTC), matching heartbeat.ts's toISOString().split('T')[0] convention. */
function dateKey(d: Date): string {
  return d.toISOString().split('T')[0];
}

/** Whether `next` is exactly one calendar day after `prev` (both YYYY-MM-DD). */
function isNextDay(prev: string, next: string): boolean {
  const a = new Date(prev + 'T00:00:00.000Z').getTime();
  const b = new Date(next + 'T00:00:00.000Z').getTime();
  return Math.round((b - a) / 86_400_000) === 1;
}

/**
 * Crash-safe write: write a temp file in the SAME directory, then rename
 * over the target (atomic on the same filesystem). Local copy of the
 * pattern in `book.ts` — kept local so this file has no cross-service
 * dependency.
 */
async function writeFileAtomic(path: string, content: string): Promise<void> {
  // Unique temp name per write: recordWords is fire-and-forget and the conductor
  // can run several pipeline steps concurrently, so 2-3 writes may overlap on the
  // same target. A shared `${path}.tmp` would let one rename fire mid-write of
  // another and publish a partial file; a per-write suffix isolates them.
  const tmp = `${path}.${process.pid}.${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}.tmp`;
  await writeFile(tmp, content, 'utf-8');
  await rename(tmp, path);
}

/**
 * Streak computation over a list of "day had words" date strings
 * (YYYY-MM-DD, UTC — consistent with heartbeat's date convention), exported
 * standalone so it can be unit-tested without a
 * store instance, a filesystem, or a notion of "now".
 *
 *  - `current`: the length of the run of consecutive days ending at the
 *    LAST (most recent) entry in `days`. Callers that need "is this streak
 *    still live as of today" decide that themselves (see
 *    `WritingStatsStore.getSnapshot`) by checking whether the most recent
 *    day is today or yesterday before trusting this value.
 *  - `longest`: the longest run of consecutive days anywhere in `days`.
 */
export function computeStreaks(days: string[]): { current: number; longest: number } {
  const sorted = Array.from(new Set(days)).sort();
  if (sorted.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = isNextDay(sorted[i - 1], sorted[i]) ? run + 1 : 1;
    longest = Math.max(longest, run);
  }

  let current = 1;
  for (let i = sorted.length - 1; i > 0; i--) {
    if (isNextDay(sorted[i - 1], sorted[i])) current++;
    else break;
  }

  return { current, longest };
}

export class WritingStatsStore {
  private filePath: string;
  private data: WritingStatsData = { version: 1, days: {}, lastActiveIso: null };
  private loaded = false;

  constructor(workspaceDir: string) {
    this.filePath = join(workspaceDir, 'data', FILE_NAME);
  }

  /** Load persisted data from disk. Safe to call multiple times; never throws. */
  async initialize(): Promise<void> {
    if (this.loaded) return;
    try {
      await mkdir(join(this.filePath, '..'), { recursive: true });
      if (existsSync(this.filePath)) {
        const raw = await readFile(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.days && typeof parsed.days === 'object') {
          this.data = {
            version: 1,
            days: { ...parsed.days },
            lastActiveIso: typeof parsed.lastActiveIso === 'string' ? parsed.lastActiveIso : null,
          };
        }
      }
    } catch {
      // Corrupted or unreadable — start fresh rather than blocking anything.
      this.data = { version: 1, days: {}, lastActiveIso: null };
    }
    this.loaded = true;
  }

  /**
   * Record `count` words for "now" (or an injected date, for tests).
   * Additive — repeated calls on the same day accumulate. Never throws
   * (best-effort; a failed write only means the dashboard undercounts
   * until the next successful call — it never breaks the caller).
   */
  async recordWords(count: number, now: Date = new Date()): Promise<void> {
    if (!Number.isFinite(count) || count <= 0) return;
    try {
      await this.initialize();
      const key = dateKey(now);
      this.data.days[key] = (this.data.days[key] || 0) + Math.round(count);
      this.data.lastActiveIso = now.toISOString();
      await mkdir(join(this.filePath, '..'), { recursive: true });
      await writeFileAtomic(this.filePath, JSON.stringify(this.data, null, 2));
    } catch {
      // Never let stats tracking break the writing path.
    }
  }

  /**
   * Compute the dashboard snapshot. `activeProjects` is supplied by the
   * caller (this store has no knowledge of projects — keeps it
   * single-purpose). Synchronous: relies on `initialize()` having already
   * loaded persisted data (called at boot); if it hasn't, this reads
   * whatever's in memory (empty defaults) rather than blocking.
   */
  getSnapshot(activeProjects: number, now: Date = new Date()): WritingStatsSnapshot {
    const todayKey = dateKey(now);
    const wordsToday = this.data.days[todayKey] || 0;

    // "This week" = trailing 7 days including today (rolling window, not
    // calendar-week) — simplest definition that needs no week-start config.
    let wordsThisWeek = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      wordsThisWeek += this.data.days[dateKey(d)] || 0;
    }

    const wordsTotal = Object.values(this.data.days).reduce((sum, n) => sum + n, 0);

    const activeDays = Object.keys(this.data.days).filter((k) => (this.data.days[k] || 0) > 0);
    const { current, longest } = computeStreaks(activeDays);

    // A streak only counts as "current" if its most recent day is today or
    // yesterday — otherwise it's stale (today just hasn't been written in
    // yet doesn't break it; anything older does).
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = dateKey(yesterday);
    const mostRecentDay = activeDays.length ? activeDays.slice().sort().at(-1)! : null;
    const currentStreakDays = mostRecentDay === todayKey || mostRecentDay === yesterdayKey ? current : 0;

    return {
      wordsToday,
      wordsThisWeek,
      wordsTotal,
      currentStreakDays,
      longestStreakDays: longest,
      activeProjects,
      lastActiveIso: this.data.lastActiveIso ?? '',
    };
  }
}
