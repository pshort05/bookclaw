# Consistency Audit — Model Selection Design

**Date:** 2026-06-25
**Status:** Approved
**TODO ref:** Consistency engine production issues #6 — "Select the model for the audit"

## Goal

Let the user choose which AI **provider and exact model** runs the consistency
audit's fact extraction, instead of the hard-coded `select('consistency')` tier
default. The choice is **persisted per book** and **overridable per run**.

## Background

The consistency auditor extracts structured facts from each chapter (plus a
canon seed) via an LLM, then deterministically compares them. The extractor
hard-codes the provider:

- `gateway/src/services/consistency/extractor.ts:220` — `const provider = deps.ai.select('consistency');`
- `extractChapterFacts` is driven by the `extract` wrapper in
  `gateway/src/index.ts:1343`, which builds `deps.ai = { complete, select: (t) => aiRouter.selectProvider(t) }`.
- The router already supports the needed primitives:
  `selectProvider(taskType, preferredId?)` (`router.ts:333`) and
  `complete({ provider, model, ... })` (`router.ts:57`).

The `consistency` task maps to the `mid` tier → preference
`['gemini','deepseek','openrouter','claude','openai','ollama']` (so
Gemini-Flash is already the default first pick), reasoning `high`, 8192 output
budget. There is currently no way to pin a provider/model for a run.

An existing per-step override mechanism already uses the shape
`{ provider, model?, temperature? }` (`projects.ts` `modelOverride`,
`PipelineRail.tsx`). This design **reuses the `{ provider, model? }` shape** —
it does not introduce a new override mechanism.

## Design

### 1. Persistence — `BookManifest`

Add an additive-optional field to `BookManifest`
(`gateway/src/services/book-types.ts`), mirroring the existing optional
`format?` field — **no `schemaVersion` bump** (it is purely additive and
older/newer readers ignore it):

```ts
consistency?: { provider?: string; model?: string };
```

Stored in the book's `book.json`. A stateless `BookService` setter writes it,
mirroring `setFormat`:

```ts
async setConsistencyModel(slug: string, sel: { provider?: string; model?: string }): Promise<void>
```

An empty/cleared selection removes the field (writes `undefined`), so "default
(auto)" is represented by absence, not by a stored empty object.

### 2. Resolution — one place, one helper

A single pure helper computes the effective selection, so the precedence lives
in exactly one testable place:

```ts
// gateway/src/services/consistency/model-selection.ts
export const CONSISTENCY_PROVIDERS = ['gemini','deepseek','claude','openai','ollama','openrouter'] as const;

export function resolveConsistencyModel(
  perRun: { provider?: string; model?: string } | undefined,
  perBook: { provider?: string; model?: string } | undefined,
): { provider?: string; model?: string } {
  const pick = perRun ?? perBook ?? {};
  const provider = CONSISTENCY_PROVIDERS.includes(pick.provider as any) ? pick.provider : undefined;
  const model = provider && typeof pick.model === 'string' && pick.model.trim() ? pick.model.trim() : undefined;
  return { provider, model };
}
```

Precedence: **per-run body → per-book `book.json` → auto** (tier default). An
unknown/invalid provider falls back to auto (`provider: undefined`). A `model`
is honored only when a valid `provider` is present (a model without a provider
is meaningless to the router). Resolution happens **once per audit**, not
per-chapter.

### 3. Plumbing the override into extraction

- `consistencyAudit(slug, onProgress?, override?)` (the wrapper in `index.ts`)
  gains an optional `override?: { provider?: string; model?: string }`. It
  resolves the effective selection once (per-run override falls back to the
  book manifest read at audit start) and threads it into the `extract` dep.
- The `extract` dep closes over the resolved selection and calls
  `aiRouter.selectProvider('consistency', sel.provider)` and
  `aiRouter.complete({ provider, model: sel.model, ... })`.
