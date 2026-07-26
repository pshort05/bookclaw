# Per-author scene-brief + draft models — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each author profile a preferred model for the scene-brief and first-draft steps, inherited into the book manifest at create, overridable per-book (book board) and per-step (write screen), so an author's underlying model stays consistent across their books.

**Architecture:** Add `sceneBriefModel` / `draftModel` (each `{ provider, model }`, model normally an `auto:newest-*` sentinel) to the author `meta.json`, carry them through `LibraryService`, inherit into the book manifest at `BookService.create`, and resolve them in `castStep` via a new author-role branch slotted below manual/write-screen pins and above the genre casting sheet. Strip the baked `modelOverride` from the `scene_brief`/`draft` steps of all prose pipelines so the new layer is reachable. Two UI pickers each in the author editor and the book board.

**Tech Stack:** Node 22 + TypeScript (via `tsx`), `node:test`, Express, React (Vite studio). Imports use `.js` extensions on `.ts` sources (NodeNext).

## Global Constraints

- **Node 22+**, TS loaded via `--import tsx`; never switch to `ts-node`.
- **Imports use `.js` extensions** even from `.ts` (NodeNext).
- **No git commits per task.** This repo uses the `commit_message` + `./push.sh` flow (the maintainer pushes). Each task's final step is a **Checkpoint** (relevant test file green), not `git commit`. A single `commit_message` is written in the last task.
- **Fast unit iteration:** run one file with `node --import tsx --test tests/unit/<file>.test.ts` (skips the heavy `build:frontend` that `npm run test:unit` prepends). Run the full `npm run test:unit` once at the end.
- **Role-model storage shape** everywhere: `{ provider: string; model?: string }` (provider required when the field is present; `model` optional, may be an `auto:newest-*` sentinel). Temperature is **not** stored — it is inherited from the genre casting sheet at routing time.
- **Surgical:** touch only the `scene_brief`/`draft` steps in pipelines; leave every other step's `modelOverride` intact. Existing books (snapshotted templates) are unaffected.
- **Fail-soft:** a malformed `meta.json` field is dropped, never throws (matches existing `readMetaSidecar`).

---

### Task 1: `castStep` author-role branch + temperature inheritance

**Files:**
- Modify: `gateway/src/services/casting/cast-step.ts`
- Test: `tests/unit/cast-step.test.ts` (append)

**Interfaces:**
- Consumes: `CastingSheet` (`gateway/src/services/casting/casting-sheet.ts` → `RoleModel = { provider: string; model?: string; temperature?: number }`), `StepRole` (`roles.ts`).
- Produces: `CastInputs.authorModels?: Partial<Record<StepRole, RoleModel>>`; `CastResult.source` union gains `'author'`. `castStep` applies `authorModels[role]` for the step's role, between the manual pin and prose-pick, inheriting the sheet's role temperature when the author model omits one.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/cast-step.test.ts`:

```ts
test('authorModels drives the draft role, inheriting sheet temperature', () => {
  const sheet = {
    genre: 'romance',
    roleModels: { draft: { provider: 'openrouter', model: 'anthropic/claude-opus-4.6', temperature: 1 } },
    proseRoles: ['scene_brief', 'draft'] as StepRole[],
  };
  const r = castStep({
    step: { role: 'draft' },
    sheet,
    authorModels: { draft: { provider: 'openrouter', model: 'auto:newest-opus' } },
  });
  assert.equal(r.source, 'author');
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.model, 'auto:newest-opus');
  assert.equal(r.temperature, 1); // inherited from the sheet's draft role
});

test('authorModels is role-scoped: draft entry does not affect scene_brief', () => {
  const r = castStep({
    step: { role: 'scene_brief' },
    sheet: { genre: 'romance', roleModels: { scene_brief: { provider: 'openrouter', model: 'sheet-brief' } }, proseRoles: ['scene_brief', 'draft'] as StepRole[] },
    authorModels: { draft: { provider: 'openrouter', model: 'auto:newest-opus' } },
  });
  assert.equal(r.source, 'sheet');
  assert.equal(r.model, 'sheet-brief');
});

test('a manual per-step pin still wins over authorModels', () => {
  const r = castStep({
    step: { role: 'draft', modelOverride: { provider: 'openrouter', model: 'manual-pin' } },
    sheet: null,
    authorModels: { draft: { provider: 'openrouter', model: 'auto:newest-opus' } },
  });
  assert.equal(r.source, 'manual');
  assert.equal(r.model, 'manual-pin');
});

test('authorModels beats prose-pick (book preferred model) for the draft role', () => {
  const r = castStep({
    step: { role: 'draft' },
    sheet: { genre: 'romance', roleModels: {}, proseRoles: ['scene_brief', 'draft'] as StepRole[] },
    proseModel: { provider: 'openrouter', model: 'book-default' },
    authorModels: { draft: { provider: 'openrouter', model: 'auto:newest-opus' } },
  });
  assert.equal(r.source, 'author');
  assert.equal(r.model, 'auto:newest-opus');
});
```

Ensure `StepRole` is imported at the top of the test file (add `import type { StepRole } from '../../gateway/src/services/casting/roles.js';` if not already present — match the existing import style in the file).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test tests/unit/cast-step.test.ts`
Expected: FAIL — `authorModels` is not a known property / `source` never equals `'author'`.

