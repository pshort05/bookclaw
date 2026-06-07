# Phase 4 — Re-point the editor (two edit scopes) + re-pull from library

**Status:** Approved (brainstorm 2026-06-07). Feeds `writing-plans`.

**Goal:** Close book-container **Phase 4**. Re-point the existing in-dashboard
editor so it can edit **either** a shared **library** template **or** the active
book's **snapshot** copy (two edit scopes, full CRUD on the library overlay), and
add a per-book **re-pull from library** that 3-way-merges library updates into a
book against a stored pristine baseline.

**Architecture:** Extend the existing library / book / soul / authoring
mechanisms rather than add services. Library gains a **write** API (overlay CRUD,
mirroring the skills-overlay pattern). `BookService.create()` captures a pristine
**`.baseline/`** mirror of the snapshot so re-pull can diff3 (baseline vs the
book's edited copy vs the current library) and auto-merge non-conflicting
changes. A pure **merge helper** does the text 3-way merge; pipeline JSON is
handled whole-asset. The existing authoring panel is re-pointed into a two-scope
editor; the books panel hosts the re-pull surface.

**Tech stack:** Node 22 + TypeScript (NodeNext, `.js` import extensions), Express
routes, `node --test` unit tests via tsx, esbuild dashboard, one new pure-JS dep
(`node-diff3`) for 3-way text merge.

---

## Background / current state (verified against the tree)

- **`LibraryService`** (`gateway/src/services/library.ts`) is **read-only**.
  `FILE_KINDS = ['author','voice','genre','pipeline','section']`; `skill` is
  delegated to `SkillLoader`. `DIR_LAYOUT` maps each to a subdir
  (`authors`/`voices`/`genres`/`pipelines`/`sections`). It loads **built-in**
  (`library/`, baked, read-only) then **workspace overlay** (`workspace/library/`,
  overrides by name). `LibrarySource = 'builtin' | 'workspace' | 'synthetic'`.
  `get(kind,name)` returns a `LibraryEntryFull`: multi-file kinds
  (author/voice/genre) carry `files: Record<filename,content>`; `section`/`skill`
  carry `content`; `pipeline` carries a parsed `pipeline`. `reload()` re-reads
  all file kinds. Constructor: `(builtinDir, workspaceDir, skills)`.
- **`library.routes.ts`** exposes read-only `GET /api/library`,
  `/api/library/:kind`, `/api/library/:kind/:name`. Header comment already says
  the write path is Phase 4.
- **`BookService`** (`gateway/src/services/book.ts`): `create(sel)` snapshots the
  resolved library into `workspace/books/<slug>/templates/`:
  `author/` (files), `voice/` (files), `genre/` (files, optional),
  `pipeline.json`, `sections/<name>.md` (optional), `skills/<name>/SKILL.md`
  (frozen record of the skills the chosen pipeline's steps reference; **not**
  injected). `book.json.pulledFrom` records `{author, voice?, genre?, pipeline,
  skills?}` as `PulledRef = {name, source, version?}` (only `pipeline` carries a
  `version` = `schemaVersion`). Accessors `activeAuthorDir()`,
  `activeVoiceDir()`, `activeDataDir()`, `getActivePipeline()`. Constructor takes
  the `LibraryService`, so re-pull methods can resolve the current library.
- **`SoulService`** (`gateway/src/services/soul.ts`): `useBook(authorDir,
  voiceDir)`, `reload()`, `resetToInitial()`. Identity (SOUL/PERSONALITY) from
  the author dir; style (STYLE-GUIDE/VOICE-PROFILE) from the voice dir.
- **`authoring.routes.ts`** is the editor backend today: `GET/PUT /api/prompts`
  edits the four prompt files and **already targets the active book's snapshot**
  via `promptDirFor()` (author files → `activeAuthorDir`, style files →
  `activeVoiceDir`; no active book → `workspace/soul/`). Skills have full
  create/update/delete writing to the **global** `workspace/library/skills/`
  overlay, with `SkillLoader.reload()`.
- **`_shared.ts`** exports `safePath(baseDir, rel)` — returns an absolute path
  only if it stays within `baseDir`, else `null` (traversal guard).
- **Dashboard panels:** `authoring.js` (the editor), `books.js` (book list +
  create + delete + active selector), `library.js` (read-only library browser).
- **Wired vs unwired (Phase 3 reality):** a book's **author** + **voice**
  snapshots drive generation (via `SoulService.useBook`) and its **pipeline**
  drives the engine. Its **genre**, **sections**, and **skills** snapshots are
  **stored records not yet injected** into generation. The editor must label
  book-scope genre/sections/skills accordingly so editing them isn't a silent
  no-op surprise.

## Decisions (from the 2026-06-07 brainstorm)

1. **Scope:** ship the editor two-edit-scopes **and** re-pull together.
2. **Re-pull = true 3-way merge** against a stored pristine **baseline**;
   non-conflicting changes auto-merge.
3. **Granularity:** **per-asset** — the user re-pulls individual assets.
4. **Conflicts:** the auto-merged result carries **git-style conflict markers**
   (`<<<<<<< book` / `=======` / `>>>>>>> library`) and opens in the editor for
   hand-resolution.
5. **Kinds:** author/voice/genre/section/skill via text 3-way merge; **pipeline
   is JSON-aware** — whole-asset keep-mine/take-library (no line merge),
   `JSON.parse`-validated on save.
6. **Library writes = full CRUD** on the **workspace overlay**: edit any entry,
   create new entries, delete overlay entries. Built-ins stay read-only;
   deleting an overlay that shadowed a built-in reverts to the built-in.
7. **Editor home = Approach 1:** re-point the existing `authoring.js` panel into
   a two-scope editor (scope selector → kind → entry → textarea), not a new
   panel.
8. **No migration (decision 6 — data expendable until v6).** Books created
   before Phase 4 have **no `.baseline/`**; their re-pull degrades to a 2-way
   **keep-mine / take-library** per asset (no auto-merge), clearly labeled. No
   version-bump or backfill code.

---

## Components

### 1. Merge helper (pure, unit-testable)
**Files:** `gateway/src/services/merge.ts` (new), `package.json` (+`node-diff3`).

- `mergeText(baseline: string, mine: string, theirs: string): { merged: string;
  hadConflicts: boolean }` — 3-way text merge via `node-diff3`'s `mergeDiff3`,
  with labels `book` (mine) / `library` (theirs). Clean hunks merge silently;
  conflicting regions are wrapped in git-style markers and `hadConflicts` is
  true.
- No baseline available (2-way fallback) is **not** handled here — that path
  never calls `mergeText` (the route picks keep/take instead, see §5).
- Pure: no fs, no globals. Imports only `node-diff3`.

### 2. Baseline storage (enables 3-way)
**Files:** `gateway/src/services/book.ts`, `gateway/src/services/book-types.ts`.

- `create(sel)`: after writing `templates/`, copy it verbatim to a sibling
  `workspace/books/<slug>/.baseline/` (`fs.cp(templatesDir, baselineDir,
  {recursive:true})`). `.baseline/` mirrors `templates/` exactly and is **never**
  edited by the editor (only `create()` and a successful re-pull write it).
- New accessors: `bookDir(slug)`, `baselineDir(slug)`, `templatesDir(slug)` (or
  reuse existing private join helpers) so routes/re-pull can resolve paths
  without re-deriving them.
- `.baseline/` is internal runtime state: exclude it from any future
  share/backup content set (Phase 5/6 concern — noted, not built here).

### 3. Library write API (overlay CRUD)
**Files:** `gateway/src/api/routes/library.routes.ts`, `gateway/src/services/library.ts`.

All writes target the **workspace overlay** (`workspace/library/<DIR_LAYOUT>/`)
via `safePath`, then `services.library.reload()`. Built-ins are never written.

- `LibraryService` gains the overlay root + small write helpers (keeps fs paths
  in the service, not the route): expose `getOverlayDir(kind)` and
  `overlayExists(kind,name)` / `builtinExists(kind,name)`, or implement the
  writes as service methods `writeEntry`, `createEntry`, `deleteOverlayEntry`.
  (Plan picks one; the route stays thin.)
- `name` guard everywhere: `^[a-z0-9][a-z0-9-]{0,63}$` → 400 otherwise.
- **Body shape by kind:**
  - author/voice/genre (multi-file): `{ files: Record<string,string> }`; each key
    must match `^[A-Za-z0-9._-]+\.md$` (no separators) → 400 otherwise; at least
    one file required.
  - section: `{ content: string }` → `sections/<name>.md`.
  - pipeline: `{ content: string }` → `JSON.parse` must succeed **and** the
    result must have a `steps` array + `schemaVersion` number → 400 otherwise →
    `pipelines/<name>.json`.
  - skill: **delegated** — the editor calls the existing
    `PUT/POST/DELETE /api/skills/:name` (already shipped); library.routes does
    **not** duplicate skill writes.
- **Endpoints:**
  - `PUT /api/library/:kind/:name` — upsert the overlay entry (used for editing
    an existing entry, incl. first-time shadowing of a built-in). 200 `{success,
    kind, name, source:'workspace'}`.
  - `POST /api/library/:kind` — create a new entry; body adds `name`. **409** if
    `name` already exists in **any** source (avoids silent shadowing surprises).
  - `DELETE /api/library/:kind/:name` — remove the overlay entry. **404** if no
    overlay entry exists at that path (a built-in-only entry is read-only →
    nothing to delete). On success, if a built-in of the same name exists the
    next `reload()` reverts to it.

### 4. Book-snapshot write API (the "This Book" scope)
**Files:** `gateway/src/api/routes/books.routes.ts`.

Edit the **active** book's `templates/` (all reads/writes `safePath`-guarded
under `workspace/books/<slug>/templates/`). Operates on the active book only
(slug taken from `getActiveBook()`); 409 if there is no active book.

