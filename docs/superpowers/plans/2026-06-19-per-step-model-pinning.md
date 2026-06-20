# Per-Step Model Pinning (+ temperature) for pipeline steps

**Date:** 2026-06-19
**Status:** plan — not yet implemented
**Goal:** let a `library/pipelines/*.json` step declare an optional per-step model override and temperature, so steps can pin a specific provider + model (e.g. a different OpenRouter model per step) and temperature, instead of relying solely on `taskType` → tier routing. Backward compatible; degrades gracefully to tier routing when the pinned provider isn't configured.

---

## 1. Design

### 1.1 Chosen schema shape

Add to `LibraryPipelineStep` (the pipeline-JSON step) and `ProjectStep` (the resolved runtime step) **the same** `modelOverride` object that `ProjectStep` already has, **extended with `temperature`**:

```jsonc
{
  "label": "Concepts A — Dark & Political",
  "taskType": "creative_writing",
  "promptTemplate": "...",
  "modelOverride": { "provider": "openrouter", "model": "x-ai/grok-4", "temperature": 1.1 }
}
```

**Decision: `temperature` lives INSIDE `modelOverride`, not as a sibling step field.**
Rationale:
- The existing runtime field is already `modelOverride?: { provider; model? }` (`projects.ts:95`) and is already read at execution (`index.ts:2082`). Extending that one object is the smallest surgical change and keeps "the per-step routing pin" as a single cohesive unit.
- A sibling `temperature` would create a second independent passthrough path and a second thing every hop must remember to copy. One object = one thing to thread.
- The router already accepts `temperature` on `CompletionRequest` (`router.ts:32`), so the value has a clean destination.

