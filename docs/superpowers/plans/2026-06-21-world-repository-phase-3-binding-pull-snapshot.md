# World Repository Phase 3 — Binding, Relevance-Pull, Snapshot, and Bible Injection

> **For agentic workers:** This plan implements Phase 3 of the World Repository set. It **must** use the exact type names, signatures, file paths, and storage layout from the SHARED CONTRACT (`docs/superpowers/plans/2026-06-21-world-repository-00-index-and-contract.md`). If a name you need is not defined there or here, that is a contract gap — stop and reconcile, do not invent a divergent name. Scope is spec §5 "Section 2 — Binding + relevance-pull + snapshot" (`docs/superpowers/specs/2026-06-21-world-repository-design.md`). **Depends on Phase 1** (`WorldService.listDocuments`/`getDocument`/`getConfig`, `LibraryWorld`, `world-types.ts`); benefits from Phase 2 data (the `shattered-cradle` world) but does not require it for unit tests, which seed their own tiny world.

## Goal

Bind a `world` to a series/book; let the owner build a book's "bible" by a hybrid relevance-pull (AI proposes ranked docs + one-line reasons → owner curates → curated `worldDocs` saved on the book); snapshot the curated docs into `books/<slug>/templates/world/`; extend the 3-way re-pull engine to world docs; and inject the curated bible into prompts through the existing `worldGuide` rail (augmenting, not replacing, today's `worldbuildingOf` blob).

## Architecture

- **Binding** rides the existing ref machinery. `world` joins `REF_KINDS` on the series API and `Series.pulledFrom`; `BookManifest.pulledFrom.world` records the binding; `BookManifest.worldDocs?: string[]` records the curated bible (additive-optional — **no schema bump**, per the contract).
- **Snapshot** reuses `BookService.create()`'s `templates/<kind>/…` + `.baseline` copy idiom. Because curated docs are usually chosen *after* creation (via propose/curate), the world snapshot writer is reusable: it runs from `PUT /api/books/:slug/world/docs`, not only at create. Layout: `templates/world/world.json` (config snapshot) + `templates/world/<docId>.md` (curated docs, frontmatter + body, via `serializeWorldDoc`).
- **Relevance-pull** is one task-typed AI call on `WorldService.proposeWorldDocs(slug)`, mirroring the existing `aiComplete`/`aiSelect` injection pattern (`index.ts:1461-1462`, `contextEngine.runContinuityCheck`). Book signals + the world catalog (title/type/summary/tags only) → JSON `[{docId, rank, reason}]`. Fail-soft: on any AI/parse failure return the full catalog unranked, reason `"manual"`, never throw (contract + spec §8).
- **Re-pull** treats world docs as a text asset kind: `assetsOf`/`repullStatus`/`repull` gain `'world'`, 3-way merging each snapshotted `<docId>.md` against its `.baseline` and the current library document (reusing `mergeText`).
- **Injection** adds `BookService.worldDocsOf(slug)` (composes `templates/world/*.md` bodies) and concatenates it with `worldbuildingOf(slug)` at the single `worldGuide` call site in `index.ts` (lines 664-666). `WIRED_KINDS` gains `'world'`.

## Tech Stack

- Node 22+, TypeScript via `tsx` (no dev compile). Type-check: `npx tsc --noEmit`.
- `.js` import extensions from `.ts` source (NodeNext).
- No new runtime dependency. World-doc (de)serialization reuses Phase 1's `serializeWorldDoc`/`parseWorldDoc` in `world-parse.ts`. AI access via the existing `AIRouter.complete` injected as a function (no new client).
- Unit tests: `tests/unit/*.test.ts` via `node --import tsx --test` (`npm run test:unit`). Smoke: `tests/world-bible-smoke.sh` (mirrors `tests/board-grouping-smoke.sh`).

## Global Constraints (apply to every task — verbatim from the contract)

