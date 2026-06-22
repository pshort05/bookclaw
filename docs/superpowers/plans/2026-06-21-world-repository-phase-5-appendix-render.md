# World Repository Phase 5 — Appendix Selection & Back-Matter Render

> **For agentic workers:** This plan is part of the World Repository set and is governed by the **shared contract** in `docs/superpowers/plans/2026-06-21-world-repository-00-index-and-contract.md`. Use the exact type names, signatures, file paths, and storage layout defined there. If you need a name that is not in the contract, that is a contract gap — stop and reconcile, do not invent a divergent name. This plan **depends on Phase 1** (`WorldService.getDocument`, `WorldDocMeta`, `WorldDocument`, `LibraryWorld.stripCodesInAppendix`) and **Phase 3** (book↔world binding, `BookManifest.worldDocs`, `templates/world/` snapshot, `worlds.routes.ts` with `PUT /api/books/:slug/world/docs`). Build it after both.

**Spec:** `docs/superpowers/specs/2026-06-21-world-repository-design.md` — §7 "Section 4 — Novel appendixes" is the scope.

## Goal

Let an author select, **per book**, an ordered list of world documents to print as **reader-facing back-matter** after the manuscript, in both DOCX and EPUB. Selection is stored on the book manifest as `appendix[]` and is **independent** of the bible `worldDocs` (a doc may be in one, both, or neither). At render time each selected document prints **title + in-world attribution + narrative body**, with internal **classification / clearance / distribution codes stripped** when the world's `stripCodesInAppendix` is true (default true). Attribution is always kept (in-world charm). The candidate pool is the world's `appendixEligible: true` documents available to the book.

## Architecture

Three thin layers, mirroring the existing export flow:

1. **Storage / API** — `BookManifest.appendix?` (additive-optional, already declared in the contract / Phase 3) holds the ordered selection. `PUT /api/books/:slug/world/appendix` (in the Phase-1/3 `worlds.routes.ts`) validates and saves it, mirroring `PUT /world/docs`. A small `BookService.setAppendix(slug, entries)` does the manifest read-modify-write.
2. **Resolution** — a pure builder `resolveBookAppendix(slug)` turns the saved `appendix[]` into ordered `{ title, attribution, body }` entries by resolving each `docId`: prefer the per-book snapshot in `templates/world/<docId>.md`, else fall back to the live world via `WorldService.getDocument`; fail-soft skip a missing doc. The body is run through `stripAppendixCodes()` when the world's `stripCodesInAppendix` is true.
3. **Render** — `DocxExportOptions` / `EpubExportOptions` gain an optional `appendix?: AppendixEntry[]`. The two exporters append appendix sections **after** the main manuscript content (DOCX: a `SectionType.NEXT_PAGE` section per entry, before `new Document`; EPUB: one XHTML page per entry with matching manifest + spine items). The compile path in `documents.routes.ts` resolves the appendix for the project's bound book and passes it through.

`stripAppendixCodes()` is a small pure function (line-based) with unit tests: it removes lines that begin with `Classification:`, `Distribution:`, `Access Level:`, or `Clearance:` (case-insensitive, optional leading markup/whitespace), and keeps the `Compiled by…` / attribution line and all narrative body.

## Tech Stack

Node 22+, TypeScript via `tsx` (no dev compile step). DOCX via the `docx` package (already a dependency); EPUB via `adm-zip` (already a dependency). No new runtime dependency. Tests: `tests/unit/*.test.ts` run by `node --import tsx --test` (`npm run test:unit`).

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

## File Structure

```
gateway/src/services/
  world-appendix.ts        NEW  — AppendixEntry type, stripAppendixCodes(), resolveBookAppendix()
  book.ts                  EDIT — add setAppendix(slug, entries) manifest read-modify-write
  docx-export.ts           EDIT — DocxExportOptions.appendix?; render appendix sections
  epub-export.ts           EDIT — EpubExportOptions.appendix?; render appendix XHTML + manifest/spine
gateway/src/api/routes/
  worlds.routes.ts         EDIT — PUT /api/books/:slug/world/appendix
  documents.routes.ts      EDIT — resolve appendix for the project's book; pass to both exporters
tests/unit/
  world-appendix.test.ts   NEW  — stripAppendixCodes + resolveBookAppendix + render assertions
```

