# Phase 5 — Share / import security

**Status:** Approved (brainstorm 2026-06-07). Feeds `writing-plans`.

**Goal:** Let a user **export** a book as a single portable `.zip` and **import**
such a zip safely — structurally validated, injection-scanned, and gated behind
the existing ConfirmationGate when anything is flagged.

**Architecture:** A new `BookTransferService` owns book ⇆ `.zip` conversion and
the import security pipeline (extract-to-staging → structural validation →
version classification → injection scan → land-or-gate). It reuses
`InjectionDetector`, `classifyVersion`, `safePath`, `ConfirmationGateService`,
and `BookService` (slug allocation + `.baseline` capture). Thin routes mount it;
the dashboard adds Export/Import controls.

**Tech stack:** Node 22 + TypeScript (NodeNext, `.js` import extensions), Express
+ multer, `node --test` via tsx, esbuild dashboard, one new pure-JS dep
(`adm-zip`) for zip create/extract with pre-extraction entry inspection.

**Roadmap:** Phase 5 of [BOOK-CONTAINER-ARCHITECTURE.md](../../BOOK-CONTAINER-ARCHITECTURE.md).

---

## Background / current state (verified)

- A book is `workspace/books/<slug>/`: `book.json` (manifest) + `templates/`
  (author/voice/genre dirs of `.md`, `pipeline.json`, `sections/*.md`,
  `skills/<name>/SKILL.md`) + `data/` (generated outputs) + `.baseline/`
  (pristine re-pull mirror, Phase 4). There is **no working export/import** —
  `scripts/export-book.sh` is an empty stub.
- `gateway/src/security/injection.ts` `InjectionDetector.scan(input: string): {
  detected: boolean; type?; confidence?; pattern? }` — pattern-based.
- `gateway/src/services/book-types.ts` `classifyVersion(v): 'ok' | 'readonly' |
  'quarantined'` (`< MIN → quarantined`, `> CURRENT → readonly`).
- `gateway/src/services/confirmation-gate.ts` `ConfirmationGateService.createRequest(
  input: { service; action; platform; description; payload; riskLevel;
  isReversible; disclosures? })` → `ConfirmationRequest{ id, status, expiresAt }`;
  24h expiry; **no auto-approve**; rejects payloads claiming pre-authorization.
  Exposed via `GET /api/confirmations`, `GET /api/confirmations/:id`,
  `POST /api/confirmations/:id/{approve,reject,outcome}` (knowledge.routes.ts).
- `gateway/src/api/routes/_shared.ts` `safePath(base, rel)` → absolute path within
  `base` or `null`; `upload` (multer, 50MB, `.txt/.md/.docx` only, memory storage).
- `gateway/src/services/book.ts` `BookService`: `create()` (captures `.baseline`
  via `cp`), `list()`, `open(slug)`, `bookDir/templatesDir/baselineDir(slug)`,
  private `uniqueSlug(base)`, `delete(slug)`. Vault is at `config/.vault`,
  **outside** the book tree.

## Decisions (from the 2026-06-07 brainstorm)

1. **Export artifact = a single `.zip`** containing a **whitelist**: `book.json`
   + `templates/**` + `data/**`. **Excludes** `.baseline/` (re-derived on import)
   and is structurally incapable of reaching the vault (outside the book dir).
2. **Import scans all prompt-bearing content + `data/`** with `InjectionDetector`
   (every `.md` in author/voice/genre/sections, every pipeline step's prompt
   text, every `SKILL.md`, and `data/**` text files).
3. **Gate behavior:** structural violations → **hard reject** (never gated);
   clean + version-compatible → **lands directly**; injection-detected **or**
   version-incompatible → **held behind the ConfirmationGate**, lands only on
   explicit approval (24h, no auto-approve).
4. **Surface = API + dashboard.** Export download + import upload + a finalize
   call after approval; Export/Import buttons in the books panel.
