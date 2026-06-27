# Per-step Model & Temperature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authors choose a model + temperature per step from the studio, for both pipeline steps and skill phases, via one shared picker.

**Architecture:** A shared presentational `<ModelPicker>` (provider select + exact-model datalist + temperature) drives both editors. Pipelines persist to the existing `step.modelOverride` (backend already honors it); skills gain a per-phase `provider` and the executor stops forcing OpenRouter. The AI router already resolves a default model per provider when none is given, so `model` is optional everywhere.

**Tech Stack:** TypeScript (NodeNext, `.js` import specifiers), Node 22+ via `tsx`, React (Vite studio), `node:test` unit tests.

## Global Constraints

- Node 22+, imports use `.js` extensions even in `.ts` (NodeNext). Match existing style.
- No per-step `git commit` in this repo — the maintainer commits via `commit_message` + `./push.sh`. "Commit" steps below are replaced by a **verify gate** (type-check + run the test). Do not run `git commit`.
- Fail-soft init pattern preserved; no new required dependencies.
- Backward compatibility is mandatory: existing `steps.json` (model only, no provider) and existing pipelines (no `modelOverride`) must behave exactly as before.
- Provider list source of truth: `frontend/studio/src/lib/providers.ts` (`AI_PROVIDERS`, `PROVIDER_DEFAULT_MODEL`). OpenRouter catalog via `useOpenRouterModels` (`frontend/studio/src/lib/openrouterModels.ts`).

---

### Task 1: `parseSteps` accepts `provider`, makes `model` optional

**Files:**
- Modify: `gateway/src/skills/loader.ts` (`SkillStep` interface ~14-19, `parseSteps` ~36-54)
- Test: `tests/unit/skill-steps-loader.test.ts`

**Interfaces:**
- Produces: `SkillStep { name?: string; provider?: string; model?: string; temperature?: number; prompt: string }`. `parseSteps(raw: string): { steps: SkillStep[]; retries: number } | null` — a phase is valid iff `prompt` is a non-empty string; `provider`/`model` are optional strings kept when present.

- [ ] **Step 1: Update the existing `no-model` expectation and add provider cases**

In `tests/unit/skill-steps-loader.test.ts`, the `invalid steps.json → passive` test currently asserts a `no-model` phase is passive. `model` is now optional, so replace that assertion and add provider coverage. Change the `invalid steps.json → passive + no throw` test body to:

