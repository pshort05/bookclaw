# Parallel Step Execution for Pipelines

**Date:** 2026-06-19
**Status:** Plan (no production code written yet)

## Goal

Let a `library/pipelines/*.json` pipeline declare that a GROUP of steps runs
concurrently (fan-out), followed by a normal sequential step that WAITS for all
the group members to finish before it runs (fan-in / join / barrier). The join
step consumes the combined outputs of the parallel steps.

Motivating use case: `library/pipelines/romantasy-planning.json` — 4 independent
"idea generator" steps (concurrent), then 3 independent "evaluator" steps
(concurrent), then an "editor-in-chief" join step that reads all prior outputs.
Mirrors an n8n fan-out/fan-in graph.

Backward compatibility is a hard requirement: a pipeline with **no** parallel
groups must behave EXACTLY as today, and every existing unit test must still pass
unchanged.

---

## 1. Current state (exact, with file:line references)

### Pipeline data shape
- `gateway/src/services/library-types.ts:15` — `LibraryPipelineStep` (the JSON
  step: `label`, `skill?`, `toolSuggestion?`, `taskType`, `promptTemplate`,
  `phase?`, `wordCountTarget?`, `chapterNumber?`). A concurrently-developed plan
  (`2026-06-19-per-step-model-pinning.md`) adds `modelOverride?: { provider; model?; temperature? }`.
- `gateway/src/services/library-types.ts:33` — `LibraryPipeline.steps: LibraryPipelineStep[]`.
  Note: `steps[]` is typed as `LibraryPipelineStep[]`, but `expandSteps` is fed
  `pipeline.steps as any[]` (`projects.ts:655`) and already reads non-step group
  entries (`{ expand:'chapters', steps:[...] }`) out of it — so the existing GROUP
  construct is already not represented in the `LibraryPipelineStep` type. We follow
  that established convention.

### Flattening
- `gateway/src/services/pipeline-expand.ts:3` — `ResolvedStepInput` (the resolved,
  interpolated step: `label`, `skill?`, `toolSuggestion?`, `taskType`, `prompt`,
  `phase?`, `wordCountTarget?`, `chapterNumber?`).
