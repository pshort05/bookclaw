# Easy Button — Starter Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a studio-only 3-click "New Book — Easy" wizard that creates a fully-configured book from one of three public Starter Bundles and auto-runs planning.

**Architecture:** A frontend bundle catalog (pure-data TS) drives a 3-step wizard route in the v6 React studio. Selecting a bundle resolves its `novel` sequence to a pipeline list, then calls the existing `POST /api/books` (author/voice/genre + format) followed by the existing book-active → `projects/create` → `start` → `auto-execute` run path. No backend changes. A backend unit test (run by the existing `node --import tsx --test` runner, importing the pure-data catalog) enforces that every bundle references only committed built-in `library/` assets and is length-valid.

**Tech Stack:** TypeScript (NodeNext on the backend, Vite/React in `frontend/studio/`), `node:test` via `tsx`, bash smoke test, the shared `api()` helper in `frontend/shared/src/api.ts`.

## Global Constraints

- **Give away the method, not the books:** bundles may reference ONLY committed built-in `library/` slugs — never a `workspace/` overlay asset, never PKstyle, never a real pen name. Enforced by the Task 1 unit test.
- **Imports on backend `.ts` use `.js` extensions** (NodeNext). Frontend imports under `frontend/studio/` do NOT (Vite bundler resolution) — match each side's existing files.
- **`frontend/studio/src/data/bundles.ts` MUST have zero imports** (pure data + one local interface) so the backend test can import it under NodeNext without extension/resolution issues.
- **Book-format API field names** are exactly `structure`, `form`, `chapterCount`, `wordsPerChapter` (per `gateway/src/services/format-input.ts`).
- **Form band:** form `novel` = 40,000–120,000 words; all three bundles total ~80–84k (in-band).
- **Real assets only** (verified present): authors/voices `warm-smalltown-romance`, `kinetic-ya-scifi`, `contemporary-thriller`; genres `contemporary-romance`, `hard-science-fiction`, `military-thriller`; sequence `novel`; structures `romancing_the_beat`, `three_act`; form `novel`.
- **No unit-test runner in the frontend** — the guardrail test is a backend `node:test` importing the pure-data catalog. Wizard UI is verified by `npm run build:frontend` + the smoke test.
- Fail-soft: an auto-run failure must leave the created book intact and usable; surface the error, do not roll back the book.

## File Structure

- `frontend/studio/src/data/bundles.ts` — **Create.** Pure data: `StarterBundle` interface + `BUNDLES` array (3 entries). Zero imports.
- `frontend/studio/src/lib/easyApi.ts` — **Create.** `bundleToCreateBody()` (pure), `resolveSequencePipelines()`, `createBookFromBundle()`, `startBookGeneration()`.
- `frontend/studio/src/routes/EasyStart.tsx` + `EasyStart.module.css` — **Create.** The 3-step wizard.
- `frontend/studio/src/main.tsx` — **Modify.** Register `<Route path="start" element={<EasyStart />} />`.
- `frontend/studio/src/Rail.tsx` — **Modify.** Add a nav link to `/start` ("New Book — Easy").
- `tests/unit/easy-button-bundles.test.ts` — **Create.** Guardrail + correctness over `BUNDLES`.
- `tests/easy-button-smoke.sh` — **Create.** Boot gateway; create-from-bundle contract for all 3; teardown. Grown across tasks.

---

### Task 1: Bundle catalog + guardrail unit test

**Files:**
- Create: `frontend/studio/src/data/bundles.ts`
- Test: `tests/unit/easy-button-bundles.test.ts`

**Interfaces:**
- Produces: `interface StarterBundle { id: string; title: string; tagline: string; icon: string; author: string; voice: string; genre: string; sequence: string; format: { structure: string; form: string; chapterCount: number; wordsPerChapter: number }; modelTier: 'free' }` and `export const BUNDLES: StarterBundle[]`.

