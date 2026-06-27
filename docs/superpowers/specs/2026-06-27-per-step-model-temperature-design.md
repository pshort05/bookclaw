# Per-step model & temperature — design

**Date:** 2026-06-27
**Status:** Approved (design); pending implementation plan
**Scope:** Studio editors for pipelines and skills, plus a backend behavior change to skill execution.

## Problem

Authors cannot choose a model and temperature per step from the studio for **pipeline** steps, and the **skill** phase editor only accepts a raw OpenRouter model id (no provider choice, inconsistent UX). The request: per-step model + temperature for skills, sequences, and pipelines, via a consistent control.

Investigation reframed the work:

| Construct | Data model | Execution | Studio editor |
|---|---|---|---|
| **Skill** (`steps.json`) | `SkillStep { model, temperature? }` | `skill-runner.ts` honors per-step `model`/`temperature`, but **forces `provider: 'openrouter'`** | Raw model-id text input + temp (works, but OpenRouter-only and inconsistent) |
| **Pipeline** (`steps`) | `LibraryPipelineStep.modelOverride { provider, model?, temperature? }` | Fully wired — `_shared.ts` precedence: step override beats project-level; `parsePipelineJson` round-trips it verbatim | **Per-step model UI deliberately deferred** (`PipelineEditor` lines 9–10) |
| **Sequence** | Ordered list of pipeline **names** — no steps of its own | n/a | n/a — model choice lives in the referenced pipelines |

So **sequences are out of scope** (nothing to configure at that level), the **pipeline** gap is frontend-only (backend already stores + honors `modelOverride`), and the **skill** rework is a small backend change (multi-provider execution) plus an editor swap.

## Goals

1. One shared studio control for choosing `{ provider?, model?, temperature? }`, reused by the pipeline-step and skill-phase editors.
2. Pipeline steps gain that control, persisting to the existing `modelOverride` field. No pipeline execution change.
3. Skills become multi-provider: a per-phase provider is honored at execution, defaulting to OpenRouter for backward compatibility.

## Non-goals

- No sequence-level model override (sequences have no steps of their own).
- No new model-list/proxy endpoints — reuse `/api/models/openrouter` and `useOpenRouterModels`.
- No React component-test harness (none exists); picker UI verified by `tsc` + the existing unit suite + manual check.

## Design

### Shared `<ModelPicker>` component

A pure presentational control over a value `{ provider?: string; model?: string; temperature?: number }`, emitting changes via `onChange`. Reuses existing studio assets:

- `frontend/studio/src/lib/providers.ts` — `AI_PROVIDERS` (gemini, deepseek, claude, openai, ollama, openrouter) and `PROVIDER_DEFAULT_MODEL`.
- `frontend/studio/src/lib/openrouterModels.ts` — `useOpenRouterModels(provider)` hook (lazy-loads the OpenRouter catalog; fail-soft to free text).

Layout mirrors the Consistency/Prompt Runner pattern:

```
[ provider ▾ ]           [ exact model ]                         [ temp # ]
  "" = default(auto)       datalist of OpenRouter models when      0–2 step 0.1
  + AI_PROVIDERS           provider === 'openrouter', else free     (optional)
                           text; placeholder = PROVIDER_DEFAULT_MODEL[provider]
```

Behaviour:
- Provider `""` ("default / auto") means **no override**: the exact-model field is hidden; the emitted value carries no provider/model. Temperature may still be set independently.
- The exact-model field shows only when a provider is selected. It is free text with an `openrouter-models` datalist when provider is `openrouter`.
- Temperature is an optional number input (0–2, step 0.1), independent of provider/model.

Location: `frontend/studio/src/components/asset/ModelPicker.tsx`. The provider option list and the shared `<datalist id="openrouter-models">` follow the existing Consistency usage.

### Pipeline wiring

Backend: **no execution change.** One type relaxation in `gateway/src/services/library-types.ts`:

```ts
// before
modelOverride?: { provider: string; model?: string; temperature?: number };
// after
modelOverride?: { provider?: string; model?: string; temperature?: number };
```

All consumers already read each field defensively (`_shared.ts` uses optional chaining per field; `projects.ts`/`index.ts` likewise), so relaxing `provider` to optional is safe and enables a temperature-only override (keep auto model routing, change temp).

