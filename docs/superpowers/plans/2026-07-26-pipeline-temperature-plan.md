# Per-book Creative / Surgical Temperature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each book two adjustable temperature buckets — Creative and Surgical — auto-applied by classifying every step (role first, taskType fallback), so creative steps run warm (≥0.7) and surgical steps run cool (≤0.4) without per-step fiddling.

**Architecture:** A pure `temperatureBucket(role, taskType)` classifier maps each step to a bucket; `resolveBucketTemperature` reads the book's `temperatures.{creative,surgical}`. `castStep`/`stepRouting` apply the bucket temperature as a new layer — below an explicit per-step `modelOverride.temperature`, above the casting-sheet role temperature. The book field is set through the existing `/api/books/:slug/models` + `BookModelsPanel`. No pipeline JSON changes.

**Tech Stack:** Node 22 + TypeScript via `tsx`, `node:test`, Express, React (Vite studio). `.js` import extensions on `.ts` (NodeNext).

## Global Constraints

- **Node 22+**, TS via `--import tsx`; `.js` import extensions on `.ts`.
- **No git commits per task.** Repo uses `commit_message` + `./push.sh`. Each task ends with a **Checkpoint** (its test file green), not `git commit`.
- **Fast unit iteration:** `node --import tsx --test tests/unit/<file>.test.ts`. Full `npm run test:unit` once at the end.
- **Defaults:** creative **0.8**, surgical **0.3**. **Validation band `[0, 2]`.**
- **Precedence:** `explicit modelOverride.temperature > book bucket temperature > casting-sheet role temperature > provider default 0.7`.
- **Bucketing (verbatim from spec):** Creative roles `{scene_brief, draft, intimacy, approach, improve, rewrite, outline, bible, marketing}`; Surgical roles `{humanize, editorial, analysis, continuity, format, research, plan}`; Creative taskTypes `{creative_writing, outline, book_bible, marketing, style_analysis}`; Surgical taskTypes `{consistency, revision, final_edit, research}`; unknown/`general` → **creative**.
- **No pipeline JSON edits** (creative steps already unpinned; surgical baked temps already 0.2–0.4).

---

### Task 1: `temperatureBucket` classifier + `resolveBucketTemperature`

**Files:**
- Create: `gateway/src/services/casting/temperature.ts`
- Test: `tests/unit/temperature-bucket.test.ts`

**Interfaces:**
- Consumes: `StepRole` (`casting/roles.ts`).
- Produces:
  ```ts
  export type TempBucket = 'creative' | 'surgical';
  export function temperatureBucket(role: StepRole | undefined, taskType: string | undefined): TempBucket;
  export function resolveBucketTemperature(temps: { creative?: number; surgical?: number } | undefined, role: StepRole | undefined, taskType: string | undefined): number | undefined;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/temperature-bucket.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { temperatureBucket, resolveBucketTemperature } from '../../gateway/src/services/casting/temperature.js';

test('creative roles → creative', () => {
  for (const r of ['scene_brief', 'draft', 'intimacy', 'approach', 'improve', 'rewrite', 'outline', 'bible', 'marketing'] as const) {
    assert.equal(temperatureBucket(r, 'x'), 'creative', r);
  }
});

test('surgical roles → surgical', () => {
  for (const r of ['humanize', 'editorial', 'analysis', 'continuity', 'format', 'research', 'plan'] as const) {
    assert.equal(temperatureBucket(r, 'x'), 'surgical', r);
  }
});

test('untagged: taskType decides', () => {
  assert.equal(temperatureBucket(undefined, 'creative_writing'), 'creative');
  assert.equal(temperatureBucket(undefined, 'consistency'), 'surgical');
  assert.equal(temperatureBucket(undefined, 'final_edit'), 'surgical');
});

test('unknown role and taskType → creative', () => {
  assert.equal(temperatureBucket(undefined, 'general'), 'creative');
  assert.equal(temperatureBucket(undefined, undefined), 'creative');
});

test('resolveBucketTemperature reads the right bucket; undefined when no temps', () => {
  const temps = { creative: 0.9, surgical: 0.25 };
  assert.equal(resolveBucketTemperature(temps, 'draft', 'creative_writing'), 0.9);
  assert.equal(resolveBucketTemperature(temps, 'continuity', 'revision'), 0.25);
  assert.equal(resolveBucketTemperature(undefined, 'draft', 'creative_writing'), undefined);
  assert.equal(resolveBucketTemperature({ creative: 0.9 }, 'continuity', 'revision'), undefined); // surgical unset
});
```

