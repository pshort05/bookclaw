# How to Create Author Profiles

An **author profile** gives BookClaw a named writing identity — who is telling the story and
how their prose sounds — so every chapter, outline, and revision step writes in a consistent
voice. This document explains the files an author profile is made of, what belongs in each,
the rules they follow, and the ways to add a new one. For genres (the *what* a book is, as
opposed to *who* writes it), see [HOW-TO-CREATE-GENRE-GUIDES.md](HOW-TO-CREATE-GENRE-GUIDES.md).

## What an author profile is and how it is used

In BookClaw an author profile is made of **two library kinds** that pair together:

- an **author** entry — the writer's *identity and approach* (`SOUL.md` + `PERSONALITY.md`), and
- a **voice** entry — the writer's *prose mechanics* (`STYLE-GUIDE.md` + `VOICE-PROFILE.md`).

They are kept as separate kinds so a voice can be mixed and matched, but a complete profile is
an author **plus** a voice, usually created under the same name. When you create a book you
pick one author and one voice; BookClaw snapshots both into the book
(`workspace/books/<slug>/templates/author/` and `…/templates/voice/`) and composes their
contents into the **system prompt** for generation — chat *and* every pipeline step. The
snapshot is frozen per book (copy-on-create), so editing a profile in the library never
disturbs a book already in flight.

An author profile answers *who is writing and how*; the **genre** answers *what the book is*.
They compose: at book creation you choose Author + Voice + Genre, and all three are injected
together without overlap. Keep genre-contract material (tropes, beats, reader expectations) in
the genre guide, and keep style and identity in the profile.

Three worked examples ship built in and are the best reference while you write your own:

- `library/authors/default/` + `library/voices/default/` — a neutral starting identity to clone.
- `library/authors/contemporary-thriller/` + `library/voices/contemporary-thriller/` — a propulsive, plot-first commercial voice.
- `library/authors/military-romantasy/` + `library/voices/military-romantasy/` — a high-intensity, deeply interior voice meant to pair with the `romantasy` genre.

## The two kinds and four files

| Kind | File | Role — what it answers |
|------|------|------------------------|
| author | `SOUL.md` | The core identity: who this writer is, what they care about, how they approach a story and the reader. The heart of the profile. |
| author | `PERSONALITY.md` | The working temperament: habits, discipline, instincts, and what they refuse to do. Optional but recommended; it sharpens `SOUL.md`. |
| voice | `STYLE-GUIDE.md` | The prose mechanics as a set of concrete, directive rules: sentence rhythm, dialogue, chapter shape, things to do and avoid. |
| voice | `VOICE-PROFILE.md` | The narrative voice in a few sentences: the register, distance, and texture the reader should feel. |

Each file is read if present and composed into the prompt. `SOUL.md` is the one indispensable
file; the others enrich it. Begin each file with a one-line summary sentence so it reads well
when stitched into a prompt.

## Where author profiles live

| Location | Path | Purpose |
|----------|------|---------|
| Built-in | `library/authors/<name>/` and `library/voices/<name>/` | Ships with the app (baked into the Docker image); read-only in the UI. |
| User overlay | `workspace/library/authors/<name>/` and `workspace/library/voices/<name>/` | Yours to add and edit. Overrides a built-in of the same name; survives upgrades. |
| Book snapshot | `workspace/books/<slug>/templates/author/` and `…/templates/voice/` | The frozen copy a specific book generates from. Edited only in the book's own scope. |

Most authors should write into the **user overlay** (directly on disk, or through the Asset
Studio, which writes there for you). Built-in profiles are for content shipped with the
product.

## The files in detail

### `SOUL.md` (author)
The writer's identity in the second person ("You are a…"). State what kind of novelist this
is, who they write for, what they value, and the contract they keep with the reader. This is
the most load-bearing file — it sets the personality the model writes *as*. Keep it vivid and
opinionated rather than a neutral résumé. (See `library/authors/contemporary-thriller/SOUL.md`.)

### `PERSONALITY.md` (author)
The working temperament that flavors every choice: what this writer fixes instinctively, what
they cut, what they are "allergic to." Where `SOUL.md` is identity, `PERSONALITY.md` is habits
and discipline. A short paragraph or two.