- **Node 22+**; TypeScript runs through `tsx` (no compile step in dev). Type-check with `npx tsc --noEmit`.
- **Imports use `.js` extensions** even from `.ts` source (NodeNext). Match this in every new file.
- **No new runtime dependency** for parsing. Frontmatter is hand-parsed in-repo (see `gateway/src/skills/loader.ts:182`); the world-doc parser follows that line-based idiom, extended for inline `tags: [a, b]` arrays. Do not add `js-yaml`/`gray-matter`.
- **Fail-soft init/runtime.** Services log `  ✓ … / ⚠ … / ℹ …` and degrade rather than crash (matches `index.ts` and `BookService`). A bad `world.json` or bad document frontmatter loads as "needs attention", never throws at boot.
- **`schemaVersion` gating.** `world.json` and each document carry a `schemaVersion`; `WORLD_SCHEMA_VERSION = 1`. Too-new → read-only/quarantine, mirroring `classifyVersion` in `book-types.ts`. Additive optional fields on `book.json` do **not** bump its schema.
- **Commit workflow.** This repo uses a `commit_message` + `./push.sh` workflow — the maintainer commits; **do not run `git commit` / `git push`**. Each task ends at a verified, type-checking state (tests green + `npx tsc --noEmit` clean). At milestone end, write the one-line-summary-plus-dashes `commit_message` per `CLAUDE.md`. (This overrides the writing-plans skill's literal `git commit` step, per user-instruction priority.)
- **Surgical changes.** Touch only what the task requires; match existing style.
- **Docs are professional Markdown, no emojis/icons.**
- **Tests are committed and re-runnable.** Unit tests: `tests/unit/*.test.ts` via `node --import tsx --test` (`npm run test:unit`). Smoke tests: `tests/*.sh` (mirror `tests/board-grouping-smoke.sh`). Both runner styles already exist; the CLAUDE.md "no unit-test suite" line is stale.

## File Structure

```
gateway/src/services/book-types.ts        # MODIFY: PulledRef on world; BookManifest.pulledFrom.world + worldDocs; RepullAsset kind; WIRED_KINDS
gateway/src/services/book.ts              # MODIFY: snapshotWorldDocs(); worldDocsOf(); assetsOf/repullStatus/repull world support; world helpers
gateway/src/services/series-bible.ts      # MODIFY: Series.pulledFrom.world?: SeriesRef|null
gateway/src/services/world.ts             # MODIFY (Phase 1 file): add proposeWorldDocs(); accept injected AI fns
gateway/src/api/routes/series.routes.ts   # MODIFY: REF_KINDS gains 'world'
gateway/src/api/routes/worlds.routes.ts   # MODIFY (Phase 1 file): POST /world/propose, PUT /world/docs
gateway/src/index.ts                      # MODIFY: concatenate worldDocsOf into worldGuide; wire proposeWorldDocs AI fns
tests/unit/world-binding.test.ts          # NEW: worldDocsOf composition + worldGuide concat + snapshot + re-pull merge
tests/unit/world-propose.test.ts          # NEW: proposeWorldDocs shaping with a fake router (ranking/reasons + fail-soft)
tests/world-bible-smoke.sh                # NEW: seed world+book, propose, save curated, assert snapshot + bible composes
```

---

### Task 1: Binding types — `world` ref on series/book + manifest `worldDocs`

**Files:** `gateway/src/services/book-types.ts`, `gateway/src/services/series-bible.ts`, `gateway/src/api/routes/series.routes.ts`

**Interfaces**

Consumes: `PulledRef`, `BookManifest`, `RepullAsset`, `WIRED_KINDS` (existing, `book-types.ts`); `SeriesRef`, `Series` (existing, `series-bible.ts`); `REF_KINDS` (existing, `series.routes.ts:14`).

Produces (exact shapes):
```ts
// book-types.ts — BookManifest.pulledFrom gains:
world?: PulledRef | null;        // the bound world (name/source), null when unbound
// book-types.ts — BookManifest gains (top-level, additive-optional, NO schema bump):
worldDocs?: string[];            // curated doc ids = the bible
// book-types.ts — RepullAsset.kind union gains 'world':
kind: 'author' | 'voice' | 'genre' | 'pipeline' | 'section' | 'skill' | 'world';
// book-types.ts — WIRED_KINDS gains 'world':
new Set(['author','voice','pipeline','worldbuilding','section','skill','world'])
// series-bible.ts — Series.pulledFrom gains:
world?: SeriesRef | null;
// series.routes.ts — REF_KINDS gains 'world':
const REF_KINDS = ['author','voice','genre','pipeline','world'] as const;
```

**Steps**

- [ ] Write a failing unit test `tests/unit/world-binding.test.ts` asserting that a `BookManifest` literal with `pulledFrom.world` and a top-level `worldDocs: string[]` type-checks, and that `WIRED_KINDS.has('world') === true` and a `RepullAsset` with `kind: 'world'` type-checks. Run `npx tsc --noEmit` → FAIL (the fields/union member don't exist yet).
- [ ] Add `world?: PulledRef | null` to `BookManifest.pulledFrom`, `worldDocs?: string[]` to `BookManifest`, `'world'` to the `RepullAsset['kind']` union (in `book.ts` — confirm where `RepullAsset` is declared; per `book.ts:50` the union literal lives there, so widen it there and keep `book-types.ts` in sync if a mirror exists), and `'world'` to `WIRED_KINDS`. **Do not** bump `BOOK_SCHEMA_VERSION` (additive-optional).
- [ ] Add `world?: SeriesRef | null` to `Series.pulledFrom` in `series-bible.ts`.
- [ ] Add `'world'` to `REF_KINDS` in `series.routes.ts` (the `resolveRef`/`setRefs` loop is generic over `REF_KINDS`, so binding-via-`PUT /api/series/:id/refs` works with no other change — confirm by reading the loop at lines 54-60).
- [ ] Run the unit test → PASS. Run `npx tsc --noEmit` → clean.

---

### Task 2: `worldDocsOf` composition + `worldGuide` injection

**Files:** `gateway/src/services/book.ts`, `gateway/src/index.ts`

**Interfaces**

Consumes: `BookService.bookDir` (private), `worldbuildingOf(slug)` (existing, `book.ts:758`), the `worldGuide` rail in `index.ts` (lines 664-666 build it; line 700 passes it; `buildSystemPrompt` injects it at lines 1069-1073).

Produces:
```ts
// book.ts
worldDocsOf(slug: string | null): string | null;
// composes templates/world/*.md BODIES (codes kept, for AI context) into one
// string. Each doc under a "## World Document — <title>" header (title from the
// snapshotted frontmatter via parseWorldDoc; fall back to the docId stem when
// frontmatter is unparseable — fail-soft, never throw). Skips world.json.
// Alphabetical by docId. Reads fresh each call. Null when slug null/invalid, no
// templates/world dir, or no non-empty doc bodies.
getActiveWorldDocs(): string | null;   // worldDocsOf(this.activeBookSlug)
```

**Steps**

- [ ] In `world-binding.test.ts` add a failing test: seed a temp book dir with `templates/world/world.json` + two doc files (frontmatter + body, written with Phase 1's `serializeWorldDoc`), call `svc.worldDocsOf(slug)`, assert the result contains both bodies under `## World Document — <title>` headers in docId order and does NOT contain the `world.json` content. Run → FAIL (method missing).
- [ ] Implement `worldDocsOf` in `book.ts`, modeled on `worldbuildingOf` (`book.ts:758`): read `templates/world`, filter `*.md` (exclude any non-`.md`), sort by name, for each file `parseWorldDoc` the content to get `meta.title` + `body` (wrap in try/catch — on parse failure use the filename stem as the title and the raw file content as the body), skip empty bodies, join under headers. Add `getActiveWorldDocs()` mirroring `getActiveWorldbuilding()` (`book.ts:790`). Import `parseWorldDoc` from `./world-parse.js`.
- [ ] Run the test → PASS.
- [ ] In `world-binding.test.ts` add a failing test for the concatenation contract: a helper that mimics the `index.ts` worldGuide assembly — given `worldbuildingOf(slug)` (non-null) and `worldDocsOf(slug)` (non-null), the combined `worldGuide` contains BOTH blocks (worldbuilding first, world docs second), separated by a blank line; when one is null the other passes through unchanged; when both null the result is null/undefined. Run → FAIL.
- [ ] Edit `index.ts` lines 664-666: build `worldGuide` by combining the two sources. Replace the `overrideSlug ? worldbuildingOf : getActiveWorldbuilding` ternary with a small inline join, e.g.:
  ```ts
  const wbGuide = overrideSlug
    ? (this.books?.worldbuildingOf(overrideSlug) ?? undefined)
    : (this.books?.getActiveWorldbuilding() ?? undefined);
  const wdGuide = overrideSlug
    ? (this.books?.worldDocsOf(overrideSlug) ?? undefined)
    : (this.books?.getActiveWorldDocs() ?? undefined);
  const worldGuide = [wbGuide, wdGuide].filter(Boolean).join('\n\n') || undefined;
  ```
  Keep the existing `buildSystemPrompt({ … worldGuide … })` call (line 700) and the `# Active Book — World-Building` injection (lines 1069-1073) unchanged — world docs flow through the same rail.
- [ ] Run the concatenation test → PASS. Run `npx tsc --noEmit` → clean.

---

### Task 3: World-doc snapshot writer (`snapshotWorldDocs`) + `PUT /world/docs`

**Files:** `gateway/src/services/book.ts`, `gateway/src/api/routes/worlds.routes.ts`

**Interfaces**

Consumes: `WorldService.getConfig(name)`, `WorldService.getDocument(name, docId)` (Phase 1); `serializeWorldDoc(meta, body)` (Phase 1, `world-parse.ts`); `BookService.bookDir`, `assertWritable`, the `.baseline` cp idiom (`book.ts:305`); `services.books.exists(slug)`, `SLUG_RE` (`series.routes.ts` patterns).

Produces:
```ts
// book.ts — writes the curated bible snapshot for a book.
async snapshotWorldDocs(
  slug: string,
  world: { name: string; source: PulledRef['source'] },
  docIds: string[],
  getConfigRaw: (name: string) => string | null,             // serialized world.json for the snapshot
  getDocSerialized: (name: string, docId: string) => string | null, // serialized <docId>.md (frontmatter+body)
): Promise<{ written: string[]; missing: string[] }>;
// 1) assertWritable(slug). 2) rm + recreate templates/world. 3) write world.json
//    (getConfigRaw) + one <docId>.md per resolved doc (getDocSerialized; skip &
//    collect missing). 4) cp templates/world -> .baseline/world (re-pull baseline).
//    5) set manifest.pulledFrom.world + manifest.worldDocs=written, append history.
```
Route:
```
PUT /api/books/:slug/world/docs   body { world: string, docIds: string[] }
  -> 200 { worldDocs: string[], missing: string[] }
  -> 400 invalid slug/body; 404 unknown book or unknown world; 503 service down
```

**Steps**

- [ ] In `world-binding.test.ts` add a failing test: seed a library world (via `WorldService` from Phase 1) with two documents, create a book, call `svc.snapshotWorldDocs(slug, {name,source}, [docIdA, docIdB], cfgFn, docFn)`; assert `templates/world/world.json` and `templates/world/<docIdA>.md` exist, `.baseline/world/<docIdA>.md` mirrors templates, `book.json` has `pulledFrom.world.name` and `worldDocs == [docIdA, docIdB]`, and a missing docId is returned in `missing` (not written). Run → FAIL.
- [ ] Implement `snapshotWorldDocs` in `book.ts` next to `worldDocsOf`. Use `rm(worldDir, { recursive, force })` then `mkdir` so re-saving a curated set is idempotent (mirrors how a fresh snapshot should fully replace the prior bible). After writing `templates/world`, `cp(templates/world, .baseline/world, { recursive: true })`. Then read-modify-write `book.json` setting `pulledFrom.world` and `worldDocs`, appending a `history` entry `{ at, event: 'world-pull', detail: written.join(',') }`. Call `assertWritable(slug)` first (schemaVersion gate, matching `repull`).
- [ ] Run the snapshot test → PASS.
- [ ] Add `PUT /api/books/:slug/world/docs` to `worlds.routes.ts`. Validate `SLUG_RE.test(slug)`, `services.books?.exists?.(slug)`, `typeof world === 'string'` + `services.worlds?.getConfig(world)`, and `Array.isArray(docIds)` of strings (match the validation style in `series.routes.ts`). Resolve the world's library `source` via `services.library?.get?.('world', world)?.source ?? 'workspace'`. Build the two closures from `WorldService`: `getConfigRaw = (n) => services.worlds.getConfigRaw(n)` (a thin Phase-1 accessor returning the raw `world.json` string — if Phase 1 only exposes `getConfig`, re-serialize with `JSON.stringify(getConfig(n), null, 2)`), and `getDocSerialized = (n, id) => { const d = services.worlds.getDocument(n, id); return d ? serializeWorldDoc(d.meta, d.body) : null; }`. Call `snapshotWorldDocs` and return `{ worldDocs, missing }`. Confirmation-gating is **not** required (internal, reversible — per the prompt).
- [ ] Run `npx tsc --noEmit` → clean.

---

### Task 4: Re-pull support for world docs (3-way merge)

**Files:** `gateway/src/services/book.ts`

**Interfaces**

Consumes: `assetsOf` (`book.ts:1137`), `repullStatus` (`book.ts:1152`), `repull` (`book.ts:1193`), `libraryFiles`/`assetRel`/`assetFileName`/`readAssetFrom`/`updatePulledFrom` (private helpers, `book.ts:1082-1133`), `mergeText` (`merge.ts:23`), `WorldService.getDocument` (for the library side).

Produces: world docs participate as a text asset kind. `assetsOf` emits one `{ kind: 'world', name: <docId> }` per `manifest.worldDocs[]`; the private file helpers map `'world'` to `templates/world/<docId>.md`; `repull(slug, 'world', docId, opts)` 3-way merges that single file against `.baseline/world/<docId>.md` and the library document.

**Steps**

- [ ] In `world-binding.test.ts` add a failing re-pull test: seed a library world + doc, snapshot it onto a book (Task 3), then (a) edit the book's `templates/world/<docId>.md` body (local edit), (b) edit the library document body via `WorldService.updateDocument` (library change), call `svc.repullStatus(slug)` and assert the world asset shows `'diverged'`; then call `svc.repull(slug, 'world', docId, {})` and assert the merged file in `templates/world/` contains BOTH edits and `.baseline/world/<docId>.md` advanced to the library version. Run → FAIL.
- [ ] Extend `libraryFiles` (`book.ts:1082`): for `kind === 'world'`, return `{ [`${name}.md`]: serializeWorldDoc(doc.meta, doc.body) }` by reading the library document via the world service. **Constraint:** `libraryFiles` currently depends only on `this.library`; the world's documents live in `WorldService`, not the library overlay. Wire a `WorldService` reference into `BookService` via a setter (`setWorldService(w)`, matching the existing setter-injection pattern called out in `CLAUDE.md`) and read documents through it. If the world service is absent (fail-soft), return `null` so the asset classifies `library-removed` rather than throwing.
- [ ] Extend `assetRel` → `kind === 'world'` returns `'world'`; `assetFileName` → `kind === 'world'` returns `${name}.md` (the docId); `readAssetFrom` → `kind === 'world'` reads `join(base, root, 'world', `${name}.md`)`. Mirror the `section` branches exactly (single-file text asset).
- [ ] Extend `assetsOf` (`book.ts:1137`): after sections/skills, `for (const id of opened.manifest.worldDocs || []) out.push({ kind: 'world', name: id });`.
- [ ] Confirm `repull`'s text-merge branch (`book.ts:1233`) already handles `'world'` once the helpers map it (it is generic over the file map). No change needed there beyond the helper mappings; `updatePulledFrom` for `'world'` should refresh `pulledFrom.world` provenance (read it — if it is keyed by `kind`, ensure the `'world'` case updates `pulledFrom.world`, not a `worldDocs` entry; the per-doc identity stays in `worldDocs`).
- [ ] Run the re-pull test → PASS. Run `npx tsc --noEmit` → clean.

---

### Task 5: `proposeWorldDocs` — hybrid relevance-pull with a fake-router unit test

**Files:** `gateway/src/services/world.ts`, `gateway/src/api/routes/worlds.routes.ts`, `gateway/src/index.ts`

**Interfaces**

Consumes: `WorldService.listDocuments(name)` (Phase 1, returns `WorldDocCatalogRow[]`); book signals — `BookService` accessors `bookDir`/manifest title, `genreGuideOf(slug)`, `worldbuildingOf(slug)` (known chars/places), and the bound world from `manifest.pulledFrom.world`; the AI router via injected functions mirroring `index.ts:1461-1462` (`aiComplete = (req) => aiRouter.complete(req)`, `aiSelect = (taskType) => aiRouter.selectProvider(taskType)`).

Produces (exact contract signature):
```ts
// world.ts
proposeWorldDocs(
  slug: string,
  signals: { title: string; description?: string; genre?: string|null; knownEntities?: string },
  worldName: string,
  ai: {
    complete: (req: { provider: string; system: string; messages: Array<{role:'user'|'assistant';content:string}>; maxTokens?: number }) => Promise<{ content: string }>,
    select: (taskType: string) => { id: string },
  },
): Promise<Array<{ docId: string; title: string; rank: number; reason: string }>>;
// Builds: book signals + the world catalog (per doc: docId/title/type/summary/tags
// ONLY — no bodies) -> ONE AI call (taskType e.g. 'analysis') -> parse JSON
// [{docId, rank, reason}], map to docId/title/rank/reason against the catalog
// (drop ids not in the catalog; default reason '' -> 'manual' if blank).
// FAIL-SOFT: on AI failure OR unparseable/empty JSON, return the FULL catalog
// unranked (rank = index order) with reason 'manual'. NEVER throws.
```
Route:
```
POST /api/books/:slug/world/propose   -> 200 { proposed: Array<{docId,title,rank,reason}> }
  -> 404 unknown book or book has no bound world; 503 world/ai service down
```

**Steps**

- [ ] Write a failing unit test `tests/unit/world-propose.test.ts` with a FAKE router: `ai.complete` returns canned JSON `'[{"docId":"d2","rank":1,"reason":"central conflict"},{"docId":"d1","rank":2,"reason":"setting"}]'` and `ai.select` returns `{ id: 'ollama' }`. Seed a `WorldService` over a temp library world with docs `d1`,`d2`,`d3`. Assert `proposeWorldDocs(...)` returns the two mapped rows in rank order with their reasons, that each row's `title` comes from the catalog, and that `d3` (not proposed) is absent. Run → FAIL.
- [ ] Add a second failing assertion in the same test: a fake `ai.complete` that **rejects** (throws), and a separate one that returns garbage (`'not json'`). Assert both fall back to the FULL catalog (`d1,d2,d3`), each with `reason === 'manual'`, ranked by catalog order, and that **no exception escapes**. Run → FAIL.
- [ ] Implement `proposeWorldDocs` in `world.ts`. Build the system prompt: the world's `formatDirective`/`documentTypes` are not needed here; include the book signals (title/description/genre/knownEntities) and a compact catalog list (docId · title · type · summary · tags). Instruct the model to return ONLY a JSON array `[{docId, rank, reason}]` of the relevant docs. Call `ai.select('analysis')` (or an existing analysis-class taskType — confirm a real `TASK_TIERS` key in `router.ts`; do not invent one) → `provider.id`, then `ai.complete({ provider, system, messages:[{role:'user',content:'…'}], maxTokens })`. Parse defensively (strip code fences if present, `JSON.parse` in try/catch). Map against `listDocuments(worldName)` by `docId`. On any failure path, return the catalog-order fallback with `reason:'manual'`. Log a `  ⚠ World: relevance-pull fell back to manual (…)` on the fail-soft path.
- [ ] Run `world-propose.test.ts` → PASS (both the happy path and both fail-soft paths).
- [ ] Add `POST /api/books/:slug/world/propose` to `worlds.routes.ts`. Validate `SLUG_RE` + `services.books?.exists?.(slug)`; read the bound world from the book manifest (`services.books.open(slug)` → `pulledFrom.world.name`); 404 when unbound. Gather signals: title from the manifest, `description` from the book/project premise if available (else `''`), `genre` via `services.books.genreGuideOf(slug)` (or the manifest genre name), `knownEntities` via `services.books.worldbuildingOf(slug)`. Build the `ai` object as `{ complete: (req) => gateway.aiRouter.complete(req), select: (t) => gateway.aiRouter.selectProvider(t) }` (the `index.ts:1461-1462` idiom). Call `proposeWorldDocs` and return `{ proposed }`.
- [ ] Run `npx tsc --noEmit` → clean.

---

### Task 6: Smoke test — seed → propose → curate → snapshot → bible composes

**Files:** `tests/world-bible-smoke.sh`

**Interfaces**

Consumes (HTTP, mirroring `tests/board-grouping-smoke.sh`): `POST /api/library/world` (Phase 1 — create the world config), `POST /api/worlds/:name/documents` (Phase 1 — add docs), `POST /api/books` (create the book), `PUT /api/books/:slug/world/docs` (save curated), `POST /api/books/:slug/world/propose` (relevance-pull), and a read path that proves the bible composes (`GET /api/books/:slug/templates/world` or the existing template-read route — confirm the exact path from `worlds.routes.ts`/`books.routes.ts`; assert the snapshot files exist).

Produces: a runnable, leave-in-place smoke (REPORT, like board-grouping). Title prefix `World Bible Smoke` for idempotent cleanup; `CLEANUP=1` removes the seeded world + book.

**Steps**

- [ ] Write `tests/world-bible-smoke.sh` copying the board-grouping harness preamble verbatim (BASE_URL/token resolution, `pass`/`fail`/`code`/`req`/`jget`, the clean-by-prefix idiom). Make it executable (`chmod +x`).
- [ ] Seed: create a tiny world (`world-bible-smoke`) with 3 documents (POST the `world.json` config via the library API, then POST 3 `documents`), then create a book bound to that world. Assert each step's HTTP code.
- [ ] Call `POST /api/books/:slug/world/propose` (cheap real LLM — the gate is fail-soft, so accept either a ranked array or the `manual` fallback; assert `200` + a non-empty `proposed` array). Then `PUT /api/books/:slug/world/docs` with two of the three docIds; assert `200` and `worldDocs.length == 2`.
- [ ] Assert the snapshot exists and the bible composes: assert the two curated docs are present in the book's `templates/world` snapshot (via the template-read route) and absent doc is not; print the world-guide-relevant assertions. Leave the world + book on disk; print the `CLEANUP=1` hint. `exit "$FAILS"`.
- [ ] Run the smoke against a live instance (local `http://localhost:3847` or Neptune `http://192.168.1.28:3947`) and confirm it passes. Run `npx tsc --noEmit` once more (no TS touched here, but verify the tree is clean).

---

## Self-Review

**Contract conformance.** Every new name traces to the shared contract: `BookManifest.pulledFrom.world: PulledRef|null` and `BookManifest.worldDocs?: string[]` (contract "Book/series binding"), `Series.pulledFrom.world?: SeriesRef|null` + `REF_KINDS` += `'world'` (same), `WIRED_KINDS` += `'world'`, snapshot at `books/<slug>/templates/world/world.json` + `<docId>.md`, `BookService.worldDocsOf(slug): string|null` fed into the existing `worldGuide` param concatenated with `worldbuildingOf` (contract "New composer"), and `proposeWorldDocs` with the contract's exact fail-soft semantics and return shape. API routes are the two contract-listed Phase-3 endpoints (`POST /world/propose`, `PUT /world/docs`) in the Phase-1 `worlds.routes.ts`. The contract's `proposeWorldDocs(slug)` single-arg shape is realized by gathering signals in the route and passing them in (the service stays testable with injected AI + signals); the route-level call still presents as "propose for this slug", so the owner-facing contract holds.

**Scope discipline.** No appendix (Phase 5), no UI (Phase 6), no authoring write-back (Phase 4), no "bible brief" digest, no FTS — all explicitly deferred. World docs *augment* `worldbuildingOf`, they do not replace it (spec §5: "augmenting (eventually replacing)"). No `BOOK_SCHEMA_VERSION` bump (additive-optional fields).

**Fail-soft.** `proposeWorldDocs` never throws — AI/parse failure → full catalog, reason `manual` (unit-tested on both the reject and garbage-JSON paths). `worldDocsOf` swallows per-file parse errors (filename-stem title fallback). `snapshotWorldDocs` collects `missing` docIds instead of failing. Re-pull `libraryFiles` returns `null` when the world service is absent → `library-removed`, not a crash. `assertWritable` keeps the schemaVersion gate on the snapshot write, matching `repull`/`setPhase`.

**TDD + verification.** Each task is failing-test → FAIL → implement → PASS → `npx tsc --noEmit`. Unit coverage: `worldDocsOf` composition, `worldGuide` concatenation, `snapshotWorldDocs` (+ baseline + manifest + missing), 3-way re-pull merge of a world doc, and `proposeWorldDocs` shaping with a fake/stubbed router (happy + two fail-soft paths). A leave-in-place smoke mirrors `board-grouping-smoke.sh` end to end.

**Risks / things to confirm during implementation (read, don't assume):** (1) Where exactly `RepullAsset['kind']` is declared (`book.ts:50` vs a `book-types.ts` mirror) — widen the single source of truth. (2) The exact `WorldService` accessor surface from Phase 1 (`getConfig` vs a raw `getConfigRaw`; `listDocuments` row fields) — adapt the route closures to whatever Phase 1 actually exposes, re-serializing if no raw accessor exists. (3) The real analysis-class `taskType` key in `router.ts` `TASK_TIERS` — use an existing one, do not invent. (4) The exact template-read route the smoke asserts against — confirm from `worlds.routes.ts`/`books.routes.ts`. (5) `updatePulledFrom`'s per-kind behavior for `'world'` — ensure it refreshes `pulledFrom.world`, not a `worldDocs` member. (6) `BookService` gaining a `WorldService` reference (setter injection) is the one new cross-service wire; keep it optional/fail-soft so unit tests that don't need re-pull can omit it.
