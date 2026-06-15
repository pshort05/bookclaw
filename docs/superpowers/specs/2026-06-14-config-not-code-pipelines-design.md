# Config-not-Code Pipelines — Design

Date: 2026-06-14

Turn the book-production pipeline into editable data, and let a book run an **ordered sequence of named pipelines** (seedable from saved presets) instead of a hardcoded phase enum. Closes the North Star "config-not-code pipelines" item and folds in two adjacent TODO asks (phase-order-as-data, sections/skills wiring).

## Current state (what we're changing)

- **Five of six phase pipelines are already data** (`library/pipelines/{book-planning,book-bible,deep-revision,format-export,book-launch}.json` have real `steps[]`). Only **`book-production.json`** and **`novel-pipeline.json`** are stubs (`"dynamic": true, "steps": []`) — their prompts live hardcoded in `ProjectEngine.createBookProduction` / `createNovelPipeline`.
- **`createProjectFromPipeline` already interpolates** `{{title}}/{{description}}` (+ context) via `expandTemplate`, and builds a Project from a pipeline's `steps[]`.
- **A book snapshots ONE pipeline** (`templates/pipeline.json`); generation runs that one pipeline. The 6-phase "macro" (`createPipeline`, hardcoded array) is a separate path not tied to a single book.
- **Phase order** is the global enum `NOVEL_PIPELINE_PHASES` + the hardcoded array in `createPipeline`.
- **`WIRED_KINDS = {author, voice, pipeline, worldbuilding}`** (+genre). Section and skill snapshots are written into a book but never reach a prompt.
- `BOOK_SCHEMA_VERSION = 1`, `BOOK_MIN_SUPPORTED = 1`.

## Target model

A **book** owns an ordered `pipelineSequence: string[]` (its source of truth), and snapshots each referenced pipeline. Running a book creates one chained Project per sequence entry, in order, resolving steps from the book's own snapshot (copy-on-create isolation). Each pipeline is a short, named, editable artifact; production-type pipelines use a per-chapter **expand** construct so the chapter loop is data, not code. A new **`sequence`** library kind lets users save reusable presets (`novel`, `romance-novel`, …) that New Book seeds the per-book list from.

---

## Section 1 — Data model (APPROVED)

**New library kind `sequence`** (add to `LIBRARY_KINDS` + shared `LibraryKind`). Content is JSON:
```json
{ "schemaVersion": 1, "name": "novel", "label": "Novel",
  "description": "Full novel: plan → bible → production → revision → format → launch",
  "pipelines": ["book-planning","book-bible","book-production","deep-revision","format-export","book-launch"] }
```
Built-in + workspace overlay like every kind. Ships one preset: `novel` (the current order). Validated: `pipelines` non-empty array of strings; each name must resolve to a known pipeline at create time (unknown → create-time error, listed).

**Book (`book.json`) gains `pipelineSequence: string[]`** — the per-book ordered names (source of truth). Snapshot layout changes from one `templates/pipeline.json` to **`templates/pipeline/<name>.json`** (one per sequence entry). Author/voice/genre/world/sections/skills snapshots are unchanged.

