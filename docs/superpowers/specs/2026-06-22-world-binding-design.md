# World Binding + Per-Book Bible Wiring — Design Spec

**Date:** 2026-06-22
**Status:** Approved (design). Next: implementation plan via `superpowers:writing-plans`.
**Feature-tracking:** `docs/TODO.md` → "World binding + per-book bible wiring" (under the ★ World Repository section).
**Builds on:** `docs/superpowers/specs/2026-06-21-world-repository-design.md` (World Repository Phases 1–6, all implemented).

## Problem

The World Repository ships a complete per-book curation **engine** — each book manifest carries its own `worldDocs` (the curated bible), `snapshotWorldDocs` binds a world + snapshots the chosen docs into `templates/world/` (with a `.baseline/` for 3-way re-pull), per-book appendix selection exists, and the curated docs inject into prompts via `worldGuide`. So **different world documents per book within one series is architecturally supported.**

But the **binding wiring is incomplete**, so there is no working end-to-end path to bind a book to a world and curate its bible. Gaps found 2026-06-22:

1. `POST /api/books` never binds a world at creation. The New-Book `WorldPicker` selection and the `series.world` ref (a valid kind in `PUT /api/series/:id/refs`) are both **defined but never applied**.
2. The studio "Build bible" save (`saveWorldDocs`, `frontend/studio/src/lib/worldApi.ts:34`) sends `{ docIds }`, but the backend `PUT /api/books/:slug/world/docs` **requires** `{ world, docIds }` → 400.
3. `POST /api/books/:slug/world/propose` (relevance-pull) returns 404 unless the book is **already** world-bound, and nothing binds it (chicken-and-egg).
4. No path binds an **existing** book — `pulledFrom.world` is only ever set inside `snapshotWorldDocs`. The 20 imported production books are all unbound.

This is **wiring, not re-architecture.** Low risk.

## Goal

Make per-book world binding usable end-to-end: bind at creation, bind existing books, auto-build a starting bible, and re-curate — through the studio UI and a clean API — without changing the storage model.

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Binding model | **Both** — `series.world` is a default; any book may override (bind to a different world, or none). |
| 2 | Old series `worldbuilding` blob vs. world docs | **Complementary layers, both inject** — blob carries book-local material (characters/plot/this-book places); curated world docs carry world canon scoped per book. No migration. |
| 3 | Initial bible on bind | **Auto-propose on bind** — binding runs the AI relevance-pull and pre-fills the bible; user trims. |
| 4 | Where bind orchestration lives | **Dedicated server-side endpoint** `PUT /api/books/:slug/world`. Existing `propose` / `/world/docs` stay as the re-curation surface. |

## Architecture & data model

**Zero schema changes.** Every persistent field already exists; the feature only populates them through real flows.

- `series.pulledFrom.world` (`gateway/src/services/series-bible.ts:68`) — the **series default**, settable via `PUT /api/series/:id/refs` (`world` is already in `REF_KINDS`).
- `book.manifest.pulledFrom.world` + `book.manifest.worldDocs` + `templates/world/` snapshot + `.baseline/world/` — the **per-book binding + bible**, written by `BookService.snapshotWorldDocs` (`gateway/src/services/book.ts:867`). Source of truth for that book.

`BOOK_SCHEMA_VERSION` stays **2**; no version bump. `pulledFrom.world`/`worldDocs` are existing optional fields.

**Resolution rule (decision 1).** A book's effective world is `book.pulledFrom.world` when set (explicit binding/override); otherwise, **at creation only**, it seeds from `series.pulledFrom.world`. Once a book is bound, its binding is independent: later changing `series.world` does **not** silently rebind existing books — consistent with how series author/voice/genre changes require an explicit re-pull. Per-book override = bind that book to a different world, or unbind to none.

## Bind flow (the core orchestration)

`PUT /api/books/:slug/world` with body `{ world: string }`:

1. Validate the book exists and is writable (`assertWritable`, schema-gated); validate the world exists (`world.getConfig(world)`), else 404.
2. Build relevance signals from the book: `title`, `genre` (`pulledFrom.genre?.name`), `knownEntities` (the book's series `worldbuildingOf(slug)` blob).
3. Call `world.proposeWorldDocs(slug, signals, worldName, ai)` **directly with the target `worldName`** — the service method takes `worldName` as a parameter (it does not read the manifest; the existing route did), so this needs no pre-binding and sidesteps gap #3.
4. Cap the proposed set to the top **N = 15** by rank (tunable constant), then call `books.snapshotWorldDocs(slug, { name, source }, cappedIds, getConfigRaw, getDocSerialized)`. That single call writes `templates/world/`, mirrors `.baseline/world/`, and sets both `pulledFrom.world` and `worldDocs` atomically. Binding and initial bible land together.

Response: `{ world, worldDocs, proposed }` so the UI can open the Build-bible panel for trimming.

**Idempotent / re-bindable.** Calling `PUT /world` on an already-bound book (the "Change" action, same or different world) re-runs propose and replaces the snapshot — `snapshotWorldDocs` already does `rm` + rewrite of `templates/world/` and `.baseline/world/`, so switching worlds leaves no stale docs. This intentionally overwrites the current curated `worldDocs`; manual re-curation thereafter uses `/world/docs` (which does not re-propose).

**Fail-soft.** `proposeWorldDocs` already returns the full catalog (reason `manual`) on any AI failure or empty/unparseable JSON; the cap keeps an AI outage from producing a 56-doc starting bible. A world with an empty catalog yields an empty bible (binding still recorded).

`DELETE /api/books/:slug/world` — unbind: clear `pulledFrom.world` + `worldDocs`, remove `templates/world/` and `.baseline/world/`. Supports per-book override-to-none.

**Creation inheritance.** `POST /api/books` resolves `world = body.world ?? series.pulledFrom.world?.name`. If one resolves and the world exists, it runs the same bind orchestration **after** the book is created (so the snapshot writes into an existing book dir). A brand-new book proposes from title/genre/series-blob signals — lower-signal but harmless; the user re-curates later.

## API surface

| Method | Path | Status | Body / effect |
|--------|------|--------|---------------|
| `PUT` | `/api/books/:slug/world` | **new** | `{ world }` → bind + auto-propose(cap N) + snapshot. Returns `{ world, worldDocs, proposed }`. |
| `DELETE` | `/api/books/:slug/world` | **new** | unbind: clear `pulledFrom.world` + `worldDocs`, remove `templates/world/` + `.baseline/world/`. |
| `POST` | `/api/books` | **extend** | resolve `body.world ?? series.world`; bind after create. |
| `POST` | `/api/books/:slug/world/propose` | unchanged | re-curation: AI relevance-pull (requires bound world — now satisfied). |
| `PUT` | `/api/books/:slug/world/docs` | unchanged (backend) | `{ world, docIds }` curate + snapshot. |
| `PUT` | `/api/series/:id/refs` | unchanged | set series default world (`world` ref kind already supported) — wire UI. |

The new `world` routes live in `gateway/src/api/routes/worlds.routes.ts` (already owns `/api/books/:slug/world/*`). The bind handler reuses the same `ai` accessor shape (`{ complete, select }`) and `getConfigRaw`/`getDocSerialized` closures the existing propose/snapshot handlers build.

## UI wiring (studio)

- **New-Book wizard** — `WorldPicker` and `NewBook.tsx` already track the selection; include `world` in the create payload (default to the series world when created in a series). The `SnapshotSummary` "World" row becomes live.
- **Book page — a "World" control** showing the current binding with **Bind / Change / Unbind**. In a series it defaults to the series world (one-click adopt); otherwise pick any world. This is how the 20 existing books get bound. Calls `PUT` / `DELETE /api/books/:slug/world`.
- **`BuildBiblePanel`** — fix `saveWorldDocs` to send `{ world, docIds }` (read the book's bound world). Panel remains the propose/trim/save re-curation surface, now reachable because binding populates the world first.
- **Series settings** — control to set the series default world via `PUT /api/series/:id/refs`.

## Prompt composition — verify, do not change

Per decision 2 both layers already inject: the series blob via `worldbuildingOf` → `templates/worldbuilding/`, and curated world canon via `worldGuide` → `templates/world/`. No composition code changes; a test asserts both reach a bound book's composed prompt.

## Testing

- **Unit** (`tests/unit/world-binding.test.ts`, `node --import tsx --test`): bind sets `pulledFrom.world` + populates `worldDocs`; auto-propose cap (N); creation-time inheritance from `series.world`; explicit `body.world` override beats inheritance; unbind clears `pulledFrom.world` + `worldDocs` + removes `templates/world/`; both blob and world-doc layers present in the composed prompt of a bound book. Construct `BookService` + `WorldService` against a temp workspace, as existing book tests do.
- **Smoke** (`tests/world-binding-smoke.sh`, mirroring `tests/world-crud-smoke.sh`): boot the gateway with auth; create a world + series + book; `PUT /api/books/:slug/world` and assert the bible populated; `PUT /world/docs` re-curate; create a second book in the series and assert it auto-binds; `DELETE /api/books/:slug/world` and assert cleared. Hermetic, non-destructive, leaves nothing behind. `-v` streams the server log.

## Out of scope

- No new world documents, no appendix changes, no export-pipeline changes (Phase 5 already renders appendixes).
- No batch migration of the 20 production books — binding them is an owner-run step in the studio once shipped (set the Shattered Cradle series' world, then adopt per book). The other 15 books (no world) stay blob-only.
- No retirement of the series `worldbuilding` blob (decision 2 keeps it).
- No changes to `proposeWorldDocs` ranking, `.baseline` re-pull, or `worldGuide` injection internals.

## Constraints

- `.js` import extensions from `.ts` (NodeNext); Node 22+ via `tsx`; no new runtime dependency.
- Fail-soft init/runtime (`✓ / ⚠ / ℹ`); per-book schema gate honored via `assertWritable`.
- `commit_message` + `./push.sh` workflow — do **not** `git commit`/`git push`; work on `main`; professional Markdown, no emojis.
- Surgical changes; match existing route/service/UI patterns.
