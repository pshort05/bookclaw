# Series — Phase A design (2026-06-13)

First phase of the multi-book **Series** feature (North Star). Phase A delivers the
Series container + inheritance of the existing snapshot kinds (author / voice /
genre / optional pipeline) and book membership. **World-building (Phase B)** and the
**Series studio route + New Book selector (Phase C)** are deliberately out of scope;
Phase A is exercised via the API + smoke test.

## Decisions (from brainstorming)

- **Unified, book-centric Series** — one Series concept; keep the existing
  `SeriesBibleService` continuity aggregation, repointed to books.
- **Copy-on-create + re-pull** — a book created in a series snapshots the series'
  assets into its own `templates/` (consistent with the library→book snapshot);
  series edits surface a `series-updated` re-pull status.
- **Membership-only join (+ opt-in re-pull)** — adding an existing book records
  membership and never auto-overwrites its assets; a confirmation-gated "pull
  series assets" performs the overwrite.

## Storage / data model

Per-series directory `workspace/series/<id>/series.json` (mirrors the per-book
container; makes room for Phase B `worldbuilding/`). Manifest:

```
{ id, title, description,
  pulledFrom: { author: {name,source}, voice: {name,source},
                genre: {name,source}|null, pipeline: {name,source}|null },
  bookSlugs: string[], readingOrder: string[], createdAt, updatedAt }
```

The series carries **author + voice + genre** refs (+ optional **pipeline**) because
`POST /api/books` requires author/voice/pipeline. Sections stay per-book (YAGNI).

**Migration:** a one-time, fail-soft boot migration folds today's flat
`workspace/series.json` (`{series:[{id,title,description,projectIds,readingOrder,…}]}`)
into per-series dirs, preserving `projectIds` as continuity history. Corrupt/missing
input → start empty (never crash boot), mirroring the skills-overlay migration.

## Inheritance

`POST /api/books` gains an optional `series` (id). When present:
- author/voice/genre (and pipeline if the series sets one; else the request's
  pipeline) are resolved from the series' refs and snapshotted into the book's
  `templates/` by the existing `BookService.create` snapshot path;
- `book.json` `pulledFrom.series = {id, title}` records provenance;
- the book's slug is appended to the series' `bookSlugs` + `readingOrder`.

## Re-pull

Extend the existing per-book re-pull so a series-derived asset reports
`series-updated` when the series' ref differs from the book's snapshot baseline,
reusing the baseline / 3-way-merge machinery. "Pull series assets into book"
(confirmation-gated) overwrites the book's author/voice/genre[/pipeline] to match
the series.

## Continuity report

Repoint `SeriesBibleService.buildReport` from `projectIds` → member `bookSlugs` →
each book's bound projects → ContextEngine, so the existing entity/timeline/
contradiction aggregation keeps working in the book-centric model.

## API (`gateway/src/api/routes/series.routes.ts`, lifted from wave.routes.ts)

- `GET /api/series`, `POST /api/series`, `GET /api/series/:id/report`, `DELETE /api/series/:id` (kept).
- Membership becomes **book**-based: `POST /api/series/:id/add-book`, `/remove-book`, `/reading-order` (book slugs).
- Asset refs: `PUT /api/series/:id/refs` (author/voice/genre/pipeline).
- `POST /api/series/:id/pull/:slug` — confirmation-gated "pull series assets into book".
- `POST /api/books` gains the optional `series` param.

## Testing (TDD)

- **Unit:** series manifest CRUD + migration; book membership add/remove/reading-order;
  create-in-series snapshot (book's `pulledFrom` author/voice/genre match the series);
  re-pull `series-updated` detection; report repointed to books.
- **Integration:** a Series tier in `tests/extended-feature-smoke.sh` — create series →
  set refs → create book in series → assert the book snapshotted the series' assets →
  membership + report → cleanup (delete book + series).

## Out of scope (later phases)

- **B:** world-building artifact (`characters/places/lore.md`) + `WIRED_KINDS` +
  `buildSystemPrompt` injection.
- **C:** Series studio route (CRUD, members, report, world-building editor) + New Book
  "Series (optional)" selector.
