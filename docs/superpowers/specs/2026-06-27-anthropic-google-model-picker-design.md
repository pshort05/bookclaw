# Live model picker for Anthropic (claude) & Google (gemini)

**Date:** 2026-06-27
**Status:** Approved

## Problem

The studio's `ModelPicker` (and the standalone Prompt Runner / Consistency pickers)
give a **searchable model list only for OpenRouter** — fed by a live catalog proxy
(`GET /api/models/openrouter`, 24h cache, fail-soft to free-text). For **Anthropic
(`claude`)** and **Google (`gemini`)** the exact-model field is **free-text only**:
the user must know and type a model id. There is no way to *select* a model for the
two first-party paid providers the user actually runs.

This also surfaced in the MODEL-GUIDE.md review: hardcoded model ids drift, so a
live catalog is preferable to a static list.

## Goal

Give `claude` and `gemini` the same searchable picker OpenRouter already has,
everywhere OpenRouter's picker appears, **plus** make the per-provider default
model editable on the Settings screen (today it is read-only).

## Decisions (locked)

- **Catalog source:** live API, like OpenRouter — but **7-day cache** (these
  catalogs change slowly) and **pre-seeded** with a small static list so the picker
  is populated on the first request and as the fail-soft fallback when no key is set
  or the fetch fails. Live fetch is the source of truth; the seed is only a floor.
- **Naming:** use the app's provider ids `claude` / `gemini` in routes and UI
  (consistent with `/api/models/openrouter`), not the vendor names anthropic/google.
  `claude` → Anthropic API, `gemini` → Google Generative Language API.
- **Scope:** the shared `ModelPicker` (pipeline-step + skill-phase editors), the
  Prompt Runner, the Consistency screen, **and** the Settings default-model fields.

## Contract

Two new endpoints, mirroring the OpenRouter route's response shape:

```
GET /api/models/claude   -> { models: ModelEntry[], cachedAt: number, stale?: boolean }
GET /api/models/gemini   -> { models: ModelEntry[], cachedAt: number, stale?: boolean }
ModelEntry = { id: string; name: string }
```

- Both **require a vault key** (`anthropic_api_key` / `gemini_api_key`). Unlike
  OpenRouter's public catalog, a missing key cannot fetch — the route returns the
  **pre-seeded list** (never a 5xx), so the datalist still works offline.
- 7-day in-memory cache, per provider, re-fetched on restart and after TTL.
- Fail-soft: a fetch error serves the last good cache if present, else the seed.

### Upstream endpoints

- **Anthropic:** `GET https://api.anthropic.com/v1/models`
  headers `x-api-key: <key>`, `anthropic-version: 2023-06-01`.
  Response `{ data: [{ id, display_name, ... }], ... }`.
  `parseAnthropicModels` → `{ id, name: display_name || id }`, sorted by id.
- **Google:** `GET https://generativelanguage.googleapis.com/v1beta/models?key=<key>`
  Response `{ models: [{ name: "models/gemini-2.5-flash", displayName,
  supportedGenerationMethods: [...] }] }`.
  `parseGoogleModels` → keep only entries whose `supportedGenerationMethods`
  includes `generateContent`; strip the `models/` prefix from `name` to form `id`;
  `name: displayName || id`; sorted by id.

### Seed lists (fallback floor only)

Small, conservative — the live fetch supersedes them when a key is present:

- claude: `claude-sonnet-4-5-20250929`, `claude-opus-4-1`, `claude-haiku-4-5`
- gemini: `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.0-flash`

(Seed values are a usability floor, not an authority. If a seed id is wrong the
live catalog corrects it the moment a key is configured; the seed only governs the
no-key / fetch-failed path.)

## Implementation

### 1. Backend — `gateway/src/api/routes/models.routes.ts`

Generalize the single module-level `cache` into a per-provider cache map. Add a
small internal table describing each catalog (url, header builder, vault key,
parser, seed). Keep `parseOpenRouterModels` and `/api/models/openrouter`
behaviour byte-for-byte (24h TTL, public, no seed). Add `parseAnthropicModels`,
`parseGoogleModels` (pure, exported for unit tests) and the two routes with a
7-day TTL and seed fallback.

### 2. Backend — `gateway/src/api/routes/settings.routes.ts`

- Add `ai.claude.model`, `ai.gemini.model` to the `/api/config/update` `safePaths`
  allowlist.
- After `setAndPersist`, if `path` matches `^ai\.(claude|gemini|openai|deepseek|gemini)\.model$`
  (any provider default-model path), call `await services.aiRouter.reinitialize()`
  so the new default rebuilds the provider without a restart.

### 3. Frontend — shared hook

Rename `frontend/studio/src/lib/openrouterModels.ts`'s `useOpenRouterModels` →
`useModelCatalog(provider)`. Keep the module-level singleton, but key it
**per provider** (a `Map<provider, Promise>`); fetch `/api/models/${provider}`
for `provider ∈ {openrouter, claude, gemini}`, else return `[]`. Fail-soft:
empty list on error. Update the existing import sites.

### 4. Frontend — pickers

`ModelPicker.tsx`, `PromptRunner.tsx`, `Consistency.tsx`: replace the
`provider === 'openrouter'` datalist gate with a shared
`CATALOG_PROVIDERS = new Set(['openrouter','claude','gemini'])` membership test,
and feed the datalist from `useModelCatalog(provider)`. Other providers stay
free-text. `ModelPicker` already gives each instance a `useId()` datalist id;
the two standalone pickers keep their existing static datalist ids.

### 5. Frontend — Settings

`Settings.tsx`: render the `claude` and `gemini` provider rows with an editable
datalist-backed input (placeholder = current `p.model`) that POSTs
`{ path: 'ai.<provider>.model', value }` to `/api/config/update` and refreshes
the provider list. Other providers keep the read-only chip.

## Testing

- **Unit (network-free):** `tests/unit/models-anthropic-parse.test.ts`,
  `tests/unit/models-google-parse.test.ts` mirroring
  `tests/unit/models-openrouter-parse.test.ts` — id/display mapping, sort, the
  Gemini `generateContent` filter + `models/` strip, and empty/garbage input.
- **Smoke:** extend `tests/smoke-test.sh` with a phase asserting
  `GET /api/models/claude` and `/api/models/gemini` return `200` with a non-empty
  `models` array even with **no key configured** (seed fallback) and the entries
  have `{id,name}` shape. Auth still enforced (401 without token).

## Out of scope / follow-ups

- MODEL-GUIDE.md doc-accuracy corrections from the 2026-06-27 review (separate;
  done after this lands since routing wording changes).
- No MCP tool wrappers — the existing `/api/models/openrouter` route has none, so
  the two new routes stay UI-only (no `mcp/` lockstep obligation).

## Backward compatibility

- Existing steps/pipelines/skills with a typed `claude`/`gemini` model id are
  unaffected — the field is still free-text-capable; the datalist only *adds*
  suggestions.
- `/api/models/openrouter` is unchanged.
- A workspace with no `anthropic_api_key`/`gemini_api_key` degrades to the seed
  list, never an error.
