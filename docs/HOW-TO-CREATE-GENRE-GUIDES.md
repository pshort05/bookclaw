# How to Create Genre Guides

A **genre guide** teaches BookClaw what a genre feels like and what its readers expect, so
every chapter, outline, and revision step writes to genre. This document explains the files
a genre guide is made of, what belongs in each, the rules they follow, and the ways to add a
new one. For the one-page schema reference, see [GENRE-GUIDE-TEMPLATE.md](GENRE-GUIDE-TEMPLATE.md);
for the *who writes it* side, see [HOW-TO-CREATE-AUTHOR-PROFILES.md](HOW-TO-CREATE-AUTHOR-PROFILES.md).

## What a genre guide is and how it is used

A genre is a small directory of Markdown files. When you create a book and choose a genre,
BookClaw takes a **snapshot** of that directory into the book
(`workspace/books/<slug>/templates/genre/`) and injects its contents into the system prompt
of generation — chat *and* every pipeline step (planning, bible, production, revision). The
snapshot is frozen per book (copy-on-create), so editing a genre in the library never
disturbs a book already in flight.

Two worked examples ship built in and are the best reference while you write your own:

- `library/genres/romantasy/` — a tightly focused commercial-fiction genre.
- `library/genres/mundane-science-fiction/` — a craft-heavy, constraint-driven genre.

## Where genre guides live

| Location | Path | Purpose |
|----------|------|---------|
| Built-in | `library/genres/<name>/` | Ships with the app (baked into the Docker image); read-only in the UI. |
| User overlay | `workspace/library/genres/<name>/` | Yours to add and edit. Overrides a built-in of the same name; survives upgrades. |
| Book snapshot | `workspace/books/<slug>/templates/genre/` | The frozen copy a specific book generates from. Edited only in the book's own scope. |

Most authors should write into the **user overlay** (directly on disk, or through the Asset
Studio, which writes there for you). Built-in genres are for content shipped with the
product.

## The seven files

Every `.md` file in the genre directory is concatenated into the prompt **in the order
below**. A genre may omit any file; missing ones are simply skipped. Begin each file with a
one-line summary sentence so it reads well when stitched into a prompt.

### 1. `reader-expectations.md`
The reader's promise — what the genre *feels like*. This is the descriptive backbone of the
guide. Cover, as labelled subsections:

- **Tone & Mood** — the emotional register (e.g. "heightened and immersive" vs. "serious and
  clear-eyed").
- **Pacing** — the rhythm readers expect (alternating romance/plot beats; problem-solution
  hinges; slow contemplative decay).
- **Setting Conventions** — where these stories take place and the conventions of that world.
- **Character Archetypes** — the roles readers expect to meet.
- **Length & Format** — word-count band, POV and tense norms, age/heat category, series vs.
  standalone expectations.

### 2. `tropes.md`
The genre's shared vocabulary — recurring devices and situations readers love. List a dozen
or so as a menu and tell the author to pick a few ("use three to six that serve your central
question"), not to use all of them. Tropes are flavor, not obligations.

### 3. `themes.md`
The ideas and values the genre explores (found family, love as power, the ethical weight of
scale, inherited commitments). Frame them as a short list to choose two or three from, so a
book has a thematic spine rather than a grab-bag.

### 4. `beats.md`
Structure and **obligatory scenes** — the plot set-pieces, in rough order, that readers would
feel cheated without. Give the dominant structure for the genre (e.g. the romance beat sheet,
the Four-Part Hinge) and then an explicit "Obligatory Scenes" list. Name alternate structures
briefly if the genre supports them.

### 5. `must-haves.md`
A tight, action-oriented checklist of non-negotiables — "skip these and it isn't really this
genre." Write them as checklist items (`- [ ] ...`) so they double as a revision pass. Keep
each item concrete and testable.

### 6. `genre-killers.md`
The anti-checklist — what makes genre readers DNF (did-not-finish) or one-star a book. The
mirror image of `must-haves.md`: the broken promises, the clichés played straight, the tonal
betrayals. Be specific about *why* each one loses the reader.

### 7. `comps.md`
Comparable titles and *why* they work — a source for deriving obligatory scenes and
calibrating tone. Real titles are ideal; if you leave placeholders, note that live comps get
filled in during the book-planning market-analysis step.

## `meta.json` (optional but recommended)

A small sidecar at `<genre-dir>/meta.json` gives the genre a one-line description shown in
the New Book picker and the book detail panel:

```json
{ "description": "Grounded near-future SF in the solar system — no FTL, aliens, or magic; hard-science rigor and the moral weight of decisions across decades." }
```

The description is metadata about the genre as a whole; it is separate from the seven content
files and is not injected into prompts.

## Naming rules

The directory name is the genre's identifier and must be filesystem-safe: lowercase letters,
digits, and hyphens only, starting with a letter or digit (e.g. `romantasy`,
`mundane-science-fiction`, `cozy-mystery`). This name appears in the genre picker and the
book's provenance.

## How to add a genre

Choose whichever fits how you work:

1. **Asset Studio (recommended for most users).** In the studio, go to **Make → Library &
   Assets**, select the **Genre** kind, and create a new entry. The editor writes the files
   into your user overlay (`workspace/library/genres/<name>/`). You can edit each file and set
   the description. (In a book's scope, the same editor edits that book's frozen snapshot
   instead of the library.)

2. **By hand on disk.** Create `workspace/library/genres/<name>/` and drop in the `.md` files
   (and optional `meta.json`). BookClaw picks it up on the next reload — restart the gateway,
   or use the authoring reload endpoint. This is the fastest path when adapting an existing
   craft document, as the built-in `mundane-science-fiction` genre was.

3. **Import a shared genre.** A genre can be exported and imported as a portable `.zip`
   through the Asset Studio's library import/export (the same secured transfer pipeline used
   for other library entries). Imports land in your user overlay.

4. **Contribute a built-in.** To ship a genre with the product, add it under
   `library/genres/<name>/` in the repository. It becomes available to every install on the
   next build.

After adding a genre, it is immediately selectable on the **New Book** page, snapshotted into
any book that chooses it, and injected into that book's generation prompts.

## Authoring tips

- **Write for a prompt, not a wiki.** The files are concatenated into a system prompt. Lead
  each with a one-line summary, keep entries tight, and prefer concrete, directive language
  ("alternate the kind of wall at each hinge") over essays.
- **Be opinionated.** A genre guide that says "pick three to six" and "never do X" steers the
  model far better than an exhaustive, neutral encyclopedia.
- **Make `must-haves.md` and `genre-killers.md` true opposites.** Together they form the
  positive and negative space of the genre; the model uses both to self-check.
- **Keep it proportionate.** The two shipped examples run from a couple of hundred words
  (romantasy `tropes.md`) to roughly a page (mundane-SF `must-haves.md`). A genre guide is a
  craft reference, not a textbook.

## Quick checklist

- [ ] Directory named with lowercase letters, digits, and hyphens.
- [ ] `reader-expectations.md` with Tone & Mood, Pacing, Setting, Archetypes, Length & Format.
- [ ] `tropes.md`, `themes.md`, `beats.md` (with an Obligatory Scenes list).
- [ ] `must-haves.md` and `genre-killers.md` as opposing checklists.
- [ ] `comps.md` with real comps or a note to fill them in during planning.
- [ ] `meta.json` with a one-line description.
- [ ] Each `.md` opens with a one-line summary sentence.
- [ ] Verified it appears under the Genre kind in the Asset Studio / New Book picker.
