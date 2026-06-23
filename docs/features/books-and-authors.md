# Books, Pen Names, and the Multi-Book Studio

## What it is

In BookClaw a **book** is a first-class, self-contained container — not just a folder of chapters. Each book lives at `workspace/books/<slug>/` and holds its own manifest, a frozen snapshot of the Author, Voice, Genre, and pipeline it was created from, and its own output files. Because every book carries its own identity, you can run many books at once, each under a different pen name, without one bleeding into another.

## Why it matters

Most writers don't write one book in one voice. You might run a propulsive thriller under one pen name, a lush romantasy under another, and a quiet literary standalone under a third — all in the same week. BookClaw treats each of those as an isolated unit with its own writing identity, so the model writes each book as the right author, with the right style and genre contract, even when several are generating concurrently. The snapshot-on-create design also means that editing an author profile in your library never disturbs a book already in flight: the book keeps the exact identity it was born with until you deliberately re-pull.

## How the book container is laid out

When you create a book, BookClaw resolves your selections from the library and **copies them in** (copy-on-create). The directory looks like this:

```
workspace/books/<slug>/
  book.json              # the manifest: title, schemaVersion, phase, provenance, history
  templates/             # the FROZEN snapshot the book generates from
    author/              # SOUL.md + PERSONALITY.md (+ meta.json)
    voice/               # STYLE-GUIDE.md + VOICE-PROFILE.md (+ meta.json)
    genre/               # the genre guide files (optional)
    pipeline/<name>.json # one per pipeline in the sequence
    sections/            # any chosen section templates
    skills/<name>/       # SKILL.md for each skill the pipeline references
  data/                  # generated outputs land here (one file per step + exports)
  .baseline/             # a pristine mirror of templates/, used for 3-way re-pull merges
```

The manifest (`book.json`) records where each component was pulled from (`pulledFrom.author`, `.voice`, `.genre`, `.pipeline`, plus the snapshotted `sections` and `skills`), the current lifecycle `phase`, and an append-only `history`. A `schemaVersion` field gates compatibility: a book written by a too-old app is **quarantined**, one written by a newer app is opened **read-only**, and v1 books are lazily migrated to v2 on open. Today both v1 and v2 classify as `ok`.

## How to use it

### Create a book

In the studio, open the **Board** and click the **New book** card (or navigate to **New Book** directly). On that page you:

1. Give the book a **Title** (this becomes its slug).
2. Optionally attach it to a **Series** — when you do, the book inherits the series' author, voice, genre, and world-building, and those pickers lock to keep the preview honest.
3. Pick an **Author** and a **Voice** (both required) — this is the pen name the book writes as.
4. Optionally pick a **Genre** (searchable, grouped by publishing category) and a **World**.
5. Choose a **Sequence** preset, then reorder, add, or remove the pipelines it will run. The panel previews the union of skills those pipelines reference.
6. Optionally declare a **Format** (structure × form × chapter count × words-per-chapter) and choose any **Sections**.

The right-hand **Snapshot summary** shows exactly what will be frozen into the book; click **Create** when it is ready. The page calls:

```
POST /api/books
  { title, author, voice, genre|null, world?, pipelineSequence:[...], sequence?,
    sections:[...], series?, structure?/form?/chapterCount?/wordsPerChapter? }
```

A book is created with `phase: "planning"` and a `history` entry of `created`.

### The active book

One book is the **active** book at any time — the target for free chat and the single global active-book pointer. Set it from the studio (selecting a book makes it active) or via the API:

```
GET  /api/books/active          # the active book + its gate status
POST /api/books/active { slug } # switch the active book
GET  /api/books/active/next     # the suggested next action for the active book
```

Switching the active book re-points the Author identity so chat immediately writes as the new book's pen name. On first run, BookClaw seeds a **Default Book** (built-in `default` author + voice + `novel-pipeline`) and activates it, so there is always an active book.

### Run multiple books concurrently under different pen names

Because each book is bound to its own Author/Voice/Genre snapshot at creation, you can have several books generating at once with no cross-contamination. Each project is bound to its book (`Project.bookSlug`), and generation resolves that book's identity statelessly per call — so a thriller under one pen name and a romantasy under another draft side by side, each in its own voice, with outputs landing under their own `data/` directories. This is the core "write in many pen names" capability.

### Author profiles and Voice profiles

A **pen name** in BookClaw is an Author profile paired with a Voice profile — two first-class library identities:

- An **author** entry holds the writer's identity and approach (`SOUL.md` + `PERSONALITY.md`).
- A **voice** entry holds the prose mechanics (`STYLE-GUIDE.md` + `VOICE-PROFILE.md`).

