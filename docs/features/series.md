# Series — Multi-Book Continuity and Shared Setting

## What it is

A **series** is a book-centric container for the books that share a world: the
same author voice, the same genre, the same canon of characters, places, and
lore. It is the series-level analog of the per-book snapshot. Where a single
book freezes its own author/voice/genre at creation time, a series holds the
shared defaults that *new* books inherit, plus a body of series world-building
that gets copied into each member book and injected into its generation prompts.

A series tracks four things:

- **Member books** and their intended **reading order**.
- **Shared asset refs** — the author, voice, genre, pipeline, and world that new
  books created in the series inherit.
- **Series world-building** — `characters`, `places`, and `lore` canon owned by
  the series and snapshotted into every member book.
- A read-only **continuity report** that merges every member book's tracked
  entities and timeline into one view and flags cross-book contradictions.

Series live under `workspace/series/<id>/series.json`. Deleting a series never
deletes its member books.

## Why it matters

When you write book seven and need a background character's eye colour from book
two, the single-book context engine cannot help you — it only knows one book.
The series view unifies them. It gives you three concrete wins:

- **Consistency by inheritance.** A book created in a series starts with the
  right author, voice, genre, and world already snapshotted in, plus the series
  canon copied into its templates. You do not re-pick the same five settings for
  every book in a trilogy.
- **Canon in the prompts.** Series world-building is injected into each member
  book's system prompt the same way the genre guide is, so generated prose
  stays inside the established setting without you pasting lore into every
  request.
- **Cross-book contradiction detection.** The continuity report reconciles
  entities across books and surfaces divergences — an attribute that changed
  between books, or a timeline that moves backward within a book — so you catch
  them before a reader does.

## How to use it

### In the Studio (Series page)

Open the **Series** route. The page is a list on the left and a detail panel on
the right.

1. **Create a series.** Type a title in the "New series title…" box at the
   bottom of the list and click **Add**. The new series is selected
   automatically. You can edit its title and description inline in the detail
   panel.

2. **Set shared assets.** Under **Shared assets**, pick an `author`, `voice`,
   `genre`, `pipeline`, and `world`. Author and voice are required-style
   pickers; genre, pipeline, and world are optional ("— none —"). These are the
   defaults a new book inherits when you create it in this series. The world
   picker lists worlds from the World Repository (see [World Repository](./world-repository.md)).

3. **Write series world-building.** Under **World-building**, fill in
   `characters`, `places`, and `lore`. Click **Save world-building**. This canon
   is snapshotted into each book and injected into its prompts. An empty field
   is cleared (not stored).

4. **Add and order books.** Under **Books**, choose a book from the "Add a
   book…" dropdown to add it as a member. Use the up/down arrows to set the
   **reading order**. **Remove** takes a book out of the series (it is not
   deleted). To create a *new* book already inside the series, use the New Book
   flow's **Series** selector, which locks the new book's author/voice/genre to
   the series.

5. **Pull series assets into an existing book.** A book that pre-dates the
   series, or that has drifted, can be re-aligned with **Pull assets**. This is
   an irreversible overwrite, so it is confirmation-gated: the first click
   creates a request and shows "Approve the pull in Confirmations". After you
   approve it on the Confirmations page, click **Finalize** to apply. The pull
   overwrites the book's author/voice/genre snapshot and re-snapshots the series
   world-building.

6. **View the continuity report.** Click **View report** under **Continuity
   report** to see the merged stats — books, words, characters, locations, and
   the count of detected contradictions.

### Via the API

All routes sit behind the standard bearer-auth + IP allowlist on `/api/*`.

List and create:

```
GET  /api/series                      → { series: [...] }
POST /api/series                      { title, description? }  → { series }
PUT  /api/series/:id                  { title?, description? }  → { series }
DELETE /api/series/:id                → { success: true }
```

Shared asset refs (each value is a library entry name, or `null` to clear an
optional kind — `author`, `voice`, `genre`, `pipeline`, `world`):