```ts
test('invalid steps.json → passive + no throw', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-ss-'));
  try {
    writeSkill(join(root, 'skills'), 'author', 'bad-json', '{not json');
    writeSkill(join(root, 'skills'), 'author', 'no-steps', { retries: 1, steps: [] });
    writeSkill(join(root, 'skills'), 'author', 'no-prompt', { steps: [{ model: 'm' }] });
    const l = await load(root);
    assert.equal(l.getSkillByName('bad-json')?.steps, undefined);
    assert.equal(l.getSkillByName('no-steps')?.steps, undefined);
    assert.equal(l.getSkillByName('no-prompt')?.steps, undefined); // prompt still required
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('provider is captured; model optional (defaults handled at runtime)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-ss-'));
  try {
    writeSkill(join(root, 'skills'), 'author', 'multi', {
      steps: [
        { provider: 'claude', prompt: 'a {{input}}' },                 // no model — valid now
        { provider: 'openrouter', model: 'google/gemini-2.0-flash-001', prompt: 'b {{previous}}' },
      ],
    });
    const s = (await load(root)).getSkillByName('multi');
    assert.equal(s?.steps?.length, 2);
    assert.equal(s?.steps?.[0].provider, 'claude');
    assert.equal(s?.steps?.[0].model, undefined);
    assert.equal(s?.steps?.[1].provider, 'openrouter');
    assert.equal(s?.steps?.[1].model, 'google/gemini-2.0-flash-001');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the tests — expect FAIL**

Run: `node --import tsx --test tests/unit/skill-steps-loader.test.ts`
Expected: FAIL — `no-prompt` still passes but the new `provider` test fails (`provider` is `undefined`, and the model-only phase `{model:'m'}` with no prompt is fine; the `{provider:'claude'}` no-model phase is currently rejected → steps undefined).

- [ ] **Step 3: Update `SkillStep` and `parseSteps`**

In `gateway/src/skills/loader.ts`, change the interface:

```ts
/** One phase of an executable (multi-step) skill — its own provider + model + settings. */
export interface SkillStep {
  name?: string;
  provider?: string;      // one of AI_PROVIDERS; absent → 'openrouter' at run time
  model?: string;         // provider model id; absent → provider default (router resolves)
  temperature?: number;
  prompt: string;         // template: {{input}} {{previous}} {{guidance}}
}
```

Replace the per-phase validation/build loop in `parseSteps`:

```ts
  for (const s of p.steps as unknown[]) {
    const st = s as { name?: unknown; provider?: unknown; model?: unknown; temperature?: unknown; prompt?: unknown };
    if (typeof st.prompt !== 'string' || !st.prompt.trim()) return null; // prompt is the only required field
    steps.push({
      ...(typeof st.name === 'string' ? { name: st.name } : {}),
      ...(typeof st.provider === 'string' && st.provider.trim() ? { provider: st.provider } : {}),
      ...(typeof st.model === 'string' && st.model.trim() ? { model: st.model } : {}),
      ...(typeof st.temperature === 'number' ? { temperature: st.temperature } : {}),
      prompt: st.prompt,
    });
  }
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `node --import tsx --test tests/unit/skill-steps-loader.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Verify gate**

Run: `npx tsc --noEmit` → exit 0.

---

### Task 2: `skill-runner` honors `step.provider` + per-provider cost attribution

**Files:**
- Modify: `gateway/src/services/skill-runner.ts` (`run` ~100-118 `provider:` line; cost wrapper ~55)
- Test: `tests/unit/skill-runner.test.ts`

**Interfaces:**
- Consumes: `SkillStep.provider` (Task 1).
- Produces: each phase calls `complete({ provider: step.provider ?? 'openrouter', model: step.model, temperature?, ... })`. Cost recorded under `req.provider`.

- [ ] **Step 1: Add a failing test for per-step provider**

Append to `tests/unit/skill-runner.test.ts`:

```ts
test('routes each phase to its own provider, defaulting to openrouter', async () => {
  const { runner, calls } = harness((_req, n) => ({ text: n === 1 ? 'A' : 'B' }));
  const skill = {
    name: 'mp', retries: 0,
    steps: [
      { provider: 'claude', model: 'claude-sonnet-4-5', prompt: 'x {{input}}' },
      { prompt: 'y {{previous}}' }, // no provider, no model → openrouter default
    ],
  };
  const out = await runner.run(skill, 'T', '');
  assert.equal(out, 'B');
  assert.equal(calls[0].provider, 'claude');
  assert.equal(calls[0].model, 'claude-sonnet-4-5');
  assert.equal(calls[1].provider, 'openrouter'); // default
  assert.equal(calls[1].model, undefined);        // router resolves the provider default
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --import tsx --test tests/unit/skill-runner.test.ts`
Expected: FAIL — `calls[0].provider` is `'openrouter'` (currently forced), not `'claude'`.

- [ ] **Step 3: Honor `step.provider` in `run`**

In `gateway/src/services/skill-runner.ts`, inside `run`'s phase loop, change the `complete({...})` call's provider line from `provider: 'openrouter',` to:

```ts
            provider: step.provider ?? 'openrouter',  // multi-provider; default preserves legacy OpenRouter-only skills
```

And update the cost-attribution wrapper in `runExecutableSkillStep` (the `complete` closure) from `deps.costs?.record('openrouter', ...)` to record under the actual provider:

```ts
  const complete: SkillCompleteFn = async (req) => {
    const res = await deps.aiRouter.complete(req);
    try { deps.costs?.record(req.provider, res.tokensUsed ?? 0, res.estimatedCost, bookSlug); } catch { /* non-fatal */ }
    return res;
  };
```

Also update the file header comment line "Every call is forced to OpenRouter." → "Each phase routes to its own provider (default OpenRouter)."

- [ ] **Step 4: Run — expect PASS**

Run: `node --import tsx --test tests/unit/skill-runner.test.ts`
Expected: PASS (new test + all existing — the legacy tests use steps without `provider`, so they still see `provider: 'openrouter'`).

- [ ] **Step 5: Verify gate**

Run: `npx tsc --noEmit` → exit 0.

---

### Task 3: Relax pipeline `modelOverride.provider` to optional + round-trip test

**Files:**
- Modify: `gateway/src/services/library-types.ts` (`LibraryPipelineStep.modelOverride` ~24)
- Test: `tests/unit/library-write.test.ts`

**Interfaces:**
- Produces: `modelOverride?: { provider?: string; model?: string; temperature?: number }` — all fields independently optional. Consumers already read each field with optional chaining, so a temperature-only override is honored.

- [ ] **Step 1: Add a failing round-trip test**

Append to `tests/unit/library-write.test.ts`:

```ts
test('pipeline step modelOverride (incl. temperature-only) round-trips', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    const pipeline = {
      schemaVersion: 1, name: 'mp', label: 'MP', description: 'd',
      steps: [
        { label: 'A', taskType: 'creative_writing', promptTemplate: 'a', modelOverride: { provider: 'claude', model: 'claude-sonnet-4-5', temperature: 0.4 } },
        { label: 'B', taskType: 'creative_writing', promptTemplate: 'b', modelOverride: { temperature: 0.9 } }, // temp-only, no provider
      ],
    };
    await lib.createEntry('pipeline', 'mp', { content: JSON.stringify(pipeline) });
    await lib.reload();
    const steps = lib.get('pipeline', 'mp')!.pipeline!.steps as Array<{ modelOverride?: { provider?: string; model?: string; temperature?: number } }>;
    assert.equal(steps[0].modelOverride!.provider, 'claude');
    assert.equal(steps[0].modelOverride!.temperature, 0.4);
    assert.equal(steps[1].modelOverride!.provider, undefined);
    assert.equal(steps[1].modelOverride!.temperature, 0.9);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run — expect FAIL (type error)**

Run: `npx tsc --noEmit`
Expected: FAIL — `{ temperature: 0.9 }` is not assignable to `modelOverride` because `provider` is currently required.

- [ ] **Step 3: Relax the type**

In `gateway/src/services/library-types.ts`, change:

```ts
  modelOverride?: { provider?: string; model?: string; temperature?: number };
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx tsc --noEmit` → exit 0, then
`node --import tsx --test tests/unit/library-write.test.ts` → PASS.

- [ ] **Step 5: Verify gate** — both commands above green.

---

### Task 4: Add `modelOverride` to the shared frontend `LibraryPipelineStep`

**Files:**
- Modify: `frontend/shared/src/types.ts` (`LibraryPipelineStep` ~174-177)

**Interfaces:**
- Produces: `LibraryPipelineStep.modelOverride?: { provider?: string; model?: string; temperature?: number }` — consumed by `PipelineEditor` (Task 6).

- [ ] **Step 1: Add the field**

In `frontend/shared/src/types.ts`, update the interface:

```ts
export interface LibraryPipelineStep {
  label: string; skill?: string; toolSuggestion?: string; taskType: string;
  promptTemplate: string; phase?: string; wordCountTarget?: number; chapterNumber?: number;
  modelOverride?: { provider?: string; model?: string; temperature?: number };
}
```

- [ ] **Step 2: Verify gate**

Run: `cd frontend/shared && npx tsc --noEmit` → exit 0.

---

### Task 5: Shared `<ModelPicker>` component

**Files:**
- Create: `frontend/studio/src/components/asset/ModelPicker.tsx`

**Interfaces:**
- Produces: `ModelValue = { provider?: string; model?: string; temperature?: number }` and `function ModelPicker(props: { value: ModelValue; onChange: (v: ModelValue) => void; disabled?: boolean }): JSX.Element`. Emits a normalized value: empty provider/model strings become `undefined`; `temperature` `undefined` when blank.

- [ ] **Step 1: Write the component**

Create `frontend/studio/src/components/asset/ModelPicker.tsx`:

```tsx
import { useId } from 'react';
import { AI_PROVIDERS, PROVIDER_DEFAULT_MODEL } from '../../lib/providers.js';
import { useOpenRouterModels } from '../../lib/openrouterModels.js';

export interface ModelValue { provider?: string; model?: string; temperature?: number }

/**
 * Shared per-step model picker: provider select (blank = auto routing) + exact
 * model (OpenRouter catalog datalist when provider is openrouter, else free text)
 * + temperature. Used by the Pipeline step editor and the Skill phase editor.
 * Mirrors the Consistency/Prompt Runner picker pattern. Fully optional value.
 */
export function ModelPicker({ value, onChange, disabled }: { value: ModelValue; onChange: (v: ModelValue) => void; disabled?: boolean }) {
  const provider = value.provider ?? '';
  const models = useOpenRouterModels(provider);
  const listId = useId();

  const emit = (patch: Partial<ModelValue>) => {
    const next: ModelValue = { ...value, ...patch };
    // Normalize empties to undefined so a fully-auto step carries no override.
    if (!next.provider) { next.provider = undefined; next.model = undefined; }
    if (!next.model) next.model = undefined;
    if (next.temperature === undefined || Number.isNaN(next.temperature)) next.temperature = undefined;
    onChange(next);
  };

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={provider} disabled={disabled} onChange={(e) => emit({ provider: e.target.value, model: '' })}>
        <option value="">auto (by task)</option>
        {AI_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      {provider !== '' && (
        <>
          <input
            type="text"
            list={provider === 'openrouter' ? listId : undefined}
            value={value.model ?? ''}
            placeholder={PROVIDER_DEFAULT_MODEL[provider] ?? 'model id'}
            disabled={disabled}
            onChange={(e) => emit({ model: e.target.value })}
          />
          {provider === 'openrouter' && (
            <datalist id={listId}>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </datalist>
          )}
        </>
      )}
      <input
        type="number" step="0.1" min="0" max="2" placeholder="temp"
        style={{ width: 64 }}
        value={value.temperature ?? ''}
        disabled={disabled}
        onChange={(e) => emit({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })}
      />
    </span>
  );
}
```

- [ ] **Step 2: Verify gate**

Run: `cd frontend/studio && npx tsc --noEmit` → exit 0 (component compiles; unused until Tasks 6–7).

---

### Task 6: Wire `<ModelPicker>` into `PipelineEditor` step rows

**Files:**
- Modify: `frontend/studio/src/components/asset/PipelineEditor.tsx` (deferred-comment ~9-10; step row render; `blankStep` ~30)

**Interfaces:**
- Consumes: `ModelPicker`, `ModelValue` (Task 5); `LibraryPipelineStep.modelOverride` (Task 4).

- [ ] **Step 1: Import and render the picker per step**

Add the import near the other imports:

```tsx
import { ModelPicker, type ModelValue } from './ModelPicker.js';
```

Remove the deferred note (the two-line comment at ~9-10 stating per-step override is deferred).

In the step-row JSX (where `taskType` is edited, around line 51), add a labelled picker bound to the step's `modelOverride`. Insert after the `taskType` input's row:

```tsx
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ minWidth: 70 }}>Model</span>
          <ModelPicker
            value={(step.modelOverride ?? {}) as ModelValue}
            onChange={(v) => onPatch({ modelOverride: (v.provider || v.model || v.temperature !== undefined) ? v : undefined })}
          />
        </label>
```

(`onPatch` is the existing per-step patch callback used by the `taskType` input. If the step patch helper is named differently in this file, use that name — it is the same handler the adjacent `taskType` `onChange` calls.)

- [ ] **Step 2: Keep `blankStep` override-free**

Confirm `blankStep` (~30) does **not** set `modelOverride` (auto by default). No change needed unless it does.

- [ ] **Step 3: Verify gate**

Run: `cd frontend/studio && npx tsc --noEmit` → exit 0.
Manually confirm the serialized pipeline JSON includes `modelOverride` only when set (the editor already serializes the whole pipeline object on save; `modelOverride` is now a typed field so it is included).

---

### Task 7: Wire `<ModelPicker>` into `SkillEditor` phases

**Files:**
- Modify: `frontend/studio/src/components/asset/SkillEditor.tsx` (`Phase` ~7; `blankPhase` ~20; `phasesValid` ~60; `save` serialization ~67-72; the per-phase model/temp inputs ~117-118)

**Interfaces:**
- Consumes: `ModelPicker`, `ModelValue` (Task 5).

- [ ] **Step 1: Extend the `Phase` shape and validation**

Add the import:

```tsx
import { ModelPicker, type ModelValue } from './ModelPicker.js';
```

Change the `Phase` interface (~7) to carry an optional provider and make model optional:

```tsx
interface Phase { _id: string; name?: string; provider?: string; model?: string; temperature?: number; prompt: string }
```

Update `blankPhase` (~20):

```tsx
const blankPhase = (): Phase => ({ _id: newId(), prompt: '' });
```

Update `phasesValid` (~60) — prompt is now the only required field:

```tsx
  const phasesValid = phases.every((p) => p.prompt.trim());
```

- [ ] **Step 2: Update save serialization**

In `save` (~67), replace the per-phase mapping to include `provider`/optional `model`:

```tsx
      const steps = phases.map((p) => ({
        ...(p.name?.trim() ? { name: p.name.trim() } : {}),
        ...(p.provider ? { provider: p.provider } : {}),
        ...(p.model?.trim() ? { model: p.model.trim() } : {}),
        ...(typeof p.temperature === 'number' && !Number.isNaN(p.temperature) ? { temperature: p.temperature } : {}),
        prompt: p.prompt,
      }));
```

- [ ] **Step 3: Replace the raw model/temp inputs with the picker**

In the phase row (~116-118), replace the `pmodel` text input and the `ptemp` number input with a single `<ModelPicker>` (keep the `pname` input):

```tsx
            <input className={styles.pname} placeholder="name (optional)" value={p.name ?? ''} onChange={(e) => patchPhase(i, { name: e.target.value })} />
            <ModelPicker
              value={{ provider: p.provider, model: p.model, temperature: p.temperature } as ModelValue}
              onChange={(v) => patchPhase(i, { provider: v.provider, model: v.model, temperature: v.temperature })}
            />
```

(`patchPhase(i, patch)` is the existing per-phase updater used by the current inputs.)

- [ ] **Step 4: Load existing steps into the new shape**

Where the editor hydrates phases from a loaded skill's steps (the effect that maps loaded `steps` → `phases`), ensure it copies `provider` and `model` through. Find the mapping that currently sets `{ model, temperature, prompt, name }` and change it to also carry `provider` (and tolerate missing `model`):

```tsx
        provider: st.provider,
        model: st.model,
```

(Locate the existing `setPhases(...)`/steps-to-phases map in the load effect and add these two fields; leave the rest unchanged.)

- [ ] **Step 5: Verify gate**

Run: `cd frontend/studio && npx tsc --noEmit` → exit 0.

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Type-check all three projects**

Run:
```bash
npx tsc --noEmit                                   # gateway
( cd frontend/shared && npx tsc --noEmit )
( cd frontend/studio && npx tsc --noEmit )
```
Expected: all exit 0.

- [ ] **Step 2: Run the full unit suite (rebuilds frontend)**

Run: `node --import tsx --test tests/unit/*.test.ts`
Expected: pass count = previous total + new tests, 0 fail (re-run once if `world-propose.test.ts` flakes under load — known pre-existing).

- [ ] **Step 3: Build the frontend bundles**

Run: `npm run build:frontend`
Expected: studio + chat dists build with no type/build error.

---

## Self-Review

**Spec coverage:**
- Shared `<ModelPicker>` → Task 5. ✓
- Pipeline picker + shared type + `modelOverride.provider` optional → Tasks 3, 4, 6. ✓
- Skills multi-provider (`SkillStep.provider`, optional model, `parseSteps`, `skill-runner`, editor) → Tasks 1, 2, 7. ✓
- Sequences out of scope → no task. ✓
- Backward compatibility → covered by Task 1/2 legacy-still-parse + default-provider tests; Task 3 leaves no-override pipelines untouched. ✓
- Testing (parseSteps, skill-runner, pipeline round-trip) → Tasks 1, 2, 3; full verify Task 8. ✓

**Placeholder scan:** none — every code step shows the real code.

**Type consistency:** `ModelValue { provider?, model?, temperature? }` is used identically in Tasks 5, 6, 7. `SkillStep.provider?` (Task 1) is read in Task 2 and written by the editor in Task 7. `modelOverride?: { provider?, model?, temperature? }` matches across backend (Task 3) and shared frontend (Task 4).

## Notes / known limitations

- No React component-test harness exists; `ModelPicker`/editor wiring is verified by `tsc` + the full unit suite + `build:frontend` + manual studio check (per spec).
- The skill cost-attribution change (record under `req.provider`) is a correctness improvement that rides along with multi-provider; no dedicated test (cost recording is fire-and-forget/non-fatal).