Frontend:
- Add `modelOverride?: { provider?: string; model?: string; temperature?: number }` to the shared `LibraryPipelineStep` type in `frontend/shared/src/types.ts` (it is currently missing, which is why the editor can't set it).
- In `PipelineEditor`, render `<ModelPicker>` in each step row, bound to `step.modelOverride`. Map the picker value to `modelOverride`: when the picker is fully "auto" (no provider, no model, no temp), set `modelOverride` to `undefined` so the step JSON stays clean and routing falls through to `taskType`→tier as today. Remove the "deferred" comment (lines 9–10).
- `modelOverride` persists automatically: `parsePipelineJson` passes the whole object through and writes are verbatim.

### Skills wiring

Schema — `gateway/src/skills/loader.ts`:
- `SkillStep` gains `provider?: string`; `model` becomes optional (`model?: string`).
- `parseSteps` accepts and validates `provider` (string when present). A phase remains valid when it has a non-empty `prompt`; `model` is no longer mandatory at parse time (a phase with neither provider nor model resolves to the OpenRouter default at run time). Existing `steps.json` files (model only, no provider) parse unchanged.

Executor — `gateway/src/services/skill-runner.ts`:
- Replace the hard-coded `provider: 'openrouter'` with `provider: step.provider ?? 'openrouter'`.
- Pass `model: step.model` when present; when omitted, let the router resolve the provider's default model (same fallback the rest of the router uses). Temperature unchanged.

Editor — `frontend/studio/src/components/asset/SkillEditor.tsx`:
- Replace the raw model-id text input (and keep the temperature input behaviour) with `<ModelPicker>` per phase, bound to `{ provider, model, temperature }`.
- Phase validity becomes: non-empty `prompt` (model no longer strictly required, mirroring the backend). The "Save" serialization writes `provider`/`model`/`temperature` onto each step, omitting empty fields (same normalization style already used for temperature).

### Validation & defaults (summary)

- "Set" vs "auto": a value is an override when any of provider/model/temperature is chosen; empty across all three = auto.
- Skills default `provider` to `openrouter` at execution when unset (preserves current behaviour); model optional → provider default used; `prompt` required.
- Pipelines: `modelOverride` omitted entirely when fully auto; otherwise any subset of `{provider, model, temperature}`.

## Backward compatibility

- Existing executable skills (`steps.json` with `model` only) parse and run identically — provider defaults to `openrouter`, model is the existing id.
- Existing pipelines without `modelOverride` are unaffected (auto routing).
- Library export/import (`library-transfer`) copies `steps.json`/`pipeline.json` verbatim, so the new optional fields travel without transfer-layer changes.

## Testing

TDD where logic changes:
- `tests/unit` — `parseSteps`: accepts `provider`; omitting `model` is valid; legacy (model-only) steps still parse; round-trips fields.
- `tests/unit` — `skill-runner`: with a mocked `complete`, asserts the call receives `step.provider` (and `'openrouter'` when unset) and `step.model`.
- `tests/unit` — pipeline `modelOverride` survives a write→reload round-trip via `LibraryService` (extends `library-write.test.ts`).
- Type/build: `tsc` for gateway, shared, studio; full `npm run test:unit`; `build:frontend` compiles.
- Picker UI: no component-test harness — verified by `tsc` and manual studio check. Noted as a known limitation.

## Files touched (anticipated)

- `gateway/src/services/library-types.ts` — relax `modelOverride.provider` to optional.
- `gateway/src/skills/loader.ts` — `SkillStep.provider`, optional `model`, `parseSteps`.
- `gateway/src/services/skill-runner.ts` — honor `step.provider`.
- `frontend/shared/src/types.ts` — `LibraryPipelineStep.modelOverride`.
- `frontend/studio/src/components/asset/ModelPicker.tsx` — new shared component.
- `frontend/studio/src/components/asset/PipelineEditor.tsx` — per-step picker.
- `frontend/studio/src/components/asset/SkillEditor.tsx` — per-phase picker.
- Tests under `tests/unit/`.

## Open questions

None outstanding. Approved decisions: (a) relax pipeline `modelOverride.provider` to optional; (b) skills default to `openrouter` when no provider set.
