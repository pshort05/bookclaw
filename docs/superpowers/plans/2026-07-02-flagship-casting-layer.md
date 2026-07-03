# Flagship Casting Layer Implementation Plan (Plan 1 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a declarative casting layer — semantic step `role`s, per-genre casting sheets, and a `castStep` resolver — so each pipeline step's model is chosen by a single, tested precedence instead of scattered hard-pins.

**Architecture:** A pure resolver (`castStep`) computes `{provider, model, temperature}` for a step from four inputs: the step's role + manual pin, the genre casting sheet, the author's prose-model pick, and (in Plan 2) a spice re-route. A per-genre casting sheet JSON holds the `role → model` defaults. The existing `stepRouting` becomes a thin backward-compatible wrapper over `castStep`. This plan delivers levels 2–5 of the precedence and leaves an explicit `spiceRoute` seam that Plan 2 fills.

**Tech Stack:** Node 22+, TypeScript (NodeNext, `.js` import extensions), `node --import tsx --test` for unit tests.

## Global Constraints

- Imports use `.js` extensions even in `.ts` (NodeNext). Copy this from every neighbouring import.
- Node 22+; TypeScript loaded via `--import tsx`; do not add a build step to run tests.
- Tests are `node:test` + `node:assert/strict`, one file per unit under `tests/unit/`, run with `node --import tsx --test tests/unit/<file>.test.ts`.
- Commit workflow: **do NOT run `git commit`/`git push`.** Each "Commit" step means: stage nothing, instead ensure `npx tsc --noEmit` is clean and the task's tests pass, then append/update the repo-root `commit_message` file; the maintainer runs `./push.sh` at review checkpoints. Message format: short summary line, blank line, dash detail lines, ending `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Backward compatibility is mandatory: a pipeline step with no `role` and an existing `modelOverride` must resolve exactly as it does today (manual pin → project preference → tier fallback).
- No placeholders in code: real fields, real values.

## File Structure

- Create `gateway/src/services/casting/roles.ts` — the `StepRole` vocabulary, `PROSE_ROLES`, `isStepRole`, and `inferRole` (used by the migration).
- Create `gateway/src/services/casting/casting-sheet.ts` — `CastingSheet`/`RoleModel`/`HeatLadder` types, `validateCastingSheet`, `loadCastingSheet` (builtin `library/casting/` + `workspace/library/casting/` overlay).
- Create `gateway/src/services/casting/cast-step.ts` — the `castStep` resolver.
- Modify `gateway/src/services/projects.ts` — add `role?: StepRole` to `ProjectStep`; load `role` from pipeline JSON in `createProjectFromPipeline`.
- Modify `gateway/src/api/routes/_shared.ts` — reimplement `stepRouting` as a wrapper over `castStep`.
- Create `library/casting/romance.json` — the first real casting sheet (fixture + first genre). Remaining genres land in Plan 7.
- Create `scripts/migrate-step-roles.ts` — one-time role-tagging pass over `library/pipelines/*.json`.
- Tests: `tests/unit/casting-roles.test.ts`, `tests/unit/casting-sheet.test.ts`, `tests/unit/cast-step.test.ts`, `tests/unit/casting-steprouting-compat.test.ts`.

---

### Task 1: Role vocabulary and inference

**Files:**
- Create: `gateway/src/services/casting/roles.ts`
- Test: `tests/unit/casting-roles.test.ts`

