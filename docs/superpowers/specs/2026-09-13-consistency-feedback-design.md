# Consistency findings must reach the prose — Design + Implementation

**Owner ask:** 2026-09-13
**Status:** SHIPPED 2026-09-13. Two agent code reviews produced 20 findings; all high/medium were fixed and the design below is amended to match what shipped (see "Amendments from code review").
**TODO:** "Consistency findings must reach the prose, not just the reader", `docs/internal/TODO.md` → Larger items

## Problem

The consistency ledger works. Nothing acts on what it finds.

Measured on the live production book *Three Months of Summer* (`project-84`, Neptune):

| | count |
|---|---|
| chapters carrying continuity flags | **24 of 24** |
| total flags | **113** |
| contradiction / knowledge / timeline | 72 / 31 / 10 |
| step role the flags are attached to | `draft`, every one |

Those flags are detected immediately after each chapter's first draft — exactly the right moment, with the Improvement Plan and Rewrite still to come — and then go nowhere except the gate's advisory text and the View Book rail. The book shipped with all 113 in place.

Two independent causes.

### Cause 1 — the repair path is keyed to skill names no production pipeline uses

`gateway/src/api/routes/_shared.ts:554` `resolveAnalyzeApplyBlock` already does the right thing: it runs the craft critic and dialogue auditor, merges in `continuityFlags`, and returns a `## Analysis Findings — fix ONLY these issues` block that `projects.routes.ts:1245` injects into the step's prompt. It is guarded by:

```js
const isPolishPhaseStep   = step?.phase === 'polish' && step?.skill === 'revise';
const isChapterRewriteStep = step?.skill === 'revise' && typeof step?.chapterNumber === 'number'
  && (step?.role === 'rewrite' || step?.role === 'editorial');
if (!isPolishPhaseStep && !isChapterRewriteStep) return '';
…
const writeStep = project.steps.find((s) => s.skill === 'write' && s.chapterNumber === chNum && …);
if (!writeStep?.result) return '';
```

The deterministic romance pipelines emit `skill: romance-sweet-rewrite` (role `rewrite`) and `skill: romance-sweet-first-draft` (role `draft`). **Both guards fail**, so the block is never built. Verified against the live step shapes of project-84 chapter 1:

```
Scene Brief    role=scene_brief  skill=romance-sweet-scene-brief        flags=0
First Draft    role=draft        skill=romance-sweet-first-draft        flags=2   ← the flags live here
Improvement…   role=improve      skill=romance-sweet-improvement-plan   flags=0
Rewrite        role=rewrite      skill=romance-sweet-rewrite            flags=0   ← never sees them
```

This is the same bug class as the `write|polish` chapter regex fixed on 2026-09-12: shared code keyed to the code-generated pipelines' skill names, inert for the config-driven ones.

### Cause 2 — no amount of contradiction stops the run

`maybeOpenCadenceGate` (`services/human-review.ts`) force-opens a gate on a romance **Stall** verdict and on a missing ending, but consults the ledger only to *annotate* (`aggregateActContinuity` → `findings.actContinuity`). A chapter can carry nine contradictions and sail through, while a beat-fit opinion from an LLM stops the run.

## Goals

1. A chapter's continuity flags reach the Rewrite prompt for the pipelines that actually run, without changing behaviour for the ones that already work.
2. A chapter whose contradiction count crosses a threshold force-opens a human gate, with the count and the flags in the findings.

### Non-goals

Re-detecting continuity after the rewrite (the extractor is an AI call — one run per chapter is the budget; see Open questions), auto-*resolving* contradictions, and changing the ledger's detection rules.

## Design

### Feature 1 — match on role, keep skill as a fallback

Replace both skill-name guards with role-first predicates, in `_shared.ts`:

```ts
/** The step we inject findings INTO. */
const isRewriteTarget = (step) =>
  typeof step?.chapterNumber === 'number'
  && (step?.role === 'rewrite' || step?.role === 'editorial' || step?.skill === 'revise');

/** The step whose prose the findings were computed FROM. */
const isDraftSource = (s, chNum) =>
  s.chapterNumber === chNum && s.status === 'completed' && s.result
  && (s.role === 'draft' || s.skill === 'write');
```

Rules:
- `role` wins; the legacy `skill` values stay as an OR so `novel-pipeline` / `book-production` / the polish-phase path behave **exactly** as before.
- The polish-phase branch (`phase === 'polish' && skill === 'revise'`) is unchanged.
- When several steps match `isDraftSource` for one chapter, take the **last completed** one — with the ledger attaching flags to `draft`, that is the draft, but a pipeline with two drafting passes must not pick the earlier.
- Everything stays fail-soft: no source step → `''`, critic throw → `''`.