- [ ] **Step 1: Write the failing test** — `tests/unit/easy-button-bundles.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
// Pure-data catalog (no imports inside it), imported with the .js specifier (NodeNext).
import { BUNDLES } from '../../frontend/studio/src/data/bundles.js';
import { StoryStructureService } from '../../gateway/src/services/story-structures.js';
import { getForm, validateFormFit } from '../../gateway/src/services/story-forms.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const lib = (k: string, name: string) => resolve(repoRoot, 'library', k, name);
const structures = new StoryStructureService();

test('three starter bundles ship', () => {
  assert.equal(BUNDLES.length, 3);
  assert.deepEqual(BUNDLES.map(b => b.id).sort(), ['romance', 'scifi', 'thriller']);
});

test('every bundle references only built-in public library assets (the IP guardrail)', () => {
  for (const b of BUNDLES) {
    assert.ok(existsSync(lib('authors', b.author)), `author ${b.author}`);
    assert.ok(existsSync(lib('voices', b.voice)), `voice ${b.voice}`);
    assert.ok(existsSync(lib('genres', b.genre)), `genre ${b.genre}`);
    assert.ok(existsSync(lib('sequences', `${b.sequence}.json`)), `sequence ${b.sequence}`);
  }
});

test('every bundle has a known structure and an in-band length', () => {
  for (const b of BUNDLES) {
    assert.ok(structures.get(b.format.structure as any), `structure ${b.format.structure}`);
    const form = getForm(b.format.form);
    assert.ok(form, `form ${b.format.form}`);
    const fit = validateFormFit(form!, b.format.chapterCount, b.format.wordsPerChapter);
    assert.ok(fit.ok, `${b.id} length out of band: ${fit.message}`);
    assert.equal(b.modelTier, 'free');
  }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --import tsx --test tests/unit/easy-button-bundles.test.ts`
Expected: FAIL — cannot find module `bundles.js`.

- [ ] **Step 3: Create the catalog** — `frontend/studio/src/data/bundles.ts`

```ts
// Public Starter Bundles for the Easy Button. PURE DATA — keep zero imports so
// the backend unit test (NodeNext) can import this file directly.
// IP rule: every author/voice/genre/sequence below MUST be a committed built-in
// library/ asset (never a workspace overlay asset, PKstyle, or a real pen name).
export interface StarterBundle {
  id: string;
  title: string;
  tagline: string;
  icon: string; // Font Awesome class, e.g. 'fa-solid fa-heart'
  author: string;
  voice: string;
  genre: string;
  sequence: string;
  format: { structure: string; form: string; chapterCount: number; wordsPerChapter: number };
  modelTier: 'free';
}

export const BUNDLES: StarterBundle[] = [
  {
    id: 'romance', title: 'Contemporary Romance',
    tagline: 'Heartfelt, character-driven, happily-ever-after.',
    icon: 'fa-solid fa-heart',
    author: 'warm-smalltown-romance', voice: 'warm-smalltown-romance',
    genre: 'contemporary-romance', sequence: 'novel',
    format: { structure: 'romancing_the_beat', form: 'novel', chapterCount: 32, wordsPerChapter: 2500 },
    modelTier: 'free',
  },
  {
    id: 'scifi', title: 'Hard Sci-Fi',
    tagline: 'Big ideas, real science, a sense of wonder.',
    icon: 'fa-solid fa-rocket',
    author: 'kinetic-ya-scifi', voice: 'kinetic-ya-scifi',
    genre: 'hard-science-fiction', sequence: 'novel',
    format: { structure: 'three_act', form: 'novel', chapterCount: 30, wordsPerChapter: 2800 },
    modelTier: 'free',
  },
  {
    id: 'thriller', title: 'Thriller',
    tagline: 'Relentless pace, rising stakes, no safe ground.',
    icon: 'fa-solid fa-bolt',
    author: 'contemporary-thriller', voice: 'contemporary-thriller',
    genre: 'military-thriller', sequence: 'novel',
    format: { structure: 'three_act', form: 'novel', chapterCount: 40, wordsPerChapter: 2000 },
    modelTier: 'free',
  },
];
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node --import tsx --test tests/unit/easy-button-bundles.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the smoke-test skeleton** — `tests/easy-button-smoke.sh`

Model it on `tests/book-format-smoke.sh` (same boot/teardown harness, free port, hermetic). Skeleton boots the gateway on a free port with `BOOKCLAW_AUTH_DISABLED=1`, waits for `/healthz`, and exits 0. Later tasks add the create-from-bundle checks. Make it executable (`chmod +x`).

- [ ] **Step 6: Run the smoke skeleton**

Run: `bash tests/easy-button-smoke.sh`
Expected: boots, `healthz` OK, exits 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/studio/src/data/bundles.ts tests/unit/easy-button-bundles.test.ts tests/easy-button-smoke.sh
git commit -m "feat(easy-button): public starter-bundle catalog + IP-guardrail test + smoke skeleton"
```