`AppendixEntry`, `stripAppendixCodes`, and `resolveBookAppendix` live together in `world-appendix.ts` so the exporters import only the small render-shaped type and never the whole `WorldService`. `docx-export.ts` / `epub-export.ts` import `AppendixEntry` (type-only) from there.

---

### Task 1: Appendix render type + code stripper (pure, tested)

**Files:** `gateway/src/services/world-appendix.ts` (new), `tests/unit/world-appendix.test.ts` (new).

**Interfaces.**

Produces:
```ts
// gateway/src/services/world-appendix.ts
export interface AppendixEntry {
  title: string;        // printed heading (manifest title override, else doc meta.title)
  attribution?: string; // in-world "Compiled by…" line, kept verbatim
  body: string;         // narrative body, codes stripped when the world says so
}

/**
 * Remove internal classification/clearance/distribution code lines from an
 * appendix body. Strips lines whose first non-markup token is one of
 * Classification:, Distribution:, Access Level:, Clearance: (case-insensitive,
 * tolerant of leading '#', '*', '>' and whitespace). Keeps the attribution
 * ("Compiled by…") line and all narrative prose. Pure; no I/O.
 */
export function stripAppendixCodes(body: string): string;
```

Consumes: nothing (pure string in, string out).

- [ ] Write `tests/unit/world-appendix.test.ts` with a `describe('stripAppendixCodes')` block: a body containing `Classification: FG-GEO-0141`, `Distribution: Approved for General Access`, `Access Level: Restricted`, `Clearance: Cloister-Only`, a `Compiled by Talen Windwalker; transcribed by Morvin Ironhand` line, and three prose paragraphs. Assert the four code lines are gone, the `Compiled by…` line and all prose remain, and a prose line that merely *mentions* the word "classification" mid-sentence is untouched. Add a case with leading markup (`### Classification: X`, `> Distribution: Y`) to confirm those are stripped too, and a case where no code lines exist (output equals input). → run `npm run test:unit` → **FAIL** (module missing).
- [ ] Create `gateway/src/services/world-appendix.ts` with `AppendixEntry` and `stripAppendixCodes`. Implement the stripper line-by-line: for each line, compute `const probe = line.replace(/^[\s#>*_-]+/, '')` and drop the line when `/^(classification|distribution|access level|clearance)\s*:/i.test(probe)`; otherwise keep it. Join surviving lines with `\n`. Do not trim or reflow body text beyond dropping whole code lines. → run `npm run test:unit` → **PASS**.
- [ ] `npx tsc --noEmit` → clean.

---

### Task 2: Resolve a book's appendix into ordered entries

**Files:** `gateway/src/services/world-appendix.ts` (extend), `tests/unit/world-appendix.test.ts` (extend).

**Interfaces.**

Consumes (from the contract — Phase 1 + Phase 3):
- `BookService.open(slug): Promise<{ manifest: BookManifest; status } | undefined>` — `manifest.appendix?: Array<{ docId: string; title?: string; order: number }>`, `manifest.world?: PulledRef | null`.
- `BookService.templatesDir(slug): string | null` — snapshot root; appendix snapshot docs (if any) live at `templatesDir/world/<docId>.md`.
- `WorldService.getConfig(name): LibraryWorld | undefined` — for `stripCodesInAppendix` (default true when undefined).
- `WorldService.getDocument(name, docId): WorldDocument | undefined` — live fallback; `WorldDocument.meta.{title,attribution}`, `WorldDocument.body`.
- `parseWorldDoc(raw): { meta: WorldDocMeta; body: string }` (from `world-parse.ts`) — to parse a snapshotted `<docId>.md`.

Produces:
```ts
// gateway/src/services/world-appendix.ts
export async function resolveBookAppendix(
  books: BookService,
  worlds: WorldService,
  slug: string,
): Promise<AppendixEntry[]>;
// Reads manifest.appendix, sorts by order asc, resolves each docId
// (snapshot first, live world fallback), applies stripAppendixCodes when the
// world's stripCodesInAppendix !== false, returns ordered AppendixEntry[].
// Empty/absent appendix → []. A docId that resolves nowhere is skipped
// (fail-soft, warn once). Never throws.
```

