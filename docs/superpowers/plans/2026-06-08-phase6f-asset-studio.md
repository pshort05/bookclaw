# Phase 6f — Asset Studio (two-scope editor + re-pull) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the **Asset Studio** — the studio's editing surface. A two-scope editor (shared **Library** overlay vs the **active book's** private snapshot) over the existing Phase 4 + 6e backend: kinds rail → entry list (with canonical GLOSSARY definitions + per-asset descriptions) → editor (prose markdown for author/voice/genre/section/skill with a multi-file switcher + live preview; structured step editor for pipelines), plus entry create/duplicate/delete (library scope) and the re-pull panel (book scope). Subsumes the legacy `authoring` + `library` panels.

**Architecture:** One React route `/library` on the studio. All actions go through existing endpoints. **First a small backend fix (TDD):** the library create/upsert + book-template PUT routes currently drop `description` (6e wired the service + read path only) — forward it so the editor's description field persists. Markdown preview via the `marked` library (self-hosted, CSP `'self'`). The two-scope rule is the spine: a `scope` state ('library' | 'book') selects which endpoints read/write.

**Tech Stack:** React 18 + Vite + Router + Zustand + `@bookclaw/shared`; `marked` for preview. Server: existing routes (+ the description-forward fix).

**Spec:** concept `dashboard/concept/asset-studio.html` (owner-approved CSS/markup source of truth); `docs/GLOSSARY.md` (canonical defs); 6f outline in `docs/superpowers/plans/2026-06-07-phase6-frontend-rewrite.md`.

---

## Conventions (read once)

- **No git commits during execution** — working tree only; maintainer pushes via `./push.sh`. Review checkpoint per task. On `main` (intended; no branch/worktree).
- **Backend (Task 1) = TDD**; front-end = `tsc` + studio build + manual (no FE test runner).
- **Surgical changes; match existing style.** Port CSS **verbatim** from `dashboard/concept/asset-studio.html` (named classes listed per task). Tokens already in `tokens.css`.
- **Two-scope rule (the spine):** a single `scope: 'library' | 'book'` drives every read/write:
  - **library** → `GET/POST/PUT/DELETE /api/library/...`
  - **book** → `GET/PUT /api/books/active/templates/...` (+ the re-pull panel)
- **Forward-compat:** read the active book only through the store's `useActiveBook()` seam (for the scope toggle's book label); never a module global.
- **Honest scope (deferred, label in-UI):** per-step **model/tier override** dropdowns from the concept are NOT built here (model routing is automatic by `taskType`→tier; per-step model override is a separate feature) — the step editor edits `label`, `taskType`, `skill`, `promptTemplate`, `wordCountTarget`, and add/remove/reorder. `dynamic` pipelines (e.g. `novel-pipeline`) are shown read-only (their steps are generated at create-time). Skills remain read-only here (managed via `/api/skills`); the Asset Studio lists them but edits land in a later pass.

---

## Backend contracts (confirmed; use exactly)

