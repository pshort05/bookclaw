# Spend Tracking + Overlay/Asset-Header Fixes — Design

Date: 2026-06-14

Three independent items from `docs/TODO.md`, bundled into one change:

1. **Persistent lifetime spend + per-book spend** (Owner roadmap) — incl. a Danger-Zone "reset total spend" control.
2. **Re-point the AI-generated-skill writer to the workspace overlay** (Quick cleanups).
3. **Asset Studio book-scope header shows the kind string instead of the asset name** (Quick cleanups).

The items touch mostly disjoint files and are implemented in parallel (see the plan).

---

## Item 1 — Persistent lifetime spend + per-book spend

### Goal
- A **lifetime total** that survives day/month rollover and restarts, shown below the daily spend in the Rail.
- A **per-book total**, shown on the BookDrawer detail panel.
- Book-less spend (free chat, planning) attributed to an `'unattributed'` bucket.
- A Danger-Zone control that resets the lifetime total and, selectively, chosen per-book totals — guarded by typing `RESET MY TOTAL SPEND`.

### Counter model (decided)
`totalSpend` and `byBook` are **independent odometers**, not a derived `sum(byBook) == total` invariant. Every `record()` increments both, so they stay equal in normal operation; the selective reset can intentionally diverge them (reset lifetime to \$0 while leaving a chosen book's figure intact). This is required by "reset lifetime **plus selectively** any book spends."

### Backend — `gateway/src/services/costs.ts`
- `PersistedState` gains `totalSpend: number` and `byBook: Record<string, number>`.
- Constructor / `initialize()` hydrate both (default `0` / `{}`); corrupted-state path stays fail-soft.
- `record(provider, tokens, estimatedCost?, bookSlug?)` — new optional 4th param. Always adds `cost` to `dailySpend`, `monthlySpend`, **and** `totalSpend`; adds to `byBook[bookSlug ?? 'unattributed']`.
- `checkReset()` (day/month rollover) and the existing budget `reset()` button **do not** touch `totalSpend` / `byBook`.
- New `resetLifetime(opts: { books?: string[]; unattributed?: boolean }): Promise<void>` — sets `totalSpend = 0`; for each slug in `opts.books` and (if `opts.unattributed`) the `'unattributed'` key, deletes that `byBook` entry; persists. Unlisted books keep their figures.
- `getStatus()` returns the existing fields plus `total: number` (rounded like `daily`/`monthly`) and `byBook: Record<string, number>` (rounded values).
- `persist()` writes the two new fields.

### Backend — recording sites (thread `bookSlug`)
- `gateway/src/index.ts:703` and `:762` (the `handleMessage` choke point used by **both** chat and pipeline steps) → pass `overrideSlug` (resolved at `index.ts:575`; `undefined` for free chat → `'unattributed'`).
- `gateway/src/services/skill-runner.ts` — `runExecutableSkillStep(deps, skillName, input, bookSlug?)` gains a 4th param; its `costs.record(...)` passes it through. The `costs.record` dep type widens to accept the optional `bookSlug`.
- Call sites: `projects.routes.ts:372` and `:570` pass `project.bookSlug` / `currentProject.bookSlug`; `index.ts:1832` (goal-engine) passes its bound book slug if available, else omits.

### Backend — endpoint (`gateway/src/api/routes/core.routes.ts`)
- `POST /api/costs/reset-total`, body `{ books?: string[]; unattributed?: boolean }` → `await services.costs.resetLifetime(...)`; respond with the fresh `getStatus()`. Validate `books` is an array of strings if present; ignore unknown slugs (delete is a no-op).
- `GET /api/costs` and `/api/status` are unchanged — they already return `getStatus()` verbatim, so `total` + `byBook` flow through automatically.

### Frontend — shared (`frontend/shared/src/types.ts`)
- `Costs` gains `total: number` and `byBook: Record<string, number>`.

### Frontend — Rail (`frontend/studio/src/Rail.tsx`)
- Render a lifetime-total line directly below the existing "AI spend · today" line: label "lifetime", value `money(costs?.total ?? 0)`. No budget bar (lifetime has no cap).

### Frontend — BookDrawer (`frontend/studio/src/components/BookDrawer.tsx`)
- In the `assets` block, add a "Spend" row: `money(useCosts()?.byBook?.[slug] ?? 0)`.

### Frontend — Danger Zone (`frontend/studio/src/routes/Settings.tsx` + new `ResetSpendModal.tsx`)
- A second Danger-Zone block "Reset total spend" with a button opening `ResetSpendModal`.
- `ResetSpendModal` mirrors `DeleteBooksModal` (two stages, client-side phrase gate):
  - **Stage 1 (select):** copy noting the lifetime total will be reset; a checklist of books (each showing its `byBook` figure) plus an "Unattributed" row, to *additionally* zero. Default: none checked.
  - **Stage 2 (confirm):** `CONFIRM_PHRASE = 'RESET MY TOTAL SPEND'`; the destructive button is disabled until the typed phrase matches exactly.
  - On confirm → `POST /api/costs/reset-total` with `{ books: [...selected], unattributed }` → `loadCosts()` to refresh the store.

### Tests
- **`tests/unit/costs.test.ts`** (new): `total`/`byBook` accumulate; both survive day/month rollover (`checkReset`) and the budget `reset()`; `bookSlug` attributes to the right bucket and `undefined` → `'unattributed'`; `resetLifetime` zeroes `total` and only the listed books (+ unattributed when flagged), leaving others intact; `getStatus()` includes rounded `total` + `byBook`; persistence round-trips the new fields.
- **`tests/api/api-test.sh`** (extend): `POST /api/costs/reset-total` returns 200 and the returned status shows `total === 0`.

---

## Item 2 — Re-point AI-generated-skill writer to the workspace overlay

### Change — `gateway/src/api/routes/heartbeat.routes.ts` (`POST /api/tools/ingest/save`, ~line 398)
- Change the write base from `join(baseDir, 'skills')` (baked built-in, lost on Docker rebuild, bypasses the overlay model) to `join(baseDir, 'workspace', 'library', 'skills')` — the canonical user-skill overlay path (same constant `authoring.routes.ts:23` uses).
- The `safePath(base, …)` base moves with it; the incoming `skillPath` `^skills[/\\]?` strip and the `services.skills.loadAll()` reload are unchanged. The skill then survives rebuilds and is tagged `source: workspace` by the loader.

### Test — `tests/api/api-test.sh` (extend)
- `POST /api/tools/ingest/save` with a minimal `skillMd` + `skillPath` (e.g. `skills/ops/spec-probe-skill/SKILL.md`), assert the skill appears in `GET /api/skills` tagged `source: workspace`, then clean up via the existing skill-delete endpoint.

---

## Item 3 — Asset Studio book-scope header shows kind instead of name

### Problem
For single-snapshot kinds (author / voice / genre / pipeline), book scope stores one entry per kind, so the editor header (`<h2>{name}</h2>`) renders the kind string ("genre") instead of the snapshotted asset's real name.

### Change — `frontend/studio/src/routes/AssetStudio.tsx` + the editors
- Derive a `displayName` from the active book's `pulledFrom.<kind>.name` (already surfaced by the books API as `author` / `voice` / `genre` / `pipeline` on the book object the studio store holds via `useBooks()`/active book).
- Pass an optional `displayName` prop into `ProseEditor` / `SkillEditor` / `PipelineEditor`; the header renders `displayName ?? name`.
- Only applies in **book scope** for the four single-snapshot kinds. Library scope and multi-entry kinds (sections / skills, which already carry real names) are untouched. No backend change.

---

## Out of scope
- No change to the budget cap / daily-monthly `reset()` semantics or its button.
- No `GET /api/v1/credits` account-level total (separate TODO follow-on).
- No ConfirmationGate involvement — `resetLifetime` mutates a local counter (no external side effect); the typed-phrase gate is the control, matching the delete-books Danger-Zone pattern.

## TODO bookkeeping
On completion, move all three items from `docs/TODO.md` to `docs/COMPLETED.md` with a `2026-06-14` date.