Final shape (both interfaces):
```ts
modelOverride?: { provider: string; model?: string; temperature?: number };
```
- `provider` required when `modelOverride` is present (matches `setStepModelOverride` semantics at `projects.ts:929`).
- `model?` optional — omit to pin provider only (provider's default model).
- `temperature?` optional — omit to use the provider/router default.
- The whole object is optional — **existing pipelines are unaffected** (no `modelOverride` key → identical behavior to today).

### 1.2 Full passthrough chain (annotated with current DROP points)

```
romantasy-planning.json  (JSON step: modelOverride{provider,model,temperature})
  │
  ▼  parsed by LibraryService / parsePipelineJson → typed as LibraryPipelineStep
LibraryPipelineStep            gateway/src/services/library-types.ts:15  ── EDIT: add modelOverride field
  │
  ▼  expandSteps() → emitStep()
ResolvedStepInput              gateway/src/services/pipeline-expand.ts:3  ── EDIT: add modelOverride field
emitStep()                     gateway/src/services/pipeline-expand.ts:22 ── DROP POINT #1: copies only label/skill/.../chapterNumber; modelOverride is silently dropped → must add it
  │
  ▼  resolved.map(...) → ProjectStep
ProjectStep                    gateway/src/services/projects.ts:78,95   ── EDIT: extend modelOverride with temperature?
resolved→ProjectStep map       gateway/src/services/projects.ts:656     ── DROP POINT #2: spreads phase/wordCountTarget/chapterNumber only; modelOverride dropped → must add it
  │
  ▼  step execution
index.ts step exec             gateway/src/index.ts:2082-2130           ── reads modelOverride.provider/.model already; DROP POINT #3: temperature not read/threaded → must add
  │
  ▼  handleMessage(..., preferredProvider, overrideModel, bookSlug)
handleMessage signature        gateway/src/index.ts:551-560             ── DROP POINT #4: no temperature parameter → add overrideTemperature param
handleMessage → complete()     gateway/src/index.ts:754-762             ── temperature only set for editor mode (line 761); must also set from overrideTemperature for project steps
  │
  ▼  aiRouter.complete({ provider, model, temperature, ... })
CompletionRequest              gateway/src/ai/router.ts:27-58           ── ALREADY supports provider, model, temperature. No edit.
selectProvider()               gateway/src/ai/router.ts:330-346         ── ALREADY falls back to tier routing + logs a warning when preferred provider unavailable. No edit.
complete() model override      gateway/src/ai/router.ts:412-414         ── ALREADY clones provider with request.model. No edit.
```

### 1.3 What is ALREADY done vs. what is missing

**Already honored at execution (do NOT duplicate):**
- `ProjectStep.modelOverride.provider` and `.model` are read at `index.ts:2082-2084` and passed as `preferredProvider` / `stepModel` (args 6 & 7) to `handleMessage`, on both the primary and short-retry calls (`index.ts:2109-2110`, `2126-2127`).
- `handleMessage` passes `preferredProvider` into `selectProvider(taskType, preferredProvider)` (`index.ts:683`) and `overrideModel` into `complete({ model })` (`index.ts:760`).
- `selectProvider` already **falls back to tier routing and logs** `[router] Preferred provider '...' not available, falling back to tier routing` (`router.ts:344`) when the pinned provider isn't configured/available. **This is the graceful-degradation path — already implemented.** No new fallback code needed for provider/model.

**Missing (the actual work):**
- (a) The field is not on `LibraryPipelineStep`, so it can't be authored in pipeline JSON.
- (b) `emitStep` (`pipeline-expand.ts:22`) drops it (DROP #1).
- (c) The `resolved.map` (`projects.ts:656`) drops it (DROP #2).
- (d) `temperature` is not in the `ProjectStep.modelOverride` type, not read at `index.ts:2082`, not a `handleMessage` parameter, and only wired to `complete()` for editor mode (DROP #3 + #4).

So: provider+model pinning needs the **field-passthrough hops only**; temperature needs the passthrough hops **plus** a new `handleMessage` parameter and one extra line at the `complete()` call.

### 1.4 Fallback / degradation behavior (exact)

1. **Unconfigured / unavailable pinned provider** → handled today by `selectProvider` (`router.ts:334-346`): it returns the tier-routed provider and logs a `console.warn`. No code change. The pinned `model` is still passed to `complete()`, but `complete()` only swaps the model when `request.model !== baseProvider.model` and the selected provider is the fallback — i.e. a stale model id on a fallback provider is passed through to that provider; this matches today's behavior for project-level `preferredProvider` and is acceptable (the warning makes the fallback visible). **We will not add new model-validation logic** (Simplicity First).
2. **Pinned provider available** → used directly with the pinned model + temperature.
3. **temperature** has no fallback semantics: when omitted it's simply not sent, and the provider default applies (same as today's non-editor turns).

### 1.5 Validation policy in `parsePipelineJson`

**Decision: LENIENT — no new validation in `parsePipelineJson`.**
- `parsePipelineJson` (`book-types.ts:92`) today validates only `steps` is an array and `schemaVersion` is numeric; it does **not** validate individual step fields (not even `taskType`/`promptTemplate`). Adding per-field validation for `modelOverride` only would be inconsistent and is scope creep.
- The runtime is already defensive: a `modelOverride` with a bogus/unconfigured `provider` falls back to tier routing with a logged warning; a missing `model` pins provider-only; a non-numeric `temperature` would simply be `typeof !== 'number'` and skipped at the `complete()` guard. No crash path.
- **No edit to `book-types.ts`.** (Noted explicitly so the implementer doesn't add speculative validation.)

### 1.6 Interaction with concurrent "parallel step execution" feature

The per-step `modelOverride` is a **per-step field**. `emitStep` operates on a single step object regardless of whether that step sits at the top level or inside an `{ expand: ... }` / future `{ parallel: ... }` group — `expandSteps` calls `emitStep(sub, ...)` for each sub-step of a group (`pipeline-expand.ts:42`). Because the field is copied inside `emitStep`, **any step the expander emits — including a step inside a parallel group — carries its `modelOverride` automatically.** This design adds nothing about grouping and is independent of it; the two features compose without coordination.

---

## 2. TDD task list (ordered, mechanical)

Each task: **RED** (write a failing test) → **GREEN** (make it pass). Run tests with:
`node --import tsx --test tests/unit/<name>.test.ts`. Type-check with `npx tsc --noEmit`.

> Imports in test files use `.ts` for source modules (see `pipeline-expand.test.ts:4-5`) — match that. Source-to-source imports use `.js` (NodeNext) — match existing files.

### Task 1 — `emitStep` carries `modelOverride` through expansion
- **RED:** In `tests/unit/pipeline-expand.test.ts`, add a test `expandSteps carries modelOverride (provider+model+temperature) through emitStep`. Build a raw step with `modelOverride: { provider: 'openrouter', model: 'x-ai/grok-4', temperature: 1.1 }`, expand it, assert `out[0].modelOverride` deep-equals that object. Add a second assertion: a step WITHOUT `modelOverride` yields `out[1].modelOverride === undefined` (backward compat). Run → fails (field dropped / not on type).
- **GREEN:**
  - `gateway/src/services/pipeline-expand.ts:3` — add `modelOverride?: { provider: string; model?: string; temperature?: number };` to `ResolvedStepInput`.
  - `gateway/src/services/pipeline-expand.ts:22` `emitStep` return object — add `modelOverride: s.modelOverride,` (pass through verbatim; no interpolation — model ids/providers are literals).
- **Verify:** test passes; `npx tsc --noEmit` clean.

### Task 2 — `LibraryPipelineStep` accepts the field (type-only)
- **RED:** Add `tests/unit/library-pipeline-step-types.test.ts` (or fold into the expand test) that imports a real pipeline JSON or constructs a `LibraryPipelineStep` literal with `modelOverride` and assigns it — primarily a **compile-time** guard. Concretely: write a test that `JSON.parse`s a small inline pipeline with a `modelOverride` step and casts it to `LibraryPipeline`, then passes its `.steps` to `expandSteps` and asserts the override survives. Run → at this point Task 1 already makes runtime pass; the missing piece is the type, caught by `npx tsc --noEmit` (RED = tsc error if the field isn't on the interface).
- **GREEN:** `gateway/src/services/library-types.ts:15` — add to `LibraryPipelineStep`:
  `modelOverride?: { provider: string; model?: string; temperature?: number };`
- **Verify:** `npx tsc --noEmit` clean; test passes.

### Task 3 — `ProjectStep.modelOverride` gains `temperature`; resolved→ProjectStep map copies the field
- **RED:** Add `tests/unit/project-step-modeloverride.test.ts`. Construct a minimal `ProjectEngine` and a `LibraryPipeline` whose step has `modelOverride: { provider: 'openrouter', model: 'x-ai/grok-4', temperature: 1.1 }`, create a project from it (via the same `createFromPipeline`/`createProject` path that hits `projects.ts:656`), and assert `project.steps[0].modelOverride` deep-equals the object. (Study how `projects.ts` is constructed; if direct construction is heavy, instead unit-test the map by exporting/exercising the smallest reachable path — prefer the real `create*` method with a stub library resolver, no AI calls.) Run → fails (map drops the field; `temperature` not on type).
- **GREEN:**
  - `gateway/src/services/projects.ts:95` — change to `modelOverride?: { provider: string; model?: string; temperature?: number };`
  - `gateway/src/services/projects.ts:656` map — add `...(s.modelOverride ? { modelOverride: s.modelOverride } : {}),` to the emitted `ProjectStep` object (match the existing conditional-spread style used for `phase`/`wordCountTarget`/`chapterNumber` on lines 664-666).
- **Verify:** test passes; `npx tsc --noEmit` clean.

### Task 4 — `handleMessage` accepts + threads `overrideTemperature`
- **RED:** This is the hardest to unit-test in isolation (`handleMessage` is on the 2,650-line gateway and does real I/O). Pragmatic approach: extract NOTHING; instead add a **focused assertion test** only if a seam exists. If no clean seam exists without refactor, treat Task 4 as **type + wiring verified by `npx tsc --noEmit` + the smoke test**, and document the manual check. Prefer: add a tiny pure helper is NOT warranted here (Simplicity First) — the change is a parameter + one conditional spread.
  - Minimum RED: extend the Task 3 test (or add `index-temperature-wiring.test.ts`) to assert the **type contract**: that `ProjectStep.modelOverride` can carry `temperature` and that the execution reads it. Since execution can't be unit-run without the gateway, assert the data shape only and rely on tsc for the wiring.
- **GREEN:**
  - `gateway/src/index.ts:551-560` — add a parameter `overrideTemperature?: number` to `handleMessage` (after `overrideModel`, before `bookSlug` would reorder existing callers — instead add it **after `bookSlug`** as the 9th param to avoid touching the many existing 8-arg call sites; OR add after `overrideModel` and update all call sites. **Decision: add as the LAST parameter (`overrideTemperature?: number` after `bookSlug`)** to keep existing callers untouched — surgical.)
  - `gateway/src/index.ts:754-762` `complete({...})` — add `...(typeof overrideTemperature === 'number' ? { temperature: overrideTemperature } : {}),`. Keep the existing editor-mode temperature line; the editor path and project path are mutually exclusive (editor turns don't carry a project step override), so a later spread of `overrideTemperature` after the editor temperature line is fine and explicit.
  - `gateway/src/index.ts:2082-2130` step execution:
    - line ~2084 add: `const stepTemp = stepOverride?.temperature;`
    - both `handleMessage(...)` calls (primary ~2100 and short-retry ~2120) — append `stepTemp` as the new last argument (after `project.bookSlug`).
- **Verify:** `npx tsc --noEmit` clean; `npm run test:smoke` still passes (no behavioral regression for non-pinned steps).

### Task 5 — End-to-end pipeline-JSON fixture
- **RED:** Add `tests/unit/per-step-model-pinning.test.ts`: load an **inline** pipeline object (not the shipped romantasy file, to keep the test stable) with 2 steps — one with `modelOverride{provider,model,temperature}`, one without — run `buildPipelineVars` + `expandSteps`, and assert both `modelOverride` survives on step 1 and is `undefined` on step 2. Then assert step 1's `modelOverride.temperature === 1.1`. Run → passes after Tasks 1-3 (this is the regression lock for the JSON→resolved chain).
- **GREEN:** already green from Tasks 1-3; this task only ADDS the locking test. If it fails, a prior task regressed.
- **Verify:** test passes.

### Task 6 — Wire the romantasy-planning pipeline to use it (data-only)
- **RED:** Add a test in `tests/unit/per-step-model-pinning.test.ts` that loads the **real** `library/pipelines/romantasy-planning.json`, expands it, and asserts the 4 ideation steps each carry a `modelOverride` with a `provider === 'openrouter'`, distinct `model` ids, and `temperature >= 1.0`; and the selection/evaluator steps carry `temperature <= 0.3`. Run → fails (JSON not yet edited).
- **GREEN:** `library/pipelines/romantasy-planning.json` — add `modelOverride` blocks to the 4 ideation steps (4 distinct OpenRouter models, temp ~1.0-1.1) and the evaluator/selection steps (specific models, temp 0.3). Provider `"openrouter"`. **Pick model ids the user confirms are available on their OpenRouter account** — leave a clear TODO/comment if unknown, but the test only asserts shape + temp bounds + distinct models, so placeholder-but-distinct ids satisfy it. (Confirm exact model ids with the user before finalizing.)
- **Verify:** test passes; `npx tsc --noEmit` clean.

---

## 3. Unit tests to add (summary)

| # | File | Asserts |
|---|------|---------|
| T1 | `tests/unit/pipeline-expand.test.ts` (new case `expandSteps carries modelOverride …`) | `emitStep`/`expandSteps` pass `modelOverride{provider,model,temperature}` through verbatim; a step without it yields `undefined` (backward compat) |
| T3 | `tests/unit/project-step-modeloverride.test.ts` | Creating a project from a pipeline whose step has `modelOverride` (incl. `temperature`) produces a `ProjectStep` with that `modelOverride` intact (the `projects.ts:656` map copies it) |
| T5/T6 | `tests/unit/per-step-model-pinning.test.ts` | (a) inline 2-step pipeline: override survives on pinned step, `undefined` on the other, `temperature===1.1`; (b) real `romantasy-planning.json`: 4 ideation steps each pin `provider:'openrouter'` with distinct models + temp ≥ 1.0, evaluator/selection steps pin temp ≤ 0.3 |

(Task 2 and Task 4 are enforced primarily by `npx tsc --noEmit` — type contracts — plus the smoke test for Task 4's runtime wiring. No standalone runtime unit test is added for the `handleMessage` parameter because exercising it requires the full gateway; the data-shape tests above plus tsc cover the contract.)

**Test count: 3 new test files / cases** (T1 case added to an existing file; T3 and the combined T5/T6 file are new). Named:
1. `expandSteps carries modelOverride (provider+model+temperature)` — case in `pipeline-expand.test.ts`
2. `project-step-modeloverride.test.ts`
3. `per-step-model-pinning.test.ts`

---

## 4. Files to edit (with one-line reasons)

| File:line | Reason |
|-----------|--------|
| `gateway/src/services/library-types.ts:15` | Add `modelOverride?` to `LibraryPipelineStep` so pipeline JSON can declare it. |
| `gateway/src/services/pipeline-expand.ts:3` | Add `modelOverride?` to `ResolvedStepInput`. |
| `gateway/src/services/pipeline-expand.ts:22` | `emitStep` must copy `modelOverride` (DROP #1). |
| `gateway/src/services/projects.ts:95` | Extend `ProjectStep.modelOverride` with `temperature?`. |
| `gateway/src/services/projects.ts:656` | resolved→ProjectStep map must copy `modelOverride` (DROP #2). |
| `gateway/src/index.ts:551-560` | Add `overrideTemperature?` last param to `handleMessage`. |
| `gateway/src/index.ts:754-762` | Spread `overrideTemperature` into `complete()` for project steps. |
| `gateway/src/index.ts:2082-2130` | Read `stepOverride.temperature` and pass it on both `handleMessage` calls (DROP #3/#4). |
| `library/pipelines/romantasy-planning.json` | Author the per-step OpenRouter models + temps (the motivating use case). |

**No edits to:** `gateway/src/ai/router.ts` (already supports provider/model/temperature + graceful fallback), `gateway/src/services/book-types.ts` (lenient validation — no change).

---

## 5. Verification checklist

- [ ] `npx tsc --noEmit` clean (all 8 source edits type-check).
- [ ] `node --import tsx --test tests/unit/pipeline-expand.test.ts` passes (incl. new `modelOverride` case).
- [ ] `node --import tsx --test tests/unit/project-step-modeloverride.test.ts` passes.
- [ ] `node --import tsx --test tests/unit/per-step-model-pinning.test.ts` passes (inline + real romantasy-planning fixture).
- [ ] `npm run test:smoke` passes (no regression to security perimeter / startup).
- [ ] A non-pinned existing pipeline (e.g. `book-production.json`) still expands identically — covered by the unchanged existing `pipeline-expand.test.ts` case at line 53.
- [ ] `romantasy-planning.json` declares a distinct OpenRouter `model` per ideation step (temp ~1.0-1.1) and low temp (0.3) on evaluator/selection steps — confirmed by the Task 6 assertion AND a manual read of the file.
- [ ] Manual fallback check (documented, not automated): with no OpenRouter key configured, running the pipeline logs `[router] Preferred provider 'openrouter' not available, falling back to tier routing` and the step still completes via tier routing.

---

## 6. Open question for the user (Think Before Coding)

The exact OpenRouter **model ids** for the 4 ideation generators and the evaluators are not specified. The tests assert shape + distinctness + temperature bounds, not specific ids, so implementation can proceed with placeholder-but-distinct ids — **but confirm the real model ids with the user before finalizing `romantasy-planning.json`** so the shipped pipeline points at models actually available on their account.
