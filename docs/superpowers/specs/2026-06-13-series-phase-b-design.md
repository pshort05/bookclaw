# Series — Phase B design (2026-06-13)

Second phase of the Series feature: the **world-building artifact** (characters /
places / lore) that a series owns, books snapshot at create-time, and that reaches
generation prompts. Builds on Phase A (book-centric Series container + copy-on-create
inheritance). **Phase C** (Series studio route + New Book selector) stays out of scope;
Phase B is exercised via the API + smoke.

## Decisions (from brainstorming)

- World-building = **three markdown files**: `characters.md`, `places.md`, `lore.md`.
- Series-owned, **copy-on-create** into the book (consistent with author/genre).
- Reaches prompts the same way the genre guide does (compose → `buildSystemPrompt`),
  not via a load-bearing `WIRED_KINDS` change (genre itself injects without being in
  the set — the set is informational). We still add `worldbuilding` to `WIRED_KINDS`
  for documentation accuracy.

## Storage

- Series: `workspace/series/<id>/worldbuilding/{characters,places,lore}.md`
  (the per-series dir already exists from Phase A).
- Book snapshot: `workspace/books/<slug>/templates/worldbuilding/{characters,places,lore}.md`
  (+ captured into `.baseline/` like every other snapshot).

## Service / data flow

- **`SeriesBibleService.getWorldbuilding(id)` → `{characters,places,lore}`** (strings;
  missing files → ''); **`setWorldbuilding(id, files)`** writes the non-empty files
  under the series dir (fail-soft, tmp+rename per file).
- **`BookSelection.worldbuilding?: {characters?,places?,lore?}`** — `BookService.create`
  writes `templates/worldbuilding/*.md` for each non-empty file BEFORE the `.baseline`
  cp (so the baseline captures it).
- **`BookService.applySeriesAssets(slug, refs, worldbuilding?)`** — when `worldbuilding`
  is passed, rm+rewrite `templates/worldbuilding/` and `.baseline/worldbuilding/` to match
  (so "pull series assets" also resyncs world-building).
- **`BookService.worldbuildingOf(slug)` / `getActiveWorldbuilding()`** — compose the
  book's `templates/worldbuilding/*.md` (order characters → places → lore, each under a
  `## World-Building — <Title>` header; extra `.md` files alphabetically after). Returns
  null when no non-empty files. Mirrors `genreGuideOf`.

## Prompt injection

- `index.ts`: resolve `worldGuide = overrideSlug ? books.worldbuildingOf(overrideSlug)
  : books.getActiveWorldbuilding()`, pass to `buildSystemPrompt`.
- `buildSystemPrompt` gains a `worldGuide?` field and emits a `# Active Book —
  World-Building` section (placed right after the genre guide), instructing the model to
  treat it as canon for characters/places/lore.

## API (`series.routes.ts`)

- `GET /api/series/:id/worldbuilding` → `{ characters, places, lore }`.
- `PUT /api/series/:id/worldbuilding` `{ characters?, places?, lore? }` → writes the files.

## Inheritance wiring

- `POST /api/books` (series path): after resolving refs, also fetch
  `sb.getWorldbuilding(id)` and pass it as `selection.worldbuilding`.
- `POST /api/series/:id/pull/:slug`: pass `sb.getWorldbuilding(id)` to `applySeriesAssets`.

## WIRED_KINDS

Add `'worldbuilding'` to `WIRED_KINDS` (book-types.ts) — informational (`.has()`-only);
documents that the worldbuilding snapshot now drives generation.

## Out of scope (Phase B)

- World-building **divergence** detection (content-diff series vs book) — the gated
  "pull series assets" overwrites regardless; YAGNI for now.
- Series studio UI + world-building editor (Phase C).

## Testing (TDD)

- **Unit:** `SeriesBibleService` get/setWorldbuilding round-trip; `BookService`
  create-with-worldbuilding snapshot; `worldbuildingOf` composition (order + headers +
  null when empty); `applySeriesAssets` worldbuilding re-snapshot.
- **Integration:** extend `tests/extended-feature-smoke.sh` Tier G — set series
  worldbuilding → create book in series → assert the book's
  `GET /api/books/:slug/templates/worldbuilding`-style snapshot contains it (or assert via
  a worldbuilding read), and that `worldbuildingOf` is non-empty. Extend
  `tests/series-smoke.sh` to set + verify world-building on the 2 series books.