- `gateway/src/services/pipeline-expand.ts:22` — `emitStep(s, vars)` — interpolates
  one raw step into one `ResolvedStepInput`. **This is the single point that copies
  per-step fields.** Per-step model pinning adds `modelOverride` here; our parallel
  marker must NOT be added here (it's a group-level property, assigned by the caller).
- `gateway/src/services/pipeline-expand.ts:36` — `expandSteps(rawSteps, vars)` — the
  flattener. Existing GROUP precedent:
  - line 39: `entry.expand === 'chapters' && Array.isArray(entry.steps)` → emits each
    sub-step per chapter `n`.
  - line 44: an `entry` carrying `expand` but malformed → `continue` (skip, no junk step).
  - line 51: a plain step → `out.push(emitStep(entry, vars))`.

### Runtime step + project shape
- `gateway/src/services/projects.ts:78` — `ProjectStep` interface. Statuses:
  `'pending' | 'active' | 'completed' | 'skipped' | 'failed'` (line 85).
- `gateway/src/services/projects.ts:95` — `modelOverride?: { provider; model? }`
  (already present at runtime; read at `index.ts:2082`).
- `gateway/src/services/projects.ts:656` — the resolved→ProjectStep `.map((s,i)=>…)`.
  Spreads `phase`/`wordCountTarget`/`chapterNumber` conditionally; everything else is
  set explicitly. **This is the second copy point** that must carry any new per-step field.

### Step selection / sequencing (the state machine)
- `gateway/src/services/projects.ts:787` — `startProject`: activates the **first**
  `pending` step (`project.steps.find(s => s.status === 'pending')`).
- `gateway/src/services/projects.ts:817` — `completeStep`'s "find next step" predicate:
  `project.steps.find(s => s.status === 'pending') || project.steps.find(s => s.status === 'active' && s.id !== stepId)`.
  On line 832 it sets that **single** next step `active`, enriches its prompt
  (`enrichWithPriorResults`, line 834), persists, returns it.
- `gateway/src/services/projects.ts:840` — project marked `completed` only when NO
  `pending`/`active` remain.
- `gateway/src/services/projects.ts:811` — progress = `completed+skipped / total`.
- `gateway/src/services/projects.ts:875` — `failStep`: sets the step `failed`; does NOT
  advance.
- `gateway/src/services/projects.ts:1608` — `advancePipeline` and `:1626`
  `sequencePredecessorsComplete` are **cross-PROJECT** phase gating
  (`getPipelineProjects`, `pipelinePhase`), NOT intra-project step ordering. They are
  irrelevant to this feature and **must not be touched**.

### The actual run driver (where AI is called per step)
- `gateway/src/index.ts:2013` — `startAndRunProject(projectId)`: finds the single
  `active` step (or calls `startProject`), runs ONE AI call, saves the file, calls
  `gateway.projectEngine.completeStep(...)` (line 2232). Returns one step's summary.
- `gateway/src/index.ts:2366` — `runProjectAutonomously`'s `while(true)` loop: repeatedly
  calls `startAndRunProject` ONE step at a time, with pause checks before and after each
  call (lines 2369, 2380). **This is the loop that drives a project to completion.**
- `gateway/src/api/routes/projects.routes.ts:402,475,806` — the HTTP execute path: finds
  the single `active` step, runs it, calls `completeStep`.
- `gateway/src/init/phase-10-heartbeat-bridges.ts:23` — registers
  `startAndRunProject` as the heartbeat's "continue a project" callback.

**Conclusion:** execution is strictly one-step-per-tick. The AI driver
(`startAndRunProject`) handles exactly ONE `active` step per invocation; an outer loop
(or heartbeat tick) calls it repeatedly. `completeStep` activates exactly one successor.

### Existing tests (style + coverage)
- `tests/unit/pipeline-expand.test.ts` — `node:test` + `node:assert/strict`; builds raw
  `steps[]` (incl. an `expand:'chapters'` group), calls `expandSteps`, asserts on the
  flattened `ResolvedStepInput[]` (labels, counts, interpolation). The model for our
  flattening test.
- `tests/unit/project-engine-orchestration.test.ts` — constructs `ProjectEngine` against a
  non-existent root (inert `loadState`), injects a pipeline resolver, drives the project
  purely via `completeStep(projectId, stepId, fakeResult)` (no AI). The model for our
  barrier / state-machine tests.
- `tests/unit/pipeline-advance.test.ts`, `tests/unit/sequence-ordering.test.ts` — exercise
  cross-project `advancePipeline`/`sequencePredecessorsComplete` (NOT touched here).

---

## 2. Design decisions

### 2.1 Pipeline JSON syntax — chosen shape

A parallel group is an entry in `steps[]` shaped like the existing `expand` group:
a wrapper object whose `parallel` key holds the array of concurrent member steps.
Each member is an ordinary step object (same fields as any step).

```jsonc
{
  "name": "romantasy-planning",
  "steps": [
    { "parallel": [
      { "label": "Concepts A — Dark & Political", "taskType": "creative_writing", "phase": "premise", "promptTemplate": "..." },
      { "label": "Concepts B — Witty & Magical",  "taskType": "creative_writing", "phase": "premise", "promptTemplate": "..." },
      { "label": "Concepts C — Epic & War",        "taskType": "creative_writing", "phase": "premise", "promptTemplate": "..." },
      { "label": "Concepts D — Intimate & Curse",  "taskType": "creative_writing", "phase": "premise", "promptTemplate": "..." }
    ]},
    { "parallel": [
      { "label": "Evaluate — Market & Genre",  "taskType": "revision", "phase": "premise", "promptTemplate": "..." },
      { "label": "Evaluate — Craft & Character","taskType": "revision", "phase": "premise", "promptTemplate": "..." },
      { "label": "Evaluate — Commercial",       "taskType": "revision", "phase": "premise", "promptTemplate": "..." }
    ]},
    { "label": "Select Winning Concept (Editor-in-Chief)", "taskType": "revision", "phase": "premise", "promptTemplate": "Read all prior concepts and evaluations..." }
  ]
}
```

**Join is IMPLICIT: the next ordinary (non-parallel) step after a `parallel` group is
the barrier.** It is just a normal step. Because the next-step selector (below) won't run
it until every member of the preceding group is `completed`, it naturally waits. No
explicit `join`/`barrier` syntax — simplest correct option, and the join step already gets
prior outputs via `buildProjectContext` + `enrichWithPriorResults` (today's mechanism).

Rejected: an explicit `{ "join": {step}, "parallel": [...] }` nested shape — more JSON
surface, more validation, and the implicit-next-step rule already gives correct ordering.

Malformed group (`parallel` present but not a non-empty array) → `continue` (skip),
mirroring the existing malformed-`expand` handling at `pipeline-expand.ts:44`.

### 2.2 Resolved-step marker

Add an optional `parallelGroup?: string` to both `ResolvedStepInput`
(`pipeline-expand.ts:3`) and `ProjectStep` (`projects.ts:78`). It is **absent** on every
ordinary step (so existing pipelines/steps serialize and behave identically) and set to a
stable group id on each member of a `parallel` group.

**Group id is deterministic and index-based** (no `Math.random`/`Date.now`): the id is
`g<entryIndex>`, where `entryIndex` is the position of the `parallel` entry in the raw
`steps[]` array. Example: a `parallel` group at `steps[0]` → all its members carry
`parallelGroup: 'g0'`; a group at `steps[1]` → `'g1'`. Two members of the same group share
the same id; members of different groups never collide; the value is stable across reloads
because it derives purely from array position.

The marker is set by `expandSteps` at the group level (the caller of `emitStep`), NOT
inside `emitStep` — `emitStep` stays a pure per-step interpolator and continues to copy
only intrinsic step fields (label, skill, taskType, prompt, phase, wordCountTarget,
chapterNumber, and `modelOverride` once the pinning plan lands). After `emitStep` returns a
member, `expandSteps` stamps `member.parallelGroup = id`.

This guarantees the per-step-model-pinning interaction requirement: each parallel member is
emitted through the same `emitStep` as a normal step, so it carries `modelOverride`,
`temperature`, `wordCountTarget`, etc. exactly as a normal step would. We only ADD the group
marker on top.

### 2.3 Execution semantics — chosen approach

**Chosen: Approach (b) — selector-driven concurrency. Members of the current group are all
runnable at once; the join is gated until they all complete. The existing one-step-per-tick
AI driver is unchanged; only the *selector* changes to surface multiple runnable steps and to
withhold a join.**

Why (b):
- The AI driver (`startAndRunProject`, `index.ts:2013`) already handles exactly ONE `active`
  step per call and persists it. Approach (b) keeps that driver 100% untouched — it just gets
  called more times. Each member is run, saved, and `completeStep`'d through the *same*
  per-step path (which means per-step cost accounting, file output, context-engine hooks,
  `modelOverride`, pause checks all keep working with zero new code).
- The smallest correct change is to two predicates in `projects.ts` plus a tiny loop tweak in
  `runProjectAutonomously` so the outer loop drains all currently-runnable members before the
  next tick. (For true wall-clock concurrency we additionally allow the outer loop to fire
  group members via `Promise.all`; see §2.5 — this is optional and isolated to the loop, not
  the engine.)
- It composes with the heartbeat continue-path: each heartbeat tick still asks the engine for
  the next runnable step; the engine now hands back group members until the group is done,
  then the join.

**Rejected: Approach (a) — engine-level `Promise.all` inside the ProjectEngine.** The engine
(`projects.ts`) is deliberately AI-free: `completeStep` takes the AI result as a *parameter*
(that's what makes `project-engine-orchestration.test.ts` driveable without a provider). Moving
concurrent AI calls into the engine would (i) drag the AI router, cost accounting, file IO, and
context hooks into the engine, breaking that clean separation and its tests; (ii) duplicate the
elaborate per-step logic that already lives in `startAndRunProject` (uploads, executable skills,
short-retry, summaries). It's a much larger, riskier change for the same observable behavior.

### 2.4 Selector predicate changes (the core)

Define one private helper on `ProjectEngine`:

```
private groupComplete(project, groupId): boolean
  // every step with that parallelGroup is 'completed' or 'skipped'
```

And a single source of truth for "what may run now":

```
private runnableSteps(project): ProjectStep[]
  for each pending step P in document order:
    if P.parallelGroup is set:
      P is runnable  (all members of an in-flight group may run concurrently)
    else (ordinary/join step):
      P is runnable ONLY IF the immediately-preceding step(s) it depends on are done.
      Concretely: a pending ordinary step is runnable iff there is NO pending/active step
      BEFORE it in document order. (A preceding in-flight parallel group has pending/active
      members → the ordinary step is the join and must wait.)
    return the first runnable ordinary step, OR — if the first not-yet-complete region is a
    parallel group — ALL pending members of that group.
```

Precise rule (document-order scan): walk steps; the "current frontier" is the first step that
is `pending` or `active`. If the frontier step has a `parallelGroup`, the runnable set is **all
`pending` members of that group**. Otherwise the runnable set is **just that one frontier step**
(today's behavior). A join step never enters the frontier until the group ahead of it has no
`pending`/`active` members — i.e. the barrier.

Edit points:
1. **`startProject` (`projects.ts:787`)** — replace the single
   `find(s => s.status === 'pending')` with: activate **all** steps in `runnableSteps(project)`
   (a group fans out at start), return the first for the caller. For a no-parallel pipeline
   `runnableSteps` returns a one-element array → identical to today.
2. **`completeStep` next-step (`projects.ts:817`)** — replace the single `find` with:
   recompute `runnableSteps(project)`, set each to `active`, enrich each prompt, return the
   first (or null). When the just-completed step was the last `pending`/`active` member of its
   group, `runnableSteps` now surfaces the join. When the no-parallel case, `runnableSteps`
   returns exactly the one next step → identical to today. The `|| find(active && id !== stepId)`
   orphan-recovery clause is preserved (an already-active sibling member is naturally returned by
   `runnableSteps` since active group members stay in the runnable region until completed — or we
   keep the orphan clause as a fallback).
3. **Project-completed check (`projects.ts:840`)** — unchanged (still "no pending/active remain").
4. **Progress (`projects.ts:811`)** — unchanged (counts completed+skipped/total; group members
   count individually, which is correct).

### 2.5 The outer run loop (`index.ts:2366`)

Today `runProjectAutonomously` calls `startAndRunProject` once per loop iteration and that runs
the single active step. With groups, multiple steps can be `active` at once. Two compatible options:

- **Minimal (sequential within a group, but unblocked ordering):** leave the loop calling
  `startAndRunProject` once per iteration. `startAndRunProject` picks "the active step" — make it
  pick the first `active` step (already effectively does via `find(status==='active')`,
  `index.ts:2019`). It runs members one-at-a-time but in any order, and the join is still gated.
  Outputs are identical; only wall-clock concurrency is lost. **This is the smallest correct
  change and is the default.**
- **True concurrency (optional, loop-local):** when the frontier is a parallel group, fire its
  members with `Promise.all(members.map(m => startAndRunProject(project, m.id)))` — requires
  `startAndRunProject` to accept an explicit step id (it currently picks the active step). Bounded
  by the existing per-call cost accounting (each call goes through the router and `costs` exactly
  as today). Pause check happens before dispatching the batch and after it resolves.

**Recommendation: ship the Minimal loop first** (correct fan-in semantics, sequential execution),
then add the `Promise.all` batch as a follow-up if real concurrency latency matters. The engine
changes (§2.4) are identical for both; only the loop differs. This keeps the first landing minimal
and the cost/pause model unchanged.

### 2.6 Failure / barrier semantics

- A member step that FAILS calls `failStep` (`projects.ts:875`) → status `failed`, no advance.
- `groupComplete` requires every member `completed`/`skipped`. A `failed` member is neither →
  the group is never complete → the join's barrier never opens → the join stays `pending` and
  the project **halts visibly** (no `completed`, no silent skip). This mirrors today's behavior
  where a `failed` step blocks progress, and matches `sequencePredecessorsComplete`'s "a failed
  predecessor blocks" philosophy. Other in-flight members of the same group still run to
  completion (they're independent); only the join waits.
- Recovery: `retryStep` (`projects.ts:896`) resets the failed member to `pending`; on the next
  tick `runnableSteps` re-surfaces it; once it completes the group completes and the join opens.
  No new recovery code.

### 2.7 Pause / resume mid-group

- Pause sets `project.status='paused'` (the loop checks it at `index.ts:2369/2380`). Members
  already `active`/`completed` keep their status; remaining members stay `pending`.
- Resume (`projects.routes.ts:987`) already resets surplus `active` steps to `pending` and
  re-activates the frontier. With our `runnableSteps`, resume should re-activate ALL pending
  members of the current frontier group, not just one. Edit `resume` (`projects.routes.ts:1004-1009`)
  to activate `runnableSteps(project)` instead of the single `find(pending)`. For a no-parallel
  project this is one step → unchanged.

### 2.8 Backward compatibility

- `parallelGroup` is absent on every step produced by a pipeline that has no `parallel` groups.
- `runnableSteps` for a no-parallel project returns a single-element array (the next ordinary
  step) → `startProject`/`completeStep`/`resume` behave byte-for-byte as today.
- `emitStep` is unchanged in what it copies; the group marker is stamped only on `parallel`
  members. Existing `pipeline-expand.test.ts` assertions on `out.length`/labels are unaffected
  because non-parallel input produces no `parallelGroup` keys and the same step count.
- `persistState` (`projects.ts:174`) spreads `...s`, so `parallelGroup` round-trips through disk
  with no schema-write change.

---

## 3. Files to edit

| File | Edit | Reason |
|------|------|--------|
| `gateway/src/services/library-types.ts` | (optional) document `parallel` group in a comment near `LibraryPipeline.steps:33` | `steps[]` already carries non-step group entries; no type change strictly required (fed as `any[]`). |
| `gateway/src/services/pipeline-expand.ts` | add `parallelGroup?: string` to `ResolvedStepInput:3`; add a `parallel`-group branch in `expandSteps:36` that emits each member via `emitStep` and stamps `parallelGroup = 'g'+entryIndex`; skip malformed `parallel` entries | flatten the new group construct with a stable, index-based marker. |
| `gateway/src/services/projects.ts` | add `parallelGroup?: string` to `ProjectStep:78`; carry it in the resolved→ProjectStep map `:656`; add private `groupComplete`/`runnableSteps`; rewrite the selector in `startProject:787` and `completeStep:817` to use `runnableSteps` (activate all, return first) | the state machine: fan-out members, gate the join. |
| `gateway/src/api/routes/projects.routes.ts` | in `resume` (`:1004-1009`) activate `runnableSteps(project)` instead of a single pending step | resume re-fans-out a mid-flight group. |
| `gateway/src/index.ts` | (Minimal loop) no change required — `startAndRunProject:2019` already runs the first `active` step; the engine now keeps the right set active. (Optional concurrency) accept an explicit step id + `Promise.all` batch at `:2366`. | drive the now-multi-active frontier. |
| `library/pipelines/romantasy-planning.json` | wrap steps 0–3 and 5–6 in `parallel` groups; the editor-in-chief step at index 7 becomes the implicit join | the motivating pipeline. |

---

## 4. TDD task list (RED → GREEN, mechanical)

Run each test with: `node --import tsx --test tests/unit/<name>.test.ts`
Type-check after each GREEN: `npx tsc --noEmit`.

**Task 1 — flatten a parallel group with stable markers**
- RED: add `tests/unit/pipeline-parallel.test.ts`. Build raw `steps[]` with a `parallel` group
  of 3 members at index 0 plus a trailing ordinary join step at index 1. Call `expandSteps`.
  Assert: `out.length === 4`; the 3 group members all have `parallelGroup === 'g0'`; the join
  step's `parallelGroup` is `undefined`; member labels/prompts interpolate; `emitStep`-copied
  fields (e.g. `taskType`, `wordCountTarget`) are preserved on each member.
- GREEN: `pipeline-expand.ts:3` add `parallelGroup?`; `pipeline-expand.ts:36` add the
  `parallel`-group branch (loop members → `emitStep` → stamp `parallelGroup`).

**Task 2 — malformed parallel group is skipped**
- RED: in the same test file, raw `steps[]` containing `{ parallel: [] }` (empty) and
  `{ parallel: "x" }` (not array) plus a real step. Assert `out.length === 1`, the real step.
- GREEN: guard in the `parallel` branch (`Array.isArray && length>0`), else `continue`
  (mirrors `expand` malformed handling).

**Task 3 — a no-parallel pipeline is unchanged**
- RED: add to `tests/unit/pipeline-parallel.test.ts` (or reuse `pipeline-expand.test.ts` style):
  feed the existing 3-plain-step raw array; assert no step has a `parallelGroup` key and
  `out.length`/labels match today. (Also: existing `pipeline-expand.test.ts` must still pass.)
- GREEN: already satisfied by Task 1's additive branch — verify.

**Task 4 — join step is gated until all group members complete (barrier)**
- RED: add `tests/unit/parallel-orchestration.test.ts` modeled on
  `project-engine-orchestration.test.ts`. Inject a resolver whose pipeline has a 3-member
  `parallel` group then a join step. `startProject` → assert all 3 members are `active` and the
  join is `pending`. `completeStep` member 1 → join still `pending`; member 2 → still `pending`;
  member 3 → NOW the join is `active` (returned as next). Assert the project is not `completed`
  until the join completes.
- GREEN: `projects.ts` add `groupComplete`/`runnableSteps`; rewrite `startProject:787` and
  `completeStep:817` selectors.

**Task 5 — failure in a group halts at the barrier**
- RED: in `parallel-orchestration.test.ts`: complete members 1 and 2, `failStep` member 3.
  Assert the join is still `pending` (never `active`), the project is not `completed`, member 3
  is `failed`. Then `retryStep` member 3 → it returns to `pending`/runnable; `completeStep` it →
  the join becomes `active`.
- GREEN: satisfied by `groupComplete` requiring all members completed; verify `retryStep`
  interaction (no new code expected).

**Task 6 — resume re-fans-out a mid-group project** (light; route-level)
- RED: add a focused assertion (engine-level helper test) that after pausing mid-group and
  re-running the frontier, all pending members are activated. If a full route test is heavy,
  assert `runnableSteps` returns all pending members of the frontier group directly.
- GREEN: `projects.routes.ts:1004-1009` use `runnableSteps`.

**Task 7 — wire the example pipeline**
- RED: extend `tests/unit/romantasy-planning-pipeline.test.ts` to assert the planning pipeline
  now contains two `parallel` groups (4 members, 3 members) and that `expandSteps` over it yields
  the expected member `parallelGroup` ids and a single trailing join.
- GREEN: edit `library/pipelines/romantasy-planning.json` to wrap the groups.

---

## 5. Unit tests to add (count: 7 named cases across 2 new files + 1 edited file)

New file `tests/unit/pipeline-parallel.test.ts`:
1. `expandSteps flattens a parallel group with stable g<index> markers` — members share
   `parallelGroup:'g0'`, join has none, fields preserved.
2. `a malformed parallel group is skipped, not emitted` — empty/non-array `parallel` → no junk steps.
3. `a no-parallel pipeline produces no parallelGroup markers` — backward-compat invariant.

New file `tests/unit/parallel-orchestration.test.ts`:
4. `startProject fans out all members of the leading parallel group` — all members `active`,
   join `pending`.
5. `the join step stays pending until every group member completes` — barrier gating across
   completeStep calls; project not completed early.
6. `a failed group member halts at the barrier and retry reopens it` — failure semantics + retry.

Edited file `tests/unit/romantasy-planning-pipeline.test.ts`:
7. `romantasy-planning declares parallel idea + evaluator groups with a single join` — the wired
   example asserts group shape + flattened markers.

---

## 6. Verification checklist

- [ ] `node --import tsx --test tests/unit/pipeline-parallel.test.ts` — all pass.
- [ ] `node --import tsx --test tests/unit/parallel-orchestration.test.ts` — all pass.
- [ ] `node --import tsx --test tests/unit/romantasy-planning-pipeline.test.ts` — passes (incl. new case).
- [ ] `node --import tsx --test tests/unit/pipeline-expand.test.ts` — UNCHANGED, still passes.
- [ ] `node --import tsx --test tests/unit/project-engine-orchestration.test.ts` — UNCHANGED, still passes.
- [ ] `node --import tsx --test tests/unit/sequence-ordering.test.ts tests/unit/pipeline-advance.test.ts` — unaffected, pass.
- [ ] `npx tsc --noEmit` — clean.
- [ ] Manual: a no-parallel pipeline (e.g. `book-planning`) runs to completion exactly as before
      (one active step at a time).
- [ ] Manual: `romantasy-planning` — group members all go active together, the editor-in-chief join
      waits for all of them, project completes.
- [ ] No edits to `advancePipeline`/`sequencePredecessorsComplete` (cross-project gating).
- [ ] `.js` import extensions used in any new `.ts`; `node:test`/`node:assert/strict` style matched.
- [ ] Parallel-member steps carry `modelOverride`/`temperature`/`wordCountTarget` identically to
      plain steps (per-step-model-pinning interaction preserved).
