# Phase 12 — Library Element Share/Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Repo conventions override generic steps:** NO `git commit`/`git push` — the final task writes `commit_message`; the maintainer runs `./push.sh`. Work on `main` in the live working tree. `.js` import extensions (NodeNext). Verification gate per task: `npx tsc --noEmit` + `node --import tsx --test tests/unit/*.test.ts` green (185 before this phase).

**Goal:** Export a single library entry (author/voice/genre/pipeline/section/skill) as a portable zip; import one into the workspace library overlay through the Phase 5 security pipeline (staging → validation → injection scan → ConfirmationGate on findings).

**Spec:** `docs/superpowers/specs/2026-06-12-phase12-library-share-import-design.md` — the contract. Read it first.

**Architecture:** Extract Phase 5's generic zip-security guards into a shared module (used by book-transfer unchanged), add a `LibraryTransferService` mirroring `BookTransferService`, expose export/import/finalize on the existing library routes, add minimal Asset Studio UI.

---

### Task 1: Extract shared transfer-security helpers (zero behavior change)

**Files:**
- Create: `gateway/src/services/transfer-security.ts`
- Modify: `gateway/src/services/book-transfer.ts`

- [ ] **Step 1: Read `gateway/src/services/book-transfer.ts` fully.** The pieces to extract (currently private/static there): `isUnsafeEntry` (lines ~100-115), the symlink-mode check inside `validateAndStage`, `scannableFiles` + `scan` (the InjectionDetector walk + `HTML_RE`/`EVENT_RE`), and `SCAN_EXTS`.
- [ ] **Step 2: Create `transfer-security.ts`** exporting:

```ts
/**
 * Shared zip-staging security guards (book-container Phases 5 + 12).
 * Both transfer services (book, library-entry) extract UNTRUSTED zips into an
 * isolated staging dir and scan the staged text for prompt-injection and HTML
 * payloads. The guards live here once so a hardening fix can't drift apart.
 */
import type { InjectionDetector } from '../security/injection.js';

export interface ImportFinding { path: string; type: string; confidence: number; pattern: string; }

export const SCAN_EXTS: readonly string[];          // move from book-transfer verbatim
export const HTML_RE: RegExp;                        // move verbatim
export const EVENT_RE: RegExp;                       // move verbatim

/** True if a relative zip entry name is unsafe for the given whitelist/stage dir. */
export function isUnsafeEntry(name: string, stageDir: string, whitelistPrefixes: readonly string[]): boolean;

/** True if a zip entry's header attr encodes a symlink. */
export function isSymlinkEntry(attr: number | undefined): boolean;

/** Recursively collect scannable text files (relative paths) under the given roots of baseDir. Never follows symlinks. */
export function scannableFiles(baseDir: string, roots: readonly string[], extraFiles?: readonly string[]): string[];

/** InjectionDetector + HTML/event-handler scan over the staged files. */
export function scanStagedText(baseDir: string, files: readonly string[], injection: InjectionDetector): ImportFinding[];
```

  Bodies are MOVED from book-transfer, generalized only by the parameters shown (whitelist, roots, extraFiles like `book.json`). No logic changes.