```
PUT  /api/series/:id/refs             { author?, voice?, genre?, pipeline?, world? }  → { series }
```

Series world-building (`characters` / `places` / `lore` markdown; omit a key to
leave it unchanged, send `""` to clear it):

```
GET  /api/series/:id/worldbuilding    → { characters, places, lore }
PUT  /api/series/:id/worldbuilding    { characters?, places?, lore? }  → { characters, places, lore }
```

Membership and reading order (`slug` is a book slug; `order` is an array of
member slugs — non-member slugs are dropped):

```
POST /api/series/:id/add-book         { slug }  → { series }
POST /api/series/:id/remove-book      { slug }  → { series }
POST /api/series/:id/reading-order    { order: [slug, ...] }  → { series }
```

Continuity report and divergence:

```
GET  /api/series/:id/report           → { series, entities, timeline, contradictions, stats }
GET  /api/series/:id/divergence/:slug → { divergence: [{ kind, series, book }, ...] }
```

Pull series assets into a book (confirmation-gated):

```
POST /api/series/:id/pull/:slug       {}                       → 202 { gated: true, confirmationId }
POST /api/series/:id/pull/:slug       { confirmationId }       → { pulled: slug }
```

The same operations are exposed as MCP tools, including `create_series`,
`update_series`, `delete_series`, `add_book_to_series`,
`remove_book_from_series`, `set_series_reading_order`, `set_series_refs`,
`get_series_worldbuilding`, `set_series_worldbuilding`, `get_series_report`, and
`get_series_divergence`.

### Group the Board by series

On the Board, the "Group by" control offers **Series** alongside Author and
Genre. Selecting it renders your in-flight books in collapsible groups by their
series name; books with no series fall under **Standalone**.

## Under the hood

- **`gateway/src/services/series-bible.ts`** — the `SeriesBibleService`. Owns
  the `Series` shape (`pulledFrom` refs, `bookSlugs`, `readingOrder`),
  per-directory persistence (`workspace/series/<id>/series.json`, atomic
  temp-then-rename), and the one-time fail-soft migration from the legacy flat
  `workspace/series.json`. `buildReport()` merges every member book's
  `ContextEngine` entities and timeline into a `SeriesBibleReport` (read-only —
  it never mutates the per-book contexts), deduplicating entities by canonical
  name, reconciling attributes, and recording per-book deltas. Contradiction
  detection lives here: attribute mismatches across books become `warning`
  contradictions with a "decide which book is canon" suggestion, and
  `checkTimelineMonotonic` flags a timeline that moves backward within a single
  book. The pure `seriesDivergence()` helper compares a book's snapshot refs to
  the series' refs by name.

- **`gateway/src/api/routes/series.routes.ts`** — `mountSeries()`, the REST
  surface above. Resolves ref names against the library for their `source`,
  validates book slugs (`SLUG_RE`) and existence, repoints the report from
  projects to member books (each member's bound project ids), and wires the
  confirmation gate for the pull.

- **`gateway/src/services/book.ts`** — the book side of inheritance.
  `createBook` snapshots the series' world-building into
  `templates/worldbuilding/<characters|places|lore>.md`; `worldbuildingOf()`
  composes those files into the system prompt (mirrors the genre guide);
  `applySeriesAssets()` performs the gated pull, re-snapshotting the
  author/voice/genre and world-building and recording a `series-pull` history
  entry.

- **`frontend/studio/src/routes/Series.tsx`** — the Studio Series page (list,
  inline edit, asset-ref pickers, world-building editor, member add/remove and
  reorder, report, gated pull/finalize, delete).

## Related

- [Books and Authors](./books-and-authors.md) — the per-book container and the
  author/voice/genre snapshot that a series sets defaults for.
- [World Repository](./world-repository.md) — the curated world a series can
  bind as a shared `world` ref, layered alongside series world-building.
- [Continuity and Consistency](./continuity-and-consistency.md) — the per-book
  continuity and fact-ledger checks that complement the cross-book series
  report.
