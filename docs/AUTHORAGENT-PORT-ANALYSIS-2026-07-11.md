# AuthorAgent Fork — Port-Forward Analysis (2026-07-11)

Review of the sibling fork **AuthorAgent** (`Ckokoski/AuthorAgent`, branch `main`) against this
BookClaw tree, to determine which of its changes should be pulled forward. Items are ranked most to
least impactful.

Compare source: `https://github.com/pshort05/bookclaw/compare/main...Ckokoski:AuthorAgent:main`

## Method

The AuthorAgent `main` branch was fetched locally as ref `authoragent/main`. Its code was read
directly (`git show authoragent/main:<path>`) and compared, feature by feature, against the current
BookClaw tree. Five reviewers covered distinct clusters (craft/quality, memory/learning,
architecture/parallelism, infrastructure/security, UI/UX); their findings are synthesized here.

## Divergence summary

Both forks descend from common ancestor `6573d23` ("Website management: registry + auto-add-book +
blog drafter + deploy adapters").

- **AuthorAgent** is ahead by 45 commits (reader-feedback moat, parallel conductor engine, tiered
  memory, GEPA prose evolution, character/reader agents, contradiction detection, a god-class
  refactor, a vitest suite, and a vanilla-JS dashboard redesign).
- **BookClaw** is ahead by 258 commits (the Flagship Pipeline Engine, the full Romance Workflow
  Foundation → Guided → Council → Adaptive, the v6 React studio replacing the old dashboard, and the
  entire `BOOK-GENERATION-REVIEW-2026-07-10` bug batch).

Because both evolved independently, much of AuthorAgent's work is already covered by BookClaw's own
divergence. The value is concentrated in the genuinely-new capabilities and in the few places
AuthorAgent hardened something BookClaw did not. The most important distinction below: several items
are not new features at all but **fixes to live defects in the current BookClaw tree** that
AuthorAgent already solved — these outrank the feature ports.

## Verdict key

- **PORT** — drop in largely as-is (standalone, low conflict).
- **ADAPT** — take the idea/algorithm and reimplement against BookClaw's architecture.
- **SKIP** — already covered by an equal-or-better BookClaw implementation, or not applicable.

---

## Tier 1 — Live defects in the current tree (do first; low effort)

> **Status: DONE (2026-07-11).** All three shipped via spec → plan → TDD → code review → smoke; see
> `docs/COMPLETED.md` (2026-07-11) and
> `docs/superpowers/{specs,plans}/2026-07-11-authoragent-tier1-hardening*`.

These are confirmed problems in BookClaw today that AuthorAgent already fixed. They rank above new
features because they are defects, not enhancements.

### 1. Skill-match token cap — PORT — Low effort
`gateway/src/skills/loader.ts` `matchSkills()` has no cap: it injects the full markdown of every
trigger-matched skill (several romance skill files run 15–23 KB) into every chat prompt, unbounded
and untracked. A message matching 3–4 skills silently adds tens of thousands of tokens. AuthorAgent's
fix ranks matches, caps to top-N, and applies a character budget. Live cost/latency bug.

### 2. `.gitignore` deny-by-default for `workspace/` — PORT — Low effort
BookClaw uses an allow-list of specific `workspace/` subdirectories. Confirmed via `git check-ignore`
that several runtime directories (`workspace/images/`, `workspace/.import-staging/`,
`workspace/character-voices/`, `workspace/plot-promises/`, `workspace/website/`) are currently
untracked but **not** ignored by any rule. They are empty today, but the only commit path (`push.sh`)
runs `git add .`, so any future write into them would be swept into version control. AuthorAgent flips
`workspace/` to deny-by-default (`workspace/*` plus targeted `!workspace/<shipped-default>`
re-includes). The re-include list must be verified against BookClaw's actual shipped-default files
(`workspace/soul/`, `workspace/SKILLS.txt`, template dirs) before applying.

### 3. Injection-detector severity model (fiction scoping) — ADAPT — Medium effort
`gateway/src/security/injection.ts` is a flat boolean scanner that hard-blocks on any match, live in
two production paths: chat message handling (`index.ts`) and the library/book import gate. Manuscript
prose such as "you are now in the throne room" matches the `role_hijack` pattern and gets the entire
message or import blocked — a false-positive class that is worse for a fiction-writing tool.
AuthorAgent adds a severity model: manuscript/writing-channel prose is downgraded to warn + audit +
caution-note, while exfiltration, RCE, and hidden-HTML patterns still hard-block. Adapt to BookClaw's
channel model (Telegram/Discord/dashboard chat all share `handleMessage`); do not copy verbatim.

---

## Tier 2 — High-value new capabilities (mostly drop-in on existing services)

### 4. `prose-evolver.ts` (GEPA-style reflective polish loop) — PORT — Low effort
Iterative score → reflect → revise loop that uses BookClaw's existing `writing-judge.ts` as the
fitness function, rotating through craft lenses, with a strict no-regression (Pareto) rule and
early-stop after two non-improving rounds (~3 AI calls/round). BookClaw's judge currently does only a
single modify-evaluate-retry, so this is a genuinely new sentence-level quality lever. Depends only on
`writing-judge.ts`, `soul.ts`, and memory services that already exist with matching shapes — close to
a drop-in. Highest craft-quality-per-effort item.

### 5. `reader-panel.ts` (marketing-copy A/B tournament) — PORT — Low effort
A simulated reader-persona tournament for candidate blurbs, titles, cover concepts, or premises,
distinct from BookClaw's `beta-reader.ts` (which reviews the manuscript). Includes well-designed
anti-slop safeguards: position-bias mitigation (candidate order swapped per persona), score-clustering
checks, Jaccard repetition detection, and an aggregate confidence score. Fills a real gap in the
marketing/launch toolset. Standalone (takes only AI-completion closures).

### 6. Parallel conductor engine (dependency-DAG scheduling) — ADAPT — Medium effort
Auto-derives a `dependsOn` DAG from step semantics (chapter write ch-N depends on write ch-N-1;
a chapter's review/polish depends only on its own write; terminal phases depend on all upstream
writing) and runs a bounded race-based supervisor (concurrency 1–3) that refills slots as steps
finish. This enables diagonal "review chapter N while drafting chapter N+1" pipelining that BookClaw's
declared `{parallel}` / `Promise.all` model cannot express, and it fixes a latent hazard: BookClaw's
group fan-out currently fires unbounded concurrent AI calls (a rate-limit storm on a 20-chapter
`{expand:chapters}` group). Port the roughly 160 lines of algorithm (`deriveDependencies` +
`conductorLoop`) onto BookClaw's `projects.ts`/`activeFrontier` seam, keeping `DriveScheduler` as the
cross-book layer above it. Do **not** adopt the god-class refactor it shipped alongside (see Tier 5).

---

## Tier 3 — Solid value, moderate effort

### 7. `learning.ts` (learn-from-experience loop) — ADAPT — Medium effort
Aggregates recurring craft-flag patterns (count >= 2) from quality-tool reports into lesson text and
writes them to the `LessonStore`. BookClaw already has `lessons.ts` `LessonStore` (shared ancestry
with the fork), and its `buildContext()` already injects high-confidence lessons into the writing
system prompt — but `addLesson` is currently only called manually via `ops.routes.ts`. This closes the
"stop repeating the same mistake across 40 chapters" loop that BookClaw already has half of. Adapt the
aggregation/dedup logic to consume BookClaw's own `consistency/continuity-check.ts`,
`craft-critique`, and `dialogue-audit` outputs rather than porting the fork's three analyzer files.

### 8. `writing-stats.ts` backend (persisted streaks/totals) — PORT (backend) — Low effort
BookClaw's `HeartbeatService` tracks `todayWords` and a streak in-memory only; a process restart zeroes
it, and there are no weekly/total/longest-streak counters. AuthorAgent's `WritingStatsStore` is a
dependency-free, atomically-persisted day→words store with an independently-testable `computeStreaks()`,
slotting into the existing `addWords()` choke point (optional `workspaceDir` arg, fire-and-forget).
Adds `GET /api/writing/stats` and `POST /api/writing/log-words`.

### 9. Archival-recall-in-chat (a slice of `memory-tier.ts`) — ADAPT — Low-Medium effort
BookClaw has `memory-search.ts` (FTS5 BM25) but does not splice it into the chat system-prompt build,
so free-form chat cannot recall against past conversations/manuscripts ("what did we decide about X in
chapter 12?"). Adopt only that splice, reusing the existing `MemorySearchService`. Skip the fork's
materialized CORE digest — BookClaw's `pipeline/rolling-summary.ts` already covers tiered
recent/arc/macro/entity memory for the project-step path.

---

## Tier 4 — Worthwhile, lower priority

| # | Item | Verdict | Rationale |
|---|------|---------|-----------|
| 10 | API-key format validation on vault save | PORT (trivial) | Non-blocking warning when a saved key does not match its provider slot; catches a confusing runtime auth failure early. |
| 11 | `/api/onboarding/status` + Getting-Started card | PORT (backend) + idea | Read-only first-run checklist (provider/voice/soul/project/Telegram). Matches the open TODO on new-user activation; cheaper than the coach-marks alternative. |
| 12 | `character-agent` knowledge-horizon + motivation checks | ADAPT | New craft checks (a character referencing something they could not yet know; off-motivation lines). Skip its off-voice flag — redundant with the deterministic drift detection in `character-voices.ts`. |
| 13 | Translation execution (`executeTranslation`) | ADAPT | Completes a half-built feature: BookClaw currently ships translation planning only (`translation-pipeline.ts` builds a plan; no execute route). Wire to `AIRouter` + `ConfirmationGateService` idioms. |
| 14 | Model-aware pricing table (`pricing.ts`) | ADAPT (table only) | Fixes BookClaw's own acknowledged flat per-provider mispricing (the `#35b` comment in `router.ts` notes it underprices Opus). Feed the per-model table into `CostTracker`'s fallback path; skip the runtime model-picker UI unless separately requested. |
| 15 | Path-safety consolidation (`resolveWithin`/`sanitizeSegment`) | ADAPT | BookClaw has three path-safety implementations, including a weaker `safePath()` in `api/routes/_shared.ts` used at ~25 sites (no null-byte / Windows-reserved-name handling). Consolidate — but preserve BookClaw's superior symlink-escape defense (`realpathSync` in `SandboxGuard`), which the fork's lexical version lacks. |
| 16 | Dialogue-parser deduplication | ADAPT | BookClaw has three drifted copies of paragraph-split/quote-detect/speaker-attribution logic (`character-voices.ts`, `audiobook-prep.ts`, `dialogue-auditor.ts`) — one shares a confirmed untrimmed-name bug. Extract a shared parser mirroring the fork's shape. |
| 17 | `revision-orchestrator` unified report | ADAPT | A thin aggregator/report API over detectors BookClaw already has (`craft-critic`, `dialogue-auditor`, `continuity-check`, `character-voices`, judge `mechanicalScreen`). The value is presentation (queryable severity/pass rollup), not new detection. |

---

## Tier 5 — Low value or skip

- **`reader-feedback.ts` (Royal Road ingestion)** — ADAPT behind a feature flag only. Genuinely
  differentiated (real reader signal) but narrow audience (active serializers) and an ongoing
  HTML-scraping maintenance tax.
- **vitest migration** — Could plausibly eliminate BookClaw's documented Node test-runner IPC flake
  (a different full-suite test fails per run, each passes in isolation). But a full swap is a large,
  separate effort across ~90+ `node --test` files. Pilot the migration on the 2–3 known-flaky files
  first; only commit to the full migration if the flake disappears there.

**Skip outright** (BookClaw already has equal-or-better, or not applicable):

- **`contradiction-detector.ts`** — BookClaw's deterministic `consistency/` ledger engine
  (`fact-store`, `extractor`, `check-engine`) is more rigorous and already pipeline-integrated; the
  fork's single-LLM-call approach is a regression. At most, borrow the STYLE/POV-tense subtype idea.
- **`writing-judge.ts`** — Functionally identical (shared ancestry); BookClaw independently fixed the
  same score-clamping bug and has equivalent test coverage.
- **Leveled logger (`logger.ts`)** — BookClaw's `util/logger.ts` (commit `f491415`) is equal or
  better (named loggers, structured context, `startup()` helper, tests). The fork's `.child()`
  convenience is a minor nice-to-have.
- **`skill-curator.ts`** — Library-hygiene report; lowest relevance to the core long-form-continuity
  goal. Revisit only as the skill catalog grows.
- **Sleep-consolidation CORE digest** — In service of a memory digest that `rolling-summary.ts`
  already covers. Optionally extract only the FTS-reindex pass if archival-recall (item 9) is pursued.
- **God-class refactor** (`container.ts`, `message-pipeline.ts`, split `projects.ts` into
  templates + step-executor, slim `index.ts`) — The target structure is genuinely better than
  BookClaw's un-split ~3,100-line `index.ts` and ~2,500-line `projects.ts`, but importing the fork's
  files is net-negative: they were carved out of a differently-diverged tree, so a wholesale port is a
  hand redo against 258 commits of BookClaw work with near-certain conflicts and zero capability gain.
  If desired, do it as an in-house refactor later — not a port.
- **Routes split into domain modules** — Convergent work; BookClaw already has 27 per-domain modules
  under `api/routes/*.routes.ts`.
- **The "W" dashboard redesign (W0–W7) and Phase 5 dashboard panels** — Target the vanilla-JS
  `dashboard/` that BookClaw retired in favor of the v6 React studio; the code is not portable
  (different stack), and the studio already converged on equivalent-or-deeper solutions: `NewHub.tsx`
  (Easy/Advanced with five entry modes) is a superset of the Start-a-Book wizard (W5); per-route "Make"
  section navigation is more deep-linkable than the Tools-panel tab consolidation (W3); dedicated
  Consistency/Try-Fail/Structure/Reports/Publish routes already surface what the retrofitted
  Craft/Publishing/Quality-Lab panels expose. The genuinely-good ideas within it are captured as the
  backend items above (writing-stats, onboarding-status) plus a few optional UX ideas: a floored
  journey-bar/hero-line on `Write.tsx` (small polish over the existing `PipelineRail`), a Writing
  Momentum home card (pairs with writing-stats), and a global chat drawer (good UX but a high-effort
  architecture decision given BookClaw's separate chat app/process).
- **Rebrand (AuthorClaw → AuthorAgent)** and **bestseller-trends placeholder** — Not applicable
  (fork identity; vendor-specific stub with no working code).

---

## Recommended sequencing

1. **Tier 1 (#1–3)** immediately — small, and they are live bugs/risks in production BookClaw, not
   features.
2. **#4 prose-evolver** and **#5 reader-panel** — highest feature-value-per-effort, near drop-in.
3. **#6 conductor** — the biggest capability win (multi-chapter speedup + fan-out safety), but a real
   medium-effort piece of work.
4. Tier 3 and Tier 4 as capacity allows.

The `authoragent` git remote is left configured locally, so any item can be inspected or pulled with
`git show authoragent/main:<path>`.