- [ ] **Step 2: Run to verify it fails** — `node --import tsx --test tests/unit/temperature-bucket.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

Create `gateway/src/services/casting/temperature.ts`:
```ts
import type { StepRole } from './roles.js';

export type TempBucket = 'creative' | 'surgical';

const CREATIVE_ROLES = new Set<StepRole>(['scene_brief', 'draft', 'intimacy', 'approach', 'improve', 'rewrite', 'outline', 'bible', 'marketing']);
const SURGICAL_ROLES = new Set<StepRole>(['humanize', 'editorial', 'analysis', 'continuity', 'format', 'research', 'plan']);
const CREATIVE_TASKS = new Set<string>(['creative_writing', 'outline', 'book_bible', 'marketing', 'style_analysis']);
const SURGICAL_TASKS = new Set<string>(['consistency', 'revision', 'final_edit', 'research']);

/** Classify a step creative vs surgical: role decides when present, taskType is the
 *  fallback for untagged steps. Unknown → creative (a neutral step reads conversational). */
export function temperatureBucket(role: StepRole | undefined, taskType: string | undefined): TempBucket {
  if (role && SURGICAL_ROLES.has(role)) return 'surgical';
  if (role && CREATIVE_ROLES.has(role)) return 'creative';
  if (taskType && SURGICAL_TASKS.has(taskType)) return 'surgical';
  if (taskType && CREATIVE_TASKS.has(taskType)) return 'creative';
  return 'creative';
}

/** The book's temperature for this step's bucket, or undefined when unset. */
export function resolveBucketTemperature(
  temps: { creative?: number; surgical?: number } | undefined,
  role: StepRole | undefined,
  taskType: string | undefined,
): number | undefined {
  if (!temps) return undefined;
  const v = temperatureBucket(role, taskType) === 'creative' ? temps.creative : temps.surgical;
  return typeof v === 'number' ? v : undefined;
}
```

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Checkpoint** — file green.

---

### Task 2: `castStep` applies the bucket temperature (below manual pin, above sheet)

**Files:**
- Modify: `gateway/src/services/casting/cast-step.ts` (`CastInputs` + the post-resolution temperature step ~L66-69)
- Test: `tests/unit/cast-step.test.ts` (append)

**Interfaces:**
- Consumes: nothing new (a plain `number`).
- Produces: `CastInputs.bucketTemperature?: number`; applied so `mo.temperature > bucketTemperature > source temp`.

- [ ] **Step 1: Write the failing tests** — append to `tests/unit/cast-step.test.ts`:
```ts
test('bucketTemperature overrides the casting-sheet role temperature', () => {
  const r = castStep({ step: { role: 'draft' }, sheet, bucketTemperature: 0.85 });
  assert.equal(r.model, 'anthropic/claude-opus-4.6'); // model still from the sheet
  assert.equal(r.temperature, 0.85);                  // temp from the bucket, not the sheet's 1
});

test('an explicit modelOverride.temperature still wins over bucketTemperature', () => {
  const r = castStep({ step: { role: 'draft', modelOverride: { temperature: 0.2 } }, sheet, bucketTemperature: 0.85 });
  assert.equal(r.temperature, 0.2);
});

test('no bucketTemperature → the sheet temperature is unchanged', () => {
  const r = castStep({ step: { role: 'draft' }, sheet });
  assert.equal(r.temperature, 1);
});
```

- [ ] **Step 2: Run to verify it fails** — `node --import tsx --test tests/unit/cast-step.test.ts` → FAIL (bucket ignored).

- [ ] **Step 3: Implement**

In `gateway/src/services/casting/cast-step.ts`, add to `CastInputs`:
```ts
  bucketTemperature?: number;
