# Craft and Editorial Tools

Analyze a draft, get critique you can act on, and revise it through multi-pass editorial pipelines.

## What it is

BookClaw ships a suite of manuscript-quality tools that sit between "the draft exists" and "the draft is ready". They fall into three buckets:

- **Deterministic analyzers** — local heuristics that run with no AI call: the Craft Critic, the Dialogue Auditor, the Writing Judge's mechanical screen, and the Structure Check. Fast, free, repeatable.
- **AI critics** — a single AI call (or a small panel) that scores prose the way a human reader or editor would: the Writing Judge's LLM layer, the AI Beta Reader panel, and the named Editor personas.
- **Revision engines** — multi-pass pipelines that actually rewrite the text: the editorial edit passes (developmental → line → copy → proofread), alpha-read, the outline council, and the humanize de-AI passes. Plus the Prompt Runner, which applies any one reusable craft prompt to any book file.

The deterministic tools cost nothing and are safe to run on every save. The AI tools cost money per call, so they are run on demand.

## Why it matters

Most quality problems in a draft are invisible until someone names them: a sagging middle, a character who all sound alike, three "suddenly"s on one page, an emotional beat that's told instead of shown, prose that reads as machine-generated. The deterministic analyzers surface these patterns instantly and for free. The AI critics catch what heuristics can't — flat arcs, weak hooks, confused readers. The revision engines then close the loop by rewriting against that feedback. You can use any one piece on its own, or run them in sequence as a finishing workflow.

## How to use it

Most per-manuscript tools operate on a **project** (`/api/projects/:id/...`) and gather the completed writing-phase chapters automatically. The Writing Judge and Prompt Runner also accept loose text. Routes require the bearer token (see the security perimeter).

### Craft Critic — deterministic line and scene heuristics

Runs the full local analysis over every chapter: sagging-middle detection, showing-vs-telling ratio, adverb / filter-word / passive-voice density, dialogue-to-narration ratio per chapter, sentence-length monotony, Save-the-Cat beat adherence, and an overall story shape (`flat` / `building` / `classic` / `inverted`).

```
POST /api/projects/:id/craft-critique
```

The report returns per-chapter metrics, a list of actionable `flags` (each with a category, severity, evidence, and a concrete suggestion), the 15 Save-the-Cat beats with where each was found, and an overall block. No AI call, so it is free and instant.

- Studio: the project's craft panel renders the flags and the per-chapter table.
- MCP: `craft_critique`.

### Dialogue Auditor — voice fingerprints and drift

Extracts every dialogue line, attributes each to a speaker from its tag ("said Alice" / "Alice said"), builds a per-character **voice fingerprint** (contraction rate, formality score, question/exclamation rates, average line length, signature phrases, common sentence starts), then flags lines that don't match the attributed speaker's baseline — for example a normally-casual character going suddenly formal.

```
POST /api/projects/:id/dialogue-audit
```

Returns total / attributed / unattributed line counts, the fingerprints, and the mismatch flags. Heuristic-only and free. A character needs at least three attributed lines to get a fingerprint and five to be drift-checked.

A related, project-scoped per-character voice corpus (ingest chapters, then score drift) is exposed separately:

```
GET  /api/projects/:id/character-voices
POST /api/projects/:id/character-voices/ingest
POST /api/projects/:id/character-voices/detect-drift
```

MCP: `dialogue_audit`.

### Pacing Heatmap

Produces a per-chapter pacing/tension heatmap and flags sag windows. This route shells out to the sibling **Manuscript Autopsy** Python analyzer (spaCy-based), so it is only available when that tool is installed alongside BookClaw; otherwise the route returns a descriptive 503/error and you can fall back to the Craft Critic's sag detector.

```
POST /api/projects/:id/pacing-heatmap
```

Returns per-chapter `{ wordCount, tension, pacing }`, an average tension, and any `sagWindows`. MCP: `pacing_heatmap`.

### Structure Check — recommend and check against the catalog

Recommends a story structure for the book's genre and (optionally) checks the project's outline against the chosen structure's beats. The catalog is the same one used at book creation (Save-the-Cat, Hero's Journey, Three-Act, Four-Act, Fichtean, Kishōtenketsu, In Medias Res, and author-defined custom structures).

```
GET  /api/structures                      # list the catalog
POST /api/structures/recommend            # { genre, subgenre?, description? }
POST /api/structures/check-outline        # { outline: string[], structureId }
POST /api/projects/:id/structure-check    # pulls the project's outline, recommends + checks
```

The project route reads the outline from the project's completed outline-phase steps, recommends a structure, and (if an outline and a chosen structure exist) returns an `outlineCheck` mapping beats to chapters. Deterministic and free. MCP: `recommend_structure`, `structure_check`, `check_outline_structure`, `list_structures`.