Resolution rules (keep simple):
1. `const opened = await books.open(slug)`; if no `opened` or no non-empty `manifest.appendix`, return `[]`.
2. Sort entries by `order` ascending (stable).
3. For each entry, resolve the document:
   - Snapshot: `${templatesDir(slug)}/world/${docId}.md` — if it exists, read + `parseWorldDoc`.
   - Else live: `worlds.getDocument(manifest.world?.name ?? <derive>, docId)`. If `manifest.world` is absent, skip with a warn (no world bound → no source to resolve from).
   - If neither yields a document, `console.warn('  ⚠ Appendix: docId "…" not found — skipping')` and continue.
4. `title` = entry.title (if non-empty) else `meta.title`.
5. `attribution` = `meta.attribution` (may be undefined).
6. `body` = world's `stripCodesInAppendix !== false` ? `stripAppendixCodes(doc.body)` : `doc.body`.

Imports use `.js` extensions: `import { BookService } from './book.js'`, `import { WorldService } from './world.js'`, `import { parseWorldDoc } from './world-parse.js'`.

- [ ] Extend the test file with `describe('resolveBookAppendix')`. Build lightweight fakes (object literals typed `as unknown as BookService` / `as unknown as WorldService`) rather than real services: a fake `books` whose `open` returns a manifest with `appendix: [{docId:'b',order:2},{docId:'a',order:1,title:'Custom'}]` and `world:{name:'demo'}`, and `templatesDir` returning a non-existent path (forces live fallback); a fake `worlds` whose `getConfig('demo')` returns `{ stripCodesInAppendix: true }` and `getDocument('demo', id)` returns a `WorldDocument` for `'a'`/`'b'` (each body carrying a `Classification:` line + attribution + prose) and `undefined` for anything else. Assert: result is ordered `[a, b]` (order asc); `result[0].title === 'Custom'` (manifest override) and `result[1].title` is the doc meta title; both `body` values have the `Classification:` line stripped but keep attribution; `attribution` is carried through. Add a case: an entry pointing at an unknown docId is skipped (length drops by one, no throw). Add a case: `getConfig` returns `{ stripCodesInAppendix: false }` → body retains the `Classification:` line. → `npm run test:unit` → **FAIL**.
- [ ] Implement `resolveBookAppendix` in `world-appendix.ts` per the rules above (snapshot read uses `existsSync` + `readFile` from `fs`/`fs/promises`; wrap snapshot parse in try/catch and fall through to live on parse failure). → `npm run test:unit` → **PASS**.
- [ ] `npx tsc --noEmit` → clean.

---

### Task 3: `BookService.setAppendix` — persist the ordered selection

**Files:** `gateway/src/services/book.ts` (edit).

**Interfaces.**

Produces:
```ts
// gateway/src/services/book.ts (method on BookService)
/**
 * Save the ordered appendix selection onto the book manifest. Read-modify-write
 * of books/<slug>/book.json. Entries are stored sorted by order asc. Returns the
 * updated manifest, or undefined when the slug has no readable book.
 */
async setAppendix(
  slug: string,
  entries: Array<{ docId: string; title?: string; order: number }>,
): Promise<BookManifest | undefined>;
```

Consumes: existing private `booksDir`, existing `open(slug)`, `writeFile` (already imported at `book.ts:13`), `join` (already imported).

Implementation (mirror the `book.json` write at `book.ts:331`): `const opened = await this.open(slug); if (!opened) return undefined; const manifest = opened.manifest; manifest.appendix = [...entries].sort((a,b)=>a.order-b.order); await writeFile(join(this.booksDir, slug, 'book.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8'); return manifest;`. No schema bump (additive-optional field, per Global Constraints).

