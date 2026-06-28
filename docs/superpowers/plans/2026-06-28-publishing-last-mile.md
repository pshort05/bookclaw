# Pro Publishing Last Mile — Implementation Plan

> **For agentic workers:** Implement task-by-task with TDD. Steps use `- [ ]` checkboxes.

**Goal:** Port the Python `clean_docx.py` DOCX finisher to a TypeScript BookClaw service + a new "Publish" studio page (Format Finisher + a unified Launch surface over existing services).

**Architecture:** New `gateway/src/services/format-finisher/` (ooxml loader + pure DOM transforms + orchestrator), a new route module, a wired service, and a `Publish.tsx` studio route. Launch section is glue over existing `/api/launches|calendar|ams|kdp` endpoints.

**Tech Stack:** TypeScript (NodeNext, `.js` imports), `adm-zip` (present) for the `.docx` zip, **`@xmldom/xmldom`** (new) for OOXML DOM, React/Vite studio, `node --test` via `tsx`.

## Progress (resume marker — updated 2026-06-28, post-review)

- **Tasks 1–12 DONE + code review (Task 13 a) DONE + all 10 findings fixed.** Engine, route (+`finish-upload`), wiring, Publish page. High-effort workflow review (`wf_0054faf2-27c`) confirmed 10 findings — ALL FIXED: font_sub-before-font_to order, drop-cap detection vs real body size (`initialInfo`), TOC bookmark-range front-matter filtering + empty-para drop, scene-marker spacing as a separate `ensureMarkerSpacing` step gated on fixHrules, colour validation (+`green`→00FF00), descendant font detection, strict range (unmatched marker → `FinishInputError`), per-part decompression cap (zip-bomb), `/format-finish` 404-vs-400 book check. New `errors.ts` (shared `FinishInputError`, avoids import cycle).
- **40 unit tests + 10-check smoke pass locally (40/0, 10/0)**; `npx tsc --noEmit` clean; frontend builds clean. Transforms verified in real output XML.
- **ALL 9 GOAL STEPS DONE.** Steps 6–8 completed via the documented deploy mechanism (no git push needed):
  - **Topology clarified:** neptune (this host, 192.168.1.29) and **Mercury (192.168.1.32)** share `/home/paul/data/dev/bookclaw` over NFS (identical `.build-logs/last-build.status`). `touch build_now` → the shared `build-watch.sh` builds the **working tree** and deploys the `bookclaw` test container **on Mercury** (`result=PASS`, image `2026-06-28T05:56`). Neptune production (`bookclaw-writing`) holds neptune's 3847 and was **never touched** — out of scope.
  - **Step 6 deploy:** Mercury `bookclaw` container healthy on `192.168.1.32:3847` with this working tree.
  - **Step 7 smoke:** `BASE_URL=http://192.168.1.32:3847 tests/format-finisher-smoke.sh` → **10/10 PASS**.
  - **Step 8:** no issues surfaced.
  - **Step 9:** `commit_message` written. **Owner still runs `./push.sh`** for version control (commits the working tree to git) — separate from the Mercury runtime deploy, which is already live. Do NOT deploy to Neptune/production.

## Global Constraints

- Imports use `.js` extensions; Node 22+; fail-soft service init (`503` if absent).
- The finisher **edits a copy** of an existing `.docx`; it never regenerates from markdown and never modifies the input file.
- Path inputs confined to `data/|templates/` via `mapRunnerPath`; non-`.docx` → 400; out-of-tree → 400; parse failure → 422.
- Transforms are pure DOM mutations and no-op when their targets are absent (never throw).
- Fixed transform order (Python): toc → hrules → clean → pageBreaks → indent → excerpt → chapterInitial → lineSpacing → fixFirstParagraph → spaceAfter → fontTo → fontSub → fontSizeChange → stripEmbeddedFonts.
- EMU/units: 914400 EMU/inch, 12700 EMU/pt; `w:sz`/`w:szCs` are half-points (pt×2); `w:firstLine`/`w:ind` in twips (1440/inch); line `w:spacing w:line` in 240ths for `auto`, twips for `atLeast`.

