# Prompt Runner — Model Selection + Report Saving Design

**Date:** 2026-06-25
**Status:** Approved
**TODO ref:** "Prompt Runner — per-run model selection + report saving"

## Goal

Two features for the Prompt Runner, building on patterns just shipped:

1. **Per-run model selection** — pick the provider + exact model for a run (the
   same control as the Consistency panel), session-remembered, not persisted.
2. **Report saving** — save a run's output as a new `prompt-run` report in the
   Reports subsystem (`.md` + `.json`, on the Reports page, downloadable).

## Background

- The Prompt Runner UI (`frontend/studio/src/routes/PromptRunner.tsx`) picks a
  book, a file, and a prompt, then `POST /api/prompts/run` returns
  `{ output, meta }`. The output can Replace the file, Save as a new book file,
  or be Discarded. There is no model picker and no report concept.
- `runPrompt` (`gateway/src/services/prompt-runner.ts:34-35`) currently does
  `selectProvider('prompt_run', prompt.model ? 'openrouter' : undefined)` and
  honors `prompt.model` only on OpenRouter. `prompt_run` is a valid task type
  (`router.ts`: mid tier, 16000 output budget).
- `LibraryPrompt` has optional `model?` and `temperature?`.
- The Reports subsystem (`ReportsService`, `gateway/src/services/reports.ts`)
  stores per-kind `.md`+`.json` under `data/reports/`, keep-last-10, listed by
  `GET /api/books/:slug/reports` and served by `GET …/reports/:id`. Kinds today:
  `consistency | beta-reader | structure | plot-promises`. `ID_RE` already
  accepts a `prompt-run-<stamp>` id (`/^[a-z-]+-\d{8}T\d{6}Z$/`).
- The consistency feature added `isValidModelId` (`gateway/src/ai/model-id.ts`)
  and a provider-match guard in extraction; this design reuses both.
- There is **no MCP prompt-run tool**, so no `mcp/` change is required.

## Design

### Feature 1 — Per-run model selection

**Shared frontend constant.** Lift the provider list + default-model map out of
`consistencyApi.ts` into a new `frontend/studio/src/lib/providers.ts`:

```ts
export const AI_PROVIDERS = ['gemini','deepseek','claude','openai','ollama','openrouter'] as const;
export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  gemini: 'gemini-2.5-flash', deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4o', ollama: 'llama3.2', openrouter: 'anthropic/claude-sonnet-4-5',
};
```

`consistencyApi.ts` re-exports `CONSISTENCY_PROVIDERS = AI_PROVIDERS` (and
`PROVIDER_DEFAULT_MODEL`) from this module so its existing importers are
unchanged. PromptRunner imports `AI_PROVIDERS` / `PROVIDER_DEFAULT_MODEL`
directly.

**UI (`PromptRunner.tsx`).** Add `provider` (''=auto) and `model` component
state (session-remembered; no persistence). Render in the left controls, after
the Prompt picker: a provider `<select>` (`default (auto)` + `AI_PROVIDERS`) and,
when a provider is selected, a free-text exact-model `<input>` with
`placeholder={PROVIDER_DEFAULT_MODEL[provider]}`. Selecting `default (auto)`
clears the model. Pass `{ provider: provider || undefined, model: model || undefined }`
in the `/api/prompts/run` body.

**Backend (`prompt-runner.ts`).** `runPrompt` gains a final optional param
`override?: { provider?: string; model?: string }`. Resolution precedence:

1. **Per-run override** — if `override.provider` is set, `selectProvider('prompt_run', override.provider)`; honor `override.model` **only when** the
   selected `provider.id === override.provider` (else the router fell back to a
   different provider and a pinned model id would mismatch — same guard as the
   consistency extractor).
2. Else **the prompt asset's model** — current behavior (`prompt.model` →
   OpenRouter).
3. Else **the `prompt_run` tier default**.

Concretely, the existing two lines become a small resolver that yields
`{ providerId, model }`, then `complete({ provider: providerId, model, … })`.

**Route (`prompts.routes.ts`).** Read optional `{ provider, model }` from the
body. Validate: if `provider` present, it must be in `AI_PROVIDERS` (backend
list — see below) → else 400; if `model` present, `isValidModelId(model)` →
else 400. Pass the override into `runPrompt`.