**Schema v2 + lazy migration.** `BOOK_SCHEMA_VERSION → 2`, keep `BOOK_MIN_SUPPORTED = 1` (v1 books stay `ok`, not quarantined). On book read, if `schemaVersion === 1`: wrap the single `templates/pipeline.json` into `templates/pipeline/<name>.json` (name from the pipeline's `name`, else `"pipeline"`), set `pipelineSequence: [name]`, stamp `schemaVersion: 2`, persist. Fail-soft (a migration error leaves the book readable, logs `⚠`). This is the anticipated first v1→v2 bump, so `BookService.setPhase` also gains the deferred `assertWritable` gate here.

---

## Section 2 — Generation orchestration + the expand construct

**Orchestration.** Replace the hardcoded phase array in `createPipeline` with a book-driven sequence. New `ProjectEngine.createBookSequence(book, title, description, context)`:
- Reads `book.pipelineSequence`; for each name, loads the book's **snapshot** `templates/pipeline/<name>.json` (via a `BookService.snapshotPipelineOf(slug, name)` accessor) and calls `createProjectFromPipeline(snapshot, …)`.
- Chains the resulting Projects via the existing `pipelineId` + `pipelinePhase` (phaseNum = position in the sequence). First project pending-ready, rest wait — exactly the current `createPipeline` chaining.
- `bookSlug` stamped on every project (explicit param to the factory — also addresses the Phase-8 follow-up to stop post-hoc stamping).

The `/api/projects/create` and book-run entry points route an active-book run through `createBookSequence`. The legacy type-branches (`novel-pipeline` → `createNovelPipeline`, `book-production` → `createBookProduction`) remain only as a **no-active-book fallback** (e.g. a bare `/novel` chat command without a book) — deprecated, not deleted, to avoid breaking the bridges.

**Per-chapter expand construct.** A pipeline's `steps[]` may contain, in addition to normal steps, an **expansion group**:
```json
{ "expand": "chapters", "steps": [
  { "label": "Write Chapter {{n}}", "skill": "write", "taskType": "creative_writing", "phase": "writing",
    "wordCountTarget": "{{wordsPerChapter}}", "chapterNumber": "{{n}}",
    "promptTemplate": "Write Chapter {{n}} of \"{{title}}\" … at least {{wordsPerChapter}} words …" },
  { "label": "Polish Chapter {{n}}", "skill": "revise", "taskType": "revision", "phase": "polish",
    "wordCountTarget": "{{wordsPerChapter}}", "chapterNumber": "{{n}}",
    "promptTemplate": "You just wrote Chapter {{n}} … produce a REVISED, POLISHED version …" }
] }
```
At resolve time the group is flattened: for `n` in `1..chapterCount`, emit the group's steps **interleaved** (Write1, Polish1, Write2, Polish2, …) — preserving the existing context dependency where Polish follows its Write. `chapterNumber`/`wordCountTarget` are set numerically on each emitted step (parsed from the interpolated value). Plain steps are emitted once, as today.

**Variable set** (extends `expandTemplate`): `{{title}}`, `{{description}}`, `{{chapterCount}}`, `{{wordsPerChapter}}`, structural beats `{{setupEnd}} {{incitingEnd}} {{midpoint}} {{twist75}} {{climaxStart}} {{climaxEnd}}` (computed from `chapterCount` exactly as `createNovelPipeline` does today), `{{n}}`/`{{chapterNumber}}` inside expand groups, plus existing context fields (`genre/pov/tone/…`). `chapterCount` from `context.targetChapters` (default 25, clamped 1–200); `wordsPerChapter` from `context.targetWordsPerChapter` (default 3000, min 100).

**Authoring.** `book-production.json` is rewritten from the `dynamic` stub into real data: one expand group (Write/Polish, lifted verbatim from `createBookProduction`) + a final "Compile manuscript" plain step. `novel-pipeline.json` is **retired in favor of the `novel` sequence** (planning+bible+production+revision+format+launch) — the monolith's premise/outline content already exists across `book-planning`/`book-bible`; any premise/outline step not present there is added to those pipelines so no content is lost.

---

## Section 3 — Sections + skills wiring (expand `WIRED_KINDS`)

Add `section` and `skill` to `WIRED_KINDS`.

**Sections.** New `BookService.sectionsOf(slug)` concatenates the book's `templates/sections/*.md` (author-curated reference: recurring elements, style notes). `buildSystemPrompt` injects it alongside genre/world (same mechanism, a labelled block). Always-on (matches genre/world); empty when no sections.

**Skills.** When a step references a `skill`, the step-execution path that injects skill content first consults the book's snapshot via new `BookService.skillContentOf(slug, name)` (`templates/skills/<name>/SKILL.md`), falling back to the global `SkillLoader` when the book has no snapshot. This makes a book use its **frozen** skill version (copy-on-create isolation) rather than the mutable global. Matching stays global; only the injected *content* is snapshot-preferred.

---

## Section 4 — Phase order as data

Phase order becomes the book's sequence. `BookService.phasesForBook(slug)` concatenates `pipelinePhases(snapshot)` across the sequence in order (dedup adjacent). The board (`pipelinePhasesOf`/`phasesForBook`) and `setPhase` advance through these. The global `NOVEL_PIPELINE_PHASES` enum stays only as the fallback for a legacy `dynamic` pipeline. No hardcoded 6-phase array remains in the generation path.

---

## Section 5 — API + UI

**API.** The generic `/api/library/:kind` routes already cover a new kind once it's in `LIBRARY_KINDS` (list/read/write/delete/export/import as JSON content, reusing the `pipeline`-style JSON path). Book create (`POST /api/books`) accepts `pipelineSequence: string[]` (explicit list) and/or `sequence: <name>` (seed the list from a preset, then `pipelineSequence` overrides if both given). Snapshots each pipeline in the resolved list.

**New Book UI.** Add a **Sequence** picker: choose a sequence preset (seeds the ordered pipeline list) and/or compose manually; reorder / add / remove pipelines before create. Shows each pipeline's source + description. Replaces the single-pipeline selector.

**Asset Studio.** New `SequenceEditor` for `kind === 'sequence'` (reorderable list of pipeline names chosen from available pipelines + label/description), mirroring `PipelineEditor`/`SkillEditor`. `PipelineEditor` gains support for the `expand` group (mark a step group as "repeat per chapter").

---

## Section 6 — Testing

**Unit (`tests/unit/`):**
- `pipeline-expand.test.ts` — expand group → 2N+1 steps interleaved; `{{n}}`/beats/`{{wordsPerChapter}}` interpolated; `chapterNumber`/`wordCountTarget` numeric; plain steps unaffected; default/clamped chapter count.
- `sequence-store.test.ts` — sequence kind validate (non-empty, string names), list/read/write via LibraryService overlay.
- `book-sequence.test.ts` — `createBookSequence` builds N chained projects in order from snapshots; bookSlug stamped; phase = position.
- `book-migration-v2.test.ts` — v1 single-pipeline book → v2 sequence layout; `schemaVersion` bumped; idempotent; fail-soft.
- `book-phases.test.ts` (extend) — `phasesForBook` concatenates across the sequence.
- `wired-kinds.test.ts` — sections/skills now in `WIRED_KINDS`; `sectionsOf`/`skillContentOf` compose/prefer-snapshot.
- `setPhase` assertWritable gate.

**API (`tests/api/api-test.sh`):** sequence kind list/read; book create with `sequence`/`pipelineSequence`; book reports `pipelineSequence`.

**Smoke (real OpenRouter):** extend `tests/spend-smoke.sh` *or* a new `tests/sequence-smoke.sh` — create a book from the `novel` sequence with `targetChapters: 2`, run the production pipeline, assert the expand produced 2 chapters (Write/Polish) in the book's `data/`, and per-book spend attribution still holds. Update `tests/extended-feature-smoke.sh` for the sequence model.

---

## Decisions & non-goals

- **One Project per sequence entry, chained** (not one mega-project) — reuses existing advancement/board; minimal disruption.
- **Generation resolves from the book's snapshot**, never the live library — preserves copy-on-create isolation.
- **Legacy `createNovelPipeline`/`createBookProduction` kept as no-book fallbacks**, not deleted — bridges/`/novel` without a book still work. (Cleanup to delete them is a later item once the bridges route through a book.)
- **Not in scope:** per-step model overrides in sequences (already exist on steps); the broader god-class `ProjectEngine` extraction; the cost-recording coverage gap; the `?token=` items.
- **TODO bookkeeping:** on completion move the "config-not-code pipelines" item (and the phase-order / sections-skills sub-asks) to `COMPLETED.md` (2026-06-14); the `setPhase` assertWritable + `dataDirOf` gate item is partially closed (setPhase done; `dataDirOf` still deferred — note it).
