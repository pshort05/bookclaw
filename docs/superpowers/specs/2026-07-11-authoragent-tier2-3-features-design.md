# AuthorAgent Port — Tier 2 + Tier 3 Features (items #4–#9)

**Date:** 2026-07-11
**Source:** `docs/AUTHORAGENT-PORT-ANALYSIS-2026-07-11.md`, items #4–#9. Fork ref: `authoragent/main` (common ancestor `6573d23`).
**Baseline:** `T2-BASE = 85b1e2ded754b03ad2b830a2a028c1b13d6247b5` (HEAD `b7562ce`).

## Purpose

Port the six highest-value remaining AuthorAgent features into BookClaw, adapting each to BookClaw's actual service topology (the fork's producers and container do not exist here). All six are grounded in the fork's real code, verified against our integration-point signatures. Tier-1 hardening (items #1–#3) shipped in `b7562ce`.

Each feature is opt-in or fail-soft: none changes existing behaviour for the 23 production books unless explicitly invoked. Legacy execution paths stay byte-identical.

---

## #4 Prose-Evolver (PORT)

A GEPA-style *score → reflect → revise* loop that iteratively improves a prose passage against our existing `WritingJudgeService`, keeping only non-regressing revisions (Pareto floor).

### Interface

New file `gateway/src/services/prose-evolver.ts` — a stateless singleton; all deps passed per call.

```ts
export interface EvolveInput {
  text: string;
  brief?: string;              // what the passage is trying to do
  rounds?: number;             // default DEFAULT_ROUNDS=3, clamp [1, MAX_ROUNDS=5]
  bookSlug?: string;           // for SoulService.getFullContext / composeForBook
}
export interface EvolveRound { round: number; score: number; text: string; reflection: string; accepted: boolean; }
export interface EvolveResult {
  finalText: string; baselineScore: number; finalScore: number;
  rounds: EvolveRound[]; improved: boolean; stoppedReason: 'plateau'|'max-rounds'|'no-improvement';
}

export class ProseEvolverService {
  async evolve(
    input: EvolveInput,
    judge: WritingJudgeService,
    soul: SoulService,
    aiComplete: AICompleteFn,
    aiSelectProvider: AISelectProviderFn,
  ): Promise<EvolveResult>;
}
```

### Constants / algorithm

- `DEFAULT_ROUNDS=3`, `MAX_ROUNDS=5`, `CALLS_PER_ROUND=3` (reflect + revise + re-judge), `PLATEAU_STOP=2` (stop after 2 consecutive non-improving rounds).
- Baseline: `judge.evaluate(text)` → score. Each round: AI reflects on the judge findings, AI revises, re-judge. Accept the revision only if its score `>=` the best-so-far (no-regression Pareto floor); otherwise keep the incumbent and count a plateau.
- Uses `WritingJudgeService.evaluate` (our existing signature) + `SoulService.getFullContext`/`composeForBook` for voice grounding. **Drop the fork's `MemoryTierService` dependency** (we have no tier service; voice comes from Soul).

### Wiring

- Instantiate in `gateway/src/init/phase-07-knowledge.ts`; add `proseEvolver` field on the gateway + `getServices()` entry.
- Route `POST /api/prose/evolve` in `gateway/src/api/routes/knowledge.routes.ts` (503 if service absent; validates `text` non-empty).
- MCP tool `evolve_prose` in `mcp/src/tools/craft.ts` (lockstep with the route).

---

## #5 Reader-Panel (PORT)

A simulated reader panel that ranks candidate marketing copy (blurbs, hooks, titles) via multiple personas with anti-slop guards. Distinct from `beta-reader.ts` (which critiques manuscript prose) — no overlap.

### Interface

New file `gateway/src/services/reader-panel.ts` (~777 lines, dependency-free logic; **per-call AI functions**, the beta-reader pattern, NOT constructor injection).

```ts
export type PanelKind = 'blurb'|'hook'|'title'|'opening';
export type PanelFormat = 'rank'|'score';
export interface ReaderPersona { id: string; label: string; lens: string; }
export interface CandidateRanking { candidate: string; index: number; score: number; rationale: string; }
export interface PanelReport {
  kind: PanelKind; format: PanelFormat;
  rankings: CandidateRanking[]; winnerIndex: number;
  confidence: number; notes: string[];
}

export class ReaderPanelService {
  async runPanel(
    kind: PanelKind, candidates: string[], personas: ReaderPersona[] | undefined,
    aiComplete: AICompleteFn, aiSelectProvider: AISelectProviderFn,
  ): Promise<PanelReport>;
}
```

### Anti-slop guards (ported verbatim)

