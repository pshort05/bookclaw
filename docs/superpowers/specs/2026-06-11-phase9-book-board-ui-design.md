# Phase 9 — Book-Board UI (design spec)

**Date:** 2026-06-11
**Status:** Decisions confirmed (owner, 2026-06-11) — ready for an implementation plan. See §6.
**Roadmap:** [BOOK-CONTAINER-ARCHITECTURE.md](../../BOOK-CONTAINER-ARCHITECTURE.md) Phase 9 (follows Phase 8 multi-book concurrency; precedes Phase 10 per-channel active book)
**Mockup:** `dashboard/concept/phase9-book-board.html` (faithful Atelier mockup of the enriched board, drawer, full rail, and the three polish items — open in a browser).

## 1. Goal

Make the studio's Book Board the **face of the studio**: a single surface that shows every book with its phase, status, **next action**, **progress**, and a **live "now generating" indicator**, with drill-in. Phase 6 shipped a *minimal* board (title / byline / genre / phase pill / slug / status flag + a ghost New-Book card) and a fairly complete drill-in drawer; Phase 9 enriches the card and wires the data that makes the board legible at a glance while several books run concurrently (the Phase 8 payoff). It also folds in three small studio-wide polish items surfaced during the Phase 8 cheap-model smoke runs.

### Success criteria (from the roadmap)
1. **All** books shown, each with live **phase**, **next-action**, and **progress**.
2. **Create / activate / drill-in** flows all work.
3. A book with a running project shows a **live** indicator (and the rail's Generating/Idle counts are real).

### Explicitly out of scope
- Per-channel active book (**Phase 10**).
- New Write / Asset-Studio / New-Book flows — those already exist (Phase 6d–6g); Phase 9 only links to them.
- Backup & recovery (**Phase 11**), library share/import (**Phase 12**).
- A browser DOM test harness (Playwright) — tracked separately; Phase 9 verifies via the build-then-assert unit tests + a live visual check on Mercury.

## 2. Current state (grounding)

- **Board** — `frontend/studio/src/routes/Board.tsx`. Renders per book: phase pill (`PHASE_VAR` → `--ph-*`), title, genre, byline (author · voice), slug, and a status flag when `status !== 'ok'`; plus a ghost New-Book card → `/new-book`. Data via `useBooks()` (store → `GET /api/books`). **Missing on the card:** next-action, progress, live indicator. (The Phase-6 concept `dashboard/concept/phase6-studio-shell.html` already designed `.card.live`, `.phase.gen`, and a segmented `.prog` bar — unwired.)
- **Drawer** — `frontend/studio/src/components/BookDrawer.tsx`. Shows the 2×2 asset grid (author/voice/genre/pipeline + descriptions), the next-step (`GET /api/books/:slug/next`), a 6-row phase timeline (done/current/upcoming), and actions (Set-as-active via `POST /api/books/active`, Open-in-Write). **Largely complete** — Phase 9 keeps it, with minor visual parity to the mockup.
- **Rail** — `frontend/studio/src/Rail.tsx`. Full nav: **Studio** (Book Board · Write · Chat → external `:3848` · Series · Activity), **Make** (Library · Insights · Settings), **Approvals** (Confirmations + badge). Status footer is **static**: hardcoded "Generating 2 books / Idle 3 books" + the AI-spend budget bar (`costs.daily`).
- **`GET /api/books`** — `books.routes.ts:22` → `services.books.list()` returns `BookSummary[]` (`book-types.ts:44`): `slug, title, phase, schemaVersion, status, createdAt, author?, voice?, genre?`. **No** next/progress/live.
- **`nextStep(slug)`** — `BookService` already computes `{ phase, hasOutput, label, hint }` (reads the book's `data/` for `hasOutput`). Server-side only.
- **Active projects** — `ProjectEngine.listProjects('active')` (`projects.ts:762`) returns active `Project[]`; each carries `bookSlug` (Phase 8), `progress` (0–100), and `steps[]` with an `active` step.
- **Activity** — `frontend/studio/src/routes/Activity.tsx` uses `hhmm(ts)` (`frontend/shared/src/format.ts` → `HH:MM`, minute resolution); rows are `.ev` (`Activity.module.css`, `padding:11px 14px`).
- **Cost formatting** — `.toFixed(2)` at 4 sites: `Activity.tsx:82`, `Insights.tsx:53/65`, `Confirmations.tsx:54`, `Rail.tsx:169`.

## 3. Design

### 3.1 Backend — enrich `GET /api/books` (decision 2-A)

Widen the list payload so the board renders everything from **one** call (no N+1). In `books.routes.ts`, map each `BookSummary` to a `BookCard` adding two fields:

```ts
next: NextStep | null;                              // = books.nextStep(slug)
live: { stepLabel: string; progress: number } | null; // null unless a bound project is active
```

- `next` = `services.books.nextStep(slug)` (existing).
- `live` is derived once per request from the project engine (`gateway.getProjectEngine?.()` — `books.routes.ts` already has `gateway` in scope; guard the optional) via `engine.listProjects('active')`: build a `Map<bookSlug, activeProject>`; for a book with an active project, `live = { stepLabel: <active step's label>, progress: <project.progress> }`; else `null`. (Active step = `project.steps.find(s => s.status === 'active')`; fall back to the last step's label. If the engine is unavailable, `live` is `null` for all — fail-soft.)
- **Progress on the card is phase-based (decision 1-A)** and needs *no new field* — the client derives the 6-segment fill from the existing `phase`. `next`/`live` are the only additions.
- Keep the response shape `{ books: BookCard[] }`. Sort unchanged (newest-first). Cost: one `nextStep` data-dir stat per book + one pass over active projects — acceptable for a board refresh.

### 3.2 Frontend — enriched board card

`Board.tsx` + `Board.module.css` gain (ported from the concept CSS, see mockup):
- **6-segment phase progress bar** — one segment per pipeline phase in canonical order (`Planning → World & Characters → Production → Revision → Format & Compile → Launch`); segments before the current phase `lit` (ember gradient), the current phase `cur` (breathing), the rest dim. A caption "`<phase>` · `N`/6 phases".
- **Live strip** — when `live != null`: a pulsing pip + "writing · `<stepLabel>`" (and the phase pill's dot pulses, `.phase.gen`). The whole card gets the `.live` treatment (ember edge + glow).
- **Next-action footer** — a divider then "`next.label`" with `next.hint` right-aligned (only when `next != null`).
- Ghost New-Book card, byline, status flag, and the active-book marker stay.

### 3.3 Frontend — live rail status (replaces the hardcoded counts)

`Rail.tsx`: compute from `useBooks()` — `generating = books.filter(b => b.live).length`, `idle = books.length - generating` — and render those in the status footer instead of the static "2 / 3". The budget bar is unchanged except for cost precision (§3.4). Rail nav is **unchanged** (all items, including the external Chat link, stay).

### 3.4 The three GUI-polish items (studio-wide)

1. **Seconds in activity timestamps.** Add `hhmmss(ts)` → `HH:MM:SS` to `frontend/shared/src/format.ts` (or extend `hhmm` callers); use it in `Activity.tsx`. The activity events already carry full ISO timestamps.
2. **Single-spaced activity rows.** Tighten `.ev` in `Activity.module.css` (e.g. `padding: 11px 14px` → `padding: 4px 12px`, `gap: 16px` → `gap: 12px`) so more events are visible; keep the `.now` accent.
3. **Fractional cents (4 decimals).** Add a shared `money(n)` helper to `format.ts` → `'$' + n.toFixed(4)`. Apply to **spend amounts** (`Activity.tsx` per-event cost, `Insights.tsx` daily/monthly, `Confirmations.tsx` estimatedCost, `Rail.tsx` daily spend). **Limits stay 2-decimal** (`$5.00`, not `$5.0000`) — `money()` is for spent figures, not caps. So the rail/insights read `$0.0137 / $5.00`.

### 3.5 Component boundaries

- `BookCard` (presentational) — takes a `BookCard` record, renders pill/title/byline/progress/live/next. New small component or inline in `Board.tsx` (match existing structure).
- `money()` / `hhmmss()` — pure helpers in `frontend/shared/src/format.ts`, independently unit-testable.
- Backend enrichment — confined to the `GET /api/books` handler; `BookService` and `ProjectEngine` are unchanged (the route composes them).

## 4. Data flow

`Board mount → store.loadBooks() → GET /api/books → BookCard[] (slug,title,phase,status,byline,next,live)` → `useBooks()` feeds Board cards **and** the Rail status counts (single source). Drill-in still lazy-loads `GET /api/books/:slug` + `/next` in the drawer (unchanged). Live refresh: the board re-fetches on the existing activity SSE tick / route focus (no new socket); a running book's strip updates on the next `loadBooks()`.

## 5. Verification

- **Unit (`tests/unit/`)** — pure helpers: `format` tests for `hhmmss()` (pads seconds; handles missing ts) and `money()` (4 decimals; `$0.0001`; `$0` → `$0.0000`). Backend: a test for the `GET /api/books` enrichment shape — `next` present per book; `live` is `null` with no active project and `{stepLabel,progress}` when a bound project is active (construct via `ProjectEngine` with a fake active project carrying `bookSlug`).
- **Frontend build** — `npm run build:frontend` + the `studio-build`/`chat-build` build-then-assert tests stay green (compile + bundle).
- **feature-smoke (`tests/feature-smoke.sh`)** — extend Tier A: assert `GET /api/books` items now carry a `next` object (and, after a pipeline is kicked in Tier C/D, that the bound book's entry shows `live != null` with a `stepLabel`). Non-destructive, cheap.
- **Live visual check (Mercury)** — deploy and confirm the board renders progress + live strip + next-action, the rail counts move, activity shows `HH:MM:SS` single-spaced, and costs read 4-decimals. (This is the documentation-screenshot surface — the renamed real book titles make it presentable.)

## 6. Decisions (owner-confirmed 2026-06-11)

- **1-A — Progress is phase-based** ("N/6 phases" from the manifest `phase`), not a step-percent. The fine-grained step appears only in the live strip when a project is running. (Cheap, always available, no per-book project required.)
- **2-A — Enrich `GET /api/books`** with `next` + `live` (one call), rather than N+1 per-book `/next` calls.
- **Keep the full rail** — every nav item (Studio/Make/Approvals) including the external **Chat** link to `:3848`, and the bottom status block; the only rail change is making Generating/Idle counts real and applying 4-decimal cost precision.
- **4-decimal precision applies to spent amounts only**; budget **limits stay 2-decimal**.
- **Live state is derived from the Phase-8 `Project.bookSlug` binding** (active projects grouped by bound book) — no new persistence.

## 7. Risks

- **List-call cost** — enriching with `nextStep` adds a `data/` stat per book. Books lists are small and the board refresh is infrequent; acceptable. If a workspace ever holds many books, revisit with a cached phase/hasOutput on the manifest.
- **Live staleness** — the strip reflects the last `loadBooks()`; a step finishing between refreshes shows briefly stale. Acceptable for a glanceable board (the Activity feed is the real-time surface).
- **Cost-format reach** — applying `money()` must not hit budget **limits** (would render `$5.0000`). The plan enumerates the exact call sites and which argument is a spend vs a cap.
