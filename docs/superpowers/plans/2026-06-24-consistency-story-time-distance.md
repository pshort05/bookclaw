# Consistency Story-Time-Distance Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This change threads one new field through four files that compile together; execute the tasks in order in a single pass, then run the full verification.

**Goal:** Stop the consistency auditor flagging a stateful/emotional change as a `continuity` contradiction when a large amount of story time elapsed between the two compared facts, by gating on a per-fact cumulative elapsed clock instead of a per-chapter adjacency scalar.

**Architecture:** Add a `storyElapsed` clock to each `LedgerFact` (accumulated deterministically from per-scene `timeLabel`s via the existing `inferGap`), persist it, and rewrite `evaluateFact` step 3c to excuse a stateful change when every differing prior is beyond `ELAPSED_THRESHOLD` elapsed away.

**Tech Stack:** TypeScript (NodeNext, `.js` import extensions), better-sqlite3 (fail-soft), `node:test` via `tsx`, bash smoke.

## Global Constraints

- Weights (in `audit.ts`): `GAP_WEIGHT = { same: 0, day: 1, longer: 30, unknown: 0 }`.
- `ELAPSED_THRESHOLD = 30` (exported from `check-engine.ts`).
- Applies to **all stateful facts** (step 3c), not only emotional/relationship.
- Deterministic only — no change to the LLM extractor or its `timeLabel` output.
- `.js` import extensions (NodeNext). Fail-soft SQLite (the column add must not crash an existing DB).
- The fact ledger is rebuilt idempotently per audit (book facts cleared + re-inserted), so the new column repopulates on the next run.

---

### Task 1: `storyElapsed` field + story-time-aware `evaluateFact`

**Files:**
- Modify: `gateway/src/services/consistency/types.ts` (add field)
- Modify: `gateway/src/services/consistency/check-engine.ts` (`evaluateFact` signature + step 3c + `ELAPSED_THRESHOLD`)
- Test: `tests/unit/consistency-check-engine.test.ts` (update factory + signature + behavior)

**Interfaces:**
- Produces: `evaluateFact(fact: LedgerFact, priors: LedgerFact[]): ConsistencyFinding | null` (the `gap` param is removed); `export const ELAPSED_THRESHOLD = 30`; `LedgerFact.storyElapsed: number`.

- [ ] **Step 1: Update the failing tests** — rewrite `tests/unit/consistency-check-engine.test.ts` to the new signature + `storyElapsed`. Add `storyElapsed: 0` to the `F()` factory defaults, drop the third `gap` arg from every `evaluateFact(...)` call, and replace the gap-driven stateful cases:

```ts
// In F() defaults add:  storyElapsed: 0,

test('stateful change WITH transition -> no finding', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean suit', transition: 'changed clothes', chapter: 'ch3', storyElapsed: 3 });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', chapter: 'ch2', storyTime: 2, storyElapsed: 2 });
  assert.equal(evaluateFact(f, [prior]), null);
});

test('stateful change WITHOUT transition, no elapsed time -> continuity (medium)', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean suit', transition: null, chapter: 'ch3', storyElapsed: 2 });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', chapter: 'ch2', storyTime: 2, storyElapsed: 2 });
  const finding = evaluateFact(f, [prior]);
  assert.equal(finding?.category, 'continuity');
  assert.equal(finding?.severity, 'medium');     // distance 0
});

test('stateful change WITHOUT transition, small elapsed gap -> low', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean', transition: null, storyElapsed: 5 });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', storyTime: 2, storyElapsed: 2 });
  assert.equal(evaluateFact(f, [prior])?.severity, 'low');   // 0 < 3 < 30
});

test('stateful change WITHOUT transition, large elapsed gap -> no finding (legit reset across time skip)', () => {
  const f = F({ attribute: 'mood', type: 'stateful', valueNorm: 'warm', transition: null, chapter: 'ch30', storyElapsed: 210 });
  const prior = F({ attribute: 'mood', type: 'stateful', valueNorm: 'distant', chapter: 'ch8', storyTime: 2, storyElapsed: 12 });
  assert.equal(evaluateFact(f, [prior]), null);   // |210-12| = 198 >= 30
});

test('large elapsed prior but ALSO a recent differing prior -> still flags the recent one', () => {
  const f = F({ attribute: 'mood', type: 'stateful', valueNorm: 'warm', transition: null, chapter: 'ch30', storyElapsed: 210 });
  const far = F({ attribute: 'mood', type: 'stateful', valueNorm: 'distant', chapter: 'ch8', storyElapsed: 12 });
  const near = F({ attribute: 'mood', type: 'stateful', valueNorm: 'furious', chapter: 'ch29', storyElapsed: 205 });
  const finding = evaluateFact(f, [near, far]);
  assert.equal(finding?.category, 'continuity');
  assert.equal((finding?.b as any).chapter, 'ch29');   // nearest recent prior
});
```

