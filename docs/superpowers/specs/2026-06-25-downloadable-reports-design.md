# Downloadable Reports Subsystem: Design

**Date:** 2026-06-25
**Status:** Design approved (brainstorming). Next: implementation plan (writing-plans).
**TODO item:** "Consistency engine — production issues" #2 — Reports as a downloadable asset type (generalized to all analysis engines).

## Goal

Give every analysis engine a way to emit a human-reviewable, **downloadable** report, instead of the report living only in SQLite/sidecars where it is too long to review in a panel. Build a **generic reports subsystem** (store + API + studio page) and wire **all four** current engines to it: consistency, beta-reader, structure, plot-promises.

## Decisions captured in brainstorming

- **Generic** reports subsystem (not consistency-only), wired to **all four** engines now.
- Reports stored as files under each book's **`data/reports/`** (travel with the book container).
- **Timestamped history** with **keep-last-N per kind** (default N = 10).
- **Both formats**: `.md` (human) + `.json` (raw report).
- **Dedicated Reports studio page** (grouped by kind, timestamped versions, view + download) **plus** a "Download latest report" link in each engine's panel.
- Emitted on **every engine run** (snapshots; a re-run adds a new version), fail-soft.

## Architecture

A single `ReportsService` owns `data/reports/` per book. Each engine, at its completion point, renders markdown from its existing report object and calls `reports.write(...)`. A reports REST API lists/serves the files (reusing the existing `serveFile`), and a Reports studio page browses them. Reports are snapshots — the subsystem never mutates engine data, only persists rendered copies.

## Storage & identity

- Files: `data/reports/<id>.md` and `data/reports/<id>.json`, where **`id = <kind>-<timestamp>`**.
  - `kind ∈ { consistency, beta-reader, structure, plot-promises }`.
  - `timestamp` is a filesystem-safe UTC stamp `YYYYMMDDTHHMMSSZ` (e.g. `consistency-20260625T021000Z`). Passed into `write()` by the caller (no `Date.now()` inside pure code; the route/engine stamps it).
- Index: `data/reports/index.json` = `{ reports: [{ id, kind, title, generatedAt, summary }] }` for fast listing. If absent/corrupt, `list()` reconstructs metadata from filenames (fail-soft; `generatedAt` from the parsed timestamp, `title` from the kind label, `summary` empty).
- **Pruning:** on `write(kind)`, keep the newest **N = 10** ids of that kind; delete older `.md`/`.json` + their index entries.

## `ReportsService` (`gateway/src/services/reports.ts`)

- `write(bookSlug: string, kind: ReportKind, r: { title: string; markdown: string; json: unknown; summary?: string; timestamp: string }): { id: string } | null` — writes both files, updates `index.json`, prunes to N. Returns `{ id }` or `null` (fail-soft: a missing/unwritable `data/` dir logs `⚠` and returns null, never throws into the caller).
- `list(bookSlug: string): ReportMeta[]` — newest-first; `ReportMeta = { id, kind, title, generatedAt, summary, formats: ('md'|'json')[] }`.
- `resolvePath(bookSlug: string, id: string, format: 'md'|'json'): string | null` — `safePath`-guarded path under `data/reports/`, or null if it escapes / doesn't exist.
- `dataReportsDir(bookSlug)` derives from `BookService.dataDirOf(slug)` + `reports/` (created on first write).
- Constants: `REPORT_KEEP = 10`, `ReportKind` union, `KIND_LABELS` map.

## REST API (`gateway/src/api/routes/reports.routes.ts`, `mountReports`)

- `GET /api/books/:slug/reports` → `{ reports: ReportMeta[] }` (grouped/sorted newest-first). `SLUG_RE` + `books.exists` guarded.
- `GET /api/books/:slug/reports/:id?format=md|json&download=1` → streams the file via `serveFile` (inline preview unless `download=1`). Guards: `SLUG_RE`, `format ∈ {md,json}` (default `md`), `:id` matches `^[a-z-]+-\d{8}T\d{6}Z$`, and `resolvePath` (404 if missing, 403 on traversal).

## Emitters (fail-soft; report emission must never break an engine run)

Each emitter is a small **pure markdown renderer** (unit-testable) + one `reports.write` call at the engine's completion point, wrapped in try/catch.

- **consistency** (book-keyed): in `runConsistencyAudit`, after `store.saveReport`, render `AuditReport` → markdown (summary counts; findings grouped by severity then category with chapter refs + suggested fix; reverse index; orphan facts) and `reports.write(slug, 'consistency', {...})`.
- **structure** (book-keyed): when the Structure & Length review is produced/saved (`format-review.ts`), render the structure-review + length-review → markdown and write under the book slug.
- **beta-reader** (project-keyed): after a beta-reader run, resolve the book via `engine.getProject(projectId).bookSlug`; render `BetaReaderReport` → markdown; write. Skip (fail-soft) if the project has no `bookSlug`.
- **plot-promises** (project-keyed): after a promise audit, resolve `bookSlug` via the project; render `PromiseAuditReport` → markdown; write. Skip if no `bookSlug`.

Renderers live next to their engine (or in a `reports/renderers/` folder) as pure `(report) => string` functions so they are testable without I/O.

## Studio

- **Reports page** (`/reports`, new Rail link): fetches `GET …/reports`, groups by kind (using `KIND_LABELS`), lists each kind's timestamped versions with **View** (fetch the `.md`, render with the existing markdown renderer) and **Download** (`.md` / `.json`, via `?download=1`). Empty state when none.
- **Panel links:** each engine panel (Consistency, Structure & Length, plus the beta-reader/plot-promises surfaces) gets a "Download latest report" link → the newest report id of that kind (resolved from the reports list).

## Testing

- **Unit (`tests/unit/`):**
  - `ReportsService`: `write` creates `.md`+`.json`+index entry; `list` returns newest-first with correct metadata; **prune keeps exactly N** per kind and deletes older files+index entries; `resolvePath` rejects traversal (`../`) and bad formats; `list` reconstructs from filenames when `index.json` is missing.
  - The **four markdown renderers** (pure): each renders its key sections from a representative sample report (e.g. consistency md contains a findings section + a finding's chapter ref; beta-reader md contains the archetype scores; etc.).
  - Project→book resolution for the two project-keyed emitters (given a project with `bookSlug`, the report lands under that book; missing `bookSlug` → no write, no throw).
- **Smoke (`tests/consistency-smoke.sh`, extended):** after the consistency audit, assert a `consistency-*.md` and `.json` exist under the book's `data/reports/`, that `GET /api/books/:slug/reports` lists it, that `GET …/reports/:id?format=md` serves it, and that re-running keeps ≤ N versions.

## Out of scope / defaults

- `REPORT_KEEP = 10` (tunable constant). No cross-book aggregation. No scheduled/cron report generation. No edit/delete-from-UI (view + download only). No migration of historical SQLite/sidecar reports — reports accrue from the next run onward.

## Success criteria

1. Running any of the four engines writes a timestamped `.md` + `.json` under that book's `data/reports/`, capped at N per kind.
2. `GET /api/books/:slug/reports` lists them; `GET …/reports/:id?format=md|json[&download=1]` views/downloads them (traversal-guarded).
3. The Reports studio page browses them grouped by kind; each engine panel links its latest.
4. Emission is fail-soft (an engine run never fails because report writing failed).
5. Unit tests (service + 4 renderers + project→book) and the extended smoke pass; `tsc` clean.
