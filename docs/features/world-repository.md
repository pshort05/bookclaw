# The World Repository

## What it is

A **world** is a reusable setting — roughly, the canon behind a whole series. Each world owns a **repository** of structured worldbuilding documents: field guides, geography, factions, magic or technology rules, naming conventions, timelines, character-voice guides, and anything else that defines the place your books live in.

Every world carries its own **format**: the document types it recognizes, the domains it organizes knowledge under (geography, magic, politics, and so on), the clearance levels it labels documents with, and a classification scheme that auto-numbers each document (for example `FG-GEO-0141`). Documents are written in an **authoring editor** that already knows the world's format and existing catalog, and new documents are **auto-classified** — the serial number is assigned for you on save.

A book does not carry the whole world. Instead a book **binds** to a world, and BookClaw runs a **relevance-pull**: an AI librarian reads your book's signals (title, genre, known characters and places) against the world catalog and proposes the subset of documents that actually matter for *this* book. You curate that subset; it becomes the book's **bible** — the worldbuilding rail injected into generation prompts. Selected documents can additionally render as reader-facing **appendixes** in your DOCX and EPUB exports.

## Why it matters

Without a world, every book reinvents its setting and the canon drifts between volumes. The World Repository gives you one authoritative source of truth and then hands each book only the slice it needs:

- **No cross-book leak.** Book 3's curated bible never drags in Book 1's spoilers or unrelated regions — the relevance-pull picks per book.
- **Curated, not dumped.** A 200-document world would blow past any prompt budget. Relevance-pull keeps the injected bible focused (auto-proposals are capped, then you trim).
- **Canon enforcement downstream.** The same world docs seed the consistency auditor's canon, so divergence from the world is caught after writing. See [Continuity and consistency](./continuity-and-consistency.md).
- **Reader payoff.** The documents you already wrote for continuity can ship as polished back-matter appendixes, with the in-world classification codes stripped automatically.

## How to use it

### In the Studio

**Build or edit a world.** Open the Asset Studio and pick the **World** kind in the kind rail. A world entry has two parts:

- The **world config** (`world.json`) — its label, description, document types, domains, clearance levels, classification scheme, the format directive that governs how documents are written, and the name of its authoring editor. Edit this in the world config editor.
- The **documents** — created and edited in the World Document editor, grouped by type with clearance badges. The authoring editor is primed with the world's format and a catalog of existing documents, so drafts follow the house style and you can check continuity before writing. On save, the classification serial is assigned automatically; you never type the number.

**Bind a book to a world.** On a book page, the world bind control lets you **Bind**, **Change**, or **Unbind**. If the book belongs to a series with a default world, that world is pre-selected. Binding runs the relevance-pull and auto-proposes an initial bible.

**Bind at creation.** In the New Book flow, the world picker (series-locked when the book is in a series) lets you choose the world up front. The new book's bible is built as part of creation, so it is ready the moment the book exists. Leave it unset and the book inherits the series' default world if one is configured.

**Curate the bible.** The book drawer's Build-Bible panel shows the relevance-pull proposals — ranked, each with a one-line reason. Add or remove documents, then save. Saving snapshots the chosen documents into the book so the bible is stable even if the world later changes; re-running propose lets you re-pull when the world has grown.

**Choose appendixes.** The book drawer's Appendix panel lets you select which world documents render as reader-facing back-matter and set their order. Appendixes are independent of the bible — a document can be in one, the other, both, or neither.

### Via the API

All routes sit behind the standard bearer auth and IP allowlist (see `docs/SECURITY.md`). The MCP server exposes the same operations as a `world` tool group.

**Browse worlds and documents:**

```
GET    /api/worlds                              # list worlds (name, label, description, source)
GET    /api/worlds/:name                        # one world's config (world.json)
GET    /api/worlds/:name/documents             # document catalog (no bodies — cheap)
GET    /api/worlds/:name/documents/:docId      # one full document (frontmatter + body)
```

**World document CRUD** (documents live in the workspace overlay and are owned by the World service):

```
POST   /api/worlds/:name/documents             # body: { meta, body } — classification auto-assigned if omitted
PUT    /api/worlds/:name/documents/:docId      # body: { meta (with classification), body } — full replacement
DELETE /api/worlds/:name/documents/:docId      # → { deleted: true|false }
```

Note `POST` accepts `meta` without a `classification`; the service derives the next free serial for the document's type and domain. `PUT` is a full replacement, so `meta.classification` is required.

**Creating the world itself** (the `world.json` config and its label/types/domains/scheme) rides the generic Library API for the `world` kind, not these document routes — these routes own only the documents.

**Per-book binding and curation:**

```
PUT    /api/books/:slug/world                  # body: { world } — bind + auto-propose the initial bible
DELETE /api/books/:slug/world                  # unbind: clear the binding + the curated bible
POST   /api/books/:slug/world/propose          # relevance-pull → { proposals: [{ docId, title, rank, reason }] }
PUT    /api/books/:slug/world/docs             # body: { world, docIds } — curate + snapshot the bible
PUT    /api/books/:slug/world/appendix         # body: { appendix: [{ docId, order, title? }] } — set back-matter
```

