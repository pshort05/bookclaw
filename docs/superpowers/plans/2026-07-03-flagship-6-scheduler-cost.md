# Flagship Scheduler + Cost Control Implementation Plan (Plan 6 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Run multiple books concurrently within a live-adjustable cap, with per-book budgets, graceful pause on a cost cap, per-provider throttling, and a cross-book fleet view.

**Architecture:** A global semaphore + queue over the existing per-project drive lock (`ProjectEngine.tryStartDriving`) caps concurrent drives at `maxConcurrentDrives` (default 3, live-adjustable like the cost limits). The existing `CostTracker` gates paid providers; a per-book budget and a graceful chapter-boundary pause are added. A per-provider in-flight throttle prevents rate-limit storms. A fleet endpoint reports every book's state.

**Tech Stack:** Node 22+, TypeScript (NodeNext `.js`), `node --import tsx --test`.

## Global Constraints
- Same as Plan 1. Reuse `ProjectEngine`'s drive lock (`tryStartDriving`/`stopDriving`/`isDriving`, from bug-review #2/#5/#8) and `CostTracker` (`setLimits`/`isOverBudget`/`flush`, live-updatable from #16). Do NOT add a second lock or a second cost store.
- `maxConcurrentDrives` and the per-provider throttle are config values, live-adjustable via `/api/config/update` (mirror the `costs.dailyLimit` live-sync pattern already wired in `settings.routes.ts`).
- Graceful, never abrupt: a cost/cap trip pauses at the next chapter boundary with a human-review notice — never a mid-chapter hard fail.
- **Re-ground note:** confirm the drive-lock method names and the `/api/config/update` live-sync pattern before writing tests.

## File Structure
- Create `gateway/src/services/pipeline/scheduler.ts` — `DriveScheduler` (semaphore + FIFO queue) wrapping the drive lock; `acquire(projectId)` / `release(projectId)` / `queued()` / `setMaxConcurrent(n)`.
- Create `gateway/src/services/pipeline/provider-throttle.ts` — `ProviderThrottle` (max in-flight per provider) — `run(provider, fn)`.
- Modify `gateway/src/services/costs.ts` — a per-book budget check helper `wouldExceedBook(slug, projected)` (reads a per-book spend accumulator).
- Modify the drive entry points (`projects.routes.ts` auto-execute, `index.ts` autoRunProject, `phase-10` driveProject) — acquire/release via the scheduler; check the cost cap at chapter boundaries.
- Modify `gateway/src/api/routes/settings.routes.ts` — live-sync `maxConcurrentDrives` + throttle on `/api/config/update`.
- Add `GET /api/books/fleet` — cross-book state.
- Tests: `tests/unit/scheduler.test.ts`, `tests/unit/provider-throttle.test.ts`, `tests/unit/cost-book-budget.test.ts`.

## Tasks

### Task 1: `DriveScheduler` (semaphore + queue)
**Files:** create `scheduler.ts`; test `scheduler.test.ts`.
**Interfaces:** `class DriveScheduler { constructor(engine, maxConcurrent) ; acquire(projectId): Promise<boolean> ; release(projectId): void ; queued(): string[] ; running(): string[] ; setMaxConcurrent(n: number): void }` — `acquire` resolves true immediately if a slot is free (and takes the engine drive lock), else queues and resolves when a slot frees; `setMaxConcurrent` raising the cap drains the queue.
- [ ] TDD (no real engine — inject a fake lock): with max 2, three `acquire`s → two running, one queued; a `release` starts the queued one; `setMaxConcurrent(3)` drains immediately; a project already driven by another runner cannot be acquired. Commit.

### Task 2: `ProviderThrottle`
**Files:** create `provider-throttle.ts`; test `provider-throttle.test.ts`.
**Interfaces:** `class ProviderThrottle { constructor(limits: Record<string, number>) ; run<T>(provider: string, fn: () => Promise<T>): Promise<T> }` — caps concurrent `fn`s per provider, queuing excess.
- [ ] TDD: with `{ grok: 1 }`, two concurrent `run('grok', ...)` execute serially; different providers run in parallel; a default limit applies to unlisted providers. Commit.

### Task 3: Per-book budget + graceful pause
**Files:** modify `costs.ts` (add a per-book spend accumulator + `wouldExceedBook`), and the drive loop's chapter-boundary check.
- [ ] TDD: a book with `costBudget` set pauses (returns a `budget_pause` signal) at the next chapter boundary once its accumulated spend would exceed the budget; a global `isOverBudget()` trip pauses all in-flight books gracefully. Commit (unit for `wouldExceedBook`; integration for the boundary pause).

### Task 4: Wire the scheduler + throttle into the drive entry points
**Files:** modify `projects.routes.ts` auto-execute, `index.ts` autoRunProject, `phase-10` driveProject.
- [ ] TDD (integration): starting a 4th book while 3 drive → the 4th queues; finishing one starts the queued book; all AI calls go through the `ProviderThrottle`. Reuse (do not replace) the drive lock — the scheduler wraps it. Commit.

### Task 5: Live config + fleet view
**Files:** modify `settings.routes.ts` (live-sync `maxConcurrentDrives`/throttle on `/api/config/update`, mirroring the costs live-sync); add `GET /api/books/fleet`.
- [ ] TDD: POSTing `maxConcurrentDrives` updates the scheduler live (no restart); `GET /api/books/fleet` (auth-gated) returns each book's state (`running`/`queued`/`paused_budget`/`paused_review`/`idle`). Commit.

## Self-Review
- Spec coverage (§4.6): global semaphore + queue over the drive lock (T1, T4), per-provider throttle (T2, T4), per-book budget + graceful chapter-boundary pause (T3), live-adjustable cap (T5), fleet view (T5). Reuses the drive lock + CostTracker; no duplication. Scaling note (I/O-bound; SQLite single-writer past ~10) is documented in the spec, not built.