- **Position-bias swap:** re-run with candidate order reversed; discard if the winner flips (records low confidence).
- **Score-clustering:** if all scores fall within a tight band, flag low-confidence.
- **Jaccard repetition:** detect near-duplicate rationales (persona collapse).
- **Confidence** aggregated from the above.

### Wiring

- New route file `gateway/src/api/routes/reader-panel.routes.ts` exporting `mountReaderPanel(app, gateway, baseDir)`; register the mount in `gateway/src/api/routes.ts`.
- `readerPanel` field on the gateway + `getServices()`; instantiate in `phase-07-knowledge.ts`.
- MCP tool `run_reader_panel` in `mcp/src/tools/marketing.ts`.

---

## #6 Conductor (ADAPT) — HIGHEST RISK

A dependency-DAG bounded scheduler for pipeline steps. Replaces the current unbounded `Promise.all` frontier fan-out with a bounded race-supervisor that respects declared step dependencies. **Opt-in per pipeline; legacy books byte-identical.**

### Data model

Add an **additive** optional field to `ProjectStep` (`gateway/src/services/projects.ts:106`):

```ts
dependsOn?: string[];   // absent on all 23 legacy books → they take today's exact path
```

### Dependency derivation

New file `gateway/src/services/pipeline/derive-deps.ts`:

```ts
export function deriveDependencies(steps: ProjectStep[]): void; // mutates steps[].dependsOn in place
```

Rules (ported from the fork):
- **(a)** chapter-write `ch-N` depends on chapter-write `ch-(N-1)` (sequential drafting);
- **(b)** review/polish steps depend only on their own write step;
- **(c)** any other step depends on the immediately preceding step;
- **(d)** a terminal/compile step depends on all upstream steps.

Called at materialization **only** when `pipeline.conductor === true` AND no `parallelGroup` is present on any step. Otherwise `dependsOn` stays undefined and nothing changes.

### Engine methods (`projects.ts`)

- `activateStep(project, step)` — move a pending step to active.
- `completeStepBare(project, step, output)` — `completeStep` minus the auto-advance block (current `completeStep` lines 1360–1373); the conductor drives advancement itself.
- `normalizeActiveToPending(project)` — reset a stuck active frontier on resume.
- Split `startAndRunProject(...)` to accept `{ advance?: boolean }` (default `true` = legacy). When `advance:false`, it runs one step and returns without cascading — the conductor owns the cascade.

### Conductor drive (`index.ts`)

Replace the unbounded frontier fire at `index.ts:2778-2784` (`Promise.all(frontier.map(...))`) with a bounded race-supervisor `conductorDrive(project)`:

- Runs **inside** the existing `DriveScheduler` `acquireDrive` slot (`index.ts:2739`) — no new global concurrency.
- Gated on `steps.some(s => Array.isArray(s.dependsOn))`; if false, falls through to the legacy path unchanged.
- Concurrency from `BOOKCLAW_CONDUCTOR_CONCURRENCY` env, default `2`, clamp `[1,3]`.
- Runnable = pending steps whose `dependsOn` are all complete. Fire up to the concurrency cap; as each finishes (`Promise.race`), recompute runnable and refill. FIFO memory ordering (`enqueueSerial`).
- **Failure isolates:** a failed step does not abort siblings already in flight; downstream dependents stay blocked, surfaced as blocked (existing error semantics).

### Selection gate

Opt-in requires `pipeline.conductor === true` in the pipeline template AND no `parallelGroup`. The 23 existing books have neither → unreachable for them, path byte-identical.

### Tests

- `tests/unit/derive-deps.test.ts` — rules (a)–(d) on synthetic step lists.
- `tests/unit/conductor-drive.test.ts` — bounded concurrency, dependency ordering, failure isolation, legacy pass-through, using a **fake engine** (no real AI).

---

## #7 Learn-From-Experience Loop (ADAPT)

Turns recurring quality-report flags into durable, deduped `LessonStore` lessons (which `buildContext` already injects into prompts). Aggregation is free; at most **one** cheap AI call per cycle; works with zero API keys.

### Interface

New file `gateway/src/services/learning.ts` (~350 ported lines + ~110 adapted):

