# Book Format & Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author declare structure × form × chapter-count × words-per-chapter at book creation (hard-blocked to the form's word band), then have that declaration drive generation and a per-book "Structure & Length" review.

**Architecture:** A new `story-forms.ts` catalog + `validateFormFit` guardrail; an expanded `story-structures.ts` (more frameworks + a `'custom'` author-defined structure resolved uniformly); a `format` block persisted on `book.json`; generation reads it via `formatGuideFor`; a deterministic length/structure review surface with one LLM beat-mapping proposal. Deterministic everywhere except the outline rail (generation) and the beat-mapping/custom-scaffold proposal (review).

**Tech Stack:** Node 22+, TypeScript via `tsx` (NodeNext, `.js` imports), Express routes, Node built-in test runner (`node --import tsx --test`), React studio (Vite).

## Global Constraints

- Node 22+; TypeScript via `tsx`; **all relative imports use `.js` extensions** (NodeNext).
- Deterministic check path: **no LLM** in form validation, length compute, or beat-position classification. LLM only in the outline rail (generation) and the beat-mapping/custom-scaffold proposal (review).
- Manifest change is **additive/optional** — no `BOOK_SCHEMA_VERSION` bump; a book with no `format` behaves exactly as today (generation unchanged; review shows "not configured").
- Fail-soft init/runtime (`✓ / ⚠ / ℹ`); sidecars in the book `data/` dir, fail-soft (missing/corrupt → empty), like `.non-canonical.json`.
- Hard-block at creation when `chapterCount * wordsPerChapter` is outside the form band (Serial/`maxWords === null` enforces only the min).
- Unit tests: `node --import tsx --test tests/unit/<file>.test.ts`. Tests that need SQLite/boot skip gracefully when unavailable.
- Workflow: `commit_message` + `./push.sh` (no direct `git commit`/`git push`); work on `main`; professional Markdown, no emojis.
- Form word-bands (data, owner-tunable): flash 100–1,500; short-story 1,000–7,500; novelette 7,500–17,500; novella 17,500–40,000; novel 40,000–120,000; epic 120,000–∞; serial 2,000–∞; pulp 25,000–60,000.

---

## Phase 1 — Catalog + creation config

### Task 1: `story-forms.ts` catalog + `validateFormFit`

**Files:**
- Create: `gateway/src/services/story-forms.ts`
- Test: `tests/unit/story-forms.test.ts`

**Interfaces:**
- Produces:
  - `interface StoryForm { id: string; label: string; description: string; minWords: number; maxWords: number | null; typicalChapterRange: [number, number] }`
  - `listForms(): StoryForm[]`
  - `getForm(id: string): StoryForm | null`
  - `validateFormFit(form: StoryForm, chapterCount: number, wordsPerChapter: number): { ok: boolean; total: number; message?: string }`

- [ ] **Step 1: Write the failing test** — `tests/unit/story-forms.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listForms, getForm, validateFormFit } from '../../gateway/src/services/story-forms.js';

test('catalog has the v1 forms with coherent bands', () => {
  const ids = listForms().map(f => f.id);
  for (const id of ['flash','short-story','novelette','novella','novel','epic','serial','pulp']) assert.ok(ids.includes(id), id);
  for (const f of listForms()) if (f.maxWords !== null) assert.ok(f.minWords < f.maxWords, `${f.id} band`);
});

test('validateFormFit rejects out-of-band totals and accepts in-band', () => {
  const shortStory = getForm('short-story')!;
  const r1 = validateFormFit(shortStory, 24, 100000); // 2.4M >> 7500
  assert.equal(r1.ok, false);
  assert.equal(r1.total, 2400000);
  assert.match(r1.message!, /Short Story/);

  const novella = getForm('novella')!;
  assert.equal(validateFormFit(novella, 24, 1250).ok, true); // 30k in [17.5k,40k]

  const serial = getForm('serial')!;
  assert.equal(validateFormFit(serial, 100, 3000).ok, true);  // open max
  assert.equal(validateFormFit(serial, 1, 500).ok, false);    // below min 2000

  const epic = getForm('epic')!;
  assert.equal(validateFormFit(epic, 40, 3000).ok, true);     // 120k ok
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/story-forms.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — `gateway/src/services/story-forms.ts`:

```typescript
export interface StoryForm {
  id: string;
  label: string;
  description: string;
  minWords: number;
  maxWords: number | null;            // null = open-ended
  typicalChapterRange: [number, number];
}

const FORMS: StoryForm[] = [
  { id: 'flash', label: 'Flash Fiction', description: 'A complete story in a single sitting; one scene or moment.', minWords: 100, maxWords: 1500, typicalChapterRange: [1, 1] },
  { id: 'short-story', label: 'Short Story', description: 'A single dramatic arc, usually one POV.', minWords: 1000, maxWords: 7500, typicalChapterRange: [1, 3] },
  { id: 'novelette', label: 'Novelette', description: 'Longer than a short story; room for a subplot.', minWords: 7500, maxWords: 17500, typicalChapterRange: [3, 8] },
  { id: 'novella', label: 'Novella', description: 'A focused single-thread novel; tight cast.', minWords: 17500, maxWords: 40000, typicalChapterRange: [8, 20] },
  { id: 'novel', label: 'Novel', description: 'Full-length work with subplots and a developed arc.', minWords: 40000, maxWords: 120000, typicalChapterRange: [20, 45] },
  { id: 'epic', label: 'Epic', description: 'Large-scale, multi-thread, often multi-POV.', minWords: 120000, maxWords: null, typicalChapterRange: [40, 120] },
  { id: 'serial', label: 'Serial (episodic)', description: 'Episodic installments; open-ended length, chapter-as-episode pacing.', minWords: 2000, maxWords: null, typicalChapterRange: [10, 200] },
  { id: 'pulp', label: 'Pulp (fast, lean)', description: 'Fast, plot-forward, lean prose; quick chapters.', minWords: 25000, maxWords: 60000, typicalChapterRange: [20, 40] },
];

export function listForms(): StoryForm[] { return FORMS; }
export function getForm(id: string): StoryForm | null { return FORMS.find(f => f.id === id) ?? null; }

