---
name: prepublication-checklist
description: Audit a finished manuscript against the seven make-or-break checks before publication - genre clarity, title searchability, comp titles, one-line pitch, chapter lengths, read-aloud, and the chapter-two hook
author: BookClaw
version: 1.0.0
triggers:
  - "pre-publication checklist"
  - "prepublication checklist"
  - "pre-pub audit"
  - "ready to publish"
  - "before I publish"
  - "launch readiness"
  - "is my book ready"
  - "publish checklist"
  - "publication checklist"
  - "final check before publishing"
permissions:
  - file:read
  - file:write
---

# Pre-Publication Checklist

A finished draft is not a finished book. Before publication, run every
manuscript through these seven checks. Missing even one quietly caps the
book's sales; missing two or three sinks it. Produce a short report that
marks each check **PASS** or **FLAG**, and for every FLAG give the specific
fix — never a vague "needs work."

Each check below names the deeper skill to hand off to when a FLAG needs
real work.

## 1. Genre clarity

The single most important job of a cover is to tell a browsing reader the
genre in **half a second or less** — not to be beautiful, and not to match
the author's mental picture of the characters. A cover that reads as the
wrong genre (or no clear genre) sells almost nothing even when it looks
good; the same book with a genre-true cover can hit a bestseller list.

- **Cover check:** show the cover to someone unfamiliar and ask "what genre
  and subgenre is this?" If they hesitate or guess wrong, it FLAGS.
- **First-chapter check:** the cover makes a genre promise; chapter one must
  deliver on it *immediately*. A crime novel opens with a crime, a horror
  novel with something horrifying — in chapter one, not chapter five.
- **Subgenre:** readers buy within lanes (cozy mystery, not "mystery"; space
  opera, not "sci-fi"; romantasy, not "fantasy"). The cover and first chapter
  should signal the subgenre, not just the broad category.
- Hand off to: **cover-designer** (cover) and **revise** (first-chapter
  genre delivery).

## 2. Title searchability

Can a reader who hears the title find the book by typing it into Google?
The title competes not just with other books but with movies, plays,
musicals, songs, and Wikipedia pages.

- Search the exact title. If the book would land below a wall of unrelated
  movies/shows/songs, it FLAGS.
- **Avoid single-word titles** — they drown in search results. (One author's
  "2020" became "Day Zero"; another's "Fallen Angels" became "The Third
  Throne" and jumped to the first search result.)
- The goal is to plausibly own the first page of results for the exact title.

## 3. Comp title honesty

Claiming a book "isn't like anything else out there" signals the author
simply isn't well read — and throws away the strongest sales tool there is:
comparing the book to two things the reader already knows and likes. Every
finished book needs honest comps. Use one of these framings:

- **"X meets Y"** — e.g., "*The Girl on the Train* meets HBO's *Girls*."
- **"On the shelf alongside …"** — list peers in the same genre lane.
- **"Will appeal to fans of …"** — list titles the ideal reader has read.
- **"In the vein of …"** — a couple of ballpark comps.

Never: comp dead authors (use modern ones), comp runaway megahits (*Harry
Potter* meets *Hunger Games* reads as cliché), or refuse to comp at all.
Comping other media (TV, film, musicals) is fine when it fits.
Hand off to: **blurb-writer** (comp lines for the description/back cover).

## 4. One-line pitch

Can the book be pitched to a stranger in a single sentence that makes them
*want to read it*? The pitch is storytelling, not a summary — it creates
surprise, mystery, and conflict, and leaves the listener needing the answer.

- Test: the pitch works only if the listener immediately wants the book.
  If it doesn't, the book's appeal probably isn't yet clear in the author's
  own mind — that's the real FLAG, and worth solving.
- Model (surprise + mystery + conflict): *"A meek, abused girl in suburban
  London discovers she can levitate — and the adults around her immediately
  look for a way to profit from it."*
- Once it lands, it goes on the back cover and gets used everywhere the book
  is mentioned.
- Hand off to: **blurb-writer** (the one-line pitch section).

## 5. Chapter-length audit

List every chapter with its word count and look at the shape of the whole
book. A single wildly out-of-pattern chapter (all chapters ~3,000 words and
one at 15,000) jars readers unless the outlier is deliberate.

- If a long chapter is *intentional* (a set-piece, a climax), that is a PASS.
- If it is *accidental*, it FLAGS — consider splitting it.
- Hand off to: **revise** (chapter-length audit) and the `pacing_heatmap`
  tool for a visual overview.

## 6. Read it out loud

The single highest-yield pre-publication pass. The ear catches dropped and
skipped words, wonky rhythm, and mistakes the eye skims over.

- **Accidental rhyme:** "he tried to hide the pride he felt inside" reads
  fine silently and clangs aloud.
- **Noun/verb ambiguity:** "The complex houses married and single soldiers"
  garden-paths the reader (is *houses* a noun or a verb?).
- **Where you stumble** = phrasing to fix (you misread it for a reason).
- **Where you get bored** = a pacing problem — cut paragraphs, or start the
  chapter earlier or later.
- No time to read the whole book aloud? Have text-to-speech read it back
  while walking or at the gym.
- Hand off to: **revise** (read-aloud pass) and **line-edit**.

## 7. The chapter-two check

Every author polishes chapter one — readers almost always read it, so it is
the "gimme" chapter. Chapter **two** is where a reader decides whether to
keep going, and it is usually neglected. Audit it specifically:

- Does chapter two build on, accelerate, and escalate what chapter one set up?
- Does it keep advancing the plot rather than resetting or explaining?
- Does it open with a bang and end on a question or mystery that pulls the
  reader forward?
- Hand off to: **revise** (chapter-two escalation check).

## Output

Return a checklist report: each of the seven items marked **PASS** or
**FLAG**, every FLAG paired with a concrete fix and the skill to run next.
Do not soften a FLAG into a PASS — a book that skips these does not get a
second chance with a browsing reader.
