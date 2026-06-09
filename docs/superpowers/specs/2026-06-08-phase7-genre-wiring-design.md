# Phase 7 — Genre Wiring (design spec)

**Date:** 2026-06-08
**Status:** Decisions confirmed (owner, 2026-06-08) — ready for an implementation plan. See §5.
**Roadmap:** [BOOK-CONTAINER-ARCHITECTURE.md](../../BOOK-CONTAINER-ARCHITECTURE.md) Phase 7 (follows the Phase 6 front-end rewrite; precedes Phase 8 multi-book concurrency)

## 1. Goal

Make a book genuinely "write in its own genre." Today a book's chosen genre is **snapshotted but unwired**: `BookService.create()` copies the genre's markdown files into `workspace/books/<slug>/templates/genre/`, but nothing reads them during generation. Author identity and Voice style already reach every prompt (via `SoulService.useBook()` → `getFullContext()`); genre does not.

Phase 7 (a) defines a richer, research-backed **genre guide** content model, and (b) **wires** the active book's genre guide into generation prompts alongside Author and Voice.

### Success criteria (from the roadmap)
1. Genre content reaches the relevant pipeline-step prompts.
2. Changing a book's genre changes its output.
3. Genre re-pull works (edit the library genre → re-pull updates the book's snapshot → next generation reflects it).

### Explicitly out of scope
- **Broad genre library content.** Phase 7 ships the *schema* + *wiring* and fleshes out the one existing built-in genre (`romantasy`) as the worked example. Authoring many genres is content work, tracked separately ([BOOK-CONTAINER-ARCHITECTURE.md](../../BOOK-CONTAINER-ARCHITECTURE.md) non-goals).
- **Task-targeted injection tuning** beyond the v1 rule in §4 (see the decision in §5.1).
- Anything Phase 8+ (multi-book concurrency, per-channel active book).

## 2. Current state (grounding)

- **Genre is a directory of `.md` files.** `LibraryService.loadKind()` reads *every* `.md` in a genre directory (`gateway/src/services/library.ts:240`), so the file set is open-ended — adding new guide files needs **no** change to the library, snapshot, re-pull, or Asset Studio. Built-in genres live at `library/genres/<name>/`; the user overlay at `workspace/library/genres/<name>/`; a book's frozen copy at `workspace/books/<slug>/templates/genre/`.
- **Existing built-in genre:** `romantasy`, with `tropes.md`, `beats.md`, `reader-expectations.md`, `comps.md`.
- **The injection seam (single chokepoint).** Both chat and project steps build their system prompt in `BookClawGateway.buildSystemPrompt({ soul, memories, activeProject, skills, heartbeatContext, channel })` (`gateway/src/index.ts:565`). `soul` comes from `SoulService.getFullContext()` (`gateway/src/services/soul.ts:108`), which concatenates the active book's Author identity (`SOUL.md`/`PERSONALITY.md`) + Voice (`STYLE-GUIDE.md`/`VOICE-PROFILE.md`). `useBook(authorDir, voiceDir)` re-points those to the active book (Phase 3b). Genre slots in at this same seam.
- **`genre` is otherwise only a free-text string** in `ProjectEngine` config (`gateway/src/services/projects.ts:282`, injected as a literal `Genre: <name>` line). That stays as a label; Phase 7 adds the *guide content*.

## 3. The genre guide content model

The owner specified five elements: **common tropes, common themes, genre expectations, genre killers, genre must-haves.** External research on genre/craft guidance (Story Grid conventions & obligatory scenes; reader-promise and comp-title practice; genre-expectation breakdowns — see §8) supports expanding these with: **obligatory scenes / structural beats, reader promise, tone & mood, pacing, character archetypes, setting conventions, length & format norms (POV, word-count band, heat/age category), and comparable titles.**

To avoid overlap, each element gets a crisp role. Because the genre kind is file-agnostic, we keep the **multiple-file** layout (matches the existing pattern and gives per-file re-pull granularity). Canonical file set — **3 new files, 4 existing (no renames)**:

| File | Element(s) | Role — what it answers | New? |
|------|-----------|------------------------|------|
| `tropes.md` | Common tropes | Recurring devices/situations readers love (enemies-to-lovers, chosen one) + how to keep them fresh. *Optional flavor — pick a few.* | existing (expand) |
| `themes.md` | Common themes | The ideas/values the genre explores (found family, redemption, power & corruption). | **new** |
| `beats.md` | Obligatory scenes + structure | The plot set-pieces in rough order that readers would feel cheated without (meet-cute → midpoint → break-up ~75% → grand gesture). *Structural: what must happen, and roughly when.* | existing (expand to name obligatory scenes) |
| `reader-expectations.md` | Genre expectations + reader promise | The world/tone/format rules: reader promise, tone & mood, pacing, setting conventions, character archetypes/roles, length & format norms (POV, word-count band, heat/age category). *Descriptive: what the genre feels like.* | existing (expand) |
| `must-haves.md` | Genre must-haves | A tight, action-oriented **checklist** of non-negotiables — "skip these and it isn't really this genre" (e.g. romance: an emotionally satisfying HEA/HFN; the couple together on the page). | **new** |
| `genre-killers.md` | Genre killers | The anti-checklist — what makes genre readers DNF/1-star (e.g. romance: cheating without redemption, killing a love interest, no HEA). | **new** |
| `comps.md` | Comparable titles | Market positioning: comp titles + *why* they work; a source for deriving obligatory scenes ("the same, but different"). | existing |

Notes:
- **`must-haves.md` vs `beats.md` vs `reader-expectations.md`** are deliberately distinct: must-haves is a terse deliverable checklist; beats is the *plot* sequence; reader-expectations is the *tone/format* description. The checklist is the highest-signal input for revision/critique.
- Each file should open with a one-line summary so it reads well when concatenated into a prompt and so the Asset Studio shows useful previews.
- The per-asset **description** sidecar (`meta.json`, Phase 6e) continues to describe the genre as a whole; it is unaffected.

## 4. Wiring design

### 4.1 Reading the active book's genre guide
Add to `BookService` (genre is book-scoped, so it lives with the book, not in `SoulService`):

```
getActiveGenreGuide(): string | null   // concatenated guide for the active book, or null if none
```

It reads the active book's `templates/genre/*.md`, in a **fixed canonical order** (reader-expectations → tropes → themes → beats → must-haves → genre-killers → comps), each under a `## Genre Guide — <Section>` header, and returns the joined string (or `null` when the book has no genre, e.g. literary/mainstream). Result is cached and invalidated on active-book change / re-pull (mirror how the author/voice dirs are re-pointed today).

### 4.2 Injecting it into the system prompt
`buildSystemPrompt(...)` gains a `genreGuide?: string` input; `handleMessage` passes `this.books.getActiveGenreGuide()`. The guide is appended as a clearly-delimited `# Active Book — Genre Guide` block after the soul/voice context and before skills. This is the single chokepoint feeding both chat and every project step, so genre flows everywhere the author/voice already do.

### 4.3 Step ↔ section affinity (documented; enforcement depends on §5.1)
Even if v1 injects the whole guide, the natural mapping (for cost control / future targeting and to inform prompt copy) is:

| Pipeline phase / taskType | Most relevant sections |
|---------------------------|------------------------|
| planning / premise / market analysis | reader-expectations, comps, must-haves, tropes, themes |
| outline | beats (obligatory scenes), must-haves, tropes |
| production / write | tropes, themes, reader-expectations (tone), must-haves, genre-killers |
| revision / critique / continuity | must-haves, genre-killers, beats (obligatory-scene check) |
| marketing / launch | comps, tropes, reader-expectations |
| format / export | none (genre-neutral) |

## 5. Pivotal decisions

> **Confirmed (owner, 2026-06-08):** 5.1 → **(A) Whole guide everywhere**; 5.2 → **`BookService.getActiveGenreGuide()`**; 5.3 → **Multiple files** (keep 4 existing + add 3). The implementation plan follows these.

### 5.1 Injection scope — **how much genre, where?**
- **(A) Whole guide everywhere** (recommended for v1) — inject the full guide via the single seam into every genre-relevant step. Simplest; satisfies all three success criteria; a well-written guide is ~1–3K tokens, small next to manuscript content. Cost: some noise in genre-neutral steps (format/marketing) and a modest token cost on every call.
- **(B) Task-targeted** — `buildSystemPrompt` includes only the sections in the §4.3 map for the current `taskType`. Leaner/cheaper, better signal; more code and a coupling between prompt assembly and the section schema.
- **(C) Hybrid** — always inject a compact "genre header" (name + reader-promise + must-haves + genre-killers — the guardrails), and add the heavy sections (beats/tropes/themes) only for relevant steps.

**Recommendation: (A) for v1**, with §4.3 documented so (C)/(B) is a clean follow-up if token cost or off-genre noise proves material. Aligns with the project's "simplicity first" rule.

### 5.2 Where genre composition lives
- **(recommended) `BookService.getActiveGenreGuide()`** — genre is book-scoped; keeps `SoulService` about *author identity*; makes future task-targeting easy (the gateway decides what to pass).
- Alternative: fold genre into `SoulService.useBook(authorDir, voiceDir, genreDir)` + `getFullContext()` — most symmetric with author/voice, but conflates "author" and "genre" abstractions.

### 5.3 File schema
- **(recommended)** keep the 4 existing filenames + add `themes.md`, `must-haves.md`, `genre-killers.md` (no renames → no migration, no Asset-Studio/snapshot churn).
- Alternative: a single `genre-guide.md` with `##` sections (owner said single-doc is acceptable) — simpler to author, but loses per-section re-pull granularity and breaks from the existing multi-file pattern.

## 6. Implementation outline (after decisions are confirmed)

1. **Content:** author the canonical genre-guide template (section headers + guidance prompts) and flesh out `romantasy`'s 7 files as the worked example. → verify: `LibraryService` lists all 7 files; Asset Studio renders them.
2. **Read path (TDD):** `BookService.getActiveGenreGuide()` (canonical order, headers, null when genre-less, cache + invalidation). → verify: new unit test `tests/unit/genre-guide.test.ts` (compose order; genre-less → null; re-pull/active-flip invalidation).
3. **Inject:** thread `genreGuide` through `buildSystemPrompt` + `handleMessage`. → verify: a unit/contract test asserting a genre-bearing active book puts the guide block into the system prompt, and a genre-less book does not.
4. **End-to-end:** extend `tests/feature-smoke.sh` Tier C — create a book with a genre, run a planning/outline step, assert the genre's distinctive terms appear in output; swap genre → output changes; re-pull reflects an edit.
5. Update `CLAUDE.md` (genre now wired) and move the Phase 7 item TODO → COMPLETED on deploy+verify.

## 7. Risks
- **Context bloat / cost** if guides grow large (mitigated by decision 5.1; revisit with (C) if needed).
- **Genre-neutral books** (no genre) must cleanly inject nothing — covered by the `null` path.
- **Overlap/duplication** between must-haves, beats, and reader-expectations — mitigated by the crisp per-file roles in §3; the template must reinforce them so authored content stays distinct.
- **Phase 8 coupling:** `getActiveGenreGuide()` reads the *single global active book* — same pointer Phase 8 will replace. Keep the genre read behind the book accessor so Phase 8 can swap it to per-context without touching prompt assembly.

## 8. Research sources
- [Genre Expectations in Fiction Writing — Mary Kole Editorial](https://www.marykole.com/genre-expectations)
- [Understanding Tropes and Genre Conventions — DIY MFA](https://diymfa.com/writing/understanding-tropes-and-genre-conventions/)
- [Book Tropes by Genre: A Field Guide for Writers — Kindlepreneur](https://kindlepreneur.com/book-tropes/)
- [The Story Grid Writing Guide: Genre, Obligatory Scenes — iWrity](https://www.iwrity.com/writing-story-grid-guide)
- [What Are Obligatory Scenes And Conventions? — Savannah Gilbo](https://www.savannahgilbo.com/blog/obligatory-scenes-and-conventions)
- [Genre conventions and obligatory scenes — First Draft Pro](https://www.firstdraftpro.com/blog/understanding-the-difference-between-genre-conventions-and-obligatory-scenes)
- [Genre Conventions: Why They Matter — Ream](https://info.reamstories.com/post/genre-conventions-why-they-matter-and-how-they-shape-your-story)