**Interfaces:**
- Produces: `type StepRole`; `const PROSE_ROLES: ReadonlySet<StepRole>`; `function isStepRole(x: unknown): x is StepRole`; `function inferRole(step: { skill?: string; label?: string; taskType?: string; phase?: string }): StepRole | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/casting-roles.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStepRole, PROSE_ROLES, inferRole } from '../../gateway/src/services/casting/roles.js';

test('PROSE_ROLES is exactly scene_brief + draft', () => {
  assert.deepEqual([...PROSE_ROLES].sort(), ['draft', 'scene_brief']);
});

test('isStepRole accepts known roles, rejects others', () => {
  assert.equal(isStepRole('draft'), true);
  assert.equal(isStepRole('continuity'), true);
  assert.equal(isStepRole('nonsense'), false);
  assert.equal(isStepRole(undefined), false);
});

test('inferRole maps skill/label/taskType to a role', () => {
  assert.equal(inferRole({ skill: 'write' }), 'draft');
  assert.equal(inferRole({ skill: 'book-bible' }), 'bible');
  assert.equal(inferRole({ skill: 'outline' }), 'outline');
  assert.equal(inferRole({ taskType: 'consistency' }), 'continuity');
  assert.equal(inferRole({ label: 'Humanize — Chapter 3' }), 'humanize');
  assert.equal(inferRole({ label: 'Intimacy — Chapter 3' }), 'intimacy');
  assert.equal(inferRole({ label: 'Scene Brief — Chapter 3' }), 'scene_brief');
  assert.equal(inferRole({ label: 'Improvement Plan — Chapter 3' }), 'improve');
  assert.equal(inferRole({ label: 'Compile manuscript', taskType: 'general' }), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/casting-roles.test.ts`
Expected: FAIL — cannot find module `roles.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/services/casting/roles.ts
export type StepRole =
  | 'scene_brief' | 'draft' | 'improve' | 'rewrite' | 'humanize' | 'intimacy'
  | 'editorial' | 'analysis' | 'research' | 'bible' | 'outline' | 'plan'
  | 'format' | 'marketing' | 'continuity';

export const STEP_ROLES: readonly StepRole[] = [
  'scene_brief', 'draft', 'improve', 'rewrite', 'humanize', 'intimacy',
  'editorial', 'analysis', 'research', 'bible', 'outline', 'plan',
  'format', 'marketing', 'continuity',
];

/** The two generative steps the author's intake prose-model choice controls. */
export const PROSE_ROLES: ReadonlySet<StepRole> = new Set<StepRole>(['scene_brief', 'draft']);

export function isStepRole(x: unknown): x is StepRole {
  return typeof x === 'string' && (STEP_ROLES as readonly string[]).includes(x);
}

/**
 * Best-effort role for an un-tagged step, used only by the one-time migration.
 * Label match wins over skill/taskType because ported per-chapter steps carry
 * descriptive labels ("Scene Brief — Chapter {{n}}") but no skill.
 */
export function inferRole(step: { skill?: string; label?: string; taskType?: string; phase?: string }): StepRole | undefined {
  const label = (step.label || '').toLowerCase();
  const labelMap: Array<[RegExp, StepRole]> = [
    [/scene brief/, 'scene_brief'],
    [/first draft|write chapter/, 'draft'],
    [/humaniz/, 'humanize'],
    [/intimacy|intimate/, 'intimacy'],
    [/improvement|improve/, 'improve'],
    [/rewrite|surgical/, 'rewrite'],
  ];
  for (const [re, role] of labelMap) if (re.test(label)) return role;

  switch (step.skill) {
    case 'write': return 'draft';
    case 'revise': return 'rewrite';
    case 'book-bible': return 'bible';
    case 'outline': return 'outline';
    case 'research': return 'research';
    case 'premise': return 'plan';
    case 'style-clone': return 'editorial';
    case 'dialogue': return 'editorial';
    case 'beta-reader': return 'analysis';
  }
  switch (step.taskType) {
    case 'consistency': return 'continuity';
    case 'final_edit':
    case 'revision': return 'editorial';
    case 'research': return 'research';
    case 'marketing': return 'marketing';
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/casting-roles.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit (per Global Constraints)**

Run `npx tsc --noEmit` (expect exit 0), then append a `commit_message` entry: `feat(casting): step role vocabulary + inference`.

---

### Task 2: Casting sheet types, validation, and loader

**Files:**
- Create: `gateway/src/services/casting/casting-sheet.ts`
- Create: `library/casting/romance.json`
- Test: `tests/unit/casting-sheet.test.ts`

**Interfaces:**
- Consumes: `StepRole` from Task 1.
- Produces:
  - `interface RoleModel { provider: string; model?: string; temperature?: number }`
  - `interface HeatLadder { eroticaThreshold: number; uncensoredByLevel: Array<{ minSpice: number; provider: string; model?: string }>; rerouteRoles: StepRole[]; fallbackOrder: string[] }`
  - `interface CastingSheet { genre: string; roleModels: Partial<Record<StepRole, RoleModel>>; proseRoles: StepRole[]; heatLadder?: HeatLadder; ensemblePanel?: string[] }`
  - `function validateCastingSheet(raw: unknown): CastingSheet` (throws `Error` on invalid shape)
  - `function loadCastingSheet(genre: string, opts?: { builtinDir?: string; overlayDir?: string }): CastingSheet | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/casting-sheet.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCastingSheet, loadCastingSheet } from '../../gateway/src/services/casting/casting-sheet.js';