5. **Imported books get a fresh `uniqueSlug`** (no collision/overwrite); the
   landed `book.json` id/slug is rewritten; `.baseline/` is re-seeded from the
   landed `templates/`.
6. **Export is not gated** (user-initiated local download, not an external
   side-effect). The gate is import-side only.

---

## Components

### 1. Dependency
**Files:** `package.json`. Add `adm-zip` (pure JS; create, extract, and **list
entries without extracting** — required for zip-slip defense).

### 2. `BookTransferService`
**Files:** `gateway/src/services/book-transfer.ts` (new). Constructed with the
books dir, `BookService`, `InjectionDetector`, and a staging dir
(`workspace/.import-staging/`). One responsibility: book ⇆ zip, safely.

- `export(slug): Buffer` — guard slug; resolve `bookDir`; build a zip adding
  ONLY whitelisted paths that exist: `book.json`, everything under `templates/`,
  everything under `data/`. Never add `.baseline/` or any path outside the book
  dir. Throws if the book is missing (route → 404).
- `INJECTION_SCAN` helper — given the staged book dir, collect the text of every
  scannable file: `templates/{author,voice,genre,sections}/**/*.md`,
  `templates/skills/**/*.md`, the `promptTemplate` (and any prompt text) of each
  step in `templates/pipeline.json`, and `data/**` text files. Run
  `InjectionDetector.scan()` on each; return `findings: { path, type,
  confidence, pattern }[]`.
- `validateAndStage(zip: Buffer): { stagingId; manifest?; findings; versionStatus;
  structuralError? }`:
  - Create `workspace/.import-staging/<stagingId>/`.
  - **Per-entry, before writing:** reject (→ `structuralError`, purge, return)
    any entry whose name is absolute, contains `..` / resolves outside the
    staging dir (zip-slip; verify with `safePath`), is a symlink, or is outside
    the whitelist (`book.json`, `templates/`, `data/` prefixes only). Otherwise
    write the entry under staging.
  - Require `book.json` present, parseable, with `slug`/`title`/`schemaVersion`/
    `pulledFrom`/`templates` shape; else `structuralError`.
  - `versionStatus = classifyVersion(manifest.schemaVersion)`.
  - `findings = INJECTION_SCAN(stagingDir)`.
- `finalizeImport(stagingId): manifest` — read staged `book.json`; allocate a
  fresh slug via `BookService` (expose a small `allocateSlug(title)` that wraps
  the private `uniqueSlug(slugify(title))`); rewrite `book.json` `id`+`slug`;
  move staging → `workspace/books/<newslug>/`; capture `.baseline/` from the
  landed `templates/` (`cp`); return the manifest.
- `purgeStaging(stagingId): void` — `rm -rf` the staging dir (guarded to the
  staging root).
- `sweepStaging(): void` (called from `initialize()` at boot) — remove every
  staging dir that is **not** referenced by a still-`pending` `book-transfer`
  confirmation (covers orphans from expired/denied requests and from a crash
  between stage and gate). This is the cleanup path for the gate-expiry case,
  since `ConfirmationGateService` expiry does not call back into this service.
- All staging dirs are purged on reject/deny/error, and orphans on boot — **no
  orphan staging**.

The injection scan treats only **text** files as scannable: `.md`, `.txt`,
`.json` (so `data/`'s compiled `.docx`/`.epub`/binary outputs are skipped, not
mis-scanned as text).

### 3. Routes
**Files:** `gateway/src/api/routes/books.routes.ts`, `_shared.ts` (a zip multer).

- `_shared.ts`: add `uploadZip` (multer, memory storage, `.zip` only, a larger
  limit than the docs uploader — e.g. 200MB — since `data/` can be large).
- `GET /api/books/:slug/export` — `res` streams `export(slug)` as
  `application/zip` with `Content-Disposition: attachment; filename="<slug>.zip"`.
  Accepts the `?token=` fallback so a plain `<a download>` works. 404 if missing.