- [ ] Confirm `BookManifest.appendix?` is already declared in `book-types.ts` (Phase 3 / contract line 142). If present, do not redeclare. If — and only if — Phase 3 has not landed it yet, add `appendix?: Array<{ docId: string; title?: string; order: number }>;` to `BookManifest` as an additive-optional field (no schema bump). Note which case applied in the commit message. → verify by reading `book-types.ts`.
- [ ] Add the `setAppendix` method to `BookService` near the other manifest writers. → `npx tsc --noEmit` → clean.
- [ ] Smoke-verify the read-modify-write by hand against an existing book dir in a scratch test (or rely on Task 6's route smoke); no new unit test required for this thin wrapper since Task 2's resolver test covers manifest shape consumption.

---

### Task 4: DOCX appendix render

**Files:** `gateway/src/services/docx-export.ts` (edit), `tests/unit/world-appendix.test.ts` (extend).

**Interfaces.**

Consumes: `AppendixEntry` (type-only import from `./world-appendix.js`).

Produces (additive field on the existing options):
```ts
// gateway/src/services/docx-export.ts
export interface DocxExportOptions {
  // …existing fields unchanged…
  appendix?: AppendixEntry[]; // ordered back-matter, rendered after BACK MATTER
}
```

Render placement and idiom (mirror the existing BACK MATTER block at `docx-export.ts:138-194`, which builds paragraph arrays and pushes a `SectionType.NEXT_PAGE` section before `new Document({ …, sections })` at line ~200):

After the existing back-matter `if (backMatterParas.length > 0) { sections.push(...) }` block and **before** `const doc = new Document(...)`, add:

```ts
// ── World Appendix (back-matter, codes already stripped by the resolver) ──
if (options.appendix && options.appendix.length > 0) {
  for (const entry of options.appendix) {
    const appendixParas: any[] = [];
    appendixParas.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: entry.title.toUpperCase(), bold: true, size: 28, font: 'Georgia' })],
      spacing: { after: 300 },
    }));
    if (entry.attribution) {
      appendixParas.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: entry.attribution, italics: true, size: 20, font: 'Georgia' })],
        spacing: { after: 400 },
      }));
    }
    for (const para of parseMarkdownToDocx(entry.body)) appendixParas.push(para);
    sections.push({
      properties: { type: SectionType.NEXT_PAGE, page: { margin: margins } },
      children: appendixParas,
    });
  }
}
```

Reusing `parseMarkdownToDocx(entry.body)` keeps body formatting consistent with chapters (it already handles `###` subheadings, scene breaks, paragraphs). Each appendix doc gets its own `NEXT_PAGE` section so it starts on a fresh page, matching the front/back-matter convention. No other change to `generateDocxBuffer`.

- [ ] Add `appendix?: AppendixEntry[]` to `DocxExportOptions` and the type-only import `import type { AppendixEntry } from './world-appendix.js';`. → `npx tsc --noEmit` → clean (interface-only change).
- [ ] Extend the test file with `describe('generateDocxBuffer appendix')`: call `generateDocxBuffer({ title:'T', author:'A', content:'# Chapter 1\n\nBody.', appendix:[{ title:'Field Guide', attribution:'Compiled by Talen', body:'Narrative prose here.' }] })` and assert the returned value `Buffer.isBuffer(result)` and `result.length > 0`. DOCX is a zip, so do not assert on binary text. → `npm run test:unit` → **FAIL** (render block not added yet; until then the option is silently ignored — the test asserting a Buffer will actually pass, so phrase the failing expectation against the resolver-shaped builder instead: assert that an `AppendixEntry[]` with the `Classification:` line already stripped produces a heading string via a tiny exported helper). **Resolution:** because binary inspection is impractical, the meaningful render assertion lives on the **resolver** (Task 2). For DOCX, assert only that `generateDocxBuffer` with the `appendix` option returns a non-empty Buffer and does not throw — write that as the test now; it fails first only because the new field is not yet on the interface (a `tsc`-level failure caught by the build-then-assert test runner).
- [ ] Add the render block. → `npm run test:unit` → **PASS** (Buffer returned, no throw).
- [ ] `npx tsc --noEmit` → clean.

---

### Task 5: EPUB appendix render

**Files:** `gateway/src/services/epub-export.ts` (edit), `tests/unit/world-appendix.test.ts` (extend).

**Interfaces.**

Consumes: `AppendixEntry` (type-only import from `./world-appendix.js`).

Produces:
```ts
// gateway/src/services/epub-export.ts
export interface EpubExportOptions {
  // …existing fields unchanged…
  appendix?: AppendixEntry[]; // ordered back-matter, after chapters / About the Author
}
```

Render idiom (mirror the chapter + About-the-Author pattern: a manifest `<item>`, a spine `<itemref>`, and an `OEBPS/<name>.xhtml` file — see `epub-export.ts:53-86` for manifest/spine, `:167-181` for chapter XHTML, `:183-199` for the About page).

1. Build the appendix list once near the top of `generateEpubBuffer`, after `const chapters = splitIntoChapters(content);`:
```ts
const appendix = options.appendix ?? [];
```
2. **Manifest** — after the `${manifestItems}` line in the `<manifest>` block, add appendix items:
```ts
const appendixManifest = appendix.map((_, i) =>
  `    <item id="appendix${i + 1}" href="appendix${i + 1}.xhtml" media-type="application/xhtml+xml"/>`
).join('\n');
```
   Insert `${appendixManifest ? '\n' + appendixManifest : ''}` into the manifest template after `${manifestItems}` and before the `about` item.
3. **Spine** — appendix entries come after chapters, before/around `about`:
```ts
const appendixSpine = appendix.map((_, i) =>
  `    <itemref idref="appendix${i + 1}"/>`
).join('\n');
```
   Insert `${appendixSpine ? '\n' + appendixSpine : ''}` after `${spineItems}`.
4. **XHTML files** — after the About-the-Author block, write one page per entry:
```ts
appendix.forEach((entry, i) => {
  const bodyHtml = markdownToXhtml(entry.body);
  const attrib = entry.attribution
    ? `  <p class="appendix-attribution"><em>${escapeXml(entry.attribution)}</em></p>\n`
    : '';
  zip.addFile(`OEBPS/appendix${i + 1}.xhtml`, Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${escapeXml(entry.title)}</title>
  <link rel="stylesheet" href="style.css" type="text/css"/>
</head>
<body>
  <h1>${escapeXml(entry.title)}</h1>
${attrib}${bodyHtml}
</body>
</html>`, 'utf-8'));
});
```
   `markdownToXhtml` + `escapeXml` already exist in the file; reuse them. No CSS change required (`.appendix-attribution` falls back to default `p` styling; do not add a rule unless trivial). `<h1>` already page-breaks-before via the existing stylesheet, so each appendix starts fresh.

- [ ] Add `appendix?: AppendixEntry[]` to `EpubExportOptions` and the type-only import. → `npx tsc --noEmit` → clean.
- [ ] Extend the test file with `describe('generateEpubBuffer appendix')`: EPUB is a zip and `adm-zip` lets us read entries back. Call `generateEpubBuffer({ title:'T', author:'A', content:'# Chapter 1\n\nBody.', appendix:[{ title:'Field Guide', attribution:'Compiled by Talen', body:'Narrative prose.' }] })`, then `const z = new AdmZip(result)`. Assert: `z.getEntry('OEBPS/appendix1.xhtml')` is non-null; its text contains `<h1>Field Guide</h1>`, contains `Compiled by Talen`, and contains `Narrative prose.`; the `OEBPS/content.opf` text contains both `id="appendix1"` (manifest) and `idref="appendix1"` (spine). → `npm run test:unit` → **FAIL**.
- [ ] Add the manifest/spine/XHTML render. → `npm run test:unit` → **PASS**.
- [ ] `npx tsc --noEmit` → clean.

---

### Task 6: API route + compile-path plumbing

**Files:** `gateway/src/api/routes/worlds.routes.ts` (edit — add the PUT route), `gateway/src/api/routes/documents.routes.ts` (edit — resolve + pass appendix into the compile export).

**Interfaces.**

Produces (route — mirror the `PUT /api/books/:slug/world/docs` validation style from Phase 3):
```
PUT /api/books/:slug/world/appendix
  body: { appendix: Array<{ docId: string; title?: string; order: number }> }
  → 400 if body.appendix is not an array, or any entry lacks a string docId,
       or order is not a finite number (title optional string)
  → 404 if the slug has no readable book (setAppendix returns undefined)
  → 200 { book: BookManifest }   // the updated manifest
