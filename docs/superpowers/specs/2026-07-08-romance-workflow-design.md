# Romance Workflow — Design & Decomposition

- **Date:** 2026-07-08
- **Branch:** `paul-romance-workflow` (worktree at `.claude/worktrees/paul-romance-workflow`)
- **Status:** Brainstorming complete for the whole feature; Foundation (sub-project 1) design approved verbally, spec being reviewed.
- **Method:** superpowers:brainstorming. This document is the saved state; the next step is spec review → superpowers:writing-plans for the Foundation sub-project.

## What this is

A new **selectable romance writing workflow** (picked like "novel"), delivered as a full end-to-end
pipeline with author-provided **seeds**, an **LLM Council** base-story origination step, and two seed-collection
UI modes. It builds on the existing romance infrastructure (40+ romance sub-genres, `romance-sweet` /
`romance-spicy` production pipelines, romance authors/voices/casting, and the `romance-*` author skills).

## Locked decisions (whole feature)

1. **Implementation approach — declarative static JSON pipelines** (not code-generated dynamic pipelines).
   Reuses the existing `expandSteps` path (`gateway/src/services/pipeline-expand.ts`) and the existing
   romance production skills verbatim. Chosen over a `createRomancePipeline()` code generator (rejected as
   overkill) and a hybrid pre-pass (rejected — conditional pruning not needed under expand-behavior).
2. **Entry point** — from **New** on the main menu:
   ```
   New ▸
   ├── Easy         → existing NewBook flow (unchanged)
   └── Advanced ▸
       ├── Guided    → fixed multi-step form (deterministic)
       └── Adaptive  → AI-driven conversational interview
   ```
3. **Two selectable workflows** — `romance-sweet-full` (fade-to-black / closed-door, spice level 2) and
   `romance-spicy-full` (open-door / explicit). Heat level selects the pipeline. They differ **only** in the
   per-chapter production block + intimacy skill.
4. **Seed behavior — refine/expand (Option A).** When a step is seeded, the step still runs, conditioned on
   the seed: it develops the author's material into full artifacts, preserves the author's canon, and fills
   gaps. Nothing the author writes is discarded. (Not skip-and-use-verbatim; not per-seed choice.)
5. **Seed source — new freeform fields (Option A)**, collected via the Advanced flow. Not pulled from the
   book container / World Repository (that was considered and declined for v1).
6. **Shared seed contract** — both Guided and Adaptive converge on the *same* fields, gathered differently:
   ```
   { heat: 'sweet' | 'spicy',
     storyArc: string,
     characters: string,
     world: string,
     chapterCount: number,
     wordsPerChapter: number,
     councilSelection: 'auto' | 'propose' }
   ```
7. **LLM Council** — for the romance pipeline, the base story is originated by a "council of LLMs":
   seeds feed candidate base-story generation → an AI **judge** ranks the candidates → selection per
   `councilSelection`:
   - `auto` ("Auto-Select Best Story") → judge's top pick is used; pipeline runs straight through, **no gate**.
   - `propose` ("Propose Top Ideas, ranked by the AI Judge") → pipeline **pauses**, surfaces the ranked
     candidates + the AI recommendation, waits for the user to pick, then **resumes** from the chosen base story.
   The **pause-and-resume selection gate is a genuinely new capability** — projects currently auto-execute
   start to finish, and no mid-pipeline selection gate exists. Candidate *generation* can reuse the existing
   `parallel` multi-model fan-out (see `library/pipelines/editorial-outline-council.json`), but that pattern
   auto-synthesizes one result and has no human pick — the pick + gate are new. Closest prior art for a gate:
   `ConfirmationGateService` (approve/deny, not choose-one-of-N).
   - Council originates the **base story** = premise + relationship arc (NOT the full outline). The chosen
     base story then drives bible → outline → production.
   - Council is a **Foundation-pipeline behavior**, seeded by whichever entry mode; not tied to one UI mode.

## Decomposition (four sub-projects, each its own spec → plan → build cycle)

| # | Sub-project | Depends on | New/hard parts |
|---|-------------|-----------|----------------|
| 1 | **Foundation** — the two `romance-*-full` pipeline JSONs, seed contract, seed→context threading | — | Seed plumbing through `/api/books` → BookService → project context |
| 2 | **LLM Council** — candidate base-story generation + AI judge/pick + pause-resume selection gate + candidate-review UI | 1 (seed contract) | The pause-resume gate (new); the review UI |
| 3 | **Guided wizard** — deterministic seed-collection form | 1 (contract) | Studio UI |
| 4 | **Adaptive interview** — conversational seed-collection subsystem | 1 (contract) | Conversational state + per-turn AI calls (largest UI piece) |

**Build order:** Foundation → Guided → Council → Adaptive. (Guided proves the seed contract end-to-end with
the least machinery; Council adds the gate; Adaptive is the biggest and comes last.)

---

# Sub-project 1: Foundation — detailed spec

## 1. Scope & non-goals

**In scope:**
- Two static pipelines in `library/pipelines/`: `romance-sweet-full.json`, `romance-spicy-full.json` —
  full end-to-end, seed-woven.
- The seed contract shape (fields above).
- Plumbing to carry seeds from `POST /api/books` into project `context` so `{{seed*}}` template vars resolve.

**Out of scope (later sub-projects):** all UI (Guided/Adaptive), the council steps, the selection gate.
`councilSelection` is accepted and persisted in Foundation but **inert** (reserved for sub-project 2) so the
contract stays stable and later work is purely additive.