```
Destructure it: `const { step, sheet, proseModel, authorModels, spiceRoute, bucketTemperature } = inputs;`
Change the post-resolution temperature step (currently just the manual-pin line):
```ts
  // Temperature precedence: an explicit per-step pin wins; else the book's
  // Creative/Surgical bucket temperature; else whatever the model source set.
  if (typeof mo?.temperature === 'number') result.temperature = mo.temperature;
  else if (typeof bucketTemperature === 'number') result.temperature = bucketTemperature;
```

- [ ] **Step 4: Run to verify it passes** — PASS (all cast-step tests).
- [ ] **Step 5: Checkpoint** — cast-step test green.

---

### Task 3: `stepRouting` computes the bucket temp (both paths) + `applyBookModelConfig` sync

**Files:**
- Modify: `gateway/src/api/routes/_shared.ts` (`applyBookModelConfig`; `stepRouting` untagged path ~L240-246 and tagged path ~L258-262)
- Test: `tests/unit/temperature-routing.test.ts` (create)

**Interfaces:**
- Consumes: `resolveBucketTemperature` (Task 1), `castStep.bucketTemperature` (Task 2).
- Produces: `applyBookModelConfig` copies `manifest.temperatures` onto the project; `stepRouting` resolves the bucket temp from `project.temperatures` for both tagged and untagged steps.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/temperature-routing.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRouting, applyBookModelConfig } from '../../gateway/src/api/routes/_shared.js';

test('applyBookModelConfig syncs temperatures onto the project', () => {
  const project: any = {};
  applyBookModelConfig(project, { temperatures: { creative: 0.9, surgical: 0.25 } });
  assert.deepEqual(project.temperatures, { creative: 0.9, surgical: 0.25 });
});

test('a creative-role step resolves the creative temperature', () => {
  const project: any = { genre: 'romance', temperatures: { creative: 0.9, surgical: 0.25 } };
  assert.equal(stepRouting(project, { role: 'draft', taskType: 'creative_writing' }).temperature, 0.9);
});

test('a surgical-role step resolves the surgical temperature (overriding the sheet)', () => {
  const project: any = { genre: 'romance', temperatures: { creative: 0.9, surgical: 0.25 } };
  // romance sheet continuity temp is 0.2; the book surgical knob (0.25) wins
  assert.equal(stepRouting(project, { role: 'continuity', taskType: 'revision' }).temperature, 0.25);
});

test('an untagged surgical step resolves the surgical temperature', () => {
  const project: any = { genre: '__no_sheet__', temperatures: { creative: 0.9, surgical: 0.25 } };
  assert.equal(stepRouting(project, { taskType: 'consistency' }).temperature, 0.25);
});

test('no temperatures on the project → temperature unchanged (regression)', () => {
  const project: any = { genre: 'romance' };
  // romance draft sheet temp is 1
  assert.equal(stepRouting(project, { role: 'draft', taskType: 'creative_writing' }).temperature, 1);
});

test('an explicit per-step modelOverride.temperature still wins', () => {
  const project: any = { genre: 'romance', temperatures: { creative: 0.9, surgical: 0.25 } };
  assert.equal(stepRouting(project, { role: 'draft', taskType: 'creative_writing', modelOverride: { temperature: 0.15 } }).temperature, 0.15);
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

In `_shared.ts`, import the helper:
```ts
import { resolveBucketTemperature } from '../../services/casting/temperature.js';
```
Extend `applyBookModelConfig` (after the existing assignments):
```ts
  project.temperatures = manifest.temperatures;
```
In `stepRouting`, untagged path (the `if (!role) { return {...} }` block), replace the temperature line:
```ts
  if (!role) {
    const bucketTemp = resolveBucketTemperature(project?.temperatures, undefined, step?.taskType);
    return {
      provider: effectiveOverride?.provider || project?.preferredProvider || undefined,
      model: effectiveOverride?.model || project?.preferredModel || undefined,
      temperature: typeof effectiveOverride?.temperature === 'number' ? effectiveOverride.temperature : bucketTemp,
    };
  }
```
In the tagged path, compute the bucket temp and pass it to `castStep` (extend the existing `castStep({...})` call):
```ts
  const bucketTemperature = resolveBucketTemperature(project?.temperatures, role, step?.taskType);
  const r = castStep({ step: { role, modelOverride: effectiveOverride }, sheet, proseModel, authorModels, bucketTemperature, spiceRoute: spiceRoute ?? null });
