# Flagship Human-Gate Cadence Implementation Plan (Plan 5 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Add configurable per-book human-review cadence (default per-act) using the existing `ConfirmationGateService` + Human-Review pause, with four gate actions and automated pre-gates that annotate before a human is asked.

**Architecture:** `book.review.cadence` (`per_act` default | `per_chapter` | `outline_only` | `autonomous`) is inherited from an author/genre default and read by the execution loop. Always-on gates fire after outline approval and before export. A cadence-driven gate fires at the configured boundary via the existing human-review pause. Automated pre-gates (anti-slop/heat-clamp/craft-critic/continuity) run first and attach findings to the gate payload.

**Tech Stack:** Node 22+, TypeScript (NodeNext `.js`), `node --import tsx --test`.

## Global Constraints
- Same as Plan 1. Reuse `ConfirmationGateService` and the existing Human-Review pause/resume (do NOT build new gate machinery — spec non-goal). The drive-lock (bug-review #2/#5/#8) already prevents double-driving a paused book.
- Backward compatible: a book with no `review.cadence` defaults to `per_act`; the always-on outline + pre-export gates match today's behavior.
- **Re-ground note:** read the current human-review pause/resume path (`services/human-review.ts`, `openReviewGate`, `resolveReviewGates`, and the per-act/phase boundaries in `projects.routes.ts` / `phase-10`) before writing tests. Coordinate with Plan 3 Task 5 (the act-boundary continuity mini-audit is a pre-gate finding here).

## File Structure
- Create `gateway/src/services/pipeline/gate-cadence.ts` — `resolveCadence(book, author, genreDefault)` and `shouldGate(cadence, boundary)` (pure).
- Modify `gateway/src/services/book-types.ts` — `BookManifest.review?: { cadence?: 'per_act'|'per_chapter'|'outline_only'|'autonomous' }` (additive-optional).
- Modify `gateway/src/api/routes/projects.routes.ts` (+ `index.ts` bridge runner) — consult `shouldGate` at chapter/act/outline/export boundaries; assemble the pre-gate findings payload.
- Modify the gate-resume path to support the four actions (approve / edit-in-place / regenerate-with-note / stop) — read the current resume handler and extend it.
- Tests: `tests/unit/gate-cadence.test.ts`, `tests/unit/gate-actions.test.ts`, integration at the execution seam.

## Tasks

### Task 1: `resolveCadence` + `shouldGate` (pure)
**Files:** create `gate-cadence.ts`; test `gate-cadence.test.ts`.
**Interfaces:**
- `type Cadence = 'per_act'|'per_chapter'|'outline_only'|'autonomous'`
- `type Boundary = 'outline_approved'|'chapter'|'act'|'pre_export'`
- `resolveCadence(book?: {review?:{cadence?:Cadence}}, authorDefault?: Cadence, genreDefault?: Cadence): Cadence` (book > author > genre > `'per_act'`).
- `shouldGate(cadence: Cadence, boundary: Boundary): boolean` — `outline_approved` and `pre_export` always true; `chapter` true only for `per_chapter`; `act` true for `per_act`.
- [ ] TDD: table-test every (cadence, boundary) pair; assert resolution precedence. Commit.

### Task 2: `review.cadence` on the manifest + inheritance
**Files:** modify `book-types.ts`, book-create path. Test `tests/unit/book-review-cadence.test.ts`.
- [ ] TDD: a book inherits `per_chapter` from its author default when unset; an explicit book value overrides. Commit.

### Task 3: Four gate actions on resume
**Files:** modify the human-review resume handler; test `gate-actions.test.ts`.
**Interfaces:** the resume endpoint accepts `action: 'approve'|'edit'|'regenerate'|'stop'` with optional `editedText` / `note`. `edit` writes `editedText` as the chapter's canonical result (and feeds the rolling summary + fact ledger — Plans 3/4); `regenerate` re-runs the step with `note` injected; `stop` pauses.
- [ ] TDD (route/engine harness): each action produces the correct state transition; `edit` persists the edited text as the step result; `regenerate` re-activates the step with the note. Reuse the existing resolve path. Commit.

### Task 4: Wire `shouldGate` + pre-gate findings into the loop
**Files:** modify `projects.routes.ts` auto-execute loop and `index.ts` bridge runner (the per-chapter/act boundaries).
- [ ] TDD (integration): a `per_act` book pauses at an act boundary (opens a review gate) but not per chapter; a `per_chapter` book pauses each chapter; `autonomous` pauses only at outline + pre-export. The gate payload includes the automated pre-gate findings (craft-critic + Plan 3 continuity mini-audit + heat-clamp) so the human sees annotations. Commit.

## Self-Review
- Spec coverage (§4.5): cadence config + inheritance (T1, T2), always-on outline + pre-export gates and cadence gates (T1, T4), four actions (T3), automated pre-gates annotating (T4), concurrency-safe via the existing drive-lock (unchanged). Reuses ConfirmationGate/Human-Review; no new machinery.
- Downstream: Plan 3 Task 5's act-boundary continuity audit is surfaced here as a pre-gate finding.
