# Genres and Genre Guides

## What it is

A **genre** in BookClaw is more than a label on a book. It is a small bundle of
craft knowledge — a *genre guide* — that teaches the writing agent what a genre
feels like and what its readers expect, so every outline, chapter, and revision
step writes to genre.

BookClaw ships with **roughly 190 built-in genre profiles** (193 at the time of
writing), from `contemporary-romance` and `romantasy` to `mundane-science-fiction`,
`cozy-mystery`, `biopunk`, and `comedy-western`. Genres are one of the named
**library kinds** (alongside authors, voices, pipelines, and sections).

Each genre is a directory of Markdown files. The canonical seven are:

| File | What it teaches |
|------|-----------------|
| `reader-expectations.md` | Tone & mood, pacing, setting conventions, character archetypes, length/format norms (POV, word-count band, heat/age category). |
| `tropes.md` | The recurring devices and situations readers love — a menu to pick from, not a checklist. |
| `themes.md` | The ideas and values the genre explores. |
| `beats.md` | Structural beats and the **obligatory scenes** readers would feel cheated without. |
| `must-haves.md` | A tight checklist of non-negotiables. |
| `genre-killers.md` | The anti-checklist — what makes genre readers stop reading or one-star a book. |
| `comps.md` | Comparable titles and *why* they work. |

A per-genre `meta.json` carries a one-line `description` and the publishing
`groups` the genre belongs to (e.g. `romance`, `fantasy`). A genre may omit any
of the seven files; missing ones are simply skipped.

## Why it matters

Generic AI prose reads generic. A romance written without genre awareness misses
the grovel and the meet-cute; a cozy mystery that ends in graphic violence will
get one-starred. The genre guide gives the agent the same shared vocabulary a
working genre author carries in their head — the obligatory scenes to hit, the
tropes to draw from, and the genre-killers to avoid.

Crucially, the guide is **snapshotted per book at creation**. When you create a
book and pick a genre, BookClaw copies that genre's files into the book's own
container (`workspace/books/<slug>/templates/genre/`). That frozen copy is what
the book generates from forever after — so editing a genre in the library later
never disturbs a book already in flight, and two books in different genres run
side by side without cross-contamination.

## How to use it

### Selecting a genre when you create a book

In the v6 studio, the **New Book** page includes a genre picker with a search box
and collapsible publishing-standard groups (Romance, Fantasy, Science Fiction,
Mystery & Crime, Thriller & Suspense, Horror, Western, Historical, Action &
Adventure, Speculative & Dystopian, Literary & Upmarket, Comedy & Satire). A
genre that belongs to several groups appears under each. Type to filter across
all 190+ at once.

The genre you choose at creation is the one BookClaw snapshots into the book.
Picking a genre is optional — a book with no genre simply generates without
genre context — but choosing one is the single biggest lever on how on-genre the
output reads.

If you create the book inside a **series**, it inherits the series' genre
(along with author, voice, and pipeline) unless you override it. Books created
through the API accept a `genre` field on `POST /api/books`; an unset genre falls
back to the series' genre when one exists.

### Grouping the Board by genre

The **Board** (the multi-book overview) can group your books by **Genre** as one
of its grouping dimensions (alongside Author and Series). Switch the grouping to
Genre to see every book bucketed by the genre it was created with — useful when
you run several genres at once and want to see your catalog the way a reader of a
storefront would. Each book card also shows its genre inline.

### Authoring and editing genres in the Asset Studio

Genres are editable as a library kind in the **Asset Studio**:

- **Built-in genres** under `library/genres/<name>/` ship baked into the app and
  are **read-only** in the UI.
- **Your genres** live in the user overlay,
  `workspace/library/genres/<name>/`. Anything you add or edit here is yours,
  survives upgrades, and **overrides a built-in of the same name**.

In the studio's library view, genres are shown with a search box and the same
collapsible publishing-standard groups as the New Book picker. Create a new genre
or edit an existing one's seven Markdown files directly; the studio writes into
the user overlay for you. Begin each file with a one-line summary sentence so it
reads well when stitched into a prompt.

To author a genre from scratch — what belongs in each file, the naming rules,
and the worked examples — follow the full how-to:
[How to Create Genre Guides](../HOW-TO-CREATE-GENRE-GUIDES.md). Two built-in
genres are the recommended references: `library/genres/romantasy/`
(tightly focused commercial fiction) and `library/genres/mundane-science-fiction/`
(craft-heavy and constraint-driven).

## Under the hood

A genre reaches the prompt through a single, well-defined path:

1. **Snapshot at create time.** `BookService.create()` copies the chosen genre's
   `*.md` files from the library into `workspace/books/<slug>/templates/genre/`.

2. **Composition.** When a book generates,
   `BookService.genreGuideOf(slug)` (and the active-book convenience wrapper
   `getActiveGenreGuide()`) reads that snapshot and composes the files into one
   block via `composeGenreGuide()`
   (`gateway/src/services/book.ts`). Files are concatenated in a fixed canonical
   order — reader-expectations → tropes → themes → beats → must-haves →
   genre-killers → comps — each under a `## Genre Guide — <Section>` header. Any
   unrecognized extra `.md` files are appended alphabetically.

3. **Injection.** The composed guide is threaded into the single
   `buildSystemPrompt` chokepoint in `gateway/src/index.ts`, under an
   `# Active Book — Genre Guide` heading that instructs the agent to "Write to
   this genre. Honor its conventions and reader promise, hit its obligatory
   scenes and must-haves, and avoid its genre-killers." Because every generation
   path — web chat, `/api/chat`, the Telegram and Discord bridges, and every
   pipeline step (planning, bible, production, revision) — funnels through this
   one chokepoint, the guide reaches interactive chat *and* automated book
   production alike. This is the Phase 7 "genre wiring" work.

4. **Per-book isolation.** Because each project is bound to a book at creation
   (`Project.bookSlug`), the genre resolves from that binding — never from a
   global pointer. Multiple books in different genres run concurrently without
   leaking each other's genre into the prompt. (Free chat with no book can still
   get genre context via a per-channel `/genre` selection, which composes from
   the *live* library rather than a book snapshot.)

The three storage locations:

| Location | Path | Role |
|----------|------|------|
| Built-in | `library/genres/<name>/` | Ships with the app; read-only. |
| User overlay | `workspace/library/genres/<name>/` | Yours to add/edit; overrides built-ins by name. |
| Book snapshot | `workspace/books/<slug>/templates/genre/` | The frozen copy a specific book generates from. |

Genres are served and edited through the library API:
`GET /api/library/genre` (list), `GET /api/library/genre/:name` (read),
`POST /api/library/genre` (create), `PUT /api/library/genre/:name` (update),
`DELETE /api/library/genre/:name` (remove) — all in
`gateway/src/api/routes/library.routes.ts`. Genres can also be exported and
imported as portable `.zip` bundles via the library transfer endpoints.

## Related

- [How to Create Genre Guides](../HOW-TO-CREATE-GENRE-GUIDES.md) — the authoring
  walkthrough: what belongs in each of the seven files, naming rules, and worked
  examples.
- [Genre Guide Template](../GENRE-GUIDE-TEMPLATE.md) — the one-page schema
  reference.
- [Books and Authors](./books-and-authors.md) — creating books, choosing an
  author and voice, and how a book binds its templates.