export function validateFormFit(form: StoryForm, chapterCount: number, wordsPerChapter: number): { ok: boolean; total: number; message?: string } {
  const total = Math.max(0, Math.floor(chapterCount)) * Math.max(0, Math.floor(wordsPerChapter));
  if (total < form.minWords) {
    return { ok: false, total, message: `${form.label} is at least ${form.minWords.toLocaleString()} words; ${chapterCount}×${wordsPerChapter.toLocaleString()} = ${total.toLocaleString()} is too short.` };
  }
  if (form.maxWords !== null && total > form.maxWords) {
    return { ok: false, total, message: `${form.label} is at most ${form.maxWords.toLocaleString()} words; ${chapterCount}×${wordsPerChapter.toLocaleString()} = ${total.toLocaleString()} exceeds the band — choose a longer form or lower the counts.` };
  }
  return { ok: true, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/story-forms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — `git add gateway/src/services/story-forms.ts tests/unit/story-forms.test.ts` (bundled per repo workflow; see Global Constraints — no direct commit, batched into `commit_message` at the end).

---

### Task 2: Expand structures catalog + `'custom'` + `resolveStructure`

**Files:**
- Modify: `gateway/src/services/story-structures.ts` (add `'custom'` to `StructureId`; add `four_act` + `fichtean` + `kishotenketsu` + `in_medias_res` structures to the `STRUCTURES` array; add `resolveStructure`)
- Test: `tests/unit/story-structures-resolve.test.ts`

**Interfaces:**
- Consumes: existing `StoryStructure`, `Beat`, `StructureId`, `StoryStructuresService`.
- Produces: `resolveStructure(input: { structureId: string; customStructure?: StoryStructure }, svc: StoryStructuresService): StoryStructure | null` — returns the catalog structure for a known id, the inline `customStructure` when `structureId === 'custom'`, else null.

- [ ] **Step 1: Write the failing test** — `tests/unit/story-structures-resolve.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoryStructuresService, resolveStructure, type StoryStructure } from '../../gateway/src/services/story-structures.js';

const svc = new StoryStructuresService();

test('four_act is in the catalog with ordered beats', () => {
  const s = svc.get('four_act' as any);
  assert.ok(s, 'four_act present');
  assert.ok(s!.beats.length >= 4);
});

test('resolveStructure returns catalog by id and inline custom', () => {
  assert.equal(resolveStructure({ structureId: 'three_act' }, svc)?.id, 'three_act');
  const custom: StoryStructure = {
    id: 'custom' as any, name: 'Four Summers', oneLiner: '', recommendedFor: [], worksLessWellFor: [], why: '',
    beats: [{ name: 'Summer One', expectedPct: 12, pctRange: [0, 25], description: '', keywords: [], mustHave: true }],
  };
  const r = resolveStructure({ structureId: 'custom', customStructure: custom }, svc);
  assert.equal(r?.name, 'Four Summers');
  assert.equal(resolveStructure({ structureId: 'nonsense' }, svc), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/story-structures-resolve.test.ts`
Expected: FAIL — `four_act` missing / `resolveStructure` not exported.

- [ ] **Step 3: Write minimal implementation**

In `story-structures.ts`, extend the union:

```typescript
export type StructureId =
  | 'save_the_cat' | 'three_act' | 'five_act' | 'seven_point' | 'heros_journey'
  | 'romancing_the_beat' | 'story_circle' | 'mystery_5_stage' | 'martell_thematic'
  | 'four_act' | 'fichtean' | 'kishotenketsu' | 'in_medias_res'
  | 'custom' | 'none';
```

Append four new `StoryStructure` entries to the `STRUCTURES` array (full beat lists). Minimum for `four_act` (the explicitly requested one); add the other three with their canonical beats:

```typescript
  {
    id: 'four_act',
    name: 'Four-Act Structure',
    oneLiner: 'Three-act with the long second act split at the midpoint into two distinct halves.',
    recommendedFor: ['literary fiction', 'historical fiction', 'family saga', 'general fiction', 'drama'],
    worksLessWellFor: ['cozy mystery'],
    alsoConsiderWhen: 'When the middle of the book has two clearly different movements (e.g. before/after a central turn), or a time-spanning structure with distinct phases.',
    why: 'Splitting Act 2 at the midpoint gives the back half its own rising action and prevents the "saggy middle". Common in time-spanning literary work.',
    beats: [
      { name: 'Setup', expectedPct: 8, pctRange: [0, 15], description: 'Establish the protagonist, world, and the dramatic question.', keywords: ['opens','introduce','world','home'], mustHave: true },
      { name: 'Inciting Turn (Act 1→2)', expectedPct: 25, pctRange: [20, 30], description: 'The first major turn that launches the central conflict.', keywords: ['inciting','turn','decision','leave'], mustHave: true },
      { name: 'Midpoint Turn (Act 2A→2B)', expectedPct: 50, pctRange: [45, 55], description: 'A reversal that changes the nature of the conflict; the second movement begins.', keywords: ['midpoint','reversal','reveal','shift'], mustHave: true },
      { name: 'Crisis Turn (Act 3→4)', expectedPct: 75, pctRange: [70, 80], description: 'The low point / final turn into the resolution movement.', keywords: ['crisis','all is lost','low point','turn'], mustHave: true },
      { name: 'Resolution', expectedPct: 92, pctRange: [85, 100], description: 'Climax and aftermath.', keywords: ['climax','resolution','end','aftermath'], mustHave: true },
    ],
  },
  {
    id: 'fichtean',
    name: 'Fichtean Curve',
    oneLiner: 'A series of escalating crises with minimal setup — start in rising action.',
    recommendedFor: ['thriller','horror','suspense','action','short story'],
    worksLessWellFor: ['cozy mystery','slice of life'],
    why: 'Skips long exposition; a chain of crises each raising the stakes to the climax.',
    beats: [
      { name: 'Inciting Incident', expectedPct: 5, pctRange: [0, 12], description: 'Open near or in the first crisis — minimal setup.', keywords: ['opens','crisis','attack','incident'], mustHave: true },
      { name: 'First Crisis', expectedPct: 25, pctRange: [15, 35], description: 'First escalation.', keywords: ['crisis','complication','setback'], mustHave: true },
      { name: 'Rising Crises', expectedPct: 55, pctRange: [40, 70], description: 'Stakes escalate through repeated crises.', keywords: ['escalate','worse','pressure','complication'], mustHave: true },
      { name: 'Climax', expectedPct: 88, pctRange: [80, 95], description: 'The peak crisis and turning point.', keywords: ['climax','confront','final'], mustHave: true },
      { name: 'Denouement', expectedPct: 97, pctRange: [93, 100], description: 'Brief resolution.', keywords: ['resolution','after','end'], mustHave: false },
    ],
  },
  {
    id: 'kishotenketsu',
    name: 'Kishōtenketsu (4-act, no conflict)',
    oneLiner: 'Introduction → Development → Twist → Reconciliation; structure without central conflict.',
    recommendedFor: ['literary fiction','slice of life','speculative','short story'],
    worksLessWellFor: ['thriller','action'],
    why: 'East Asian four-act form where the "twist" (ten) recontextualizes rather than escalates conflict — strong for mood/literary pieces.',
    beats: [
      { name: 'Ki (Introduction)', expectedPct: 12, pctRange: [0, 25], description: 'Introduce characters and setting.', keywords: ['introduce','opens','world'], mustHave: true },
      { name: 'Shō (Development)', expectedPct: 38, pctRange: [25, 50], description: 'Develop the situation; no major turn yet.', keywords: ['develop','everyday','deepen'], mustHave: true },
      { name: 'Ten (Twist)', expectedPct: 65, pctRange: [55, 80], description: 'An unexpected element recontextualizes what came before.', keywords: ['twist','unexpected','reveal','shift'], mustHave: true },
      { name: 'Ketsu (Reconciliation)', expectedPct: 92, pctRange: [85, 100], description: 'The parts are reconciled into a whole.', keywords: ['reconcile','resolution','meaning','end'], mustHave: true },
    ],
  },
  {
    id: 'in_medias_res',
    name: 'In Medias Res',
    oneLiner: 'Open in the middle of the action; backfill via flashback, then carry forward.',
    recommendedFor: ['thriller','action','sci-fi','epic fantasy'],
    worksLessWellFor: ['cozy mystery','memoir'],
    why: 'Hooks immediately with action, then reveals how the characters got there before driving to the climax.',
    beats: [
      { name: 'In-Action Open', expectedPct: 3, pctRange: [0, 10], description: 'Drop the reader into a charged moment.', keywords: ['opens','action','mid','chase','battle'], mustHave: true },
      { name: 'Backfill', expectedPct: 25, pctRange: [12, 40], description: 'Reveal the events leading to the open.', keywords: ['flashback','earlier','backstory','how'], mustHave: true },
      { name: 'Catch-Up Point', expectedPct: 55, pctRange: [45, 65], description: 'The narrative catches up to the opening moment and pushes past it.', keywords: ['present','catch up','now','forward'], mustHave: true },
      { name: 'Climax', expectedPct: 88, pctRange: [80, 96], description: 'Climactic confrontation.', keywords: ['climax','confront','final'], mustHave: true },
      { name: 'Resolution', expectedPct: 98, pctRange: [94, 100], description: 'Resolution.', keywords: ['resolution','end','after'], mustHave: false },
    ],
  },
```

At the bottom of the file (after the `StoryStructuresService` class), add:

```typescript
/**
 * Resolve a declared structure to a StoryStructure: catalog lookup by id, or the
 * inline custom object when structureId === 'custom'. Returns null if unknown.
 */
export function resolveStructure(
  input: { structureId: string; customStructure?: StoryStructure },
  svc: StoryStructuresService,
): StoryStructure | null {
  if (input.structureId === 'custom') return input.customStructure ?? null;
  return svc.get(input.structureId as StructureId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/story-structures-resolve.test.ts`
Expected: PASS. Also run `node --import tsx --test tests/unit/*.test.ts` to confirm no regression in any structure-dependent test.

- [ ] **Step 5: Commit** — batched.

---

### Task 3: `format` on the manifest + `BookService` create/set/guide

**Files:**
- Modify: `gateway/src/services/book.ts` (`BookManifest` interface; `create()` accepts `format`; add `setFormat(slug, format)` + `formatGuideFor(slug)`)
- Modify: `frontend/shared/src/types.ts` (`BookManifest.format`)
- Test: `tests/unit/book-format.test.ts`

**Interfaces:**
- Consumes: `validateFormFit` (Task 1), `StoryStructure` (Task 2).
- Produces:
  - `BookFormat` type: `{ structureId: string; customStructure?: StoryStructure; formId: string; chapterCount: number; wordsPerChapter: number; totalTarget: number }`
  - `BookService.create(input & { format?: BookFormat })` persists `format` in the manifest.
  - `BookService.setFormat(slug: string, format: BookFormat): Promise<BookManifest>` — writes `format` onto an existing manifest (assertWritable-gated).
  - `BookService.formatGuideFor(slug: string): { chapterCount: number; wordsPerChapter: number; structureRail: string } | null` — derives generation inputs from the manifest format; null when no format.

- [ ] **Step 1: Write the failing test** — `tests/unit/book-format.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookService } from '../../gateway/src/services/book.js';
import { LibraryService } from '../../gateway/src/services/library.js';

async function mkService() {
  const root = mkdtempSync(join(tmpdir(), 'bookfmt-'));
  const lib = new LibraryService(join(root, 'library-user'), join(root, 'library'));
  await lib.initialize?.();
  const svc = new BookService(join(root, 'books'), lib, '0.0.0-test');
  await svc.initialize();
  return { root, svc };
}

test('setFormat persists and formatGuideFor derives generation inputs', async () => {
  const { root, svc } = await mkService();
  try {
    const m = await svc.create({ title: 'Fmt Book', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', pipelines: [{ name: 'novel-pipeline', pipeline: { name: 'novel-pipeline' } as any }], sections: [] } as any);
    await svc.setFormat(m.slug, {
      structureId: 'four_act', formId: 'novella', chapterCount: 20, wordsPerChapter: 1500, totalTarget: 30000,
    });
    const guide = svc.formatGuideFor(m.slug);
    assert.equal(guide?.chapterCount, 20);
    assert.equal(guide?.wordsPerChapter, 1500);
    assert.match(guide!.structureRail, /Four-Act|Setup|Midpoint/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('formatGuideFor returns null when no format set', async () => {
  const { root, svc } = await mkService();
  try {
    const m = await svc.create({ title: 'No Fmt', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', pipelines: [{ name: 'novel-pipeline', pipeline: { name: 'novel-pipeline' } as any }], sections: [] } as any);
    assert.equal(svc.formatGuideFor(m.slug), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

> Note: if `LibraryService`'s constructor signature differs, adapt the harness in Step 2 to however other book unit tests (`tests/unit/book-sequence.test.ts`) instantiate `BookService`; reuse that exact harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/book-format.test.ts`
Expected: FAIL — `setFormat`/`formatGuideFor` not defined.

- [ ] **Step 3: Write minimal implementation**

In `gateway/src/services/book.ts`, add the type + extend the interface:

```typescript
import type { StoryStructure } from './story-structures.js';
import { resolveStructure, StoryStructuresService } from './story-structures.js';

export interface BookFormat {
  structureId: string;
  customStructure?: StoryStructure;
  formId: string;
  chapterCount: number;
  wordsPerChapter: number;
  totalTarget: number;
}
```

Add `format?: BookFormat;` to the `BookManifest` interface (after `appendix`).

In `create()`, accept `format` on the input and include it in the manifest literal:

```typescript
      ...(opts.format ? { format: opts.format } : {}),
```
(where `opts` is the create-arg object; add `format?: BookFormat` to its destructure/type.)

Add the two methods to the class:

```typescript
  async setFormat(slug: string, format: BookFormat): Promise<BookManifest> {
    const { manifest } = await this.open(slug);
    await this.assertWritable(slug);
    manifest.format = format;
    manifest.history.push({ at: new Date().toISOString(), event: 'format-set', detail: `${format.formId}/${format.structureId} ${format.chapterCount}×${format.wordsPerChapter}` });
    await writeFile(join(this.booksDir, slug, 'book.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    return manifest;
  }

  formatGuideFor(slug: string): { chapterCount: number; wordsPerChapter: number; structureRail: string } | null {
    try {
      const p = join(this.booksDir, slug, 'book.json');
      if (!existsSync(p)) return null;
      const m = JSON.parse(readFileSync(p, 'utf-8')) as BookManifest;
      const f = m.format;
      if (!f) return null;
      const structure = resolveStructure({ structureId: f.structureId, customStructure: f.customStructure }, new StoryStructuresService());
      const rail = structure && structure.beats.length
        ? `Plan the outline to the "${structure.name}" structure. Hit these beats at roughly these positions (% of the book):\n` +
          structure.beats.map(b => `- ${b.name} (~${b.expectedPct}%): ${b.description}`).join('\n')
        : '';
      return { chapterCount: f.chapterCount, wordsPerChapter: f.wordsPerChapter, structureRail: rail };
    } catch { return null; }
  }
```

In `frontend/shared/src/types.ts`, add to `BookManifest` (after `appendix?`):

```typescript
  format?: {
    structureId: string;
    customStructure?: unknown;   // StoryStructure shape; opaque to the shared layer
    formId: string;
    chapterCount: number;
    wordsPerChapter: number;
    totalTarget: number;
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/book-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — batched.

---

### Task 4: Creation/format routes — `GET /api/forms`, `POST /api/books` validation, `PUT /api/books/:slug/format`

**Files:**
- Modify: `gateway/src/api/routes/knowledge.routes.ts` (add `GET /api/forms`)
- Modify: `gateway/src/api/routes/books.routes.ts` (validate + persist `format` on `POST /api/books`; add `PUT /api/books/:slug/format`)
- Test: `tests/unit/book-format-validate.test.ts` (pure validation helper)

**Interfaces:**
- Consumes: `listForms`, `getForm`, `validateFormFit` (Task 1); `resolveStructure` + `StoryStructuresService` (Task 2); `BookService.create`/`setFormat` (Task 3).
- Produces: a pure helper `buildBookFormat(body, structuresSvc): { format?: BookFormat; error?: string }` (exported from `books.routes.ts` or a small `format-input.ts`) so the validation is unit-testable without HTTP.

- [ ] **Step 1: Write the failing test** — `tests/unit/book-format-validate.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookFormat } from '../../gateway/src/services/format-input.js';
import { StoryStructuresService } from '../../gateway/src/services/story-structures.js';

const svc = new StoryStructuresService();

test('absent format inputs → no format, no error', () => {
  assert.deepEqual(buildBookFormat({}, svc), {});
});

test('valid inputs → format block with computed total', () => {
  const r = buildBookFormat({ structure: 'four_act', form: 'novella', chapterCount: 20, wordsPerChapter: 1500 }, svc);
  assert.equal(r.error, undefined);
  assert.equal(r.format?.formId, 'novella');
  assert.equal(r.format?.totalTarget, 30000);
});

test('out-of-band total → error (hard block)', () => {
  const r = buildBookFormat({ structure: 'three_act', form: 'short-story', chapterCount: 24, wordsPerChapter: 100000 }, svc);
  assert.match(r.error!, /Short Story/);
  assert.equal(r.format, undefined);
});

test('custom structure carried through; unknown structure/form → error', () => {
  const custom = { id: 'custom', name: 'Four Summers', beats: [{ name: 'Summer One', expectedPct: 12, pctRange: [0, 25], description: '', keywords: [], mustHave: true }] };
  const r = buildBookFormat({ structure: 'custom', customStructure: custom, form: 'novel', chapterCount: 30, wordsPerChapter: 2000 }, svc);
  assert.equal(r.format?.structureId, 'custom');
  assert.equal((r.format?.customStructure as any).name, 'Four Summers');
  assert.match(buildBookFormat({ structure: 'nope', form: 'novel', chapterCount: 30, wordsPerChapter: 2000 }, svc).error!, /structure/i);
  assert.match(buildBookFormat({ structure: 'three_act', form: 'nope', chapterCount: 30, wordsPerChapter: 2000 }, svc).error!, /form/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/book-format-validate.test.ts`
Expected: FAIL — `format-input.ts` not found.

- [ ] **Step 3: Write minimal implementation** — create `gateway/src/services/format-input.ts`:

```typescript
import { getForm, validateFormFit } from './story-forms.js';
import { resolveStructure, type StoryStructuresService } from './story-structures.js';
import type { BookFormat } from './book.js';

/**
 * Validate raw creation/format inputs into a BookFormat block.
 * Returns {} when no format fields supplied (format is optional),
 * { error } on any validation failure (hard block), or { format }.
 */
export function buildBookFormat(
  body: { structure?: string; customStructure?: unknown; form?: string; chapterCount?: number; wordsPerChapter?: number },
  structures: StoryStructuresService,
): { format?: BookFormat; error?: string } {
  const hasAny = body.structure || body.form || body.chapterCount != null || body.wordsPerChapter != null;
  if (!hasAny) return {};

  const structureId = String(body.structure ?? '');
  const formId = String(body.form ?? '');
  const chapterCount = Number(body.chapterCount);
  const wordsPerChapter = Number(body.wordsPerChapter);

  if (!structureId) return { error: 'structure is required when declaring a format' };
  if (!formId) return { error: 'form is required when declaring a format' };
  if (!Number.isFinite(chapterCount) || chapterCount < 1) return { error: 'chapterCount must be a positive number' };
  if (!Number.isFinite(wordsPerChapter) || wordsPerChapter < 1) return { error: 'wordsPerChapter must be a positive number' };

  const structure = resolveStructure({ structureId, customStructure: body.customStructure as any }, structures);
  if (!structure) return { error: `unknown structure: ${structureId}` };

  const form = getForm(formId);
  if (!form) return { error: `unknown form: ${formId}` };

  const fit = validateFormFit(form, chapterCount, wordsPerChapter);
  if (!fit.ok) return { error: fit.message };

  return {
    format: {
      structureId,
      ...(structureId === 'custom' ? { customStructure: structure } : {}),
      formId,
      chapterCount: Math.floor(chapterCount),
      wordsPerChapter: Math.floor(wordsPerChapter),
      totalTarget: fit.total,
    },
  };
}
```

Wire `GET /api/forms` in `knowledge.routes.ts` (next to `GET /api/structures`):

```typescript
  app.get('/api/forms', (_req: Request, res: Response) => {
    res.json({ forms: listForms() });
  });
```
(add `import { listForms } from '../../services/story-forms.js';` at the top of the file.)

In `books.routes.ts` `POST /api/books`, after the pipeline validation and before `services.books.create(...)`:

```typescript
    const fmt = buildBookFormat(body, services.storyStructures);
    if (fmt.error) return res.status(400).json({ error: fmt.error });
```
then pass `...(fmt.format ? { format: fmt.format } : {})` into the `services.books.create({ ... })` call.
(add `import { buildBookFormat } from '../../services/format-input.js';`.)

Add the standalone route in `books.routes.ts`:

```typescript
  app.put('/api/books/:slug/format', async (req: Request, res: Response) => {
    const fmt = buildBookFormat(req.body || {}, services.storyStructures);
    if (fmt.error) return res.status(400).json({ error: fmt.error });
    if (!fmt.format) return res.status(400).json({ error: 'format fields required' });
    try {
      const manifest = await services.books.setFormat(req.params.slug, fmt.format);
      res.json({ ok: true, format: manifest.format });
    } catch (e) {
      res.status(404).json({ error: (e as Error)?.message || 'book not found' });
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/book-format-validate.test.ts` then `npx tsc --noEmit`.
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit** — batched.

---

### Task 5: New-Book studio form — selectors + chapter/length + live band check

**Files:**
- Modify: `frontend/studio/src/routes/NewBook.tsx` (+ a small `components/newbook/FormatPicker.tsx`)
- Modify: a studio API client (where `GET /api/structures` would be called) to add `GET /api/forms`.

**Interfaces:**
- Consumes: `GET /api/structures`, `GET /api/forms`, `POST /api/books` (extended).
- Produces: the creation form posts `{ structure, customStructure?, form, chapterCount, wordsPerChapter }` with the rest.

- [ ] **Step 1: Implement the FormatPicker component**

Create `frontend/studio/src/components/newbook/FormatPicker.tsx`: a controlled component taking `{ structures, forms, value, onChange }` and rendering: a Structure `<select>` (options from `structures` + a final `Other / Custom…`), a Form `<select>` (from `forms`), numeric inputs for Chapter count and Words per chapter, a live computed total, and an inline validity line. When "Other / Custom" is chosen, show a minimal beat editor (rows of `name` + `expectedPct` + `pctRange` min/max) OR a textarea the author can fill; assemble into a `customStructure` object on change. Compute band validity client-side mirroring `validateFormFit` (total = chapters×words; ok iff `>= form.minWords && (form.maxWords == null || <= form.maxWords)`), and surface a red message + set an `invalid` flag.

- [ ] **Step 2: Wire into NewBook.tsx**

Fetch `GET /api/forms` alongside the existing structures fetch; render `<FormatPicker>`; thread its value into the create payload; disable the Create button while the picker reports `invalid`.

- [ ] **Step 3: Build the frontend**

Run: `npm run build:frontend`
Expected: exit 0.

- [ ] **Step 4: (covered by smoke)** The creation + band-block behavior is asserted end-to-end in Task 12's smoke; no separate unit test for the React layer.

- [ ] **Step 5: Commit** — batched. Update the smoke per Task 12 Phase-1 section.

---

## Phase 2 — Generation wiring

### Task 6: Feed declared format into generation (targets + structure rail)

**Files:**
- Modify: `gateway/src/api/routes/projects.routes.ts` (where a book-bound project/sequence is created — merge format-derived context)
- Modify: `gateway/src/services/projects.ts` (`createProject`: when a `structureRail` is present in context, append it to the outline/planning step prompt; map `targetChapters`/`targetWordsPerChapter` already supported)
- Test: `tests/unit/format-generation-wiring.test.ts`

**Interfaces:**
- Consumes: `BookService.formatGuideFor` (Task 3).
- Produces: a pure helper `applyStructureRail(steps: {prompt:string; phase?:string; skill?:string}[], rail: string): void` (exported from `projects.ts` or a small `format-guide.ts`) that appends the rail to the first outline/planning step. Used by `createProject` for both the novel-pipeline and config-pipeline branches.

- [ ] **Step 1: Write the failing test** — `tests/unit/format-generation-wiring.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStructureRail } from '../../gateway/src/services/format-guide.js';

test('appends the rail to the first outline/planning step only', () => {
  const steps = [
    { prompt: 'Plan the outline.', phase: 'outline' },
    { prompt: 'Write chapter 1.', phase: 'production' },
    { prompt: 'Another outline pass.', phase: 'outline' },
  ];
  applyStructureRail(steps, 'STRUCTURE RAIL TEXT');
  assert.match(steps[0].prompt, /STRUCTURE RAIL TEXT/);
  assert.doesNotMatch(steps[1].prompt, /STRUCTURE RAIL TEXT/);
  assert.doesNotMatch(steps[2].prompt, /STRUCTURE RAIL TEXT/); // only the first
});

test('no outline step → falls back to the first step; empty rail is a no-op', () => {
  const s1 = [{ prompt: 'Do a thing.', phase: 'production' }];
  applyStructureRail(s1, 'RAIL');
  assert.match(s1[0].prompt, /RAIL/);
  const s2 = [{ prompt: 'unchanged', phase: 'outline' }];
  applyStructureRail(s2, '');
  assert.equal(s2[0].prompt, 'unchanged');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/format-generation-wiring.test.ts`
Expected: FAIL — `format-guide.ts` not found.

- [ ] **Step 3: Write minimal implementation** — create `gateway/src/services/format-guide.ts`:

```typescript
/**
 * Append a structure "rail" instruction to the outline/planning step of a step list.
 * Targets the first step whose phase/skill looks like outline/planning; falls back to
 * the first step. Empty rail is a no-op. Mutates in place.
 */
export function applyStructureRail(
  steps: Array<{ prompt: string; phase?: string; skill?: string }>,
  rail: string,
): void {
  if (!rail || steps.length === 0) return;
  const isOutline = (s: { phase?: string; skill?: string }) =>
    /outline|plan/i.test(s.phase ?? '') || /outline|plan/i.test(s.skill ?? '');
  const target = steps.find(isOutline) ?? steps[0];
  target.prompt = `${target.prompt}\n\n---\n${rail}`;
}
```

In `gateway/src/services/projects.ts`, in `createProject`:
- For the config-pipeline branch (after `let steps = resolved.map(...)`), apply the rail if present in context:

```typescript
    if (typeof context?.structureRail === 'string' && context.structureRail) {
      applyStructureRail(steps, context.structureRail);
    }
```
- For the novel-pipeline branch, after `const novel = this.createNovelPipeline(...)`, apply to its steps:

```typescript
      if (typeof context?.structureRail === 'string' && context.structureRail) {
        applyStructureRail(novel.steps as any, context.structureRail);
      }
```
(add `import { applyStructureRail } from './format-guide.js';`.)

In `gateway/src/api/routes/projects.routes.ts`, at the book-bound creation site(s) (e.g. `createBookSequence` and any `createProject` call that stamps `bookSlug`), merge the format guide into `context` before creating:

```typescript
    const guide = bookSlug ? services.books.formatGuideFor(bookSlug) : null;
    const ctx = {
      ...context,
      ...(guide ? { targetChapters: guide.chapterCount, targetWordsPerChapter: guide.wordsPerChapter, structureRail: guide.structureRail } : {}),
    };
```
and pass `ctx` where `context` was passed. **Fail-soft:** `guide` null → `ctx === context` → behavior unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/format-generation-wiring.test.ts` then `npx tsc --noEmit`.
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit** — batched. Extend the smoke per Task 12 Phase-2 section.

---

## Phase 3 — Review surface

### Task 7: `evaluateBeatMapping` deterministic check

**Files:**
- Modify: `gateway/src/services/story-structures.ts` (add `evaluateBeatMapping`)
- Test: `tests/unit/beat-mapping.test.ts`

**Interfaces:**
- Consumes: `StoryStructure`, `Beat`, `BeatCheckResult`, `OutlineCheckReport` (existing types).
- Produces: `evaluateBeatMapping(structure: StoryStructure, mapping: Record<string, number[]>, totalChapters: number): OutlineCheckReport` — `mapping` is beat-name → 1-based chapter numbers (author/LLM confirmed). A beat's `foundAtPct = midpoint(chapters)/totalChapters*100`; `found_in_range` if within `pctRange`, `found_misplaced` if mapped but out of range, `missing` if no chapters mapped.

- [ ] **Step 1: Write the failing test** — `tests/unit/beat-mapping.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StoryStructuresService, evaluateBeatMapping, type StoryStructure } from '../../gateway/src/services/story-structures.js';

const threeAct = new StoryStructuresService().get('three_act')!;

test('classifies mapped beats by position vs pctRange', () => {
  const beats = threeAct.beats;
  const first = beats[0].name;       // early beat (~setup)
  const last = beats[beats.length - 1].name; // climax/resolution (late)
  const mapping: Record<string, number[]> = {
    [first]: [1],            // chapter 1 of 20 → 5% → in early range
    [last]: [2],             // chapter 2 of 20 → 10% → far too early → misplaced
  };
  const r = evaluateBeatMapping(threeAct, mapping, 20);
  const rf = r.results.find(x => x.beat.name === first)!;
  const rl = r.results.find(x => x.beat.name === last)!;
  assert.equal(rf.status, 'found_in_range');
  assert.equal(rl.status, 'found_misplaced');
  // beats with no mapping are missing
  assert.ok(r.beatsMissing >= 1);
  assert.equal(r.totalBeats, beats.length);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/beat-mapping.test.ts`
Expected: FAIL — `evaluateBeatMapping` not exported.

- [ ] **Step 3: Write minimal implementation** — append to `story-structures.ts`:

```typescript
export function evaluateBeatMapping(
  structure: StoryStructure,
  mapping: Record<string, number[]>,
  totalChapters: number,
): OutlineCheckReport {
  const total = Math.max(1, totalChapters);
  const results: BeatCheckResult[] = structure.beats.map((beat) => {
    const chapters = (mapping[beat.name] ?? []).filter(n => Number.isFinite(n) && n >= 1);
    if (chapters.length === 0) {
      return { beat, foundAtPct: null, confidence: 0, status: 'missing',
        suggestion: `Map a chapter to "${beat.name}" (${beat.description})` };
    }
    const mid = chapters.reduce((a, b) => a + b, 0) / chapters.length;
    const pct = ((mid - 0.5) / total) * 100; // chapter midpoint → % of book
    const inRange = pct >= beat.pctRange[0] && pct <= beat.pctRange[1];
    return {
      beat, foundAtPct: Math.round(pct), confidence: 1,
      status: inRange ? 'found_in_range' : 'found_misplaced',
      suggestion: inRange ? `"${beat.name}" is well placed (~${Math.round(pct)}%).`
        : `"${beat.name}" sits at ~${Math.round(pct)}% but is expected near ${beat.expectedPct}% (${beat.pctRange[0]}–${beat.pctRange[1]}%).`,
    };
  });
  const beatsFoundInRange = results.filter(r => r.status === 'found_in_range').length;
  const beatsFoundMisplaced = results.filter(r => r.status === 'found_misplaced').length;
  const beatsMissing = results.filter(r => r.status === 'missing').length;
  const mustHaveMissing = results.filter(r => r.status === 'missing' && r.beat.mustHave).length;
  return {
    structureId: structure.id, structureName: structure.name,
    totalBeats: structure.beats.length, beatsFoundInRange, beatsFoundMisplaced, beatsMissing, mustHaveMissing,
    results,
    summary: `${beatsFoundInRange}/${structure.beats.length} beats in range, ${beatsFoundMisplaced} misplaced, ${beatsMissing} missing${mustHaveMissing ? ` (${mustHaveMissing} required)` : ''}.`,
    needsAttention: mustHaveMissing > 0 || beatsFoundMisplaced >= 2,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/beat-mapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — batched.

---

### Task 8: Length-review compute + genre word-range parse + sidecars

**Files:**
- Create: `gateway/src/services/format-review.ts` (length compute, genre parse, sidecar load/save)
- Test: `tests/unit/format-review-length.test.ts`

**Interfaces:**
- Consumes: `selectChapterFiles` from `gateway/src/services/consistency/audit.js`; `BookFormat`/`BookService` for the declared targets.
- Produces:
  - `parseGenreWordRange(readerExpectationsMd: string): [number, number] | null`
  - `countChapterWords(dataDir: string): { chapter: string; words: number }[]` (deterministic, reuses `selectChapterFiles`)
  - `loadLengthOverrides(dataDir: string): Record<string, number>` / `saveLengthOverrides(dataDir, obj)` (sidecar `.length-targets.json`, fail-soft)
  - `buildLengthReview(args: { chapters: {chapter:string;words:number}[]; wordsPerChapter: number; overrides: Record<string,number>; form: StoryForm | null; genreRange: [number,number] | null }): LengthReview` where `LengthReview = { perChapter: {chapter, words, target, delta}[]; totalWords: number; totalTarget: number; withinBand: boolean; bandMessage?: string; genreRange: [number,number]|null }`

- [ ] **Step 1: Write the failing test** — `tests/unit/format-review-length.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGenreWordRange, buildLengthReview } from '../../gateway/src/services/format-review.js';
import { getForm } from '../../gateway/src/services/story-forms.js';

test('parseGenreWordRange extracts a band from reader-expectations prose', () => {
  assert.deepEqual(parseGenreWordRange('Standard novel length for this genre is 70,000–120,000 words.'), [70000, 120000]);
  assert.deepEqual(parseGenreWordRange('80,000-110,000 words is standard.'), [80000, 110000]);
  assert.equal(parseGenreWordRange('No numbers here.'), null);
});

test('buildLengthReview computes per-chapter deltas, total, and band fit', () => {
  const form = getForm('novella');
  const r = buildLengthReview({
    chapters: [{ chapter: 'chapter-1', words: 1600 }, { chapter: 'chapter-2', words: 1400 }],
    wordsPerChapter: 1500, overrides: { 'chapter-2': 1200 }, form, genreRange: null,
  });
  assert.equal(r.perChapter[0].target, 1500);
  assert.equal(r.perChapter[0].delta, 100);
  assert.equal(r.perChapter[1].target, 1200);   // override applied
  assert.equal(r.perChapter[1].delta, 200);
  assert.equal(r.totalWords, 3000);
  assert.equal(r.withinBand, false);             // 3000 < novella min 17500
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/format-review-length.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation** — `gateway/src/services/format-review.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { selectChapterFiles } from './consistency/audit.js';
import { validateFormFit, type StoryForm } from './story-forms.js';

export interface LengthReview {
  perChapter: { chapter: string; words: number; target: number; delta: number }[];
  totalWords: number;
  totalTarget: number;
  withinBand: boolean;
  bandMessage?: string;
  genreRange: [number, number] | null;
}

/** Parse "70,000–120,000 words" / "80,000-110,000 words" → [min,max]. */
export function parseGenreWordRange(md: string): [number, number] | null {
  const m = md.match(/([\d,]{4,})\s*[–—-]\s*([\d,]{4,})\s*words/i);
  if (!m) return null;
  const lo = parseInt(m[1].replace(/,/g, ''), 10);
  const hi = parseInt(m[2].replace(/,/g, ''), 10);
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

function wordCount(text: string): number {
  const t = text.replace(/[#*_>`~\-]/g, ' ').trim();
  return t ? t.split(/\s+/).length : 0;
}

export function countChapterWords(dataDir: string): { chapter: string; words: number }[] {
  if (!existsSync(dataDir)) return [];
  let files: string[];
  try { files = selectChapterFiles(readdirSync(dataDir)); } catch { return []; }
  return files.map((f) => {
    let words = 0;
    try { words = wordCount(readFileSync(join(dataDir, f), 'utf-8')); } catch { words = 0; }
    return { chapter: f.replace(/\.md$/, ''), words };
  });
}

export function loadLengthOverrides(dataDir: string): Record<string, number> {
  try {
    const p = join(dataDir, '.length-targets.json');
    if (!existsSync(p)) return {};
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'number' && v > 0) out[k] = v;
    return out;
  } catch { return {}; }
}

export function saveLengthOverrides(dataDir: string, obj: Record<string, number>): void {
  writeFileSync(join(dataDir, '.length-targets.json'), JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

export function buildLengthReview(args: {
  chapters: { chapter: string; words: number }[];
  wordsPerChapter: number;
  overrides: Record<string, number>;
  form: StoryForm | null;
  genreRange: [number, number] | null;
}): LengthReview {
  const perChapter = args.chapters.map((c) => {
    const target = args.overrides[c.chapter] ?? args.wordsPerChapter;
    return { chapter: c.chapter, words: c.words, target, delta: c.words - target };
  });
  const totalWords = perChapter.reduce((a, c) => a + c.words, 0);
  const totalTarget = perChapter.reduce((a, c) => a + c.target, 0);
  let withinBand = true;
  let bandMessage: string | undefined;
  if (args.form) {
    const fit = validateFormFit(args.form, perChapter.length || 1, Math.round(totalTarget / (perChapter.length || 1)));
    withinBand = fit.ok; bandMessage = fit.message;
  }
  return { perChapter, totalWords, totalTarget, withinBand, bandMessage, genreRange: args.genreRange };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/format-review-length.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — batched.

---

### Task 9: Structure-review proposal (LLM) + parse + sidecar

**Files:**
- Modify: `gateway/src/services/format-review.ts` (add `parseBeatMappingResponse` + `loadStructureReview`/`saveStructureReview`)
- Test: `tests/unit/format-review-structure.test.ts`

**Interfaces:**
- Produces:
  - `parseBeatMappingResponse(text: string): { mapping: Record<string, number[]>; customBeats?: { name: string; expectedPct: number; pctRange: [number,number]; description: string }[] }` — strips code fences, JSON.parse, coerces.
  - `loadStructureReview(dataDir): { outline: {chapter:number; summary:string}[]; mapping: Record<string, number[]> }` / `saveStructureReview(dataDir, obj)` (sidecar `.structure-review.json`, fail-soft).

- [ ] **Step 1: Write the failing test** — `tests/unit/format-review-structure.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBeatMappingResponse, loadStructureReview, saveStructureReview } from '../../gateway/src/services/format-review.js';

test('parseBeatMappingResponse parses fenced JSON into a mapping', () => {
  const text = '```json\n{ "mapping": { "Setup": [1,2], "Climax": [18] } }\n```';
  const r = parseBeatMappingResponse(text);
  assert.deepEqual(r.mapping['Setup'], [1, 2]);
  assert.deepEqual(r.mapping['Climax'], [18]);
});

test('parseBeatMappingResponse tolerates a custom-beats scaffold; bad input → empty mapping', () => {
  const r = parseBeatMappingResponse('{"customBeats":[{"name":"Summer One","expectedPct":12,"pctRange":[0,25],"description":"x"}],"mapping":{}}');
  assert.equal(r.customBeats?.[0].name, 'Summer One');
  assert.deepEqual(parseBeatMappingResponse('not json').mapping, {});
});

test('structure-review sidecar round-trips fail-soft', () => {
  const root = mkdtempSync(join(tmpdir(), 'sr-'));
  try {
    const dataDir = join(root, 'data'); mkdirSync(dataDir, { recursive: true });
    assert.deepEqual(loadStructureReview(dataDir), { outline: [], mapping: {} });
    saveStructureReview(dataDir, { outline: [{ chapter: 1, summary: 'opens' }], mapping: { Setup: [1] } });
    assert.deepEqual(loadStructureReview(dataDir).mapping, { Setup: [1] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/format-review-structure.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Write minimal implementation** — append to `format-review.ts`:

```typescript
export function parseBeatMappingResponse(text: string): {
  mapping: Record<string, number[]>;
  customBeats?: { name: string; expectedPct: number; pctRange: [number, number]; description: string }[];
} {
  try {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(stripped) as any;
    const mapping: Record<string, number[]> = {};
    if (parsed?.mapping && typeof parsed.mapping === 'object') {
      for (const [k, v] of Object.entries(parsed.mapping)) {
        if (Array.isArray(v)) mapping[k] = v.map(Number).filter((n) => Number.isFinite(n) && n >= 1);
      }
    }
    const customBeats = Array.isArray(parsed?.customBeats)
      ? parsed.customBeats.map((b: any) => ({
          name: String(b.name ?? ''), expectedPct: Number(b.expectedPct) || 0,
          pctRange: Array.isArray(b.pctRange) ? [Number(b.pctRange[0]) || 0, Number(b.pctRange[1]) || 100] as [number, number] : [0, 100] as [number, number],
          description: String(b.description ?? ''),
        })).filter((b: any) => b.name)
      : undefined;
    return customBeats ? { mapping, customBeats } : { mapping };
  } catch { return { mapping: {} }; }
}

export function loadStructureReview(dataDir: string): { outline: { chapter: number; summary: string }[]; mapping: Record<string, number[]> } {
  try {
    const p = join(dataDir, '.structure-review.json');
    if (!existsSync(p)) return { outline: [], mapping: {} };
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    const outline = Array.isArray(raw?.outline) ? raw.outline.filter((o: any) => o && typeof o.summary === 'string') : [];
    const mapping = (raw?.mapping && typeof raw.mapping === 'object' && !Array.isArray(raw.mapping)) ? raw.mapping : {};
    return { outline, mapping };
  } catch { return { outline: [], mapping: {} }; }
}

export function saveStructureReview(dataDir: string, obj: { outline: { chapter: number; summary: string }[]; mapping: Record<string, number[]> }): void {
  writeFileSync(join(dataDir, '.structure-review.json'), JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/format-review-structure.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — batched.

---

### Task 10: Review routes

**Files:**
- Create: `gateway/src/api/routes/format-review.routes.ts` (registered in `routes.ts` like `consistency.routes.ts`)
- Modify: `gateway/src/api/routes.ts` (mount the new route module)

**Interfaces:**
- Consumes: `BookService` (`dataDirOf`, `open`, `setFormat`, manifest `format`); `resolveStructure`/`evaluateBeatMapping`/`StoryStructuresService`; all `format-review.ts` helpers; `genreGuideOf` or the genre `reader-expectations.md` source for `parseGenreWordRange`.
- Produces routes:
  - `GET /api/books/:slug/structure-review` → `{ structure, outline, mapping, report }` (report = `evaluateBeatMapping`).
  - `POST /api/books/:slug/structure-review/propose` → runs one LLM pass (provider via `aiRouter.select('consistency')` like the auditor), returns `{ mapping, customBeats? }`.
  - `PUT /api/books/:slug/structure-review` → saves `{ outline, mapping, customStructure? }` (custom beats persist to manifest via `setFormat`).
  - `GET /api/books/:slug/length-review` → `buildLengthReview(...)`.
  - `PUT /api/books/:slug/length-targets` → validates the resulting total via `validateFormFit`, saves overrides.

- [ ] **Step 1: Implement the route module**

Create `format-review.routes.ts` following `consistency.routes.ts` structure (a `createFormatReviewRoutes(app, services, gateway)` function). Each handler resolves `dataDir = services.books.dataDirOf(slug)` and the manifest `format`; returns `400`/`404` cleanly when the book or format is absent (`"format not configured"`). The propose handler builds the prompt from the resolved structure's beats + the stored/derived outline, calls the AI, and runs `parseBeatMappingResponse`. The length handler composes `countChapterWords` + `loadLengthOverrides` + `getForm(format.formId)` + `parseGenreWordRange(<genre reader-expectations.md>)`. `PUT length-targets` re-runs `validateFormFit` on `(chapters, round(newTotal/chapters))` and returns `400` with the message when out of band.

- [ ] **Step 2: Mount it**

In `gateway/src/api/routes.ts`, import and call `createFormatReviewRoutes(...)` next to where `consistency` routes are mounted.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: (covered by smoke)** End-to-end behavior asserted in Task 12 Phase-3 smoke section.

- [ ] **Step 5: Commit** — batched.

---

### Task 11: Studio "Structure & Length" panel

**Files:**
- Create: `frontend/studio/src/routes/StructureLength.tsx` (or a `BookDrawer` panel, matching how `Consistency.tsx` is surfaced)
- Modify: the studio router/nav to surface it per book; a small API client for the review routes.

**Interfaces:**
- Consumes: the Task 10 routes.
- Produces: a read-with-edit panel: structure section (declared structure, outline editor, "Propose mapping" button → editable beat→chapter mapping, coverage/position display from the report) + length section (per-chapter actual vs target table, total vs target, band check, a simple length bar curve, editable per-chapter target overrides with band re-validation on save).

- [ ] **Step 1: Implement the panel + client + nav wiring** (mirror `Consistency.tsx`).

- [ ] **Step 2: Build the frontend**

Run: `npm run build:frontend`
Expected: exit 0.

- [ ] **Step 3: Commit** — batched.

---

### Task 12: Smoke test (grown across phases) + full verification

**Files:**
- Create: `tests/book-format-smoke.sh`

**Phase-1 assertions** (add when Task 5 lands): boot the gateway (loopback, env token, like `consistency-smoke.sh`); `POST /api/books` with `{ form: novella, structure: four_act, chapterCount: 20, wordsPerChapter: 1500 }` → 200 and the book's `book.json` has a `format` block; `POST /api/books` with `{ form: short-story, chapterCount: 24, wordsPerChapter: 100000 }` → **400** with a band message; `GET /api/forms` lists the 8 forms.

**Phase-2 assertions** (add when Task 6 lands): create a book with a format, create its project/sequence, and assert the outline/planning step prompt contains the structure rail text (via the project API) and chapter write steps carry `wordCountTarget == wordsPerChapter`.

**Phase-3 assertions** (add when Task 10/11 land): write 2 chapters + seed a `.structure-review.json` outline; `POST …/structure-review/propose` → 200 with a `mapping`; `PUT …/structure-review` persists; `GET …/length-review` returns per-chapter actual-vs-target + the band check; `PUT …/length-targets` with an out-of-band total → 400. The knowledge-LLM-dependent propose step is gated like the consistency smoke (skip with a notice if the model returns no mapping). Hermetic; cleanup trap deletes the book + sidecars.

- [ ] **Step 1: Write `tests/book-format-smoke.sh`** copying the scaffold (boot/cleanup/poll/`-v`) from `tests/consistency-smoke.sh`, with the assertions above (start with Phase-1; the executing agent appends Phase-2 then Phase-3 sections as those phases land — "updated with each phase" per the goal).

- [ ] **Step 2: Syntax + local run**

Run: `bash -n tests/book-format-smoke.sh` then `tests/book-format-smoke.sh -v`
Expected: syntax OK; PASS locally (LLM-dependent propose may SKIP on a weak model — that's acceptable, like the consistency smoke).

- [ ] **Step 3: Full type-check + unit suite**

Run: `npx tsc --noEmit` then `node --import tsx --test tests/unit/*.test.ts`
Expected: tsc clean; all unit tests pass.

- [ ] **Step 4: Commit** — batched.

---

## Self-Review

**Spec coverage:**
- Two selectors at creation (structure × form) → Tasks 4, 5. ✓
- Comprehensive structure catalog + Four-Act + custom → Task 2. ✓
- Form catalog + `validateFormFit` → Task 1. ✓
- Chapter count + words-per-chapter + hard band-block → Tasks 1 (helper), 4 (route 400), 5 (live check), 12 (smoke 400). ✓
- Drives generation (per-chapter target + structure rail) → Task 6. ✓
- Drives review (structure + length, editable) → Tasks 7, 8, 9, 10, 11. ✓
- Custom structure handled uniformly → Task 2 (`resolveStructure`), used in 4/6/10. ✓
- Outline editable + sidecar; mapping sidecar; length overrides sidecar → Tasks 8, 9. ✓
- Manifest `format` additive, no schema bump → Task 3. ✓
- Deterministic checks; LLM only outline rail + propose → Tasks 6, 9/10. ✓
- Phased (1 catalog/config, 2 generation, 3 review) → task grouping + smoke grown per phase (Task 12). ✓

**Placeholder scan:** No TBD/TODO; deterministic-unit tasks carry full code. Frontend tasks (5, 11) and the route-wiring task (10) describe concrete files/handlers and are verified by `tsc`/`build:frontend`/the smoke rather than inline React/Express bodies — acceptable since their behavior is asserted end-to-end in Task 12.

**Type consistency:** `BookFormat` shape identical in Tasks 3/4; `formatGuideFor` returns `{chapterCount, wordsPerChapter, structureRail}` (Task 3) consumed in Task 6; `resolveStructure(input, svc)` signature consistent (Tasks 2/3/4); `evaluateBeatMapping(structure, mapping, totalChapters)` consistent (Tasks 7/10); `mapping` is `Record<string, number[]>` (1-based chapters) across Tasks 7/9/10; sidecar names `.structure-review.json` / `.length-targets.json` consistent (Tasks 8/9/10).