`propose` requires the book to already be bound (it reads the bound world from the manifest). `world/docs` requires both `world` and `docIds` — sending `docIds` alone returns `400`. `appendix` validates that every entry has a string `docId` and a numeric `order`.

**Binding at creation** is handled by the standard book-create route — pass `world` in the `POST /api/books` body, or omit it to inherit the series' default world. The bind runs **fail-soft** after the book is created: a bind failure logs a warning and never fails creation.

A typical first-time flow:

```bash
# 1. Bind an existing book (auto-proposes a capped initial bible)
curl -X PUT .../api/books/my-book/world -d '{"world":"shattered-cradle"}'

# 2. Re-run the relevance-pull to review proposals
curl -X POST .../api/books/my-book/world/propose

# 3. Curate: keep only the docs you want, snapshotted as the bible
curl -X PUT .../api/books/my-book/world/docs \
  -d '{"world":"shattered-cradle","docIds":["fg-geo-0141-...","fg-mag-0007-..."]}'

# 4. Pick reader-facing appendixes
curl -X PUT .../api/books/my-book/world/appendix \
  -d '{"appendix":[{"docId":"fg-geo-0141-...","order":1}]}'
```

## Under the hood

**World config and document types**
- `gateway/src/services/world-types.ts` — the shared contract: `LibraryWorld` (config), `WorldDocMeta`/`WorldDocument` (a document), `WorldDocCatalogRow` (a cheap catalog row), `WORLD_SCHEMA_VERSION`.

**The World service**
- `gateway/src/services/world.ts` — `WorldService`: config read-through via the Library overlay, document CRUD with auto-classification, and the `proposeWorldDocs` relevance-pull. Documents live only in the workspace overlay at `workspace/library/worlds/<name>/documents/<docId>.md`. Bad frontmatter is reported as `needsAttention` in the catalog rather than throwing (fail-soft).
- `gateway/src/services/world-parse.ts` — the hand-rolled frontmatter parser/serializer and `nextClassification` (monotonic max+1 serials).

**Relevance-pull**
- `proposeWorldDocs` (in `world.ts`) sends the book's signals plus the catalog (titles, types, summaries, tags — never document bodies) to one mid-tier AI call and maps the ranked `docId`s back to the catalog. On any AI or JSON failure it returns the full catalog unranked with reason `manual` — it never throws.

**Binding and the bible**
- `gateway/src/api/routes/world-bind.ts` — `bindBookWorld` orchestrates relevance-pull → cap at `AUTO_PROPOSE_CAP` (15) → snapshot as the initial bible; `unbindBookWorld` clears it. The snapshot atomically sets `pulledFrom.world` and `worldDocs` on the book manifest.
- `gateway/src/services/book.ts` — `snapshotWorldDocs` writes the curated docs into the book's `templates/world/` (plus a `.baseline` mirror for 3-way re-pull); `clearWorld` tears the binding down; `setAppendix` records the back-matter selection. The snapshotted `worldDocs` are composed into the `worldGuide` rail of the generation system prompt.

**Authoring editor**
- `gateway/src/services/world-authoring.ts` — pure helpers that make an editor session world-aware: `composeWorldAuthoringContext` (format directive + taxonomy + a capped catalog as priming), `worldForAuthoringEditor` (which world a given editor belongs to), and `proposedDocToCreateInput` (maps a reviewed draft into the create payload, leaving the classification for the service to assign). A world names its editor via `world.json`'s `authoringEditor`, defaulting to the generic built-in `world-author`.

**Appendix render**
- `gateway/src/services/world-appendix.ts` — `resolveBookAppendix` orders the manifest's appendix entries and resolves each from the book snapshot first, then the live world, enforcing `appendixEligible` and failing soft per entry; `stripAppendixCodes` removes in-world Classification/Distribution/Access-Level/Clearance header lines (kept by default; controlled by the world's `stripCodesInAppendix`) while preserving the attribution line. The resolved entries render as DOCX and EPUB back-matter through the documents compile/export route.

**Routes**
- `gateway/src/api/routes/worlds.routes.ts` — every endpoint listed above.
- `gateway/src/api/routes/books.routes.ts` — the create-time bind (resolves `body.world` then the series default, fail-soft).

**Design specs**
- `docs/superpowers/specs/2026-06-21-world-repository-design.md` — the repository, format, authoring editor, relevance-pull, and appendix render.
- `docs/superpowers/specs/2026-06-22-world-binding-design.md` — the per-book binding and bible-wiring decisions (series default with per-book override; world docs and the legacy series worldbuilding blob coexist as complementary layers; auto-propose on bind).

## Related

- [Series](./series.md) — a series can declare a default world that its books inherit at creation.
- [Continuity and consistency](./continuity-and-consistency.md) — world documents seed the consistency auditor's canon, so writing that diverges from the world is flagged.
- [Publishing and launch](./publishing-and-launch.md) — selected world documents render as reader-facing appendixes in DOCX and EPUB exports.