---

### Task 2: Create-payload helper + studio API wrappers

**Files:**
- Create: `frontend/studio/src/lib/easyApi.ts`
- Test: `tests/unit/easy-button-bundles.test.ts` (extend with `bundleToCreateBody` cases)

**Interfaces:**
- Consumes: `StarterBundle`, `BUNDLES` (Task 1); the shared `api<T>(path, init?)` from `frontend/shared/src/api.ts`.
- Produces:
  - `bundleToCreateBody(bundle: StarterBundle, title: string, pipelines: string[]): Record<string, unknown>` (pure).
  - `resolveSequencePipelines(sequence: string): Promise<string[]>`
  - `createBookFromBundle(bundle: StarterBundle, title: string): Promise<{ slug: string }>`
  - `startBookGeneration(slug: string, premise: string): Promise<{ projectId: string }>`

- [ ] **Step 1: Write the failing test** (append to `tests/unit/easy-button-bundles.test.ts`)

```ts
import { bundleToCreateBody } from '../../frontend/studio/src/lib/easyApi.js';

test('bundleToCreateBody builds the POST /api/books body from a bundle', () => {
  const b = BUNDLES[0];
  const body = bundleToCreateBody(b, '  My Book  ', ['book-planning', 'book-bible']) as any;
  assert.equal(body.title, 'My Book');            // trimmed
  assert.equal(body.author, b.author);
  assert.equal(body.voice, b.voice);
  assert.equal(body.genre, b.genre);
  assert.equal(body.sequence, b.sequence);
  assert.deepEqual(body.pipelineSequence, ['book-planning', 'book-bible']);
  assert.equal(body.structure, b.format.structure);
  assert.equal(body.form, b.format.form);
  assert.equal(body.chapterCount, b.format.chapterCount);
  assert.equal(body.wordsPerChapter, b.format.wordsPerChapter);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --import tsx --test tests/unit/easy-button-bundles.test.ts`
Expected: FAIL — cannot find module `easyApi.js`.

- [ ] **Step 3: Implement** — `frontend/studio/src/lib/easyApi.ts`

```ts
import { api } from '@shared/api';
import type { StarterBundle } from '../data/bundles';

// Pure: shape the POST /api/books body. `pipelines` is the resolved sequence list.
export function bundleToCreateBody(bundle: StarterBundle, title: string, pipelines: string[]): Record<string, unknown> {
  return {
    title: title.trim(),
    author: bundle.author,
    voice: bundle.voice,
    genre: bundle.genre,
    sequence: bundle.sequence,
    pipelineSequence: pipelines,
    structure: bundle.format.structure,
    form: bundle.format.form,
    chapterCount: bundle.format.chapterCount,
    wordsPerChapter: bundle.format.wordsPerChapter,
  };
}

// Resolve a sequence preset to its ordered pipeline list (mirrors NewBook.tsx).
export async function resolveSequencePipelines(sequence: string): Promise<string[]> {
  const r = await api<{ entry: { sequence?: { pipelines?: string[] }; content?: string } }>(
    `/api/library/sequence/${encodeURIComponent(sequence)}`,
  );
  const e = r.entry;
  if (e.sequence?.pipelines) return e.sequence.pipelines;
  if (typeof e.content === 'string') { try { return JSON.parse(e.content).pipelines ?? []; } catch { /* ignore */ } }
  return [];
}

export async function createBookFromBundle(bundle: StarterBundle, title: string): Promise<{ slug: string }> {
  const pipelines = await resolveSequencePipelines(bundle.sequence);
  const r = await api<{ book: { slug: string } }>('/api/books', {
    method: 'POST',
    body: JSON.stringify(bundleToCreateBody(bundle, title, pipelines)),
  });
  return { slug: r.book.slug };
}

// Make the book active, create its project, start it, and auto-run planning.
export async function startBookGeneration(slug: string, premise: string): Promise<{ projectId: string }> {
  await api('/api/books/active', { method: 'POST', body: JSON.stringify({ slug }) });
  const created = await api<{ project: { id: string } }>('/api/projects/create', {
    method: 'POST',
    body: JSON.stringify({ title: slug, description: premise }),
  });
  const id = created.project.id;
  await api(`/api/projects/${encodeURIComponent(id)}/start`, { method: 'POST', body: '{}' }).catch(() => {});
  await api(`/api/projects/${encodeURIComponent(id)}/auto-execute`, { method: 'POST', body: '{}' }).catch(() => {});
  return { projectId: id };
}
```