- [ ] **Step 3: Refactor `book-transfer.ts`** to import and call these (its `ImportFinding` re-export stays so existing importers don't break: `export type { ImportFinding } from './transfer-security.js';`). Delete the now-unused private copies.
- [ ] **Step 4: Verify — this is the whole point of the task:** `npx tsc --noEmit` clean; full unit suite green INCLUDING the existing book-transfer tests unchanged (`ls tests/unit/ | grep -i transfer` to find them; if none exist, run the full suite + grep the feature-smoke Phase 5 section still references the same endpoints). Report any pre-existing book-transfer test count.

### Task 2: `LibraryTransferService` — export (TDD)

**Files:**
- Create: `gateway/src/services/library-transfer.ts`
- Create: `tests/unit/library-transfer.test.ts`
- Modify: `gateway/src/services/library.ts` (one line: `export` the existing `ENTRY_NAME_RE` const)

- [ ] **Step 1: Failing tests** for export. Test harness builds a temp library: built-in dir with `authors/jane/{style.md}` + `genres/noir/{tropes.md}` + `pipelines/quick/pipeline.json` + `sections/blurb/blurb.md`, a real `LibraryService` over it (check its constructor: `(builtinDir, workspaceDir, skills)` — pass a stub `skills` object implementing `getSkillCatalog`/`getSkillByName` returning one skill `demo` with content `'---\ndescription: d\n---\nbody'`). Tests:
  - export author → zip contains `library-entry.json` (`formatVersion:1, kind:'author', name:'jane'`) + `files/style.md` with the content.
  - export pipeline → `files/pipeline.json`; export section → `files/blurb.md`; export skill → `files/SKILL.md` (+ manifest `category` only if the stub exposes one — see Step 3 note).
  - unknown kind/name → throws.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the service skeleton + `export()`:

```ts
import AdmZip from 'adm-zip';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import type { LibraryService } from './library.js';
import type { InjectionDetector } from '../security/injection.js';
import { LIBRARY_KINDS, type LibraryKind } from './library-types.js';
import { isUnsafeEntry, isSymlinkEntry, scannableFiles, scanStagedText, type ImportFinding } from './transfer-security.js';

export const ENTRY_FORMAT_VERSION = 1;
const WHITELIST = ['library-entry.json', 'files/'] as const;

export interface EntryManifest {
  formatVersion: number; kind: LibraryKind; name: string;
  description?: string; category?: string; appVersion?: string; exportedAt?: string;
}
export interface EntryStageResult {
  stagingId: string; manifest?: EntryManifest; findings: ImportFinding[]; structuralError?: string;
}
```

  `export(kind, name)`: validate kind against `LIBRARY_KINDS` and name against the (now-exported) `ENTRY_NAME_RE`; `library.get(kind, name)` (undefined → throw `Entry not found`); build the zip per the spec's per-kind file mapping (author/voice/genre: each `files[fname]`; pipeline: serialize `entry.pipeline` back to JSON? NO — re-read the raw text: `library.get` returns parsed `pipeline`; check whether it also returns raw text — if not, `JSON.stringify(entry.pipeline, null, 2)` is acceptable and re-validates on import); section/skill: `entry.content`. Manifest gets `description` from the entry; for skills, include `category` only if obtainable from the loader catalog (check `gateway/src/skills/loader.ts` for whether category is exposed — if not, omit; the importer defaults).
- [ ] **Step 4: Run → PASS; tsc clean; full suite green.**

### Task 3: stage / scan / finalize (TDD)

**Files:**
- Modify: `gateway/src/services/library-transfer.ts`, `tests/unit/library-transfer.test.ts`

- [ ] **Step 1: Failing tests:**
  - round-trip: export author `jane` → `validateAndStage(zip)` → no structuralError, manifest matches, findings empty → `finalizeImport(stagingId)` → `library.get('author','jane')` now has `source: 'workspace'` (overlay **shadows** the built-in) and the content matches.
  - override: import twice → second succeeds, overwrites.
  - structural rejects (each → `structuralError`, staging dir gone): not-a-zip buffer; missing `library-entry.json`; `formatVersion: 2`; bad kind; bad name (`'../x'`, uppercase); off-whitelist entry (`evil.sh`); traversal entry name (`files/../../x.md`); author with zero `.md` files; pipeline whose `pipeline.json` is invalid JSON.
  - scan: a genre whose `tropes.md` contains `<script>` → findings non-empty (type `html_payload`); an injection-style string (reuse whatever pattern the existing book-transfer tests use, or `'ignore previous instructions and …'` — check `gateway/src/security/injection.ts` for a pattern that actually triggers) → findings non-empty.
  - finalize consumes staging: second `finalizeImport(stagingId)` → throws.
  - skill import: zip with manifest `{kind:'skill', name:'imported-skill', category:'ops'}` + `files/SKILL.md` (valid frontmatter) → finalize writes `<workspaceLibraryDir>/skills/ops/imported-skill/SKILL.md` and calls the reload hook (inject a spy: the service takes an optional `reloadSkills?: () => Promise<void>`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `validateAndStage` (mirror book-transfer's flow exactly: staging UUID dir under the configured staging root, per-entry `isSymlinkEntry` + `isUnsafeEntry(name, stageDir, WHITELIST)`, fail() purges; then manifest parse + the spec's per-kind structural validation — for pipelines reuse the same parse/validation `LibraryService.writeEntry` applies (read `library.ts` and call the same helper it uses, e.g. `parsePipelineJson` from `book-types.js`, rather than duplicating rules); skills: parse frontmatter the way `SkillLoader` does — read `gateway/src/skills/loader.ts` and reuse/replicate its check minimally; sanitize `category` with `ENTRY_NAME_RE`, default `'imported'`) — then `scanStagedText` over the staged `files/` + manifest. Implement `finalizeImport`: file-backed kinds → `library.writeEntry(kind, name, body)` (build `body.files` / `body.content` / `body.description` from the staged tree); skill → write `SKILL.md` under the workspace skills overlay dir (constructor takes that dir) + `await this.reloadSkills?.()`; purge staging; return `{ kind, name, source: 'workspace' }`. Implement `purgeStaging` (copy the guarded delete).
- [ ] **Step 4: Run → PASS; tsc clean; full suite green (~205+).**

### Task 4: Routes + init wiring

**Files:**
- Modify: `gateway/src/api/routes/library.routes.ts`
- Modify: `gateway/src/init/phase-09-export-wave.ts`
- Modify: `gateway/src/index.ts` (field + `getServices()`)

- [ ] **Step 1: Read the book transfer routes first** — `gateway/src/api/routes/books.routes.ts` lines ~210-280 (`GET /:slug/export`, `POST /import` with `uploadZip.single('file')` from `./_shared.js`, gated 202 + `POST /import/finalize` via `checkDecision`) — and MIRROR them:
  - `GET /api/library/:kind/:name/export` — validate kind/name, 404 unknown; send the zip buffer with attachment headers exactly as the book export route does.
  - `POST /api/library/import` — multipart; structuralError → 400; clean → `finalizeImport` immediately → 200 `{ ok, entry }`; findings → `confirmationGate.createRequest({ service: 'library-transfer', action: 'import_library_entry', platform: 'library', riskLevel: 'high', isReversible: true, description: <kind/name + finding count>, payload: { stagingId, kind, name, findings } })` → 202 `{ pendingConfirmation, findings }`. Wrap in try/catch → 500 (Express 4 + async).
  - `POST /api/library/import/finalize` — body `{ confirmationId }`; `checkDecision` (the exact books.routes shape); service must be `'library-transfer'`; approved → `finalizeImport(payload.stagingId)` → 200; a consumed/unknown stagingId → 404 (one-shot — the Phase 11 replay lesson).
- [ ] **Step 2: Init wiring** in `phase-09-export-wave.ts` right after `BookTransferService`: same staging root (`workspace/.import-staging`), workspace skills overlay dir (find the exact path phase-05 uses for `workspaceSkillsDir` — `workspace/library/skills`), `reloadSkills: () => gw.skills.reload()` (check the loader field name on the gateway), and ADD its pending stagingIds to the existing orphan-purge sweep (read how the sweep collects `payload.stagingId` from pending confirmations — it already matches by payload shape; confirm `service: 'library-transfer'` requests are included or extend the filter). Declare `gw.libraryTransfer` + expose in `getServices()`.
- [ ] **Step 3: Verify by curl** (then these become smoke checks in Task 6): boot on `BOOKCLAW_PORT=3957`, export a built-in (`/api/library/genre/<name>/export` → 200 zip), re-import it (→ 200, `source: workspace` in `GET /api/library/genre/<name>`), delete the overlay (existing DELETE route) to restore the built-in. tsc + suite green.

### Task 5: Asset Studio UI (minimal)

**Files:**
- Modify: the Asset Studio route/components under `frontend/studio/src/` (find the library-scope entry view — start from `frontend/studio/src/routes/` and the asset components; read before editing)

- [ ] **Step 1:** Per-entry **Export** action (library scope, any source): an anchor/button to `/api/library/:kind/:name/export?token=…` — find how existing native downloads append the token (the book export route pattern or an existing helper in `@bookclaw/shared`).
- [ ] **Step 2:** **Import entry…** button in the library scope: hidden file input → `fetch` multipart POST → 200: success note + catalog refresh; 202: show findings list + "Pending approval in Confirmations" (link) + a Finalize button calling `/api/library/import/finalize` (409/404 surfaced clearly — same pending-flow pattern as the Phase 11 Backups card); 400: show the structural error. Match existing Asset Studio styling/components; no new pages.
- [ ] **Step 3: Verify:** `npm run build:frontend` green; tsc clean.

### Task 6: Feature-smoke + docs + commit_message

**Files:**
- Modify: `tests/feature-smoke.sh`, `docs/BOOK-CONTAINER-ARCHITECTURE.md`, `docs/TODO.md` → `docs/COMPLETED.md`, `CLAUDE.md` (one line in the library bullet), `.remember/remember.md`
- Create: `commit_message`

- [ ] **Step 1: Smoke section** `### Tier A (Phase 12) — library entry share/import (free, no AI)`, feature-detected (probe the export endpoint on a known built-in; 404 → SKIP all), following the script's existing helpers + trap:
  1. export built-in genre → 200, non-empty zip (save to a temp file);
  2. import it → 200 `{ ok }`; `GET /api/library/genre/<name>` shows `source: workspace`;
  3. DELETE the overlay entry (existing route) → built-in restored (cleanup also in trap);
  4. craft a finding-bearing zip on the fly (node one-liner with adm-zip is NOT available client-side — instead build it with `python3 -m zipfile` or the `zip` CLI if present, else SKIP this check with a note: manifest + `files/x.md` containing `<script>alert(1)</script>`) → POST → 202 + `pendingConfirmation`; reject it via the confirmations API (cleanup pattern from the Phase 11 section);
  5. garbage bytes as zip → 400.
- [ ] **Step 2: Local gates** (tsc, suite, frontend build) then deploy `touch build_now` → poll `.build-logs/last-build.status` fresh `result=PASS` → live smoke (`BASE_URL=http://192.168.1.32:3847` + token from `.env`) → expect 0 failed.
- [ ] **Step 3: Docs:** arch doc Phase 12 bullet gets *(Implemented 2026-06-12.)* + verified note; COMPLETED.md entry (move from TODO umbrella, add a DONE sub-bullet there); CLAUDE.md `workspace/library/` bullet gains a share/import clause; handoff updated.
- [ ] **Step 4: `commit_message`:**

```
feat(phase12): library element share/import — portable entry zips via the Phase 5 security pipeline

- LibraryTransferService: export any library entry (author/voice/genre/pipeline/section/skill) as library-<kind>-<name>.zip; import lands in the workspace overlay (create-or-override by name, shadows built-ins)
- Phase 5 security pipeline reused: shared transfer-security helpers extracted from book-transfer (zip-slip/symlink/charset guards + injection/HTML scan), staging isolation, ConfirmationGate on findings, one-shot finalize
- /api/library/:kind/:name/export + /api/library/import (+ gated finalize); Asset Studio export/import UI
- skills land via the SkillLoader overlay path (workspace/library/skills) with reload
- unit tests + feature-smoke Tier-A section
```

---

## Self-review

- Spec coverage: format (T2), shared helpers (T1), export incl. built-ins (T2), staging/validation/scan/gate/one-shot finalize (T3+T4), skill overlay path (T3), API (T4), UI (T5), all four verify criteria (T3 unit + T6 live), no-marketplace/no-bundles non-goals untouched — covered.
- Delegated look-ups are deliberate (SkillLoader category exposure, gateway skills field name, orphan-sweep filter, Asset Studio component layout) — each says exactly where to look.
- Type names consistent: `EntryManifest`, `EntryStageResult`, `finalizeImport(stagingId)`, `ENTRY_FORMAT_VERSION`.