- `extractChapterFacts` (`extractor.ts`) gains an optional last parameter
  `override?: { provider?: string; model?: string }`. It uses
  `deps.ai.select('consistency', override?.provider)` (the `select` dep gains
  the optional `preferredId` the router already supports) and passes
  `model: override?.model` into `deps.ai.complete(...)`.
- Both extraction paths (per-chapter **and** canon seed) receive the same
  resolved selection, so they never diverge.

`runConsistencyAudit` (`check-engine.ts`) forwards the override to every
`extract(...)` call it makes (it already receives `extract` via its deps; the
selection is baked into that closure by `index.ts`, so `check-engine.ts` needs
no signature change beyond passing through what it already has).

### 4. API

- **`PUT /api/books/:slug/consistency-model`** — body `{ provider?, model? }`.
  Validates `slug` (`SLUG_RE` + `books.exists`); calls
  `setConsistencyModel`. An empty body / `{}` clears the saved default.
  Returns `{ ok: true }`. Mounted in `consistency.routes.ts`.
- **`POST /api/books/:slug/consistency-audit`** — now reads optional
  `{ provider, model }` from the body and passes it as the per-run override to
  `consistencyAudit`. The body override is **for this run only**; it does
  **not** overwrite the saved per-book default. (This lets an API/MCP caller do
  a one-off run with a different model without disturbing the UI default.)
- **`GET /api/books/:slug/consistency-report`** — response gains
  `consistencyModel: { provider?, model? } | null` (read from the manifest) so
  the studio can rehydrate the picker.

### 5. UI — `Consistency.tsx`

A small control near the "Run audit" action:

- A **provider `<select>`** populated from `CONSISTENCY_PROVIDERS`, plus a
  leading `default (auto)` option (value `''`).
- An optional **model text input**, shown when a provider is selected, with a
  placeholder hint of that provider's default model (a static map mirroring
  `router.ts` defaults, e.g. `gemini → gemini-2.5-flash`,
  `claude → claude-sonnet-4-5-20250929`). Free-text — no model-list endpoint
  exists, and the user works in exact model strings.
- Changing either control **PUTs** the new selection to
  `/api/books/:slug/consistency-model` (persisting the per-book default).
- "Run audit" sends the current `{ provider, model }` in the POST body.
- On load, the picker is hydrated from `consistencyModel` in the
  `consistency-report` GET response.

### 6. MCP

`mcp/`'s `consistency_audit` tool is a generic passthrough over the POST
endpoint; the new optional body fields are additive. Add the optional
`provider`/`model` params to the tool's zod schema in the **same commit**
(per the lockstep rule), plus a thin `set_consistency_model` tool wrapping the
new PUT. No state lives in `mcp/`.

## Error handling (fail-soft, matching repo posture)

- Invalid/unknown provider → silently falls back to auto (never 400s the audit).
- A genuinely invalid model string surfaces only as a normal failed audit (the
  router errors per-provider), logged + emitted as `consistency-error` like any
  other audit failure — no special path.
- Persistence (PUT) or UI hydration failures never block running an audit.

## Testing

**Unit:**
- `resolveConsistencyModel` — precedence (per-run > per-book > auto), invalid
  provider → auto, model-without-provider dropped, whitespace model dropped.
- `extractChapterFacts` honors the override — a fake `deps.ai` records the
  `preferredId` passed to `select` and the `model` passed to `complete`.
- `setConsistencyModel` round-trip via `BookService` (write then read manifest;
  clearing removes the field).

**Smoke (`tests/consistency-smoke.sh`):**
- `PUT /consistency-model` saves a default; `GET /consistency-report` returns it
  (round-trip).
- Run an audit with an explicit `{ provider, model }` body and assert it
  completes (HTTP 200 + report ready), proving the override path is accepted and
  exercised end-to-end. (Asserting *which* model ran is out of scope; the
  Gemini-Flash-via-OpenRouter run in step 8 of the goal validates a real model.)

## Out of scope (YAGNI)

- Reasoning-effort / temperature pickers (the audit fixes reasoning `high`).
- A curated per-provider model catalog / model-list endpoint.
- Applying this override to engines other than the consistency auditor.
