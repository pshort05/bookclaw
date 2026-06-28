# Pro Publishing Last Mile — Design Spec

**Date:** 2026-06-28
**Status:** Approved scope — "Finisher + unified Launch page" (no print-interior PDF)
**Owner ask:** Port the Python `WritingUtils` DOCX finisher (`~/data/Writing/AI-Tools/WritingUtils/src/writing_utils/clean_docx.py`) to TypeScript, add it as a BookClaw service, and create a new studio page exposing its options. Bundle a unified **Launch** page that wires the *already-existing* launch/export/calendar/ads services into one screen.

---

## 1. Goal

Give an author a "last mile" surface that turns a finished manuscript into a KDP-ready package:

1. **Format Finisher** — take an existing `.docx` (the book's compiled manuscript, or any uploaded `.docx`) and apply print/KDP finishing: remove blank-paragraph cruft, page-break before chapters, scene-break rules → `* * *`, KDP TOC fix, first-line indents, drop-cap chapter initials, document-wide font conversion, line spacing, excerpt block-indent, font resize — all over an optional chapter range. Output a new finished `.docx`. **This is a faithful TypeScript port of `clean_docx.py`.**
2. **Launch** — one page that surfaces the existing 90-day Launch Orchestrator, Release Calendar, AMS ad-copy, and DOCX/EPUB export, so the author drives compile → metadata → cover → ad-copy → calendar → launch-plan from a single screen, with every irreversible action routed through the existing confirmation gate.

**Explicitly out of scope (deferred, tracked in `docs/TODO.md`):** print-interior PDF generation. The Python tool emits print-ready *DOCX*, not PDF; no PDF library is present; a from-scratch typesetter is a separate project.

---

## 2. Non-goals / what already exists (do NOT rebuild)

- `docx-export.ts` (`generateDocxBuffer`) — builds a DOCX *from markdown*. The finisher is the opposite: it *edits an existing* DOCX. Keep both.
- `epub-export.ts`, `launch-orchestrator.ts`, `release-calendar.ts`, `ams-ads.ts` and their routes (`/api/launches/*`, `/api/calendar/*`, `/api/ams/*`, `/api/kdp/export-blurb`, export routes) already exist. The Launch page is a **UI over these endpoints** — no new orchestration logic, no new persistence.

---

## 3. Architecture

### 3.1 Finisher engine (new)

`gateway/src/services/format-finisher/` (focused modules, each one responsibility):

- **`ooxml.ts`** — low-level Office-Open-XML helpers, the only place that knows the `w:` namespace. Loads a `.docx` Buffer (via `adm-zip`, already a dependency) into parsed XML documents for `word/document.xml`, `word/styles.xml`, `word/settings.xml`, `word/fontTable.xml`, `word/_rels/fontTable.xml.rels`; serializes them back into a new `.docx` Buffer preserving all other entries. Parsing/serialization via **`@xmldom/xmldom`** (new dependency — pure-JS, MIT, builds in Docker; DOM API parallels python-docx/lxml). Exposes: the `W` namespace constant; `el(doc, 'p')` / `els(node, 'tag')` (namespaced create/query); `getOrCreatePPr(p)` / `getOrCreateRPr(r)`; EMU/point/half-point conversions (`914400` EMU per inch, `12700` per point; sizes in `w:sz` are half-points); paragraph helpers (`paraText`, `paraStyleName`, `isHeading`, `isHeading1`, `isEmptyPara`, `hasPageBreak`, `hasBottomBorder`, run-font inspection).
- **`transforms.ts`** — the 13 transforms as **pure functions** `(ctx) => void` mutating the parsed DOM, where `ctx` carries the documents + the resolved `[startIdx, endIdx)` paragraph range + the transform's options. One function per feature, named for its YAML key. No file I/O.
- **`range.ts`** — `resolveRange(paragraphs, start?, end?)` → `[startIdx, endIdx)` by case-insensitive heading-text substring match (`end` exclusive). Re-resolved between transforms that change paragraph count (matches the Python re-index behavior).
- **`finisher.ts`** — `FormatFinisher` service. `finish(buffer, options): Buffer` runs the enabled transforms in the **fixed Python order** (toc → hrules → clean → page-breaks → indent → excerpt → chapter-initial → line-spacing → fix-first-paragraph → space-after → font-to → font-sub → font-size-change), re-resolving the range between count-changing steps. `finishBookFile(slug, inputRelPath, options): { outputPath }` reads the input from the book's `data/` dir (confined via the existing `mapRunnerPath` from `runner-files.ts`), runs `finish`, writes the output `.docx` into `data/` (default name `<base> - finished.docx`, or `options.output`), returns the relative path.
- **`markdown.ts`** — port of `clean_markdown.py` (blank-line + first-line-indent rules). Small; reused by the finisher for `.md` inputs and exposed as an option. *(Optional — include if cheap; the core ask is DOCX.)*

**Strip-embedded-fonts** (`strip_embedded_fonts.py`) folds into `ooxml.ts` as an option (`strip-embedded-fonts`): drop `word/fonts/*.odttf`, scrub `embed*` elements + duplicate font entries from `fontTable.xml`, remove `w:embedTrueTypeFonts` from `settings.xml`, empty `fontTable.xml.rels`.

### 3.2 Finisher option schema (the UI ⇄ API contract)

Mirrors the YAML keys exactly, in a typed `FinishOptions`:

```ts
interface FinishOptions {
  range?: { start?: string; end?: string };
  clean?: boolean;
  pageBreaks?: boolean;
  fixHrules?: boolean;
  fixToc?: boolean;
  indentParagraphs?: boolean;
  fixFirstParagraph?: boolean;
  lineSpacing?: number;            // multiplier, e.g. 1.15
  spaceAfter?: number;             // × font size
  excerptFont?: string;
  chapterInitial?: { font: string; size: number };  // size in pt
  fontTo?: string;
  fontSkip?: string[];
  fontSub?: { from: string; to: string; color?: string };
  fontSizeChange?: { from: number; to: number };     // pt
  stripEmbeddedFonts?: boolean;
  output?: string;                 // output filename (defaults to "<base> - finished.docx")
}
```

### 3.3 Routes (new) — `gateway/src/api/routes/format-finisher.routes.ts`

- `POST /api/books/:slug/format-finish` — body `{ path, options }`. Confines `path` to `data/|templates/` via `mapRunnerPath`; rejects non-`.docx` (400); applies; writes the finished `.docx` into `data/`; returns `{ outputPath, bytes }`. 503 if the service is absent (fail-soft pattern). Uses the existing book-resolution + sandbox conventions from `books.routes.ts`.
- The page lists candidate `.docx` files via the **existing** `GET /api/books/:slug/runner-files` (filter to `.docx` client-side) and downloads outputs via the **existing** `GET /api/books/:slug/file?path=…&download=1`. No new list/download endpoints.

Mounted in `gateway/src/api/routes.ts` via `mountFormatFinisher(app, gateway, baseDir)`, following the established pattern. Service wired in `gateway/src/index.ts` in a Phase block and exposed through `getServices()`.

### 3.4 Launch page API

No new endpoints. The page composes existing ones: `/api/launches/*` (orchestrator CRUD + `propose-step`), `/api/calendar/*` (+ `price-pulse-plan`, `export.ics`), `/api/ams/propose-campaigns` + `/api/bookbub/draft`, `/api/kdp/export-blurb`, and the existing DOCX/EPUB export/compile path. Irreversible steps already create confirmation-gate requests server-side; the page links to `/confirmations`.

### 3.5 Frontend

- **Route:** `/publish` → `frontend/studio/src/routes/Publish.tsx` (+ `Publish.module.css`), registered in `main.tsx`; nav item "Publish" in `Rail.tsx` under the **Make** group (book icon → use a distinct paper/launch glyph).
- **Book selector** at top (defaults to active book, same TryFail/StructureLength/Files pattern: `useActiveBook` + fallback to first book).
- **Two sections (tabs):**
  - **Format Finisher** — a `.docx` picker (from runner-files), a form of all `FinishOptions` (checkboxes for booleans; number inputs for spacing/sizes; text inputs for fonts; a skip-list editor; start/end range inputs), a **Run** button → calls `format-finish`, shows the output path + a **Download** link (reusing `downloadFile` from `filesExplorerApi.ts`, token-in-header). Disabled until a `.docx` is selected.
  - **Launch** — compile/export buttons (DOCX, EPUB), a metadata form (title/subtitle/blurb → `kdp/export-blurb` for the character-limit check), ad-copy (AMS `propose-campaigns`, BookBub `draft`), calendar (`price-pulse-plan` preview + **Download .ics**), and the launch plan (list `launches`, `propose-step` → routed to Confirmations). Read-mostly; all writes that touch the outside world go through the confirmation gate.
- Reuse `@bookclaw/shared` `api`, `apiBase`, `authToken`, `useBooks`, `useActiveBook`, `useStore`, `Button`, `useDialog`.

---

## 4. Data flow (Finisher)

```
UI: pick book → pick data/<x>.docx → set options → Run
  → POST /api/books/:slug/format-finish {path, options}
    → mapRunnerPath confines path to data/|templates/   (reject else → 400)
    → read buffer from disk
    → FormatFinisher.finish(buffer, options):
        load zip (adm-zip) → parse document.xml/styles.xml/... (@xmldom)
        resolve range
        for each enabled transform in fixed order: mutate DOM; re-resolve range if it changed counts
        serialize docs back into the zip → output Buffer
    → write data/<base> - finished.docx
    → { outputPath, bytes }
  → UI shows Download link → GET …/file?path=…&download=1 (Blob, auth header)
```

## 5. Error handling

- Non-`.docx` input or path outside `data/|templates/` → **400** (never touch the file).
- A corrupt/unreadable `.docx` (zip or XML parse failure) → **422** with a clear message; the input is never modified (output is always a *new* file).
- Missing service → **503** (fail-soft, matches the gateway convention).
- Transforms are defensive: a feature whose target elements are absent is a no-op, never throws (mirrors the Python "all features optional and combinable").
- Output never overwrites the input; if the chosen output name already exists, suffix `-2`, `-3`, … (no silent clobber — same posture as the Files-explorer upload 409 rule, but here we auto-suffix because the output is derived, not user content).

## 6. Testing

**Unit (TDD, `node --test` via `tsx`, `tests/unit/`):** the transforms are pure DOM mutations — test each against a hand-built minimal WordprocessingML `document.xml` string and assert the post-transform XML. Cover: clean removes blank `w:p` but keeps bordered/heading ones; page-break inserts one `w:br w:type=page` and is idempotent; fix-hrules emits centered `* * *` for a body-context rule and a bottom border for a chapter-context rule; fix-toc unwraps the `w:sdt`; indent sets `w:firstLine` and skips heading/centered/first-after-heading; chapter-initial splits the first run and styles the initial; line-spacing/space-after set the right `w:spacing`; font-to converts all four `w:rFonts` attrs and honors the skip list; font-size-change rewrites `w:sz`/`w:szCs`; range resolution is inclusive-start/exclusive-end and case-insensitive. Round-trip test: load a tiny real fixture `.docx`, finish with all options off, assert byte-identical body (no-op safety). Plus the EMU/point conversions.

**Smoke (`tests/`, real running gateway):** extend the prompt-runner smoke (it already creates a book + writes files) **or** add `tests/format-finisher-smoke.sh`: create a book, drop a small `.docx` into `data/` (generate one via the existing `docx-export` compile or upload a fixture), `POST format-finish` with a representative option set, assert `200` + the finished `.docx` appears in `runner-files` + is downloadable + is a valid zip; assert a non-`.docx` path → 400 and an out-of-tree path → 400. `-v` streams the server log (per the Testing SOP). Self-cleaning (deletes the book).

**Debug:** the service accepts a `log?: (msg) => void` sink (default no-op); the smoke's `-v` surfaces it.

## 7. Build order / dependencies

- New dependency: `@xmldom/xmldom` (+ `@types/xmldom` if needed) — one pure-JS package, added to root `package.json`, available in the Docker builder. Justified by Build-Order rung 4 (no stdlib/native XML-DOM editor; string/regex editing of OOXML is the fragile path the Python tool explicitly avoids via lxml).
- Reuse `adm-zip` (present) for the zip layer, exactly as `epub-export.ts` does.

## 8. Decisions (do not re-litigate)

- **No PDF** (owner choice 2026-06-28).
- **Edit-in-place model:** the finisher mutates a *copy* of an existing `.docx`; it does not regenerate from markdown (that's `docx-export.ts`).
- **`@xmldom/xmldom`** over regex/string editing or a heavier toolkit — DOM parity with the Python source, minimal footprint.
- **Launch page is glue**, not new backend logic — every external side effect stays behind the existing confirmation gate.
- **Output is a new file**, auto-suffixed on collision; inputs are never modified.
```