See also [Book format and structure](./book-format-and-structure.md), which covers declaring structure × form × pacing at creation.

### Writing Judge — mechanical screen plus optional AI score

A two-layer quality gate. Layer 1 is a **mechanical screen** (regex-based, free): cliché phrases, AI-tell words ("delve", "tapestry", "testament"…), filter words, adverb density, passive voice, weak verbs, "started to", "suddenly", and hedge words — producing a composite 0-100 score. Layer 2 is an optional **LLM judge** scoring six craft dimensions 1-10 (voice, show-vs-tell, pacing, dialogue, sensory grounding, emotional truth). An optional **dual-judge** mode also runs a *market* lens (hook strength, page-turn quality, trope execution, comp alignment, payoff, commercial polish) and surfaces where the two judges disagree — the disagreement is the most actionable signal.

```
POST /api/judge          # { text, runLLMJudge?, threshold?, mechanicalWeight?, dualJudge? }
GET  /api/judge/screen   # ?text=...  — mechanical screen only, no AI cost
```

`POST /api/judge` returns a combined score (mechanical 30% / judge 70% by default), a `retry` flag against the threshold (default 70), the full mechanical and judge reports, and concrete retry-steering feedback. The Judge also runs automatically inside the writing pipeline as a modify-evaluate-retry loop; this endpoint lets you score loose prose by hand. Use `/api/judge/screen` for a free, instant mechanical read.

### AI Beta Reader panel

Runs each chapter past a panel of simulated reader **archetypes** and returns structured per-chapter feedback: a tension score (1-10), pacing label, want-to-continue probability (0-100), confusion points, favorite moment, stumble point, felt emotions, and a one-line gestalt — plus an aggregate (average tension, weakest/strongest chapter, top emotions, top confusions). The four built-in archetypes are the Devoted Genre Fan, the Casual Reader, the Literary Critic, and the Target Reader; you can pass a custom panel.

```
GET  /api/beta-reader/archetypes          # list available archetypes
POST /api/projects/:id/beta-reader        # { archetypes? } — async; progress via socket
GET  /api/projects/:id/beta-reader/report # the stored report
```

The run is asynchronous (one AI call per chapter × archetype): the POST returns immediately with `{ status: 'started', ... }`, progress streams over Socket.IO (`beta-reader-progress` / `beta-reader-complete` / `beta-reader-error`), and the finished report is saved and retrievable via the report route. MCP: `run_beta_reader`, `get_beta_reader_report`, `list_beta_archetypes`.

### Named Editor personas and the Editorial Council

**Editor personas** are an interactive, chat-based developmental edit. Putting a chat channel into "editor mode" swaps in the editor's persona as the system prompt — replacing the author voice — for back-and-forth brainstorming or critique. The built-in editors are **Maeve** (romantasy), **Rosalind** (contemporary romance), **Neil Ashford** (hard-SF plot holes / physics), **Lily** (intimate scenes), and **Sarah Chen** (character names). Each has a `brainstorm` and a `critique` mode.

In chat (dashboard / API):

- `/editors` — list the available editors (numbered menu)
- `/editor:<name>` or `/editor <name>` — enter editor mode
- `/editor <name> book` — also inject the active book's genre guide + recent notes as context
- `/editor off` — exit editor mode

The active editor is tracked per channel and persisted to `workspace/.config/channel-editors.json`. Editors are a `editor` library kind — list / read / write / export-import via `/api/library`, editable in the Asset Studio. (The `/editor` commands are dashboard/API for now; the Telegram bridge router does not yet dispatch them.)

The **Editorial Council** is the non-interactive, batch counterpart: the `editorial-outline-council` pipeline runs a multi-model "council of LLMs" over the chapter **outline** (not the prose). Round 1 has five models independently critique the outline against the character and world bibles; round 2 has three models act as a writers'-room rewrite merging the strongest ideas; round 3 has a single lead-writer model synthesize one authoritative improved outline. See [Pipelines and sequences](./pipelines-and-sequences.md) for how to run it.

### Revise and editorial pipelines

The classic four-pass manuscript edit ships as four per-chapter pipelines that run an **analyze → apply** pair on each chapter, with the apply step constrained to surgical, length-preserving edits:

- `editorial-developmental-edit` — structure, character, arc, theme
- `editorial-line-edit` — sentence-level rhythm, clarity, word choice
- `editorial-copy-edit` — grammar, consistency, mechanics
- `editorial-proofread` — final typo / punctuation sweep

The **`editorial-review-and-edit` sequence** chains those four in order (developmental → line → copy → proof). Two further editorial pipelines run standalone:

- `editorial-alpha-read` — turns supplied reader feedback into a revision pass
- `editorial-outline-council` — the multi-model Council described above (outline stage)

The `revise` skill (triggers: revise, edit, improve, rewrite, critique, line edit, copy edit…) provides the prompt content these passes inject, and `deep-revision` is a heavier multi-pass revision pipeline. Run any pipeline or sequence through the Pipelines surface — see [Pipelines and sequences](./pipelines-and-sequences.md).

### Humanize — de-AI passes

Two per-chapter "humanization" assembly lines strip machine-detectable patterns from already-drafted prose while preserving plot, characters, voice, and dialogue:

- `humanize-claude` — 11 sequential passes (grammar foundation → AI-word cleaning → overwritten-language reduction → sensory enhancement → subtlety → dialogue → weak-language cleanup → strategic imperfections → structural-construction elimination → final pattern verification → final AI-word sweep), using Claude models.
- `humanize-gemini` — the 10-pass Gemini variant.

Both run as `expand:chapters` pipelines (one chain per chapter) and defer to the book's forbidden-words / style guide in context for the banned-word list. They run **after** drafting, on finished chapter prose. Model overrides are provisional — tune per your account.

### Prompt Runner — one reusable craft prompt against any book file

The Prompt Runner applies a single curated craft prompt to any book file's content and returns the result without saving — a neutral run (the book's author/voice/genre are **not** injected). The built-in prompts include dialogue / copy / on-the-nose / human-writing editors, engagement and prose-quality checkers, several character audits (7-point, female, male), chapter-ending and first-chapter checkers, and an improve-the-middle-third pass.

```
POST /api/prompts/run    # { prompt, content, bookSlug? }
```

Returns `{ output, meta }`, where `meta` carries the run stats shown under the output: elapsed time, prompt + completion tokens, tokens/second, provider/model, and estimated cost (tok/s and cost are marked "(est.)"; time, tokens, and model are exact). `content` is capped at 100k characters. In the Studio's **Prompt Runner** route you pick a book file and a prompt, run it, then **Replace** (with an original-vs-output diff that versions the prior content), **Save as new file**, or **Discard** — plus per-file version history with restore. Prompts are a `prompt` library kind, editable in the Asset Studio.

## Under the hood

Deterministic analyzers (no AI call):

- `gateway/src/services/craft-critic.ts` — Craft Critic heuristics, beats, story shape
- `gateway/src/services/dialogue-auditor.ts` — line extraction, voice fingerprints, drift flags
- `gateway/src/services/writing-judge.ts` — mechanical screen lexicons + the LLM judge prompts (craft + market)
- `gateway/src/services/story-structures.ts` — structure catalog, recommend, outline check

AI critics and runners:

- `gateway/src/services/beta-reader.ts` — archetypes, panel scan, aggregate
- `gateway/src/services/prompt-runner.ts` — `runPrompt` + run-stats `meta`
- `gateway/src/services/editor.ts`, `editor-prompt.ts`, `editor-parse.ts`, `editor-command.ts` — editor personas, per-channel session state, `composeEditorPrompt`
- `gateway/src/init/phase-05b-editors.ts` — editor service init
- `gateway/src/services/external-tools.ts` — `runManuscriptAutopsy` (Pacing Heatmap bridge)

Routes:

- `gateway/src/api/routes/wave.routes.ts` — `craft-critique`
- `gateway/src/api/routes/export.routes.ts` — `pacing-heatmap`, `beta-reader`, `dialogue-audit`
- `gateway/src/api/routes/knowledge.routes.ts` — `/api/judge`, `/api/judge/screen`, `character-voices`, `structures*`, `structure-check`
- `gateway/src/api/routes/prompts.routes.ts` — `/api/prompts/run`

Library assets:

- `library/editors/*.json` — the five named editor personas (plus the world-author default)
- `library/pipelines/editorial-*.json` — developmental / line / copy / proofread / alpha-read / outline-council
- `library/pipelines/humanize-claude.json`, `humanize-gemini.json` — the de-AI assembly lines
- `library/sequences/editorial-review-and-edit.json` — the four-pass chain
- `library/prompts/*.json` — Prompt Runner built-ins
- `skills/author/revise/SKILL.md`, `skills/author/dialogue/SKILL.md`, `skills/author/beta-reader/SKILL.md`

## Related

- [Pipelines and sequences](./pipelines-and-sequences.md) — running the editorial / humanize pipelines and the Editorial Council
- [Continuity and consistency](./continuity-and-consistency.md) — the fact-ledger continuity auditor, plot promises, and series checks
- [Book format and structure](./book-format-and-structure.md) — declaring structure × form × pacing and the per-book Structure & Length panel
