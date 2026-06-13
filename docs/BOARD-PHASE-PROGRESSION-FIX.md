# Book Board phase-progression fix (TODO #15)

**Status:** COMPLETE 2026-06-13. All steps (1–9, 11) implemented, reviewed (two fanned-out
`/code-review`s), and DEPLOYED to Mercury (backend then frontend; both healthy). The probe
confirms the board phase advances (bible→production→revision, was frozen at planning) AND
renders 4 segments for the 4-phase probe pipeline (not the legacy 6). Moved to
[COMPLETED.md](COMPLETED.md). This doc is retained as the design/implementation record.
One low-severity follow-on was deferred (see TODO "schemaVersion gate at the data-output
path"): `BookService.setPhase` writes the manifest without the `assertWritable` gate —
unreachable while all books are schema v1; add the gate at the first v1→v2 bump.

**Review fix (medium):** book-production emits a `polish` step phase that is not a member
of a novel-pipeline book's `phasesForBook` → the live/persisted phase is now **clamped to
the book's segment list** (in `buildBookCards` and the `onStepCompleted` hook), so a
sub-phase keeps the chip on its containing segment and `card.phase` is always ∈ `card.phases`.
The steps 7–8 `Board.tsx` rewrite should still guard `phases.indexOf(card.phase) === -1`
defensively (for the no-pipeline `phases:[]` → `LIFECYCLE_PHASES` fallback case).

Tracks `docs/TODO.md` item: *"Possible bug — books don't update in real time on
the Book Board."* The investigation showed the item is really **three**
intertwined problems; this doc records the reproduction, the approved design,
the ordered implementation plan, and the current on-disk / on-Mercury state.

---

## 1. What's actually wrong (reproduced 2026-06-13 against Mercury)

The board card's data comes from three different sources, and only one updates:

| Card field | Source | Updates? |
|---|---|---|
| `phase`, `title`, `genre`, `author`, `voice`, `status` | `BookService.list()` → read straight from `book.json` `m.phase` | **No** — `m.phase` is written `'planning'` once at creation and never again |
| `live` ("writing…" strip + `progress`) | `buildBookCards()` from in-memory active projects | Yes (surfaced by the 4s poll while a book is live) |
| `next` action pill | `nextStep(slug)`: phase from manifest + `hasOutput` from `data/` | Phase part frozen; `hasOutput` flips when a file lands |

**Root cause (verified):** the only post-creation writer of `book.json` is
`BookService.updatePulledFrom()` (re-pull), which never touches `phase`. No
`onProjectCompleted` hook updates it. There is no `setPhase`/`advancePhase`
anywhere. So the phase chip + 6-segment bar + next-action are permanently stuck.

**Three sub-problems:**
1. **Phase never advances server-side** (the data gap above) — the core bug.
2. **Live progress** — the `live` strip works, but the phase indicator doesn't,
   because it's not derived from the live project.
3. **Phase count is hardcoded to 6.** `Board.tsx` (`PHASE_ORDER`) and
   `BookDrawer.tsx` (`PHASES`) hardcode the 6 lifecycle stages
   (`planning/bible/production/revision/format/launch`) and render "phase X of 6"
   regardless of the book's actual pipeline. A 4-step pipeline still shows 6.

### Reproduction result (probe run on Mercury, 4 successful steps)

```
Intended step phases:  planning → bible → production → revision
BOARD at start:        phase=planning   live[Probe: planning 0%]   next[Plan the book]
Stage 1 (planning ✓):  phase=planning   live[Probe: bible 25%]
Stage 2 (bible ✓):     phase=planning   live[Probe: production 50%]
Stage 3 (production ✓):phase=planning   live[Probe: revision 75%]
Stage 4 (revision ✓):  phase=planning   live[none]
RESULT: board phase did NOT advance (planning → planning → planning → planning)
```

The `live` strip + `progress` advanced (0→25→50→75→done); the **phase chip stayed
`planning`**. Confirms sub-problems 1 + 2. Sub-problem 3 was confirmed visually
(card showed 6 segments / "phase X of 6" for a 4-phase pipeline).

---

## 2. Decision: pipeline-driven phases (owner-approved 2026-06-13)

The board's 6 segments are currently the *universal book lifecycle* (the concept
mockups confirm this intent). **Owner chose to change this** so the bar reflects
the book's **actual pipeline phase sequence** (N segments) — the North Star
direction ("phase order is a property of the pipeline, not a global enum").

