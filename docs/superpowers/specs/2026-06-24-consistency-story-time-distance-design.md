# Consistency Engine — Story-Time-Aware Stateful Check: Design

**Date:** 2026-06-24
**Status:** Design approved (brainstorming). Next: implementation plan (writing-plans).
**TODO item:** "Consistency engine — production issues (Love Between Departures run)" #3 — Emotional-state false positives across time skips.

## Goal

Stop the consistency auditor from flagging a legitimate stateful/emotional change as a `continuity` contradiction when a large amount of story time has elapsed between the two compared facts. Judge each stateful change against the **elapsed story-time distance to the specific prior fact**, not a chapter-adjacency scalar.

## Root cause (confirmed in code)

`evaluateFact(fact, priors, gap)` (`gateway/src/services/consistency/check-engine.ts`) excuses a stateful change only when `gap === 'longer'`. But `gap = inferGap(prevChapterLabel, thisChapterFirstLabel)` is computed once per chapter in `audit.ts` (the gap between this chapter's first scene and the *previous chapter's* last scene) and passed in for comparison against **all** priors — including priors from many chapters/years earlier. So a chapter-8 emotional state compared against a final-chapter fact (~2 story-years later) is gated by the adjacent-chapter gap (`same`/`day`) and wrongly flagged. The engine has no concept of the elapsed span between the two specific facts it diverged.

`storyTime` does **not** encode elapsed time today: `storyTime = chapterStoryBase + sceneIndex` with `storyBase += scenes.length` per chapter — it is a monotonic scene counter. So "real story-time distance" must be derived, not read directly.

## Approach: a cumulative elapsed clock (deterministic; reuses `inferGap`)

Build a running, deterministically-weighted **elapsed clock** by walking scenes in order and advancing it at each scene transition by a weight derived from the existing `inferGap(prevLabel, thisLabel)` classifier (which already detects "weeks/months/years later" → `longer`). Each fact records the clock value at its scene as a new field `storyElapsed`. A stateful change is then excused when the elapsed distance to a differing prior exceeds a threshold.

This keeps the engine deterministic (no LLM time quantification — the extractor keeps emitting per-scene `timeLabel` exactly as today; only the deterministic audit layer changes).

### Elapsed weights and threshold (tunable constants)

```
GAP_WEIGHT = { same: 0, day: 1, longer: 30, unknown: 0 }
ELAPSED_THRESHOLD = 30   // one explicit "weeks/months/years later" jump (or ~30 accumulated days) excuses a stateful change
```

Rationale: a single explicit long jump (`longer` = 30) reaches the threshold and excuses; `unknown` and `same` add nothing (absence of a time label must not manufacture an excuse — keeps the check active when time is genuinely unknown); accumulated `day`s can also reach the threshold over a long continuous stretch, which is legitimate.

### The clock accumulator (in `audit.ts`)

A single running `elapsed` value is carried across all scenes of all chapters (alongside the existing `storyBase`). `prevLabel` is carried across scene and chapter boundaries. For each scene `s` in order:

```
elapsed += GAP_WEIGHT[ inferGap(prevLabel, s.timeLabel) ]
sceneElapsed[s] = elapsed
prevLabel = s.timeLabel
```

Each extracted fact is assigned `storyElapsed = sceneElapsed[fact.scene]` (the fact already carries its `scene` index; `storyTime = chapterStoryBase + scene` maps a fact to its scene). The previous per-chapter `gap` plumbing (`prevTimeLabel`/`inferGap`-for-`gap`/passing `gap` into `evaluateFact`) is removed; `inferGap` is now consumed by the clock accumulator instead.

## The revised stateful check (`evaluateFact`)

Signature changes from `evaluateFact(fact, priors, gap)` to `evaluateFact(fact, priors)` (the `gap` param was used only by step 3c). Unchanged steps:

1. **Canon divergence** — any seeded canon value differs → high.
2. **Immutable mismatch** — an immutable attribute changed → high.
3a. **Impossibility** — incompatible value at the same `storyTime` → high.
3b. **Transition** — `fact.transition` present → excuse (return null).

