# World Repository — Plan Index & Shared Interface Contract

> **For agentic workers:** This is the shared contract for the six World Repository implementation plans. Every plan in this set (`…-phase-1-…` through `…-phase-6-…`) **must** use the exact type names, signatures, file paths, and storage layout defined here. If a plan needs a name not defined here, that is a contract gap — stop and reconcile, do not invent a divergent name.

**Spec:** `docs/superpowers/specs/2026-06-21-world-repository-design.md` (all sections APPROVED).
**Process:** `superpowers:writing-plans` → execution via `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

---

## Plan set (build order)

| Phase | Plan file | Deliverable |
|---|---|---|
| 1 | `2026-06-21-world-repository-phase-1-kind-and-crud.md` | `world` library kind + `world.json` parser + document frontmatter parser + `WorldService` (config + documents CRUD + classification) + `worlds.routes.ts` (documents API). Independently testable: create a world, add/read/update/delete documents, auto-classify. |
| 2 | `2026-06-21-world-repository-phase-2-luminarch-migration.md` | One-time importer that builds the `luminarch-adept` editor asset from `interactive_luminarch_editor.json` and the `shattered-cradle` world from `Luminarch/*.md`. Gives real data to test every later phase. |
| 3 | `2026-06-21-world-repository-phase-3-binding-pull-snapshot.md` | `world` ref on series/book, hybrid relevance-pull (`propose`), curate-and-save (`worldDocs`), snapshot into `templates/world/`, 3-way re-pull, and bible injection via `worldGuide`. |
| 4 | `2026-06-21-world-repository-phase-4-authoring-editor.md` | World-aware editor session: prime the authoring editor with `world.json` format/taxonomy + document catalog; write-back a proposed document into the world overlay (approval-gated, auto-classified). |
| 5 | `2026-06-21-world-repository-phase-5-appendix-render.md` | Per-book `appendix[]` selection + back-matter render into DOCX/EPUB (codes stripped, attribution kept). |
| 6 | `2026-06-21-world-repository-phase-6-ui.md` | Asset Studio `world` repository browser + book panels (World picker, Build-bible-from-world curate panel, Appendix panel). |

Each plan ends in working, independently testable software. Phases 2–6 consume Phase 1's types.

---

## Global Constraints (apply to every task in every plan)

- **Node 22+**; TypeScript runs through `tsx` (no compile step in dev). Type-check with `npx tsc --noEmit`.
- **Imports use `.js` extensions** even from `.ts` source (NodeNext). Match this in every new file.
- **No new runtime dependency** for parsing. Frontmatter is hand-parsed in-repo (see `gateway/src/skills/loader.ts:182`); the world-doc parser follows that line-based idiom, extended for inline `tags: [a, b]` arrays. Do not add `js-yaml`/`gray-matter`.
- **Fail-soft init/runtime.** Services log `  ✓ … / ⚠ … / ℹ …` and degrade rather than crash (matches `index.ts` and `BookService`). A bad `world.json` or bad document frontmatter loads as "needs attention", never throws at boot.
- **`schemaVersion` gating.** `world.json` and each document carry a `schemaVersion`; `WORLD_SCHEMA_VERSION = 1`. Too-new → read-only/quarantine, mirroring `classifyVersion` in `book-types.ts`. Additive optional fields on `book.json` do **not** bump its schema.
- **Commit workflow.** This repo uses a `commit_message` + `./push.sh` workflow — the maintainer commits; **do not run `git commit` / `git push`**. Each task ends at a verified, type-checking state (tests green + `npx tsc --noEmit` clean). At milestone end, write the one-line-summary-plus-dashes `commit_message` per `CLAUDE.md`. (This overrides the writing-plans skill's literal `git commit` step, per user-instruction priority.)
- **Surgical changes.** Touch only what the task requires; match existing style.
- **Docs are professional Markdown, no emojis/icons.**
- **Tests are committed and re-runnable.** Unit tests: `tests/unit/*.test.ts` via `node --import tsx --test` (`npm run test:unit`). Smoke tests: `tests/*.sh` (mirror `tests/board-grouping-smoke.sh`). Both runner styles already exist; the CLAUDE.md "no unit-test suite" line is stale.

---

## Shared types (the contract)

New file **`gateway/src/services/world-types.ts`** (Phase 1 creates it; all phases import from it):

```ts
export const WORLD_SCHEMA_VERSION = 1;

export interface WorldDocumentType {
  id: string;        // e.g. "field-guide" — referenced by document.type
  label: string;     // e.g. "Field Guide"
  note?: string;     // e.g. "practical"
}

/** Per-world config, parsed from worlds/<name>/world.json. */
export interface LibraryWorld {
  schemaVersion: number;
  name: string;                 // dir name; matches ENTRY_NAME_RE
  label?: string;
  description?: string;
  documentTypes: WorldDocumentType[];
  domains: string[];            // e.g. ["GEO","MAG",...]
  clearanceLevels: string[];    // e.g. ["General Access","Restricted","Cloister-Only"]
  classificationScheme: string; // e.g. "{TYPE}-{DOMAIN}-{NNNN}"
  formatDirective: string;      // narrative-only authoring directive
  authoringEditor?: string;     // library editor name (Phase 4)
  stripCodesInAppendix?: boolean; // Phase 5 render setting; default true
}