---

### Task 1: Dependency + OOXML loader/serializer

**Files:**
- Modify: `package.json` (add `@xmldom/xmldom`)
- Create: `gateway/src/services/format-finisher/ooxml.ts`
- Test: `tests/unit/ooxml.test.ts`

**Interfaces — Produces:**
- `W` (the wordprocessingml namespace URI string).
- `class DocxPackage { documentXml: Document; stylesXml: Document|null; settingsXml: Document|null; fontTableXml: Document|null; static load(buf: Buffer): DocxPackage; toBuffer(): Buffer; }` — keeps the `AdmZip` instance + parsed DOMs, serializes changed parts back on `toBuffer()`.
- Helpers: `wq(name)` (returns `['w', name]` style is unnecessary — use NS); `createW(doc, local): Element`; `childrenByTag(node, local): Element[]` (namespaced, direct + descendant variants `descByTag`); `getOrCreatePPr(p): Element`; `getOrCreateRPr(r): Element`; `bodyParagraphs(doc): Element[]`; `paraText(p): string`; `paraStyle(p): string`; `isHeading(p): boolean`; `isHeading1(p): boolean`; `isEmptyPara(p): boolean`; `hasPageBreak(p): boolean`; `hasBottomBorder(p): boolean`; `ptToHalf(pt): number`; `inchToTwip(in): number`.

- [ ] **Step 1: add the dep** — `npm install @xmldom/xmldom` (pure JS). Verify it appears in `package.json` dependencies.

- [ ] **Step 2: failing round-trip test** — `tests/unit/ooxml.test.ts`: build a Buffer with `AdmZip` containing a minimal `word/document.xml` (`<w:document xmlns:w="…"><w:body><w:p><w:r><w:t>hi</w:t></w:r></w:p></w:body></w:document>`), `DocxPackage.load(buf)`, assert `bodyParagraphs(pkg.documentXml).length === 1` and `paraText(p)==='hi'`, then `toBuffer()` reloads to the same text. Run: `node --test tests/unit/ooxml.test.ts` → FAIL (module missing).

- [ ] **Step 3: implement `ooxml.ts`** — `DocxPackage.load` reads `word/document.xml` (+ optional styles/settings/fontTable) from the zip and parses with `new DOMParser().parseFromString(xml, 'text/xml')`; throw a tagged `DocxParseError` on missing `document.xml` or parser error nodes. `toBuffer()` serializes each non-null parsed doc with `new XMLSerializer().serializeToString(doc)`, `zip.updateFile` for changed entries, `zip.toBuffer()`. Implement the helpers using `getElementsByTagNameNS(W, local)` and namespaced `createElementNS(W, 'w:'+local)`.

- [ ] **Step 4: run tests** → PASS.
- [ ] **Step 5: commit** (`commit_message` is repo-level; in this workflow we commit at the end — skip per-task git, just keep the working tree coherent).

---

### Task 2: Range resolution + shared paragraph predicates

**Files:** Create `gateway/src/services/format-finisher/range.ts`; Test `tests/unit/finisher-range.test.ts`.

**Interfaces — Produces:** `resolveRange(paras: Element[], start?: string, end?: string): [number, number]` — start = index of first heading whose text contains `start` (ci), default 0; end = index of first heading (at/after start) whose text contains `end` (ci), default `paras.length`; `[start, end)`.

- [ ] **Step 1: failing tests** — headings "Prologue", body, "Chapter 1", body, "Appendix"; `resolveRange(p,'chapter 1','appendix')` → `[2,4]`; no args → `[0,len]`; unmatched start → `[0,…]`.
- [ ] **Step 2: run** → FAIL.
- [ ] **Step 3: implement** using `isHeading`/`paraText` from `ooxml.ts`.
- [ ] **Step 4: run** → PASS.

---

### Task 3: transforms — `clean` + `pageBreaks`