```

- [ ] **Step 4: Run to verify it passes** — PASS.
- [ ] **Step 5: Regression** — `node --import tsx --test tests/unit/casting-steprouting-compat.test.ts tests/unit/step-routing-temperature.test.ts tests/unit/author-role-models-routing.test.ts tests/unit/cast-step.test.ts` → PASS.
- [ ] **Step 6: Checkpoint** — routing test + regressions green.

---

### Task 4: `BookManifest.temperatures` + `BookService.setTemperatures`

**Files:**
- Modify: `gateway/src/services/book-types.ts` (`BookManifest`)
- Modify: `gateway/src/services/book.ts` (`setTemperatures`, mirroring `setReviewCadence`)
- Test: `tests/unit/book-temperatures.test.ts` (create)

**Interfaces:**
- Produces: `BookManifest.temperatures?: { creative?: number; surgical?: number }`; `setTemperatures(slug, { creative?, surgical? }): Promise<BookManifest>` — sets the field; when neither value is a finite number, deletes it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/book-temperatures.test.ts` (reuse the harness from `tests/unit/book-review-cadence.test.ts` — temp dir + `LibraryService` + `BookService`; create a book, then):
```ts
let m = await books.setTemperatures(slug, { creative: 0.9, surgical: 0.25 });
assert.deepEqual(m.temperatures, { creative: 0.9, surgical: 0.25 });
m = await books.setTemperatures(slug, {});
assert.equal(m.temperatures, undefined);
```
(Read `tests/unit/book-review-cadence.test.ts` and copy its setup verbatim, swapping the assertion.)

- [ ] **Step 2: Run to verify it fails** — FAIL.

- [ ] **Step 3: Add the manifest field**

In `book-types.ts` `interface BookManifest`, after the `draftModel` line:
```ts
  temperatures?: { creative?: number; surgical?: number }; // Per-book Creative/Surgical temperature buckets (defaults 0.8/0.3); applied by castStep above the casting sheet, below explicit per-step pins (additive-optional, no schema bump)
```

- [ ] **Step 4: Add the setter**

In `book.ts`, next to `setReviewCadence`:
```ts
  /** Set the book's Creative/Surgical temperature buckets. Empty/non-numeric clears the field. */
  async setTemperatures(slug: string, temps: { creative?: number; surgical?: number }): Promise<BookManifest> {
    return this.withBookLock(slug, async () => {
      const opened = await this.open(slug);
      if (!opened) throw new Error(`book not found: ${slug}`);
      const { manifest } = opened;
      await this.assertWritable(slug);
      const next: { creative?: number; surgical?: number } = {};
      if (typeof temps?.creative === 'number' && Number.isFinite(temps.creative)) next.creative = temps.creative;
      if (typeof temps?.surgical === 'number' && Number.isFinite(temps.surgical)) next.surgical = temps.surgical;
      if (next.creative !== undefined || next.surgical !== undefined) manifest.temperatures = next;
      else delete manifest.temperatures;
      manifest.history.push({ at: new Date().toISOString(), event: 'temperatures-set', detail: `creative=${next.creative ?? '-'} surgical=${next.surgical ?? '-'}` });
      await writeFileAtomic(join(this.booksDir, slug, 'book.json'), JSON.stringify(manifest, null, 2) + '\n');
      return manifest;
    });
  }
```

- [ ] **Step 5: Run to verify it passes** — PASS.
- [ ] **Step 6: Checkpoint** — book-temperatures test green.

---

### Task 5: `/api/books/:slug/models` GET returns + POST validates & persists `temperatures`

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts` (`GET /models` response; `POST /models` validation + persistence)
- Test: `tests/unit/book-temperatures.test.ts` (append a `setTemperatures` round-trip is enough; the HTTP layer is thin and covered by tsc + smoke)

**Interfaces:**
- Consumes: `setTemperatures` (Task 4).
- Produces: `GET` returns `temperatures: m.temperatures ?? null`; `POST` accepts `body.temperatures` (each value a number in `[0,2]` or absent) and persists via `setTemperatures`.

- [ ] **Step 1: Extend `GET /models`** — add to the `res.json({...})` (next to `alternateTakes`):
```ts
      temperatures: m.temperatures ?? null,
