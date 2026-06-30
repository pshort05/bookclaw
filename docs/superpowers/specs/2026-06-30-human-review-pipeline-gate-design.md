# Human Review pipeline gate — design

_Owner ask 2026-06-30._

## Problem

Pipelines run to completion unattended (dashboard auto-execute loop and the autonomous
heartbeat). The owner wants an optional **human checkpoint**: a pipeline can pause at a
chosen point and wait for a human to approve before continuing to the next step. The
pause must surface in the existing **Confirmations** screen (currently unused). If no
checkpoint is present, pipelines run uninterrupted (today's behaviour). Separately, when a
step **errors**, the pipeline should also raise a Confirmations request for human review
instead of silently dead-ending.

## Goals

- A `human-review` **skill** that, placed as a step in a pipeline, halts the pipeline at
  that point and raises a Confirmations request. Approval advances past the gate; rejection
  stops the pipeline.
- On **any step error**, raise a Confirmations request for human review (independent of the
  skill). Approval retries the failed step; rejection leaves it stopped.
- Works for **both** drivers: the dashboard `POST /api/projects/:id/auto-execute` loop and
  the autonomous heartbeat (`startAndRunProject`).
- Reuse `ConfirmationGateService` and the existing Confirmations UI/REST — no new UI.
- Absent the gate skill, behaviour is unchanged.

## Non-goals

- No new Confirmations UI (the generic card already renders any request). A later polish
  could add a "Open in Write" deep-link, but not now.
- No multi-reviewer / role logic (single-user system).
- No change to how steps generate content.

## Key constraint discovered

`ConfirmationGateService` is **poll-based**, not callback-based: `approve()`/`reject()`
just flip status; nothing is fired. A worker must poll `checkDecision(id)`
(`{status, request}`) or `awaitDecision(id)`. So resume cannot be a callback — it is a
**resolver** that polls decisions and acts.

## Approach

Backend-only, plus one marker skill file. Three pieces:

### 1. The gate skill (marker)

`skills/core/human-review/SKILL.md` — category `core`, name `human-review`. It carries no
generation instructions; it exists so a pipeline step can reference `skill: "human-review"`
and so it appears in the skill catalog. A pipeline author adds a step like:

```json
{ "label": "Human review", "skill": "human-review", "taskType": "general", "promptTemplate": "" }
```

Detection is by **skill name**: `step.skill === 'human-review'` (constant
`HUMAN_REVIEW_SKILL`). No new step field is required for the gate itself.

### 2. Gate + state (`gateway/src/services/human-review.ts`)

A small, dependency-injected module (pure where possible, testable in isolation):

- `HUMAN_REVIEW_SKILL = 'human-review'` and `REVIEW_SERVICE = 'human-review'` constants.
- `isHumanReviewStep(step): boolean` — `step?.skill === HUMAN_REVIEW_SKILL`. Pure.
- `openReviewGate(deps, project, step, kind, detail?)`:
  - `kind: 'pipeline-gate' | 'pipeline-error'`.
  - Idempotent: if `project.review` is already set for a still-pending confirmation, no-op
    (don't create duplicates on re-entry).
  - Creates a confirmation: `gate.createRequest({ service: 'human-review', action: kind,
    platform: 'BookClaw', riskLevel: 'medium', isReversible: true, description, payload:
    { projectId, stepId, bookSlug, kind, error? } })`. Description e.g.
    `Human review — approve to continue "<title>" past "<step label>"` (gate) or
    `Step "<label>" failed — review and approve to retry` (error).
  - Stamps `project.review = { confirmationId, stepId, kind }` (new **additive-optional**
    field on `Project`; no schema bump).
  - Pauses the project (`engine.pauseProject(id)`), logs an activity event, returns the
    request.
- `reviewDecisionAction(status, kind): 'resume' | 'retry' | 'abort' | 'wait'` — pure
  mapping: approved+gate → resume; approved+error → retry; rejected/expired/failed → abort;
  pending → wait. Testable in isolation.
- `resolveReviewGates(deps)`: for every project with `project.review` set, call
  `gate.checkDecision(review.confirmationId)`, map via `reviewDecisionAction`, then:
  - **resume** (gate approved): `engine.completeStep(projectId, review.stepId, '<approved>')`
    to advance past the gate, clear `project.review`, `engine.resumeProject(projectId)`,
    `gate.recordOutcome(id, {success:true,...})`.
  - **retry** (error approved): reset the failed step to `pending`/`active`, clear
    `project.review`, `resumeProject`, `recordOutcome(success:true)`.
  - **abort** (rejected/expired): clear `project.review`, leave the project paused (the
    human declined), `recordOutcome(success:false,...)`.
  - **wait** (pending): leave untouched.
  - Idempotent and safe to call repeatedly.

Resume only makes the project **runnable** (status active, frontier step active). A driver
(autonomous tick, or the user re-running auto-execute) then continues it — matching the
existing trigger-driven model. With autonomous mode on (the owner's setup) it continues on
the next tick.

### 3. Wiring

- **Auto-execute loop** (`projects.routes.ts`): at the top of each iteration, after the
  active step is found, if `isHumanReviewStep(activeStep)` → `openReviewGate(...,'pipeline-gate')`
  and `break` (no generation). In each `failStep` path (provider failure, short response,
  exception) → `openReviewGate(...,'pipeline-error', detail)` before `break`.
- **Autonomous `startAndRunProject`** (`index.ts`): same two checks — gate step → open gate +
  return; each `failStep` path → open error gate + return.
- Both call the **same** `openReviewGate` (DRY; the per-step execution is duplicated across
  these two paths today — out of scope to merge, but the gate logic is shared).
- **Resolver triggers:** (a) the confirmations **approve/reject** endpoints
  (`knowledge.routes.ts`) call `resolveReviewGates` after a decision → near-instant resume
  for the normal UI flow; (b) a **periodic safety net** — `resolveReviewGates` invoked from
  the heartbeat base `tick()` (runs regardless of autonomous mode) so API/MCP approvals and
  any missed decisions still resolve.

## Data flow

```
pipeline reaches step.skill==='human-review'
  → openReviewGate('pipeline-gate'): createRequest + project.review={...} + pauseProject + break
  → Confirmations screen shows it (nav badge increments)
human clicks Approve  → POST /api/confirmations/:id/approve  → gate.approve + resolveReviewGates
  → resolver: completeStep(gate) + clear review + resumeProject + recordOutcome
  → next tick/run continues the pipeline
(human clicks Reject → resolver aborts: project stays paused, recordOutcome failure)

step throws / provider failure
  → openReviewGate('pipeline-error', detail): createRequest + project.review + pause
  → Approve → resolver resets the failed step to active (retry) + resume
```

## Error handling

- Gate creation failures (gate service down) must not crash the driver: wrap in try/catch,
  log `⚠`, and fall back to today's behaviour (fail/pause the step) so a pipeline never
  hard-crashes because the review gate couldn't be raised.
- Resolver is fully guarded per-project (one project's bad state never blocks others).
- Expiry: confirmations expire after 24h; an expired gate resolves as **abort** (project
  stays paused for the human to re-trigger).
- Idempotency: `openReviewGate` no-ops if a pending review already exists; `resolveReviewGates`
  only acts on terminal decisions and clears `project.review` once handled.

## Testing (TDD, no smoke test per owner — needs human interaction)

Unit tests (`tests/unit/`):
- `isHumanReviewStep` — true only for `skill==='human-review'`.
- `reviewDecisionAction` — the full status×kind matrix → resume/retry/abort/wait.
- `openReviewGate` (mock gate+engine) — creates one request with the right service/action/
  payload, stamps `project.review`, pauses; idempotent on re-entry; fail-soft on gate error.
- `resolveReviewGates` (mock gate+engine) — approved-gate → completeStep+resume+recordOutcome;
  approved-error → step reset to active+resume; rejected → abort (still paused); pending →
  no-op; clears `project.review` exactly once.
- Skill loads via the real `SkillLoader` (human-review present in the catalog).

No `tests/*.sh` smoke test: the gate **requires** a human approval mid-run, which can't be
asserted unattended.

## Files

- `skills/core/human-review/SKILL.md` (new)
- `gateway/src/services/human-review.ts` (new — constants, `isHumanReviewStep`,
  `openReviewGate`, `reviewDecisionAction`, `resolveReviewGates`)
- `gateway/src/services/projects.ts` — add `review?` to `Project`; helper to reset a step
  to active for retry if not already present
- `gateway/src/api/routes/projects.routes.ts` — gate + error hooks in the auto-execute loop
- `gateway/src/index.ts` — gate + error hooks in `startAndRunProject`
- `gateway/src/api/routes/knowledge.routes.ts` — call `resolveReviewGates` after approve/reject
- `gateway/src/init/phase-10-heartbeat-bridges.ts` (or heartbeat wiring) — periodic
  `resolveReviewGates`
- `tests/unit/human-review.test.ts` (new)
```
