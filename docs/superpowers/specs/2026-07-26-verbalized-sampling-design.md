# Alternate Takes (Verbalized Sampling) for creative-decision steps

**Date:** 2026-07-26
**Status:** Design + name approved; implementation plan next.
**Source:** "Verbalized Sampling" — arXiv 2510.01171. Owner ask 2026-07-26.
**Scope of THIS spec:** sub-project 1 (the engine + two decision points + the pick-gate + the selection log). Sub-projects 2-4 are described under [Decomposition](#decomposition) and are out of scope here.

## Naming

The **writer-facing** name is **Alternate Takes** — the film/writing metaphor for several distinct versions of the same moment, from which the writer chooses. "Verbalized Sampling (VS)" is retained only as the **technical origin** (the paper's term for the underlying mechanism). Convention used throughout this spec and the implementation:
- User-facing copy/labels: **Alternate Takes**; the candidates are **takes**; the picker is the **Takes picker**; decision point A is the **Scene Takes** step.
- Internal/technical identifiers keep the VS anchor for traceability: module `gateway/src/sampling/verbalized-sampling.ts`, review-gate kind `vs-pick`, the per-step config key `vs`, the new role `approach`.

## Problem and gating rule

LLMs mode-collapse toward *typical* outputs. Verbalized Sampling (VS) counters this by asking the model to emit **k candidates each with its estimated typicality probability**, biasing toward the flatter parts of the distribution. The paper's own math says VS only pays where the true reward is flat — many outputs equally valid, typicality acting only as a tiebreaker. Where there is a verifiable answer, VS costs ~k× tokens for nothing and can *degrade* output.

Therefore VS is a **per-step opt-in, never a global toggle**:
- **VS ON** (creative decisions): scene approaches, opening lines, character decisions/motivations, dialogue variants, premise expansion, genre-guide exemplar generation.
- **VS OFF** (verifiable answers): continuity checks, outline validation, line edits, copyedit passes, consistency audits.

This mapping is enforced in code (a role allowlist), not left to convention, so VS can never silently attach to a continuity pass.

## How this lands on BookClaw (corrections to the source spec)

The source write-up assumes a generic `draftScene`/`src/sampling` layout. Grounded in the real tree:

- **The two-stage split it calls "the part that matters most" already exists.** The per-chapter pipeline is `scene_brief` (a role-tagged planning step) → `draft` (a separate prose step). That *is* decision-stage → prose-stage. VS attaches at the decision layer; `draft` prose stays direct.
- **`fast-xml-parser` is NOT in the tree.** BookClaw extracts its `<scene_brief>…</scene_brief>` blocks and the `<!--BOOKCLAW:MANIFEST-->` sentinel with tolerant regex/string parsing. The VS parser follows that house style — no new dependency.
- **There is no candidate picker.** Review gates today are approve/edit/regenerate/stop on a *single* output (`step.review.kind` ∈ `pipeline-gate|pipeline-error|cadence-gate`; resumed via `applyReviewResume`). "Surface k candidates, pick one, log the discarded" is a **new gate kind + a new action + a selection-log schema** — the largest new surface, and where the compounding preference-dataset value lives.
- **Per-step config already exists.** `ProjectStep` carries `role` / `taskType` / `skill` / `modelOverride`. A `vs` block on the step is the same pattern as the per-step model work (2026-07-26).
- **Model routing is free.** The VS module wraps the existing `AIRouter.complete(CompletionRequest)`, so candidates are generated on the step's *resolved production model* (casting sheet + author/book model layer). This directly satisfies the paper's "validate on the production model, not the cheap one" caveat with no separate path.

## Decomposition

Four sub-projects, each its own spec→plan→build. **This spec covers sub-project 1.**

1. **Engine + decision points + pick-gate + log schema** (this spec).
2. **Pick-gate UI polish + preference-corpus tooling** (export/inspect the selection log; the fine-tuning-corpus view).
3. **Instrumentation** — embedding `1 − mean pairwise cosine` diversity metric (reuse `memory-search` embeddings), tokens-per-accepted-output (VS vs direct).
4. **Validation experiments** — VS-CoT vs VS-Standard on the production model; the baseline / anti-fingerprint-only / VS-only / both 4-cell A/B (constraints narrow the distribution, VS widens it — compose or cancel is an empirical question).

## Sub-project 1 — components

### 1. Core module — `gateway/src/sampling/verbalized-sampling.ts`

Provider-agnostic; wraps `AIRouter.complete`. Pure composition + parse + fail-open; owns no pipeline state.

- **Input:** `{ basePrompt, systemPrompt, routing, config }` where `routing` is the already-resolved provider/model/temperature for the step (from `stepRouting`), and `config = { k=5 (cap 8), probabilityThreshold=0.10, variant: 'standard'|'cot'|'multi' (default 'cot') }`.
- **Prompt composition, not replacement:** the step's skill/craft content and system prompt are preserved; the VS envelope (emit k candidates, each with a `<candidate>`/probability, probabilities under threshold, response format) is appended **last** so it defines the output envelope without overwriting craft instructions. Default `variant: 'cot'` — the paper found VS-Standard costs some quality while VS-CoT/Multi recover it and improve on larger models.
- **Tolerant parse (house style, regex-first):** extract k candidate blocks; validate you got k blocks and that a probability is present and `< threshold` for each. On near-XML, a regex fallback recovers blocks.
- **Discard probabilities after validation** — they are the mechanism, not downstream data.
- **Fail open:** malformed output after **one** retry → fall back to a single direct-prompt completion, return it flagged `degraded: true`, and the caller skips the pick-gate (nothing to pick). VS is an enhancement, never a hard dependency.
- **Output:** `VsResult = { candidates: Array<{ index: number; text: string }>; degraded: boolean; variant; k }`. No probabilities.

### 2. Per-step VS config + role allowlist

- A `vs?: { enabled: true; k?; threshold?; variant? }` block on the pipeline step JSON (and thus on `ProjectStep`), opt-in.
- A new `StepRole` `'approach'` is added (`casting/roles.ts`) for decision point A; it routes to a cheap tier and is NOT a prose role.
- A hardcoded **VS role allowlist**, a `ReadonlySet<StepRole>`. Sub-project 1 populates it with exactly `{ approach, draft, scene_brief }` (the concrete attach points); it is extensible later for the other VS-ON targets in the gating rule (premise, dialogue, character-decision) as those get their own attach points. A `vs` block on any role NOT in the set is refused at expand/validate time with a loud log, so VS can never attach to `analysis`/`editorial`/`continuity`/copyedit-`rewrite`/`outline`.

### 3. Decision point A — "Scene Takes" (`propose-approaches` step, new)

- A new short step (user-facing label **"Scene Takes"**, role `approach`, `taskType` a cheap tier) inserted **above** `scene_brief` in the prose pipelines that opt in.
- Emits **k × 2-3-sentence** "what happens in this scene" approaches (short candidates = where mode collapse actually bites, and short avoids the length-degradation failure mode k-too-large triggers).
- Produces a `vs-pick` gate. The chosen approach text is injected into `scene_brief`'s context (via the existing step-result chaining that already feeds prior steps into later prompts); `scene_brief` and `draft` remain direct.

### 4. Decision point B — draft-opening VS

- The `draft` step splits into **opening** (VS: k × ~150-word opening variants) → `vs-pick` → **continuation** (direct prose from the chosen opening).
- Same core module + gate; the only difference from A is the invocation site and candidate length.

### 5. Pick-gate — new review kind `vs-pick` + `select` action

- Extend `step.review.kind` with `'vs-pick'`; store the candidates on the review marker (`review.candidates: Array<{ index; text }>`) so the gate can render them.
- Extend `applyReviewResume` with a `'select'` action carrying `extra.candidateIndex`: completes the step with the chosen candidate's text (exactly like `edit` completes with edited text), then resumes the driver. `edit` still works (hand-tweak a candidate); `regenerate` re-runs VS; `stop` halts.
- **A VS-enabled step ALWAYS gates.** VS is inherently human-in-the-loop; "never auto-select" is absolute with no autonomous-mode branch — running a book autonomously simply means not enabling VS on that step. If `degraded`, the step completes directly with the single fallback output and does **not** gate.
- API: extend the existing `POST /api/projects/:id/review/action` with `action: 'select', candidateIndex`. No new endpoint.

### 6. Selection-log schema (the preference dataset)

Every resolved `vs-pick` appends one JSONL record (per-book, e.g. `workspace/books/<slug>/data/vs-selections.jsonl`). Designed in full now so the corpus is clean from the first pick and never reconstructed from logs later:

```
{ id, at, bookSlug, projectId, stepId, role, variant, k, threshold,
  provider, model, contextRef, candidates: [{ index, text }],
  chosenIndex, edited: boolean, diversityScore: null, degraded }
```

- `chosenIndex` = the human's pick (`-1` if they `edit`ed rather than picked verbatim; `edited: true` then, with the final text stored as candidate `-1`).
- `diversityScore` stays `null` until sub-project 3 fills it — the slot exists day one.
- `contextRef` identifies the prompt/context (step id + chapter) without duplicating the full manuscript into the log.

This log is the byproduct-of-normal-drafting preference dataset (accepted-vs-rejected pairs) and the eventual fine-tuning corpus.

## Data flow (per chapter, both decision points enabled)

```
propose-approaches (VS, k short approaches) → [vs-pick gate] → chosen approach
  → scene_brief (direct, expands chosen approach)
  → draft-opening (VS, k openings) → [vs-pick gate] → chosen opening
  → draft-continuation (direct)
  → consistency/de-ai (direct, VS-OFF)
  → [existing per_chapter review gate]
```

Cadence note (design-acknowledged, owner-controlled): both points on = three human touchpoints per chapter (two picks + the chapter review). The per-step `vs.enabled` flag lets the owner enable one point and not the other per book.

## Error handling

- Malformed VS output → one retry → direct fallback flagged `degraded`, no gate (per-module, fail-open).
- Role-allowlist violation → refuse the `vs` block at expand time, loud log, step runs direct.
- Candidate storage/gate failure → treat as `degraded` (complete direct), never block the pipeline.
- All consistent with BookClaw's fail-soft init/generation posture.

## Testing strategy

- **Core module (unit, TDD):** k-block parse (clean + near-XML regex fallback); threshold validation; fail-open after one retry returns `degraded` single output; probabilities discarded; prompt composition puts the VS envelope last and preserves the base/system prompt.
- **Role allowlist (unit):** a `vs` block on `continuity`/`editorial` is refused; on `scene_brief`/`approach`/`draft` is honored.
- **Gate (unit):** `applyReviewResume` `select` completes with the chosen candidate; `edit`/`regenerate`/`stop` still behave; a `degraded` VS step completes directly and does NOT set a `vs-pick` gate.
- **Selection log (unit):** a resolved pick appends one well-formed record with `diversityScore: null`; an `edit` records `edited:true`/`chosenIndex:-1`.
- **Pipeline (integration/guard):** a pipeline with `vs.enabled` on `approach` expands the `propose-approaches` step; VS-OFF roles never carry a `vs` block.

## Out of scope (later sub-projects)

- Embedding-based diversity metric + token accounting (sub-project 3).
- Pick-gate UI beyond the minimal render/select needed to resolve the gate (sub-project 2).
- The VS-CoT-vs-Standard and anti-fingerprint 4-cell experiments (sub-project 4).
- Auto-selection of any kind — deliberately never built; VS is human-pick by definition.

## Decisions made (flag in review if you disagree)

- **Reuse the existing review-gate machinery** (`step.review` + `applyReviewResume` + the `/review/action` endpoint) with a new `vs-pick` kind and `select` action, rather than a parallel gate system — surgical and consistent with the cadence/pipeline gates.
- **VS-enabled ⇒ always gates** (no autonomous auto-pick), making "never auto-select" structural.
- **Defaults:** `k=5` (cap 8), `threshold=0.10`, `variant='cot'`.
- **Selection log is per-book** (`data/vs-selections.jsonl`), not global — travels with the book on export/backup.