- **Library:** `GET /api/library` → `{kinds, entries:[{kind,name,source,description?}]}`; `GET /api/library/:kind` → `{kind, entries}`; `GET /api/library/:kind/:name` → `{entry: {kind,name,source,description?, files?|content?|pipeline?}}`. `POST /api/library/:kind` body `{name, files?, content?, description?}` → `{success,kind,name,source}` (409 if exists). `PUT /api/library/:kind/:name` body `{files?, content?, description?}`. `DELETE /api/library/:kind/:name` (404 if no overlay). Writable kinds: author/voice/genre/pipeline/section (skills read-only here). `source`: `builtin`|`workspace`|`synthetic`.
- **Book templates:** `GET /api/books/active/templates/:kind/:name?` → `{kind, name?, files?|content?|entries?, wired, description?}` (section w/o name → `{entries:[...], wired}`). `PUT /api/books/active/templates/:kind/:name?` body `{files?, content?, description?}`. (author/voice writes trigger `soul.reload()`.)
- **Re-pull:** `GET /api/books/active/repull` → `{slug, assets:[{kind,name,status,libraryPresent,hasBaseline,wired}]}` with `status` ∈ `in-sync|library-updated|locally-edited|diverged|library-removed|no-baseline`. `POST /api/books/active/repull/:kind/:name` body `{resolution?: 'take-library'|'keep-book'}` (resolution required for pipeline or no-baseline) → `{success, hadConflicts}`.
- **Pipeline JSON:** read from library detail `entry.pipeline` (parsed object: `{schemaVersion, name, label, description, dynamic?, steps:[{label, skill?, toolSuggestion?, taskType, promptTemplate, phase?, wordCountTarget?, chapterNumber?}]}`); from book templates `{content}` (raw JSON string). Write: library PUT/POST body `{content: <raw JSON string>}`; book PUT body `{content}`. Validation requires `schemaVersion` + `steps`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `gateway/src/api/routes/library.routes.ts` | forward `description` in POST + PUT | Modify (lines ~60, ~74) |
| `gateway/src/api/routes/books.routes.ts` | forward `description` in template PUT | Modify (line ~148) |
| `tests/unit/library-description.test.ts` | route-level description round-trip (via service body) | Modify |
| `frontend/studio/package.json` | add `marked` dep | Modify |
| `frontend/shared/src/types.ts` | `LibraryEntryFull`, `LibraryPipeline`/`Step`, `RepullAsset` types | Modify |
| `frontend/studio/src/routes/AssetStudio.tsx` | the route shell: scope toggle + 3-pane + banners + repull | Create |
| `frontend/studio/src/routes/AssetStudio.module.css` | ported concept CSS | Create |
| `frontend/studio/src/components/asset/KindRail.tsx` | kinds rail | Create |
| `frontend/studio/src/components/asset/EntryList.tsx` | entry list + canon def + add/duplicate/delete | Create |
| `frontend/studio/src/components/asset/ProseEditor.tsx` | multi-file md editor + preview + description | Create |
| `frontend/studio/src/components/asset/PipelineEditor.tsx` | structured step editor → JSON | Create |
| `frontend/studio/src/components/asset/RepullPanel.tsx` | re-pull status + execute | Create |
| `frontend/studio/src/lib/assetApi.ts` | scope-aware read/write helpers | Create |
| `frontend/studio/src/main.tsx` | add `/library` route | Modify |
| `frontend/studio/src/Rail.tsx` | Library nav → `/library` | Modify |

---

### Task 1: Forward `description` through the write routes (TDD)

**Files:** Modify `gateway/src/api/routes/library.routes.ts`, `gateway/src/api/routes/books.routes.ts`; Test `tests/unit/library-description.test.ts`.

> The service (`writeEntry`/`createEntry`/`writeTemplate`) already accepts `description` (6e); the routes drop it. There is no HTTP-route test harness, so test at the service-body level: assert that passing `description` through `writeEntry` is what the route must do — but to catch the regression, add a focused assertion that the route call shape includes description. Simplest enforceable test: a unit test that calls the SAME service method the route calls, with the SAME body the (fixed) route builds. Since the route just forwards `req.body`, the meaningful guard is the existing service test (Task already covered in 6e). Therefore: make the fix and add a route-shape guard via a tiny test that documents the contract.

