# Phase 12 — Library Element Share/Import — Design

**Date:** 2026-06-12
**Status:** Draft for owner approval
**Source design:** [BOOK-CONTAINER-ARCHITECTURE.md](../../BOOK-CONTAINER-ARCHITECTURE.md) § Phase 12 (post-release enhancement; the Phase 11 release gate is passed). Deviations are called out.

## Goal

Export an individual **library entry** — author / voice / genre / pipeline / section / skill — as a portable file, and import one into the **workspace library overlay**: the library-level analog of Phase 5's whole-book share/import. Reuses Phase 5's security pipeline (extract-to-staging → structural validation → `InjectionDetector` scan → ConfirmationGate on detection) and Phase 4's library write path (`LibraryService.writeEntry`/`createEntry`; overlay shadows a built-in by name).

## Non-goals

- No central marketplace/registry — files move by hand (email, Dropbox, chat).
- No book-snapshot export (Phase 4's re-pull and Phase 5's whole-book zip already cover books).
- No bulk multi-entry bundles — one entry per file (a future need can zip zips).

## Format

One `.zip` per entry, uniform across kinds (single import path, single validator):

```
library-entry.json        ← manifest: { formatVersion: 1, kind, name, description?,
                             category? (skills only), appVersion, exportedAt }
files/<filename>…         ← the entry's content files:
                             author/voice/genre → its .md files
                             pipeline           → pipeline.json
                             section            → <name>.md
                             skill              → SKILL.md
```

Filename convention `library-<kind>-<name>.zip`. `formatVersion` gates future shape changes (unknown version → structural reject, mirroring the book `schemaVersion` fail-closed posture).

## Components

### 1. Shared zip-security helpers (`gateway/src/services/transfer-security.ts`) — extracted, not new logic

`BookTransferService` owns three generic, security-critical pieces that Phase 12 needs verbatim: the per-entry zip guards (`isUnsafeEntry`: absolute/NUL/traversal/off-whitelist/escape/charset + symlink-mode rejection), the staged-tree text-file walker, and the injection + HTML/event-handler scan (`HTML_RE`/`EVENT_RE`). Extract them into a shared module parameterized by whitelist prefixes and scan roots; `BookTransferService` switches to the shared helpers with **zero behavior change** (existing unit suite is the regression harness). This was anticipated by the Phase 11 review's altitude finding about per-feature copies of security plumbing.

### 2. `LibraryTransferService` (`gateway/src/services/library-transfer.ts`) — new

Mirrors `BookTransferService`'s shape (constructor deps: `LibraryService`, `InjectionDetector`, staging dir — reuse `workspace/.import-staging/`, same orphan-purge sweep).