Approved sub-decisions:
- **(a)** Persist the **frontier** phase on step completion (`next?.phase ??
  completedStep.phase`) so a finished book reads its last phase, not "done".
- **(b)** `novel-pipeline` shows its internal vocabulary
  `premise/bible/outline/writing/revision/assembly` (NOT remapped to lifecycle words).
- **(c)** No-phase built-in pipelines (e.g. `book-planning`, whose steps carry no
  `phase`) → a single segment named after the pipeline's lifecycle stage.

---

## 3. Approved design

### Backend
1. **`pipelinePhases(pipeline: LibraryPipeline): string[]`** — pure helper, ordered
   **distinct** `step.phase`. Static phase-tagged pipeline → its phases; dynamic
   `novel-pipeline` → a canonical constant `NOVEL_PIPELINE_PHASES =
   ['premise','bible','outline','writing','revision','assembly']` (the code
   generator's order; the steps don't exist until a project is created); no-phase
   pipeline → single fallback segment.
2. **`BookService.phasesForBook(slug): string[]`** — resolve the book's snapshotted
   `templates/pipeline.json` → `pipelinePhases`; fallback to a single segment.
3. **`BookService.setPhase(slug, phase)`** — write `m.phase` to `book.json` (the
   field that already exists but is never updated). Widen `BookManifest.phase`
   from the fixed 6-enum to `string` (it is already `string` on `BookSummary`).
4. **`ProjectEngine.onStepCompleted(fn)`** — new step-level callback fired inside
   `completeStep()` (alongside the existing `completionHooks`). Wire in init (same
   place `onProjectCompleted` is wired — see `init/phase-08-website.ts` /
   `init/phase-06-content.ts`; pick the phase where `gw.books` + `gw.projectEngine`
   both exist) to call `books.setPhase(project.bookSlug, next?.phase ??
   completedStep.phase)` when `project.bookSlug` is set.
5. **`buildBookCards()`** (`gateway/src/services/book-card.ts`) — add `phases:
   string[]` to each card (from `phasesForBook`), and compute the **live** current
   `phase` from the bound active project's **active step's `phase`** (fallback: last
   completed step's phase). This overrides the manifest while in-flight, so the
   chip advances in real time via the existing 4s poll.
6. **`GET /api/books`** already calls `buildBookCards` → carries `phases`. Add
   `phases` to **`GET /api/books/:slug`** too (for the drawer).

### Frontend
7. **`Board.tsx`** — render the progress bar + "phase X of N" from
   `card.phases.length`; highlight `card.phases.indexOf(card.phase)`. Add a
   fallback color for phases outside the known `PHASE_VAR` palette (premise/outline/
   writing/assembly have no color today).
8. **`BookDrawer.tsx`** — render the timeline from the book's `phases` (from the
   detail response) instead of the hardcoded `PHASES`.
9. **Shared fallback constant** — add `LIFECYCLE_PHASES` to `@bookclaw/shared`
   (`frontend/shared/src`) as the fallback list; import in both components. Also
   closes the existing TODO "Dedup the pipeline-phase order constant."

### Tests (TDD)
10. **Unit** (`tests/unit`, `node --test` via tsx): `pipelinePhases`
    (static/dynamic/no-phase) and `buildBookCards` (live current phase from active
    step; `phases` populated). `book-card.ts` was explicitly built to be unit-testable.
11. **Integration:** extend `tests/book-phase-probe.sh` to also report `phases` +
    count. After the fix it must show `phases` count 4 and the observed phase
    walking `planning → bible → production → revision`.

---

## 4. Implementation plan (ordered, with verification)

