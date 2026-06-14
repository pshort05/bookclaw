# Series Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A book-centric Series container that books inherit author/voice/genre (+optional pipeline) from via copy-on-create snapshot, with book membership, divergence detection + "pull series assets," and the continuity report repointed to books.

**Architecture:** Evolve `SeriesBibleService` (series-bible.ts) into a per-series-directory store (`workspace/series/<id>/series.json`) with library asset refs + book membership, fail-soft migrating the old flat `workspace/series.json`. `POST /api/books` gains an optional `series` that resolves to a `BookSelection`; `BookService` records series provenance and can re-apply series assets. API lifts into `series.routes.ts`.

**Tech Stack:** Node 22 + TypeScript (tsx), Express, node:test unit tests, bash smoke.

---

## File structure

- Modify `gateway/src/services/series-bible.ts` — Series manifest (refs + bookSlugs), per-dir storage, migration, divergence, report repointed to books.
- Modify `gateway/src/services/book.ts` — `BookSelection.series` provenance; `applySeriesAssets(slug, refs)`.
- Modify `gateway/src/services/book-types.ts` — `BookManifest.pulledFrom.series?`.
- Create `gateway/src/api/routes/series.routes.ts` — full `/api/series` surface.
- Modify `gateway/src/api/routes/wave.routes.ts` — remove the old `/api/series` block.
- Modify `gateway/src/api/routes.ts` — `mountSeries` (drop series from wave).
- Modify `gateway/src/api/routes/books.routes.ts` — `POST /api/books` `series` param.
- Modify `gateway/src/init/phase-09-export-wave.ts` — pass `books` + project-engine resolver to the service; new workspace dir.
- Create `tests/unit/series-store.test.ts`, `tests/unit/series-membership.test.ts`, `tests/unit/series-divergence.test.ts`, `tests/unit/series-create-book.test.ts`.
- Modify `tests/extended-feature-smoke.sh` — Tier G (series).

---

## Task 1: Series manifest + per-dir storage + migration

**Files:** Modify `series-bible.ts`; Test `tests/unit/series-store.test.ts`

New `Series` shape adds `pulledFrom` (author/voice/genre/pipeline refs) + `bookSlugs`; storage moves to `workspace/series/<id>/series.json`; `initialize()` migrates an existing flat `workspace/series.json` (`{series:[…]}`) into per-dir manifests then renames the old file to `series.json.migrated`.

- [ ] **Step 1 — failing tests:** `createSeries({title})` writes `workspace/series/<id>/series.json` and `getSeries(id)` round-trips; a pre-seeded flat `workspace/series.json` with one entry is migrated on `initialize()` (entry readable via `listSeries()`, old file renamed); corrupt flat file → empty + no throw.
- [ ] **Step 2:** run `node --import tsx --test tests/unit/series-store.test.ts` → FAIL.
- [ ] **Step 3 — implement:** add `SeriesRef {name:string; source:'builtin'|'workspace'|'synthetic'}`; extend `Series` with `pulledFrom:{author?:SeriesRef;voice?:SeriesRef;genre?:SeriesRef|null;pipeline?:SeriesRef|null}` and `bookSlugs:string[]`; change `filePath`→`seriesRoot = workspace/series`; `seriesDir(id)`; per-dir read in `initialize()` (scan dirs for series.json) + `migrateFlat()` (read old `workspace/series.json`, write each into its dir, rename old). `persist(series)` writes one dir.
- [ ] **Step 4:** run test → PASS.
- [ ] **Step 5:** commit.

## Task 2: Refs setter + book membership

**Files:** Modify `series-bible.ts`; Test `tests/unit/series-membership.test.ts`

- [ ] **Step 1 — failing tests:** `setRefs(id,{author,voice,genre,pipeline})` persists refs; `addBook(id,slug)` appends to `bookSlugs`+`readingOrder` (idempotent); `removeBook` removes from both; `setReadingOrder` keeps only member slugs.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3 — implement:** `setRefs`, `addBook`, `removeBook`, `setReadingOrder` operating on `bookSlugs` (mirror the existing project methods, slug-based). Keep the old project methods unused-removed only if dead.
- [ ] **Step 4:** run → PASS.   **Step 5:** commit.

## Task 3: Divergence detection

**Files:** Modify `series-bible.ts` (pure helper) or new `gateway/src/services/series-divergence.ts`; Test `tests/unit/series-divergence.test.ts`

Pure function comparing a book's snapshot refs to the series' refs by NAME.