Nothing else changes: the block is already assembled and injected, and the Rewrite skill (`romance-sweet-rewrite`) is already instructed to act only on flagged issues.

### Feature 2 — contradiction force-gate

In `maybeOpenCadenceGate`, alongside the existing romance `forceGate`:

```ts
const contradictions = chapterContradictionCount(project, step.chapterNumber);
if (contradictions >= CONTRADICTION_GATE_THRESHOLD) {
  forceGate = true;
  findings.contradictions = { count, threshold, flags };   // the detail strings, so the gate is actionable
}
```

Decisions:

- **Where the count comes from.** The flags live on the chapter's *draft* step, not on the step the gate fires at (usually the de-AI sweep). So the count is gathered across **all steps sharing this `chapterNumber`**, deduped by `detail`. A helper `chapterContinuityFlags(project, chapterNumber)` does this; `buildCadenceGateFindings` currently reads `step?.continuityFlags` (undefined at a sweep step) and switches to the same helper, which also fixes the chapter findings block being silently empty at act gates.
- **What counts.** `kind === 'contradiction'` only. Knowledge-leaks and timeline flags are reported in the findings but do not force a gate — they are frequently benign (a character "using knowledge" they plausibly have) and would gate almost every chapter.
- **Threshold = 6**, as `CONTRADICTION_GATE_THRESHOLD`. Empirical, not a guess: on project-84 the per-chapter contradiction count peaks at **9** (ch18), median **3**, five chapters ≥5, and **none reach 10** — the owner's first suggestion of 10 would never have fired. Six fires on ch18 (9), ch24 (7), ch19 (6) and ch20 (6): the four worst chapters, ~17% of the book.
- **Overridable** via `BOOKCLAW_CONTRADICTION_GATE` (integer; `0` disables). One env var, because the right number is book- and genre-dependent and a rebuild-to-tune loop is ~5 minutes on Mercury. Parsed once, invalid values fall back to the default.
- **Only on prose.** The check runs inside the existing `typeof step?.chapterNumber === 'number'` branch, which already excludes the outline gate. It must not fire on a non-prose step — the lesson from the 2026-09-12 run, where the romance checker force-gated an Improvement Plan document. Guard on `isProseStep(step)` / the `chapter-files` prose roles.
- **Headless still wins.** `if (ctx.headless) return { gated: false }` stays the first line, so an autonomous run is not stopped by this.

### Interaction between the two

Feature 1 makes the Rewrite fix issues; Feature 2 counts flags detected **before** that rewrite. So a chapter can be force-gated over contradictions the rewrite has since repaired. This is accepted for now and stated in the gate copy ("found in the draft; the rewrite pass may have addressed some"), because re-detection costs an AI extraction per chapter. See Open questions.

## Components / boundaries

| Unit | Change |
|---|---|
| `api/routes/_shared.ts` | `resolveAnalyzeApplyBlock` — role-first predicates (Feature 1) |
| `services/human-review.ts` | `chapterContinuityFlags` helper; contradiction force-gate + findings; `buildCadenceGateFindings` uses the helper (Feature 2) |
| `services/consistency/continuity-gate.ts` (new) | Pure: `countContradictions(flags)`, `resolveThreshold(env)`, `shouldForceGate(count, threshold)` — testable without a project or HTTP |

## Testing

TDD, `npm run test:unit` (`node --test`, baseline 2542 pass / 0 fail):

**Feature 1** — `tests/unit/analyze-apply-wiring.test.ts`
1. A project-84-shaped chapter (`romance-sweet-first-draft` + `romance-sweet-rewrite`, real labels) returns a findings block naming the continuity flags. **Fails before the fix** — this is the regression.
2. The legacy shape (`skill: 'write'` + `skill: 'revise'`) still returns its block — no behaviour change for `novel-pipeline`.
3. The polish-phase path (`phase: 'polish'`, `skill: 'revise'`) is unchanged.
4. A non-rewrite step (scene brief, improvement plan, de-AI sweep) returns `''`.
5. No completed draft for the chapter → `''`; a critic that throws → `''`.
6. Two drafting passes → the LAST completed one is the source.

**Feature 2** — `tests/unit/continuity-gate.test.ts` + cases in the human-review suite
1. `countContradictions` counts only `kind === 'contradiction'`.
2. `resolveThreshold` — default 6; env override; `0` disables; garbage falls back to 6.
3. 9 contradictions on the chapter's draft step → `maybeOpenCadenceGate` returns `gated: true` with `findings.contradictions.count === 9`, **even though the cadence boundary would not otherwise gate**.
4. 3 contradictions → not gated by this rule.
5. Flags on the draft step are found when the gate fires at the **sweep** step (the cross-step lookup).
6. Knowledge/timeline flags alone never force a gate.
7. `ctx.headless` → never gated.
8. A non-prose step carrying a chapterNumber → never force-gated on contradictions.