They are kept as separate library kinds so a voice can be mixed and matched, but a complete pen name is an author **plus** a voice, usually created under the same name. They are **cloneable and editable** in the Asset Studio (Make → Library), and both are **selectable per book** on the New Book page. To create or edit them, see [How to Create Author Profiles](../HOW-TO-CREATE-AUTHOR-PROFILES.md).

Once a book exists, its frozen author and voice can be edited in the book's own scope (this edits the snapshot, not the library):

```
GET  /api/books/active/templates/:kind/:name?   # read a snapshot (author|voice|genre|pipeline|section|skill)
PUT  /api/books/active/templates/:kind/:name?   # write the snapshot (author/voice trigger a soul reload)
```

If you later update the library and want a book to adopt the change, use re-pull, which does a 3-way merge against the book's `.baseline`:

```
GET  /api/books/active/repull                    # per-asset status (in-sync / library-updated / locally-edited / diverged / ...)
POST /api/books/active/repull/:kind/:name        # { resolution?: 'take-library' | 'keep-book' }
```

### The Book Board

The **Board** is the multi-book home view. It shows one card per book with its title, phase, byline (author · voice · series), a per-book phase-progress bar, and a live "writing…" strip while a book is generating. You can:

- **Filter** by phase, by **All**, or by **Needs you** (any book whose gate status is not `ok`).
- **Group by Author, Series, or Genre** — the grouping is a client-side view over the loaded list, with a catch-all bucket (`Standalone` for series, `Unassigned` otherwise) sorted last.

Click a card to open its drawer; click **New book** to create another. The board is fed by:

```
GET /api/books                 # all books, enriched with next-step + live state
GET /api/books/:slug           # one book's manifest, gate status, descriptions, phases
GET /api/books/:slug/files     # the book's data/ outputs (name, size, modified)
DELETE /api/books/:slug        # delete a book (re-seeds/activates another if it was active)
```

### Per-channel active book

Free chat follows the single global active book, but each **channel** (for example a Telegram chat) can pin its own book so different conversations target different books at once. A channel without an override falls back to the global active book. These overrides persist across restarts in `workspace/.config/channel-books.json` and are pruned on boot if the book they point at is gone. A parallel per-channel genre selection persists in `channel-genres.json`.

### Share a book

A whole book — manifest, snapshot, and data — can be exported and imported as a portable `.zip` through the same secured transfer pipeline used elsewhere:

```
GET  /api/books/:slug/export   # download <slug>.zip
POST /api/books/import         # upload a .zip (clean → lands; flagged → confirmation-gated; structural error → 400)
POST /api/books/import/finalize { confirmationId }  # complete a gated import after approval
```

## Under the hood

Key files:

- `gateway/src/services/book.ts` — `BookService`: create/list/open/delete, the active-book and per-channel pointers, the stateless per-book accessors (`authorDirOf`, `voiceDirOf`, `dataDirOf`, `genreGuideOf`, `pipelineOf`), re-pull, and snapshot composition for prompt injection.
- `gateway/src/services/book-types.ts` — `BookManifest`, `BookSummary`, `BookFormat`, the `schemaVersion` constants, `classifyVersion` (the gate), `slugify`, and `suggestedNextStep`.
- `gateway/src/api/routes/books.routes.ts` — the `/api/books*` REST surface: create, active book, templates, re-pull, files, format, and share/import.
- `frontend/studio/src/routes/NewBook.tsx` — the New Book page (author/voice/genre/world/sequence/format/section selection).
- `frontend/studio/src/routes/Board.tsx` — the Book Board (filters, group-by author/series/genre, per-book progress).
- `gateway/src/services/book-card.ts` — builds the enriched board cards (next-step + live state).

Notes worth knowing:

- The snapshot is **frozen at create time**; library edits never touch a book in flight. Re-pull is the explicit, merge-aware way to adopt later library changes.
- Author and Voice from the snapshot drive generation via `SoulService`; the pipeline drives the engine; genre, world, sections, and world-building reach prompts through the per-book accessors; skill *content* prefers the book's frozen copy while skill *matching* stays global.
- Template writes and re-pull are version-gated (a non-`ok` book refuses template writes); the engine's data-output path is intentionally not gated yet.

## Related

- [How to Create Author Profiles](../HOW-TO-CREATE-AUTHOR-PROFILES.md) — building and editing pen names (author + voice).
- [Pipelines and Sequences](./pipelines-and-sequences.md) — the steps a book runs and how to order them.
- [Genres](./genres.md) — the genre contract a book writes to.
- [Series](./series.md) — grouping books that share an author, voice, genre, and world-building.
