# Config-not-Code Pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make book generation fully data-driven — a book runs an ordered, editable sequence of named pipelines (seedable from saved presets), with the per-chapter production loop expressed as data via an `expand` construct, and sections/skills snapshots wired into prompts.

**Architecture:** Add a `sequence` library kind (ordered pipeline names) + a per-book `pipelineSequence`; snapshot each pipeline into `templates/pipeline/<name>.json`; resolve generation from the book's snapshots, chaining one Project per sequence entry. A per-chapter `expand` group in `pipeline.json` flattens to interleaved Write/Polish steps with interpolated variables. Bump `BOOK_SCHEMA_VERSION` to 2 with a lazy migration.

**Tech Stack:** Node 22 + TS (`tsx`, NodeNext, `.js` import extensions), Express, React/Vite studio, `node --test` unit tests, bash smoke tests.

**Spec:** `docs/superpowers/specs/2026-06-14-config-not-code-pipelines-design.md`

**Commit policy:** No per-task `git commit` (repo uses `commit_message` + `./push.sh`). Verify each step with the listed command; commit once at the end.

**Verification baseline:** `npx tsc --noEmit` (exit 0), `node --import tsx --test tests/unit/*.test.ts`, `npm run build:frontend`, `npm run test:api`, `npm run test:smoke`.

---

## Phase 1 — `sequence` library kind

### Task 1: Register the `sequence` kind

**Files:** Modify `gateway/src/services/library-types.ts`, `frontend/shared/src/types.ts`

- [ ] **Step 1:** In `library-types.ts`, add `'sequence'` to the `LIBRARY_KINDS` tuple (the `as const` array `LibraryKind` derives from). Keep order grouped with `pipeline`.
- [ ] **Step 2:** In `frontend/shared/src/types.ts`, extend `export type LibraryKind = 'author' | 'voice' | 'genre' | 'pipeline' | 'section' | 'skill' | 'sequence';`
- [ ] **Step 3:** Add the `LibrarySequence` type to `library-types.ts`:
```ts
export interface LibrarySequence {
  schemaVersion?: number;
  name: string;
  label?: string;
  description?: string;
  pipelines: string[];
}
```
- [ ] **Step 4:** Type-check. Run `npx tsc --noEmit`. Expected: exit 0 (the new kind may surface a few exhaustive-switch gaps — fix them to fall through like `pipeline`/JSON kinds).

### Task 2: Sequence validation + LibraryService JSON handling

**Files:** Create `gateway/src/services/sequence-parse.ts`; Test `tests/unit/sequence-store.test.ts`; Modify `gateway/src/services/library.ts` (treat `sequence` as a JSON-content kind alongside `pipeline`)

- [ ] **Step 1: Write the failing test** (`tests/unit/sequence-store.test.ts`):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSequence } from '../../gateway/src/services/sequence-parse.ts';

test('parseSequence accepts a valid sequence', () => {
  const s = parseSequence({ name: 'novel', label: 'Novel', pipelines: ['book-planning', 'book-production'] });
  assert.deepEqual(s.pipelines, ['book-planning', 'book-production']);
  assert.equal(s.schemaVersion, 1);
});
test('parseSequence rejects empty/invalid pipelines', () => {
  assert.throws(() => parseSequence({ name: 'x', pipelines: [] }));
  assert.throws(() => parseSequence({ name: 'x', pipelines: ['ok', 3] as any }));
  assert.throws(() => parseSequence({ name: 'x' } as any));
});
```
- [ ] **Step 2:** Run `node --import tsx --test tests/unit/sequence-store.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `sequence-parse.ts`:**
```ts
import type { LibrarySequence } from './library-types.js';

/** Validate + normalize a sequence definition (from JSON content). Throws on invalid. */
export function parseSequence(raw: unknown): LibrarySequence {
  const o = (raw ?? {}) as Record<string, unknown>;
  const pipelines = o.pipelines;
  if (!Array.isArray(pipelines) || pipelines.length === 0) {
    throw new Error('sequence.pipelines must be a non-empty array');
  }
  if (!pipelines.every((p) => typeof p === 'string' && p.trim().length > 0)) {
    throw new Error('sequence.pipelines must be non-empty strings');
  }
  return {
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : 1,
    name: String(o.name ?? ''),
    label: typeof o.label === 'string' ? o.label : undefined,
    description: typeof o.description === 'string' ? o.description : undefined,
    pipelines: pipelines.map((p) => (p as string).trim()),
  };
}
```
- [ ] **Step 4:** In `library.ts`, find where `pipeline` content is parsed/returned as JSON (the `get`/list path) and add `sequence` to the same JSON-content branch so `library.get('sequence', name)` returns `{ sequence: LibrarySequence }` parsed via `parseSequence` (mirror how `pipeline` returns `{ pipeline }`). Read the file first to match the exact shape.
- [ ] **Step 5:** Run the test → PASS. Run `npx tsc --noEmit` → exit 0.