- [ ] **Step 1 — failing test:** `seriesDivergence(seriesRefs, bookPulledFrom)` returns `[]` when author/voice/genre names match; returns `[{kind:'author', series:'B', book:'A'}]` when the series author differs; ignores kinds the series doesn't set.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3 — implement:** `export function seriesDivergence(refs, book): Array<{kind,series,book}>` over author/voice/genre/pipeline, name-compare.
- [ ] **Step 4:** run → PASS.   **Step 5:** commit.

## Task 4: Book provenance + applySeriesAssets

**Files:** Modify `book.ts`, `book-types.ts`; Test `tests/unit/series-create-book.test.ts`

- [ ] **Step 1 — failing tests:** `create({…, series:{id,title}})` writes `manifest.pulledFrom.series={id,title}`; `applySeriesAssets(slug, {author,voice,genre})` re-snapshots those library entries into the book's `templates/` + `.baseline/` and updates `manifest.pulledFrom.{author,voice,genre}` names to match.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3 — implement:** widen `BookManifest.pulledFrom.series?:{id:string;title:string}`; `BookSelection.series?`; write it in `create()`; add `applySeriesAssets(slug, refs)` reusing `libraryFiles(kind,name)` to write `templates/<assetRel>` + `.baseline/<assetRel>` and update the manifest (gated by `assertWritable`).
- [ ] **Step 4:** run → PASS.   **Step 5:** commit.

## Task 5: Report repointed to books

**Files:** Modify `series-bible.ts`

- [ ] **Step 1:** `buildReport` resolves `series.bookSlugs` → each book's bound project ids (via an injected `projectsForBook(slug)=>string[]`), then runs the existing per-project ContextEngine merge. Backward-compat: if a migrated series has only `projectIds`, use those.
- [ ] **Step 2 — verify:** extend an existing report test or add a minimal one (member book with 0 projects → empty report, no throw). Run → PASS.
- [ ] **Step 3:** commit.

## Task 6: series.routes.ts + mounting

**Files:** Create `series.routes.ts`; Modify `wave.routes.ts` (remove series block), `routes.ts` (mountSeries), `phase-09-export-wave.ts` (inject deps).

- [ ] **Step 1:** create `mountSeries(app, gateway, baseDir)`: `GET /api/series`, `POST /api/series` (title+optional refs), `PUT /api/series/:id/refs`, `POST /api/series/:id/add-book|remove-book|reading-order` (slugs), `GET /api/series/:id/report`, `GET /api/series/:id/divergence/:slug`, `POST /api/series/:id/pull/:slug` (confirmation-gated via `requireApprovedConfirmation`/ConfirmationGate → `applySeriesAssets` + advance series ref), `DELETE /api/series/:id`.
- [ ] **Step 2:** remove the `/api/series*` handlers from `wave.routes.ts`; add `import { mountSeries }` + call in `routes.ts`.
- [ ] **Step 3 — verify:** `npx tsc --noEmit` clean.
- [ ] **Step 4:** commit.

## Task 7: POST /api/books series param

**Files:** Modify `books.routes.ts`

- [ ] **Step 1:** when `body.series` (string id) is set: load the series; resolve author/voice/genre from its refs (pipeline = series ref ?? body.pipeline); call `books.create({…, series:{id,title}})`; then `series.addBook(id, slug)`. Unknown series id → 400. Author/voice/pipeline still required after resolution.
- [ ] **Step 2 — verify:** `npx tsc --noEmit` clean; full unit suite green.
- [ ] **Step 3:** commit.

## Task 8: Smoke Tier G (series) + full verify

**Files:** Modify `tests/extended-feature-smoke.sh`

- [ ] **Step 1:** Tier G: create series → `PUT refs` (author/voice/genre from the library, resolved like Tier A) → `POST /api/books {series}` → assert `book.pulledFrom.author/voice/genre` == series refs and `book.pulledFrom.series.id` set → series report 200 → `GET divergence` empty → cleanup (delete book + series). Match by title for idempotent pre-clean.
- [ ] **Step 2 — verify:** `bash -n`; run full unit suite (`node --import tsx --test tests/unit/*.test.ts`) green; `npx tsc --noEmit` clean; `npm run build:frontend` green.
- [ ] **Step 3:** commit.

## Self-review notes
- Spec coverage: container+migration (T1), refs+membership (T2), divergence (T3), create-in-series snapshot + provenance + pull (T4,T7,T6), report repoint (T5), API (T6), smoke (T8). World-building/UI explicitly deferred (B/C).
- Types: `SeriesRef`, `Series.pulledFrom`, `Series.bookSlugs`, `BookManifest.pulledFrom.series`, `BookSelection.series`, `applySeriesAssets`, `seriesDivergence` — consistent across tasks.
