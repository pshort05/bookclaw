# Book Format & Structure

## What it is

Book Format & Structure is a single declaration you make when you create a book:
**story structure × form/length × chapter count × words per chapter**. That one
declaration then drives the whole book — it sets the per-chapter word targets used
during generation, injects a structure "rail" into the outline step, and powers a
per-book **Structure & Length** review panel that checks the finished manuscript
against what you asked for.

The four parts are:

- **Structure** — the beat framework the story follows (Three-Act, Save the Cat,
  Hero's Journey, and a dozen more), or an author-defined **Custom** structure.
- **Form / length** — the kind of work and its expected word band (flash, short
  story, novelette, novella, novel, epic, serial, pulp).
- **Chapter count** — how many chapters the book has.
- **Words per chapter** — the pacing dial.

The product of chapter count and words per chapter is the total word target.
**If that total falls outside the chosen form's word band, creation is hard-blocked
with a `400`** — you cannot accidentally declare a 5,000-word "novel" or a
300,000-word "short story."

## Why it matters

Different genres genuinely need different structures: Save the Cat is a workhorse
for thrillers but fails for romance; Romancing the Beat is built for romance but
useless for a whodunit. Picking the right framework up front means the AI plans the
outline to beats that readers of that genre actually expect, rather than defaulting
to one generic shape for every book.

Declaring the form and pacing up front also keeps the book honest about its own
scale. The word-band guard stops a "novel" from quietly coming out novella-length,
and the per-chapter target keeps chapters from drifting wildly long or short.
Everything downstream — generation targets, the structure rail, the length table —
reads from this one source of truth, so the book you get matches the book you
declared.

This feature is **smart-recommend, not force**. BookClaw suggests structures and
flags beats that look out of place, but it never auto-rewrites your outline or
blocks the pipeline on a "missing" beat. If you deliberately broke structure for
effect, choosing **No Structure / Author's Choice** turns enforcement off entirely.

## How to use it

### Declaring format at New Book

In the Studio **New Book** form you choose, in addition to the author/voice/genre:

1. **Structure** — pick from the catalog, or choose **Other / Custom** to define
   your own beats later in the review panel.
2. **Form / Length** — pick the form (this sets the word band your total must
   land in).
3. **Chapter count** and **Words per chapter** — the pacing dial. The form picker
   shows each form's typical chapter range as a guide.

If you want a recommendation first, the form can call
`POST /api/structures/recommend` with your genre/subgenre/premise to narrow the
field to the 1–3 best-fitting structures (see below).

All four fields are submitted together with the rest of the New Book payload
(`POST /api/books`). Format is **optional** — omit all four fields and the book is
created without a declared format (generation falls back to its built-in defaults).
But if you supply *any* format field you must supply *all four*, or you get a
validation error. The declaration is stored as a `format` block on the book's
`book.json` manifest.

You can also set or change the format on an existing book:

```
PUT /api/books/:slug/format
  body: { structure, form, chapterCount, wordsPerChapter, customStructure? }
```

This runs the same hard-block band validation as creation.

### The story-structure catalog

`GET /api/structures` returns the full catalog. Each structure carries a one-liner,
the genres it fits best, the genres it fits poorly, and its ordered beats with
expected positions (as a percentage of the manuscript):

| Structure | Best for |
| --- | --- |
| **Three-Act** | The flexible default — literary, historical, general fiction |
| **Save the Cat (15 beats)** | Thriller, mystery, sci-fi, fantasy, YA, commercial |
| **Hero's Journey (12 stages)** | Epic/high fantasy, myth, space opera, coming-of-age |
| **Story Circle (8 stages)** | Character-driven fiction, episodic, literary |
| **Seven-Point (Dan Wells)** | Genre fiction, fantasy, sci-fi, thriller, YA |
| **Fichtean Curve** | Thriller, horror, suspense, action — minimal setup |
| **Four-Act** | Literary, historical, family saga — splits the long Act 2 |
| **Five-Act (Freytag's Pyramid)** | Literary, tragedy, period drama, family saga |
| **Kishōtenketsu** | Literary, slice of life, speculative — no central conflict |
| **In Medias Res** | Thriller, action, sci-fi — open mid-action, then backfill |
| **Romancing the Beat (Gwen Hayes)** | Romance, rom-com, romantasy |
| **Mystery / Detective 5-Stage** | Mystery, cozy, whodunit, noir, crime |
| **Lester Dent Master Plot (pulp 4-quarter)** | Pulp, action, thriller, adventure, crime |
| **Martell Thematic (theme-as-spine)** | Literary thriller, psychological, character-driven |
| **Custom** | An author-defined structure with your own beats |
| **No Structure / Author's Choice** | Experimental, literary, memoir — enforcement off |

**Custom** lets you declare your own beat scaffold (for example, a four-summers /
winter-interludes shape). When the structure is Custom and no beats are defined
yet, the review panel will propose a beat scaffold the AI fits to your outline.

To get a recommendation rather than browse the whole list:

```
POST /api/structures/recommend
  body: { genre, subgenre?, description? }
```

This is a **pure heuristic — no AI call**. It scores each structure by genre fit
(and small premise-keyword boosts), returns the top 1–3 with explicit rationale,
and surfaces **No Structure** as a first-class option for literary/experimental
work. It is advisory; you still choose.

### The story forms and their word bands

`GET /api/forms` returns the forms. Each has a word band; your
chapter count × words per chapter must land inside it.

| Form | Word band | Typical chapters |
| --- | --- | --- |
| **Flash Fiction** | 100 – 1,500 | 1 |
| **Short Story** | 1,000 – 7,500 | 1–3 |
| **Novelette** | 7,500 – 17,500 | 3–8 |
| **Novella** | 17,500 – 40,000 | 8–20 |
| **Novel** | 40,000 – 120,000 | 20–45 |
| **Epic** | 120,000+ (open-ended) | 40–120 |
| **Serial (episodic)** | 2,000+ (open-ended) | 10–200 |
| **Pulp (fast, lean)** | 25,000 – 60,000 | 20–40 |

Forms with an open-ended maximum (**Epic**, **Serial**) enforce only the minimum.
For every other form, a total above the band is rejected with a message telling you
to choose a longer form or lower the counts; a total below the minimum is rejected
the same way.

### How the declaration drives generation

When you start a project against a book that has a declared format, the format flows
into generation automatically:

- **Per-chapter targets.** The book's `chapterCount` and `wordsPerChapter` become
  the project's generation defaults (`targetChapters` / `targetWordsPerChapter`).
  Anything you type into the project modal still wins, but otherwise the declared
  format sets the pacing. Each chapter step carries the per-chapter word target,
  which triggers multi-pass continuation when the model runs short.
- **The structure rail.** The chosen structure's beats — names, descriptions, and
  expected positions — are appended to the **outline / planning step's** prompt as
  a "rail": *"Plan the outline to the 'Save the Cat' structure. Hit these beats at
  roughly these positions…"*. The rail is built from the catalog or your custom
  beats alike. This is the only place the structure touches generation, and it is
  fail-soft: no format, or a structure with no beats (e.g. **No Structure**), means
  no rail is injected.

### The Structure & Length review

Each book gets a **Structure & Length** panel that checks the *finished manuscript*
against the *declared format*. It is two reviews:

**Length review** (`GET /api/books/:slug/length-review`) — fully deterministic, no
AI. It counts the words in each chapter file, compares each against its target
(the declared per-chapter target, or a per-chapter override), totals the book,
checks the total against the form band, and shows the **genre norm** word range
parsed from the genre's reader-expectations guide as a reference point. You can set
per-chapter target overrides with:

```
PUT /api/books/:slug/length-targets
  body: { overrides: { "<chapter>": <words>, ... } }
```

Overrides are re-validated against the form band — an override set that pushes the
total out of band is rejected with a `400`.

**Structure review** (`GET /api/books/:slug/structure-review`) — returns the chosen
structure, your editable outline, your confirmed beat→chapter mapping, and a
deterministic scoring **report** of how well the mapping fits the structure's
expected beat positions. To build the mapping:

```
POST /api/books/:slug/structure-review/propose
```

This is the one place the AI appears in the review: it proposes a beat→chapter
mapping for your outline (and, for a Custom structure with no beats yet, a custom
beat scaffold). It is fail-soft — an AI or parse failure returns an empty mapping
rather than an error. You then **edit and confirm** the mapping, saving it with:

```
PUT /api/books/:slug/structure-review
  body: { outline: [...], mapping: {...}, customStructure? }
```

The saved mapping is scored deterministically: each beat's position (its mapped
chapters' midpoint, as a percent of the book) is classified as in-range, misplaced,
or missing against the beat's expected range. Required ("must-have") beats that are
missing, or several beats out of range, flag the review as needing attention — as
**suggestions**, never as a block.

If a book has no declared format, the review endpoints return
`{ configured: false }` rather than an error.

## Under the hood

- `gateway/src/services/story-structures.ts` — the structure catalog (beats,
  genre-fit metadata), the heuristic `recommend()`, `resolveStructure()` (catalog
  or inline custom), and the deterministic `evaluateBeatMapping()` scorer.
- `gateway/src/services/story-forms.ts` — the form catalog and `validateFormFit()`,
  the word-band hard-block check.
- `gateway/src/services/format-input.ts` — `buildBookFormat()`, which validates raw
  creation/format input into the persisted `format` block (all-or-nothing fields,
  band check).
- `gateway/src/services/format-guide.ts` — `applyStructureRail()`, which appends the
  rail to the outline/planning step.
- `gateway/src/services/format-review.ts` — deterministic length counting/review,
  per-chapter target overrides, the beat-mapping parser, and structure-review
  persistence (`.length-targets.json`, `.structure-review.json`).
- `gateway/src/services/book.ts` — `formatGuideFor()` (builds the rail + targets
  from the manifest) and `setFormat()`.
- `gateway/src/services/book-types.ts` — the `BookFormat` shape on `BookManifest`.
- `gateway/src/api/routes/format-review.routes.ts` — the per-book structure-review
  and length-review endpoints.
- `gateway/src/api/routes/knowledge.routes.ts` — `GET /api/forms`,
  `GET /api/structures`, `POST /api/structures/recommend`.
- `gateway/src/api/routes/books.routes.ts` — format on `POST /api/books` and
  `PUT /api/books/:slug/format`.
- `gateway/src/api/routes/projects.routes.ts` — wires `formatGuideFor()` into
  project creation (per-chapter targets + structure rail).

## Related

- [Books & Authors](./books-and-authors.md) — creating books, choosing
  author/voice/genre, and the per-book container the format lives in.
- [Craft & Editorial](./craft-and-editorial.md) — outline checking, consistency,
  and the editorial passes that complement the structure review.
