# BookClaw Flagship Pipeline Engine — Design

- Date: 2026-07-02
- Status: Approved design (Sub-project 1 of 2)
- Author: Paul (with Claude Code)
- Related follow-up: Sub-project 2 — Smart Intake Wizard (separate spec)

## 1. Purpose and reframe

The goal is to make BookClaw's autonomous book generation produce output at the quality the maintainer achieved with hand-built n8n pipelines, while pulling in the pre-writing research and end-of-book polish ideas from the AuthorClaw/OpenClaw lineage — all self-contained in BookClaw with no runtime dependency on n8n.

Investigation established the following ground truth, which reframes the work from "build" to "orchestrate and curate":

- The maintainer's n8n pipelines were already ported into BookClaw as native library pipelines (`library/pipelines/*.json`): the MSF, NerdyNovelistAI, Editorial, Romantasy, and Romance suites, plus dedicated humanizers. There is no runtime n8n connection and none is wanted.
- Per-phase model pinning already works: a pipeline step's `modelOverride` pins provider and model, and several ported pipelines already cast a different model per phase (for example `romance-spicy`: Scene Brief and First Draft on Opus, Improvement and Rewrite on Gemini, Humanize and Intimacy on Sonnet).
- The AuthorClaw pre-writing research and end-of-book polish capabilities already exist in BookClaw as services (`ResearchGate`, `research-lookup` via Perplexity, `craft-critic`, `dialogue-auditor`, `beta-reader`, `format-finisher`, the consistency engine). They are on-demand endpoints, not chained into the auto-run pipeline.
- Genre selection, fifteen story structures, and human-review gates all already exist.

The remaining work is therefore: a casting layer that expresses model routing declaratively, content-axis routing (author-branded spice/violence plus per-character profanity), a scene-heat classifier with Claude-first spice generation and uncensored escalation, uniform enhancement wrappers (grounding research, rolling-summary memory, analyze-then-apply polish) applied to each genre's existing base, configurable human gates, multi-book concurrency and cost control, and the consistency engine woven through every phase as the canon spine.

### Goals

- Keep each genre's proven base pipeline; apply a uniform enhancement layer across all of them.
- Express per-phase model casting declaratively and make it tunable in one place per genre ("for me first").
- Let the author pick one prose model that controls the two generative steps, while curated editorial/humanize/analysis models stay pinned.
- Treat spice/violence as an author-brand ceiling and profanity as a per-character voice trait.
- Generate spice on Claude by default with emotional framing; escalate to an uncensored tier only on refusal.
- Run multiple books, authors, and genres concurrently without exceeding API budget or provider rate limits.
- Make the consistency checker the backbone: prevent drift before drafting, detect and auto-fix after, gate on it, audit at the end, and run standalone on imported past novels.

### Non-goals

- No runtime integration with n8n.
- The intake wizard (expanded Easy Start) is Sub-project 2 and is specified separately.
- No new gate machinery; reuse `ConfirmationGateService` and the Human-Review pause.
- Not adopting OpenRouter Fusion for the ideation ensemble (see Section 4.4).

## 2. Research grounding (summary)

Directly consulted sources, condensed to the findings that shaped the design:

- Long-form quality is a state-management and orchestration problem, not a prompting problem. The load-bearing pattern across NousResearch `autonovel` and Pratilipi's long-form architecture is: source-of-truth artifacts (bible, character arcs, knowledge map), a rolling-summary memory instead of raw prior chapters, a generate-critique-regenerate loop with a recursion cap, and a separate model as judge than as author.
- Practitioners genuinely cast different models per phase. Concrete voice guidance (Sudowrite prose modes, EQ-Bench Antislop): Claude Opus and Sonnet produce the most natural, least "slop" prose; DeepSeek is an action specialist; Gemini is benchmark-strong but less distinctive; Grok is permissive rather than crafted. This matches the maintainer's n8n casting (Opus for first draft, Sonnet for editorial, Gemini for revision/humanize).
- Mature content: fine-tuned uncensored models are more stable than abliterated ones; Grok has been tightening and jailbreaks are fragile; OpenRouter uncensored fiction models (for example Venice's Dolphin-tuned 24B) avoid account-ban risk. For legitimate dark fiction, the durable pattern is a provider-routing layer, not jailbreaking a frontier model.
- Human-in-the-loop consensus: automated gates every chapter, mandatory human gate at act or outline boundaries and before publish/export. This maps directly onto BookClaw's existing confirmation/human-review machinery.

Key primary sources: `github.com/NousResearch/autonovel`; Pratilipi "Beyond the Context Window" (medium.com/team-pratilipi); EQ-Bench creative writing (`eqbench.com/creative_writing_longform.html`); Sudowrite prose modes and Muse; `atlascloud.ai` uncensored model guide and OpenRouter model pages.

## 3. Architecture overview

Five layers, from declarative content to runtime execution:

1. Pipeline definitions (per genre): each genre keeps its proven base pipeline; steps gain a semantic `role`.
2. Casting sheets (per genre) and craft templates: `role -> model` tables, a heat ladder, an ideation panel, and emotional-framing intimacy templates. This is the primary tuning surface.
3. The casting resolver (`castStep`): computes the model for each step at execution time from the sheet, the author's prose-model pick, the scene's heat classification, and any manual pin.
4. The enhancement wrappers (uniform across genres): grounding research (front), rolling-summary memory, analyze-then-apply polish (back), human gates, and the consistency spine.
5. The scheduler and cost control: a global semaphore and queue over the existing per-project drive lock, plus per-book budgets and per-provider throttling.

## 4. Design detail

### 4.1 Casting layer

Step roles. Every pipeline step gains a semantic `role` from a fixed vocabulary: `scene_brief`, `draft`, `improve`, `rewrite`, `humanize`, `intimacy`, `editorial`, `analysis`, `research`, `bible`, `outline`, `plan`, `format`, `marketing`, `continuity`. The prose-voice set is exactly `{scene_brief, draft}`.

Casting sheet, one per genre, at `library/casting/<genre>.json`:

- `roleModels`: `role -> { provider, model, temperature }`, seeded from the audited n8n recipe (draft on Opus at temperature 1, improve/rewrite on Gemini, humanize on Gemini or Sonnet, editorial on Sonnet, continuity on a high-reasoning model).
- `heatLadder`: `heat level -> uncensored model`, the `erotica threshold` (the spice level at or above which the intimacy branch always uses an uncensored model), which roles reroute (`draft`, `intimacy`), and the fallback order.
- `proseRoles`: defaults to `{scene_brief, draft}` — the roles the author's intake model choice overrides.
- `ensemblePanel`: default ideation panel, default `[gpt, grok, gemini, claude]`.

Resolver (`castStep`) replaces the current `stepRouting` in `gateway/src/api/routes/_shared.ts` and is called at execution to pick each step's `{ provider, model, temperature }` by precedence, highest first:

1. Spice re-route: a scene flagged over the book's ceiling routes `draft`/`intimacy` to the uncensored model (see Section 4.2 for the Claude-first refinement — this precedence entry governs escalation and the optional policy pre-route).
2. Manual per-step `modelOverride` (the existing hand-pin escape hatch).
3. The author's prose-model pick, applied to `proseRoles` only.
4. The genre casting-sheet default for the role.
5. Tier routing fallback (`TASK_TIERS`/`TIER_ROUTING`).

Model-ID validation: the resolved model ID is format-validated at cast time (control characters, whitespace, URL metacharacters, path traversal, length). An invalid or stale slug (for example the aspirational `opus-4.8`-style pins present in ported JSON) is dropped, falls back to a role-appropriate default, and logs a warning; it does not error the run. Live provider-catalog validation is deferred to the provider-call layer, not performed by the resolver.

Migration: a one-time pass tags existing library-pipeline steps with roles, inferring from `skill`/label where unambiguous. Backward-compatible: a step with no `role` and an existing `modelOverride` behaves exactly as today.

### 4.2 Content axes and spice routing

Three independent axes:

- Spice (intimacy), 0-10.
- Violence/gore, 0-10 (swearing at the scene level rides with spice).
- Profanity, a per-character voice trait (see below), independent of the book's heat.

Author-branded ceiling. Spice and violence ceilings live on the author profile as `contentBrand: { spiceCeiling, violenceCeiling }`. A book inherits the ceiling from its bound author at creation and may override per book. This keeps an author's catalog consistent (Author A fade-to-black, Author B explicit) without re-setting it each time.

Per-scene classifier. A new `heat_check` role step is injected into the per-chapter loop after `scene_brief` and before `draft`. It runs on the scene brief (intent, before prose) on a fast cheap model and emits `{ spice, violence }` 0-10 for that scene. Its output drives two things:

1. Model routing (see below).
2. Prompt intensity: the score plus the ceiling shape the draft prompt. The ceiling clamps: a scene classifying hotter than the book's ceiling is written to the ceiling, never past it.

Intimacy branch with tiered model routing. On-page intimate content always runs through a dedicated intimacy branch with a specialized prompt, distinct from the normal draft path. Claude requires very specific framing to write these scenes, so an intimate scene is never handled by the ordinary draft step; it always branches. `heat_check` detects the intimacy, and the branch fires whenever the book's ceiling permits on-page intimate content. The model within the branch is chosen by the effective spice level (`min(scene score, ceiling)`):

1. Fade-to-black (the default, and any sweet or low-ceiling author brand): no on-page branch; the scene is drafted with a fade-to-black close.
2. On-page intimate, below the erotica threshold: the intimacy branch runs on the pinned intimacy model (Claude) with the specialized intimacy prompt. On refusal or underdelivery, escalate that scene to the uncensored tier. The refusal detector reuses the empty-completion signal added in the bug-review batch (`completeClaude` now throws on an empty completion), so a refusal surfaces cleanly.
3. Erotica-level (at or above the erotica threshold): the intimacy branch routes directly to an uncensored model (Grok or Venice). At this level Claude reliably refuses, so it is skipped rather than attempted. This is a required route, not an optimization.

The erotica threshold is a configurable point on the 0-10 spice scale, defined per genre in the casting sheet's heat ladder.

Uncensored tier. Leads with Grok and Venice (Venice is OpenRouter's free Dolphin-tuned uncensored 24B). The book stores a chosen `uncensoredProvider` (`grok`, `venice`, or `auto`). Fallback ladder on unavailability or over-budget: Grok, then Venice, then local Dolphin/Hermes via Ollama; if none is available, pause that chapter for human review rather than ship a refused or censored draft.

Emotional-framing intimacy templates, per genre, at `library/craft/intimacy/<genre>.md`. These deliver the 90 percent Claude success rate and are tunable alongside the casting sheets.

Profanity as a character-voice axis. The character-bible entry gains `profanity: { level: 0-10, contexts: [private, high-stress, banter], register }`. When a scene includes that character, the trait is injected into the Scene Brief and First Draft prompts with an explicit instruction to render authentic profanity in that character's voice and not sanitize. Verification: `dialogue-auditor` is extended to flag when a high-profanity character's lines came back sanitized, triggering a targeted re-gen of just those lines; the anti-slop/humanize gate is given a whitelist so it never strips in-character profanity. Profanity alone does not route to the uncensored tier — mainstream models handle it — unless a specific model demonstrably softens it.

Safety floor (non-negotiable, independent of any ceiling):

- A hard banned-content check (no CSAM, no non-consent) runs regardless of settings; existing injection and confirmation guards still apply.
- A consequence-vs-procedure guardrail for dark technical content: draft and research prompts are framed to dramatize plausible surface and consequences, never operational, reproducible steps. A light post-check flags a draft that crossed into actionable instructions (real exploit code, synthesis or procedure steps) and abstracts it. This protects the maintainer's own stated line ("realistic, not a how-to manual") and reduces platform risk.

### 4.3 Pipeline shape: per-genre bases plus shared wrappers

Per-genre bases are kept and enhanced, not collapsed into one skeleton:

- Romance: `romance-sweet`/`romance-spicy` base; `romancing_the_beat` structure; intimacy templates central.
- Romantasy: `romantasy` base; worldbuilding-heavier bible.
- Mundane science fiction: `MSF` base; its ensemble ideation and bible-merge preserved.
- Near-future techno-thriller: a new base adapted from MSF — research-heavy, a tension structure (for example Lester Dent or seven-point), the violence axis and the consequence-vs-procedure guardrail prominent.

Adding a genre later is a casting sheet plus templates plus a structure default plus, optionally, a tweaked base — not a from-scratch pipeline.

Shared wrappers, applied uniformly to every genre base:

1. Grounding research (front): a research phase using `ResearchGate` and `research-lookup` (Perplexity), with the `research` role pinned to a permissive model for dark genres. It writes cited facts to `workspace/research/` and injects them into the bible so worldbuilding is grounded, not invented.
2. Rolling-summary memory: a four-tier continuity object (recent chapters high-fidelity, arc beats, macro events, entity registry) feeds every chapter draft instead of raw prior text. This is also part of the consistency spine (Section 4.7).
3. Analyze-then-apply polish (back): `craft-critic`, `dialogue-auditor` (now profanity-aware), and the `beta-reader` panel run automatically; their structured flags feed targeted apply-edit passes, replacing today's "emit notes a human must action." Continuity flags (Section 4.7) are one category of these flags.
4. Human gates (Section 4.5) and casting/heat/profanity routing (Sections 4.1-4.2).

### 4.4 Ideation ensemble (opt-in)

An opt-in ideation phase, off by default, available to any genre. When enabled it fans one prompt out to a panel of models, each given a distinct creative angle, then a judge/selector step chosen to preserve divergence picks or blends the best pitch. Default panel `[gpt, grok, gemini, claude]`, overridable per book.

Built in-house, not via OpenRouter Fusion. Fusion is a live API feature but its judge is designed for consensus/convergence (research questions, "compare and contrast"), which is the opposite of divergent creative ideation; using it as a raw fan-out still incurs a mandatory judge cost and still requires writing our own creative selector. BookClaw's router already calls all these providers, so the fan-out is inexpensive to build. (Fusion remains a candidate later for genuinely consensus-oriented steps such as logic-gate/continuity validation or research fact-checking.)

### 4.5 Human review gates

Reuses `ConfirmationGateService` and the Human-Review pause; no new gate machinery.

- Cadence config on the book (`review.cadence`), inherited from an author/genre default, overridable per book: `per_act` (default), `per_chapter`, `outline_only`, `autonomous`.
- Always-on gates regardless of cadence: after outline approval, and before export/publish.
- `per_act`: pause at each act/phase boundary and approve that act's chapters as a batch before the next act drafts.
- `per_chapter`: pause after each chapter.
- `autonomous`: only the two always-on gates.
- Gate actions: approve and continue; edit-in-place then continue (edits become canon and feed the rolling summary and fact ledger); regenerate, optionally with a note injected into the retry; or stop.
- Automated pre-gates run first and cheaply: the anti-slop/vocabulary gate, the heat-ceiling clamp check, the craft-critic flags, and the continuity check (Section 4.7). A chapter or act that reaches a human is already mechanically clean and arrives annotated with the critics' findings.
- Concurrency-safe: the per-project drive lock guarantees a book paused at a gate is not double-driven; other books continue.

### 4.6 Concurrency and cost control

- Global concurrency cap `maxConcurrentDrives`, default 3, live-adjustable in Settings (same pattern as the cost limits). A global semaphore and queue over the existing per-project drive lock: books past the cap are `queued` and auto-start when a slot frees. Implemented as a small scheduler on `ProjectEngine`.
- Cost control reuses `CostTracker` (daily/monthly limits, live-updatable). Optional per-book budget so one book cannot eat the whole daily cap. When a cap trips, in-flight books pause gracefully at the next chapter boundary with a human-review notice rather than fail mid-chapter.
- Per-provider throttle (optional, config): a max-in-flight-calls-per-provider limit so several books' drafts plus an ensemble fan-out do not collectively trip a provider's rate limit. The router already retries on 429; this prevents the storm.
- Cross-book fleet view: one dashboard panel showing every book's state (running, queued, paused-for-budget, paused-for-review).
- Scaling note: the gateway is I/O-bound (a book in flight is mostly an await on a provider call), so raising the cap is a Settings change and degrades gracefully (extra books queue on provider slots). The one ceiling to watch beyond roughly ten concurrent books is single-writer contention on the shared consistency and memory-search SQLite databases; addressable then with WAL mode or per-book databases, not built now.

### 4.7 Consistency as the canon spine

The consistency engine (`consistency/fact-store`, the Character Knowledge Matrix, Selective Exclusion, red-herring warnings, and `consistencyAudit`) is wired into every phase rather than left as an on-demand endpoint.

- Seed (bible phase): the fact ledger and knowledge matrix are built from the bible and character docs, grounded by the front-end research. This is the source of truth.
- Pre-draft prevention (per-chapter loop): before chapter N drafts, inject the relevant canon plus the knowledge matrix (what each character knows at this point) plus forbidden moves (do not reveal X before chapter Y) into the Scene Brief/Draft via the `book-canon` block and Selective Exclusion. Contradictions are prevented at the prompt.
- Post-draft detection (per-chapter pre-gate): extract the chapter's new facts and update the ledger and matrix; a `continuity` check flags contradictions (physical-detail flips, a character in two places, a character acting on information they do not have, an early mystery reveal via the red-herring warning). Flags feed the analyze-then-apply polish as targeted re-gens, so fixes land in the prose.
- Act-boundary gate: each per-act human gate surfaces a cross-chapter continuity mini-audit, so an act is approved knowing it is canon-clean.
- Full audit (pipeline end and standalone): the complete `consistencyAudit` runs before export, guarded by the job registry. It is also a standalone pass on any book or imported manuscript: import a manuscript, rebuild the ledger chapter by chapter, and report contradictions, timeline breaks, knowledge violations, and unresolved threads. This is the path for auditing the maintainer's manually-written back catalogue.
- Casting: the `continuity` role pins to a high-reasoning model (Gemini/DeepSeek/Claude/Kimi) and, per the model-selection guard already shipped, never silently falls back to Ollama when a large-context provider is available. Tunable per genre in the casting sheet.

## 5. Data model summary

- Author profile: add `contentBrand: { spiceCeiling: number, violenceCeiling: number }`.
- Character bible entry: add `profanity: { level: number, contexts: string[], register: string }`.
- Book manifest: add `contentCeiling: { spice, violence }` (inherited from author, overridable), `uncensoredProvider: 'grok' | 'venice' | 'auto'`, `review.cadence`, the chosen prose `model`, `ensemble: { enabled: boolean, panel: string[] }`, and optional `costBudget`.
- Pipeline JSON steps: add `role`.
- Casting sheets: `library/casting/<genre>.json` (`roleModels`, `heatLadder`, `proseRoles`, `ensemblePanel`).
- Intimacy/emotional-framing templates: `library/craft/intimacy/<genre>.md`.
- Config: `maxConcurrentDrives` and the per-provider throttle (live-adjustable).

## 6. New and changed components

- `castStep` resolver (replaces/extends `stepRouting` in `_shared.ts`).
- `heat_check` scene classifier step and role.
- Ideation ensemble fan-out and divergence-preserving selector.
- Analyze-then-apply polish wiring (chains existing `craft-critic`, `dialogue-auditor`, `beta-reader` into targeted apply-edit passes).
- Cross-book scheduler on `ProjectEngine` (semaphore, queue, cost-boundary pause).
- Refusal/underdelivery detector for spice escalation (reuses the empty-completion signal).
- Consistency-spine wiring across bible, per-chapter, act-gate, and export phases; standalone import-and-audit path.
- New near-future techno-thriller base pipeline plus four genre casting sheets and intimacy templates.
- `dialogue-auditor` extension for profanity fidelity; anti-slop whitelist for in-character profanity.
- Cross-book fleet view (dashboard).

## 7. Testing strategy

Following the repository's `node --import tsx --test` unit style plus the smoke test:

- Unit (pure logic): `castStep` precedence across all five levels including spice-beats-pin; heat-ceiling clamp math; role-inference migration; profanity injection into prompts; ensemble selector; scheduler queue and semaphore; cost-pause-at-boundary; refusal-detector escalation.
- Fixtures: one valid casting sheet per genre (roles and models validated).
- Integration: consistency spine round-trip (seed from bible, pre-draft injection, post-draft extraction, contradiction flag, standalone import-and-audit).
- Smoke: a stubbed-provider end-to-end run of one short book proving gates fire, routing casts correctly per role, a simulated refusal escalates to the uncensored tier, and the pre-export consistency audit runs.

## 8. Open items and phasing

- Sub-project 2 (separate spec): the Smart Intake Wizard — expand Easy Start from title/premise/pick-a-bundle into an interview (genre, structure, author identity and writing style, prose model, spice/gore ceiling, gate cadence, ensemble toggle) that configures and launches this engine.
- Deferred: OpenRouter Fusion for consensus-oriented checks; scaling past ten concurrent books (WAL or per-book databases).
- Suggested build order within Sub-project 1: (1) casting layer and resolver plus role migration; (2) content axes, `heat_check`, and spice routing with intimacy templates; (3) consistency-spine wiring; (4) enhancement wrappers (research front, rolling-summary memory, analyze-then-apply polish); (5) gates cadence config; (6) scheduler and cost control; (7) the new techno-thriller base and per-genre casting sheets; (8) opt-in ideation ensemble.