- `GET /api/books/active/templates/:kind[/:name]` — current snapshot content:
  multi-file kinds return `{files}`, section/pipeline/skill return `{content}`.
- `PUT /api/books/active/templates/:kind[/:name]` — write, same body shapes and
  validation as §3 (pipeline JSON-validated). After write: author/voice →
  `gateway.soul.reload()`; pipeline/genre/sections/skills → no reload (read at
  run-time or not yet wired). Response includes a `wired: boolean` flag so the UI
  can show the "stored, not yet active in generation" note for genre/sections/
  skills.
- `/api/prompts` (legacy) is left untouched for back-compat; the re-pointed
  editor uses the unified endpoints above. (Pre-existing; not deleted.)

### 5. Re-pull API (3-way merge, per asset)
**Files:** `gateway/src/services/book.ts`, `gateway/src/api/routes/books.routes.ts`.

Re-pull resolves three sides per asset: **baseline** (`.baseline/`), **book**
(`templates/`), **library** (`this.library.get(kind,name)`, the
overlay-over-builtin current version named in `pulledFrom`).

- `BookService.repullStatus(slug): RepullAsset[]` — one row per snapshotted asset
  (author, voice, genre?, pipeline, each section, each skill in `pulledFrom`).
  Each row: `{ kind, name, status, libraryPresent, hasBaseline, wired }` where
  `status ∈ 'in-sync' | 'library-updated' | 'locally-edited' | 'diverged' |
  'library-removed' | 'no-baseline'`. Computed by content compare (per file for
  multi-file kinds, aggregated): `locallyEdited = baseline≠book`, `libraryChanged
  = baseline≠library`; `library-removed` when `library.get` is undefined;
  `no-baseline` when `.baseline/` lacks the asset (pre-Phase-4 book).