const SHEET = {
  genre: 'romance',
  roleModels: {
    scene_brief: { provider: 'openrouter', model: 'anthropic/claude-opus', temperature: 1 },
    draft: { provider: 'openrouter', model: 'anthropic/claude-opus', temperature: 1 },
    improve: { provider: 'openrouter', model: 'google/gemini-3-pro', temperature: 0.7 },
  },
  proseRoles: ['scene_brief', 'draft'],
  heatLadder: { eroticaThreshold: 7, uncensoredByLevel: [{ minSpice: 7, provider: 'grok' }], rerouteRoles: ['draft', 'intimacy'], fallbackOrder: ['grok', 'venice', 'ollama'] },
};

test('validateCastingSheet accepts a well-formed sheet', () => {
  const s = validateCastingSheet(SHEET);
  assert.equal(s.genre, 'romance');
  assert.equal(s.roleModels.draft?.provider, 'openrouter');
  assert.deepEqual(s.proseRoles, ['scene_brief', 'draft']);
});

test('validateCastingSheet rejects an unknown role key', () => {
  assert.throws(() => validateCastingSheet({ ...SHEET, roleModels: { bogus: { provider: 'x' } } }), /unknown role/i);
});

test('validateCastingSheet rejects a role model with no provider', () => {
  assert.throws(() => validateCastingSheet({ ...SHEET, roleModels: { draft: { model: 'x' } } }), /provider/i);
});