> Backend provider list: `prompts.routes.ts` validates against the same six
> providers. Reuse `CONSISTENCY_PROVIDERS` from
> `gateway/src/services/consistency/model-selection.ts` (the canonical backend
> list) rather than introducing a fourth copy.

### Feature 2 — Report saving (`prompt-run` kind)

**`ReportsService` (`reports.ts`).** Add `'prompt-run'` to the `ReportKind`
union and `KIND_LABELS` (`'prompt-run': 'Prompt Run'`). No other change — write,
prune, list, resolvePath are kind-agnostic.

**Renderer (`gateway/src/services/reports/render-prompt-run.ts`).**

```ts
export interface PromptRunReportInput {
  prompt: string; file: string; output: string;
  meta?: { provider?: string; model?: string; tokensUsed?: number; estimatedCost?: number; ms?: number };
}
export function renderPromptRunReport(r: PromptRunReportInput): { title: string; markdown: string; summary: string }
```

Markdown: an `# Prompt Run report` heading, a metadata block (prompt name, source
file, provider/model, tokens, est. cost, elapsed seconds), then a `## Output`
section with the raw output. Summary: e.g. `"<prompt> on <file> — <provider>/<model>"`.
The `.json` stores the structured `PromptRunReportInput`.

**Route (`prompts.routes.ts`).** `POST /api/books/:slug/prompts/report` with body
`{ prompt, file, output, meta }`:

- Validate `slug` (`SLUG_RE` + `books.exists`) → 404 otherwise.
- Require `output` a non-empty string ≤ 100000 chars (matches the run cap) → 400.
- `prompt`/`file` coerced to strings (best-effort labels).
- `services.reports?.write(slug, 'prompt-run', renderPromptRunReport({…}))`;
  return `{ id }` (or 500 on failure). Fail-soft if `reports` is unavailable →
  503.

**UI (`PromptRunner.tsx`).** Add a **"Save as report"** button to the output
actions (beside "Save as new file"). On click, POST the current
`{ prompt: promptName, file, output, meta }` to the new endpoint; on success set
a message (`Saved report — view it on the Reports page`). Fail-soft: errors set
the existing `err` banner; never lose the output.

**Reports page (`Reports.tsx`).** Add `'prompt-run'` to the frontend `ReportKind`
type, `KIND_LABELS` (`'Prompt Run'`), `KIND_ORDER` (append), and the `grouped`
initializer object so the new kind renders in its own group.

## Error handling (fail-soft, repo posture)

- Invalid provider/model in either route → 400 with a clear message (the run /
  save is rejected, nothing partial persists).
- Report write failure never corrupts a run; the output stays on screen.
- Provider fallback (pinned provider unconfigured) → run proceeds on the
  fallback provider's default model (model dropped), never a mismatched id.

## Testing

**Unit:**
- `runPrompt` honors a `{provider, model}` override (select gets the provider,
  complete gets the model); drops the model when select falls back to a
  different provider; with no override, falls back to the prompt asset's model
  then the tier default (a fake `aiRouter` records `select` preferredId +
  `complete` model).
- `renderPromptRunReport` — markdown contains the prompt, file, provider/model,
  and the output; summary shape.

**Smoke (`tests/consistency-smoke.sh`).** Extend the existing reports block: pick
the smoke book, `POST /api/prompts/run` with a `{provider, model}` override and a
known prompt + small content (or reuse an existing runnable prompt), then `POST
/api/books/:slug/prompts/report` with the returned output, then assert
`GET …/reports` lists a `prompt-run` entry and `GET …/reports/:id?format=md`
serves markdown containing `# Prompt Run`. Keep it fail-soft/best-effort if no
prompt asset is available in the hermetic smoke environment (skip with a logged
notice rather than failing the suite) — mirror the existing best-effort blocks.

## Out of scope (YAGNI)

- Persisting the model choice to disk (session-only per the decision).
- Multi-prompt chains (separate tracked TODO).
- Auto-saving a report on every run (user-initiated only).
- MCP changes (no prompt-run tool exists).