- `BookService.repull(slug, kind, name, opts): { merged, hadConflicts, files? }`:
  - **Has baseline, text kind:** `mergeText` per file. Write the merged result(s)
    into `templates/`. Advance `.baseline/` for that asset to the **library
    current** version. Update `pulledFrom[kind]` ref (name/source, and
    `version`=`schemaVersion` for pipeline).
  - **Pipeline (JSON):** no line merge. `opts.resolution ∈ 'take-library' |
    'keep-book'`; on `take-library` overwrite `templates/pipeline.json` from
    library + advance baseline + bump `pulledFrom.pipeline.version`; `keep-book`
    is a no-op that only advances baseline (marks "reviewed").
  - **No baseline (fallback):** require `opts.resolution` (`take-library` |
    `keep-book`); `take-library` overwrites templates from library and **creates**
    the asset's baseline from the library version (so subsequent re-pulls are
    3-way); `keep-book` creates the baseline from the current book copy.
  - `hadConflicts` true ⇒ the written file(s) contain conflict markers.
- **Endpoints:**
  - `GET /api/books/active/repull` → `{ assets: RepullAsset[] }`.
  - `POST /api/books/active/repull/:kind/:name?` body `{ resolution? }` →
    `{ merged, hadConflicts }`. After a write to author/voice of the active book
    → `gateway.soul.reload()`.

### 6. Editor UI — re-point `authoring.js` (Approach 1)
**Files:** `dashboard/src/panels/authoring.js`, `dashboard/src/index.html` (markup
for the new selectors if needed), `dashboard/build.mjs` output rebuilt.

- **Scope selector:** `Library` ▸ entry picker (kind → list from `/api/library`)
  / `This Book` ▸ the active book's snapshot (kinds from
  `/api/books/active/templates`).
- **Kind selector:** Author / Voice / Genre / Sections / Skills / Pipeline.
- **Editor:** the existing textarea. Multi-file kinds show a file sub-picker
  (e.g. SOUL.md / PERSONALITY.md). Pipeline opens in a JSON editor that blocks
  Save on invalid JSON (client-side check; server re-validates).
- **Save routing:** Library scope → `PUT /api/library/:kind/:name` (skills →
  existing `/api/skills`); Book scope → `PUT /api/books/active/templates/...`.
- **Create / Delete (library scope):** "New" button → `POST /api/library/:kind`;
  per-entry Delete (overlay only; built-ins show a read-only badge, no delete).
