# Pipelines and Sequences

## What it is

A **pipeline** is an editable, versioned list of generation steps. Each step carries:

- a **prompt** (a template that can interpolate book variables such as `{{title}}` and `{{n}}`),
- a **taskType** that routes the step to an AI tier (free / mid / premium),
- an optional **per-step model override** (pin a specific provider, model id, and temperature),
- an optional **wordCountTarget** (triggers multi-pass continuation when the model runs out of room), and
- an optional attached **skill** (whose content is injected into the step's prompt; a skill can also be a multi-phase executable chain).

A **sequence** is an ordered list of pipeline names that a book runs back-to-back. The phase order *is* the sequence — there is no longer a hardcoded "planning → bible → production → revision → format → launch" chain baked into the code. A book declares which pipelines it runs and in what order, and the engine chains one project per entry. This is the "config-not-code" model: book generation is data, not source.

Pipelines and sequences are first-class **library assets**, so they can be browsed, edited, cloned, exported, and imported like any other library entry.

## Why it matters

- **You control the recipe.** Reorder phases, drop a phase, add a custom polish pass, or swap the entire production pipeline — all without touching code.
- **Right model for each job.** Draft chapters on a cheap, fast model and run the editorial polish on a premium one, by pinning models per step.
- **Reproducible and portable.** A book snapshots its pipelines at creation time, so editing the library later never changes a book already in flight. Assets can be shared as zips.
- **Ready-made suites.** Several full novel and editorial workflows ship built in (ported from the owner's n8n automations), so you can start with a proven multi-stage process instead of building one from scratch.

## How to use it

### Pick a sequence when you create a book

In the studio, the **New Book** flow includes a sequence picker (preset-seeded and reorderable). The book stores the chosen ordered pipeline names as its `pipelineSequence`, snapshotting each pipeline into the book's own `templates/` so it stays stable.

Over the API, `POST /api/books` accepts either form (most specific wins):

- `pipelineSequence`: an explicit ordered array of pipeline names, or
- `sequence`: the name of a built-in sequence preset (for example `"novel"`), or
- `pipeline`: a single pipeline name (the original single-pipeline behavior).

Every resolved name is validated against the library; unknown names return `400` with the offending names listed.

### Run the sequence

Projects auto-execute on creation. When the active book has a non-empty `pipelineSequence`, `POST /api/projects/create` chains one project per sequence entry, all linked by a shared `pipelineId` and numbered by phase. The studio's Write rail drives create → start → auto-run.

Phase ordering is enforced: a later phase becomes runnable only once every earlier phase has **completed**. A `failed` or `paused` earlier phase halts the sequence visibly rather than letting a later phase jump ahead.

Useful routes:

- `GET /api/pipeline/:pipelineId` — phase-by-phase status (steps, completed steps, progress).
- `POST /api/pipeline/:pipelineId/advance` — manually start the next pending phase (only if the prior phase completed). The completion hook advances automatically; this is the manual lever.
- `GET /api/projects/list` and `GET /api/projects/:id` — per-project / per-step state.

### Run individual steps with full control

- `POST /api/projects/:id/start` — activate the first step.
- `POST /api/projects/:id/execute` — run the current active step.
- `POST /api/projects/:id/auto-execute` — run every remaining step autonomously (a per-project in-flight lock prevents double-runs).
- `POST /api/projects/:id/pause` — pause; the autonomous runner stops at the next step boundary.
- `POST /api/projects/:id/resume` — re-activate the runnable frontier and set the project active again.
- `POST /api/projects/:id/skip/:stepId` — skip a step.
- `POST /api/projects/:id/steps/:stepId/retry` — reset a failed/completed step back to pending (optionally `deleteOutputFile`). Re-runs that one step without restarting the project.
- `POST /api/projects/:id/restart` — reset failed/active (and optionally completed, via `keepCompleted`) steps to pending so you can re-run from a clean state; optionally `deleteOutputFiles`.

### Set a per-step model override

In the **Pipeline Editor** (Asset Studio), each step can pin a provider, model, and temperature. Over the API:

- `POST /api/projects/:id/steps/:stepId/model` — body `{ provider, model? }`; an empty/absent `provider` clears the override and the step reverts to tier routing. Valid providers: `gemini`, `deepseek`, `claude`, `openai`, `ollama`, `openrouter`.
- `POST /api/projects/:id/provider` — set a whole-project preferred provider (a softer default than per-step pinning).

Resolution order for any step's AI call: **per-step override → project preferred provider → tier routing** (from the step's `taskType`). When a pinned provider isn't configured, the engine warns and falls back to tier routing rather than failing.

For *which* model to pin where — provider/model pros and cons and per-task recommendations (including the cheap-draft/premium-edit cost pattern) — see the [Model guide](../MODEL-GUIDE.md).

### Edit and clone pipelines in the Asset Studio

The **Asset Studio** is where you edit library assets. For pipelines, the **Pipeline Editor** supports per-step editing (prompt, taskType, model override) and editing of the `expand` group (see below). The **Sequence Editor** edits the ordered list of pipeline names. To clone, export an asset and re-import it under a new name. Assets round-trip through the library transfer paths:

- `GET /api/library/:kind/:name/export` — export one asset as a portable zip.
- `POST /api/library/import` — import a zip (create-or-override by name; gated on injection findings).

The built-in `library/` assets are the baked defaults; your edited or imported copies live in the workspace library overlay and override the built-ins by name.

## Built-in pipeline and sequence library

Sequences (`library/sequences/`):

- **`novel`** — the standard full novel: `book-planning` → `book-bible` → `book-production` → `deep-revision` → `format-export` → `book-launch`.
- **`nerdynovelistai`** — NerdyNovelistAI Suite (idea → full manuscript), five stages: story dossier → character bible → world bible → chapter outline → per-chapter drafting (brief → draft → chronology/style checks → rewrite). Ported from the n8n "StoryHackerAI" suite.
- **`msf`** — MSF (Mundane Science Fiction), six phases: multi-model ideation → developmental → outline → per-chapter prose (cross-model laundering) → per-chapter summaries + bible update → finalize (blurb + cover-art prompt). Ported from the n8n "MSF" phase suite.
- **`editorial-review-and-edit`** — the Editorial Review and Edit suite: four classic per-chapter edit passes in order — developmental → line → copy → proofread. Run **after** production. (Two related editorial pipelines, `editorial-alpha-read` and `editorial-outline-council`, ship standalone and are **not** auto-chained — add either if you want it.)

Notable standalone pipelines (`library/pipelines/`) you can add to a sequence:

- **`scene-drafter`** — a lightweight per-chapter 2-step drafter (scene brief → full prose), no critique/rewrite loop. Good for fast first drafts when the book already has an outline.
- **`humanize-claude`** / **`humanize-gemini`** — per-chapter de-AI / humanization assembly lines (11 / 10 numbered passes: grammar → AI-word cleaning → overwritten-language reduction → sensory → subtlety → dialogue → weak-language → imperfections → verification → final sweep). Built from the owner's ClaudeHumanizer / GeminiHumanizer prompt repos. Run after drafting.
- The six editorial pipelines (`editorial-developmental-edit`, `editorial-line-edit`, `editorial-copy-edit`, `editorial-proofread`, `editorial-alpha-read`, `editorial-outline-council`) and the per-stage NerdyNovelistAI / MSF pipelines.

These suites came from porting the owner's n8n workflows into native config-not-code assets: each n8n per-chapter batch loop became an `{expand:chapters}` group, and each multi-model "jury" merge became a `{parallel}` group with per-step model overrides. The carried-over OpenRouter model ids in the ported pipelines are **provisional** — confirm them against your own account before relying on them.

## Under the hood

Two authoring constructs let a short pipeline file expand into many runtime steps:

- **`{expand:chapters}`** — `{ "expand": "chapters", "steps": [...] }` repeats its inner steps once per chapter. On each repeat the expander binds `{{n}}` (and `chapterNumber`) to the chapter number, so a 2-step `scene-drafter` over a 25-chapter book flattens to 50 interleaved steps. Pipeline variables (`{{title}}`, `{{chapterCount}}`, `{{wordsPerChapter}}`, structural beats like `{{midpoint}}`, etc.) are interpolated at expansion time.
- **`{parallel}`** — `{ "parallel": [step, step, ...] }` fans its members out as a batch (each member tagged with a shared `parallelGroup` id). The next ordinary step is the implicit **join / barrier**: it stays gated until every member of the group has completed or been skipped. This is how the multi-model ideation and editorial-council rounds run several models, then synthesize.

Key files:

- `gateway/src/services/projects.ts` — the `ProjectEngine`: `createProjectFromPipeline` (resolve + expand a pipeline into steps), `createBookSequence` (chain one project per sequence entry), `advancePipeline` / `sequencePredecessorsComplete` (phase gating), and the runnable-frontier / parallel-group selectors.
- `gateway/src/services/pipeline-expand.ts` — `expandSteps`: flattens `{expand}` and `{parallel}` groups and interpolates `{{var}}` templates.
- `gateway/src/services/pipeline-vars.ts` — `buildPipelineVars`: the variables available to step templates.
- `gateway/src/services/sequence-parse.ts` — `parseSequence`: validates a sequence's ordered pipeline-name list.
- `gateway/src/api/routes/projects.routes.ts` — the project/pipeline HTTP routes (create, execute, auto-execute, advance, pause/resume/retry/restart, per-step model).
- `gateway/src/api/routes/books.routes.ts` — `POST /api/books` resolution of `pipelineSequence` / `sequence` / `pipeline`.
- `library/pipelines/` and `library/sequences/` — the built-in pipeline and sequence assets.

Outputs land under the project's bound book's `data/` directory. Each project is bound to a book at creation, so multiple books can run different sequences concurrently without cross-leak.

## Related

- [Books and authors](./books-and-authors.md)
- [Craft and editorial](./craft-and-editorial.md)