Note: confirm the `@shared/api` import alias against `frontend/studio/`'s existing imports (e.g. how `NewBook.tsx`/`assetApi.ts` import `api`); use the same specifier they use. If they import via a relative path, match that instead.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node --import tsx --test tests/unit/easy-button-bundles.test.ts`
Expected: PASS (4 tests). (`bundleToCreateBody` import works; the network helpers aren't exercised here — the smoke test covers them.)

- [ ] **Step 5: Extend the smoke test** — add a create-from-bundle contract check to `tests/easy-button-smoke.sh`

For each bundle id (romance/scifi/thriller) with its known fields, `POST /api/books` with the same body `bundleToCreateBody` produces (resolve `pipelineSequence` first via `GET /api/library/sequence/novel`), then assert HTTP 200 and that `GET /api/books` shows the new slug with a persisted `format` (e.g. `format.formId == "novel"`). Use a unique title per run. Teardown deletes each created book via `DELETE /api/books/:slug`.

- [ ] **Step 6: Run the smoke test**

Run: `bash tests/easy-button-smoke.sh`
Expected: all 3 bundles create a book with a persisted format; teardown removes them; exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/studio/src/lib/easyApi.ts tests/unit/easy-button-bundles.test.ts tests/easy-button-smoke.sh
git commit -m "feat(easy-button): create-payload helper + studio API wrappers + smoke create-contract"
```

---

### Task 3: The 3-step wizard route

**Files:**
- Create: `frontend/studio/src/routes/EasyStart.tsx`, `frontend/studio/src/routes/EasyStart.module.css`
- Modify: `frontend/studio/src/main.tsx` (add the route)
- Modify: `frontend/studio/src/Rail.tsx` (add the nav link)

**Interfaces:**
- Consumes: `BUNDLES` (Task 1); `createBookFromBundle`, `startBookGeneration` (Task 2); `useNavigate` from `react-router-dom`.

- [ ] **Step 1: Build `EasyStart.tsx`** — a 3-step wizard:
  - Local state: `step` (1|2|3), `title`, `premise`, `selected: StarterBundle | null`, `busy`, `error`.
  - **Step 1 (Describe):** a title input + a one-sentence premise textarea. "Next" enabled when `title.trim()` is non-empty.
  - **Step 2 (Pick a bundle):** render `BUNDLES` as cards (icon via `<i className={b.icon} />`, `title`, `tagline`, a derived "≈{chapterCount × wordsPerChapter / 1000}k-word novel" line). Selecting sets `selected` and advances to step 3.
  - **Step 3 (Review & start):** a plain-language summary ("You're writing a *{selected.title}* novel, ~{k}k words, in the {voice} voice, on {structure-name}.") and a primary "Start writing" button. On click, set `busy`, then:

```tsx
const start = async () => {
  if (!selected) return;
  setBusy(true); setError(null);
  try {
    const { slug } = await createBookFromBundle(selected, title);
    await startBookGeneration(slug, premise.trim() || title.trim());
    navigate(`/write/${encodeURIComponent(slug)}`);
  } catch (e) {
    setError(String(e)); setBusy(false);   // book may exist; leave it, show error
  }
};
```

Match the studio's existing component/CSS-module conventions (see `NewBook.tsx` / `NewBook.module.css`). Keep `EasyStart.module.css` minimal (step container, card grid, primary button).

- [ ] **Step 2: Register the route** — `frontend/studio/src/main.tsx`, after the `new-book` route:

```tsx
<Route path="start" element={<EasyStart />} />
```
and add `import EasyStart from './routes/EasyStart';` (match the existing route-import style in `main.tsx`).

- [ ] **Step 3: Add the Rail link** — `frontend/studio/src/Rail.tsx`, near the New Book entry, a link to `/start` labeled "New Book — Easy" (reuse the existing nav-link markup pattern in that file).

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit` (backend clean) and `npm run build:frontend`
Expected: both exit 0 (the wizard compiles; route + rail resolve).

- [ ] **Step 5: Commit**

```bash
git add frontend/studio/src/routes/EasyStart.tsx frontend/studio/src/routes/EasyStart.module.css frontend/studio/src/main.tsx frontend/studio/src/Rail.tsx
git commit -m "feat(easy-button): 3-step New Book (Easy) wizard route + rail link"
```

---

### Task 4: Finalize the smoke test (negative + teardown rigor)

**Files:**
- Modify: `tests/easy-button-smoke.sh`

- [ ] **Step 1: Add an out-of-IP negative assertion.** Add a check that a deliberately bad body (a bundle-shaped payload whose `genre` is a non-existent slug) is handled by the API as a normal validation/creation outcome (document the observed behavior — the guardrail that matters for *shipped* bundles is the Task 1 unit test; this just confirms the create endpoint doesn't 500 on a bad genre). Keep it non-fatal/observational if behavior is "creates with no genre."

- [ ] **Step 2: Verify teardown leaves no residue.** After teardown, `GET /api/books` must not list any of the smoke's created slugs. Assert the count returns to its pre-test value.

- [ ] **Step 3: Run the full smoke**

Run: `bash tests/easy-button-smoke.sh`
Expected: all phases PASS; no residual books; exit 0.

- [ ] **Step 4: Run the whole unit suite + build**

Run: `node --import tsx --test tests/unit/*.test.ts` then `npm run build:frontend`
Expected: full suite green; frontend build exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/easy-button-smoke.sh
git commit -m "test(easy-button): finalize smoke — negative genre + teardown residue check"
```

---

## Self-Review

**1. Spec coverage:**
- 3-click wizard (describe → bundle → start) → Task 3. ✓
- Bundle-first, rich (voice+genre+pipeline+format+tier) → Task 1 catalog. ✓
- Frontend-only presets → `bundles.ts` (Task 1). ✓
- Create + auto-run planning on free tier → `startBookGeneration` (Task 2), wired in Task 3. ✓
- IP guardrail enforced by test → Task 1 test. ✓
- The 3 bundles with concrete public assets → Task 1. ✓
- Unit + smoke testing → Tasks 1, 2, 4. ✓
- Deferred items (AI Muse, bundle library kind, roster >3, graduation nudges) → not built. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases". The two areas flagged for confirmation-against-code (the `@shared/api` import specifier; the exact Rail/route import style) are "match the existing pattern in named files," not unspecified work. The `modelTier:'free'` → cheap-routing wiring: the MVP carries the field and runs on the gateway's default routing; no extra per-step model plumbing is in scope (auto-execute uses the book's pipeline task tiers, which already favor cheap/free providers). Documented, not a gap.

**3. Type consistency:** `StarterBundle` fields and `bundleToCreateBody` payload keys (`structure`/`form`/`chapterCount`/`wordsPerChapter`) match `buildBookFormat`'s expected body. `createBookFromBundle`/`startBookGeneration` signatures are used exactly as defined in Task 3. Library kinds checked: `authors`, `voices`, `genres` are directories; `sequences/<name>.json` is a file (test uses the right shape for each).
