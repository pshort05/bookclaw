# Book-Container Phase 3 — Per-book wiring (design)

**Status:** Approved via brainstorm 2026-06-06. Feeds `writing-plans`.
**Companion:** `docs/BOOK-CONTAINER-ARCHITECTURE.md` (Phase 3 bullet). Uses the canonical vocabulary in `docs/GLOSSARY.md`.

## Goal

Make the **active Book** the source of the **Author** identity, the **Pipeline**,
and the **output location**, so generation runs against a book's own snapshot
(`workspace/books/<slug>/`) instead of the global singletons (`workspace/soul/`,
the hardcoded `PROJECT_TEMPLATES`, `workspace/projects/<id>/`). Phases 0–2 were
additive; **Phase 3 is the first phase that rewires the live generation path.**

## Decisions (locked 2026-06-06)

1. **Global active book.** One current Book at a time, pointer persisted in
   `workspace/.config/active-book.json`; selectable in the dashboard (and Telegram
   later). Concurrency / per-request book id is deferred.
2. **Hybrid pipelines-as-data.** The engine reads the 6 static pipelines from the
   book's `templates/pipeline.json`; the dynamic `novel-pipeline` keeps its code
   generator, invoked via the book's pipeline ref + the book's config. Delete the
   static `PROJECT_TEMPLATES` constants, `exportBuiltinPipelines()`, the generator
   script, and the drift-guard test — the library/book JSON is now canonical.
3. **Auto-seed a Default Book on first run.** No books → create one (built-in
   default Author + default pipeline) and set it active; books-but-none-active →
   activate the most-recent.
4. **Clean cutover.** Retire the flat `workspace/projects/<id>/` + global-soul
   generation path; redirect to the active book's `data/` and Author. Safe because
   the deployment is fresh (no existing projects/books to preserve).
5. **Scope trim (deferred):** per-book **skills snapshot** → Phase 4; formal
   **Author/Voice asset split** → Phase 4/library; **concurrency** → later. Phase 3
   reads the book's whole `templates/author/` snapshot (all 4 identity/style files)
   as the "author context".
6. **All data is expendable until v6 (owner note 2026-06-06).** No backward
   compatibility, no version-to-version data migration, and **no version-gate
   *enforcement*** for now — a schema change may simply discard/recreate books.
   The Phase-2 gate *classification* (the `ok`/`readonly`/`quarantined` status +
   badge) stays as informational, but Phase 3 does **not** block runs on it.
   Migration + enforcement get reconsidered once v6 is the stable baseline.

## Architecture

The active Book is resolved once and drives three things:

```
active book (workspace/.config/active-book.json → workspace/books/<slug>/)
  ├─ templates/author/   → SoulService reads this (was workspace/soul/)
  ├─ templates/pipeline.json → ProjectEngine reads this (was PROJECT_TEMPLATES)
  └─ data/               → step outputs / chapters / manuscript land here (was workspace/projects/<id>/)
```

A run is gated on the active book's `status` (from the Phase-2 version gate):
`ok` → proceed; `readonly`/`quarantined` → refuse.

## Sub-phases (implementation sequence — each independently shippable)

### 3a — Active-book state + Default Book seed (foundation; no generation change)
- `BookService`: `getActiveBook(): string | null`, `setActiveBook(slug)`, persisted
  in `workspace/.config/active-book.json`. `setActiveBook` rejects a non-`ok` book
  for activation-as-writable (or warns).
- Boot (in the init phase that constructs `BookService`): if no books → `create()` a
  **Default Book** from the built-in default Author + default pipeline, set active;
  else if no active → activate the newest by `createdAt`.
- API: `GET /api/books/active` (→ active manifest + status), `POST /api/books/active`
  `{slug}`. Dashboard: a book selector in the Books panel / header that calls it.
- *Verify:* fresh workspace boots with a Default Book active; selecting another book
  persists across restart.

### 3b — SoulService → active book's Author
- `SoulService` gains `useBook(bookDir)` (set its source to
  `workspace/books/<slug>/templates/author/` and `reload()`); called whenever the
  active book is set/changed. Fallback to the built-in default author dir if the
  snapshot is missing/unreadable (fail-soft).