Keep the existing immutable / canon-divergence / same-`storyTime` impossibility / same-value / no-priors / `evaluateKnowledge` tests, just removing the third `gap` arg from their `evaluateFact(...)` calls. The `import { ..., type Gap }` line may keep `Gap` (still exported) or drop it — leave it imported (harmless) or remove if unused.

- [ ] **Step 2: Run — expect failures** (signature/field mismatch)

Run: `node --import tsx --test tests/unit/consistency-check-engine.test.ts`
Expected: FAIL (compile/`storyElapsed` missing, or wrong findings).

- [ ] **Step 3: Add the field** — `gateway/src/services/consistency/types.ts`, in `LedgerFact` after `storyTime: number;`:

```ts
  storyTime: number;
  /** Cumulative, deterministically-weighted elapsed story-time clock at this fact's scene. */
  storyElapsed: number;
  timeLabel: string | null; transition: string | null;
```

- [ ] **Step 4: Rewrite `evaluateFact`** — `gateway/src/services/consistency/check-engine.ts`. Add the constant near the top (after the `Gap` type) and change the signature + step 3c:

```ts
export type Gap = 'same' | 'day' | 'longer' | 'unknown';

/** Elapsed story-time distance (see audit.ts GAP_WEIGHT) beyond which a stateful
 *  change is treated as a legitimate reset rather than a continuity error. */
export const ELAPSED_THRESHOLD = 30;
```

Replace the `evaluateFact` signature and its step 3 stateful tail:

```ts
export function evaluateFact(fact: LedgerFact, priors: LedgerFact[]): ConsistencyFinding | null {
  if (priors.length === 0) return null;
  const diff = priors.filter(p => p.valueNorm !== fact.valueNorm);
  if (diff.length === 0) return null;

  // 1) Canon divergence  — UNCHANGED (copy existing block verbatim)
  // 2) Immutable mismatch — UNCHANGED (copy existing block verbatim)
  // 3a) Impossibility at same story_time — UNCHANGED (copy existing block verbatim)

  // 3b) A transition justifies the change.
  if (fact.transition) return null;

  // 3c) Stateful change without cause — excuse when every differing prior is far
  // enough back in elapsed story time; otherwise flag the nearest recent prior.
  const recent = diff.filter(p => Math.abs(fact.storyElapsed - p.storyElapsed) < ELAPSED_THRESHOLD);
  if (recent.length === 0) return null;
  const prior = recent.reduce((m, p) => (p.storyElapsed > m.storyElapsed ? p : m));
  const severity: ConsistencyFinding['severity'] =
    Math.abs(fact.storyElapsed - prior.storyElapsed) === 0 ? 'medium' : 'low';
  return finding('continuity', severity, fact, prior,
    `${fact.entity}'s ${fact.attribute} changed from "${prior.valueRaw}" (${prior.chapter}) to "${fact.valueRaw}" (${fact.chapter}) with no stated cause.`,
    `${fact.entity}'s ${fact.attribute} was "${prior.valueRaw}" in ${prior.chapter} and is "${fact.valueRaw}" in ${fact.chapter} with nothing in between — add a transition or fix.`);
}
```

(Keep blocks 1, 2, 3a exactly as they are today — only the signature, the removal of the old `gap`-based 3c, and the new 3c change.)

- [ ] **Step 5: Run — expect pass** (after Task 2 + 3 the audit caller compiles)

Run: `node --import tsx --test tests/unit/consistency-check-engine.test.ts`
Expected: PASS (all cases).

---

### Task 2: Elapsed clock accumulator in the audit

**Files:**
- Modify: `gateway/src/services/consistency/audit.ts` (`GAP_WEIGHT`, `accumulateElapsed`, wire into `runConsistencyAudit`)
- Test: `tests/unit/consistency-audit.test.ts` (accumulator unit test)

**Interfaces:**
- Consumes: `inferGap` (existing, same file); `Gap` (from check-engine).
- Produces: `export function accumulateElapsed(startElapsed: number, prevLabel: string | null, sceneLabels: (string | null)[]): { sceneElapsed: number[]; elapsed: number; lastLabel: string | null }`.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/consistency-audit.test.ts`:

```ts
import { accumulateElapsed } from '../../gateway/src/services/consistency/audit.js';

test('accumulateElapsed: longer jumps add 30, same/unknown add 0, day adds 1', () => {
  const r = accumulateElapsed(0, null, ['that evening', 'next morning', 'two years later', null]);
  // same(0)=0 ; day(+1)=1 ; longer(+30)=31 ; unknown(+0)=31
  assert.deepEqual(r.sceneElapsed, [0, 1, 31, 31]);
  assert.equal(r.elapsed, 31);
  assert.equal(r.lastLabel, null);
});

test('accumulateElapsed: carries the running clock + prev label across calls (chapters)', () => {
  const a = accumulateElapsed(0, null, ['morning']);          // day -> 1
  const b = accumulateElapsed(a.elapsed, a.lastLabel, ['months later']); // longer -> 31
  assert.equal(b.elapsed, 31);
  assert.equal(b.sceneElapsed[0], 31);
});
```

- [ ] **Step 2: Run — expect fail** (`accumulateElapsed` not exported)

Run: `node --import tsx --test tests/unit/consistency-audit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the accumulator** — `gateway/src/services/consistency/audit.ts`. Add near `inferGap` (it uses `Gap` from check-engine; ensure `import { ..., type Gap } from './check-engine.js'` includes it — it already imports from there):

```ts
const GAP_WEIGHT: Record<Gap, number> = { same: 0, day: 1, longer: 30, unknown: 0 };

/** Advance a cumulative elapsed story-time clock across a chapter's scenes.
 *  Pure + deterministic. sceneElapsed[i] is the clock value at scene i. */
export function accumulateElapsed(
  startElapsed: number, prevLabel: string | null, sceneLabels: (string | null)[],
): { sceneElapsed: number[]; elapsed: number; lastLabel: string | null } {
  let elapsed = startElapsed;
  let prev = prevLabel;
  const sceneElapsed: number[] = [];
  for (const lbl of sceneLabels) {
    elapsed += GAP_WEIGHT[inferGap(prev, lbl)];
    sceneElapsed.push(elapsed);
    prev = lbl;
  }
  return { sceneElapsed, elapsed, lastLabel: prev };
}
```

- [ ] **Step 4: Wire it into `runConsistencyAudit`** — add a running clock var next to `storyBase` (`let storyBase = 0;`):

```ts
  let storyBase = 0;
  let elapsedClock = 0;
```

Replace the per-chapter gap block:

```ts
    // Infer gap from the first scene's timeLabel vs the previous chapter's last scene.
    const firstSceneLabel = extractResult.scenes[0]?.timeLabel ?? null;
    const gap: Gap = inferGap(prevTimeLabel, firstSceneLabel);
    // Update prevTimeLabel to the last scene of this chapter.
    const lastScene = extractResult.scenes[extractResult.scenes.length - 1];
    prevTimeLabel = lastScene?.timeLabel ?? null;
```

with:

```ts
    // Advance the cumulative elapsed clock across this chapter's scenes.
    const sceneLabels = extractResult.scenes.map(s => s.timeLabel ?? null);
    const { sceneElapsed, elapsed: newElapsed, lastLabel } = accumulateElapsed(elapsedClock, prevTimeLabel, sceneLabels);
    elapsedClock = newElapsed;
    prevTimeLabel = lastLabel;
```

In the `full` fact construction add `storyElapsed`, and drop `gap` from the `evaluateFact` call:

```ts
      const full: LedgerFact = {
        ...f,
        world: worldName,
        bookSlug: slug,
        chapter: chapterName,
        canonical: isCanonical,
        storyElapsed: sceneElapsed[f.scene] ?? newElapsed,
      };
```

```ts
        const finding = evaluateFact(full, priors);
```

- [ ] **Step 5: Run — expect pass**

Run: `node --import tsx --test tests/unit/consistency-audit.test.ts`
Expected: PASS (accumulator + existing inferGap tests).

---

### Task 3: Persist `story_elapsed` in the fact store

**Files:**
- Modify: `gateway/src/services/consistency/fact-store.ts` (table column + migration + insert + read)
- Test: `tests/unit/consistency-fact-store.test.ts` (round-trip)

**Interfaces:**
- Consumes: `LedgerFact.storyElapsed` (Task 1).

- [ ] **Step 1: Add the column to the table create** — in the `CREATE TABLE IF NOT EXISTS facts (...)` block, change the `story_time` line to include the new column:

```sql
          story_time INTEGER NOT NULL, story_elapsed INTEGER NOT NULL DEFAULT 0, time_label TEXT, transition TEXT,