### Task 3: Built-in `novel` sequence

**Files:** Create `library/sequences/novel.json`

- [ ] **Step 1:** Confirm the built-in library dir name for sequences matches the loader's expectation (pipelines live in `library/pipelines/` — use `library/sequences/`; verify `LibraryService` maps kind→dir, adjust the mapping if it pluralizes). Create:
```json
{
  "schemaVersion": 1,
  "name": "novel",
  "label": "Novel",
  "description": "Full novel: planning -> bible -> production -> deep revision -> format -> launch",
  "pipelines": ["book-planning", "book-bible", "book-production", "deep-revision", "format-export", "book-launch"]
}
```
- [ ] **Step 2:** Boot check (manual, later): `GET /api/library?kind=sequence` lists `novel`. Covered by the api-test in Task 18.

---

## Phase 2 — Expand construct + variables

### Task 4: Pipeline variable builder

**Files:** Create `gateway/src/services/pipeline-vars.ts`; Test `tests/unit/pipeline-expand.test.ts` (start it here)

- [ ] **Step 1: Write the failing test** (`tests/unit/pipeline-expand.test.ts`):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.ts';

test('buildPipelineVars computes chapter count, words, and structural beats', () => {
  const v = buildPipelineVars({ title: 'T', description: 'D', targetChapters: 20, targetWordsPerChapter: 2500 });
  assert.equal(v.chapterCount, 20);
  assert.equal(v.wordsPerChapter, 2500);
  assert.equal(v.midpoint, 10);      // round(20*0.5)
  assert.equal(v.twist75, 15);       // round(20*0.75)
  assert.equal(v.climaxStart, 18);   // chapters-2
});
test('buildPipelineVars applies defaults and clamps', () => {
  const v = buildPipelineVars({ title: 'T', description: 'D' });
  assert.equal(v.chapterCount, 25);
  assert.equal(v.wordsPerChapter, 3000);
  const c = buildPipelineVars({ title: 'T', description: 'D', targetChapters: 999 });
  assert.equal(c.chapterCount, 200); // clamp
});
```
- [ ] **Step 2:** Run `node --import tsx --test tests/unit/pipeline-expand.test.ts` → FAIL.
- [ ] **Step 3: Implement `pipeline-vars.ts`** (beats lifted from `createNovelPipeline:298-303`):
```ts
export interface PipelineVars extends Record<string, string | number> {
  title: string; description: string;
  chapterCount: number; wordsPerChapter: number;
  setupEnd: number; incitingEnd: number; midpoint: number;
  twist75: number; climaxStart: number; climaxEnd: number;
}

export function buildPipelineVars(ctx: Record<string, any>): PipelineVars {
  const title = String(ctx.title ?? '');
  const description = String(ctx.description ?? '');
  const chapterCount = Math.min(Math.max(Number(ctx.targetChapters) || 25, 1), 200);
  const wordsPerChapter = Math.max(Number(ctx.targetWordsPerChapter) || 3000, 100);
  const setupEnd = Math.max(Math.round(chapterCount * 0.12), 1);
  const incitingEnd = Math.max(Math.round(chapterCount * 0.20), setupEnd + 1);
  const midpoint = Math.round(chapterCount * 0.50);
  const twist75 = Math.round(chapterCount * 0.75);
  const climaxStart = chapterCount - 2;
  const climaxEnd = chapterCount - 1;
  return { ...ctx, title, description, chapterCount, wordsPerChapter, setupEnd, incitingEnd, midpoint, twist75, climaxStart, climaxEnd };
}
```
- [ ] **Step 4:** Run → PASS.

### Task 5: Expand-group flattening

**Files:** Create `gateway/src/services/pipeline-expand.ts`; extend `tests/unit/pipeline-expand.test.ts`; later wired into `projects.ts`

- [ ] **Step 1: Add the failing test** to `pipeline-expand.test.ts`:
```ts
import { expandSteps } from '../../gateway/src/services/pipeline-expand.ts';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.ts';