**Files:** Create `gateway/src/services/format-finisher/transforms.ts` (grows across Tasks 3–7); Test `tests/unit/finisher-clean-pagebreaks.test.ts`.

**Interfaces — Produces (in transforms.ts):**
`interface Ctx { pkg: DocxPackage; paras: Element[]; range: [number, number]; opts: FinishOptions }`
`clean(ctx): void` and `pageBreaks(ctx): void`. (`FinishOptions` type lives in `finisher.ts`, Task 8; for now declare a local minimal interface and widen in Task 8, OR put `FinishOptions` in a `types.ts` created here — **create `types.ts` now** with the full `FinishOptions` from the spec to avoid churn.)

- [ ] **Step 1: create `types.ts`** with the full `FinishOptions` interface (spec §3.2).
- [ ] **Step 2: failing tests** — `clean`: body with two consecutive empty `w:p` between content → collapses to keeping one removed (1 left? Python keeps first of a run, removes rest → both empties removed except the first? Re-check: "runs of 2+ consecutive empty paragraphs — keeps first, removes rest"; a single empty between content is removed). Assert: 3 empties between paras → 2 removed; a bordered empty `w:p` (has `w:pBdr/w:bottom`) is kept; a Heading1 empty is removed. `pageBreaks`: inserts exactly one `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` before each non-empty Heading1; idempotent (second run adds none).
- [ ] **Step 3: run** → FAIL.
- [ ] **Step 4: implement** `clean` (remove qualifying empties via `node.parentNode.removeChild`; clear `w:spacing` overrides on non-heading paras in range) and `pageBreaks` (build the break `w:p`, `insertBefore` the heading; skip if previous sibling already has a page break).
- [ ] **Step 5: run** → PASS.

---

### Task 4: transforms — `fixHrules` + `fixToc`

**Files:** Modify `transforms.ts`; Test `tests/unit/finisher-hrules-toc.test.ts`.
**Produces:** `fixHrules(ctx): void`, `fixToc(ctx): void`.