- [ ] **Step 3: Implement the branch**

In `gateway/src/services/casting/cast-step.ts`:

Extend `CastInputs`:
```ts
export interface CastInputs {
  step: { role?: StepRole; modelOverride?: { provider?: string; model?: string; temperature?: number } };
  sheet: CastingSheet | null;
  proseModel?: { provider: string; model?: string };
  authorModels?: Partial<Record<StepRole, RoleModel>>;
  spiceRoute?: { provider: string; model?: string } | null;
}
```
Import `RoleModel` from the casting-sheet module (add to the existing `import type { CastingSheet } ...` line):
```ts
import type { CastingSheet, RoleModel } from './casting-sheet.js';
```
Extend the `source` union:
```ts
source: 'spice' | 'manual' | 'author' | 'prose-pick' | 'sheet' | 'tier-fallback';
```
Destructure `authorModels` and insert the new branch **after** the manual branch (step 2) and **before** the prose-pick branch (step 3):
```ts
  const { step, sheet, proseModel, authorModels, spiceRoute } = inputs;
```
```ts
    // 3. Author/book per-role model (manifest sceneBriefModel/draftModel), applied
    //    to its exact role. A role-specific pin beats the blunt prose-pick default;
    //    a manual per-step pin (branch 2) still wins. Temperature is inherited from
    //    the genre sheet's role default so stripping the pipelines' baked temp pins
    //    doesn't silently drop to the provider's 0.7 default.
    const am = role ? authorModels?.[role] : undefined;
    if (am) {
      const temp = am.temperature ?? (role ? sheet?.roleModels?.[role]?.temperature : undefined);
      return clean(am.provider, am.model, temp, 'author');
    }
```
(Renumber the subsequent comment numbers 3→4, 4→5, 5→6 if you like; not required.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --import tsx --test tests/unit/cast-step.test.ts`
Expected: PASS (all, including the pre-existing cases).

- [ ] **Step 5: Checkpoint** — `tests/unit/cast-step.test.ts` green.

---

### Task 2: `stepRouting` builds `authorModels`; `applyBookModelConfig` syncs the manifest fields

**Files:**
- Modify: `gateway/src/api/routes/_shared.ts` (`applyBookModelConfig` ~L200-208, `stepRouting` ~L210-250)
- Test: `tests/unit/author-role-models-routing.test.ts` (create)

**Interfaces:**
- Consumes: `castStep` (`authorModels` from Task 1); a `project` object carrying `sceneBriefModel?` / `draftModel?`.
- Produces: `applyBookModelConfig` copies `manifest.sceneBriefModel` / `manifest.draftModel` onto the project (assign-not-merge); `stepRouting` passes `{ scene_brief, draft }` into `castStep({ authorModels })` for tagged steps.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/author-role-models-routing.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRouting, applyBookModelConfig } from '../../gateway/src/api/routes/_shared.js';

test('applyBookModelConfig syncs sceneBriefModel/draftModel onto the project', () => {
  const project: any = {};
  applyBookModelConfig(project, {
    sceneBriefModel: { provider: 'openrouter', model: 'auto:newest-sonnet' },
    draftModel: { provider: 'openrouter', model: 'auto:newest-opus' },
  });
  assert.deepEqual(project.sceneBriefModel, { provider: 'openrouter', model: 'auto:newest-sonnet' });
  assert.deepEqual(project.draftModel, { provider: 'openrouter', model: 'auto:newest-opus' });
});

test('stepRouting applies the author draft model to a draft-role step', () => {
  const project: any = { genre: 'romance', draftModel: { provider: 'openrouter', model: 'auto:newest-opus' } };
  const r = stepRouting(project, { role: 'draft', taskType: 'creative_writing' });
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.model, 'auto:newest-opus');
});

test('stepRouting applies the author scene-brief model to a scene_brief step', () => {
  const project: any = { genre: 'romance', sceneBriefModel: { provider: 'openrouter', model: 'auto:newest-sonnet' } };
  const r = stepRouting(project, { role: 'scene_brief', taskType: 'outline' });
  assert.equal(r.model, 'auto:newest-sonnet');
});

test('a per-step modelOverride still beats the author draft model', () => {
  const project: any = { genre: 'romance', draftModel: { provider: 'openrouter', model: 'auto:newest-opus' } };
  const r = stepRouting(project, { role: 'draft', taskType: 'creative_writing', modelOverride: { provider: 'openrouter', model: 'manual-pin' } });
  assert.equal(r.model, 'manual-pin');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/author-role-models-routing.test.ts`
Expected: FAIL — `project.sceneBriefModel` undefined after sync; draft-role step falls through to sheet/tier.

- [ ] **Step 3: Implement the wiring**

In `gateway/src/api/routes/_shared.ts`, extend `applyBookModelConfig` (keep the existing assignments):
```ts
export function applyBookModelConfig(project: any, manifest: any): void {
  if (!project || !manifest) return;
  project.preferredProvider = manifest.preferredProvider;
  project.preferredModel = manifest.preferredModel;
  project.stageModels = manifest.stageModels;
  project.sceneBriefModel = manifest.sceneBriefModel;
  project.draftModel = manifest.draftModel;
}
```
In `stepRouting`, in the tagged-step branch (where `sheet`/`proseModel` are computed), build `authorModels` and pass it:
```ts
  const authorModels: Partial<Record<StepRole, RoleModel>> = {};
  if (project?.sceneBriefModel?.provider) authorModels.scene_brief = project.sceneBriefModel;
  if (project?.draftModel?.provider) authorModels.draft = project.draftModel;
  const r = castStep({ step: { role, modelOverride: effectiveOverride }, sheet, proseModel, authorModels, spiceRoute: spiceRoute ?? null });
```
Add the imports at the top of `_shared.ts` (extend existing casting imports):
```ts
import type { StepRole } from '../../services/casting/roles.js';
import type { RoleModel } from '../../services/casting/casting-sheet.js';
```
(If `StepRole`/`isStepRole` is already imported, only add `RoleModel`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/author-role-models-routing.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression check**

Run: `node --import tsx --test tests/unit/casting-steprouting-compat.test.ts tests/unit/step-routing-temperature.test.ts tests/unit/steprouting-spice.test.ts`
Expected: PASS (author layer is opt-in; untagged/no-field paths unchanged).

- [ ] **Step 6: Checkpoint** — the new routing test + the three regression files green.

---

### Task 3: `BookManifest` fields + `BookService.create` inheritance from the author

**Files:**
- Modify: `gateway/src/services/book-types.ts` (`BookManifest` ~L39-59)
- Modify: `gateway/src/services/book.ts` (`CreateBookInput` ~L52-59; `create()` ~L382-425)
- Modify: `gateway/src/services/library.ts` (`LibraryEntryFull` ~L39-51 — add the fields consumed by `create()`; full parse in Task 5)
- Test: `tests/unit/book-author-role-models.test.ts` (create)

**Interfaces:**
- Consumes: the bound `author` entry (a `LibraryEntryFull`) inside `create()`, which must expose `sceneBriefModel?` / `draftModel?`.
- Produces: `BookManifest.sceneBriefModel?` / `draftModel?` (`{ provider: string; model?: string }`); `create()` sets them from the author when present; an explicit `sel.sceneBriefModel`/`sel.draftModel` (create-input) wins.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/book-author-role-models.test.ts`, mirroring the setup in `tests/unit/book-content-ceiling.test.ts` (same temp-dir + `BookService` + fake library/skills harness — copy that file's `beforeEach`/helpers verbatim, then add an author `meta.json` with role models). The essential assertion:
```ts
// After creating a book bound to an author whose meta.json carries:
//   { "sceneBriefModel": { "provider": "openrouter", "model": "auto:newest-sonnet" },
//     "draftModel": { "provider": "openrouter", "model": "auto:newest-opus" } }
const manifest = await books.create({ /* title, author, voice, genre, pipeline, sections … as in book-content-ceiling.test.ts */ });
assert.deepEqual(manifest.sceneBriefModel, { provider: 'openrouter', model: 'auto:newest-sonnet' });
assert.deepEqual(manifest.draftModel, { provider: 'openrouter', model: 'auto:newest-opus' });

// And an explicit create-input override wins:
const m2 = await books.create({ /* …same, different slug… */ draftModel: { provider: 'openrouter', model: 'explicit' } });
assert.equal(m2.draftModel.model, 'explicit');

// And an author with no role models → manifest omits the fields:
const m3 = await books.create({ /* author with description-only meta.json */ });
assert.equal(m3.sceneBriefModel, undefined);
assert.equal(m3.draftModel, undefined);
```
Read `tests/unit/book-content-ceiling.test.ts` first and reuse its harness exactly (author-dir creation, `LibraryService.loadAll`, `BookService` construction). Write the author `meta.json` in the workspace/builtin author dir the harness uses.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/book-author-role-models.test.ts`
Expected: FAIL — `manifest.sceneBriefModel` undefined (fields not read/written yet).

- [ ] **Step 3: Add the manifest + create-input fields**

In `gateway/src/services/book-types.ts`, in `interface BookManifest`, after the `contentCeiling` line (~L29):
```ts
  sceneBriefModel?: { provider: string; model?: string }; // Author-seeded default model for the scene_brief role; book-board editable; resolved by castStep above the genre sheet (additive-optional, no schema bump)
  draftModel?: { provider: string; model?: string };      // Author-seeded default model for the draft role; book-board editable; resolved by castStep above the genre sheet (additive-optional, no schema bump)
```

In `gateway/src/services/book.ts`, in the create-input interface (the one holding `preferredProvider`/`preferredModel`/`reviewCadence`, ~L52-59), add the same two optional fields:
```ts
  sceneBriefModel?: { provider: string; model?: string }; // explicit per-book scene-brief model; overrides the bound author's sceneBriefModel at create
  draftModel?: { provider: string; model?: string };      // explicit per-book draft model; overrides the bound author's draftModel at create
```

- [ ] **Step 4: Add the `LibraryEntryFull` fields (consumed here; parsed in Task 5)**

In `gateway/src/services/library.ts`, in `interface LibraryEntryFull`, after the `reviewCadence` line (~L42):
```ts
  sceneBriefModel?: { provider: string; model?: string }; // author: sidecar meta.json — inherited by a new book's sceneBriefModel
  draftModel?: { provider: string; model?: string };      // author: sidecar meta.json — inherited by a new book's draftModel
```

- [ ] **Step 5: Inherit in `create()`**

In `gateway/src/services/book.ts`, near the `contentCeiling` / `reviewCadence` inheritance (~L386-393), add:
```ts
      // Author-identity role models (this plan): an explicit per-book value wins;
      // otherwise inherit the bound author's sceneBriefModel/draftModel. Absent
      // either way → field omitted → castStep falls to the genre casting sheet.
      const sceneBriefModel = sel.sceneBriefModel ?? author.sceneBriefModel;
      const draftModel = sel.draftModel ?? author.draftModel;
```
In the `manifest` object literal (~L414-423, alongside `...(contentCeiling ? …)`), add:
```ts
        ...(sceneBriefModel ? { sceneBriefModel } : {}),
        ...(draftModel ? { draftModel } : {}),
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/book-author-role-models.test.ts`
Expected: PASS.

- [ ] **Step 7: Regression** — `node --import tsx --test tests/unit/book-content-ceiling.test.ts tests/unit/book-review-cadence.test.ts tests/unit/book.test.ts`
Expected: PASS.

- [ ] **Step 8: Checkpoint** — new test + book regressions green.

---

### Task 4: `setModelConfig` persists role models (book-board write path)

**Files:**
- Modify: `gateway/src/services/book.ts` (`setModelConfig`)
- Test: `tests/unit/book-author-role-models.test.ts` (append)

**Interfaces:**
- Consumes: an existing book (via `open`/`withBookLock`).
- Produces: `setModelConfig(slug, cfg)` where `cfg` gains `sceneBriefModel?` / `draftModel?: { provider?: string; model?: string }`; a truthy provider sets the manifest field, a falsy/empty provider **clears** it.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/book-author-role-models.test.ts` (reuse the harness; create a book first):
```ts
test('setModelConfig sets and clears role models', async () => {
  // … create a book bound to a plain author, get its slug …
  let m = await books.setModelConfig(slug, { draftModel: { provider: 'openrouter', model: 'auto:newest-opus' } });
  assert.deepEqual(m.draftModel, { provider: 'openrouter', model: 'auto:newest-opus' });
  // clearing with an empty provider removes the field
  m = await books.setModelConfig(slug, { draftModel: { provider: '' } });
  assert.equal(m.draftModel, undefined);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/unit/book-author-role-models.test.ts`
Expected: FAIL — `setModelConfig` ignores `draftModel`.

- [ ] **Step 3: Implement**

In `gateway/src/services/book.ts`, widen the `cfg` param type and add handling (mirror the `default` block's trim/clear semantics):
```ts
  async setModelConfig(
    slug: string,
    cfg: {
      default?: { provider?: string; model?: string };
      stageModels?: Record<string, { provider?: string; model?: string }>;
      sceneBriefModel?: { provider?: string; model?: string };
      draftModel?: { provider?: string; model?: string };
    },
  ): Promise<BookManifest> {
```
Inside the lock, after the `stageModels` block and before the `history.push`, add:
```ts
      for (const key of ['sceneBriefModel', 'draftModel'] as const) {
        const sel = cfg[key];
        if (sel === undefined) continue; // not sent → leave as-is
        const provider = sel.provider?.trim();
        if (provider) manifest[key] = sel.model?.trim() ? { provider, model: sel.model.trim() } : { provider };
        else delete manifest[key]; // empty provider clears
      }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/unit/book-author-role-models.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — file green.

---

### Task 5: `LibraryService` — parse role models from author `meta.json`, persist them non-destructively, surface in reads

**Files:**
- Modify: `gateway/src/services/library.ts` (`LibraryWriteBody` ~L81-85; `readMetaSidecar` ~L263-277; list-build ~L350-362; `writeEntry` meta write ~L235-239)
- Test: `tests/unit/library-author-role-models.test.ts` (create)

**Interfaces:**
- Consumes: author `meta.json` on disk.
- Produces: `LibraryWriteBody` gains `sceneBriefModel?` / `draftModel?`; `readMetaSidecar` returns them (validated: object with string `provider`; `model` optional string; else dropped); the resolved `LibraryEntryFull` carries them; `writeEntry` **merges** them into `meta.json` (preserving `description` and any other existing keys) instead of overwriting the file.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/library-author-role-models.test.ts` (mirror `tests/unit/library-description.test.ts` harness — temp builtin+workspace dirs, `LibraryService`, `loadAll`):
```ts
test('author meta.json role models are parsed into the entry', async () => {
  // write authors/<name>/meta.json with sceneBriefModel + draftModel + description
  await lib.loadAll();
  const e = lib.get('author', name);
  assert.deepEqual(e.sceneBriefModel, { provider: 'openrouter', model: 'auto:newest-sonnet' });
  assert.deepEqual(e.draftModel, { provider: 'openrouter', model: 'auto:newest-opus' });
  assert.equal(e.description, 'A test author'); // still parsed
});

test('writeEntry merges role models into meta.json without dropping description', async () => {
  // start from an author with description "orig" and at least one .md file
  await lib.writeEntry('author', name, { draftModel: { provider: 'openrouter', model: 'auto:newest-opus' } });
  await lib.loadAll();
  const e = lib.get('author', name);
  assert.deepEqual(e.draftModel, { provider: 'openrouter', model: 'auto:newest-opus' });
  assert.equal(e.description, 'orig'); // preserved (non-destructive merge)
});

test('a malformed role model is dropped fail-soft', async () => {
  // meta.json draftModel = { model: 'x' } (no provider) → dropped, no throw
  await lib.loadAll();
  assert.equal(lib.get('author', name).draftModel, undefined);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/unit/library-author-role-models.test.ts`
Expected: FAIL — entry lacks the fields; `writeEntry` doesn't accept them.

- [ ] **Step 3: Add a validated parser + extend `readMetaSidecar`**

In `gateway/src/services/library.ts`, add a module-level helper near `readMetaSidecar`:
```ts
/** Parse a stored role-model pin from meta.json; drop anything malformed. */
function parseRoleModel(v: unknown): { provider: string; model?: string } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as any;
  if (typeof o.provider !== 'string' || !o.provider) return undefined;
  return typeof o.model === 'string' && o.model ? { provider: o.provider, model: o.model } : { provider: o.provider };
}
```
Widen `readMetaSidecar`'s return type and body:
```ts
  private readMetaSidecar(file: string): { description?: string; groups?: string[]; contentBrand?: { spiceCeiling: number; violenceCeiling: number }; reviewCadence?: Cadence; sceneBriefModel?: { provider: string; model?: string }; draftModel?: { provider: string; model?: string } } {
```
Inside the `try`, before `return`:
```ts
      const sceneBriefModel = parseRoleModel(meta?.sceneBriefModel);
      const draftModel = parseRoleModel(meta?.draftModel);
```
and extend the returned object:
```ts
      return { description, groups, contentBrand, reviewCadence, sceneBriefModel, draftModel };
```

- [ ] **Step 4: Carry the fields into the resolved entry (list-build)**

In the author/voice/genre branch (~L350-362), after `reviewCadence`:
```ts
          const sceneBriefModel = meta.sceneBriefModel ?? prev?.sceneBriefModel;
          const draftModel = meta.draftModel ?? prev?.draftModel;
```
and in the `out.set(...)` spread:
```ts
            ...(sceneBriefModel !== undefined ? { sceneBriefModel } : {}),
            ...(draftModel !== undefined ? { draftModel } : {}),
```

- [ ] **Step 5: Accept the fields on write + make the meta write non-destructive**

In `interface LibraryWriteBody` (~L81-85):
```ts
  sceneBriefModel?: { provider: string; model?: string }; // author: meta.json role model
  draftModel?: { provider: string; model?: string };      // author: meta.json role model
```
Replace the author/voice/genre meta write (~L235-239) so it **merges** with the on-disk meta and fires when *either* a description or a role model is provided:
```ts
    // Persist meta.json (author/voice/genre) by MERGING onto any existing file, so
    // writing one field never clobbers siblings (description / contentBrand /
    // reviewCadence / the other role model). Provider '' clears a role model.
    const wantsMeta = typeof body.description === 'string'
      || body.sceneBriefModel !== undefined || body.draftModel !== undefined;
    if (wantsMeta) {
      await mkdir(target, { recursive: true });
      const metaPath = join(target, 'meta.json');
      let meta: Record<string, unknown> = {};
      try { if (existsSync(metaPath)) meta = JSON.parse(readFileSync(metaPath, 'utf-8')); } catch { meta = {}; }
      if (typeof body.description === 'string') meta.description = body.description;
      for (const key of ['sceneBriefModel', 'draftModel'] as const) {
        const sel = body[key];
        if (sel === undefined) continue;
        if (sel.provider) meta[key] = sel.model ? { provider: sel.provider, model: sel.model } : { provider: sel.provider };
        else delete meta[key];
      }
      await writeFile(metaPath, JSON.stringify(meta), 'utf-8');
    }
```
Note: the block guarding "description-only write requires existing files" (~L204-234) stays; a role-model-only write follows the same rule (needs the entry to already have `.md` files). If `body.files` is absent and only a role model is sent, reuse the existing `this.get(kind, name)?.files` materialization path — extend its condition from `typeof body.description === 'string'` to also include `body.sceneBriefModel !== undefined || body.draftModel !== undefined` so the overlay still snapshots the resolved `.md` files. Show that edit explicitly:
```ts
    } else if (typeof body.description === 'string' || body.sceneBriefModel !== undefined || body.draftModel !== undefined) {
      const currentFiles = this.get(kind, name)?.files ?? {};
      if (Object.keys(currentFiles).length === 0) {
        throw new Error(`invalid: ${kind} requires at least one .md file`);
      }
      await mkdir(target, { recursive: true });
      for (const [fname, content] of Object.entries(currentFiles)) {
        await writeFile(join(target, fname), content, 'utf-8');
      }
    }
```
Also relax the "no files provided requires a description" guard (~L204-207) to accept a role model:
```ts
    } else if (!files || Object.keys(files).length === 0) {
      if (typeof body.description !== 'string' && body.sceneBriefModel === undefined && body.draftModel === undefined) {
        throw new Error(`${kind} requires at least one .md file`);
      }
    }
```

- [ ] **Step 6: Run to verify it passes**

Run: `node --import tsx --test tests/unit/library-author-role-models.test.ts`
Expected: PASS.

- [ ] **Step 7: Regression** — `node --import tsx --test tests/unit/library-description.test.ts tests/unit/library-write.test.ts tests/unit/library.test.ts`
Expected: PASS (non-destructive merge must not break description-only writes).

- [ ] **Step 8: Checkpoint** — new + library regressions green.

---

### Task 6: API — `/api/books/:slug/models` GET/POST role models + library route passthrough

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts` (`GET /models` ~L291-303; `POST /models` ~L346-386)
- Modify: `gateway/src/api/routes/library.routes.ts` (`GET /:kind/:name` ~L40-51; `PUT /:kind/:name` ~L162-170)
- Test: `tests/unit/book-author-role-models.test.ts` (append a `setModelConfig`-passthrough assertion; the HTTP layer is thin and validated by build + smoke)

**Interfaces:**
- Consumes: `setModelConfig` (Task 4), `LibraryService.writeEntry`/`get` (Task 5).
- Produces: `GET /models` returns `sceneBriefModel` / `draftModel`; `POST /models` validates + forwards them to `setModelConfig` and re-applies to the live project; library `GET` returns the two fields; library `PUT` forwards them to `writeEntry`.

- [ ] **Step 1: Extend `GET /models` response**

In `books.routes.ts` (~L297-302):
```ts
    res.json({
      default: { provider: m.preferredProvider ?? '', model: m.preferredModel ?? '' },
      stageModels: m.stageModels ?? {},
      sceneBriefModel: m.sceneBriefModel ?? null,
      draftModel: m.draftModel ?? null,
      reviewCadence: m.review?.cadence ?? '',
    });
```

- [ ] **Step 2: Extend `POST /models` validation + persistence**

In `books.routes.ts` POST handler, after the `stageModels` validation loop, reuse the existing `validSel` helper:
```ts
    if (!validSel(body.sceneBriefModel)) return res.status(400).json({ error: 'invalid sceneBriefModel { provider, model }' });
    if (!validSel(body.draftModel)) return res.status(400).json({ error: 'invalid draftModel { provider, model }' });
```
Widen the "did model fields change?" guard and the `setModelConfig` call:
```ts
      if (body.default !== undefined || stageModels !== undefined || body.sceneBriefModel !== undefined || body.draftModel !== undefined) {
        manifest = await services.books.setModelConfig(slug, { default: body.default, stageModels, sceneBriefModel: body.sceneBriefModel, draftModel: body.draftModel });
      }
```
Extend the success response:
```ts
      res.json({ success: true, default: { provider: manifest.preferredProvider ?? '', model: manifest.preferredModel ?? '' }, stageModels: manifest.stageModels ?? {}, sceneBriefModel: manifest.sceneBriefModel ?? null, draftModel: manifest.draftModel ?? null, reviewCadence: manifest.review?.cadence ?? '' });
```
(`applyBookModelConfig(project, manifest)` at ~L381 already re-applies to the live project — it now also syncs the role models via Task 2.)

- [ ] **Step 3: Library route passthrough**

In `library.routes.ts` `PUT /:kind/:name` (~L166), extend the write body:
```ts
      await services.library.writeEntry(kind, String(req.params.name), { files: req.body?.files, content: req.body?.content, description: req.body?.description, sceneBriefModel: req.body?.sceneBriefModel, draftModel: req.body?.draftModel });
```
Confirm `GET /:kind/:name` (~L40-51) returns the full entry object (it already returns `services.library.get(...)`, which now includes the fields — no change needed unless it cherry-picks fields; if it does, add `sceneBriefModel`/`draftModel`).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Checkpoint** — `tsc` clean; `node --import tsx --test tests/unit/book-author-role-models.test.ts` green.

---

### Task 7: Strip baked `modelOverride` from `scene_brief`/`draft` steps in all prose pipelines + guard test

**Files:**
- Modify (12 JSON): `library/pipelines/{romance-spicy-deterministic,romance-sweet-deterministic,romance-spicy-full,romance-sweet-full,romance-sweet-full-legacy,romance-spicy,romance-sweet,msf-phase4-prose,nerdynovelistai-stage5-chapters,romantasy-production,technothriller-production,scene-drafter}.json`
- Test: `tests/unit/pipeline-no-prose-pin.test.ts` (create)

**Interfaces:**
- Produces: no `scene_brief`/`draft` step in the listed pipelines carries a `modelOverride`; all other steps' overrides are untouched.

- [ ] **Step 1: Write the guard test (fails first)**

Create `tests/unit/pipeline-no-prose-pin.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = [
  'romance-spicy-deterministic', 'romance-sweet-deterministic', 'romance-spicy-full',
  'romance-sweet-full', 'romance-sweet-full-legacy', 'romance-spicy', 'romance-sweet',
  'msf-phase4-prose', 'nerdynovelistai-stage5-chapters', 'romantasy-production',
  'technothriller-production', 'scene-drafter',
];

function walkSteps(node: any, out: any[] = []): any[] {
  if (Array.isArray(node)) { for (const n of node) walkSteps(n, out); return out; }
  if (node && typeof node === 'object') {
    if (typeof node.role === 'string' && ('promptTemplate' in node || 'skill' in node || 'label' in node)) out.push(node);
    for (const v of Object.values(node)) walkSteps(v, out);
  }
  return out;
}

test('no prose pipeline pins a model on scene_brief/draft steps', () => {
  for (const name of FILES) {
    const json = JSON.parse(readFileSync(join(ROOT, 'library', 'pipelines', `${name}.json`), 'utf-8'));
    for (const step of walkSteps(json)) {
      if (step.role === 'scene_brief' || step.role === 'draft') {
        assert.equal(step.modelOverride, undefined, `${name}: ${step.role} step still has a modelOverride`);
      }
    }
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/unit/pipeline-no-prose-pin.test.ts`
Expected: FAIL — the deterministic/full pipelines still pin Opus on brief+draft.

- [ ] **Step 3: Remove the `modelOverride` blocks**

For each of the 12 files, delete the `"modelOverride": { … }` object **only** on the steps whose `"role"` is `"scene_brief"` or `"draft"`. In `romance-spicy-deterministic.json` the brief step is `library/pipelines/romance-spicy-deterministic.json:82-86` and the draft step's block follows its `"role": "draft"` — remove both, and the trailing comma on the preceding property so the JSON stays valid. Do the same per file; leave audit/humanize/consistency steps' overrides intact.

Verify each edited file parses: `node -e "JSON.parse(require('fs').readFileSync('library/pipelines/<name>.json','utf8')); console.log('ok')"` for each.

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/unit/pipeline-no-prose-pin.test.ts`
Expected: PASS.

- [ ] **Step 5: Regression** — the pipeline parsers/loaders still accept every file:

Run: `node --import tsx --test tests/unit/romance-pipelines.test.ts tests/unit/romance-full-pipeline.test.ts tests/unit/romantasy-pipeline.test.ts tests/unit/technothriller-pipeline.test.ts tests/unit/pipeline-from-json.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint** — guard + pipeline regressions green.

---

### Task 8: Author-editor UI — two model pickers (`ProseEditor`)

**Files:**
- Modify: `frontend/studio/src/components/asset/ProseEditor.tsx`
- Modify: `frontend/studio/src/lib/assetApi.ts` (extend `readEntry` result + `writeEntry` body types with `sceneBriefModel?`/`draftModel?`)

**Interfaces:**
- Consumes: `ModelPicker` (`../asset/ModelPicker.js`, `ModelValue = { provider?, model?, temperature? }`), `readEntry`/`writeEntry` (Task 5/6 fields).
- Produces: for `kind === 'author'`, two `ModelPicker`s bound to `sceneBriefModel`/`draftModel`, saved to `meta.json` via `writeEntry`.

- [ ] **Step 1: Extend the asset API types**

In `frontend/studio/src/lib/assetApi.ts`, add `sceneBriefModel?: { provider?: string; model?: string }` and `draftModel?: …` to the `readEntry` return type and the `writeEntry` body type (match the file's existing type declarations).

- [ ] **Step 2: Add state + load in `ProseEditor`**

Add two state vars and load them from the entry:
```ts
  const [sceneBriefModel, setSceneBriefModel] = useState<{ provider?: string; model?: string }>({});
  const [draftModel, setDraftModel] = useState<{ provider?: string; model?: string }>({});
```
In the `readEntry(...).then((entry) => { … })` body:
```ts
        setSceneBriefModel(entry.sceneBriefModel ?? {});
        setDraftModel(entry.draftModel ?? {});
```

- [ ] **Step 3: Render the pickers (author only) + include in save**

Above the file editor block, when `kind === 'author'`:
```tsx
      {kind === 'author' && (
        <div className={styles.meta} style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          <label>
            <div className={styles.fl}>Scene-brief model <em>· author default (book/step can override)</em></div>
            <ModelPicker value={sceneBriefModel} onChange={(v) => { setSceneBriefModel({ provider: v.provider, model: v.model }); setDirty(true); setSaveMsg(null); }} hideTemperature />
          </label>
          <label>
            <div className={styles.fl}>First-draft model <em>· author default (book/step can override)</em></div>
            <ModelPicker value={draftModel} onChange={(v) => { setDraftModel({ provider: v.provider, model: v.model }); setDirty(true); setSaveMsg(null); }} hideTemperature />
          </label>
        </div>
      )}
```
Add the import: `import { ModelPicker } from './ModelPicker.js';`.
In `handleSave`, include the fields in the `writeEntry` body when `kind === 'author'`:
```ts
      await writeEntry(scope, kind, name, {
        files,
        description,
        ...(kind === 'author' ? { sceneBriefModel, draftModel } : {}),
      });
```
(Match the existing `writeEntry` call's argument shape; if it currently sends only `{ files }` or `{ files, description }`, add the two fields conditionally as shown. Sending `{ provider: undefined, model: undefined }` clears the field server-side — verify `ModelPicker` emits `provider: undefined` for the "auto (by task)" option; it does per its `emit()` normalization.)

- [ ] **Step 4: Build the studio to verify it compiles**

Run: `npm run build:frontend`
Expected: build succeeds (studio + chat dists emitted).

- [ ] **Step 5: Checkpoint** — frontend builds; manual note: pickers appear on the author asset only.

---

### Task 9: Book-board UI — replace "Chapter drafting" with role pickers (`BookModelsPanel`)

**Files:**
- Modify: `frontend/studio/src/components/book/BookModelsPanel.tsx`

**Interfaces:**
- Consumes: `/api/books/:slug/models` (Task 6 fields), `ModelPicker`.
- Produces: two role pickers ("Scene brief", "First draft") bound to `sceneBriefModel`/`draftModel`; the `creative_writing` stage row removed; on save of the draft role also clears `stageModels.creative_writing`.

- [ ] **Step 1: Extend the config type + drop the creative_writing stage**

In `BookModelsPanel.tsx`, extend `interface ModelConfig`:
```ts
  sceneBriefModel?: { provider?: string; model?: string } | null;
  draftModel?: { provider?: string; model?: string } | null;
```
Remove `{ key: 'creative_writing', label: 'Chapter drafting' }` from `STAGES` (the draft model is now the "First draft" role picker).

- [ ] **Step 2: Render the two role pickers**

Where the stage pickers render, add (using the same `pickerRow(...)` helper the file already uses for `default`/stages — match its signature):
```tsx
      {pickerRow(
        { provider: cfg.sceneBriefModel?.provider, model: cfg.sceneBriefModel?.model },
        (v) => save({ sceneBriefModel: { provider: v.provider ?? '', model: v.model ?? '' } }),
        'Scene brief',
      )}
      {pickerRow(
        { provider: cfg.draftModel?.provider, model: cfg.draftModel?.model },
        (v) => save({ draftModel: { provider: v.provider ?? '', model: v.model ?? '' }, stageModels: { creative_writing: { provider: '', model: '' } } }),
        'First draft',
      )}
```
(The `save(...)` merges its argument into a POST to `/api/books/:slug/models`. Clearing `stageModels.creative_writing` on a draft-model save prevents a legacy per-stage pin from shadowing the new picker — the server treats empty-provider stage entries as "clear".)

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build:frontend`
Expected: build succeeds.

- [ ] **Step 4: Checkpoint** — frontend builds.

---

### Task 10: Full suite, docs, and commit message

**Files:**
- Modify: `docs/TODO.md` (remove the per-author-model item), `docs/COMPLETED.md` (add it, dated)
- Create: `commit_message`

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS (this also runs `build:frontend`, covering Tasks 8-9 compile).

- [ ] **Step 2: Run the API + smoke tests**

Run: `npm run test:api && npm run test:smoke`
Expected: PASS.

- [ ] **Step 3: Move the TODO item to COMPLETED**

Remove the "Per-author scene-brief + draft models" bullet from `docs/TODO.md` (Larger items) and add it to `docs/COMPLETED.md` with a `2026-07-26` prefix, preserving the bullet text and linking the spec/plan.

- [ ] **Step 4: Write `commit_message`**

```
feat(author,routing): per-author scene-brief + draft models

- Author meta.json gains sceneBriefModel/draftModel (auto:newest-* sentinels), inherited into the book manifest at create
- castStep resolves them for the scene_brief/draft roles above the genre casting sheet, below manual/write-screen pins; temperature inherits from the sheet
- Strip baked modelOverride from scene_brief/draft steps in all 12 prose pipelines so the author/book layer is reachable
- Book board: role pickers replace the Chapter-drafting stage row; author editor gains two model pickers
- /api/books/:slug/models GET/POST + library PUT carry the fields; LibraryService meta write is now a non-destructive merge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KpsGKDcv9VBDNMCfUW4W5T
```

- [ ] **Step 5: Checkpoint** — full suite green; `commit_message` present; TODO/COMPLETED updated. (Deployment to Mercury/Neptune is handled after this plan per the session goal.)

---

## Self-review notes

- **Spec coverage:** author fields (Task 5), manifest inheritance (Task 3), routing branch + temp inheritance (Task 1), stepRouting/applyBookModelConfig wiring (Task 2), book-board editability via setModelConfig + endpoint (Tasks 4/6/9), author-editor UI (Task 8), pipeline conversion + guard (Task 7), precedence (Tasks 1-2 tests), out-of-scope items untouched. All spec sections map to a task.
- **Precedence realized:** spice → manual (`modelOverride`, incl. book `stageModels` merge in `stepRouting`) → `authorModels[role]` → prose-pick (`preferredModel`) → sheet → tier. Verified by Task 1 + Task 2 tests.
- **Type consistency:** storage shape `{ provider: string; model?: string }` used in `BookManifest`, `LibraryEntryFull`, `LibraryWriteBody`, create-input, and API; `CastInputs.authorModels` uses `Partial<Record<StepRole, RoleModel>>` (RoleModel adds optional temperature, unused in storage, consumed only for inheritance). `source: 'author'` added once in Task 1 and asserted in Tasks 1-2.