## Open questions / follow-ups

1. **Re-detect after the rewrite.** Would make the gate count reflect what ships, at the cost of a second AI extraction per chapter. Worth measuring against the ~$0.15/chapter the extractor costs before committing.
2. **Auto-resolution.** A cross-chapter contradiction needs a canon decision ("which is true?"); the `deterministic-apply` path can only do verbatim find/replace inside one chapter. Out of scope here.


## Amendments from code review (2026-09-13)

Two adversarial reviews ran against the first implementation. Six findings changed the design; they are recorded here because the sections above describe the *original* intent.

**Feature 1 — the predicate is narrower than first written.** The first cut (`role === 'rewrite' || role === 'editorial' || skill === 'revise'`) matched **53** chapter steps where the old code matched 14. That newly admitted critique-only steps whose prompts forbid rewriting — `nerdynovelistai-stage5` Chronology/Style Check, `technothriller-production` Continuity Check, and the `Improvement Plan` steps of two pipelines, whose output the Rewrite consumes. Injecting "fix ONLY these issues" there would have *narrowed* the critique and cost the Rewrite its craft coverage — the feature subtracting quality instead of adding it. Shipped predicate:

```ts
const isChapterRewriteStep = typeof step?.chapterNumber === 'number' && (
  step?.role === 'rewrite'                                     // role-first
  || (step?.skill === 'revise' && step?.role === 'editorial')   // legacy, unchanged
);
```

23 matches, a strict superset of the old 14. A step with **no role** never matches — there is no load-time `inferRole` backfill, so an older persisted project can carry `skill: 'revise'` on four different step kinds.

**Feature 1 — the block header is additive.** `## Analysis Findings — fix these IN ADDITION to the improvement plan; do not drop any other instruction`. The original "fix ONLY these issues" competed with the Rewrite prompt's own "change only what the plan flags" over two disjoint lists, and was appended later in the context, so recency favoured dropping the plan.

**Feature 1 — flags come from `chapterContinuityFlags`**, not `writeStep.continuityFlags`, so an Alternate-Takes "Draft Opening" step's flags are not silently dropped.

**Feature 2 — the gate fires once per chapter, at the last prose step.** The original guard (`chapterNumber && isProseStep`) fired at *every* prose step: draft, rewrite and sweep all carry the same deterministic count, and `applyReviewResume` deletes `project.review`, so each one re-opened an identical gate — **12 gates on project-84 rather than 4**, each able to die at the 24h Confirmations expiry. It also fired first at the draft, *before* the Improvement Plan and Rewrite, pre-empting the repair passes Feature 1 exists to feed. `isLastProseStepOfChapter(project, step)` now gates it.

**Feature 2 — `findings.contradictions` is a human-readable string, not an object.** Both renderers do `typeof v === 'string' ? v : JSON.stringify(v)`, so an object rendered as a 1500-character JSON blob and tripped GatePanel's `asBlock`, degrading the other findings that rendered fine. The string states the count, the chapter, the threshold and the draft caveat, then the details — capped at 10 flags / 1200 chars, truncated on a line boundary.

**Feature 2 — the env override actually reaches the container**, and says so at boot. `BOOKCLAW_CONTRADICTION_GATE` was not in `docker/docker-compose.yml`'s explicit env allowlist, so the threshold was hard-6 on both hosts and the only mitigation for over-gating did not exist. It is now passed through, `0|off|false|no` all disable (previously `off`/`false` fell back to **6 = enabled**, so an operator disabling it enabled it), and `init/phase-03` logs the effective posture like every other env-gated knob.

**Feature 2 — an explicit `autonomous` cadence is respected.** `forceGate` bypasses `cadenceHit`, so a book configured "do not pause me" was stopped anyway. The contradiction gate now skips when the resolved cadence is `autonomous`; `headless` still short-circuits first.

**Feature 2 — stale flags no longer gate.** Both attach sites did `if (flags.length) step.continuityFlags = flags`, so a chapter regenerated *to fix* its contradictions kept the old array and re-gated on strings the author had just fixed. They now always assign, clearing to `undefined` (not `[]`, which `revision-orchestrator.ts:272` reads as "analysed and clean" rather than "never analysed").

Dedup is on `detail + span`, since `detail` is a deterministic template that two distinct violations can share.

## Verification

`npm run test:unit` 2592 pass / 0 fail; `tsc` clean. `tests/consistency-feedback-smoke.sh` (`npm run test:consistency-smoke`) drives the real modules with a project-84-shaped fixture and runs **against the built `dist/` inside a deployed container**, so it proves the shipped artifact carries both features — including that the draft step does not gate and that the payload is text.