```ts
export type LearnReportType = 'craft'|'dialogue'|'continuity';
export interface LearnReportInput { type: LearnReportType; report: CraftReport|DialogueReport|ContinuityFlag[]; }
export interface LearnFromReportsInput { projectId?: string; reports: LearnReportInput[]; }
export interface DetectedPattern { key: string; kind: LearnReportType; label: string; count: number; severity: 'error'|'warning'|'info'; lessonCategory: string; sample?: string; }
export interface LearnOutcome { projectId?: string; generatedAt: string; patternsFound: DetectedPattern[]; lessonsAdded: Lesson[]; lessonsSkippedDuplicate: Lesson[]; summary: string; }

export class LearningService {
  constructor(private lessons: LessonStore) {}
  async learnFromReports(input: LearnFromReportsInput, aiComplete?: AICompleteFn|null, aiSelectProvider?: AISelectProviderFn|null): Promise<LearnOutcome>;
  detectPatterns(reports: LearnReportInput[]): DetectedPattern[];
  // craftCritic/dialogueAuditor are injected as args (the ctor only needs lessons); the
  // completion hook and /learn route pass gw.craftCritic, gw.dialogueAuditor.
  async learnFromProject(project: LearnableProject, gatherChapters: GatherChaptersFn, craftCritic: CraftCriticLike, dialogueAuditor: DialogueAuditorLike, aiComplete?: AICompleteFn|null, aiSelectProvider?: AISelectProviderFn|null): Promise<LearnOutcome>;
}
```

### Algorithm (three stages, never throws)

- **(a) Pure-code aggregation** — `detectPatterns` folds findings into a `Map<key, DetectedPattern>`, per-entry `try/catch`. Adapters for **our** producers:
  - `foldCraft(CraftReport)` — key `craft:${f.category}`, `lessonCategory 'writing_quality'` (CraftFlag.category is a clean 9-value enum).
  - `foldContinuity(ContinuityFlag[])` — key `continuity:${f.kind}`, severity defaults `'warning'` (ContinuityFlag has no severity), `'writing_quality'`.
  - `foldDialogue(DialogueReport)` — key `dialogue:${f.speaker}::${issue}`, `'style_voice'`. `issue` derived by sniffing the three known `dialogue-auditor.ts` reason templates (`unusually casual|formal` → `voice-formality`; `much longer|shorter than usual` → `line-length`; `possible sanitization` → `profanity-sanitization`; else `voice-mismatch`). **Brittle to wording changes in `dialogue-auditor.ts`** — degrades gracefully to `voice-mismatch`; add a cross-reference comment there.
- **(b) One optional AI phrasing call** — patterns with `count >= MIN_PATTERN_COUNT (2)`, sorted severity→count, capped `TOP_N_PATTERNS (6)`. `phrasePatterns()` makes at most one free-tier call (`aiSelectProvider('general')`). Any failure → `deterministicLesson(pattern)` fallback (built from counts).
- **(c) Dedup-aware store writes** — stable provenance tag `[learned:${kind}/${key-suffix}]` per pattern. `findDuplicate()` scans `lessons.getAll()`; match → `adjustConfidence(id, DEDUP_BUMP=+0.05)`; no match → `addLesson(..., source:'self-critique')` with recurrence-weighted confidence (`BASE 0.5` + up to `+0.2`, cap `MAX_LEARNED_CONFIDENCE 0.75`).

### Wiring

- Instantiate `gw.learning = new LearningService(gw.lessons)` in `phase-07-knowledge.ts` next to `gw.lessons`.
- Extend the **existing** completion hook in `phase-06-content.ts:91-137` (same `book-production||deep-revision` guard the consistency audit uses), fire-and-forget + fail-soft:
  ```ts
  if (gw.learning && (project.type === 'book-production' || project.type === 'deep-revision')) {
    void gw.learning.learnFromProject(project, gatherChapters,
      (req) => gw.aiRouter.complete(req), (t) => gw.aiRouter.selectProvider(t))
      .catch((err) => console.log(`  ℹ Learning cycle skipped for "${project.id}": ${err?.message || err}`));
  }
  ```
  `learnFromProject` gathers chapters via the existing `gatherChapters` closure, re-runs `craftCritic.analyze` once + `dialogueAuditor.audit` per chapter (both zero-AI heuristics) + folds `project.steps[].continuityFlags`, then calls `learnFromReports`.
- Optional debug route `POST /api/projects/:id/learn` in the wave routes (sibling of `craft-critique`), 503/404 guarded.
- No cron; project-completion-triggered only. **No `LessonStore` changes** (categories `style_voice`/`writing_quality` and source `self-critique` already exist).

### Tests

`tests/unit/learning.test.ts` (temp-dir `LessonStore`): pattern-recurrence→lesson; dedup + confidence bump (no duplicate row); cross-type folding incl. dialogue text-sniffing classification; AI-phrasing fallback (throwing + malformed-JSON both fall back, same provenance tag); fail-soft on malformed entry.

---

## #8 Writing-Stats Backend (PORT)

Persisted streak / week / total word counts, fed from the existing heartbeat word-count choke point.

