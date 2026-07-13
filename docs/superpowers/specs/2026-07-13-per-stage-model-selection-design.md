# Per-Stage Model Selection for the Novel Pipeline — Design

**Date:** 2026-07-13
**Owner ask:** first-chapter output was garbage because the pipeline ran entirely on
a 4B model (Neptune has only `ollama gemma3:4b` + `openrouter google/gemma-3-4b-it`).
The author wants to (a) default the whole pipeline to the newest Sonnet, and
(b) pin/override the model per pipeline stage — including changing the model for the
*current* stage from the "Books, in flight" board **before** the step executes.

## Problem

- `novel-pipeline` is **dynamic** (0 static steps; chapters generated in code), so the
  existing per-step `ModelPicker` (which edits a static step array) can't reach it.
- Routing precedence today (`stepRouting` in `gateway/src/api/routes/_shared.ts`):
  `step.modelOverride` → book `preferredProvider`/`preferredModel` → casting-sheet/tier.
- `preferredModel` is settable only at **book create** (no update endpoint).
- OpenRouter has **no unversioned Sonnet alias** — only `anthropic/claude-sonnet-{4,4.5,4.6,5}`.
  A pinned slug goes stale as new Sonnets ship (owner: "if we pin it, it will become
  stale quickly").

## Goals

1. Book-wide **default = newest Sonnet**, resolved dynamically (never a frozen slug).
2. **Per-stage** model override (Outline, Book Bible, Chapter drafting, Revision/Polish,
   Consistency, Format), keyed by routing `taskType`.
3. Change the model for the **current/next stage before it runs**, from the Board.
4. Fully backward-compatible: unset = today's behavior exactly.

## Design

### 1. Dynamic "newest Sonnet" resolver
- A sentinel model value `auto:newest-sonnet` (provider `openrouter`).
- `resolveModelPin({provider, model})`: when `model === 'auto:newest-sonnet'`, return the
  highest-version `anthropic/claude-sonnet-*` from the **already-cached** OpenRouter
  catalog (`models.routes.ts` fetcher, 24h TTL). Version compare = numeric on the suffix
  (`5` > `4.6` > `4.5` > `4`). Fail-soft: if the catalog is unavailable, fall back to a
  conservative floor slug (`anthropic/claude-sonnet-4.5`) and log a notice.
- Resolution happens at **completion time** (in the router or the step-routing seam), so
  the default tracks the newest Sonnet with no redeploy.

### 2. Per-stage model map (data + precedence)
- Add to the book manifest + project: `stageModels?: Record<string /*taskType*/, {provider: string; model: string}>`
  and keep `preferredProvider`/`preferredModel` as the book-wide **default** (default
  seed: `{openrouter, auto:newest-sonnet}`).
- New precedence in `stepRouting`:
  `step.modelOverride` → `stageModels[step.taskType]` → book default → casting/tier.
- Stages surfaced in UI (label → taskType): Outline→`outline`, Book Bible→`book_bible`,
  Chapter drafting→`creative_writing`, Revision/Polish→`revision`, Consistency→`consistency`,
  Format→`format`/`general`. Unlisted taskTypes inherit the default.

### 3. Endpoints
- `POST /api/books/:slug/models` — set `{ default?: {provider,model}, stageModels?: {...},
  clearStages?: string[] }` on an existing book (fills the update gap). Persists to the
  manifest via the atomic write path; also updates the live frontier project so a running
  book picks it up.
- Reuse existing `POST /api/projects/:id/steps/:stepId/model` (`setStepModelOverride`) for
  a one-off per-step override from the Board.
- `GET /api/books/:slug/models` — return the current default + stageModels (for the panels).

### 4. UI
- **Book "Models" panel** (book settings/asset area): one `ModelPicker` for the default
  (pre-filled "Newest Sonnet (auto)") + one per stage. Saves via `POST /api/books/:slug/models`.
- **Board "Books, in flight"** (`Board.tsx`): on each in-flight card (or its expanded
  view) show the current/next stage with an inline `ModelPicker` that sets that stage's
  model (via `POST /api/books/:slug/models`) or the specific next step's override — applied
  **before** the step executes. Shows the effective resolved model.

## Testing
- Unit: `resolveModelPin` (newest-sonnet selection incl. `5 > 4.6`, fail-soft floor);
  `stepRouting` precedence (stageModels beats default, step override beats stage).
- Endpoint: set/get models on a book; verify persistence + live-project propagation.
- Manual on Mercury: set drafting→a strong model, run a chapter, confirm the activity log
  shows the pinned model; change a stage from the Board before it runs.

## Immediate unblock (independent of this feature)
Set Neptune's OpenRouter default model `gemma-3-4b` → newest Sonnet so the current book can
regenerate now. Options: (a) one config change to `ai.openrouter.model` (blunt — all
openrouter tasks use Sonnet until the feature lands), or (b) wait for the feature and set
the book default. Owner to choose.

## Out of scope (follow-ons)
- Global (all-books) default model preference (this spec is per-book + the immediate
  config unblock).
- Per-stage temperature (modelOverride already carries temperature; not surfaced here).
- Cost preview per stage.