test('expandSteps flattens a chapter group interleaved with interpolated vars', () => {
  const vars = buildPipelineVars({ title: 'Book', description: 'D', targetChapters: 2, targetWordsPerChapter: 1500 });
  const raw = [
    { expand: 'chapters', steps: [
      { label: 'Write Chapter {{n}}', skill: 'write', taskType: 'creative_writing', phase: 'writing', wordCountTarget: '{{wordsPerChapter}}', chapterNumber: '{{n}}', promptTemplate: 'Write Chapter {{n}} of "{{title}}" ({{wordsPerChapter}} words).' },
      { label: 'Polish Chapter {{n}}', skill: 'revise', taskType: 'revision', phase: 'polish', chapterNumber: '{{n}}', promptTemplate: 'Polish Chapter {{n}}.' },
    ] },
    { label: 'Compile', taskType: 'general', phase: 'assembly', promptTemplate: 'Compile {{chapterCount}} chapters.' },
  ];
  const out = expandSteps(raw, vars);
  assert.equal(out.length, 5); // 2*2 + 1, interleaved
  assert.deepEqual(out.map((s) => s.label), ['Write Chapter 1', 'Polish Chapter 1', 'Write Chapter 2', 'Polish Chapter 2', 'Compile']);
  assert.equal(out[0].chapterNumber, 1);
  assert.equal(out[0].wordCountTarget, 1500);
  assert.equal(out[0].prompt, 'Write Chapter 1 of "Book" (1500 words).');
  assert.equal(out[4].prompt, 'Compile 2 chapters.');
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `pipeline-expand.ts`:**
```ts
import type { PipelineVars } from './pipeline-vars.js';

export interface ResolvedStepInput {
  label: string; skill?: string; toolSuggestion?: string; taskType: string;
  prompt: string; phase?: string; wordCountTarget?: number; chapterNumber?: number;
}

/** {{var}} substitution (whitespace-tolerant); replacer fn so values insert verbatim. */
export function interpolate(tpl: string, vars: Record<string, string | number>): string {
  return String(tpl ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, k) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

function toNum(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function emitStep(s: any, vars: Record<string, string | number>): ResolvedStepInput {
  return {
    label: interpolate(s.label, vars),
    skill: s.skill,
    toolSuggestion: s.toolSuggestion,
    taskType: s.taskType,
    phase: s.phase,
    prompt: interpolate(s.promptTemplate ?? '', vars),
    wordCountTarget: toNum(typeof s.wordCountTarget === 'string' ? interpolate(s.wordCountTarget, vars) : s.wordCountTarget),
    chapterNumber: toNum(typeof s.chapterNumber === 'string' ? interpolate(s.chapterNumber, vars) : s.chapterNumber),
  };
}

/** Flatten a pipeline steps[] (which may contain {expand,steps} groups) into resolved steps. */
export function expandSteps(rawSteps: any[], vars: PipelineVars): ResolvedStepInput[] {
  const out: ResolvedStepInput[] = [];
  for (const entry of rawSteps ?? []) {
    if (entry && entry.expand === 'chapters' && Array.isArray(entry.steps)) {
      for (let n = 1; n <= vars.chapterCount; n++) {
        const local = { ...vars, n, chapterNumber: n };
        for (const sub of entry.steps) out.push(emitStep(sub, local));
      }
    } else {
      out.push(emitStep(entry, vars));
    }
  }
  return out;
}
```
- [ ] **Step 4:** Run → PASS (full file: 4 tests).

### Task 6: Wire expand into `createProjectFromPipeline` + author `book-production.json`

**Files:** Modify `gateway/src/services/projects.ts` (`createProjectFromPipeline`), `library/pipelines/book-production.json`

- [ ] **Step 1:** In `createProjectFromPipeline`, replace the inline `pipeline.steps.map(...)` block with expand-aware resolution. Import `buildPipelineVars` + `expandSteps`. Build `vars = buildPipelineVars({ title, description, ...context })`, then `const resolved = expandSteps(pipeline.steps, vars)`, then map `resolved` → `ProjectStep` (id `${id}-step-${i+1}`, spread label/skill/toolSuggestion/taskType/prompt/phase/wordCountTarget/chapterNumber, `status:'pending'`). This replaces the existing `expandTemplate` call for these steps (keep `expandTemplate` for any other caller). Keep the `dynamic`/`novel-pipeline` legacy branch untouched.
- [ ] **Step 2:** Rewrite `library/pipelines/book-production.json` from the `dynamic` stub to real data — one expand group (Write + Polish, prompts lifted verbatim from `createBookProduction:1479` and `:1497`, with `${ch}`→`{{n}}`, `${title}`→`{{title}}`, `${wordsPerChapter}`→`{{wordsPerChapter}}`, `${description}`→`{{description}}`) plus a final plain "Compile manuscript" step (prompt from `:1510`). Set `"name":"book-production"`, drop `"dynamic"`. Use `wordCountTarget:"{{wordsPerChapter}}"` and `chapterNumber:"{{n}}"` strings.
- [ ] **Step 3:** Add a test to `pipeline-expand.test.ts` that loads the real file and asserts it expands cleanly:
```ts
import { readFileSync } from 'node:fs';
test('book-production.json expands to interleaved chapters + compile', () => {
  const pipe = JSON.parse(readFileSync(new URL('../../library/pipelines/book-production.json', import.meta.url), 'utf8'));
  const vars = buildPipelineVars({ title: 'X', description: 'Y', targetChapters: 3 });
  const out = expandSteps(pipe.steps, vars);
  assert.equal(out.length, 3 * 2 + 1);
  assert.equal(out[out.length - 1].phase, 'assembly');
  assert.ok(out[0].prompt.includes('Chapter 1'));
});
```
- [ ] **Step 4:** Run `node --import tsx --test tests/unit/pipeline-expand.test.ts` → PASS. `npx tsc --noEmit` → 0.

---

## Phase 3 — Book schema v2 + per-book sequence

### Task 7: Bump schema, add `pipelineSequence`, multi-pipeline snapshot

**Files:** Modify `gateway/src/services/book-types.ts`, `gateway/src/services/book.ts`

- [ ] **Step 1:** `book-types.ts`: `BOOK_SCHEMA_VERSION = 2` (keep `BOOK_MIN_SUPPORTED = 1`). Add `pipelineSequence?: string[]` to `BookManifest`. Add `'section'` and `'skill'` to `WIRED_KINDS`.
- [ ] **Step 2:** `book.ts` create path: accept a resolved `pipelineSequence: string[]` (names) + the pipeline objects to snapshot. Replace the single `writeFile(templates/pipeline.json, …)` (`book.ts:176`) with a loop writing `templates/pipeline/<name>.json` per sequence entry; set `manifest.pipelineSequence = names`; set `manifest.schemaVersion = BOOK_SCHEMA_VERSION`. Snapshot skills referenced across **all** sequence pipelines (union), not just one.
- [ ] **Step 3:** Add accessor `snapshotPipelineOf(slug, name): LibraryPipeline | null` reading `templates/pipeline/<name>.json` (fail-soft, mirrors `pipelineOf`). Keep `pipelineOf(slug)` returning the **first** sequence pipeline for back-compat callers, or repoint as needed.
- [ ] **Step 4:** `npx tsc --noEmit` → 0 (callers of the old single-pipeline snapshot will need updating — do so minimally).

### Task 8: Lazy v1→v2 migration

**Files:** Modify `gateway/src/services/book.ts`; Test `tests/unit/book-migration-v2.test.ts`

- [ ] **Step 1: Write the failing test** — construct a temp book dir with `schemaVersion:1`, a `templates/pipeline.json` (name `deep-revision`), no `templates/pipeline/`. Call the read/migrate entry. Assert: `templates/pipeline/deep-revision.json` exists, `book.json.pipelineSequence === ['deep-revision']`, `schemaVersion === 2`, and a second call is a no-op. (Use `os.tmpdir()` + a `BookService` instance pointed at it; match how existing `book*.test.ts` set up temp workspaces.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `migrateBookToV2(dir, manifest)`** called from the book read path (where the manifest is loaded). Guard `if (manifest.schemaVersion >= 2) return`. Read `templates/pipeline.json`; derive `name = parsed.name || 'pipeline'`; `mkdir templates/pipeline/`; write `templates/pipeline/<name>.json`; set `manifest.pipelineSequence = [name]`, `manifest.schemaVersion = 2`; persist `book.json`. Wrap in try/catch → log `⚠`, leave readable on failure (do not throw).
- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit` → 0.

### Task 9: `phasesForBook` across the sequence + `setPhase` gate

**Files:** Modify `gateway/src/services/book.ts`; Test extend `tests/unit/book-phases.test.ts`

- [ ] **Step 1: Failing test** (extend `book-phases.test.ts`): a book with `pipelineSequence:['book-planning','book-production']` → `phasesForBook` returns the concatenation of each snapshot's `pipelinePhases`, in order, adjacent-deduped.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Reimplement `phasesForBook(slug)`: read `manifest.pipelineSequence`; for each name `snapshotPipelineOf(slug, name)` → `pipelinePhases(p)`; concat; dedup only when a phase equals the immediately-preceding one. Fall back to the old single-pipeline behavior when `pipelineSequence` is absent.
- [ ] **Step 4:** Add `assertWritable(manifest)` at the top of `setPhase` (mirror `writeTemplate`/`repull`); add a test that `setPhase` on a `readonly`/`quarantined` manifest throws.
- [ ] **Step 5:** Run → PASS. `npx tsc --noEmit` → 0.

---

## Phase 4 — Sequence-driven orchestration

### Task 10: `createBookSequence` + route wiring

**Files:** Modify `gateway/src/services/projects.ts`, `gateway/src/api/routes/projects.routes.ts`; Test `tests/unit/book-sequence.test.ts`

- [ ] **Step 1: Failing test** (`book-sequence.test.ts`): inject a fake snapshot resolver returning two small pipelines; call `engine.createBookSequence({ slug:'b', pipelineSequence:['p1','p2'] }, 'T', 'D', { bookSlug:'b' }, resolver)`; assert two Projects returned, shared `pipelineId`, `pipelinePhase` 1 and 2, both `bookSlug==='b'`, only the first is pending-ready.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `createBookSequence(book, title, description, context, snapshotResolver)`** — `snapshotResolver(name) => LibraryPipeline|null`. For each `name` in `book.pipelineSequence`: `const p = snapshotResolver(name)`; `if (!p) continue` (log `⚠`); `const proj = this.createProjectFromPipeline(p, label, description, { ...context, bookSlug: book.slug })`; set `proj.pipelineId`, `proj.pipelinePhase = idx+1`. Push. Mirror `createPipeline`'s pending/wait + `persistState`. Return `{ pipelineId, projects }`.
- [ ] **Step 4:** In `projects.routes.ts` create handler: when there is an active book with a `pipelineSequence`, route through `createBookSequence` with `snapshotResolver = (n) => services.books.snapshotPipelineOf(activeBook, n)`. Keep the existing `createNovelPipeline`/`createBookProduction`/`createProjectFromPipeline` branches as the **no-sequence fallback** (no active book / legacy v1 not yet migrated).
- [ ] **Step 5:** Run unit test → PASS. `npx tsc --noEmit` → 0.

---

## Phase 5 — Sections + skills wiring

### Task 11: Sections into the system prompt

**Files:** Modify `gateway/src/services/book.ts` (+ wherever `buildSystemPrompt` composes genre/world — likely `gateway/src/index.ts`); Test `tests/unit/wired-kinds.test.ts`

- [ ] **Step 1: Failing test** (`wired-kinds.test.ts`): `WIRED_KINDS` contains `section` and `skill`; `sectionsOf(slug)` concatenates two snapshot section files into one labelled block; returns `''`/null when none.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `BookService.sectionsOf(slug)`: read `templates/sections/*.md` (skip `*.meta.json`), concat with a header per file. In the prompt composer (where `genreGuide`/`worldGuide` are injected — `index.ts:588-598` region), inject the sections block the same way (new local + appended to the system prompt). Thread it through `buildSystemPrompt` like the genre/world guides.
- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit` → 0.

### Task 12: Skill content prefers the book snapshot

**Files:** Modify `gateway/src/services/book.ts` (+ the step-skill injection site); Test extend `wired-kinds.test.ts`

- [ ] **Step 1: Failing test:** `skillContentOf(slug, name)` returns the book's snapshot `templates/skills/<name>/SKILL.md` content when present, else null.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `BookService.skillContentOf(slug, name)` (fail-soft read). Find where a step's `skill` content is injected into the prompt (grep `getSkillByName`/skill injection in `index.ts`/`projects.routes.ts`); when the project is bound to a book, prefer `books.skillContentOf(bookSlug, name)` and fall back to the global `SkillLoader`.
- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit` → 0.

---

## Phase 6 — API + UI

### Task 13: Book create accepts `sequence` / `pipelineSequence`

**Files:** Modify `gateway/src/api/routes/books.routes.ts` (create handler) + `gateway/src/services/book.ts` selection resolution

- [ ] **Step 1:** In the create handler, accept `pipelineSequence?: string[]` and `sequence?: string`. Resolve the ordered names: if `pipelineSequence` given, use it; else if `sequence` given, `library.get('sequence', sequence).sequence.pipelines`; else default `['<the single pipeline field>']` (back-compat with the current single-`pipeline` create payload) or the `novel` sequence. Validate every name resolves to a known pipeline (else 400 listing the unknown names). Pass the resolved names + their pipeline objects to the snapshot path (Task 7).
- [ ] **Step 2:** Book list/detail (`toListItem`/`getBook`) surfaces `pipelineSequence` (add to `BookSummary`/detail if useful for the board; minimal).
- [ ] **Step 3:** `npx tsc --noEmit` → 0. (Covered by api-test in Task 18.)

### Task 14: `SequenceEditor` + Asset Studio + KindRail

**Files:** Create `frontend/studio/src/components/asset/SequenceEditor.tsx`; Modify `frontend/studio/src/routes/AssetStudio.tsx`, the `KindRail` component, and `frontend/shared` kind metadata (KIND_DEFS)

- [ ] **Step 1:** Add `sequence` to the studio's kind list/`KIND_DEFS` (label "Sequence", canonical description) and the `KindRail`.
- [ ] **Step 2:** Create `SequenceEditor.tsx` (mirror `PipelineEditor.tsx`): loads the sequence JSON via the library read API, renders an ordered, reorderable list of pipeline names (add from a dropdown of available `pipeline` entries, remove, move up/down) + label/description fields; saves via the library write API. Read `PipelineEditor.tsx` first to match the load/save/`scope`/`displayName` conventions.
- [ ] **Step 3:** In `AssetStudio.tsx`, render `SequenceEditor` when `kind === 'sequence'` (alongside the `PipelineEditor`/`SkillEditor`/`ProseEditor` branches), passing `scope/kind/name/displayName`.
- [ ] **Step 4:** `npm run build:frontend` → builds clean.

### Task 15: New Book sequence picker + PipelineEditor expand support

**Files:** Modify the New Book UI component (find it: `grep -rl "New Book" frontend/studio/src`), `frontend/studio/src/components/asset/PipelineEditor.tsx`

- [ ] **Step 1:** New Book: replace the single-pipeline selector with a sequence picker — a dropdown of `sequence` presets that seeds an editable, reorderable list of pipeline names (default to the `novel` preset). Submit `pipelineSequence` (and optionally `sequence`) in the create payload.
- [ ] **Step 2:** `PipelineEditor`: support a step group marked `expand: 'chapters'` — render its sub-steps under a "Repeat per chapter" group with add/remove; serialize back to the `{expand, steps}` shape. Keep plain steps working.
- [ ] **Step 3:** `npm run build:frontend` → clean.

---

## Phase 7 — Tests, smokes, bookkeeping

### Task 16: API-test additions

**Files:** Modify `tests/api/api-test.sh`

- [ ] **Step 1:** Add assertions (match existing helper style): `GET /api/library?kind=sequence` lists `novel`; `GET /api/library/sequence/novel` returns its `pipelines`; `POST /api/books` with `{ title, sequence:'novel', author:'default', voice:'default' }` creates a book whose detail reports a `pipelineSequence` of length 6; clean up the created book.
- [ ] **Step 2:** `bash -n tests/api/api-test.sh` → OK. (Full run in integration.)

### Task 17: Real-money sequence smoke

**Files:** Create `tests/sequence-smoke.sh` (model on `tests/spend-smoke.sh`)

- [ ] **Step 1:** Script: create a book from the `novel` sequence with `targetChapters:2` (tiny), force OpenRouter (cheap model), run the **production** pipeline's project to completion (or its first two chapter steps), assert the book's `data/` contains chapter outputs (Write/Polish for ch 1–2) and per-book spend attributed. Reuse the token/`req`/`code`/`jget` helpers + `clean()` pattern from `spend-smoke.sh`. Gate on OpenRouter present; self-clean.
- [ ] **Step 2:** `bash -n tests/sequence-smoke.sh` → OK.

### Task 18: Extended-feature-smoke update + bookkeeping

**Files:** Modify `tests/extended-feature-smoke.sh`, `docs/TODO.md`, `docs/COMPLETED.md`

- [ ] **Step 1:** Update `extended-feature-smoke.sh` so its book-creation tier uses the sequence model (create from `sequence:'novel'`; assert `pipelineSequence`). Match the file's tier/assert conventions.
- [ ] **Step 2:** Move the "config-not-code pipelines" item (+ the phase-order-as-data note) from `docs/TODO.md` to `docs/COMPLETED.md` with `2026-06-14`. Update the `schemaVersion gate` item: `setPhase` assertWritable now DONE; `dataDirOf` enforcement still deferred — leave that part.
- [ ] **Step 3:** `bash -n tests/extended-feature-smoke.sh` → OK.

---

## Integration (integrator runs after all phases)

### Task INT1: Full verify
- [ ] `npx tsc --noEmit` → 0
- [ ] `node --import tsx --test tests/unit/*.test.ts` → all pass (prior 347 + new)
- [ ] `npm run build:frontend` → clean
- [ ] `npm run test:api` → all pass (incl. sequence assertions)
- [ ] `npm run test:smoke` → all pass

### Task INT2: Code review → fix medium+
- [ ] Run `/code-review` (high) over the diff; fix every medium-or-higher finding; re-run INT1.

### Task INT3: Deploy + real-money smoke
- [ ] Write `commit_message`; `touch build_now` and push (maintainer flow) to trigger the Mercury auto-deploy.
- [ ] After redeploy: `BASE_URL=http://192.168.1.32:3847 tests/sequence-smoke.sh` and `tests/spend-smoke.sh` → green.

---

## Self-Review

- **Spec coverage:** §1 data model → T1–T3,T7,T8; §2 expand+vars → T4–T6; §3 sections/skills → T11–T12; §4 phase order → T9; §5 API/UI → T13–T15; §6 testing → T4–T18; orchestration → T10. All sections mapped.
- **Placeholder scan:** real code in the algorithmic tasks (vars, expand, migration, sequence); UI/route tasks give exact contracts + "read file first to match conventions" (deliberate, since they mirror existing components). No TBD/TODO.
- **Type consistency:** `LibrarySequence{pipelines}`, `parseSequence`, `buildPipelineVars`/`PipelineVars`, `expandSteps`/`ResolvedStepInput`, `interpolate`, `createBookSequence`, `snapshotPipelineOf`, `sectionsOf`, `skillContentOf`, `pipelineSequence`, `BOOK_SCHEMA_VERSION=2` used consistently across tasks.