```

Route implementation (in the `mountWorlds(app, gateway, baseDir)` factory, alongside the Phase-3 `/world/docs` route):
```ts
app.put('/api/books/:slug/world/appendix', async (req, res) => {
  const slug = String(req.params.slug);
  const raw = (req.body && (req.body as any).appendix);
  if (!Array.isArray(raw)) return res.status(400).json({ error: 'appendix must be an array' });
  const entries: Array<{ docId: string; title?: string; order: number }> = [];
  for (const e of raw) {
    if (!e || typeof e.docId !== 'string' || !e.docId) {
      return res.status(400).json({ error: 'each appendix entry needs a docId' });
    }
    if (typeof e.order !== 'number' || !Number.isFinite(e.order)) {
      return res.status(400).json({ error: 'each appendix entry needs a numeric order' });
    }
    if (e.title !== undefined && typeof e.title !== 'string') {
      return res.status(400).json({ error: 'appendix title must be a string' });
    }
    entries.push({ docId: e.docId, order: e.order, ...(e.title ? { title: e.title } : {}) });
  }
  const books = gateway.getBooks?.() ?? gateway.books;  // match how /world/docs reaches BookService
  const manifest = await books.setAppendix(slug, entries);
  if (!manifest) return res.status(404).json({ error: 'book not found' });
  res.json({ book: manifest });
});
```
(Reach `BookService` the same way the Phase-3 `/world/docs` route in this file already does — match that accessor exactly rather than guessing; the snippet's `??` is a placeholder for "use the existing pattern in this file.")

Compile-path plumbing (`documents.routes.ts`, the project compile handler at ~lines 700-825 that already builds DOCX **and** EPUB): the project is bound to a book via `project.bookSlug`. Just before the two export calls (line ~786 / ~799), resolve once:
```ts
import { resolveBookAppendix } from '../../services/world-appendix.js';
// …inside the handler, before the DOCX try-block:
let appendix: AppendixEntry[] = [];
try {
  if (project.bookSlug && services.books && services.worlds) {
    appendix = await resolveBookAppendix(services.books, services.worlds, project.bookSlug);
  }
} catch { /* appendix is best-effort back-matter; never block compile */ }
```
Then add `appendix,` to **both** the `generateDocxBuffer({...})` and `generateEpubBuffer({...})` option objects. `services.worlds` is the `WorldService` wired in Phase 1 — confirm its name on the `services` object and match it; if absent the guard skips appendix (fail-soft).

Consumes: `BookService.setAppendix` (Task 3), `resolveBookAppendix` (Task 2), `services.books`, `services.worlds`, `project.bookSlug`.

- [ ] Add the `PUT /api/books/:slug/world/appendix` route to `worlds.routes.ts`, matching the file's existing `BookService` accessor and the Phase-3 `/world/docs` validation/response shape. → `npx tsc --noEmit` → clean.
- [ ] Wire `resolveBookAppendix` + pass `appendix` into both exporter calls in the `documents.routes.ts` compile handler. Add the type-only `AppendixEntry` import if referenced. → `npx tsc --noEmit` → clean.
- [ ] Add a smoke step to the World Repository smoke script (or extend `tests/board-grouping-smoke.sh`-style script if Phase 3 created `tests/world-repo-smoke.sh`): `PUT /api/books/:slug/world/appendix` with a one-entry body → assert 200 and the returned `book.appendix` has length 1; then re-PUT with an empty array → assert 200 and `book.appendix` length 0. Leave-in-place (non-destructive on a throwaway book). If no world-repo smoke script exists yet, add this route check to it; do not block on Phase 6 UI.
- [ ] `npm run test:unit` → all green. `npx tsc --noEmit` → clean.

---

## Verification (whole plan)

- `npm run test:unit` — `tests/unit/world-appendix.test.ts` passes: stripper (codes stripped / attribution + prose kept), resolver (ordered, override title, fail-soft skip, strip-toggle), DOCX returns a Buffer, EPUB has the appendix XHTML + manifest + spine entries.
- `npx tsc --noEmit` — clean across the touched files.
- Manual / smoke: against a book with a bound world and ≥1 `appendixEligible` doc, `PUT …/world/appendix` then compile the bound project → the resulting `.docx` and `.epub` carry the appendix as back-matter with codes stripped and attribution kept.
- At milestone end, write `commit_message` (one-line summary + dash detail lines). Do **not** `git commit` / `git push`.

## Self-Review

- **Contract conformance.** Uses `BookManifest.appendix?: Array<{ docId: string; title?: string; order: number }>`, `PUT /api/books/:slug/world/appendix`, `WorldService.getDocument`, `WorldDocMeta`, `WorldDocument`, `LibraryWorld.stripCodesInAppendix`, `templates/world/` snapshot — all exactly as named in the index/contract. No new contract names invented. The one genuinely new symbol set (`AppendixEntry`, `stripAppendixCodes`, `resolveBookAppendix`) is render-internal, not part of the cross-phase contract, and lives in a new `world-appendix.ts` — no collision.
- **Dependencies honored.** Phase 1 (parsers, `WorldService`, `stripCodesInAppendix`) and Phase 3 (`appendix?`/`worldDocs?` on the manifest, `templates/world/` snapshot, `worlds.routes.ts`) are consumed, not re-created. Task 3 guards the `BookManifest.appendix?` declaration so the plan still works whether Phase 3 has or hasn't already landed the field.
- **Simplicity.** No new dependency; reuses `docx`, `adm-zip`, `parseMarkdownToDocx`, `markdownToXhtml`, `escapeXml`, and the existing back-matter/About-page idioms verbatim. The stripper is one regex over lines; the resolver is snapshot-then-live with a fail-soft skip; the route mirrors `/world/docs`. No appendix-doc snapshotting is added — render resolves from the existing `templates/world/` snapshot or the live world, per the contract's "keep it simple" guidance.
- **Independence of bible vs appendix.** `resolveBookAppendix` reads `manifest.appendix` only — never `worldDocs` — so a doc can be in one, both, or neither. Eligibility (`appendixEligible: true`) is a UI/candidate-pool concern (Phase 6) and is not re-enforced at render: by the time a docId is in `appendix[]` the author has selected it, and re-filtering at render could silently drop a deliberately chosen doc.
- **Codes stripped, attribution kept.** `stripAppendixCodes` removes `Classification:`/`Distribution:`/`Access Level:`/`Clearance:` lines and nothing else; the `Compiled by…` attribution line is preserved (it does not match the code-line regex) and is rendered as a distinct italic line above the body. Stripping is gated on `stripCodesInAppendix !== false` (default-on, matching the contract default).
- **Test honesty.** The DOCX render can't be asserted on binary contents, so its test only asserts a non-empty Buffer + no-throw (noted explicitly in Task 4); the meaningful render assertions live on the resolver (ordered `{title, attribution, body}`) and on the EPUB (zip entries are readable via `adm-zip`, so heading/attribution/body/manifest/spine are all asserted). This is the strongest set of assertions feasible per format.
- **Fail-soft.** Missing world, missing docId, unreadable snapshot, and AI-free resolution all degrade to "fewer/no appendix entries" with a warn, never a throw; the compile handler wraps `resolveBookAppendix` in try/catch so back-matter never blocks a manuscript export. Matches the `index.ts`/`BookService` posture.
- **Surgical.** Edits are additive: one new options field per exporter, one render block per exporter (after existing back-matter, before doc build), one new route, one resolve-and-pass insertion in the compile handler, one new service method. No existing behavior changes when `appendix` is absent (`undefined`/empty → no-op).
- **Open assumption surfaced.** The exact accessor for `BookService` and `WorldService` inside `worlds.routes.ts` / `documents.routes.ts` (`gateway.books` vs `gateway.getBooks()` vs `services.books`/`services.worlds`) must match what Phase 1/3 wired — the plan instructs matching the existing in-file pattern rather than asserting one, since that wiring is established by the earlier phases, not this one.
