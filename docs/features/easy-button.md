# The Easy Button — A 3-Click Novel from a Starter Bundle

## What it is

The Easy Button is a guided wizard in the web studio that turns a one-sentence
idea into a running novel in three clicks. You give it a title and a premise,
pick one of three ready-made **Starter Bundles** (Contemporary Romance, Hard
Sci-Fi, or Thriller), and press **Start writing**. BookClaw then creates a
fully-configured book and immediately begins planning it, showing live progress
in the Write workspace.

You reach it from the studio sidebar (the **New Book — Easy** entry) or directly
at the `/start` route. It is a **web-studio feature only** — it is not available
through Telegram, Discord, or the MCP tools.

A **Starter Bundle** is a preset that fills in every configuration choice a new
book normally requires:

- an **author** and matching **voice** (the narrative style),
- a **genre**,
- the **`novel` sequence** (the multi-phase pipeline that plans, writes, and
  revises a book), and
- a **Book Format** — the structure × form × chapter count × words-per-chapter
  that determines the book's shape and target length.

So instead of making a dozen decisions on the New Book page, you make one: which
bundle fits your idea.

## Why it matters

Configuring a book from scratch means understanding authors, voices, genres,
sequences, story structures, and length targets before you can write a word.
That is a lot to learn on day one. The Easy Button gives a beginner the **full
generation engine without any of that configuration** — the bundle has already
made sensible, coherent choices for you.

Two design points worth knowing:

- **Everything stays editable.** A bundle is just a starting point. The book it
  creates is a normal book; you can change its voice, genre, format, or pipeline
  afterward on the New Book (Advanced) page or in the book's settings. The Easy
  Button is the simple front door; the Advanced page is the full one.
- **Bundles reference only public assets.** Every author, voice, genre, and
  sequence a bundle points to is a committed, built-in `library/` asset — never
  your private workspace data. This means the bundles can ship and be shared with
  anyone without exposing proprietary pen names, voice DNA, or manuscripts. The
  guiding principle is "give away the method, not the books."

## How to use it

### Step 1 — Describe your book

Enter a **working title** and, in one sentence, **what it's about**. For example:

> A small-town baker falls for the developer trying to buy her street.

The premise is not just a label — it seeds the planning phase. It becomes the
description the AI works from when it starts building your book's plan. (You only
need a title to advance; the premise is strongly recommended.)

### Step 2 — Pick a Starter Bundle

Choose one of the three cards:

| Bundle | Voice / feel | Shape (structure) | Length |
|--------|--------------|-------------------|--------|
| Contemporary Romance | Warm, character-driven, happily-ever-after | Romancing the Beat | ~80k words (32 chapters × 2,500) |
| Hard Sci-Fi | Big ideas, real science, a sense of wonder | Three-Act | ~84k words (30 chapters × 2,800) |
| Thriller | Relentless pace, rising stakes | Three-Act | ~80k words (40 chapters × 2,000) |

Each card shows the bundle's title, a one-line tagline, and an approximate
word count derived from chapter count × words-per-chapter.

### Step 3 — Review and start

You see a plain-language summary of what you're about to create — for example,
"You're writing *Untitled* — a *Contemporary Romance* novel, about 80k words
(32 chapters × 2,500), in the warm small-town voice." Press **Start writing**.

BookClaw then:

1. Creates a fully-configured book from the bundle (a normal `POST /api/books`),
2. Hands off to the Write workspace, which **auto-runs the planning phase** of
   the `novel` sequence on the **free / cheap model tier** (the beginner-friendly
   default — it keeps your first run inexpensive), and
3. Shows **live progress** as planning runs.

You are now in the Write workspace watching your book plan itself. From there you
continue the rest of the pipeline (bible, production, revision, and so on) the
same way you would for any book.

## Under the hood

The Easy Button is almost entirely frontend. It collects your choices, then makes
the same `POST /api/books` call the Advanced page uses, and lets the existing
Write workspace own the create → start → auto-run path.

Key files:

- `frontend/studio/src/routes/EasyStart.tsx` — the three-step wizard component
  (the `/start` route). On **Start writing** it creates the book, then navigates
  to `/write/:slug?autostart=1` with the premise in navigation state so the
  Write workspace's pipeline rail starts planning and seeds the planning prompt's
  description.
- `frontend/studio/src/data/bundles.ts` — the three Starter Bundle presets
  (pure data, zero imports). Each bundle pins a public author, voice, genre,
  `novel` sequence, and Book Format. A unit test
  (`tests/unit/easy-button-bundles.test.ts`) enforces the IP guardrail: every
  asset referenced must be a committed built-in `library/` asset.
- `frontend/studio/src/lib/easyApi.ts` — resolves the sequence to its ordered
  pipeline list and calls `POST /api/books`. Note it does **not** start
  generation itself — the Write workspace is the single owner of that, so a book
  ends up with exactly one tracked project (no duplicate or orphaned runs).
- `frontend/studio/src/lib/bundleBody.ts` — the pure builder that turns a bundle
  + title into the `POST /api/books` request body (author, voice, genre,
  sequence, and the four format fields).
- `frontend/studio/src/main.tsx` — wires the `/start` route to `EasyStart`.

Design and history:

- `docs/superpowers/specs/2026-06-22-easy-button-bundles-design.md` — the design
  spec (the "give away the method, not the books" rationale, bundle roster, and
  data flow).
- `tests/easy-button-smoke.sh` — a hermetic smoke test that creates a book from
  each bundle and asserts the format persists.

## Related

- [Books and Authors](./books-and-authors.md) — what a book is, and how authors
  and voices shape it (the Advanced path the Easy Button is a shortcut over).
- [Book Format and Structure](./book-format-and-structure.md) — what the
  structure × form × chapter-count × words-per-chapter Book Format means.
- [Pipelines and Sequences](./pipelines-and-sequences.md) — what the `novel`
  sequence runs, including the planning phase the Easy Button auto-starts.