- [ ] **Step 1: Failing test** — append to `tests/unit/library-description.test.ts`: assert writeEntry persists description when given ONLY description (already added in 6e fixes) AND add a guard test that the library PUT body contract includes description by exercising createEntry with `{name, files, description}` and reading it back:
```ts
test('createEntry persists description alongside files (route contract)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libdesc-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    await lib.createEntry('voice', 'breezy', { files: { 'STYLE-GUIDE.md': 'breezy' }, description: 'Light and fast.' });
    await lib.reload();
    assert.equal(lib.list('voice').find((e) => e.name === 'breezy')?.description, 'Light and fast.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run red/confirm** — `node --import tsx --test tests/unit/library-description.test.ts`. (If createEntry already supports description from 6e this passes; the real fix is the ROUTE forwarding — verify by reading the route, see Step 3.)

- [ ] **Step 3: Fix the routes.**
  - `library.routes.ts`: POST handler (~line 60) → `createEntry(kind, name, { files: req.body?.files, content: req.body?.content, description: req.body?.description })`. PUT handler (~line 74) → `writeEntry(kind, String(req.params.name), { files: req.body?.files, content: req.body?.content, description: req.body?.description })`.
  - `books.routes.ts`: template PUT (~line 148) → `writeTemplate(slug, kind as any, name, { files: req.body?.files, content: req.body?.content, description: req.body?.description })`.
  - Confirm `writeTemplate` (book.ts) persists the `description` for author/voice/genre/section (6e Task 3 added this; if it only added it to `readTemplate`, add the write-side sidecar persistence now — TDD it: write a description via writeTemplate, read it back via readTemplate).

- [ ] **Step 4: Green** — `node --import tsx --test tests/unit/*.test.ts` all pass; `npx tsc --noEmit` clean.

- [ ] **Step 5: Review checkpoint** — all three write paths forward description; book-template description write persists + round-trips.

---

### Task 2: `marked` dep + shared types + scope-aware API helper

**Files:** Modify `frontend/studio/package.json`, `frontend/shared/src/types.ts`; Create `frontend/studio/src/lib/assetApi.ts`.

- [ ] **Step 1: Add `marked`.** In `frontend/studio/package.json` dependencies add `"marked": "^12.0.0"`. Run `npm install`. (Self-hosted via the bundle → CSP `'self'` unaffected.)

- [ ] **Step 2: Types.** In `frontend/shared/src/types.ts` append:
```ts
export interface LibraryPipelineStep {
  label: string; skill?: string; toolSuggestion?: string; taskType: string;
  promptTemplate: string; phase?: string; wordCountTarget?: number; chapterNumber?: number;
}
export interface LibraryPipeline {
  schemaVersion: number; name: string; label: string; description: string;
  dynamic?: boolean; steps: LibraryPipelineStep[];
}
export interface LibraryEntryFull extends LibraryEntry {
  files?: Record<string, string>;
  content?: string;
  pipeline?: LibraryPipeline;
}
export type RepullStatus = 'in-sync'|'library-updated'|'locally-edited'|'diverged'|'library-removed'|'no-baseline';
export interface RepullAsset { kind: LibraryKind; name: string; status: RepullStatus; libraryPresent: boolean; hasBaseline: boolean; wired: boolean; }
```

- [ ] **Step 3: `assetApi.ts`** — scope-aware read/write so components don't branch on scope inline:
```ts
import { api, type LibraryEntry, type LibraryEntryFull, type LibraryKind, type RepullAsset } from '@bookclaw/shared';

export type Scope = 'library' | 'book';

export async function listEntries(scope: Scope, kind: LibraryKind): Promise<LibraryEntry[]> {
  if (scope === 'library') {
    const r = await api<{ entries: LibraryEntry[] }>(`/api/library/${kind}`);
    return r.entries ?? [];
  }
  // book scope: sections list comes from the templates endpoint; others are single wired assets
  if (kind === 'section') {
    const r = await api<{ entries?: string[] }>(`/api/books/active/templates/section`);
    return (r.entries ?? []).map((name) => ({ kind, name, source: 'workspace' as const }));
  }
  // author/voice/genre/pipeline/skill: one wired entry named by the book's snapshot
  const t = await api<{ wired: boolean; description?: string }>(`/api/books/active/templates/${kind}`).catch(() => null);
  return t && t.wired ? [{ kind, name: kind, source: 'workspace', description: t.description }] : [];
}

export async function readEntry(scope: Scope, kind: LibraryKind, name: string): Promise<LibraryEntryFull> {
  if (scope === 'library') return (await api<{ entry: LibraryEntryFull }>(`/api/library/${kind}/${encodeURIComponent(name)}`)).entry;
  const seg = kind === 'section' || kind === 'skill' ? `/${encodeURIComponent(name)}` : '';
  const t = await api<any>(`/api/books/active/templates/${kind}${seg}`);
  return { kind, name, source: 'workspace', files: t.files, content: t.content, description: t.description, pipeline: t.content ? safeParse(t.content) : undefined };
}

export async function writeEntry(scope: Scope, kind: LibraryKind, name: string, body: { files?: Record<string,string>; content?: string; description?: string }): Promise<void> {
  if (scope === 'library') { await api(`/api/library/${kind}/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) }); return; }
  const seg = kind === 'section' || kind === 'skill' ? `/${encodeURIComponent(name)}` : '';
  await api(`/api/books/active/templates/${kind}${seg}`, { method: 'PUT', body: JSON.stringify(body) });
}

export const createLibraryEntry = (kind: LibraryKind, name: string, body: object) => api(`/api/library/${kind}`, { method: 'POST', body: JSON.stringify({ name, ...body }) });
export const deleteLibraryEntry = (kind: LibraryKind, name: string) => api(`/api/library/${kind}/${encodeURIComponent(name)}`, { method: 'DELETE' });
export const repullStatus = () => api<{ assets: RepullAsset[] }>(`/api/books/active/repull`);
export const repullExecute = (kind: string, name: string, resolution?: 'take-library'|'keep-book') => api<{ hadConflicts: boolean }>(`/api/books/active/repull/${kind}/${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(resolution ? { resolution } : {}) });

function safeParse(s: string) { try { return JSON.parse(s); } catch { return undefined; } }
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; `npm run -w frontend/studio build` succeeds.

- [ ] **Step 5: Review checkpoint** — the scope branch lives ONLY in `assetApi.ts`; components call scope-agnostic helpers.

---

### Task 3: Asset Studio shell — scope toggle, kinds rail, banners, layout

**Files:** Create `frontend/studio/src/routes/AssetStudio.tsx`, `frontend/studio/src/routes/AssetStudio.module.css`, `frontend/studio/src/components/asset/KindRail.tsx`.

- [ ] **Step 1: Port CSS.** Create `AssetStudio.module.css` from `dashboard/concept/asset-studio.html`: `.topbar`, `.crumb`, `.scope`, `.lab`, `.seg` (+ button `.on`/`.book`), `.banner` (+ `.lib`/`.book`), `.repull` (+ `.ic`/`.tx`), `.work`, `.kinds`, `.lbl`, `.kind` (+ `.on`), `.n`, `.entries`, `.ehead`, `.canon`, `.addnew`, `.kdef`, `.entry` (+ `.on`), `.et`, `.ed`, `.src` (+ `.builtin`/`.yours`/`.book`), `.editor`, `.edhead`, `.meta`, `.acts`, `.descfield`, `.descbox`. Keep declarations verbatim.

- [ ] **Step 2: Canonical defs** — embed the GLOSSARY one-liners as a constant map (Author/Voice/Genre/Pipeline/Section/Skill) for the entry-list header `.kdef` + `.canon` badge. Use the exact text from `docs/GLOSSARY.md`.

- [ ] **Step 3: `AssetStudio.tsx`** — owns `scope` ('library'|'book'), `kind` (default 'author'), `selectedName`. Renders the topbar (scope toggle: "Library" vs the active book title from `useActiveBook()?.title ?? 'Active book'`; the book button is disabled if no active book), the scope banners, the `<RepullPanel>` (book scope only), and the `.work` 3-pane: `<KindRail>`, `<EntryList>`, and the editor pane (renders `<PipelineEditor>` when `kind==='pipeline'` else `<ProseEditor>`). Changing scope/kind resets `selectedName`. Pass `scope`/`kind`/`selectedName`/`onSelect` down as props (no module globals).

- [ ] **Step 4: `KindRail.tsx`** — the six kinds (author, voice, genre, pipeline, section, skill) with icons (port the SVGs from the concept), active `.on`, click → `onKind(kind)`. (Counts optional; omit `.n` or show a live count from a `listEntries` length — keep simple: omit counts this pass.)

- [ ] **Step 5: Verify** — `tsc` clean; build succeeds; route renders (added in Task 7).

- [ ] **Step 6: Review checkpoint** — scope toggle drives banners + repull visibility; book scope disabled when no active book.

---

### Task 4: Entry list + create/duplicate/delete

**Files:** Create `frontend/studio/src/components/asset/EntryList.tsx`.

- [ ] **Step 1: `EntryList.tsx`** — props `{ scope, kind, selectedName, onSelect }`. On `scope`/`kind` change, `listEntries(scope, kind)` (from `assetApi`) → render `.ehead` (kind name + `.canon` badge + `.addnew` button), `.kdef` (the canonical def), then `.entry` rows (`.et` name + `.src` badge by `source`/scope: builtin→`built-in`, workspace→`yours`, book scope→`book`; `.ed` description). Click row → `onSelect(name)`; mark `.on`.

- [ ] **Step 2: Add / Duplicate / Delete (library scope only).**
  - `.addnew` → prompt for a name → `createLibraryEntry(kind, name, kind==='pipeline' ? { content: STARTER_PIPELINE_JSON } : kind==='section' ? { content: '# New section\n' } : { files: { 'NOTES.md': '' } })` → refresh list → select it. (`STARTER_PIPELINE_JSON` = a minimal valid `{schemaVersion:1,name,label,description:'',steps:[]}` string.)
  - Duplicate (in the editor header `.acts`, library scope) → `createLibraryEntry(kind, name+'-copy', <current entry body>)`.
  - Delete (library scope, only when `source==='workspace'`) → confirm → `deleteLibraryEntry(kind, name)` → refresh. Built-ins show no delete (read-only).
  - In **book scope** these are hidden (a book's asset set is fixed by its snapshot; editing is in-place).

- [ ] **Step 3: Verify** — `tsc` clean; build succeeds.

- [ ] **Step 4: Review checkpoint** — create/duplicate/delete only in library scope; builtin delete suppressed; list refreshes after mutations.

---

### Task 5: Prose editor (multi-file + preview + description) and Pipeline editor

**Files:** Create `frontend/studio/src/components/asset/ProseEditor.tsx`, `frontend/studio/src/components/asset/PipelineEditor.tsx`.

- [ ] **Step 1: `ProseEditor.tsx`** (author/voice/genre/section/skill). Props `{ scope, kind, name }`. On change → `readEntry(scope, kind, name)`. State: the `files` map (author/voice/genre/skill) or `{ '<name>.md': content }` (section); a `selectedFile`; a `description`; a `dirty` flag.
  - **Multi-file switcher:** for `files` with >1 entry, render a row of file tabs (filenames) selecting `selectedFile`; single-file kinds skip tabs.
  - Port the `.md` two-column from the concept: left `.raw` = a `<textarea>` bound to the selected file's content; right `.prev` = `marked.parse(content)` via `dangerouslySetInnerHTML` (marked output of trusted local content — acceptable; note the content is author-owned, same-origin).
  - `.descfield`/`.descbox` = a `<textarea>` (use a textarea, not contenteditable, for controlled state) bound to `description`.
  - **Save** (`.edhead .btn`): `writeEntry(scope, kind, name, { files: <files map> /* or content for section */, description })`. For section, send `{ content, description }` with `name` already in the path. Disable when not `dirty`; clear `dirty` on success; show a transient saved/err state.
  - **skill** is read-only here: render the content + description read-only with a "Skills are edited elsewhere" note; no Save.

- [ ] **Step 2: `PipelineEditor.tsx`** (kind==='pipeline'). On select → `readEntry(scope, kind, name)` → `entry.pipeline` (parse `content` if book scope). If `pipeline.dynamic`, render read-only with a "Generated at create-time" note. Else render `.steplbl` + a `.step` per step (port `.srow`/`.snum`/`.sname`/`.sctrl` pills/`.chev` + `.sbody`). Expandable (`toggleStep` → local open state). In `.sbody` edit: `label` (text), `taskType` (text/select), `skill` (select from `GET /api/library/skill` names + a "— none —"), `promptTemplate` (textarea), `wordCountTarget` (number). `.addstep` appends a blank step; a per-step remove + up/down reorder. **Save**: serialize the steps back into the pipeline object (preserve `schemaVersion`, `name`, `label`, `description`) → `writeEntry(scope, 'pipeline', name, { content: JSON.stringify(pipeline, null, 2), description })`. (Per-step model/tier override dropdowns from the concept are deferred — note in a comment.)

- [ ] **Step 3: Verify** — `tsc` clean; `npm run -w frontend/studio build` succeeds.

- [ ] **Step 4: Review checkpoint** — Save routes by scope via `assetApi`; multi-file switcher works; dynamic pipelines read-only; preview renders; description persists (Task 1 fix).

---

### Task 6: Re-pull panel (book scope)

**Files:** Create `frontend/studio/src/components/asset/RepullPanel.tsx`.

- [ ] **Step 1: `RepullPanel.tsx`** — shown only in book scope (and when an active book exists). On mount → `repullStatus()`. If all assets `in-sync`, render nothing (or a subtle "up to date"). Otherwise port the concept `.repull` block: an icon, text naming how many assets the library has advanced, and per actionable asset (status `library-updated`/`diverged`/`no-baseline`/`locally-edited`) a control: "Re-pull" → `repullExecute(kind, name, resolution)`. For text kinds with a baseline (3-way merge) no resolution needed; for pipeline or `no-baseline`, present take-library / keep-book choice. After execute, surface `hadConflicts` (warn: "merged with conflict markers — review the asset") and refresh the status + the open editor.

- [ ] **Step 2: Verify** — `tsc` clean; build succeeds.

- [ ] **Step 3: Review checkpoint** — repull only in book scope; resolution required where the backend requires it; conflict result surfaced.

---

### Task 7: Route + Rail wiring + full verification

**Files:** Modify `frontend/studio/src/main.tsx`, `frontend/studio/src/Rail.tsx`.

- [ ] **Step 1: Route.** In `main.tsx` add `import { AssetStudio } from './routes/AssetStudio.js';` and `<Route path="library" element={<AssetStudio />} />` inside the `<App>` layout route.

- [ ] **Step 2: Rail.** In `Rail.tsx`, convert the inert Library `<a href="#">` to `<NavLink to="/library">` (mirror the Activity/Board active-class pattern; keep the existing SVG icon).

- [ ] **Step 3: Build + type-check** — `npm run build:frontend`; `npx tsc --noEmit` clean.

- [ ] **Step 4: Backend + suite** — `node --import tsx --test tests/unit/*.test.ts` all pass; `npm test` (unit+api+smoke; api/smoke fail only on the local :3847 conflict — expected).

- [ ] **Step 5: Manual** — `BOOKCLAW_AUTH_TOKEN=test npm start`:
  - Library nav → Asset Studio. Pick a kind → entries list with descriptions + canon def. Select an author → prose editor with file tabs + preview; edit the description + a file → Save → reload the entry → persisted.
  - Toggle scope to the active book → banners switch, repull panel appears; editing writes to the book's snapshot (verify the library copy is unchanged).
  - Pipeline kind → step editor; edit a step's prompt → Save → reload → persisted (library scope).
  - Create a new section (library), duplicate it, delete the copy.
  - If the library shows an asset as advanced for the book, re-pull it; conflicts surfaced.
  - No CSP errors (marked output is same-origin).

- [ ] **Step 6: Review checkpoint** — feature parity with legacy `authoring`+`library`; two-scope writes land in the right place; nothing fabricated.

---

## Self-Review (6f)

- **Spec coverage:** two-scope editor (library overlay vs book snapshot), kinds rail, entry list with canonical defs + descriptions, prose editor (multi-file + preview + description), pipeline step editor → JSON, entry create/duplicate/delete (library scope), re-pull panel (book scope) — matching `asset-studio.html`. Closes the 6e description WRITE gap (Task 1). Deferred + labeled in-UI: per-step model/tier override dropdowns, skill editing (managed via `/api/skills`), dynamic-pipeline editing (read-only).
- **Placeholder scan:** endpoints/types literal from confirmed contracts; the scope branch is isolated in `assetApi.ts`; CSS ports reference the concrete concept file with named classes.
- **Type consistency:** `LibraryEntryFull`/`LibraryPipeline`/`RepullAsset` (Task 2) are consumed by `assetApi.ts` + all components; the write bodies (`{files?,content?,description?}`) match the (now-fixed) route contracts; pipeline serialize/parse round-trips the confirmed step shape.
- **Honesty:** book-scope edits write to the snapshot (not the library); re-pull resolution is required exactly where the backend requires it; conflict markers are surfaced, not hidden.