- `POST /api/books/import` (`uploadZip.single('file')`) — `validateAndStage`:
  - `structuralError` → 400 `{ error }` (staging already purged).
  - clean + `versionStatus === 'ok'` + no findings → `finalizeImport` → 200
    `{ imported: slug }`.
  - findings non-empty OR `versionStatus !== 'ok'` → `createRequest({
    service:'book-transfer', action:'import', platform:'api',
    description:'Import book "<title>" — N injection finding(s)[, version <status>]',
    payload:{ stagingId, title, slug, findings, versionStatus }, riskLevel:'high',
    isReversible:true })` → 200 `{ gated:true, confirmationId, findings,
    versionStatus }`.
- `POST /api/books/import/finalize` body `{ confirmationId }` — load the
  confirmation; require `status === 'approved'` and `service === 'book-transfer'`
  (else 400/409); `finalizeImport(payload.stagingId)`; 200 `{ imported: slug }`.
  (Approval itself stays the existing `POST /api/confirmations/:id/approve`; this
  endpoint only *consumes* an already-approved request to land the staged book —
  the gate remains the sole approval authority.)

### 4. Dashboard
**Files:** `dashboard/src/panels/books.js`.
- **Export** button per book row → anchor download of
  `authUrl('/api/books/<slug>/export')`.
- **Import** button → hidden file input (`.zip`) → `POST /api/books/import`
  (multipart). On `{ imported }` → toast + re-render list. On `{ gated:true }`
  → show the findings + a notice to approve the request in the Confirmations
  view; after approval, the user clicks "Finalize import" (or the panel offers
  it) → `POST /api/books/import/finalize { confirmationId }` → re-render.

## Testing

**Unit (`tests/unit/book-transfer.test.ts`, new):**
- Round-trip: `create()` a book → `export()` → `validateAndStage()` →
  `finalizeImport()` → a new book exists with a fresh slug, same templates/data,
  and a re-seeded `.baseline/`.
- Export whitelist: the zip contains `book.json`+`templates/`+`data/` and NOT
  `.baseline/`; nothing outside the book dir.
- Zip-slip / structural: entries with `../escape`, an absolute path, a symlink,
  or a path outside the whitelist → `structuralError`, staging purged, nothing
  lands.
- Injection: an author `SOUL.md`, a `SKILL.md`, and a `pipeline.json` step prompt
  each containing an injection pattern → `findings` non-empty (covers the full
  scan surface, not just skills).
- Version: a `book.json` with `schemaVersion` above current → `versionStatus
  !== 'ok'` (routes through the gate).
- A bad/missing `book.json` → `structuralError`.

**feature-smoke (`tests/feature-smoke.sh`):** export an existing book → import the
returned zip → assert a new book appears (clean path); build a tiny zip with an
injected `SKILL.md` and import it → assert `gated:true` + a confirmation exists.
Teardown deletes both books (and any created confirmation).

## Out of scope
- Signing / encryption of the zip.
- Partial-book import or merging into an existing book (always a new book).
- Cloud transfer (Phase 11 — backup & recovery).
- Genre/sections/skills generation wiring (Phase 7) — unchanged.
- A standalone CLI (`scripts/export-book.sh` stays a stub; the API is canonical).

## Success criteria
- A book exports to a single `.zip` (book.json + templates + data, no `.baseline`,
  no vault) and re-imports to a new book with a working `.baseline`.
- A zip with a traversal/symlink/out-of-whitelist entry is hard-rejected; nothing
  is written outside staging and staging is purged.
- A zip whose content trips `InjectionDetector` (in any prompt-bearing file) or
  whose version is incompatible lands ONLY after explicit ConfirmationGate
  approval; a clean compatible zip lands directly.
- `npx tsc --noEmit` clean; unit suite green; feature-smoke green against a
  deployed build with export→import + gated-import assertions and book cleanup.