### `STYLE-GUIDE.md` (voice)
The prose rules, as a directive checklist the model can apply line by line — sentence length
and rhythm, dialogue conventions, chapter shape and endings, POV handling, and an explicit
"avoid" list of the failure modes this voice is prone to. Concrete beats abstract: "very short
chapters, 3 to 7 pages, end on a hook" steers better than "fast pacing."

### `VOICE-PROFILE.md` (voice)
A few sentences naming the narrative voice — its register (urgent, lush, clipped, warm), its
distance and interiority, and the feeling it should leave. This is the high-level description
that the `STYLE-GUIDE.md` then operationalizes.

## `meta.json` (optional but recommended)

A small sidecar at `<author-dir>/meta.json` (and `<voice-dir>/meta.json`) gives the entry a
one-line description shown in the New Book pickers and the book detail panel:

```json
{ "description": "A bestselling contemporary thriller novelist: a big-pop opening, a ticking clock, very short cliffhanger chapters, and a competent protagonist in over their head." }
```

The description is metadata about the entry as a whole; it is separate from the content files
and is not injected into prompts.

## Naming rules

The directory name is the entry's identifier and must be filesystem-safe: lowercase letters,
digits, and hyphens only, starting with a letter or digit (e.g. `contemporary-thriller`,
`military-romantasy`). Create the author and its paired voice under the **same name** so they
are easy to select together. If you are basing a profile on a living author's craft, prefer a
**descriptive** name (`military-romantasy`) over the person's name — the goal is a reusable
style, not an impersonation.

## How to add an author profile

Choose whichever fits how you work:

1. **Asset Studio (recommended for most users).** In the studio, go to **Make → Library**,
   select the **Author** kind, and create a new entry; then do the same for the
   **Voice** kind under the same name. The editor writes the files into your user overlay. (In
   a book's scope, the same editor edits that book's frozen snapshot instead of the library.)

2. **By hand on disk.** Create `workspace/library/authors/<name>/` (with `SOUL.md` and
   `PERSONALITY.md`) and `workspace/library/voices/<name>/` (with `STYLE-GUIDE.md` and
   `VOICE-PROFILE.md`), plus optional `meta.json` in each. BookClaw picks them up on the next
   reload — restart the gateway, or use the authoring reload endpoint.

3. **Import a shared profile.** Author and voice entries can be exported and imported as
   portable `.zip`s through the Asset Studio's library import/export (the same secured transfer
   pipeline used for other library entries). Imports land in your user overlay.

4. **Contribute a built-in.** To ship a profile with the product, add it under
   `library/authors/<name>/` and `library/voices/<name>/` in the repository. It becomes
   available to every install on the next build.

After adding a profile, the author and voice are immediately selectable on the **New Book**
page and are injected into that book's generation prompts alongside its genre.

## Authoring tips

- **Write for a prompt, not a bio.** The files are composed into a system prompt. Lead each
  with a one-line summary, write `SOUL.md` in the second person ("You are…"), and keep
  entries tight and directive.
- **Identity in the author, mechanics in the voice.** Put *who this writer is* in
  `SOUL.md`/`PERSONALITY.md` and *how the sentences work* in `STYLE-GUIDE.md`/`VOICE-PROFILE.md`.
  Mixing them blunts both.
- **Don't re-derive the genre.** A profile pairs with a genre guide. Leave tropes, beats, and
  reader expectations to the genre; keep the profile about voice and approach. (The
  `military-romantasy` profile deliberately omits the romantasy genre contract for this reason.)
- **Name the failure modes.** A good `STYLE-GUIDE.md` includes an explicit "avoid" list — the
  tics and clichés this particular voice tends toward — so the model self-corrects.
- **Keep it proportionate.** The shipped examples run from a few lines (`default`) to roughly
  half a page per file. A profile is a steering document, not an essay.

## Quick checklist

- [ ] Author and voice directories named with the same lowercase-hyphen slug.
- [ ] `SOUL.md` (identity, second person) — the indispensable file.
- [ ] `PERSONALITY.md` (working temperament).
- [ ] `STYLE-GUIDE.md` (directive prose rules + an "avoid" list).
- [ ] `VOICE-PROFILE.md` (the narrative voice in a few sentences).
- [ ] `meta.json` with a one-line description in each directory.
- [ ] Each file opens with a one-line summary sentence.
- [ ] Genre-contract material left to the genre guide, not duplicated here.
- [ ] Verified the author and voice appear in the Asset Studio / New Book pickers.