```

- [ ] **Step 2: Add a fail-soft migration for existing DBs** — immediately after the `this.db.exec(` create block (still inside the `try`):

```ts
      // Additive migration for DBs created before story_elapsed existed.
      const factCols = this.db.prepare(`PRAGMA table_info(facts)`).all();
      if (!factCols.some((c: any) => c.name === 'story_elapsed')) {
        this.db.exec(`ALTER TABLE facts ADD COLUMN story_elapsed INTEGER NOT NULL DEFAULT 0`);
      }
```

- [ ] **Step 3: Write + read the column** — in `insertFacts`, add `story_elapsed` to the column list and `@storyElapsed` to VALUES:

```ts
    const stmt = this.db.prepare(`INSERT INTO facts
      (world, book_slug, entity, aliases, attribute, type, value_raw, value_norm, story_time, story_elapsed, time_label, transition, chapter, scene, source, evidence, canonical)
      VALUES (@world,@bookSlug,@entity,@aliases,@attribute,@type,@valueRaw,@valueNorm,@storyTime,@storyElapsed,@timeLabel,@transition,@chapter,@scene,@source,@evidence,@canonical)`);
```

In `priorFacts`, add `storyElapsed` to the mapped object:

```ts
      storyTime: r.story_time, storyElapsed: r.story_elapsed ?? 0, timeLabel: r.time_label, transition: r.transition,
```

- [ ] **Step 4: Update the fact-store test** — in `tests/unit/consistency-fact-store.test.ts`, add `storyElapsed` to the test's `LedgerFact` factory/literals (TS now requires it), and add one assertion that a stored `storyElapsed` round-trips:

```ts
// add storyElapsed to the fact factory defaults, e.g. storyElapsed: 0
test('storyElapsed round-trips through insert + priorFacts', async () => {
  // (mirror the file's existing store setup; skip if better-sqlite3 unavailable)
  // insert a fact with storyElapsed: 42, then read it back via priorFacts and assert 42.
});
```

(Mirror the existing setup/skip-when-unavailable pattern already in that test file; if the file already round-trips a fact, just extend the asserted object with `storyElapsed`.)

- [ ] **Step 5: Run — expect pass**

Run: `node --import tsx --test tests/unit/consistency-fact-store.test.ts`
Expected: PASS (skips cleanly if better-sqlite3 is unavailable).

---

### Task 4: Verify whole change + extend the smoke test

**Files:**
- Modify: `tests/consistency-smoke.sh` (planted time-skip case)

- [ ] **Step 1: Type-check + full unit suite**

Run: `npx tsc --noEmit` then `node --import tsx --test tests/unit/*.test.ts`
Expected: tsc clean; full suite green (no other `LedgerFact` construction site left without `storyElapsed` — tsc will name any).

- [ ] **Step 2: Extend the smoke test** — in `tests/consistency-smoke.sh`, add a planted manuscript chapter pair where a character's emotional/relationship state legitimately changes after an explicit large time skip (a chapter whose first scene `timeLabel` is "two years later"), and assert the report does NOT contain a `continuity` finding for that attribute — while keeping the existing planted contradiction (eye-color) that MUST still be flagged. Mirror the file's existing planting + report-assertion helpers. If the live model is too weak (the smoke already SKIPs LLM-dependent assertions gracefully), keep the new assertion behind the same capability/skip guard.

- [ ] **Step 3: Run the smoke locally**

Run: `bash tests/consistency-smoke.sh`
Expected: existing checks pass; the new time-skip case is not flagged (or SKIPs gracefully if the model can't extract).

---

## Self-Review

**Spec coverage:** elapsed clock (Task 2) ✓; `storyElapsed` field + persistence (Tasks 1, 3) ✓; story-time-aware 3c with threshold + nearest-recent-prior + severity (Task 1) ✓; all-stateful scope (Task 1, no category filter) ✓; deterministic, no extractor change ✓; tests + smoke (Tasks 1–4) ✓; fail-soft additive column (Task 3) ✓.

**Placeholder scan:** Task 3 Step 4 and Task 4 Step 2 say "mirror the file's existing pattern" rather than reproducing the whole harness — acceptable because they extend existing test/smoke scaffolding rather than introducing new structure; the asserted values (storyElapsed 42; "two years later" not flagged) are concrete. No TBDs.

**Type consistency:** `evaluateFact(fact, priors)` used identically in audit + tests; `ELAPSED_THRESHOLD = 30` and `GAP_WEIGHT.longer = 30` consistent; `storyElapsed` field name identical across types/store/audit/tests; `accumulateElapsed` return shape `{ sceneElapsed, elapsed, lastLabel }` used as defined.