- [ ] **Step 1: failing tests** — `fixHrules`: a body-context HR (`w:r` containing `mc:AlternateContent`, preceded by body text) → that run removed, paragraph becomes centered with a single `* * *` run; a chapter-context HR (preceded by Heading1 + only title-component paras) → paragraph gets a `w:pBdr/w:bottom` border and no `* * *`. An empty Heading2 separator → bottom border added. `fixToc`: a `w:sdt` whose `w:instrText` contains "TOC" → its `w:sdtContent` paragraphs are moved into `w:body` before the sdt (field-instruction-only runs stripped) and the sdt removed.
- [ ] **Step 2: run** → FAIL.
- [ ] **Step 3: implement** per the capability map (border XML: `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A0A0A0"/></w:pBdr>` + `<w:ind w:left="0" w:right="0"/>`; classification by scanning backward over empty/title-component paras). For `fixToc`: locate sdt via descendant `w:instrText` text includes "TOC"; strip runs that have `w:fldChar`/`w:instrText` but no `w:t`; move kept `w:p` before the sdt; remove sdt. (Bookmark-range filtering of TOC entries is **best-effort**: if anchors can't be resolved, keep all entries — log it. This avoids porting the full bookmark index in v1; note as a known simplification.)
- [ ] **Step 4: run** → PASS.

---

### Task 5: transforms — `indentParagraphs` + `excerpt` + `chapterInitial`

**Files:** Modify `transforms.ts`; Test `tests/unit/finisher-indent-initial.test.ts`.
**Produces:** `indentParagraphs(ctx)`, `excerpt(ctx)` (uses `opts.excerptFont`), `chapterInitial(ctx)` (uses `opts.chapterInitial`).

- [ ] **Step 1: failing tests** — `indentParagraphs`: sets `w:ind w:firstLine="360"` (0.25" = 360 twips) on a plain left body paragraph; skips headings, centered paras, all-bold/italic "title component" paras, and the first body paragraph after a heading. `excerpt`: a paragraph whose run `w:rFonts` matches `excerptFont` → `w:ind w:left/right="720"` (0.5") on it + a blank `w:p` inserted before/after. `chapterInitial`: first body para after a Heading1, first char split into its own run with `w:rFonts w:ascii=font` + `w:sz`/`w:szCs` = size×2.
- [ ] **Step 2: run** → FAIL.
- [ ] **Step 3: implement** the skip state machine (track "just saw a heading" → skip next body para) shared with `chapterInitial`; run-font inspection helper `runFont(r)`.
- [ ] **Step 4: run** → PASS.

---

### Task 6: transforms — `lineSpacing` + `fixFirstParagraph` + `spaceAfter`

**Files:** Modify `transforms.ts`; Test `tests/unit/finisher-spacing.test.ts`.
**Produces:** `lineSpacing(ctx)`, `fixFirstParagraph(ctx)`, `spaceAfter(ctx)`.

- [ ] **Step 1: failing tests** — `lineSpacing(1.5)`: non-heading paras get `w:spacing w:line="360" w:lineRule="auto"` (240×1.5); a paragraph whose first run size ≥1.4× body uses `lineRule="atLeast"` with computed twip height. `spaceAfter(0.25)`: `w:spacing w:after` = round(0.25 × bodySizeTwips) on non-empty body paras; empties untouched. `fixFirstParagraph`: only the first body para after a Heading1 that contains an initial gets atLeast spacing.
- [ ] **Step 2: run** → FAIL.
- [ ] **Step 3: implement** with the body-size resolution chain (run → style → 12pt). Reuse a `setSpacing(p, {line?, lineRule?, after?})` helper that gets/creates the single `w:spacing` child of `w:pPr`.
- [ ] **Step 4: run** → PASS.

---

### Task 7: transforms — `fontTo` + `fontSub` + `fontSizeChange` + `stripEmbeddedFonts`

**Files:** Modify `transforms.ts` (+ `ooxml.ts` for the strip helper); Test `tests/unit/finisher-fonts.test.ts`.
**Produces:** `fontTo(ctx)`, `fontSub(ctx)`, `fontSizeChange(ctx)`, and `stripEmbeddedFonts(pkg)` in `ooxml.ts`.

- [ ] **Step 1: failing tests** — `fontTo('Times New Roman', skip:['Roboto Mono'])`: every `w:rFonts` (in document + styles) has all four attrs (`w:ascii/hAnsi/cs/eastAsia`) set to TNR, except an element with any attr = "Roboto Mono" which is untouched. `fontSizeChange(9→11)`: `w:sz`/`w:szCs` with `w:val="18"` become `"22"`. `fontSub('A'→'B', color '000000')`: matching `w:rFonts` retargeted + `w:color w:val="000000"` set on its `w:rPr`.
- [ ] **Step 2: run** → FAIL.
- [ ] **Step 3: implement** (document-wide: query both `documentXml` and `stylesXml`). `stripEmbeddedFonts`: in `DocxPackage`, drop `word/fonts/*.odttf` zip entries, scrub `w:embedRegular|Bold|Italic|BoldItalic` + dedupe `w:font` by name in `fontTableXml`, remove `w:embedTrueTypeFonts` from `settingsXml`, replace `word/_rels/fontTable.xml.rels` with an empty Relationships doc.
- [ ] **Step 4: run** → PASS.

---

### Task 8: `FormatFinisher` orchestrator + `finishBookFile`

**Files:** Create `gateway/src/services/format-finisher/finisher.ts` + `index.ts` (barrel); Test `tests/unit/finisher-orchestrate.test.ts` + a tiny fixture `tests/fixtures/sample.docx` (generate in the test via `AdmZip` from a known `document.xml`, not committed as binary).
**Produces:** `class FormatFinisher { constructor(deps:{ books:any; log?:(m:string)=>void }); finish(buf: Buffer, opts: FinishOptions): Buffer; finishBookFile(slug: string, inputRel: string, opts: FinishOptions): { outputPath: string; bytes: number } }`.

- [ ] **Step 1: failing tests** — (a) `finish(buf, {})` (all off) returns a Buffer whose body text equals the input (no-op safety). (b) `finish(buf, {pageBreaks:true, lineSpacing:1.5})` applies both and re-parses cleanly. (c) order: with `clean` + `fixHrules` both on, hrules runs before clean (assert `* * *` survives + blanks inserted). (d) `finishBookFile` writes `<base> - finished.docx` into a temp book `data/` and returns its rel path; collision auto-suffixes `-2`.
- [ ] **Step 2: run** → FAIL.
- [ ] **Step 3: implement** — `finish`: `DocxPackage.load`; `paras = bodyParagraphs`; run enabled transforms in the fixed order, re-computing `paras` + `resolveRange` before each transform (cheap; matches Python re-index); `stripEmbeddedFonts` last; `toBuffer()`. `finishBookFile`: resolve `bookDir = books.bookDir(slug)` (404 semantics handled at route), `mapRunnerPath` the input, reject non-`.docx`, read with `fs.readFileSync`, `finish`, pick output name (`opts.output` || `<base> - finished.docx`, auto-suffix on exists), `fs.writeFileSync` into the input's `baseDir`, return `{ outputPath: 'data/'+name, bytes }`.
- [ ] **Step 4: run** → PASS.

---

### Task 9: Route module + mount + service wiring

**Files:** Create `gateway/src/api/routes/format-finisher.routes.ts`; Modify `gateway/src/api/routes.ts` (import + `mountFormatFinisher(...)`); Modify `gateway/src/index.ts` (instantiate `FormatFinisher`, add to `getServices()`).

- [ ] **Step 1:** write `mountFormatFinisher(app, gateway, _baseDir)` with `POST /api/books/:slug/format-finish`: `services.formatFinisher` (503 if absent); resolve `bookDir = services.books.bookDir(slug)` (404 if no `book.json`); validate body `{ path: string, options: FinishOptions }`; reject non-`.docx` path (400) and out-of-`data|templates` (400 via `mapRunnerPath` null); `try { const r = svc.finishBookFile(slug, path, options); res.json(r) } catch(e){ 422 on DocxParseError else 500 }`.
- [ ] **Step 2:** mount it in `routes.ts` alongside the other `mount*` calls.
- [ ] **Step 3:** in `index.ts`, instantiate `new FormatFinisher({ books: this.bookService })` in a Phase block (after BookService exists) and add `formatFinisher` to the services object returned by `getServices()`.
- [ ] **Step 4: type-check** — `npx tsc --noEmit` → clean.

---

### Task 10: Studio "Publish" page — Format Finisher section + nav

**Files:** Create `frontend/studio/src/routes/Publish.tsx` + `Publish.module.css` + `frontend/studio/src/lib/publishApi.ts`; Modify `frontend/studio/src/main.tsx` (route `/publish`) + `frontend/studio/src/Rail.tsx` (nav item under "Make").

**Interfaces — Produces (publishApi.ts):** `finishDocx(slug, path, options): Promise<{outputPath,bytes}>`; re-export `downloadFile`, `listBookFiles` from `filesExplorerApi.ts`; `FinishOptions` type (mirror the gateway type in the shared frontend, since `@bookclaw/shared` isn't where this lives — keep a local copy).

- [ ] **Step 1:** `publishApi.ts` — `finishDocx` posts to `/api/books/:slug/format-finish`. 
- [ ] **Step 2:** `Publish.tsx` — book selector (active-book default), tab state `'finish'|'launch'`. **Finish tab:** load `runner-files`, filter `.docx`, a `<select>` of them; an options form (checkboxes: clean/pageBreaks/fixHrules/fixToc/indentParagraphs/fixFirstParagraph/stripEmbeddedFonts; number inputs: lineSpacing, spaceAfter, chapterInitial.size, fontSizeChange.from/to; text inputs: chapterInitial.font, fontTo, excerptFont, fontSub.from/to/color, range.start/end; a comma-split fontSkip text input); a **Run** button (disabled until a `.docx` is picked) → `finishDocx` → show output path + a Download button (`downloadFile(bookFilePath(slug,outputPath), name)`); error line.
- [ ] **Step 3:** wire `/publish` route in `main.tsx`; add the "Publish" `NavLink` in `Rail.tsx` under the **Make** label (distinct glyph).
- [ ] **Step 4: build** — `npm run build:frontend` (or the studio build) → no TS/Vite errors.

---

### Task 11: "Publish" page — Launch section (glue over existing endpoints)

**Files:** Modify `Publish.tsx` (+ `publishApi.ts`).

- [ ] **Step 1:** `publishApi.ts` add thin wrappers: `compileExport` (existing export/compile endpoint for DOCX/EPUB), `listLaunches`/`createLaunch`/`proposeLaunchStep` (`/api/launches*`), `pricePulsePlan` + `icsUrl` (`/api/calendar/price-pulse-plan`, `/api/calendar/export.ics`), `proposeAmsCampaigns` (`/api/ams/propose-campaigns`), `bookbubDraft` (`/api/bookbub/draft`), `kdpBlurb` (`/api/kdp/export-blurb`).
- [ ] **Step 2:** **Launch tab** in `Publish.tsx`: buttons/cards for Compile (DOCX/EPUB → Download), Metadata blurb check (textarea → `kdpBlurb` → shows length/limit), Ad-copy (AMS propose + BookBub draft → render results read-only), Calendar (price-pulse preview table + **Download .ics**), Launch plan (list launches; "Propose next step" → notes it lands in `/confirmations`, link there). All external side-effects rely on the server-side confirmation gate; the UI only *proposes*.
- [ ] **Step 3: build** → clean. Manual sanity: page renders, both tabs switch, finisher Run works against a deployed book.

---

### Task 12: Smoke test

**Files:** Create `tests/format-finisher-smoke.sh` (model on `tests/prompt-runner-smoke.sh`).

- [ ] **Step 1:** create a book; produce a small `.docx` in `data/` (compile via the existing export path, or `PUT` a fixture `.docx` base64 — simplest: have the gateway compile, else upload a tiny generated `.docx`). 
- [ ] **Step 2:** `POST /api/books/:slug/format-finish` with `{path:"data/<x>.docx", options:{clean:true,pageBreaks:true,fixHrules:true,lineSpacing:1.15,indentParagraphs:true}}` → assert `200` + `outputPath` present; assert it appears in `runner-files`; download it and assert it's a non-empty valid zip (`unzip -l` or magic bytes `PK`).
- [ ] **Step 3:** negative: `path:"data/x.txt"` → 400; `path:"book.json"` / `config/...` → 400.
- [ ] **Step 4:** self-clean (DELETE the book). `-v` streams the server log.
- [ ] **Step 5:** run it against a local boot (`npm start`) or Mercury (Task: deploy then run).

---

### Task 13: Deploy + run + fix + commit message

- [ ] Deploy to Mercury (`touch build_now`, push; watcher rebuilds; check `.build-logs/last-build.status` PASS).
- [ ] Run `tests/format-finisher-smoke.sh` + the existing smokes against Mercury.
- [ ] Fix anything the smoke surfaces.
- [ ] Write `commit_message` (repo convention; the maintainer runs `./push.sh`).

## Self-review notes
- Spec coverage: all 13 transforms (Tasks 3–7) + orchestration (8) + route (9) + UI finish (10) + launch glue (11) + tests (1–8,12). ✓
- Known simplification (flagged): `fixToc` bookmark-range filtering is best-effort in v1 (keeps all entries if anchors don't resolve). Acceptable — the common KDP use is the SDT-unwrap, not front-matter pruning.
- Type consistency: `FinishOptions` defined once in `types.ts` (Task 3 step 1), imported everywhere.