- The prompt builders (`index.ts` ~521, ~801) keep calling
  `soul.getFullContext()` unchanged — it now returns the active book's author.
- *Verify:* with two books that have different authors, switching the active book
  changes the injected author context; editing one book's author files doesn't
  affect the other.

### 3c — Engine reads `pipeline.json` + outputs to the book's `data/` (the big one)
- `ProjectEngine` loads the active book's `templates/pipeline.json`:
  - `dynamic: true` (novel-pipeline) → call the existing code generator with the
    book's config (genre/chapters/words from `book.json` + the genre snapshot).
  - else → build steps from the JSON `steps[]`, interpolating `{{title}}`,
    `{{description}}`, `{{genre}}` from the book context.
- **Delete:** `PROJECT_TEMPLATES` (the 6 static templates) + `exportBuiltinPipelines()`
  in `services/projects.ts`, `scripts/gen-library-pipelines.ts`, and
  `tests/unit/library-pipelines.test.ts` (the drift guard). The committed
  `library/pipelines/*.json` become the hand-maintained canonical source.
- **Outputs:** every step output / chapter / `manuscript.*` / compiled export writes
  under `workspace/books/<slug>/data/` (replace the `workspace/projects/<id>/`
  paths in `projects.routes.ts` and `index.ts`).
- **No gate enforcement** (decision 6 — data expendable until v6): runs are not
  blocked on the book's status; the status stays an informational badge only.
- *Verify:* `feature-smoke.sh` + `openrouter-pipeline.sh` still pass end-to-end
  (generation now runs against a book); outputs appear under the book's `data/`.

## Files touched (anticipated)
- `gateway/src/services/book.ts` — active-book pointer, default-book seed.
- `gateway/src/services/soul.ts` — `useBook()` / re-point.
- `gateway/src/services/projects.ts` — read pipeline.json; delete static templates + exporter.
- `gateway/src/api/routes/books.routes.ts` — `GET/POST /api/books/active`.
- `gateway/src/api/routes/projects.routes.ts`, `gateway/src/index.ts` — output paths → book `data/`; gate check.
- `gateway/src/init/phase-0X` — wire active-book + default-book seed (after BookService).
- Delete: `scripts/gen-library-pipelines.ts`, `tests/unit/library-pipelines.test.ts`.
- `dashboard/src/panels/books.js` (+ index.html/main.js) — active-book selector.
- Tests: new unit coverage for active-book + SoulService-per-book + pipeline.json read.

## Out of scope (Phase 3)
- Per-book skills snapshot + injection (Phase 4).
- Formal Author/Voice asset split (Phase 4 / library).
- Concurrency / per-request book id (later).
- Editor re-point + re-pull (Phase 4); share/import (Phase 5); backup (Phase 6).

## Risks & safety net
- This rewires the most-used path (soul + engine + output). The real-call tests
  (`feature-smoke.sh`, `openrouter-pipeline.sh`) are the end-to-end safety net;
  new unit tests cover the active-book + per-book-soul + pipeline.json logic.
- Deleting `PROJECT_TEMPLATES` removes the generator source — but the library JSON
  is already committed and becomes canonical, so no content is lost.
- Clean cutover means any code still reading `workspace/projects/` must be found
  and re-pointed; a grep sweep is part of 3c.

## Verification criteria
- Fresh boot → Default Book active; a generated run lands under
  `workspace/books/<active>/data/`.
- Two books with different Authors produce different author context.
- `feature-smoke.sh` + `openrouter-pipeline.sh` green against a Phase-3 build.
- `tsc` clean; unit tests green; no remaining references to the deleted
  `PROJECT_TEMPLATES`/exporter/drift-guard.

## Workflow note
Per the repo convention: work on `main`, do not commit/push directly — write
`commit_message` and the maintainer runs `./push.sh`. New code uses canonical
terms (Book/Pipeline/Step/Model/Author); no broad UI rename (deferred to the UI
rewrite).