/** Universal base fields parsed from a document's YAML frontmatter. */
export interface WorldDocMeta {
  title: string;
  type: string;            // must be one of LibraryWorld.documentTypes[].id
  classification: string;  // e.g. "FG-GEO-0141"
  clearance: string;       // should be one of LibraryWorld.clearanceLevels
  domain: string;          // should be one of LibraryWorld.domains
  attribution?: string;
  tags: string[];
  summary: string;
  appendixEligible?: boolean;
}

/** A full document = frontmatter + narrative body, plus its file-stem id. */
export interface WorldDocument {
  docId: string;   // filename stem under documents/, e.g. "fg-geo-0141-geography-…"
  meta: WorldDocMeta;
  body: string;    // markdown after the closing frontmatter fence
}

/** Catalog row used by relevance-pull and the UI (no body — cheap). */
export interface WorldDocCatalogRow {
  docId: string;
  title: string;
  type: string;
  domain: string;
  clearance: string;
  classification: string;
  summary: string;
  tags: string[];
  appendixEligible: boolean;
  needsAttention?: boolean; // set when frontmatter failed to parse cleanly
}
```

### Parser signatures (Phase 1)

New file **`gateway/src/services/world-parse.ts`**:

```ts
export function parseWorldJson(raw: string): LibraryWorld;          // throws on invalid; like parsePipelineJson
export function parseWorldDoc(raw: string): { meta: WorldDocMeta; body: string }; // throws on missing frontmatter / required fields
export function serializeWorldDoc(meta: WorldDocMeta, body: string): string;       // frontmatter + body, round-trips parseWorldDoc
export function nextClassification(scheme: string, type: string, domain: string, existing: string[]): string;
// nextClassification fills {TYPE}-{DOMAIN}-{NNNN} with the next free 4-digit serial
// for that TYPE-DOMAIN pair (TYPE = the documentType.id upper-cased & abbreviated
// per the existing codes; see Phase 1 for the exact derivation), 0-padded to 4.
```

### WorldService (Phase 1 creates; Phases 3/4 extend) — `gateway/src/services/world.ts`

```ts
class WorldService {
  constructor(library: LibraryService, workspaceLibraryDir: string); // reads config via the overlay; writes documents to the workspace overlay
  list(): Array<{ name: string; label?: string; description?: string; source: LibrarySource }>;
  getConfig(name: string): LibraryWorld | undefined;
  listDocuments(name: string): WorldDocCatalogRow[];        // catalog only
  getDocument(name: string, docId: string): WorldDocument | undefined;
  createDocument(name: string, input: { meta: Omit<WorldDocMeta,'classification'> & { classification?: string }; body: string }): WorldDocument; // auto-classify when classification omitted
  updateDocument(name: string, docId: string, input: { meta: WorldDocMeta; body: string }): WorldDocument;
  deleteDocument(name: string, docId: string): boolean;
}
```

### Library wiring (Phase 1)

- `LIBRARY_KINDS` (`gateway/src/services/library-types.ts:8`) gains `'world'`.
- Frontend `LibraryKind` (`frontend/shared/src/types.ts:153`) gains `'world'`.
- `FILE_KINDS` + `DIR_LAYOUT` (`gateway/src/services/library.ts:51`) gain `world: 'worlds'`. **World is the only kind whose entry is a config file (`world.json`) *plus* a `documents/` subdir.** The library overlay loads only `world.json` into `LibraryEntryFull.world`; `WorldService` owns `documents/`. `LibraryEntryFull` (`library.ts`) gains `world?: LibraryWorld`.
- On-disk: `library/worlds/<name>/world.json` (+ `documents/<docId>.md`); overlay at `workspace/library/worlds/<name>/…`.

### Book / series binding (Phase 3)

- `Series.pulledFrom` (`gateway/src/services/series-bible.ts:62`) gains `world?: SeriesRef | null`; `REF_KINDS` (`series.routes.ts:14`) gains `'world'`.
- `BookManifest.pulledFrom` (`book-types.ts:31`) gains `world?: PulledRef | null`.
- **`BookManifest` gains** `worldDocs?: string[]` (curated doc ids = the bible) and `appendix?: Array<{ docId: string; title?: string; order: number }>` (Phase 5). Both additive-optional (no schema bump).
- Snapshot location: `books/<slug>/templates/world/world.json` (config snapshot) + `books/<slug>/templates/world/<docId>.md` (curated docs). `WIRED_KINDS` (`book-types.ts:82`) gains `'world'`.
- New composer `BookService.worldDocsOf(slug: string|null): string | null` — composes `templates/world/*.md` bodies (codes kept, for AI context) into one string. Fed into `buildSystemPrompt`'s existing `worldGuide` param, concatenated with the existing `worldbuildingOf(slug)` output (world repo augments, does not yet replace, the freeform blob).

### Relevance-pull (Phase 3) — on `WorldService`

```ts
proposeWorldDocs(slug: string): Promise<Array<{ docId: string; title: string; rank: number; reason: string }>>;
// gathers book signals (title, description/premise, genre, known chars/places) + the
// world's catalog (title/type/summary/tags only) → one AI call → ranked + reasons.
// Fail-soft: on AI failure returns the full catalog unranked (reason: "manual"), never throws.
```

### API routes (Phase 1 + Phase 3) — `gateway/src/api/routes/worlds.routes.ts`, mounted in `routes.ts` via `mountWorlds(app, gateway, baseDir)`

```
GET    /api/worlds                              # list worlds (config rows)
GET    /api/worlds/:name                        # world.json config
GET    /api/worlds/:name/documents              # catalog (WorldDocCatalogRow[])
GET    /api/worlds/:name/documents/:docId       # full WorldDocument
POST   /api/worlds/:name/documents              # create (+ auto-classify) → WorldDocument
PUT    /api/worlds/:name/documents/:docId       # update
DELETE /api/worlds/:name/documents/:docId       # delete
POST   /api/books/:slug/world/propose           # relevance-pull → ranked + reasons (Phase 3)
PUT    /api/books/:slug/world/docs              # save curated worldDocs → snapshot (Phase 3)
PUT    /api/books/:slug/world/appendix          # save ordered appendix[] (Phase 5)
```

World *config* create/edit rides the existing library API (`POST/PUT /api/library/world[/:name]`); the dedicated routes own documents + book binding/pull/appendix.

---

## Resolved reconciliations (post-drafting — these win on any conflict)

After the six plans were drafted, the following cross-phase ambiguities were resolved here. Where a plan's wording differs, **this section is authoritative**:

1. **Service accessor name = `world` (singular).** Gateway field `public world?: WorldService;`, exposed as `getServices().world` / `services.world` (pinned by Phase 1, `index.ts:192`/`:1288` area). Phase 4's plan text says `this.worlds` / `public worlds!` — read those as `this.world` / `public world` (Phase 4 self-flagged this as a one-token rename). REST *paths* stay plural (`/api/worlds/...`); only the service handle is singular.
2. **`WorldService` constructor takes two args** — `(library: LibraryService, workspaceLibraryDir: string)` — per Phase 1 (`new WorldService(gw.library, join(ROOT_DIR, 'workspace', 'library'))`). The documents write-path needs the workspace dir.
3. **`createDocument` honors a provided `classification`** and auto-assigns the next serial only when `classification` is omitted/empty. This is what lets Phase 2 preserve the existing Luminarch codes (e.g. `FG-GEO-0141`) on import rather than re-numbering them.
4. **API response envelopes** (so Phase 1/3 routes and the Phase 6 client agree): `GET /api/worlds` → `{ worlds: WorldRow[] }`; `GET /api/worlds/:name` → `{ world: LibraryWorld }`; `GET /api/worlds/:name/documents` → `{ documents: WorldDocCatalogRow[] }`; `GET …/:docId` → `{ document: WorldDocument }`; `POST /api/books/:slug/world/propose` → `{ proposals: Array<{docId,title,rank,reason}> }`; `PUT /api/books/:slug/world/docs` → `{ worldDocs: string[] }`; `PUT /api/books/:slug/world/appendix` → `{ appendix: Array<{docId,title?,order}> }`.
5. **Phase 2 import excludes non-document `.md` files** — `CLAUDE.md`, `GEMINI.md`, and any reference/index files that don't match a world-doc header dialect are skipped (only Tomb/Codex/Field-Guide/Observations docs import).

## Deferred (NOT in this plan set — YAGNI)

- Synthesized "bible brief" digest companion (spec §5 optional).
- `memory-search`/FTS indexing of world docs (later optimization; the catalog approach needs no new infra).
- Cloud/zip share of a whole world (Phase-12 transfer already exists for library kinds; world config rides it, but a documents-aware world `.zip` is a follow-up).

These are intentionally out of scope; do not implement them.
