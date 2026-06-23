# Book Format & Structure — Design Spec

**Date:** 2026-06-22
**Status:** Design — under review. Next: implementation plan via `superpowers:writing-plans`.
**Feature-tracking:** `docs/TODO.md` → "Book Format & Structure (declared at creation, enforced in generation, checked in review)".
**Related:** the existing `gateway/src/services/story-structures.ts` (10 frameworks, `recommend()`, `checkOutline()`); the book container model (`gateway/src/services/book.ts`, `book.json` manifest); the per-book consistency auditor surface as the UI pattern (`frontend/studio/src/routes/Consistency.tsx`).

## Problem

A book's **form** (short story vs novella vs novel vs epic), its **narrative structure** (3-act, Hero's Journey, Freytag, …), and its **pacing shape** (40 chapters × 1,500 words is fast and plot-driven; 24 × 3,000 is slower and introspective) are first-class authorial decisions that shape how the story is told. Today BookClaw has a structure *catalog* (`story-structures.ts`) and per-chapter word *targets* buried in the pipeline, but:

- The author cannot **declare** form, structure, chapter count, and chapter length when creating a book.
- Nothing **enforces** that the declared length is internally coherent (a "short story" at 24 × 100k is nonsense).
- The declaration does not **drive generation** (the pipeline doesn't plan to the chosen structure or length).
- There is no **review** surface to check the written manuscript against the declared structure and length.
- The catalog is incomplete and cannot express a **bespoke** structure (e.g. *Love between Departures* — a 4-act spanning four summers with winter interludes).

## Goal

Make form + structure + pacing a single declared configuration on a book that flows end to end: **declared at creation → enforced (generation plans to it) → checked (review compares the manuscript to it)**. Support the top named structures **plus an author-defined "Other / Custom"** structure, treated uniformly. Keep the compute deterministic except where an LLM genuinely helps (beat-mapping proposal, structure-aware outline planning).

## Locked decisions (from brainstorming)

| # | Decision |
|---|----------|
| 1 | Scope = **structures + length/form** only. Timelines and character profiles are deferred to later features. |
| 2 | Two **independent selectors** at creation: **Structure** × **Form/Length**, with cross-defaults (genre/form-driven suggestions). |
| 3 | The selection **drives generation AND review** (one source of truth). |
| 4 | **Form catalog (v1, prose):** Flash, Short Story, Novelette, Novella, Novel, Epic, plus **Serial** and **Pulp** modes. Verse forms (Epic Poem) deferred. |
| 5 | **Chapter count** and **words-per-chapter** are first-class creation inputs (the pacing dial). Total = chapters × words-per-chapter. |
| 6 | **Hard block** at creation when the total falls outside the selected form's word band (Serial has an open max; the message names the band and the offending total). |
| 7 | **Comprehensive structure catalog** — expand `story-structures.ts` beyond the current 10 (add **Four-Act** and other top frameworks), plus an **"Other / Custom"** structure. |
| 8 | A **custom structure** is an author-defined `StoryStructure` (named, ordered `Beat[]`), **LLM-proposed from the premise/outline then author-edited**, and is handled **identically** to a catalog structure by both generation and review. |
| 9 | The structure check runs against the **outline** (chapter summaries), which is an **editable** artifact of this feature (seeded from a detected outline file, else author-entered). |
| 10 | **One phased spec**, built in order: (1) catalog + creation config + validation + persistence, (2) generation wiring, (3) review surface. |
| 11 | **Read review state is editable** — confirmed beat mapping and per-chapter target overrides persist and can be corrected in-app. |

## Catalogs

### Form catalog — `gateway/src/services/story-forms.ts` (new)

Parallels `story-structures.ts`. A pure, hardcoded catalog. Each entry:

```ts
export interface StoryForm {
  id: string;            // 'flash' | 'short-story' | 'novelette' | 'novella' | 'novel' | 'epic' | 'serial' | 'pulp'
  label: string;
  description: string;
  minWords: number;
  maxWords: number | null;   // null = open-ended (Serial, Epic)
  typicalChapterRange: [number, number]; // guidance for the creation UI, not enforced
}
```

v1 bands (word counts; owner-tunable data, not logic):

| id | label | min | max | typical chapters |
|---|---|---|---|---|
| `flash` | Flash Fiction | 100 | 1,500 | [1, 1] |
| `short-story` | Short Story | 1,000 | 7,500 | [1, 3] |
| `novelette` | Novelette | 7,500 | 17,500 | [3, 8] |
| `novella` | Novella | 17,500 | 40,000 | [8, 20] |
| `novel` | Novel | 40,000 | 120,000 | [20, 45] |
| `epic` | Epic | 120,000 | null | [40, 120] |
| `serial` | Serial (episodic) | 2,000 | null | [10, 200] |
| `pulp` | Pulp (fast, lean) | 25,000 | 60,000 | [20, 40] |

Pure helpers:
- `listForms(): StoryForm[]`
- `getForm(id): StoryForm | null`
- `validateFormFit(form: StoryForm, chapterCount: number, wordsPerChapter: number): { ok: boolean; total: number; message?: string }` — `total = chapterCount * wordsPerChapter`; `ok` iff `total >= form.minWords && (form.maxWords === null || total <= form.maxWords)`; `message` names the band + total when not ok. Used at creation **and** when editing length targets in the review.

### Structure catalog — `gateway/src/services/story-structures.ts` (expand)

- **Expand the catalog** to the top frameworks. Add **Four-Act** (currently absent) and other widely-used frameworks (e.g. Fichtean Curve, Kishōtenketsu, In Medias Res, 27-chapter method) — each a `StoryStructure` with `beats: Beat[]` carrying `expectedPct` + `pctRange`, exactly like the existing entries. Catalog additions are **data**, not new logic.
- **Custom structure:** the `StructureId` union gains `'custom'`. A book whose structure is `'custom'` carries a full inline `StoryStructure` (named, author-authored `Beat[]`). All structure consumers accept a **resolved `StoryStructure`** (catalog lookup by id, or the inline custom object) so nothing downstream special-cases custom.
- A small resolver: `resolveStructure(format): StoryStructure | null` — returns the catalog structure for `format.structureId`, or `format.customStructure` when `structureId === 'custom'`.

## Creation-time configuration

### Manifest persistence — `book.json` (`format` block, additive optional field)

```ts
// added to BookManifest (gateway/src/services/book.ts + frontend/shared/src/types.ts)
format?: {
  structureId: string;                 // catalog id or 'custom'
  customStructure?: StoryStructure;     // present iff structureId === 'custom'
  formId: string;                       // story-forms id
  chapterCount: number;
  wordsPerChapter: number;
  totalTarget: number;                  // chapterCount * wordsPerChapter (denormalized for convenience)
};
```

This is **core declared config**, so it lives on the manifest (alongside `pulledFrom`), not a sidecar. The field is optional and additive — **no `BOOK_SCHEMA_VERSION` bump** (older books simply have no `format`; the review surfaces a "not configured yet" state and offers to set it).

### API + validation

- `POST /api/books` (`gateway/src/api/routes/books.routes.ts:272`) accepts `{ structure, customStructure?, form, chapterCount, wordsPerChapter }` alongside the existing fields. The handler:
  1. Resolves the structure (catalog id or the supplied custom object); rejects an unknown id.
  2. Looks up the form; runs `validateFormFit`. **On failure → 400** with the band message (hard block, decision #6). Serial/`maxWords === null` only enforces the min.
  3. On success, writes the `format` block into the new book's manifest.
- `GET /api/forms` — lists the form catalog for the creation UI (mirrors `GET /api/structures`).
- `PUT /api/books/:slug/format` — update the declared format on an existing book (same validation). Lets older/imported books adopt a format and lets authors change it.

### Studio (New-Book form)

`frontend/studio/src/routes/NewBook.tsx` (+ `components/newbook/`) gains:
- **Structure** selector (from `GET /api/structures`) with the genre-based `recommend()` suggestion highlighted; an **"Other / Custom"** choice that reveals an inline beat editor (or a "propose from premise" button — see review §propose, reused here).
- **Form** selector (from `GET /api/forms`).
- **Chapter count** and **words-per-chapter** numeric inputs, with a **live total** and an inline **band check** (green within band, red + message when out of band; submit disabled while out of band).

## Generation reach (phase 2)

A book is bound to its project at creation (`Project.bookSlug`). A new stateless helper resolves the declared format into generation inputs:

- `formatGuideFor(slug): { wordsPerChapter: number; chapterCount: number; structurePromptRail: string } | null` (on `BookService` or a small `format-guide.ts`), reading the manifest `format`.
- **Per-chapter word target:** chapter write/continuation steps use `wordsPerChapter` as their `wordCountTarget` (feeds the existing multi-pass continuation logic in `index.ts`), and outline planning targets `chapterCount` chapters.
- **Structure-aware outline:** `structurePromptRail` is the resolved structure's beats (names + `expectedPct` + descriptions) rendered as a compact instruction, injected into the outline/planning step prompt so the generated outline hits the framework. Works identically for catalog and custom structures (both resolve to `Beat[]`).

This phase is the riskiest (it touches the pipeline). It is **additive and fail-soft**: a book with no `format` generates exactly as today.

## Review reach (phase 3)

A per-book **"Structure & Length"** studio panel (Consistency-panel pattern), checking the manuscript against the **declared** format.

### Structure review
- **Editable outline:** chapter summaries held in `data/.structure-review.json` (`outline: [{ chapter, summary }]`), seeded from a detected `*outline*` file in `data/` (noise-excluded) if present, else author-entered. Editable in-app.
- **Beat mapping — LLM proposes, author edits/confirms.** `POST /api/books/:slug/structure-review/propose` runs one LLM pass mapping each beat of the **resolved declared structure** to outline entries → `{ beat, chapters: number[], confidence, evidence }`. When the declared structure is `'custom'` and not yet defined, the same propose pass first **proposes a custom `Beat[]` scaffold** from the premise/outline for the author to edit. The author corrects the mapping (reassign chapters, mark beats satisfied/missing); the confirmed mapping persists in the sidecar. Edits to a **custom structure's beat definitions** persist back to the manifest `format.customStructure`.
- **Display (deterministic):** beat coverage (found / misplaced / missing) and each beat's actual position (chapter % across `chapterCount`) vs the beat's `pctRange`, reusing the existing `checkOutline` classification logic generalized to operate on a resolved structure + a beat→chapter mapping.

### Length review
- **Per-chapter actual word counts** (deterministic, from the book's chapter prose via the consistency auditor's `selectChapterFiles` + a word count) and the total.
- **Targets:** the declared per-chapter target (`format.wordsPerChapter`) and total (`format.totalTarget`); a genre-norm reference parsed from the book's genre `reader-expectations.md` (regex for an `"N,000–M,000 words"` range; fallback default) shown as secondary guidance.
- **Display:** per-chapter actual-vs-target deltas, total vs target, the form-band check, a per-chapter **length curve**, and outlier flags (chapters well over/under target).
- **Editable:** per-chapter target **overrides** persist in `data/.length-targets.json` (overriding the uniform `wordsPerChapter` for specific chapters); `PUT /api/books/:slug/length-targets` re-runs `validateFormFit` on the resulting total and rejects out-of-band edits.

### Review API
- `GET /api/books/:slug/structure-review` — resolved declared structure + stored outline + stored mapping + computed positions + recommendation.
- `POST /api/books/:slug/structure-review/propose` — `{ structureId? }` → LLM beat-mapping proposal (and custom scaffold when applicable).
- `PUT /api/books/:slug/structure-review` — save edited `{ outline, mapping, customStructure? }`.
- `GET /api/books/:slug/length-review` — per-chapter actual counts + targets + deltas + curve + band check + genre reference.
- `PUT /api/books/:slug/length-targets` — save per-chapter overrides (re-validated).

## Compute split

- **Deterministic:** form-band validation, word counts, target deltas, length curve, beat position-vs-`pctRange` classification, genre word-range parse. No LLM in any check.
- **LLM (only):** the structure-aware outline prompt (generation, phase 2) and the beat-mapping / custom-scaffold proposal (review, phase 3). Both are author-correctable — consistent with the repo's "LLM proposes, checks are deterministic" convention.

## Persistence summary

- **Manifest (`book.json`):** the declared `format` block (incl. any `customStructure`) — core config.
- **Sidecars in the book `data/` dir** (travel with the container, fail-soft, like `.non-canonical.json`): `.structure-review.json` (editable outline + confirmed beat mapping) and `.length-targets.json` (per-chapter target overrides).

## Testing

**Unit (no LLM, fixtures):**
- `validateFormFit`: rejects Short Story 24×100k (out of band), accepts a novella 24×1,250 (=30k in band), Serial accepts a large total (open max) but rejects below min, Epic accepts ≥120k.
- `story-forms` catalog: every form has a coherent band (`min < max` where `max` set); `getForm` round-trips.
- `story-structures`: Four-Act present with ordered beats; `resolveStructure` returns a catalog structure by id and the inline object for `'custom'`.
- Beat position-vs-`pctRange` classification (generalized `checkOutline`) on a fixture mapping: in-range → found, off → misplaced, absent → missing; works on a custom `Beat[]`.
- Genre word-range parse: extracts `[min,max]` from sample `reader-expectations.md` strings; fallback when absent.
- Sidecar load/save fail-soft (missing/corrupt → empty); per-chapter actual word count + delta computation.
- Creation validation: `POST /api/books` with an out-of-band total → 400 with a band message (route-level unit/handler test).
- Beat-mapping proposal JSON parse (pure parse of a fixture LLM response).

**Smoke (`tests/book-format-smoke.sh`, real boot):**
- Create a book with `{ form: novella, structure: four-act, chapterCount: 20, wordsPerChapter: 1500 }` → 200, manifest `format` persisted.
- Create a book with `{ form: short-story, chapterCount: 24, wordsPerChapter: 100000 }` → **400** band block.
- Write a couple of chapters + an outline, `POST structure-review/propose` → mapping present; `PUT` edits persist; `GET length-review` shows actual-vs-target + the band check. Hermetic; cleans up.

## Build phasing (for the plan)

1. **Catalog + creation config:** `story-forms.ts` + `validateFormFit`; structure-catalog expansion + custom-structure type + `resolveStructure`; manifest `format` field (backend + shared type); `POST /api/books` + `PUT …/format` validation; `GET /api/forms`; the New-Book form UI (selectors + chapter/length inputs + live band check). Fully unit-tested.
2. **Generation wiring:** `formatGuideFor` → per-chapter `wordCountTarget` + `chapterCount` planning + structure-aware outline prompt rail. Additive, fail-soft.
3. **Review surface:** structure-review (+propose) and length-review routes; the deterministic generalized beat-position check; the studio "Structure & Length" panel; the smoke test.

## Out of scope (v1)

- Timelines and character-profile review (separate later features).
- Verse forms (Epic Poem) and their line/canto metrics.
- Checking structure against the manuscript **prose** (we use the outline).
- Author-defined custom **forms** (the form catalog is fixed; only structure has "Other / Custom").
- Any auto-fix / rewrite of structure or length (review + edit targets/mapping only).

## Constraints

- Node 22+, TypeScript via `tsx`; `.js` import extensions (NodeNext). Fail-soft init/runtime (`✓ / ⚠ / ℹ`). Deterministic check path; LLM only in the outline rail + proposal.
- Manifest change is additive/optional — no `BOOK_SCHEMA_VERSION` bump; older books read as "format not set".
- `commit_message` + `./push.sh` workflow; work on `main`; professional Markdown, no emojis.
- Surgical, pattern-matching changes; reuse `story-structures.ts` types, the consistency auditor's `selectChapterFiles`, the sidecar pattern (`.non-canonical.json`), and the Consistency-panel UI pattern.