### Interface

New file `gateway/src/services/writing-stats.ts`:

```ts
export interface WritingStatsSnapshot {
  wordsToday: number; wordsThisWeek: number; wordsTotal: number;
  currentStreakDays: number; longestStreakDays: number;
  activeProjects: number; lastActiveIso: string;
}
export function computeStreaks(days: string[]): { current: number; longest: number };  // exported, pure
export class WritingStatsStore {
  constructor(rootDir: string);
  async recordWords(count: number): Promise<void>;
  getSnapshot(activeProjects: number): WritingStatsSnapshot;
}
```

- Persisted at `workspace/data/writing-stats.json` (`ROOT_DIR` from `gateway/src/paths.ts`). Local `writeFileAtomic` helper (pattern from `book.ts:115`).
- Ported verbatim except: local atomic-write helper + workspace path source.

### Wiring

- `HeartbeatService` optional 3rd ctor arg `workspaceDir?` (`heartbeat.ts:108`), field `private stats: WritingStatsStore | null`.
- Choke point `addWords` (`heartbeat.ts:698`, sole caller `index.ts:2646`) fires `recordWords` fire-and-forget. Add `getWritingStats(activeProjects)`.
- **Backward compat:** `null` stats degrades to today's in-memory behaviour (keeps `heartbeat-score.test.ts` passing).
- Routes `GET /api/writing/stats` + `POST /api/writing/log-words` (200k/entry cap) in `heartbeat.routes.ts`; enrich `/api/agent/status`.
- Construction in `phase-10-heartbeat-bridges.ts:19`.

### Tests

`tests/unit/writing-stats.test.ts` — `computeStreaks` (contiguous, gap-broken, empty), `recordWords` accumulation + persistence round-trip, `getSnapshot` week/today rollover, null-store degradation.

---

## #9 Archival-Recall in Chat (ADAPT)

Splice memory-search (FTS) hits into the chat system prompt so past work informs replies. Chat-only. Skips the fork's total-budget cascade (no CORE digest port — our rolling-summary covers it).

### Interface

New file `gateway/src/services/archival-recall.ts`:

```ts
export function buildArchivalBlock(hits: SearchHit[], budgetChars?: number): string; // pure; ARCHIVAL_BLOCK_CAP=1800
```

- Heading `# From Your Past Work`; whole-hit-or-skip packing within the char budget; returns `''` when no hits fit.

### Wiring (`index.ts`)

- Add `userMessage?: string` to the `buildSystemPrompt` context type + the `handleMessage` call site (`index.ts:813`).
- Splice after the memories block (`~index.ts:1262`), **synchronous** (`memory-search.search` is sync):
  ```ts
  if (context.userMessage && this.memorySearch?.isAvailable()) {
    const hits = this.memorySearch.search(context.userMessage.trim(),
      { limit: 4, personaId: this.memory.getActivePersonaId() ?? undefined });
    const b = buildArchivalBlock(hits);
    if (b) prompt += b + '\n\n';
  }
  ```
- Debug log the hit count (for smoke visibility).
- **Known limitation (flag for review):** unscoped `manuscript`/`project_step` hits could surface across personas if the FTS index lacks a persona scope for those source types. Note it; do not over-engineer.

### Tests

`tests/unit/archival-recall.test.ts` — `buildArchivalBlock` heading/format, whole-hit-or-skip budget, empty-on-no-hits.

---

## Cross-cutting: shared-file conflict map

Parallel implementation must respect shared hot files:

| File | Touched by |
|------|-----------|
| `gateway/src/index.ts` | #4 (register), #5 (register), #6 (conductorDrive + startAndRunProject), #9 (buildSystemPrompt splice) |
| `gateway/src/services/projects.ts` | #6 (ProjectStep + engine methods) |
| `gateway/src/init/phase-07-knowledge.ts` | #4, #5, #7 (instantiate) |
| `gateway/src/api/routes.ts` | #5 (mount) |

`#8` is fully self-contained (heartbeat cluster + its own routes + phase-10). Execution sequences the shared-file wiring to avoid clobbering (see plan).

## Success criteria

1. Each feature's unit tests pass in isolation (`node --import tsx --test tests/unit/<file>.test.ts`).
2. `npx tsc --noEmit` clean.
3. Existing `heartbeat-score.test.ts` + `skill-match-cap.test.ts` still pass (no regression).
4. The 23 legacy books' execution path is byte-identical (no `dependsOn`, no `conductor` flag).
5. Code review: all Medium+ findings fixed.
6. Smoke tests cover each new feature's live surface; pass against Mercury.
7. Deployed to Mercury; `commit_message` written; pushed.
