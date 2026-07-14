# Write-rail per-step model selection (with OpenRouter secondary picker)

Date: 2026-07-13
Status: implemented

## Goal

On the Write workspace's pipeline rail (right pane), let the author choose the
AI provider **and** the exact model **for each step** of the running pipeline.
When the provider is **OpenRouter**, a secondary selector lists the specific
OpenRouter model to call.

## What already existed (commit bcc41a4)

Almost the entire capability was shipped by the per-stage model-selection
feature and only needed surfacing on this screen:

- **Backend, done:** `POST /api/projects/:id/steps/:stepId/model` accepts
  `{ provider, model }`, validates the provider + model id, and clears the
  override on a blank provider (`ProjectEngine.setStepModelOverride`, works on
  any step by id, not just the active one). `GET /api/models/:provider` proxies
  and caches the OpenRouter / Claude / Gemini model catalogs (fail-soft to a
  seed list / empty).
- **Shared UI, done:** `ModelPicker` renders a provider `<select>` plus — when
  the provider is a catalog provider (openrouter/claude/gemini) — a real model
  dropdown sourced from `useModelCatalog(provider)` (i.e. the OpenRouter
  secondary picker). Already used by the Prompt Runner, Consistency, the
  Skill/Pipeline editors, and `BookModelsPanel`.
- **Data model, done:** `ProjectStep.modelOverride?: { provider; model? }`.

## The gap this change closes

`PipelineRail.tsx` did **not** use `ModelPicker`. It rendered its own bare
provider-only `<select>` that (a) posted only `{ provider }` — no model, so no
OpenRouter model selection on this screen — and (b) appeared only on the single
**active** step. So the screenshot's rail could pick "openrouter" but never the
specific LLM, and only for one step.

## Design decisions (owner unavailable — judgment calls)

1. **"At each step"** → the picker is available on every **not-completed** step
   (active + queued). A completed step already ran, so an override is moot;
   completed steps keep their static model chip only. To keep a long (40-step)
   rail readable, the picker is a **click-to-edit disclosure**: each editable
   step shows its current provider/model as a chip; clicking it opens the
   `ModelPicker` inline for that step (one open at a time).
2. **"Secondary screen for OpenRouter"** → reuse the existing shared
   `ModelPicker`, whose OpenRouter branch already shows the secondary model
   dropdown from the live catalog. This is the app-wide established pattern, so
   it is interpreted as the secondary *selector* rather than a bespoke new
   modal/route — Simplicity First and UI consistency.
3. **Persistence** mirrors `BookModelsPanel`: `ModelPicker.onChange` →
   `POST /steps/:stepId/model` with `{ provider, model }` (blank provider
   clears). No temperature control here (`hideTemperature`), matching the
   per-stage panel.

## Verification

- **TDD contract:** `tests/write-rail-step-model-smoke.sh` boots the gateway
  and drives the exact endpoint the rail calls end-to-end over HTTP:
  provider-only pin, OpenRouter provider + specific model pin (the secondary
  selection), GET round-trip on the project step, clear, and 400s for an
  invalid provider / model id.
- No React test runner exists in the repo (no vitest); the UI wiring is verified
  by `tsc -b` + `vite build` (studio) + the smoke contract above, per the repo's
  smoke-test convention.

## Code review outcome (2026-07-13)

Independent review of the `PipelineRail.tsx` + CSS diff returned **no
Critical / High / Medium findings** — the goal's fix threshold (Medium+) was not
tripped, so no code changes followed. Three Low, all judged harmless for the
single-user LAN tool and left as documented behaviour:

- L1: if a step completes while its picker is open, the editor collapses to the
  read-only chip and `editingStepId` goes stale (matches nothing else — benign).
- L2: the 3s project poll can briefly snap a picker back to the pre-edit value
  before `setStepModel`'s own refresh reconciles (no data loss).
- L3: in a static pipeline with duplicate step labels, two plan rows can map to
  the same project step id, so both would show the editor open at once (writes
  still go to the one real step) — pre-existing matching logic, only surfaced.

Note: `currentStep` in `PipelineRail.tsx` is pre-existing dead code (unused
before and after this change); left untouched per the surgical-changes rule.

## Touched files

- `frontend/studio/src/components/write/PipelineRail.tsx` — use `ModelPicker`
  per not-completed step behind a click-to-edit disclosure; `setStepModel` now
  posts `{ provider, model }`; show the pinned model in the step meta.
- `frontend/studio/src/routes/Write.module.css` — minimal styles for the
  per-step model chip / editor row.
- `tests/write-rail-step-model-smoke.sh` — new contract smoke test.