- **Wired note:** book-scope Genre/Sections/Skills show "stored — not yet active
  in generation" (from the `wired` flag).

### 7. Re-pull UI — `books.js`
**Files:** `dashboard/src/panels/books.js`.

- Per book, a **"Re-pull from library"** action → fetch
  `GET /api/books/active/repull` (after activating that book) → render the asset
  table with status badges. Each row: a **Re-pull** button; for pipeline / the
  no-baseline fallback, a keep-mine / take-library choice.
- On `hadConflicts`, surface a notice and open the merged asset in the editor
  (Book scope) for the user to resolve the markers and Save.
- Refresh the table + `refreshActiveBook()` after each re-pull.

---

## Testing

**Unit (`tests/unit/`):**
- `merge.test.ts` (new): clean 3-way merge (disjoint edits) → no conflicts,
  both edits present; overlapping edits → conflict markers + `hadConflicts`;
  identical edits on both sides → no conflict.
- `book-baseline.test.ts` (new): `create()` writes `.baseline/` mirroring
  `templates/`; a successful `repull` advances the asset's baseline to the
  library version; the no-baseline fallback creates a baseline.
- `library-write.test.ts` (new): `PUT` creates a workspace overlay over a
  built-in (source flips to `workspace`); `DELETE` of that overlay reverts to the
  built-in on reload; `DELETE` of a built-in-only name → 404 path (service
  reports "no overlay"); `POST` of an existing name → conflict; name/filename
  guards reject traversal; pipeline `PUT` rejects invalid JSON / missing `steps`.
- `book-repull.test.ts` (new): status classification (in-sync / library-updated /
  locally-edited / diverged / library-removed / no-baseline); a `library-updated`
  asset re-pulls cleanly and `soul` sees the new author/voice after reload; a
  `diverged` asset with overlapping edits returns `hadConflicts` and writes
  markers; pipeline `take-library` overwrites + bumps `pulledFrom.pipeline.version`.
- Extend `active-book.test.ts` / `book.test.ts` only as needed for new accessors.

**feature-smoke (`tests/feature-smoke.sh`):**
- Library write: `PUT /api/library/genre/<tmp>` then `GET` shows `source:workspace`;
  `DELETE` removes it. (Use a throwaway name; clean up.)
- Re-pull round-trip: create a book; edit its **library** author (PUT), then
  `GET /api/books/active/repull` shows `author: library-updated`; `POST` the
  re-pull; assert `hadConflicts:false` and the book's author snapshot now matches.
- Teardown deletes the throwaway book (existing `DELETE /api/books/:slug`).

**Debug:** `tests/feature-smoke.sh -v` already streams the server log; new
assertions reuse it.

**Final step — safety-net review & update (both scripts).** As the last plan
task, re-read **both** end-to-end safety nets — `tests/openrouter-pipeline.sh`
and `tests/feature-smoke.sh` — against the Phase 4 changes and update them to the
latest behavior: new library-write / book-snapshot / re-pull endpoints, the
`.baseline/` directory, the active-book-scoped routes, and any changed response
shapes. Confirm both still exercise a true end-to-end path (real OpenRouter call
for the pipeline script), add the Phase 4 assertions above, and ensure each
cleans up after itself (throwaway library entry + book deleted). Run both against
a deployed build and capture the pass counts. This task gates phase completion.

## Out of scope (unchanged)
- **Generation wiring** for genre / sections / book-skills (still records only).
- **Share / import** (Phase 5) and **backup / recovery** (Phase 6) — `.baseline/`
  exclusion from share/backup is noted for those phases, not built here.
- A dedicated **New-Book component-authoring** page / "book board" UI (library
  CRUD here is the editor surface, not a guided new-book wizard).
- **Hunk-level conflict picker** (three-pane UI) — conflicts resolve via markers
  in the textarea, per decision 4.
- **Version gate enforcement** (decision 6) — informational only.

## Success criteria
- The editor edits a **library** template (overlay over built-in, reverts on
  delete) and the **active book's snapshot**, with the scope clearly selectable;
  built-ins are read-only.
- Creating/deleting library overlay entries works for author/voice/genre/section/
  pipeline (skills via the existing endpoints); pipeline edits are JSON-validated.
- `create()` captures a `.baseline/`; **re-pull** of a library-updated asset
  auto-merges with no conflicts; an asset edited on **both** sides produces
  conflict markers the user resolves in the editor; pipeline re-pull is whole-asset.
- A pre-Phase-4 book (no baseline) re-pulls via keep-mine / take-library and
  gains a baseline for next time.
- `npx tsc --noEmit` clean; unit suite green; feature-smoke green against a
  deployed build with library-write + re-pull assertions and book cleanup.