**Verifiable headlessly:** create a book via `/api/books` with a seed payload and confirm the expanded
pipeline weaves the seeds into premise/bible/outline and carries the correct production skills.

## 2. The two pipeline files

Each is a static pipeline structured like the existing `library/pipelines/romance-sweet.json`, but with a
**front half added** ahead of the production block:

- **Premise** (2 steps, `skill: premise`, `taskType: book_bible`) — romance-tuned: central couple, core
  romantic conflict, tropes, HEA/HFN promise. Weaves `{{storyArc}}`.
- **Bible** (steps, `skill: book-bible`) — protagonist, **love interest**, the **relationship arc**
  (attraction → tension → midpoint shift → black moment → reconciliation), supporting cast, world/setting.
  Weaves `{{characters}}` and `{{world}}`.
- **Outline** (2 steps, `skill: outline`, `taskType: outline`) — built on the existing beat vars
  (`setupEnd`, `incitingEnd`, `midpoint`, `twist75`, `climaxStart`, `climaxEnd` — computed by
  `buildPipelineVars`) reframed as romance beats (meet-cute, fun-and-games, midpoint, black moment, grovel, HEA).
- **Production** — the existing `{ expand: 'chapters', steps: [...] }` block copied **verbatim** from
  `romance-sweet.json` (sweet) / `romance-spicy.json` (spicy): Scene Brief → First Draft → Improvement Plan →
  Rewrite → Humanize → Intimacy, including per-step `modelOverride`s and the `romance-*` skills. **This block
  is the only difference between the two files.**
- **Revision** — developmental edit, line edit, consistency check.
- **Assembly** — completion report.

Genre guidance flows automatically: the book is bound to a romance genre → `BookService.genreGuideOf` →
`buildSystemPrompt`, so beat/trope specifics need not be hardcoded in prompts.

Front-half planning steps use the **generic** `premise` / `book-bible` / `outline` skills (there are no
romance-specific planning skills; the romance skills are all production-stage) — romance flavor comes from
the prompt wording + the injected genre guide.

## 3. Seed threading (the mechanism)

Confirmed by code read: `buildPipelineVars(ctx)` does `return { ...ctx, ... }`, so **all** project `context`
keys pass through as `{{var}}` template vars; `interpolate()` substitutes `{{seedArc}}` etc. and
`expandSteps` flattens `expand: chapters` / `parallel` groups. The static path is fully capable — no new
templating engine needed.

Each seeded early-step prompt uses **expand-phrasing**, e.g.:
> "Develop and expand the following author-provided material, preserving everything given and filling gaps —
> do not discard or contradict it: {{storyArc}}"

Empty seed → the value interpolates to `''` and the step generates from premise as today. (Consider guarding
the whole clause so an empty seed doesn't leave a dangling "material:" label — phrase the template so an empty
value reads cleanly.)

## 4. Create-surface plumbing (the only new code in Foundation)

- `POST /api/books` (`gateway/src/api/routes/books.routes.ts`) accepts optional `storyArc`, `characters`,
  `world`, `councilSelection` in addition to existing `chapterCount` / `wordsPerChapter`.
- `BookService.create` persists them on `book.json` and threads them into the project `context` at
  pipeline-project creation, alongside existing `targetChapters` / `targetWordsPerChapter`.
- Template var names in the pipeline JSON must match the context keys chosen here (e.g. context
  `storyArc` → `{{storyArc}}`). Pick the names once and keep pipeline JSON + context key in lockstep.
- `councilSelection` stored but inert in Foundation.

Reference (existing create surface): `frontend/studio/src/routes/NewBook.tsx` POSTs
`title/author/voice/genre/world/pipelineSequence/sections/structure` to `/api/books`; it does **not** yet
capture freeform premise/arc/character fields — that entry UI is sub-projects 3/4.

## 5. Error handling / fail-soft

Missing seeds are normal (empty string) — no failure. Unknown `heat` → use the pipeline the caller selected.
No new failure modes; follows the existing fail-soft init posture (log `⚠`/`ℹ`, continue degraded).

## 6. Testing

Add a scripted test under `tests/` (matching the existing scripted-test rule; expose `-v` verbose per repo
convention):
- Create a book via `/api/books` with a seed payload on `romance-sweet-full`.
- Assert the expanded project steps: (a) include the seed text in premise/bible/outline prompts;
  (b) carry the correct romance production skills + `modelOverride`s in the `expand: chapters` block;
  (c) collapse cleanly when seeds are empty (front half still generates; no dangling seed labels).

## MCP lockstep note

Per repo convention, if any new/changed `/api/books` fields are surfaced through the MCP server, update the
matching `mcp/` tool in the **same commit** as the gateway route.

## Open items — resolved at spec-review (2026-07-08)

- **Context key names — bare (locked).** Seeds thread as `storyArc`, `characters`, `world`, `heat`,
  `chapterCount`, `wordsPerChapter`, `councilSelection`; templates reference `{{storyArc}}` etc. Matches the
  seed contract 1:1. Confirm at plan time that none collide with `buildPipelineVars`'s computed keys
  (`setupEnd`, `incitingEnd`, `midpoint`, `twist75`, `climaxStart`, `climaxEnd`) — they don't overlap.
- **Preset visibility — also as presets (locked).** `romance-sweet-full` / `romance-spicy-full` are exposed
  as selectable `pipelineSequence` presets in the standard studio NewBook picker, in addition to being the
  targets of the later Advanced flow. This makes Foundation verifiable end-to-end through the normal picker
  before the Guided/Adaptive UIs land.
