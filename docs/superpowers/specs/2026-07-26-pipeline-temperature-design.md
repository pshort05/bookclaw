# Per-book Creative / Surgical temperature control

**Date:** 2026-07-26
**Status:** Design approved; pending spec review → implementation plan.
**Owner ask:** Adjust LLM temperature in the pipeline — creative tasks ≥ 0.7, surgical tasks ≤ 0.4.

## Problem

Temperature already flows well for the main pipelines: the genre **casting sheets** carry per-role temperatures (`draft 1.0`, `scene_brief 0.8`, `humanize 0.4`, `editorial 0.3`, `continuity 0.2`), and per-step temperature is manually editable in the write screen and the pipeline/skill editors via `modelOverride.temperature`. The gaps:

- **No `taskType`/role → temperature classification anywhere.** A step with no casting-sheet role and no explicit pin (a **sheet-less genre**, an **untagged step**, or a role absent from the sheet) falls to the flat provider default `request.temperature ?? 0.7` (`router.ts`). A surgical pass (consistency/continuity) then runs at 0.7 — too hot.
- **No single, easy control** to set a book warmer/cooler by task category; per-step editing is the only lever.

## Design

A **per-book control with two temperature buckets** — **Creative** and **Surgical**. Each step is auto-classified into one bucket (by role, falling back to taskType) and uses that bucket's temperature. This encodes the owner's rule as an adjustable per-book knob and covers every step (including sheet-less/untagged) uniformly.

### Data model

- Book manifest gains `temperatures?: { creative?: number; surgical?: number }`. Defaults **creative 0.8 / surgical 0.3** (inside the ≥0.7 / ≤0.4 bands). Absent → today's behavior (casting sheet / 0.7). Values validated to `[0, 2]` (providers clamp to their own max, e.g. Claude 1.0).

### Classification — `temperatureBucket(role?, taskType) → 'creative' | 'surgical'`

New pure helper (`gateway/src/services/casting/temperature.ts`). Role decides when present; taskType is the fallback for untagged steps.

- **Creative** — roles `scene_brief, draft, intimacy, approach, improve, rewrite, outline, bible, marketing`; taskTypes `creative_writing, outline, book_bible, marketing, style_analysis`.
- **Surgical** — roles `humanize, editorial, analysis, continuity, format, research, plan`; taskTypes `consistency, revision, final_edit, research`.
- **Unknown** (role and taskType both unmatched, e.g. `general`) → **creative** (conversational default ~0.8).

### Precedence (in `castStep` / `stepRouting`)

```
explicit per-step modelOverride.temperature   (wins — a hand-set or baked per-step pin)
  > book bucket temperature                    (NEW — the Creative/Surgical knob)
  > casting-sheet role temperature             (overridden by the knob when set)
  > provider default 0.7
```

So the book knob **overrides the casting-sheet defaults** (the control actually shifts the main pipelines), **fills the flat-0.7 gap** for sheet-less/untagged steps, and **yields to an explicit per-step temperature** the user pins in the write screen.

**Why this composes cleanly (no pipeline edits):** in the per-author-models change (2026-07-26) the romance pipelines' *creative* steps (`scene_brief`/`draft`) lost their baked `modelOverride`, so the Creative knob reaches them directly. Their *surgical* steps keep baked `modelOverride.temperature` of `0.2–0.4` — already inside the surgical band, so a baked pin winning over the knob never violates the rule. Net: the knob works without touching any pipeline JSON.

### Seams

1. **`gateway/src/services/casting/temperature.ts`** (new) — `temperatureBucket(role, taskType)` + `resolveBucketTemperature(temps, role, taskType)` returning the chosen number or `undefined` when `temps` is absent.
2. **`castStep` (`cast-step.ts`)** — `CastInputs` gains `bucketTemperature?: number`. In the post-resolution temperature step (currently `if (typeof mo?.temperature === 'number') result.temperature = mo.temperature;`), insert the knob **below** the manual pin and **above** the source temp:
   ```
   if (typeof mo?.temperature === 'number') result.temperature = mo.temperature;
   else if (typeof bucketTemperature === 'number') result.temperature = bucketTemperature;
   ```
3. **`stepRouting` (`_shared.ts`)** — compute `bucketTemperature` from `project.temperatures` + `temperatureBucket(role, step.taskType)` and pass it to `castStep` (tagged path) and apply it in the untagged path too (untagged steps have a taskType, so they classify).
4. **`applyBookModelConfig` (`_shared.ts`)** — sync `project.temperatures = manifest.temperatures` (assign-not-merge), so a running project picks up a change on its next step.
5. **`BookManifest` (`book-types.ts`)** + **`BookService.setTemperatures(slug, temps)`** (`book.ts`, mirroring `setReviewCadence`; empty/absent clears).
6. **API** — `GET /api/books/:slug/models` returns `temperatures`; `POST` accepts + validates (`[0,2]`) + persists via `setTemperatures`. Re-applies to the live project via the existing `applyBookModelConfig` call.
7. **UI** — two number inputs in `BookModelsPanel` ("Creative" / "Surgical") bound to `temperatures`, with a hint (creative ≥0.7 / surgical ≤0.4). Persisted through the models POST.

## Testing

- **`temperatureBucket` (unit):** each listed role → correct bucket; untagged taskType → correct bucket; unknown → creative.
- **`castStep` (unit):** with `bucketTemperature` set, a step whose model came from the sheet gets the bucket temp (overrides sheet temp); an explicit `modelOverride.temperature` still wins; no bucket → sheet/tier temp unchanged.
- **`stepRouting` (unit):** a creative-role step on a book with `temperatures.creative` set resolves to it; a surgical step resolves to `temperatures.surgical`; a book without `temperatures` is unchanged (regression).
- **`BookService.setTemperatures` (unit):** sets/clears the manifest field; out-of-range rejected at the route.
- **`applyBookModelConfig` (unit):** syncs `temperatures` onto the project.

## Out of scope

- Per-role temperature granularity (the two buckets replace it at the book level; the casting sheet still provides per-role temps when the knob is unset).
- Any global/app-wide temperature default — this stays per-book.
- Stripping the surgical steps' baked `modelOverride.temperature` (unnecessary — they're already in-band).

## Decisions made (flag in review if you disagree)

- **Book knob overrides the casting sheet** but yields to an explicit per-step pin (so the control is effective on the main pipelines without disabling hand-tuning).
- **Unknown/`general` → creative** (0.8), not surgical — a neutral step reads as conversational.
- **Defaults 0.8 / 0.3**; validation band `[0, 2]`.
