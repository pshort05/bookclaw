# Implementation Plan — AuthorAgent Tier 2+3 Features (#4–#9)

**Spec:** `docs/superpowers/specs/2026-07-11-authoragent-tier2-3-features-design.md`
**Baseline:** HEAD `b7562ce` (T2-BASE `85b1e2d`). Work directly on `main` (sole contributor).

## Global constraints (bind every task)

- **Imports use `.js` extensions** (NodeNext). Node 22, `--import tsx`.
- **No git commits during implementation.** The goal commits once at the end (step 7). Implementers write files + run their unit test + report; they do NOT commit.
- **Injected-AI pattern:** `aiComplete = (req:{provider,system,messages,maxTokens?,thinking?,temperature?}) => Promise<{text}>`; `aiSelectProvider = (taskType) => {id}` (returns an object; call `.id`).
- **Test runner:** Node built-in — `node --import tsx --test tests/unit/<file>.test.ts`. NOT vitest.
- **Fail-soft:** new services degrade, never crash boot. Legacy 23-book path stays byte-identical.
- **No `LessonStore`/schema changes** (#7). No new cron (#7).
- Every changed line must trace to the spec. No speculative features.

## Ground-truth signatures (verify before editing)

- `WritingJudgeService.evaluate(...)` — confirm the exact signature before #4 uses it.
- `SoulService.getFullContext` / `composeForBook` — #4.
- `AICompleteFn` / `AISelectProviderFn` from `gateway/src/services/context-engine.ts` — #4/#5/#7.
- `CraftReport`/`CraftFlag` (`craft-critic.ts`), `DialogueReport`/`DialogueFlag` (`dialogue-auditor.ts`), `ContinuityFlag` (`consistency/continuity-check.ts`) — #7.
- `LessonStore.addLesson`/`adjustConfidence`/`getAll`, `Lesson` type, categories `style_voice`/`writing_quality`, source `self-critique` — #7.
- `HeartbeatService` ctor + `addWords` (`heartbeat.ts:698`) — #8.
- `SearchHit` shape + `MemorySearch.isAvailable()`/`search()` (sync) — #9.
- `ProjectStep` (`projects.ts:106`), `completeStep` (`:1324`, advance block `1360–1373`), `activeFrontier` (`:1622`), `runnableSteps` (`:1288`), `startProject` (`:1251`); `autoRunProject`/`startAndRunProject` + frontier fire `index.ts:2778-2784`, `DriveScheduler.acquireDrive` `:2739` — #6.

---

## Wave A — standalone new files (parallel, disjoint ownership, NO commit)

Each task: write the file(s), write the unit test, run it green, report. No wiring into shared files (deferred to Wave B). Cheap/standard model per task.

### Task A1 — #8 writing-stats (SELF-CONTAINED, full feature incl. wiring)
Files (exclusive): `gateway/src/services/writing-stats.ts`, `tests/unit/writing-stats.test.ts`, `gateway/src/services/heartbeat.ts`, `gateway/src/api/routes/heartbeat.routes.ts`, `gateway/src/init/phase-10-heartbeat-bridges.ts`.
This task owns its wiring end-to-end (no shared-file conflict). Deliver: service + `computeStreaks` + store, heartbeat ctor `workspaceDir?` + `addWords` fire-and-forget + `getWritingStats`, routes `GET /api/writing/stats` + `POST /api/writing/log-words` (200k cap) + enrich `/api/agent/status`, phase-10 construction. Null-store degradation keeps `heartbeat-score.test.ts` passing (run it to confirm).

### Task A2 — #4 prose-evolver (service + test + MCP)
Files (exclusive): `gateway/src/services/prose-evolver.ts`, `tests/unit/prose-evolver.test.ts`, `mcp/src/tools/craft.ts` (add `evolve_prose` tool only — surgical).
Defer: `phase-07` instantiation, gateway field/`getServices`, `POST /api/prose/evolve` route → Wave B.
Test with fake `judge`/`soul`/`aiComplete` (no network): baseline→improve accepts non-regressing revision; plateau stop after `PLATEAU_STOP=2`; clamp rounds `[1,5]`; `stoppedReason` correct.

### Task A3 — #5 reader-panel (service + route file + test + MCP)
Files (exclusive): `gateway/src/services/reader-panel.ts`, `tests/unit/reader-panel.test.ts`, `gateway/src/api/routes/reader-panel.routes.ts` (new — `mountReaderPanel(app,gateway,baseDir)`), `mcp/src/tools/marketing.ts` (add `run_reader_panel` only).
Defer: `routes.ts` mount line, gateway field/`getServices`, `phase-07` instantiation → Wave B.
Per-call AI functions (beta-reader pattern). Test anti-slop guards with fake AI: position-bias swap flips → low confidence; score-clustering → low confidence; Jaccard repetition detection; winner index.

### Task A4 — #7 learning (service + test)
Files (exclusive): `gateway/src/services/learning.ts`, `tests/unit/learning.test.ts`.
Defer: `phase-07` instantiation, `phase-06` completion hook, optional `/learn` route → Wave B.
Add a cross-reference comment in the `foldDialogue` sniffing block pointing at `dialogue-auditor.ts` templates. Tests per spec (recurrence→lesson, dedup+bump, cross-type fold + dialogue sniffing, AI fallback both paths, fail-soft). Temp-dir `LessonStore`.

### Task A5 — #9 archival-recall (pure fn + test)
Files (exclusive): `gateway/src/services/archival-recall.ts`, `tests/unit/archival-recall.test.ts`.
Defer: `index.ts` splice + `buildSystemPrompt` context type → Wave B.
Pure `buildArchivalBlock(hits, budgetChars=1800)`: heading, whole-hit-or-skip, empty-on-no-hits.

### Task A6 — #6 derive-deps (pure fn + test)
Files (exclusive): `gateway/src/services/pipeline/derive-deps.ts`, `tests/unit/derive-deps.test.ts`.
Defer: `ProjectStep.dependsOn` field, engine methods, `conductorDrive` → Wave B.
`deriveDependencies(steps)` mutating `dependsOn` per rules (a)–(d). Import `ProjectStep` type from `projects.js` (type-only; the field addition lands in Wave B — until then reference `dependsOn` via an augmented local type or `any`-narrow, noted for Wave B to reconcile).

---

## Wave B — shared-file integration (SEQUENTIAL, controller-driven, NO commit)

Order matters only in that these edits are sequential (never parallel) on the shared files. Done after all Wave-A files exist.

### Task B1 — #6 conductor engine + drive (RISKIEST — dedicated Opus agent)
Files: `gateway/src/services/projects.ts` (add `ProjectStep.dependsOn?`, `activateStep`, `completeStepBare`, `normalizeActiveToPending`, `startAndRunProject({advance})`, call `deriveDependencies` at materialization when `pipeline.conductor===true` && no `parallelGroup`), `gateway/src/index.ts` (replace frontier fire `2778-2784` with `conductorDrive`, gated on `steps.some(dependsOn)`, inside `acquireDrive`, concurrency env `[1,3]` default 2), `tests/unit/conductor-drive.test.ts` (fake engine).
Verify: legacy path (no `dependsOn`) unchanged; `derive-deps.test.ts` still green; new drive test green. `npx tsc --noEmit` clean.

### Task B2 — lighter wiring (controller-driven)
- `phase-07-knowledge.ts`: instantiate `proseEvolver` (#4), `readerPanel` (#5), `learning` (#7).
- `index.ts`: gateway fields + `getServices()` for `proseEvolver`, `readerPanel`; `#9` `buildSystemPrompt` `userMessage?` context + splice after memories block + `handleMessage` call-site arg.
- `routes.ts`: `mountReaderPanel` registration (#5).
- `knowledge.routes.ts`: `POST /api/prose/evolve` (#4).
- `phase-06-content.ts`: extend completion hook with the `learning.learnFromProject` call (#7) + `learnFromProject` implemented on the service (gathers chapters, re-runs craft/dialogue, folds continuity).
- wave routes: optional `POST /api/projects/:id/learn` (#7).

### Task B3 — integration verify
`npx tsc --noEmit` clean; run ALL `tests/unit/*.test.ts`; confirm `heartbeat-score.test.ts` + `skill-match-cap.test.ts` green.

---

## Post-implementation (goal steps 4–7)

4. **Code review** — whole-diff review (Opus, most-capable), fix all Medium+ findings.
5. **Smoke tests** — extend `tests/` with live-surface coverage for each new feature (prose/evolve, reader-panel, writing/stats, learn route, archival-recall chat visibility, conductor opt-in no-op on legacy). Scripted + repeatable per CLAUDE.md.
6. **Deploy Mercury** — `touch build_now`; poll `.build-logs/`; run smokes against `http://192.168.1.32:3847`; fix any finding.
7. **Commit + push** — write `commit_message`; move #4–#9 from `docs/TODO.md`→`docs/COMPLETED.md`; push to remote (goal explicitly authorizes commit+push here).

## Verification checklist

- [ ] All Wave-A unit tests green in isolation
- [ ] `npx tsc --noEmit` clean after Wave B
- [ ] `heartbeat-score.test.ts` + `skill-match-cap.test.ts` still green
- [ ] Legacy book path byte-identical (no `dependsOn`, no `conductor` flag reaches existing books)
- [ ] Code review Medium+ findings all fixed
- [ ] Smoke tests pass against Mercury
- [ ] `commit_message` written, TODO→COMPLETED moved, pushed
