# Series — Phase C design (2026-06-13)

Final phase of the Series feature: the **studio UI**. Phases A+B shipped the
book-centric Series container, copy-on-create inheritance, and world-building +
prompt injection — all reachable only via the API today. Phase C exposes it in the
v6 studio and surfaces series membership on the board. **Frontend-only plus one
small backend field** — every endpoint it needs already exists and is smoke-covered.

## Scope

1. **Series route** (`/series`) — make the inert Rail "Series" placeholder a live
   `NavLink`; register the route. Master-detail layout:
   - **List (left):** all series (title + member count) + "New series".
   - **Detail (right), per selected series:**
     - Title + description (edit → `POST /api/series` for new; for existing, there is
       no PATCH today, so Phase C edits **title/description in place** via a new
       `PUT /api/series/:id` — small backend add, see below).
     - **Shared assets:** author / voice / genre / pipeline dropdowns populated from
       `GET /api/library/:kind`; change → `PUT /api/series/:id/refs`.
     - **World-building:** three textareas (characters / places / lore) loaded from
       `GET /api/series/:id/worldbuilding`; Save → `PUT …/worldbuilding`.
     - **Member books:** the series' `bookSlugs` rendered with titles (resolved from
       `GET /api/books`), each removable (`POST …/remove-book`); an "Add book"
       dropdown of non-member books (`POST …/add-book`); up/down reorder
       (`POST …/reading-order`).
     - **Continuity report:** a "View report" button → `GET …/report`; render the
       stat counts (books / words / characters / locations) + any contradictions.
     - **Pull series assets into a member book:** per-member button → `POST …/pull/:slug`
       (gated): on `202` show the "approve in Confirmations, then Finalize" flow
       (mirrors the Settings backup-cloud pattern; Finalize re-POSTs with the
       `confirmationId`).
     - **Delete series** (`DELETE /api/series/:id`, confirm).
2. **New Book** — add an optional **"Series"** selector. When a series is chosen,
   the create POST sends `{ title, series }` (the server inherits author/voice/genre
   + world-building); the author/voice/genre/pipeline pickers are disabled/annotated
   "from series" (pipeline still needed if the series sets none — keep the pipeline
   picker enabled, others reflect the series).
3. **Board card series name** — show the series in the card **byline** (`author ·
   voice · ◈ Series`), truncated so the card height is unchanged. Requires the
   backend field below.

## Backend additions (small)

- **`BookSummary.series?: string`** (book-types.ts + frontend `BookSummary`), mapped
  in `BookService.list()` from `m.pulledFrom?.series?.title ?? null`, so the board
  card (`GET /api/books`) carries it. **(TDD: book list test.)**
- **`PUT /api/series/:id`** `{ title?, description? }` → `SeriesBibleService.update(id, patch)`
  (rename/edit). **(TDD: series update test.)** (`refs`/`worldbuilding`/membership
  already have endpoints.)

## Frontend files

- Create `frontend/studio/src/routes/Series.tsx` (+ `.module.css`).
- Modify `frontend/studio/src/main.tsx` (route), `frontend/studio/src/Rail.tsx`
  (live NavLink), `frontend/studio/src/routes/Board.tsx` (+ `.module.css`) (byline
  series), `frontend/studio/src/routes/NewBook.tsx` (series selector),
  `frontend/shared/src/types.ts` (`BookSummary.series`).

## Testing

- **Unit (TDD):** `BookService.list()` maps `series`; `SeriesBibleService.update()`
  patches title/description (persisted).
- **Build:** `npm run build:frontend` green (no React component-test runner — UI is
  verified by build + smoke + a deploy click-through).
- **Smoke:** extend `tests/series-smoke.sh` to assert `GET /api/books` rows for the
  series books carry `series` == the series title, and exercise `PUT /api/series/:id`
  (rename) + the report endpoint. (Tier G in extended-feature-smoke already covers
  the create-in-series API path.)

## Out of scope
- Drag-and-drop reorder (use up/down buttons).
- World-building rich editor / live preview (plain textareas; Phase B markdown is
  injected as-is).