```

- [ ] **Step 2: Extend `POST /models`** — before the `try`, add validation:
```ts
    const temps = body.temperatures;
    const validTemp = (t: any) => t === undefined || (typeof t === 'number' && t >= 0 && t <= 2);
    if (temps !== undefined && (typeof temps !== 'object' || !validTemp(temps.creative) || !validTemp(temps.surgical))) {
      return res.status(400).json({ error: 'invalid temperatures { creative, surgical } (numbers in [0,2])' });
    }
```
Inside the `try`, after the `alternateTakes` block:
```ts
      if (temps !== undefined) {
        manifest = await services.books.setTemperatures(slug, { creative: temps.creative, surgical: temps.surgical });
      }
```
Extend the success `res.json({...})` with:
```ts
        temperatures: manifest.temperatures ?? null,
```

- [ ] **Step 3: Type-check** — `npx tsc --noEmit` → clean.
- [ ] **Step 4: Checkpoint** — tsc clean; `node --import tsx --test tests/unit/book-temperatures.test.ts` green.

---

### Task 6: Book-board UI — Creative / Surgical inputs

**Files:**
- Modify: `frontend/studio/src/components/book/BookModelsPanel.tsx`

**Interfaces:**
- Consumes: `/models` `temperatures` field (Task 5).
- Produces: two number inputs bound to `temperatures`, saved via the models POST.

- [ ] **Step 1** Extend `interface ModelConfig`:
```ts
  temperatures?: { creative?: number; surgical?: number } | null;
```
- [ ] **Step 2** Add a row (near the Alternate Takes row):
```tsx
      {/* Temperature: creative steps run warm (≥0.7), surgical steps cool (≤0.4).
          Overrides the genre defaults; a per-step pin in the write screen still wins. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '10px 0 4px' }}>
        <span style={{ minWidth: 130, fontSize: 13, color: 'var(--dim)' }}>Temperature <em style={{ color: 'var(--faint)', fontStyle: 'normal' }}>· creative ≥0.7 / surgical ≤0.4</em></span>
        <label style={{ fontSize: 13, color: 'var(--dim)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Creative
          <input type="number" min={0} max={2} step={0.05} style={{ width: 64 }}
            value={cfg.temperatures?.creative ?? 0.8}
            onChange={(e) => save({ temperatures: { creative: Number(e.target.value), surgical: cfg.temperatures?.surgical ?? 0.3 } })} />
        </label>
        <label style={{ fontSize: 13, color: 'var(--dim)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Surgical
          <input type="number" min={0} max={2} step={0.05} style={{ width: 64 }}
            value={cfg.temperatures?.surgical ?? 0.3}
            onChange={(e) => save({ temperatures: { creative: cfg.temperatures?.creative ?? 0.8, surgical: Number(e.target.value) } })} />
        </label>
      </div>
```
- [ ] **Step 3** `npm run build:frontend` → succeeds.
- [ ] **Step 4: Checkpoint** — frontend builds.

---

### Task 7: Full suite + docs

- [ ] **Step 1** `npm run test:unit` → PASS.
- [ ] **Step 2** `npm run test:api && npm run test:smoke` → PASS.
- [ ] **Step 3** Move the TODO item to COMPLETED (`2026-07-26 — Per-book Creative/Surgical temperature control`), preserving the bullet text.
- [ ] **Step 4: Checkpoint** — suite green, docs moved. (Commit + push per the session goal follow this plan.)

---

## Self-review notes

- **Spec coverage:** classifier + resolver (T1); castStep precedence (T2); stepRouting both paths + applyBookModelConfig sync (T3); manifest field + setter (T4); endpoint GET/POST + validation `[0,2]` (T5); book-board UI (T6); suite + docs (T7). Precedence, defaults, bucketing, and "no pipeline edits" all honored.
- **Type consistency:** `{ creative?: number; surgical?: number }` used identically across `temperature.ts`, `BookManifest`, `setTemperatures`, `applyBookModelConfig` sync, the endpoint, and the UI; `bucketTemperature?: number` defined in T2 and produced in T3; `resolveBucketTemperature` signature stable across T1/T3.
- **No placeholders:** every code step carries full code; commands have expected outcomes.