- **`export(kind, name)`** → zip Buffer. Reads the **resolved** entry via `LibraryService.get(kind, name)` — built-ins are exportable too, not just overlay entries. Per kind: author/voice/genre → `files` map; pipeline → `pipeline.json` (raw JSON text); section → `<name>.md`; skill → `SKILL.md` (+ `category` in the manifest when the loader exposes it, else omitted). Manifest carries `description` when present. Throws on unknown kind/name (404 at the route).
- **`validateAndStage(zip)`** → `{ stagingId, manifest?, findings, structuralError? }`. Same staging flow as books: extract with the shared guards (whitelist: `library-entry.json` + `files/`), then structural validation: `formatVersion === 1`; `kind ∈ LIBRARY_KINDS`; `name` matches the library's entry-name rule (export `ENTRY_NAME_RE` from `library.ts` instead of re-declaring); per-kind shape (author/voice/genre: ≥1 `.md` file, filenames match `MD_FILE_RE`; pipeline: `pipeline.json` parses via the same validation `writeEntry` applies; section: exactly one `.md`; skill: `SKILL.md` present with parseable frontmatter); skills' `category` sanitized against the entry-name rule, default `imported`. Then **scan** every staged text file (InjectionDetector + HTML/event-handler patterns — identical to book imports).
- **`finalizeImport(stagingId)`** → writes the entry into the **workspace overlay**:
  - file-backed kinds → `LibraryService.writeEntry(kind, name, body)` (**create-or-override by name** — an existing overlay entry is replaced; a built-in of the same name is shadowed, exactly the overlay semantics. `writeEntry` re-runs its own validation, so the library's invariants hold even if staging missed something).
  - `skill` → write `workspace/library/skills/<category>/<name>/SKILL.md` then `SkillLoader.reload()` (the overlay path skills already load from; verify frontmatter parses before writing).
  - Purge staging; return the new entry summary `{ kind, name, source: 'workspace' }`.
- **`purgeStaging(stagingId)`** — same guarded delete as books.

### 3. API (added to `gateway/src/api/routes/library.routes.ts` — same feature area)

- `GET /api/library/:kind/:name/export` → zip download (`Content-Disposition: attachment; filename=library-<kind>-<name>.zip`; native-download `?token=` fallback works as on the book export route).
- `POST /api/library/import` (multipart zip via the existing shared `uploadZip`):
  - structural error → `400 { error }` (staging already purged);
  - **clean (no findings) → finalize immediately**, `200 { ok, entry }`;
  - **findings → ConfirmationGate** (`service: 'library-transfer'`, `action: 'import_library_entry'`, `riskLevel: 'high'`, payload: stagingId + manifest summary + findings) → `202 { pendingConfirmation, findings }`. Mirrors the book import contract exactly.
- `POST /api/library/import/finalize` (body `{ confirmationId }`) — `checkDecision` approved → finalize → `200 { ok, entry }`; mirrors `books.routes.ts` finalize (and the Phase 11 one-shot lesson: the stagingId is consumed by finalize, so replays 404).

### 4. Init wiring

Instantiate `LibraryTransferService` next to `BookTransferService` in `init/phase-09-export-wave.ts` (same staging root; include its pending stagingIds in the existing orphan-purge sweep). Expose via `getServices()`.

### 5. Studio UI (Asset Studio, `/library`) — minimal

- **Export**: a per-entry "Export" action in the library-scope entry view → navigates to the export URL with the `?token=` fallback (plain download; both built-in and overlay entries).
- **Import**: an "Import entry…" button in the library scope → file picker → POST multipart → on 200 show the imported entry (refresh the catalog); on 202 show the findings + "Pending approval in Confirmations" with a Finalize button (same pattern as the Phase 11 Backups card's pending flow); on 400 show the structural error.
- No new pages/routes; match existing Asset Studio patterns and copy tone.

## Security considerations

- An imported entry is **untrusted prompt-bearing content** (it feeds straight into generation prompts; a skill's content is injected into pipeline steps). Hence: staging isolation, the shared zip guards (traversal/zip-slip/symlink/charset), the InjectionDetector + HTML payload scan on every text file, and ConfirmationGate on any finding — the identical posture as book import.
- The export side reads only through `LibraryService.get` — no path input from the client beyond validated kind/name; nothing outside the entry can be included.
- Finalize is one-shot (staging consumed); approvals can't be replayed.
- `writeEntry`'s own validation runs at finalize — defense in depth on top of staging validation.

## Verify (from the arch doc)

1. Export an author, a genre, and a pipeline; re-import each — create-or-override by name, overlay shadows the built-in (re-imported built-in shows `source: workspace`).
2. A malicious entry (injection text / HTML payload) is gated (202 + findings), and rejecting it lands nothing.
3. Traversal / zip-slip / symlink / off-whitelist zips are rejected with a structural error.
4. Importing a skill lands it via the SkillLoader overlay path and it appears in the skill catalog after reload.

## Testing

- **Unit (`tests/unit/library-transfer.test.ts`):** export→import round-trip per kind (incl. skill); built-in export allowed; unknown kind/name throws; structural rejects (bad zip, missing manifest, bad formatVersion, bad kind/name, off-whitelist entry, traversal name, symlink mode, empty files); injection + HTML findings flag; clean import finalizes into the overlay and **shadows a built-in by name**; finalize consumes staging (second call fails); skill import writes `<category>/<name>/SKILL.md` and triggers reload. Plus: `BookTransferService` suite unchanged after the helper extraction (regression).
- **Feature-smoke (Tier A, free):** export a built-in author → import → entry shows `source: workspace` → DELETE the overlay (existing route) restores the built-in; a crafted finding-bearing zip → 202 gated → reject + purge; a bogus zip → 400. Cleanup in the exit trap.
- **Local gates:** `npx tsc --noEmit`, unit suite (from 185), `npm run build:frontend`.
- **Live:** Mercury deploy + feature-smoke.

## Decisions

- **Uniform zip + manifest for every kind** (vs bare `.md`/`.json` files for single-file kinds): one import path, one validator, room for `description`/`category` metadata. Bare-file import can be added later without breaking this format.
- **Built-ins are exportable** — sharing a stock genre to another instance is a primary use case; export reads the resolved entry regardless of source.
- **Import always lands in the overlay** (never touches built-ins), creating or overriding by name — the existing shadowing semantics, no new concepts.
- **Extract shared transfer-security helpers** rather than copy Phase 5's guards a second time (review-anticipated).
- **`formatVersion` fail-closed**: unknown version → reject, never coerce (consistent with the book `schemaVersion` posture).

## Code-review outcomes (2026-06-12, high effort, 7 finder angles)

**Fixed (12):** zip-bomb/disk cap (`checkZipBudget` in transfer-security, called by both transfer services pre-extraction); widened HTML denylist (`base|form|link|meta`); exported `SKILL_CATEGORIES` from the loader and dropped the duplicated copy; `export()` rejects synthetic skills (no shareable frontmatter); 503 unavailable-guard on the new routes; gated-import payload minimized so an entry name / finding pattern can't trip `payloadClaimsPreAuth`; invalid export name → 400 (vs 404 not-found); staging sweep now protects `approved` (not just `pending`) confirmations and skips dirs younger than 15 min (race guard); frontend Finalize persisted to localStorage so it survives navigating to /confirmations and back, cleared on success/expiry; `ImportFinding.confidence` type corrected.

**Skipped, by design or out-of-scope (surgical):**
- **Clean (no-finding) import auto-finalizes and can shadow an in-use entry** — spec-sanctioned (clean → finalize immediately; the gate is for injection/HTML findings, and overlay-shadow-by-name is the Phase 4 model). A normal round-trip exports the entry's full file set, so re-import reproduces it; only a hand-crafted partial zip would hybridize, and even then it follows the same overlay-merge semantics as the rest of the app.
- **Reworded prompt-injection evades the `InjectionDetector` regexes** — inherent to a pattern-based scanner; DOMPurify (render) + the gate-on-findings posture are the layered defenses, identical to book import.
- **Confirmation-finalize handler now hand-rolled a third time** (books, backups, library) with minor status drift — the shared-helper refactor is broader than this phase; logged for a future cleanup.
- **Multer reject → Express default HTML 500**, and `String(payload?.stagingId)` → `'undefined'` sentinel — both pre-existing patterns moved verbatim from book-transfer; not Phase-12 regressions.