Step **3c (stateful change without cause)** becomes story-time-aware and applies to **all stateful facts** (not just emotional/relationship):

```
const recent = diff.filter(p => Math.abs(fact.storyElapsed - p.storyElapsed) < ELAPSED_THRESHOLD);
if (recent.length === 0) return null;          // every differing prior is far enough back → legitimate change
const prior = recent.reduce((m, p) => (p.storyElapsed > m.storyElapsed ? p : m)); // nearest recent differing prior
const distance = Math.abs(fact.storyElapsed - prior.storyElapsed);
const severity = distance === 0 ? 'medium' : 'low';
return finding('continuity', severity, fact, prior, ...same explanation/fix wording as today...);
```

So: a far-apart prior no longer produces a finding; a recent differing prior still does, flagged against the nearest recent prior. Severity is `medium` when no time passed at all (`distance === 0`) and `low` otherwise, preserving today's "near = more suspicious" intent without the discarded `gap` scalar.

## Data / schema change

- `LedgerFact` (`consistency/types.ts`): add `storyElapsed: number`.
- Fact-store (`consistency/fact-store.ts`): add a `story_elapsed` INTEGER column; write it on insert, read it on load. The ledger is rebuilt idempotently on every audit, so this is an additive column. Use a fail-soft migration guard consistent with the existing SQLite pattern (e.g. detect the missing column and `ALTER TABLE … ADD COLUMN story_elapsed INTEGER NOT NULL DEFAULT 0`, or recreate the table on schema mismatch — whichever matches the file's existing approach), so an old DB upgrades without crashing.

## Files touched

- `gateway/src/services/consistency/types.ts` — add `storyElapsed` to `LedgerFact`.
- `gateway/src/services/consistency/check-engine.ts` — `evaluateFact` signature + step 3c; remove the `Gap` param dependency from 3c (the `Gap` type/`inferGap` stay, used by the clock).
- `gateway/src/services/consistency/audit.ts` — the elapsed clock accumulator; assign `storyElapsed` to each fact; remove the per-chapter `gap` plumbing; call `evaluateFact(fact, priors)`.
- `gateway/src/services/consistency/fact-store.ts` — the `story_elapsed` column (write + read + migration guard).

## Testing

Deterministic unit tests (no LLM):
- **Clock accumulator**: a sequence of scene `timeLabel`s with `same`/`day`/`longer`/`unknown`/null produces the expected cumulative `storyElapsed` (verify `longer` adds 30, `same`/`unknown` add 0, `day` adds 1).
- **`evaluateFact`**:
  - A stateful change vs a prior **beyond** `ELAPSED_THRESHOLD` → `null` (excused). *(The "Love Between Departures" case.)*
  - A stateful change vs a prior **within** `ELAPSED_THRESHOLD` → a `continuity` finding (still flagged), severity `medium` when distance 0, `low` otherwise.
  - Same-`storyTime` incompatible values → `impossibility` high (unchanged).
  - `transition` present → excused (unchanged).
  - Immutable change and canon divergence → high (unchanged).
- Extend `tests/consistency-smoke.sh` with a planted "years later" legitimate emotional change that must NOT be flagged, alongside the existing planted contradiction that must still be flagged.

## Out of scope

- No exact calendar quantification (the LLM is not asked to convert "two years" to a number).
- No change to the immutable / knowledge-violation / canon-divergence / same-time-impossibility checks.
- No change to the extractor's `timeLabel` output or the studio UI.

## Success criteria

1. A legitimate stateful/emotional change separated from its prior by at least one explicit long time jump (or ~30 accumulated days) is no longer reported as a `continuity` finding.
2. A stateful change with no/near elapsed time is still reported (no regression in genuine catches).
3. Same-time impossibility, transitions, immutable, knowledge, and canon checks are unchanged.
4. The fact-store upgrades an existing DB without crashing (additive column).
5. Deterministic unit tests + the extended smoke test pass; full suite green; `tsc` clean.
