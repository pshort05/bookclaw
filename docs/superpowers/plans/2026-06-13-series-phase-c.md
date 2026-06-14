# Series Phase C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Studio UI for Series (list/create/edit/refs/world-building/members/report/pull/delete) + a New Book "Series" selector + the series name on the board card.

**Architecture:** One small backend field (`BookSummary.series`) + a `PUT /api/series/:id` edit route; the rest is React on existing A/B endpoints. New `Series.tsx` master-detail route; Rail entry goes live; Board byline + NewBook selector updated.

**Tech Stack:** Node 22 + TS (tsx), Express, React + Vite, node:test, bash smoke.

---

## Task 1: Backend — `BookSummary.series` (TDD)
**Files:** `gateway/src/services/book-types.ts`, `gateway/src/services/book.ts`; Test `tests/unit/book-baseline.test.ts` (or a new `tests/unit/book-series-field.test.ts`)
- [ ] Failing test: a book created with `series:{id,title:'Saga'}` → `list()` row has `series === 'Saga'`; a book with no series → `series` undefined/null.
- [ ] Run → FAIL.
- [ ] Implement: add `series?: string` to `BookSummary`; in `list()` add `series: m.pulledFrom?.series?.title ?? undefined`.
- [ ] Run → PASS. Commit.

## Task 2: Backend — `PUT /api/series/:id` edit (TDD)
**Files:** `gateway/src/services/series-bible.ts`, `gateway/src/api/routes/series.routes.ts`; Test `tests/unit/series-membership.test.ts` (add a case)
- [ ] Failing test: `update(id,{title:'New',description:'D'})` patches + persists; unknown id → null.
- [ ] Run → FAIL.
- [ ] Implement `SeriesBibleService.update(id, patch:{title?:string;description?:string})` (mutate, bump updatedAt, persist). Add route `PUT /api/series/:id` (title/description only; 404 unknown).
- [ ] Run → PASS; `npx tsc --noEmit` clean. Commit.

## Task 3: Shared type + Board byline
**Files:** `frontend/shared/src/types.ts`, `frontend/studio/src/routes/Board.tsx`, `Board.module.css`
- [ ] Add `series?: string` to `BookSummary` (shared).
- [ ] Board card byline: after the voice token, `{b.series && <><span className={styles.v} /> <span className={styles.series}>{b.series}</span></>}`; CSS `.series { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }` and ensure `.byline { min-width:0 }` children truncate (set `.byline b`/tokens flex-shrink). Verify `npm run build:frontend` green.
- [ ] Commit.

## Task 4: Series route (`Series.tsx`) + Rail + router
**Files:** Create `frontend/studio/src/routes/Series.tsx` (+ `.module.css`); modify `main.tsx`, `Rail.tsx`
- [ ] `Series.tsx`: master-detail.
  - Load: `api('/api/series')` → list; `api('/api/library/:kind')` for author/voice/genre/pipeline options; `api('/api/books')` for member titles + add-book options.
  - List pane: series rows (title + `bookSlugs.length` books) + "New series" (prompts title via in-component input → `POST /api/series`).
  - Detail pane (selected):
    - title/description inputs → Save (`PUT /api/series/:id`).
    - 4 ref `<select>`s (author/voice/genre[+none]/pipeline[+none]) → `PUT /api/series/:id/refs` on change.
    - 3 world-building `<textarea>`s loaded from `GET /api/series/:id/worldbuilding`; Save → `PUT …/worldbuilding`.
    - members: list (title + Remove `POST …/remove-book`; ▲/▼ → `POST …/reading-order`); Add-book `<select>` of non-members → `POST …/add-book`. Each member: "Pull assets" → `POST …/pull/:slug`; on 202 set pending + show Finalize (re-POST with `confirmationId`).
    - "View report" → `GET …/report` → render stats + contradiction count.
    - Delete series (confirm) → `DELETE /api/series/:id`.
  - Refresh the list after each mutation.
- [ ] `main.tsx`: import `Series`, add `<Route path="series" element={<Series />} />`.
- [ ] `Rail.tsx`: replace the placeholder `<a href="#">Series…</a>` with a `NavLink to="/series"` (drop the hardcoded count, or show live count if cheap — omit for simplicity).
- [ ] Verify `npm run build:frontend` green. Commit.

## Task 5: New Book series selector
**Files:** `frontend/studio/src/routes/NewBook.tsx`
- [ ] Load series via `api('/api/series')`. Add a "Series (optional)" `<select>` (None + each series). When set: include `series: seriesId` in the create POST; reflect the series' author/voice/genre in the pickers (read-only hint "from series"); keep pipeline required (series may set none). `canCreate` stays valid (title + pipeline; author/voice come from series).
- [ ] Verify `npm run build:frontend` green. Commit.

## Task 6: Smoke + full verify
**Files:** `tests/series-smoke.sh`
- [ ] series-smoke: assert `GET /api/books` rows for the 2 series books carry `series` == series title and the standalone has none; exercise `PUT /api/series/:id` (rename → reflected in list); `GET …/report` 200.
- [ ] Verify: `bash -n`; full unit suite green; `npx tsc --noEmit` clean; `npm run build:frontend` green. Commit.

## Self-review
- Spec coverage: card field (T1,T3), edit route (T2), Series UI (T4), New Book selector (T5), smoke (T6).
- Types: `BookSummary.series` (backend+shared), `SeriesBibleService.update`, route `PUT /api/series/:id` — consistent.