test('loadCastingSheet reads builtin then overlay overrides it', () => {
  const root = mkdtempSync(join(tmpdir(), 'casting-'));
  const builtin = join(root, 'library', 'casting');
  const overlay = join(root, 'workspace', 'library', 'casting');
  mkdirSync(builtin, { recursive: true });
  mkdirSync(overlay, { recursive: true });
  writeFileSync(join(builtin, 'romance.json'), JSON.stringify(SHEET));
  writeFileSync(join(overlay, 'romance.json'), JSON.stringify({ ...SHEET, proseRoles: ['draft'] }));
  const s = loadCastingSheet('romance', { builtinDir: builtin, overlayDir: overlay });
  assert.deepEqual(s?.proseRoles, ['draft'], 'overlay wins');
  assert.equal(loadCastingSheet('nope', { builtinDir: builtin, overlayDir: overlay }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/casting-sheet.test.ts`
Expected: FAIL — cannot find module `casting-sheet.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/services/casting/casting-sheet.ts
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { isStepRole, type StepRole } from './roles.js';

export interface RoleModel { provider: string; model?: string; temperature?: number }
export interface HeatLadder {
  eroticaThreshold: number;
  uncensoredByLevel: Array<{ minSpice: number; provider: string; model?: string }>;
  rerouteRoles: StepRole[];
  fallbackOrder: string[];
}
export interface CastingSheet {
  genre: string;
  roleModels: Partial<Record<StepRole, RoleModel>>;
  proseRoles: StepRole[];
  heatLadder?: HeatLadder;
  ensemblePanel?: string[];
}

export function validateCastingSheet(raw: unknown): CastingSheet {
  const r = raw as any;
  if (!r || typeof r !== 'object') throw new Error('casting sheet must be an object');
  if (typeof r.genre !== 'string' || !r.genre) throw new Error('casting sheet: genre required');
  const roleModels: Partial<Record<StepRole, RoleModel>> = {};
  for (const [key, val] of Object.entries(r.roleModels || {})) {
    if (!isStepRole(key)) throw new Error(`casting sheet: unknown role "${key}"`);
    const v = val as any;
    if (!v || typeof v.provider !== 'string' || !v.provider) throw new Error(`casting sheet: role "${key}" needs a provider`);
    roleModels[key] = { provider: v.provider, model: v.model, temperature: v.temperature };
  }
  const proseRoles = Array.isArray(r.proseRoles) && r.proseRoles.every(isStepRole)
    ? (r.proseRoles as StepRole[]) : (['scene_brief', 'draft'] as StepRole[]);
  return { genre: r.genre, roleModels, proseRoles, heatLadder: r.heatLadder, ensemblePanel: r.ensemblePanel };
}

/** Load `<genre>.json` from the workspace overlay if present, else the builtin dir. */
export function loadCastingSheet(
  genre: string,
  opts: { builtinDir?: string; overlayDir?: string } = {},
): CastingSheet | null {
  const builtinDir = opts.builtinDir ?? join(process.cwd(), 'library', 'casting');
  const overlayDir = opts.overlayDir ?? join(process.cwd(), 'workspace', 'library', 'casting');
  for (const dir of [overlayDir, builtinDir]) {
    const p = join(dir, `${genre}.json`);
    if (existsSync(p)) {
      try { return validateCastingSheet(JSON.parse(readFileSync(p, 'utf-8'))); }
      catch { /* fall through to the next dir */ }
    }
  }
  return null;
}
```

- [ ] **Step 4: Create the first real casting sheet**

```json
// library/casting/romance.json
{
  "genre": "romance",
  "roleModels": {
    "scene_brief": { "provider": "openrouter", "model": "anthropic/claude-sonnet-4.6", "temperature": 0.8 },
    "draft": { "provider": "openrouter", "model": "anthropic/claude-opus-4.6", "temperature": 1 },
    "improve": { "provider": "openrouter", "model": "google/gemini-3-pro", "temperature": 0.7 },
    "rewrite": { "provider": "openrouter", "model": "google/gemini-3-pro", "temperature": 0.7 },
    "humanize": { "provider": "openrouter", "model": "google/gemini-3-pro", "temperature": 0.4 },
    "intimacy": { "provider": "openrouter", "model": "anthropic/claude-sonnet-4.6", "temperature": 0.6 },
    "editorial": { "provider": "openrouter", "model": "anthropic/claude-sonnet-4.6", "temperature": 0.3 },
    "continuity": { "provider": "openrouter", "model": "google/gemini-3-pro", "temperature": 0.2 }
  },
  "proseRoles": ["scene_brief", "draft"],
  "heatLadder": {
    "eroticaThreshold": 7,
    "uncensoredByLevel": [{ "minSpice": 7, "provider": "grok" }, { "minSpice": 9, "provider": "openrouter", "model": "venice/uncensored" }],
    "rerouteRoles": ["draft", "intimacy"],
    "fallbackOrder": ["grok", "venice", "ollama"]
  },
  "ensemblePanel": ["gpt", "grok", "gemini", "claude"]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/casting-sheet.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit (per Global Constraints)**

`npx tsc --noEmit` clean, then append `commit_message`: `feat(casting): casting-sheet types, validation, overlay loader + romance sheet`.

---

### Task 3: The `castStep` resolver

**Files:**
- Create: `gateway/src/services/casting/cast-step.ts`
- Test: `tests/unit/cast-step.test.ts`

**Interfaces:**
- Consumes: `PROSE_ROLES`/`StepRole` (Task 1), `CastingSheet` (Task 2), `isValidModelId` from `gateway/src/ai/model-id.js`.
- Produces:
  - `interface CastInputs { step: { role?: StepRole; modelOverride?: { provider?: string; model?: string; temperature?: number } }; sheet: CastingSheet | null; proseModel?: { provider: string; model?: string }; spiceRoute?: { provider: string; model?: string } | null }`
  - `interface CastResult { provider?: string; model?: string; temperature?: number; source: 'spice' | 'manual' | 'prose-pick' | 'sheet' | 'tier-fallback' }`
  - `function castStep(inputs: CastInputs): CastResult`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/cast-step.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { castStep } from '../../gateway/src/services/casting/cast-step.js';
import type { CastingSheet } from '../../gateway/src/services/casting/casting-sheet.js';

const sheet: CastingSheet = {
  genre: 'romance',
  roleModels: {
    draft: { provider: 'openrouter', model: 'anthropic/claude-opus-4.6', temperature: 1 },
    improve: { provider: 'openrouter', model: 'google/gemini-3-pro', temperature: 0.7 },
  },
  proseRoles: ['scene_brief', 'draft'],
};

test('spice re-route beats everything, including a manual pin', () => {
  const r = castStep({ step: { role: 'draft', modelOverride: { provider: 'openai', model: 'gpt-4o' } }, sheet, spiceRoute: { provider: 'grok' } });
  assert.equal(r.source, 'spice');
  assert.equal(r.provider, 'grok');
});

test('manual pin beats the prose pick and the sheet', () => {
  const r = castStep({ step: { role: 'draft', modelOverride: { provider: 'openai', model: 'gpt-4o' } }, sheet, proseModel: { provider: 'deepseek' } });
  assert.equal(r.source, 'manual');
  assert.equal(r.provider, 'openai');
  assert.equal(r.model, 'gpt-4o');
});

test('prose pick applies to a prose role only', () => {
  const draft = castStep({ step: { role: 'draft' }, sheet, proseModel: { provider: 'deepseek', model: 'deepseek-chat' } });
  assert.equal(draft.source, 'prose-pick');
  assert.equal(draft.provider, 'deepseek');
  const improve = castStep({ step: { role: 'improve' }, sheet, proseModel: { provider: 'deepseek', model: 'deepseek-chat' } });
  assert.equal(improve.source, 'sheet');
  assert.equal(improve.provider, 'openrouter');
});

test('sheet default applies when no pin/pick', () => {
  const r = castStep({ step: { role: 'draft' }, sheet });
  assert.equal(r.source, 'sheet');
  assert.equal(r.model, 'anthropic/claude-opus-4.6');
  assert.equal(r.temperature, 1);
});

test('no role + no sheet entry falls through to tier-fallback', () => {
  const r = castStep({ step: { role: 'analysis' }, sheet });
  assert.equal(r.source, 'tier-fallback');
  assert.equal(r.provider, undefined);
});

test('an invalid model id is dropped (provider kept), not passed through', () => {
  const bad: CastingSheet = { ...sheet, roleModels: { draft: { provider: 'openrouter', model: 'has spaces/bad' } } };
  const r = castStep({ step: { role: 'draft' }, sheet: bad });
  assert.equal(r.provider, 'openrouter');
  assert.equal(r.model, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/cast-step.test.ts`
Expected: FAIL — cannot find module `cast-step.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/services/casting/cast-step.ts
import { PROSE_ROLES, type StepRole } from './roles.js';
import type { CastingSheet } from './casting-sheet.js';
import { isValidModelId } from '../../ai/model-id.js';

export interface CastInputs {
  step: { role?: StepRole; modelOverride?: { provider?: string; model?: string; temperature?: number } };
  sheet: CastingSheet | null;
  proseModel?: { provider: string; model?: string };
  spiceRoute?: { provider: string; model?: string } | null;
}
export interface CastResult {
  provider?: string;
  model?: string;
  temperature?: number;
  source: 'spice' | 'manual' | 'prose-pick' | 'sheet' | 'tier-fallback';
}

/** Drop a model id that would be unsafe to send to a provider API; keep the provider. */
function clean(provider: string | undefined, model: string | undefined, temperature: number | undefined, source: CastResult['source']): CastResult {
  const safeModel = model && isValidModelId(model) ? model : undefined;
  return { provider, model: safeModel, temperature, source };
}

export function castStep(inputs: CastInputs): CastResult {
  const { step, sheet, proseModel, spiceRoute } = inputs;
  const role = step.role;

  // 1. Spice re-route (a scene flagged over the ceiling) wins over everything,
  //    so a flagged explicit scene never lands on a refusing/ban-risk model.
  if (spiceRoute) return clean(spiceRoute.provider, spiceRoute.model, undefined, 'spice');

  // 2. Manual per-step pin (the existing escape hatch).
  const mo = step.modelOverride;
  if (mo && (mo.provider || mo.model)) return clean(mo.provider, mo.model, mo.temperature, 'manual');

  // 3. The author's prose-model pick, applied to prose roles only.
  const proseRoles = sheet?.proseRoles?.length ? new Set(sheet.proseRoles) : PROSE_ROLES;
  if (proseModel && role && proseRoles.has(role)) {
    return clean(proseModel.provider, proseModel.model, undefined, 'prose-pick');
  }

  // 4. Genre casting-sheet default for the role.
  const rm = role && sheet?.roleModels?.[role];
  if (rm) return clean(rm.provider, rm.model, rm.temperature, 'sheet');

  // 5. Nothing pinned → tier routing decides downstream.
  return { provider: undefined, model: undefined, temperature: undefined, source: 'tier-fallback' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/cast-step.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit (per Global Constraints)**

`npx tsc --noEmit` clean, then append `commit_message`: `feat(casting): castStep resolver with five-level precedence + model-id validation`.

---

### Task 4: Add `role` to `ProjectStep` and load it from pipeline JSON

**Files:**
- Modify: `gateway/src/services/projects.ts` (the `ProjectStep` interface ~line 95–105, and `createProjectFromPipeline` ~line 810 where `modelOverride` is read from the pipeline step)
- Test: `tests/unit/casting-step-role-load.test.ts`

**Interfaces:**
- Consumes: `StepRole` from Task 1.
- Produces: `ProjectStep.role?: StepRole` populated from the pipeline JSON step's `role` field.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/casting-step-role-load.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStepRole } from '../../gateway/src/services/casting/roles.js';

// The pipeline JSON step carries a `role`; createProjectFromPipeline copies it
// onto the ProjectStep verbatim when it is a valid StepRole. This test asserts
// the contract at the copy helper level (extracted for testability).
import { readStepRole } from '../../gateway/src/services/projects.js';

test('readStepRole passes through a valid role and drops an invalid one', () => {
  assert.equal(readStepRole({ role: 'draft' }), 'draft');
  assert.equal(readStepRole({ role: 'bogus' }), undefined);
  assert.equal(readStepRole({}), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/casting-step-role-load.test.ts`
Expected: FAIL — `readStepRole` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `gateway/src/services/projects.ts`, add the import near the top (match existing `.js` import style):

```ts
import { isStepRole, type StepRole } from './casting/roles.js';
```

Add `role` to the `ProjectStep` interface, right after the `modelOverride` field:

```ts
  // Semantic casting role (scene_brief/draft/improve/...). Drives model
  // selection via the casting sheet + castStep resolver. Optional: an untagged
  // step falls back to today's provider/model routing.
  role?: StepRole;
```

Add the exported helper (near the other small helpers in the file):

```ts
/** Read a valid StepRole off a raw pipeline-JSON step, else undefined. */
export function readStepRole(raw: { role?: unknown }): StepRole | undefined {
  return isStepRole(raw.role) ? raw.role : undefined;
}
```

In `createProjectFromPipeline`, where each pipeline step is turned into a `ProjectStep` (the object literal that already sets `modelOverride: pipelineStep.modelOverride`), add:

```ts
    role: readStepRole(pipelineStep),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/casting-step-role-load.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check the wider change**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit (per Global Constraints)**

Append `commit_message`: `feat(casting): ProjectStep.role + load it from pipeline JSON`.

---

### Task 5: Reimplement `stepRouting` over `castStep` (backward-compatible)

**Files:**
- Modify: `gateway/src/api/routes/_shared.ts` (`stepRouting`, lines ~124–135)
- Test: `tests/unit/casting-steprouting-compat.test.ts`

**Interfaces:**
- Consumes: `castStep` (Task 3), `loadCastingSheet` (Task 2).
- Produces: unchanged `stepRouting(project, step) => { provider, model, temperature }` — same return shape the two call sites already destructure, so no call-site change is required in this task.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/casting-steprouting-compat.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepRouting } from '../../gateway/src/api/routes/_shared.js';

test('untagged step keeps today behavior: manual pin then project preference', () => {
  // No role → project.preferredProvider/Model apply to the whole step (legacy).
  assert.deepEqual(
    stepRouting({ preferredProvider: 'gemini', preferredModel: 'google/gemini-3-pro' }, {}),
    { provider: 'gemini', model: 'google/gemini-3-pro', temperature: undefined },
  );
  assert.deepEqual(
    stepRouting({ preferredProvider: 'gemini' }, { modelOverride: { provider: 'openai', model: 'gpt-4o', temperature: 0.5 } }),
    { provider: 'openai', model: 'gpt-4o', temperature: 0.5 },
  );
});

test('a tagged prose step uses the project prose pick only on prose roles', () => {
  const project = { preferredProvider: 'deepseek', preferredModel: 'deepseek-chat', genre: '__no_sheet__' };
  // With no sheet on disk for this genre, a draft role still gets the prose pick.
  assert.equal(stepRouting(project, { role: 'draft' }).provider, 'deepseek');
  // A non-prose role with no sheet entry falls through to undefined (tier routing).
  assert.equal(stepRouting(project, { role: 'improve' }).provider, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/casting-steprouting-compat.test.ts`
Expected: FAIL — current `stepRouting` applies `preferredProvider` to every step regardless of role, so the second test's `improve` assertion fails.

- [ ] **Step 3: Write minimal implementation**

Replace the body of `stepRouting` in `gateway/src/api/routes/_shared.ts` (keep the signature and JSDoc intro), adding imports at the top of the file (match `.js` style):

```ts
import { castStep } from '../../services/casting/cast-step.js';
import { loadCastingSheet } from '../../services/casting/casting-sheet.js';
import { isStepRole } from '../../services/casting/roles.js';
```

```ts
export function stepRouting(
  project: any,
  step: any
): { provider: string | undefined; model: string | undefined; temperature: number | undefined } {
  const role = isStepRole(step?.role) ? step.role : undefined;

  // Backward compatibility: an untagged step keeps today's behavior exactly —
  // manual pin, then the project-level preference applied to the whole step.
  if (!role) {
    return {
      provider: step?.modelOverride?.provider || project?.preferredProvider || undefined,
      model: step?.modelOverride?.model || project?.preferredModel || undefined,
      temperature: typeof step?.modelOverride?.temperature === 'number' ? step.modelOverride.temperature : undefined,
    };
  }

  // Tagged step: resolve via the casting sheet + castStep. The project preference
  // is treated as the author's prose-model pick (applies to prose roles only).
  const sheet = project?.genre ? loadCastingSheet(String(project.genre)) : null;
  const proseModel = project?.preferredProvider
    ? { provider: project.preferredProvider, model: project.preferredModel }
    : undefined;
  const r = castStep({ step: { role, modelOverride: step?.modelOverride }, sheet, proseModel, spiceRoute: null });
  return { provider: r.provider, model: r.model, temperature: r.temperature };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/casting-steprouting-compat.test.ts`
Expected: PASS.

- [ ] **Step 5: Full-suite regression check**

Run: `node --import tsx --test tests/unit/*.test.ts`
Expected: all pass (existing project/routing tests unaffected because untagged steps keep legacy behavior).

- [ ] **Step 6: Commit (per Global Constraints)**

`npx tsc --noEmit` clean, then append `commit_message`: `feat(casting): stepRouting delegates to castStep for tagged steps (untagged unchanged)`.

---

### Task 6: One-time role migration of library pipelines

**Files:**
- Create: `scripts/migrate-step-roles.ts`
- Test: `tests/unit/casting-migration.test.ts`

**Interfaces:**
- Consumes: `inferRole` (Task 1).
- Produces: `function tagPipelineRoles(pipeline: any): { changed: number }` — mutates a parsed pipeline object in place, setting `role` on every step (including nested `expand.steps`) that lacks one, using `inferRole`. The script wraps it to read/write each `library/pipelines/*.json`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/casting-migration.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagPipelineRoles } from '../../scripts/migrate-step-roles.js';

test('tagPipelineRoles tags top-level and nested expand steps, skips already-tagged', () => {
  const pipeline = {
    steps: [
      { label: 'Scene Brief — Chapter 1' },
      { label: 'Already', role: 'editorial' },
      { expand: 'chapters', steps: [
        { label: 'First Draft — Chapter {{n}}' },
        { label: 'Humanize — Chapter {{n}}' },
      ] },
    ],
  };
  const { changed } = tagPipelineRoles(pipeline);
  assert.equal(pipeline.steps[0].role, 'scene_brief');
  assert.equal(pipeline.steps[1].role, 'editorial', 'existing role preserved');
  assert.equal((pipeline.steps[2] as any).steps[0].role, 'draft');
  assert.equal((pipeline.steps[2] as any).steps[1].role, 'humanize');
  assert.equal(changed, 3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/casting-migration.test.ts`
Expected: FAIL — cannot find module `migrate-step-roles.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/migrate-step-roles.ts
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { inferRole } from '../gateway/src/services/casting/roles.js';

/** Tag every un-tagged step (incl. nested expand.steps) with an inferred role. */
export function tagPipelineRoles(pipeline: any): { changed: number } {
  let changed = 0;
  const walk = (steps: any[]) => {
    for (const s of steps || []) {
      if (!s || typeof s !== 'object') continue;
      if (Array.isArray(s.steps)) walk(s.steps);
      if (s.role) continue;
      const role = inferRole(s);
      if (role) { s.role = role; changed++; }
    }
  };
  walk(pipeline?.steps || []);
  return { changed };
}

// CLI: tag every library/pipelines/*.json in place.
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(process.cwd(), 'library', 'pipelines');
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const p = join(dir, f);
    const pipeline = JSON.parse(readFileSync(p, 'utf-8'));
    const { changed } = tagPipelineRoles(pipeline);
    if (changed) { writeFileSync(p, JSON.stringify(pipeline, null, 2) + '\n'); console.log(`  tagged ${changed} step(s) in ${f}`); }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/casting-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the migration for real and eyeball the diff**

Run: `node --import tsx scripts/migrate-step-roles.ts`
Then: `git diff --stat library/pipelines/` — expect role fields added across the ported pipelines. Spot-check `library/pipelines/romance-spicy.json` shows `draft`, `humanize`, `intimacy` on the nested steps.

- [ ] **Step 6: Commit (per Global Constraints)**

`npx tsc --noEmit` clean, full suite green, then append `commit_message`: `feat(casting): migrate library pipelines to tagged step roles`.

---

## Self-Review

- **Spec coverage (Section 4.1):** step roles → Task 1; casting sheet (`roleModels`/`heatLadder`/`proseRoles`/`ensemblePanel`) → Task 2; resolver precedence 2–5 + model-id validation + fallback → Task 3; the `spiceRoute` level-1 seam is defined in Task 3's `CastInputs` and left null, to be filled by Plan 2; `role` on steps + load → Task 4; backward-compatible `stepRouting` → Task 5; role migration → Task 6. The heat-ladder *behavior* (erotica threshold, classifier, escalation) is Plan 2 and intentionally out of scope here — only the sheet *shape* lands now.
- **Placeholder scan:** none; every step has real code and a runnable command.
- **Type consistency:** `StepRole`, `CastingSheet`/`RoleModel`/`HeatLadder`, `CastInputs`/`CastResult`, `readStepRole`, `tagPipelineRoles`, `stepRouting` signature are used identically across tasks.

## Downstream plans (written after this one is built)

Plan 2 content axes + heat_check + intimacy-branch routing (fills the `spiceRoute` seam); Plan 3 consistency spine; Plan 4 enhancement wrappers; Plan 5 gate cadence; Plan 6 scheduler + cost; Plan 7 techno-thriller base + remaining casting sheets; Plan 8 opt-in ideation ensemble.