1. Shared `LIFECYCLE_PHASES` constant in `frontend/shared/src` → verify `npx tsc --noEmit` clean.
2. `pipelinePhases` + `NOVEL_PIPELINE_PHASES` (pure) **+ unit test first** → `node --test tests/unit/...` green.
3. `BookService.phasesForBook` + `setPhase`; widen `BookManifest.phase` to `string` → `npx tsc --noEmit` clean.
4. `buildBookCards`: add `phases` + live current-phase **+ unit test** → `node --test` green.
5. `ProjectEngine.onStepCompleted` + init wiring → `npx tsc --noEmit` clean.
6. `phases` in `GET /api/books/:slug` → curl returns `phases` array.
7. `Board.tsx` render N from `card.phases` (+ fallback color) → `npm run build:frontend` (studio-build) clean.
8. `BookDrawer.tsx` timeline from `phases` → build clean.
9. Extend `tests/book-phase-probe.sh` to report `phases` + count.
10. Deploy to Mercury (`deploy.sh`), run the probe, **watch the board**:
    verify RESULT flips to "advanced", `phases` count = 4, chip walks the 4 phases.
11. Bookkeeping: move #15 from `docs/TODO.md` → `docs/COMPLETED.md` (date), write `commit_message`.

---

## 5. Current state / artifacts (what exists right now)

- **`tests/book-phase-probe.sh`** — NEW, committed to disk (executable). Report-only
  reproduction/verification harness. Creates a 4-step `phase-probe` overlay pipeline
  (steps tagged `planning/bible/production/revision`), a book from it, runs the 4
  steps one at a time, and reports the board row after each. Cheap (pins
  `google/gemini-2.5-flash`, disables Ollama for the run, restores both on EXIT;
  trivial prompts, no `wordCountTarget`). Leaves data in place; `CLEANUP=1` removes it.
  - Run: `BASE_URL=http://192.168.1.32:3847 PAUSE=6 tests/book-phase-probe.sh`
  - Clean: `CLEANUP=1 BASE_URL=http://192.168.1.32:3847 tests/book-phase-probe.sh`
- **On Mercury right now (leftover from the repro run):** probe book
  `phase-probe-6183` (project `project-482`) + the `phase-probe` workspace-overlay
  pipeline. Harmless; remove with the CLEANUP command above. After the fix is
  deployed, a fresh probe run will create a new book.

### Environment facts (for the new system)
- Mercury = `192.168.1.32`, gateway on `:3847`, container `bookclaw` (running,
  healthy, latest version as of 2026-06-13). Studio at `http://192.168.1.32:3847`.
- The dev tree `/home/paul/data/dev/bookclaw` is shared to Mercury, and the
  `docker/.env` `BOOKCLAW_AUTH_TOKEN` matches Mercury's running token — the probe
  resolves the token from `$BOOKCLAW_AUTH_TOKEN` → repo `docker/.env` → `docker exec`.
- This investigation ran from host `ceres` (no local bookclaw container).

### Key code references
- `frontend/studio/src/routes/Board.tsx` — `PHASE_VAR`/`PHASE_ORDER` (7–13), poll (27–32), progress bar (69–78).
- `frontend/studio/src/components/BookDrawer.tsx` — `PHASES` (7), `curIdx` (48), timeline (104–111).
- `frontend/shared/src/store.ts` — `loadBooks`; `frontend/shared/src/types.ts` — `BookSummary`, `BookLive {stepLabel, progress}`.
- `gateway/src/services/book-card.ts` — `buildBookCards`, `BookCard`, `BookLive`.
- `gateway/src/services/book.ts` — `list()` (236–263), `nextStep()` (455–472), create manifest `phase:'planning'` (213–234), `updatePulledFrom()` only post-create writer (936–956).
- `gateway/src/services/book-types.ts` — `BookManifest.phase` enum (30), `BookSummary.phase` (47), `WIRED_KINDS` (76).
- `gateway/src/services/projects.ts` — `completeStep()` (the hook seam), `step.phase` note (87), `createNovelPipeline` phases.
- `gateway/src/services/library-types.ts` — `LibraryPipelineStep.phase` (21), `LibraryPipeline.steps` (33).
- `gateway/src/api/routes/books.routes.ts` — `GET /api/books` builds cards (22–33), `GET /api/books/:slug` (91–102).
- `gateway/src/api/routes/projects.routes.ts` — `/api/projects/create` book-pipeline path (150–158), `/execute` calls `completeStep` (421), `/start` (248).
