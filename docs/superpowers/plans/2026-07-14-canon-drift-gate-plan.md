# Canon Drift Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch canon-drift errors (unknown town/road proper nouns like "Bay Haven", plus semantic contradictions) at the source — right after the setting- and character-bible steps — instead of fighting them 36 times downstream in the per-chapter consistency audit.

**Architecture:** Reorder the two romance-deterministic bible steps so *setting generates before characters*; persist the human-verified intake grounding as a durable per-book anchor; add a hybrid detector (a free, pure deterministic proper-noun/place gate + an LLM contradiction pass) that emits the existing `DeAiEdit[]` edit-list shape and applies through the shipped `applyDeAiEdits`; wire it as two new gate steps (Gate A: setting-vs-anchor; Gate B: characters-vs-{setting, anchor}). Ambiguous conflicts route to the existing ConfirmationGate. Everything is fail-soft and backward compatible — a book without a persisted anchor no-ops the gates.

**Tech Stack:** Node 22 + TypeScript (NodeNext, `.js` import extensions), Node built-in test runner (`node:test` via `--import tsx`), Express/library-pipeline JSON, the shipped `deterministic-apply.ts` machinery.

## Global Constraints

- **Node 22+**; TypeScript via `tsx` (never `ts-node`). Source is `.ts`; **all local imports use `.js` extensions** (NodeNext).
- **Test runner is Node's built-in runner, NOT vitest.** Single-file run: `node --import tsx --test tests/unit/<file>.test.ts`. Full suite: `npm run test:unit`. Tests use `import { test } from 'node:test'` and `import assert from 'node:assert/strict'`.
- **Every task ends green on both** `npx tsc --noEmit` (clean) **and** its own unit test file.
- **Fail-soft everywhere** (repo convention): a missing anchor, an entity-extraction error, or an LLM-pass error logs `  ℹ …` / `  ⚠ …` and does **not** block the pipeline. Startup/execution must never require the new feature to succeed.
- **Surgical changes only.** Reuse `DeAiEdit`, `parseAuditEdits`, `applyDeAiEdits` from `deterministic-apply.ts` by *import* — do not edit that file. New logic lives in a new `canon-drift.ts`.
- **No `commit_message`/`git commit` here** — this repo uses the `commit_message` + `./push.sh` workflow; the maintainer commits. Steps below say "Commit" per the writing-plans format, but in THIS repo that means: stage nothing, just checkpoint mentally / let the reviewer gate. Do not run `git commit`.
- **Additive-optional manifest fields** carry the standard comment `// … (additive-optional, no schema bump)` and do **not** bump `BOOK_SCHEMA_VERSION`.
- The anchor artifact is `workspace/books/<slug>/data/verified-canon.md`; the manifest block is **`manifest.verifiedCanon`** (see Risk R1 — the spec's `manifest.grounding` name collides with an existing field).

---

## Grounding facts (verified against the live code — read before starting)

- **Two romance-deterministic pipelines** are twins: `library/pipelines/romance-sweet-deterministic.json` and `library/pipelines/romance-spicy-deterministic.json`. In each, `steps[2]` = **Character Bible** and `steps[3]` = **Setting**, both `"skill": "book-bible"`, `"phase": "bible"`. Their distinct prompts come **entirely from each step's own `promptTemplate`** (interpolated in `gateway/src/services/pipeline-expand.ts` `emitStep()`), *not* from position-keyed code. Swapping the two step objects swaps their prompts — but the template TEXT contains cross-references ("Use the premise **and character bible** in your context" in Setting; "Use the premise in your context" in Character Bible) that become wrong after the reorder and MUST be edited (Task 8).
- A library pipeline's `name` becomes the project **`type`** (`createProjectFromPipeline`, `projects.ts:~915`). So `project.type === 'romance-sweet-deterministic'` — it is **neither** `novel-pipeline` **nor** `book-production`, so `buildProjectContext` (`projects.ts:1963`) takes the **default** branch and injects **prior completed steps** ("## Previous Steps Completed", `projects.ts:1965`). After the reorder the Character Bible step therefore automatically sees the Setting output in context. Good — the reorder needs no context-engine change.
- **Deterministic-apply reuse** (`gateway/src/services/deterministic-apply.ts`): `interface DeAiEdit { op:'swap'|'rewrite'; find:string; replace?:string; instruction?:string; reason?:string }`; `parseAuditEdits(raw): DeAiEdit[]` (tolerant array extraction); `applyDeAiEdits(base, edits, rewriteFn?): Promise<ApplyResult>` (literal find/replace, drops any `find` not byte-exact, guards ballooning). `runDeterministicApply(steps, step, rewriteFn)` is **chapter-keyed** (`role:'draft'` + `chapterNumber`) and **throws** if no draft — so it CANNOT serve a canon gate; a new sibling runner is required.
- **Apply dispatch happens in THREE places** and all branch on `skill === 'deterministic-apply'`: `gateway/src/index.ts:2487`, `gateway/src/api/routes/projects.routes.ts:626`, `gateway/src/api/routes/projects.routes.ts:1114`. The canon gate adds a sibling `skill === 'canon-drift-apply'` branch at the SAME three sites (see Shared-file matrix).
- **Intake grounding** (`gateway/src/services/premise-intake.ts`): `interface Discrepancy { id; premiseClaim; finding; status:'pass'|'fail'; suggestion?; targetField:'setting'|'blueprint'|'characters' }`; `interface GroundingResult { dossier:string; discrepancies:Discrepancy[]; status:'grounded'|'fallback-llm'|'skipped'; citations:Array<{title:string;url?:string}> }`; `ground()` early-returns `{dossier:setting, discrepancies:[], status:'skipped', citations:[]}` for a non-real place. `composeGroundedSetting(authorSetting, geo, status)` appends a `## Verified Real-World Geography` section.
- **Intake vs create are separate requests.** `POST /api/books/intake` (`books.routes.ts:98-103`) runs `parse()`+`ground()`, folds `dossier` into `seeds.setting`, returns `{ seeds, gaps, discrepancies, realPlace, groundingStatus }` to the **client**, and **drops `citations`**. `POST /api/books` (`books.routes.ts:744-756`) rebuilds `seeds` from body strings and calls `services.books.create({...})` — the discrepancy ledger never reaches create today (this is the "it evaporates" bug the spec cites). See Risk R2 for the bridge.
- **BookService.create** (`gateway/src/services/book.ts:237`) builds the manifest at `:367-396` with the additive-optional spread idiom `...(sel.x ? { x: sel.x } : {})`, creates `data/` at `:344`, writes `book.json` via `writeFileAtomic` at `:397`. `BookSelection` is `book.ts:30-57`. `dataDirOf(slug)` (`book.ts:795`) → `workspace/books/<slug>/data/`.
- **BookManifest** (`gateway/src/services/book-types.ts:39-75`) already has **`grounding?: { enabled?: boolean }`** at `:70` (Flagship Plan 4 research toggle) and `seeds?: {...}` at `:73`. `BOOK_SCHEMA_VERSION = 2` (`:9`). **Do not reuse `grounding`** — use `verifiedCanon` (Risk R1).
- **Consistency routing**: task type `consistency` → `mid` tier / reasoning `high` (`router.ts:105,131`), output budget 8192 (`:157`). But the deterministic pipeline's audit steps route via a per-step `modelOverride` (e.g. `auto:newest-sonnet`), NOT the bare `consistency` task type. The new canon-audit step follows the same pattern with `modelOverride: { provider:'openrouter', model:'auto:newest-haiku', temperature:0.2 }` (Risk R3).
- **ConfirmationGate** (`gateway/src/services/confirmation-gate.ts`): `createRequest(input: CreateConfirmationInput)`; `CreateConfirmationInput = { service; action; platform; description; payload; riskLevel; isReversible; disclosures?; dryRunResult?; rollbackSteps?; estimatedCost? }`.
- **Existing tests to mirror**: `tests/unit/deterministic-apply.test.ts` (edit-list shape + apply), `tests/unit/book-seeds.test.ts` (create persists a manifest block + re-reads book.json from disk), `tests/unit/premise-grounding.test.ts` (`GroundingResult` shape), `tests/unit/library-pipeline-skill-refs.test.ts` (every pipeline `skill` must resolve — the guard to extend), `tests/unit/romance-pipelines.test.ts` (pipeline-shape assertions).

---

## File Structure

**Create:**
- `gateway/src/services/canon-drift.ts` — the whole detector: `extractPlaces()`, `entityGate()`, `canonDriftAudit()`, and the gate runner `runCanonDriftGate()`. Pure/dependency-free except the runner, which takes injected deps (mirrors `deterministic-apply.ts`'s injection style). Imports `DeAiEdit`/`parseAuditEdits`/`applyDeAiEdits` from `./deterministic-apply.js`.
- `skills/author/romance-canon-audit/SKILL.md` — LLM contradiction-pass skill (edit-list output), sibling of `romance-consistency-audit`.
- `tests/unit/canon-drift-entity-gate.test.ts` — Task 1.
- `tests/unit/canon-drift-audit.test.ts` — Task 2 (merge/dedupe/ambiguous).
- `tests/unit/canon-drift-runner.test.ts` — Task 4 (runner with injected deps).
- `tests/unit/canon-drift-persist.test.ts` — Task 6 (create persists `verifiedCanon`).
- `tests/unit/canon-drift-pipeline-order.test.ts` — Task 8 (reorder + gate steps present).
- `tests/unit/canon-drift-fixture.test.ts` — Task 9 (project-75 "Bay Haven" regression).

**Modify:**
- `gateway/src/services/book-types.ts` — add `verifiedCanon?` to `BookManifest` (Task 6).
- `gateway/src/services/book.ts` — add `verifiedCanon?` to `BookSelection`; spread into manifest + write `data/verified-canon.md` in `create()` (Task 6).
- `gateway/src/api/routes/books.routes.ts` — `/api/books` reads `verifiedCanon` from body → `create()`; `/api/books/intake` stops dropping `citations` (Task 7).
- `gateway/src/index.ts` (`:2487`), `gateway/src/api/routes/projects.routes.ts` (`:626`, `:1114`) — add `skill === 'canon-drift-apply'` dispatch branch (Task 5).
- `library/pipelines/romance-sweet-deterministic.json`, `library/pipelines/romance-spicy-deterministic.json` — reorder steps 3↔4, fix cross-reference wording, insert Gate A + Gate B step pairs (Task 8).
- `tests/unit/library-pipeline-skill-refs.test.ts` — no code change needed (guard auto-covers the new `romance-canon-audit` skill once it exists and is referenced); confirm it passes in Task 8.

---

## Shared-file conflict matrix (canon-drift feature ↔ de-AI / deterministic-editing feature)

| File | Canon-drift touches | De-AI / deterministic feature also touches | Sequencing rule |
|------|---------------------|--------------------------------------------|-----------------|
| `gateway/src/services/deterministic-apply.ts` | **import only** (no edit) | owns/edits it | Canon must NOT edit this file — keep all new logic in `canon-drift.ts`. If the de-AI feature changes a `DeAiEdit`/`applyDeAiEdits` signature, canon re-imports; no merge conflict. |
| `gateway/src/index.ts:2487` | adds `canon-drift-apply` branch next to the `deterministic-apply` branch | edits the `deterministic-apply` branch | Land the canon branch as a NEW `else if` immediately after the existing one — adjacent lines, minimize by not reformatting the existing branch. |
| `gateway/src/api/routes/projects.routes.ts:626` & `:1114` | same new branch at both sites | same two branches | Same rule; both sites must stay in lockstep (they already duplicate each other). |
| `library/pipelines/romance-sweet-deterministic.json` / `…spicy…` | reorder bible steps + insert 2 gate pairs | already contains the shipped `romance-deai-audit` + `deterministic-apply` per-chapter block | Do NOT touch the `expand:"chapters"` block; only edit the top-level bible steps (indices 2-3) and insert gate steps between them and the outline step. |
| `gateway/src/services/projects.ts` | **read-only** (default context path already works) | may edit prompt/context logic | No canon edit here — flag if a conflict appears. |
| `gateway/src/services/book.ts` / `book-types.ts` | add `verifiedCanon` | low overlap | Independent; land anytime. |

---

## Risks / under-specified points (resolved)

- **R1 — `manifest.grounding` name collision (spec §2).** The spec says persist `manifest.grounding = { status, citations, discrepancies }`, but `BookManifest.grounding?: { enabled?: boolean }` already exists (`book-types.ts:70`, Flagship Plan 4 research toggle). **Resolution:** persist under a new, non-colliding key **`manifest.verifiedCanon`**. Same data, no overload, matches the `data/verified-canon.md` filename. Deviation from the spec's literal key name, deliberately.
- **R2 — intake and create are separate requests; the ledger evaporates before create (spec §2 "write on book create").** `POST /api/books/intake` computes `GroundingResult` and returns it to the client; `POST /api/books` never sees the discrepancies. **Resolution (minimal, server-side):** (a) `/api/books/intake` additionally returns `citations` (currently dropped); (b) `POST /api/books` accepts an optional `verifiedCanon` object in the request body and threads it into `create()`; (c) `create()` persists it. The one dependency is that the **client's intake→create flow forwards** the `{ groundingStatus, discrepancies, citations }` it already received. Until the client forwards it, the anchor is simply absent and **both gates no-op** — which the spec explicitly permits (backward-compatible, fail-soft §Goals.5, §Error handling). Flag the tiny client-forward as a follow-on; it is out of this plan's server scope. *Rejected alternative:* re-running `ground()` inside create (a second paid research+LLM call) — wasteful and changes create's latency profile.
- **R3 — "routes to the `consistency` task type (newest-haiku)" (spec §3B).** In these pipelines, audit steps do NOT use the bare `consistency` task type; they pin a model via per-step `modelOverride`. Bare `consistency` maps to `mid` tier, not specifically Haiku. **Resolution:** give the canon-audit step `taskType:"revision"` + `modelOverride:{ provider:"openrouter", model:"auto:newest-haiku", temperature:0.2 }`, matching the pipeline's own convention and the spec's newest-haiku intent. The `-audit$` skill-name suffix also exempts it from the short-response retry guard (`index.ts:2467`).
- **R4 — deterministic replacement-target ambiguity for the fixture (spec §Testing, "Bay-Haven→Long-Beach-Boulevard").** Detecting that "Bay Haven" is an unknown place is easy; choosing the RIGHT canonical replacement (the road "Long Beach Boulevard" vs the town "Surf City") is judgment. **Resolution:** the entity gate classifies each unknown place-phrase as **road-class** (contains a way/feature cue: boardwalk, boulevard, street, avenue, way, drive, lane, pier, promenade) or **town-class** (bare, or a town/city/island/beach cue), and swaps to the anchor's dominant **road** or **town** respectively. "Bay Haven **boardwalk**" → road-class → anchor road "Long Beach Boulevard". This is fully deterministic and produces the fixture's expected swap. When the anchor has no unambiguous single road/town for the required class (e.g. two candidate towns), the gate emits **no edit** and routes the conflict to ConfirmationGate (spec §3 "genuinely ambiguous … route to the existing ConfirmationGate").
- **R5 — distinguishing places from characters/businesses deterministically (spec §Testing "ignores fictional-business names").** **Resolution:** candidate extraction is **cue-driven** — only proper nouns in a *geographic role* (a road/town/feature cue word adjacent, or a `town of X` / `in X,` pattern) are candidates. Character names (no geo cue) and fictional businesses (Cafe/Grill/Inn/Bar/Bakery/Bookstore/Diner cue) are never candidates, so they are never flagged. This mirrors intake's "a fictional business is NOT a discrepancy" rule.
- **R6 — three duplicated dispatch sites.** Adding the branch in three places is error-prone and collides with the de-AI feature's edits. **Resolution:** put ALL behavior in `runCanonDriftGate()` so each site is a 3-line `else if` that just calls it; keep the three edits byte-identical (they already duplicate each other). Verified by `tsc` + the runner unit test + the smoke test (no unit test drives the live dispatch).

---

### Task 1: Deterministic entity gate (`extractPlaces` + `entityGate`)

Most-testable-first: a pure function, no I/O, no model. It extracts the geographic proper-noun set from anchors and flags any geographic proper noun in the doc that is absent from the anchor set, emitting `swap` edits to the anchor's canonical road/town.

**Files:**
- Create: `gateway/src/services/canon-drift.ts`
- Test: `tests/unit/canon-drift-entity-gate.test.ts`

**Interfaces:**
- Consumes: `DeAiEdit` from `./deterministic-apply.js`.
- Produces (later tasks rely on these exact signatures):
  - `interface PlaceSet { towns: string[]; roads: string[] }`
  - `export function extractPlaces(text: string): PlaceSet`
  - `interface EntityConflict { phrase: string; reason: string }`
  - `interface EntityGateResult { edits: DeAiEdit[]; ambiguous: EntityConflict[] }`
  - `export function entityGate(doc: string, anchors: string[]): EntityGateResult`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/canon-drift-entity-gate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPlaces, entityGate } from '../../gateway/src/services/canon-drift.js';

const ANCHOR = `## Setting
The story is set in Surf City on Long Beach Island. Scenes unfold along
Long Beach Boulevard, the main road through town. The Rusty Anchor Cafe sits
on the boulevard near the marina.`;

test('extractPlaces pulls town + road names, ignoring businesses', () => {
  const p = extractPlaces(ANCHOR);
  assert.ok(p.towns.includes('Surf City'), 'Surf City is a town');
  assert.ok(p.roads.includes('Long Beach Boulevard'), 'the boulevard is a road');
  assert.ok(!p.towns.includes('Rusty Anchor Cafe') && !p.roads.includes('Rusty Anchor Cafe'),
    'a fictional business is not a place');
});

test('entityGate flags an unknown road-class place and swaps to the anchor road', () => {
  const doc = 'They walked the Bay Haven boardwalk at sunset, hand in hand.';
  const r = entityGate(doc, [ANCHOR]);
  assert.equal(r.ambiguous.length, 0);
  assert.equal(r.edits.length, 1);
  assert.deepEqual(r.edits[0], {
    op: 'swap',
    find: 'Bay Haven boardwalk',
    replace: 'Long Beach Boulevard',
    reason: 'canon-drift: "Bay Haven boardwalk" is not in the verified place list; nearest canonical road is Long Beach Boulevard',
  });
});

test('entityGate passes a clean doc (no unknown places)', () => {
  const doc = 'They strolled down Long Beach Boulevard in Surf City.';
  assert.deepEqual(entityGate(doc, [ANCHOR]).edits, []);
});

test('entityGate ignores fictional business names (not a discrepancy)', () => {
  const doc = 'They shared coffee at the Driftwood Bakery on the boulevard.';
  assert.deepEqual(entityGate(doc, [ANCHOR]).edits, []);
});

test('entityGate no-ops when there is no anchor text (fail-soft)', () => {
  assert.deepEqual(entityGate('Anywhere in Bay Haven.', []).edits, []);
  assert.deepEqual(entityGate('Anywhere in Bay Haven.', ['']).edits, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/canon-drift-entity-gate.test.ts`
Expected: FAIL — `Cannot find module '.../canon-drift.js'` / `extractPlaces is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/services/canon-drift.ts
import type { DeAiEdit } from './deterministic-apply.js';

// Cue words that mark a proper noun as a ROAD/way (vs a town or a business).
const ROAD_CUES = ['Boardwalk', 'Boulevard', 'Street', 'Avenue', 'Road', 'Way', 'Drive', 'Lane', 'Pier', 'Promenade'];
// Cue words that mark a proper noun as a TOWN/place.
const TOWN_CUES = ['City', 'Town', 'Village', 'Island', 'Beach', 'Harbor', 'Bay', 'Township', 'Shores'];
// Cue words that mark a proper noun as a BUSINESS (never a place → never flagged).
const BIZ_CUES = ['Cafe', 'Café', 'Bar', 'Grill', 'Inn', 'Diner', 'Bakery', 'Bookstore', 'Shop', 'Restaurant', 'Tavern', 'Pub', 'Market', 'Motel', 'Hotel'];

export interface PlaceSet { towns: string[]; roads: string[] }
export interface EntityConflict { phrase: string; reason: string }
export interface EntityGateResult { edits: DeAiEdit[]; ambiguous: EntityConflict[] }

// A capitalized multi-word proper-noun run: "Long Beach Boulevard", "Surf City".
const PROPER = '[A-Z][a-zA-Z]+(?:\\s+[A-Z][a-zA-Z]+)*';

function uniq(a: string[]): string[] { return Array.from(new Set(a)); }

/** A place-phrase is a proper-noun run whose LAST token is a road or town cue. */
export function extractPlaces(text: string): PlaceSet {
  const s = String(text ?? '');
  const roads: string[] = [];
  const towns: string[] = [];
  const re = new RegExp(`\\b(${PROPER})\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const phrase = m[1];
    const last = phrase.split(/\s+/).pop() as string;
    if (BIZ_CUES.includes(last)) continue;            // business → not a place
    if (ROAD_CUES.includes(last)) roads.push(phrase);
    else if (TOWN_CUES.includes(last)) towns.push(phrase);
  }
  return { towns: uniq(towns), roads: uniq(roads) };
}

/** Classify a doc place-phrase as 'road' | 'town' | null (not a place). */
function classify(phrase: string): 'road' | 'town' | null {
  const last = phrase.split(/\s+/).pop() as string;
  if (BIZ_CUES.includes(last)) return null;
  if (ROAD_CUES.includes(last)) return 'road';
  if (TOWN_CUES.includes(last)) return 'town';
  return null;
}

export function entityGate(doc: string, anchors: string[]): EntityGateResult {
  const anchorText = (anchors ?? []).filter(Boolean).join('\n\n');
  const edits: DeAiEdit[] = [];
  const ambiguous: EntityConflict[] = [];
  if (!anchorText.trim() || !String(doc ?? '').trim()) return { edits, ambiguous };

  const anchorPlaces = extractPlaces(anchorText);
  const known = new Set<string>([...anchorPlaces.towns, ...anchorPlaces.roads]);
  const docPlaces = extractPlaces(doc);
  const seen = new Set<string>();

  for (const phrase of [...docPlaces.roads, ...docPlaces.towns]) {
    if (known.has(phrase) || seen.has(phrase)) continue;
    seen.add(phrase);
    const kind = classify(phrase);
    if (!kind) continue;
    const targets = kind === 'road' ? anchorPlaces.roads : anchorPlaces.towns;
    if (targets.length !== 1) {                        // no single canonical target → ambiguous
      ambiguous.push({ phrase, reason: `unknown ${kind} "${phrase}" — anchor has ${targets.length} candidate ${kind}s` });
      continue;
    }
    const replace = targets[0];
    edits.push({
      op: 'swap', find: phrase, replace,
      reason: `canon-drift: "${phrase}" is not in the verified place list; nearest canonical ${kind} is ${replace}`,
    });
  }
  return { edits, ambiguous };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/canon-drift-entity-gate.test.ts` → Expected: PASS (5 tests).
Then: `npx tsc --noEmit` → Expected: clean.

- [ ] **Step 5: Checkpoint** — entity gate isolated and green. (No `git commit` in this repo.)

---

### Task 2: `canonDriftAudit` — merge (A)+(B), dedupe, split ambiguous

Merge the deterministic entity edits with the parsed LLM contradiction edits, dedupe by `find`, and separate genuinely-ambiguous conflicts (for the ConfirmationGate) from auto-applicable edits.

**Files:**
- Modify: `gateway/src/services/canon-drift.ts`
- Test: `tests/unit/canon-drift-audit.test.ts`

**Interfaces:**
- Consumes: `entityGate` (Task 1); `parseAuditEdits`, `DeAiEdit` from `./deterministic-apply.js`.
- Produces:
  - `interface CanonDriftResult { edits: DeAiEdit[]; ambiguous: EntityConflict[] }`
  - `export function canonDriftAudit(doc: string, anchors: string[], llmAuditRaw: string | null | undefined): CanonDriftResult`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/canon-drift-audit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonDriftAudit } from '../../gateway/src/services/canon-drift.js';

const ANCHOR = `Set in Surf City. The main road is Long Beach Boulevard.`;

test('merges deterministic entity edits with LLM edits (union)', () => {
  const doc = 'They met on the Bay Haven boardwalk nine years ago.';
  const llm = '[{"op":"rewrite","find":"nine years ago","instruction":"they met this June per the nine-week timeline","reason":"timeline"}]';
  const r = canonDriftAudit(doc, [ANCHOR], llm);
  const finds = r.edits.map(e => e.find).sort();
  assert.deepEqual(finds, ['Bay Haven boardwalk', 'nine years ago']);
});

test('dedupes by find — the deterministic entity edit wins over an LLM edit on the same span', () => {
  const doc = 'They walked the Bay Haven boardwalk.';
  const llm = '[{"op":"swap","find":"Bay Haven boardwalk","replace":"Surf City pier","reason":"guess"}]';
  const r = canonDriftAudit(doc, [ANCHOR], llm);
  const bh = r.edits.filter(e => e.find === 'Bay Haven boardwalk');
  assert.equal(bh.length, 1);
  assert.equal(bh[0].replace, 'Long Beach Boulevard'); // entity edit, not the LLM guess
});

test('ambiguous conflict surfaces in .ambiguous, NOT as an edit', () => {
  const anchor = 'Set in Surf City and neighboring Beach Haven.'; // two towns
  const doc = 'They drove to Cedar Cove for the weekend.';        // unknown town, 2 candidates
  const r = canonDriftAudit(doc, [anchor], '[]');
  assert.equal(r.edits.length, 0);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.ambiguous[0].phrase, 'Cedar Cove');
});

test('garbage LLM output degrades to entity edits only (fail-soft)', () => {
  const doc = 'They walked the Bay Haven boardwalk.';
  const r = canonDriftAudit(doc, [ANCHOR], 'not json at all');
  assert.equal(r.edits.length, 1);
  assert.equal(r.edits[0].find, 'Bay Haven boardwalk');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/canon-drift-audit.test.ts`
Expected: FAIL — `canonDriftAudit is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `canon-drift.ts`)

```ts
import { parseAuditEdits, type DeAiEdit } from './deterministic-apply.js';
// (merge with the existing `import type { DeAiEdit }` line — one import from that module.)

export interface CanonDriftResult { edits: DeAiEdit[]; ambiguous: EntityConflict[] }

/**
 * Hybrid canon-drift audit: union the deterministic entity gate (A) with the
 * LLM contradiction edits (B), deduped by `find` (the deterministic entity edit
 * wins — it is anchored to the verified place list, the LLM edit is a guess).
 * Ambiguous entity conflicts are returned separately for the ConfirmationGate;
 * they are never auto-applied.
 */
export function canonDriftAudit(
  doc: string,
  anchors: string[],
  llmAuditRaw: string | null | undefined,
): CanonDriftResult {
  const gate = entityGate(doc, anchors);
  const byFind = new Map<string, DeAiEdit>();
  for (const e of gate.edits) byFind.set(e.find, e);          // entity edits first (authoritative)
  for (const e of parseAuditEdits(llmAuditRaw)) {
    if (!byFind.has(e.find)) byFind.set(e.find, e);           // LLM edit only if it doesn't collide
  }
  return { edits: Array.from(byFind.values()), ambiguous: gate.ambiguous };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/canon-drift-audit.test.ts` → PASS (4 tests). Then `npx tsc --noEmit` → clean.

- [ ] **Step 5: Checkpoint.**

---

### Task 3: The `romance-canon-audit` LLM skill

A `*-canon-audit` skill that reads a canon doc + its anchors and emits a `DeAiEdit[]` edit list of contradictions the string check can't see (semantic drift). Sibling of `romance-consistency-audit`. Its `-audit` suffix makes `runDeterministicApply`-style audit collection and the short-response guard treat it correctly.

**Files:**
- Create: `skills/author/romance-canon-audit/SKILL.md`
- Test: reuse `tests/unit/library-pipeline-skill-refs.test.ts` (verified in Task 8) + a one-line existence assertion here.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/canon-drift-audit.test.ts  — APPEND this test to the Task 2 file
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('romance-canon-audit skill exists with the expected frontmatter name', () => {
  const md = readFileSync(join(ROOT, 'skills', 'author', 'romance-canon-audit', 'SKILL.md'), 'utf8');
  assert.match(md, /^name:\s*romance-canon-audit$/m);
  assert.match(md, /JSON/); // instructs edit-list output
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/canon-drift-audit.test.ts`
Expected: FAIL — `ENOENT … romance-canon-audit/SKILL.md`.

- [ ] **Step 3: Write the skill file**

```markdown
---
name: romance-canon-audit
description: Canon-drift audit for the deterministic pipeline — checks a freshly generated canon document (setting bible or character bible) against the verified anchors (verified real-world geography + the setting bible) and emits a strict JSON edit list of surgical fixes for contradictions. Never rewrites the document.
author: BookClaw
version: 1.0.0
triggers:
  - "canon drift audit"
  - "canon audit"
  - "canon edit list"
  - "bible consistency"
permissions:
  - file:read
---

# Canon-Drift Audit — Edit List (for deterministic apply)

You are a canon checker, not an editor. Read the CANON DOCUMENT in your context
(a setting bible or a character bible) and compare it against the ANCHORS in your
context — the "Verified Real-World Geography" the author signed off on at intake,
and (for a character bible) the already-generated setting bible. Output a JSON
array of the smallest possible edits that fix places where the document
CONTRADICTS an anchor. A separate deterministic step applies your edits by exact
find-and-replace — it does NOT run a model over the document. Therefore:

- **Your `find` must be copied VERBATIM from the canon document** — exact
  characters, punctuation, spacing. A `find` that doesn't match byte-for-byte is
  silently dropped. Quote a span just long enough to be unique.
- **You never rewrite or reproduce the document.** Your ENTIRE output is the JSON
  array — no prose, no document, no commentary, no markdown fences.
- You can only correct a wrong detail in place; you cannot add scenes, characters,
  or locations.

## The anchor cascade (what wins)

`verified-canon` (human-blessed geography) **>** setting bible **>** character bible.
Reconcile the document TO the anchor. Never "fix" the anchor to match the document.

## Output format (exactly this)

A single JSON array. Each element is one edit:

- **Fact swap** — a wrong detail replaced with the canon-correct one:
  `{"op":"swap","find":"<verbatim span>","replace":"<corrected span>","reason":"<anchor fact it violated>"}`
- **Scoped fix** — a contradiction needing a short rephrase (the applier rewrites
  ONLY that span at similar length):
  `{"op":"rewrite","find":"<verbatim span>","instruction":"<fix to match the anchor>","reason":"<anchor fact>"}`

Output nothing but the array. Example (illustrative — detect what is actually present):

```
[
  {"op":"swap","find":"the Bay Haven boardwalk","replace":"Long Beach Boulevard","reason":"verified geography: town is Surf City on LBI; no Bay Haven, no boardwalk"},
  {"op":"rewrite","find":"they had run the shop together for years","instruction":"the town's summer economy is a nine-week season per the anchor; make the shared history seasonal, not year-round","reason":"nine-week-economy fact"}
]
```

## What to check (against the anchors)

- **Place names** — every town, road, neighborhood, and landmark must match the
  verified geography. Flag an invented town/road (e.g. a place blended from two
  real names) and swap it to the canonical place.
- **Geography & orientation** — direction to the water, what's on which street,
  distances: must match the verified anchor.
- **Setting-derived facts in the character bible** — a backstory that depends on
  the place (a family business, how the couple met, the seasonal economy) must
  not contradict the setting bible or verified geography.
- **Names & relationships** — a character or business renamed vs the setting
  bible.

## Rules

- Only flag genuine CONTRADICTIONS with an anchor — not details that are merely
  new but consistent.
- Keep each `find` as SHORT as possible while still verbatim and unique.
- Fixes must be length-neutral (same-length swap or scoped rewrite).
- If the document is fully consistent with the anchors, output `[]`.
- Output ONLY the JSON array.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/canon-drift-audit.test.ts` → PASS. `npx tsc --noEmit` → clean (no TS change).

- [ ] **Step 5: Checkpoint.**

---

### Task 4: `runCanonDriftGate` — the gate runner (wires detector + apply + ConfirmationGate)

The single entry point the dispatch sites call. Resolves the base canon doc + the LLM canon-audit result + the anchors (all injected — no service imports in `canon-drift.ts`), runs `canonDriftAudit`, applies via `applyDeAiEdits`, and routes ambiguous conflicts to the ConfirmationGate. Fully fail-soft: any missing input → returns the base doc unchanged.

**Files:**
- Modify: `gateway/src/services/canon-drift.ts`
- Test: `tests/unit/canon-drift-runner.test.ts`

**Interfaces:**
- Consumes: `canonDriftAudit` (Task 2); `applyDeAiEdits` from `./deterministic-apply.js`.
- Produces:
```ts
export interface CanonGateStep { skill?: string; role?: string; status: string; result?: string; label?: string; }
export interface CanonGateDeps {
  steps: CanonGateStep[];              // all steps of the running project
  step: CanonGateStep;                 // the canon-drift-apply step being executed
  loadAnchors: () => Promise<string[]>;// verified-canon.md + seeds.setting (+ setting bible for Gate B), injected
  rewriteFn?: (span: string, instruction: string) => Promise<string>;
  onAmbiguous?: (conflicts: EntityConflict[], baseDocLabel: string) => Promise<void>; // → ConfirmationGate
}
export interface CanonGateOutput { text: string; stats: { swaps: number; rewrites: number; skipped: number; ambiguous: number; noAnchor: boolean }; }
export async function runCanonDriftGate(deps: CanonGateDeps): Promise<CanonGateOutput>
```
- **Base-doc resolution:** the base canon doc is the nearest COMPLETED non-audit, non-apply step BEFORE `step` in `steps` (the setting bible for Gate A, the character bible for Gate B). **Audit source:** the completed step(s) between that base doc and `step` whose `skill` ends in `-canon-audit`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/canon-drift-runner.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCanonDriftGate, type CanonGateStep } from '../../gateway/src/services/canon-drift.js';

const ANCHOR = 'Set in Surf City. Main road: Long Beach Boulevard.';

function stepsFor(bibleText: string, auditJson: string): CanonGateStep[] {
  return [
    { label: 'Setting', skill: 'book-bible', status: 'completed', result: ANCHOR },
    { label: 'Character Bible', skill: 'book-bible', status: 'completed', result: bibleText },
    { label: 'Canon Audit', skill: 'romance-canon-audit', status: 'completed', result: auditJson },
    { label: 'Canon Gate', skill: 'canon-drift-apply', status: 'running' },
  ];
}

test('applies the Bay-Haven swap + an LLM edit, returns clean text', async () => {
  const bible = 'She loved the Bay Haven boardwalk. They met nine years ago.';
  const audit = '[{"op":"swap","find":"nine years ago","replace":"last June","reason":"timeline"}]';
  const s = stepsFor(bible, audit);
  const out = await runCanonDriftGate({
    steps: s, step: s[3], loadAnchors: async () => [ANCHOR],
  });
  assert.ok(!out.text.includes('Bay Haven'), 'drift removed');
  assert.ok(out.text.includes('Long Beach Boulevard'), 'swapped to canonical road');
  assert.ok(out.text.includes('last June'), 'LLM edit applied');
  assert.equal(out.stats.swaps, 2);
});

test('no anchor → returns base doc unchanged, flags noAnchor (fail-soft)', async () => {
  const bible = 'She loved the Bay Haven boardwalk.';
  const s = stepsFor(bible, '[]');
  const out = await runCanonDriftGate({ steps: s, step: s[3], loadAnchors: async () => [] });
  assert.equal(out.text, bible);
  assert.equal(out.stats.noAnchor, true);
});

test('ambiguous conflict is routed to onAmbiguous, not auto-applied', async () => {
  const anchor = 'Set in Surf City and Beach Haven.'; // two towns
  const bible = 'They drove to Cedar Cove.';
  const s = stepsFor(bible, '[]'); s[0].result = anchor;
  const seen: string[] = [];
  const out = await runCanonDriftGate({
    steps: s, step: s[3], loadAnchors: async () => [anchor],
    onAmbiguous: async (c) => { seen.push(...c.map(x => x.phrase)); },
  });
  assert.equal(out.text, bible);            // Cedar Cove NOT auto-edited
  assert.deepEqual(seen, ['Cedar Cove']);   // routed to the gate
  assert.equal(out.stats.ambiguous, 1);
});

test('loadAnchors throwing does not blow up the pipeline (fail-soft)', async () => {
  const bible = 'She loved the Bay Haven boardwalk.';
  const s = stepsFor(bible, '[]');
  const out = await runCanonDriftGate({ steps: s, step: s[3], loadAnchors: async () => { throw new Error('disk'); } });
  assert.equal(out.text, bible);
  assert.equal(out.stats.noAnchor, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/canon-drift-runner.test.ts`
Expected: FAIL — `runCanonDriftGate is not a function`.

- [ ] **Step 3: Write minimal implementation** (append to `canon-drift.ts`)

```ts
import { applyDeAiEdits } from './deterministic-apply.js';
// (fold into the single existing import from './deterministic-apply.js')

export interface CanonGateStep { skill?: string; role?: string; status: string; result?: string; label?: string; }
export interface CanonGateDeps {
  steps: CanonGateStep[];
  step: CanonGateStep;
  loadAnchors: () => Promise<string[]>;
  rewriteFn?: (span: string, instruction: string) => Promise<string>;
  onAmbiguous?: (conflicts: EntityConflict[], baseDocLabel: string) => Promise<void>;
}
export interface CanonGateOutput {
  text: string;
  stats: { swaps: number; rewrites: number; skipped: number; ambiguous: number; noAnchor: boolean };
}

const done = (s: CanonGateStep) => s.status === 'completed' && !!s.result;

export async function runCanonDriftGate(deps: CanonGateDeps): Promise<CanonGateOutput> {
  const { steps, step } = deps;
  const idx = steps.indexOf(step);
  const before = idx >= 0 ? steps.slice(0, idx) : steps;
  // Base doc: nearest completed step that is neither an audit nor an apply.
  const base = [...before].reverse().find(s =>
    done(s) && !/-audit$/i.test(s.skill ?? '') && (s.skill ?? '') !== 'canon-drift-apply');
  const empty: CanonGateOutput = { text: base?.result ?? '', stats: { swaps: 0, rewrites: 0, skipped: 0, ambiguous: 0, noAnchor: true } };
  if (!base?.result) return { ...empty, text: '' };

  // Anchors (verified-canon.md + seeds.setting + setting bible) are injected.
  let anchors: string[] = [];
  try { anchors = await deps.loadAnchors(); } catch { anchors = []; }
  const anchorText = anchors.filter(Boolean).join('').trim();
  if (!anchorText) return empty; // no anchor → no gate (backward compatible)

  // LLM canon-audit result(s) that ran on this base doc (after it, before this step).
  const auditRaw = before
    .filter(s => done(s) && /-canon-audit$/i.test(s.skill ?? ''))
    .map(s => s.result ?? '').join('\n');

  const { edits, ambiguous } = canonDriftAudit(base.result, anchors, auditRaw);
  if (ambiguous.length && deps.onAmbiguous) {
    try { await deps.onAmbiguous(ambiguous, base.label ?? 'canon document'); } catch { /* fail-soft */ }
  }
  const res = await applyDeAiEdits(base.result, edits, deps.rewriteFn);
  return {
    text: res.text,
    stats: { swaps: res.appliedSwaps, rewrites: res.appliedRewrites, skipped: res.skipped, ambiguous: ambiguous.length, noAnchor: false },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/canon-drift-runner.test.ts` → PASS (4 tests). `npx tsc --noEmit` → clean.

- [ ] **Step 5: Checkpoint.**

---

### Task 5: Wire the `canon-drift-apply` dispatch branch (3 sites)

Add the branch that runs `runCanonDriftGate` wherever `deterministic-apply` is dispatched today, injecting the anchors from the bound book (verified-canon.md + `seeds.setting`, plus the setting bible step for Gate B) and the ConfirmationGate.

**Files:**
- Modify: `gateway/src/index.ts` (after line 2495, the `deterministic-apply` branch)
- Modify: `gateway/src/api/routes/projects.routes.ts` (after line 633 and after line 1123 — both `deterministic-apply` branches)

**Interfaces:**
- Consumes: `runCanonDriftGate`, `makeScopedRewriteFn` (existing, `deterministic-apply.ts`).
- Anchor loader (build inline at each site): reads `verified-canon.md` from `gateway.books.dataDirOf(project.bookSlug)` (fail-soft: absent → skip), the bound book's `seeds.setting` from the manifest, and — for Gate B — the completed "Setting" bible step's `result` from `project.steps`.

- [ ] **Step 1: Write the guard test first (compile-level + shape)**

There is no unit harness over the live dispatch loop, so the verifiable artifact here is: (a) `tsc` stays clean, and (b) the smoke test still boots. Add a **grep-guard** unit test that asserts all three sites reference the new skill id, so a future edit that drops one site fails loudly.

```ts
// tests/unit/canon-drift-runner.test.ts — APPEND
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2 } from 'node:url';
import { dirname as d2, join as j2 } from 'node:path';
const ROOT2 = j2(d2(f2(import.meta.url)), '..', '..');

test('canon-drift-apply is dispatched at all three sites', () => {
  const files = [
    'gateway/src/index.ts',
    'gateway/src/api/routes/projects.routes.ts',
  ];
  let count = 0;
  for (const rel of files) {
    const src = readFileSync(j2(ROOT2, rel), 'utf8');
    count += (src.match(/canon-drift-apply/g) ?? []).length;
  }
  assert.ok(count >= 3, `expected >=3 canon-drift-apply dispatch refs, found ${count}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/canon-drift-runner.test.ts`
Expected: FAIL on the new test — `found 0`.

- [ ] **Step 3: Add the dispatch branch at each site**

At `gateway/src/index.ts`, immediately after the existing `deterministic-apply` branch (the `console.log('  ✓ deterministic-apply …')` at ~2495), add:

```ts
          } else if ((activeStep as any).skill === 'canon-drift-apply') {
            // Canon Drift Gate: reconcile the freshly generated canon doc to the
            // verified anchor + setting bible. Deterministic entity gate + the LLM
            // canon-audit's edits, applied by code — the doc is never regenerated.
            const slug = (project as any).bookSlug as string | undefined;
            const loadAnchors = async (): Promise<string[]> => {
              const out: string[] = [];
              try {
                const dir = slug ? gateway.books.dataDirOf(slug) : null;
                if (dir) {
                  const vc = join(dir, 'verified-canon.md');
                  if (existsSync(vc)) out.push(await fs.readFile(vc, 'utf-8'));
                }
              } catch { /* fail-soft */ }
              try {
                const mani = slug ? await gateway.books.open(slug) : null;
                const settingSeed = mani?.manifest?.seeds?.setting;
                if (settingSeed) out.push(settingSeed);
              } catch { /* fail-soft */ }
              // Gate B: the completed Setting bible step is also an anchor.
              const setting = project.steps.find(s => (s.label || '').toLowerCase() === 'setting' && s.status === 'completed' && s.result);
              if (setting?.result) out.push(setting.result);
              return out;
            };
            const { text, stats } = await runCanonDriftGate({
              steps: project.steps as any,
              step: activeStep as any,
              loadAnchors,
              rewriteFn: makeScopedRewriteFn((r) => gateway.aiRouter.complete(r)),
              onAmbiguous: async (conflicts, docLabel) => {
                if (!gateway.confirmationGate) return;
                await gateway.confirmationGate.createRequest({
                  service: 'canon-drift-gate', action: 'reconcile-canon', platform: 'internal',
                  description: `Ambiguous canon drift in "${docLabel}": ${conflicts.map(c => c.phrase).join(', ')} — no single canonical place to swap to. Human decision needed.`,
                  payload: { bookSlug: slug ?? null, docLabel, conflicts },
                  riskLevel: 'low', isReversible: true,
                });
              },
            });
            aiResponse = text;
            wasExecutable = true;
            console.log(`  ✓ canon-drift-apply (${(activeStep as any).label}): swaps=${stats.swaps} rewrites=${stats.rewrites} skipped=${stats.skipped} ambiguous=${stats.ambiguous}${stats.noAnchor ? ' (no anchor — no-op)' : ''}`);
```

Add the byte-identical branch at `projects.routes.ts:~633` and `:~1123` (both sites use `gateway`/`project`/`activeStep` in the same shape — confirm the local variable names at each site and match them; the two routes sites already duplicate each other). Ensure `runCanonDriftGate` is imported at the top of each file alongside the existing `runDeterministicApply, makeScopedRewriteFn` import from `../../services/deterministic-apply.js` — **import it from `../../services/canon-drift.js`** (and `./services/canon-drift.js` in index.ts). Confirm `fs`, `existsSync`, `join` are already imported at each site (they are used by neighboring code); if a site lacks one, add the minimal import.

- [ ] **Step 4: Run test + typecheck + smoke**

Run: `node --import tsx --test tests/unit/canon-drift-runner.test.ts` → PASS (now `found >=3`).
Run: `npx tsc --noEmit` → clean.
Run: `npm run test:smoke` → gateway boots, auth assertions pass (proves the new branch didn't break init).

- [ ] **Step 5: Checkpoint.**

---

### Task 6: Persist the verified-canon anchor at book create

Add `verifiedCanon` to the manifest type + create input, spread it into `book.json`, and write `data/verified-canon.md` (dossier + rendered discrepancy ledger). Additive-optional; no schema bump. (Named `verifiedCanon`, not `grounding` — Risk R1.)

**Files:**
- Modify: `gateway/src/services/book-types.ts` (`BookManifest`, after line 70)
- Modify: `gateway/src/services/book.ts` (`BookSelection` ~30-57; `create()` manifest spread ~394 + write `verified-canon.md` near the `data/` mkdir at ~344)
- Test: `tests/unit/canon-drift-persist.test.ts` (mirror `book-seeds.test.ts`)

**Interfaces:**
- Produces:
```ts
// book-types.ts
verifiedCanon?: {
  status: 'grounded' | 'fallback-llm' | 'skipped';
  citations: Array<{ title: string; url?: string }>;
  discrepancies: Array<{ id: string; premiseClaim: string; finding: string; status: 'pass' | 'fail'; suggestion?: string; targetField: 'setting' | 'blueprint' | 'characters' }>;
}; // Canon Drift Gate — human-verified intake anchor (additive-optional, no schema bump)
```
- `BookSelection.verifiedCanon?` uses the **same** object shape (plus an optional `dossier?: string` so `create()` can write the markdown; if absent, `create()` falls back to `seeds.setting`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/canon-drift-persist.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookService } from '../../gateway/src/services/book.js';
import { LibraryService } from '../../gateway/src/services/library.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'canon-persist-'));
  const lib = join(root, 'library');
  await mkdir(join(lib, 'authors', 'default'), { recursive: true });
  await writeFile(join(lib, 'authors', 'default', 'SOUL.md'), '# Author', 'utf8');
  await mkdir(join(lib, 'voices', 'default'), { recursive: true });
  await writeFile(join(lib, 'voices', 'default', 'STYLE-GUIDE.md'), '# Voice', 'utf8');
  await mkdir(join(lib, 'pipelines'), { recursive: true });
  await writeFile(join(lib, 'pipelines', 'novel-pipeline.json'), JSON.stringify({ name: 'novel-pipeline', schemaVersion: 1, dynamic: true, steps: [] }), 'utf8');
  const library = new LibraryService(lib);
  await library.initialize();
  const books = new BookService(join(root, 'workspace', 'books'), library, 'test-app');
  await books.initialize();
  return { root, books };
}

const VERIFIED = {
  status: 'grounded' as const,
  citations: [{ title: 'LBI geography', url: 'https://example.test/lbi' }],
  discrepancies: [{ id: 'd1', premiseClaim: 'town is Bay Haven', finding: 'no such town; it is Surf City', status: 'fail' as const, suggestion: 'use Surf City', targetField: 'setting' as const }],
  dossier: '## Verified Real-World Geography\nSurf City on Long Beach Island; main road Long Beach Boulevard.',
};

test('a plain book has no verifiedCanon block', async () => {
  const { books } = await setup();
  const m = await books.create({ title: 'Plain', author: 'default', voice: 'default', pipeline: 'novel-pipeline' } as any);
  assert.equal((m as any).verifiedCanon, undefined);
});

test('create persists verifiedCanon to book.json and writes data/verified-canon.md', async () => {
  const { root, books } = await setup();
  const m = await books.create({ title: 'Grounded', author: 'default', voice: 'default', pipeline: 'novel-pipeline', verifiedCanon: VERIFIED } as any);
  assert.equal((m as any).verifiedCanon.status, 'grounded');
  assert.equal((m as any).verifiedCanon.discrepancies[0].targetField, 'setting');
  assert.equal((m as any).verifiedCanon.citations[0].title, 'LBI geography');
  // dossier is NOT in the manifest (it goes to the .md file), only status/citations/discrepancies
  assert.equal((m as any).verifiedCanon.dossier, undefined);

  const onDisk = JSON.parse(await readFile(join(root, 'workspace', 'books', m.slug, 'book.json'), 'utf8'));
  assert.equal(onDisk.verifiedCanon.status, 'grounded');
  const md = await readFile(join(root, 'workspace', 'books', m.slug, 'data', 'verified-canon.md'), 'utf8');
  assert.match(md, /Long Beach Boulevard/);
  assert.match(md, /no such town/); // discrepancy ledger rendered
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/canon-drift-persist.test.ts`
Expected: FAIL — `verifiedCanon` undefined on the manifest / `ENOENT verified-canon.md`.
(If `BookService`/`LibraryService` constructor args differ from the mirror, first read `tests/unit/book-seeds.test.ts` `setup()` and match it exactly — that is the authoritative pattern.)

- [ ] **Step 3: Implement**

In `book-types.ts`, add the `verifiedCanon?` field to `BookManifest` (shape above), after line 70.

In `book.ts` `BookSelection`, add:
```ts
  verifiedCanon?: {
    status: 'grounded' | 'fallback-llm' | 'skipped';
    citations: Array<{ title: string; url?: string }>;
    discrepancies: Array<{ id: string; premiseClaim: string; finding: string; status: 'pass' | 'fail'; suggestion?: string; targetField: 'setting' | 'blueprint' | 'characters' }>;
    dossier?: string; // written to data/verified-canon.md; NOT stored in the manifest
  };
```

In `create()`, after `await mkdir(join(dir, 'data'), { recursive: true });` (line 344), write the anchor doc:
```ts
      if (sel.verifiedCanon) {
        const vc = sel.verifiedCanon;
        const body = (vc.dossier && vc.dossier.trim())
          ? vc.dossier.trim()
          : (sel.seeds?.setting ?? '').trim(); // fall back to the composed setting seed
        const ledger = vc.discrepancies.length
          ? '\n\n## Verified Discrepancy Ledger\n\n' + vc.discrepancies.map(d =>
              `- **[${d.status}]** ${d.premiseClaim} → ${d.finding}${d.suggestion ? ` (suggest: ${d.suggestion})` : ''} _(field: ${d.targetField})_`).join('\n')
          : '';
        const cites = vc.citations.length
          ? '\n\n## Sources\n\n' + vc.citations.map(c => `- ${c.title}${c.url ? ` — ${c.url}` : ''}`).join('\n')
          : '';
        await writeFile(join(dir, 'data', 'verified-canon.md'), `# Verified Canon\n\n${body}${ledger}${cites}\n`, 'utf-8');
      }
```

In the manifest object (line ~394, next to the `seeds` spread), add — **stripping `dossier`** so only `{status, citations, discrepancies}` land in the manifest:
```ts
        ...(sel.verifiedCanon ? { verifiedCanon: { status: sel.verifiedCanon.status, citations: sel.verifiedCanon.citations, discrepancies: sel.verifiedCanon.discrepancies } } : {}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/canon-drift-persist.test.ts` → PASS (2 tests). `npx tsc --noEmit` → clean.
Regression: `node --import tsx --test tests/unit/book-seeds.test.ts tests/unit/book.test.ts` → still PASS.

- [ ] **Step 5: Checkpoint.**

---

### Task 7: Thread the anchor through the create route + stop dropping citations at intake

Server-side bridge for Risk R2: `/api/books/intake` returns `citations`; `POST /api/books` reads an optional `verifiedCanon` from the request body and passes it to `create()`.

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts` (intake response ~line 103; `/api/books` seeds/create block ~744-756)
- Test: extend `tests/unit/canon-drift-persist.test.ts` is not route-level; instead assert via the existing route test harness if one exists. There is no unit harness that boots this route in isolation, so the verifiable artifacts are `tsc` clean + a **shape assertion** on a small extracted helper.

**Interfaces:**
- Add a tiny pure validator `parseVerifiedCanonBody(body: any)` (exported from `books.routes.ts` or a colocated helper) that shape-checks the incoming grounding and returns a `BookSelection['verifiedCanon']` or `undefined`. This is the unit-testable seam (routes themselves aren't unit-tested here).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/canon-drift-persist.test.ts — APPEND
import { parseVerifiedCanonBody } from '../../gateway/src/api/routes/books.routes.js';

test('parseVerifiedCanonBody accepts a well-formed grounding payload', () => {
  const vc = parseVerifiedCanonBody({
    groundingStatus: 'grounded',
    citations: [{ title: 'x', url: 'https://y.test' }],
    discrepancies: [{ id: 'd1', premiseClaim: 'a', finding: 'b', status: 'fail', suggestion: 's', targetField: 'setting' }],
    settingDossier: '## Verified Real-World Geography\ntext',
  });
  assert.equal(vc?.status, 'grounded');
  assert.equal(vc?.discrepancies[0].targetField, 'setting');
  assert.equal(vc?.dossier, '## Verified Real-World Geography\ntext');
});

test('parseVerifiedCanonBody returns undefined for absent/garbage grounding (backward compatible)', () => {
  assert.equal(parseVerifiedCanonBody({}), undefined);
  assert.equal(parseVerifiedCanonBody({ groundingStatus: 'nope' }), undefined);
  assert.equal(parseVerifiedCanonBody(null), undefined);
});

test('parseVerifiedCanonBody drops a bad discrepancy targetField rather than throwing', () => {
  const vc = parseVerifiedCanonBody({ groundingStatus: 'skipped', discrepancies: [{ id: 'd', premiseClaim: 'a', finding: 'b', status: 'pass', targetField: 'bogus' }] });
  assert.equal(vc?.status, 'skipped');
  assert.equal(vc?.discrepancies[0].targetField, 'setting'); // coerced to default
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/canon-drift-persist.test.ts`
Expected: FAIL — `parseVerifiedCanonBody is not exported`.

- [ ] **Step 3: Implement**

Add the exported helper in `books.routes.ts` (top-level, near the other imports/helpers):
```ts
export function parseVerifiedCanonBody(body: any): {
  status: 'grounded' | 'fallback-llm' | 'skipped';
  citations: Array<{ title: string; url?: string }>;
  discrepancies: Array<{ id: string; premiseClaim: string; finding: string; status: 'pass' | 'fail'; suggestion?: string; targetField: 'setting' | 'blueprint' | 'characters' }>;
  dossier?: string;
} | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const status = body.groundingStatus;
  if (status !== 'grounded' && status !== 'fallback-llm' && status !== 'skipped') return undefined;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const citations = Array.isArray(body.citations)
    ? body.citations.filter((c: any) => c && typeof c === 'object' && s(c.title)).map((c: any) => ({ title: s(c.title), ...(s(c.url) ? { url: s(c.url) } : {}) }))
    : [];
  const discrepancies = Array.isArray(body.discrepancies)
    ? body.discrepancies.filter((d: any) => d && typeof d === 'object').map((d: any, i: number) => ({
        id: s(d.id) || `disc-${i + 1}`, premiseClaim: s(d.premiseClaim), finding: s(d.finding),
        status: d.status === 'fail' ? 'fail' as const : 'pass' as const,
        ...(s(d.suggestion) ? { suggestion: s(d.suggestion) } : {}),
        targetField: (['setting', 'blueprint', 'characters'].includes(d.targetField) ? d.targetField : 'setting') as 'setting' | 'blueprint' | 'characters',
      }))
    : [];
  return { status, citations, discrepancies, ...(s(body.settingDossier) ? { dossier: s(body.settingDossier) } : {}) };
}
```

In the `POST /api/books` handler, next to the `seeds` assembly (~line 752-756):
```ts
    const verifiedCanon = parseVerifiedCanonBody(body);
```
and add `...(verifiedCanon ? { verifiedCanon } : {})` to the `services.books.create({...})` argument object at line 756.

In `POST /api/books/intake` response (line 103), add `citations`:
```ts
      res.json({ seeds, gaps: intake.gaps, discrepancies: grounding.discrepancies, citations: grounding.citations, realPlace: intake.realPlace, groundingStatus: grounding.status });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/canon-drift-persist.test.ts` → PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Checkpoint.** Note in the PR/commit_message: *client intake→create flow must forward `groundingStatus`/`discrepancies`/`citations`/`settingDossier` into the create POST for the anchor to persist; until then gates no-op (fail-soft).*

---

### Task 8: Reorder the bible steps + insert Gate A/B (both pipelines)

Swap Character Bible ↔ Setting so setting generates first; fix the "in your context" cross-references; insert Gate A (canon-audit + canon-drift-apply) after Setting and Gate B after Character Bible. Apply to BOTH `romance-sweet-deterministic.json` and `romance-spicy-deterministic.json`.

**Files:**
- Modify: `library/pipelines/romance-sweet-deterministic.json`
- Modify: `library/pipelines/romance-spicy-deterministic.json`
- Test: `tests/unit/canon-drift-pipeline-order.test.ts`; confirm `tests/unit/library-pipeline-skill-refs.test.ts` still passes.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/canon-drift-pipeline-order.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

for (const file of ['romance-sweet-deterministic.json', 'romance-spicy-deterministic.json']) {
  test(`${file}: setting bible precedes character bible, with Gate A + Gate B inserted`, () => {
    const p = JSON.parse(readFileSync(join(ROOT, 'library', 'pipelines', file), 'utf8'));
    const labels: string[] = p.steps.map((s: any) => s.label);
    const iSetting = labels.indexOf('Setting');
    const iChar = labels.indexOf('Character Bible');
    const iOutline = labels.indexOf('Chapter Outline');
    assert.ok(iSetting >= 0 && iChar >= 0 && iOutline >= 0, 'all three canon steps present');
    assert.ok(iSetting < iChar, 'Setting generates BEFORE Character Bible');
    assert.ok(iChar < iOutline, 'Character Bible still before the outline');

    // Gate A: a canon-audit + canon-drift-apply pair after Setting, before Character Bible.
    const gateA = p.steps.slice(iSetting + 1, iChar);
    assert.ok(gateA.some((s: any) => s.skill === 'romance-canon-audit'), 'Gate A audit after Setting');
    assert.ok(gateA.some((s: any) => s.skill === 'canon-drift-apply'), 'Gate A apply after Setting');

    // Gate B: a canon-audit + canon-drift-apply pair after Character Bible, before the outline.
    const gateB = p.steps.slice(iChar + 1, iOutline);
    assert.ok(gateB.some((s: any) => s.skill === 'romance-canon-audit'), 'Gate B audit after Character Bible');
    assert.ok(gateB.some((s: any) => s.skill === 'canon-drift-apply'), 'Gate B apply after Character Bible');

    // The character bible template must now reference the SETTING (reorder correctness).
    const charStep = p.steps[iChar];
    assert.match(charStep.promptTemplate, /setting/i, 'character bible now uses the setting in context');
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/canon-drift-pipeline-order.test.ts`
Expected: FAIL — `Setting` currently AFTER `Character Bible`; no gate steps.

- [ ] **Step 3: Edit both pipeline JSONs**

In each file, replace the two bible steps (currently `steps[2]` Character Bible, `steps[3]` Setting) with, in order: **Setting → Gate A audit → Gate A apply → Character Bible → Gate B audit → Gate B apply**. Fix cross-references: Setting must NOT say "and character bible"; Character Bible must say "and setting guide".

```json
    {
      "label": "Setting",
      "skill": "book-bible",
      "taskType": "book_bible",
      "phase": "bible",
      "promptTemplate": "Write the SETTING guide for \"{{title}}\": the real-world place the romance is grounded in. Make the reader feel present — name the concrete locations, buildings, businesses and restaurants, streets and neighborhoods where scenes unfold, and the sensory texture (sights, sounds, smells, weather, the rhythm of the town) that brings them alive. Use the premise in your context and honor the author's setting notes and any verified real-world geography exactly. Follow your book-bible methodology. Output the setting guide only — no preamble or commentary.\n\nAuthor-provided setting notes — develop and preserve, filling gaps; if blank, originate from the premise.\nSetting notes:\n{{setting}}"
    },
    {
      "label": "Canon Audit — Setting",
      "skill": "romance-canon-audit",
      "taskType": "revision",
      "phase": "bible",
      "promptTemplate": "Audit the SETTING guide for \"{{title}}\" in your context against the verified real-world geography anchor in your context. Follow your canon-audit methodology and output ONLY the JSON edit list — each edit's \"find\" copied VERBATIM from the setting guide. Do NOT rewrite or reproduce the guide; output nothing but the JSON array.",
      "modelOverride": { "provider": "openrouter", "model": "auto:newest-haiku", "temperature": 0.2 }
    },
    {
      "label": "Canon Gate — Setting",
      "skill": "canon-drift-apply",
      "taskType": "general",
      "phase": "bible",
      "promptTemplate": "Deterministic apply: the Canon Audit edit list plus the free proper-noun/place entity gate are applied to the setting guide by code (literal find-and-replace). No model rewrites the guide."
    },
    {
      "label": "Character Bible",
      "skill": "book-bible",
      "taskType": "book_bible",
      "phase": "bible",
      "promptTemplate": "Write the CHARACTER BIBLE for \"{{title}}\": the protagonist, the love interest, and the full relationship arc (attraction -> tension -> midpoint shift -> black moment -> reconciliation), plus supporting cast. Use the premise AND the setting guide in your context — every place, town, road, and business a character references MUST come from the setting guide; never invent geography. Follow your book-bible methodology. Output the character bible only — no preamble or commentary.\n\nAuthor-provided characters — develop and preserve, filling gaps; if blank, originate from the premise.\nCharacters:\n{{characters}}"
    },
    {
      "label": "Canon Audit — Characters",
      "skill": "romance-canon-audit",
      "taskType": "revision",
      "phase": "bible",
      "promptTemplate": "Audit the CHARACTER BIBLE for \"{{title}}\" in your context against the anchors in your context (the setting guide and the verified real-world geography). Follow your canon-audit methodology and output ONLY the JSON edit list — each edit's \"find\" copied VERBATIM from the character bible. Do NOT rewrite or reproduce the bible; output nothing but the JSON array.",
      "modelOverride": { "provider": "openrouter", "model": "auto:newest-haiku", "temperature": 0.2 }
    },
    {
      "label": "Canon Gate — Characters",
      "skill": "canon-drift-apply",
      "taskType": "general",
      "phase": "bible",
      "promptTemplate": "Deterministic apply: the Canon Audit edit list plus the free proper-noun/place entity gate are applied to the character bible by code (literal find-and-replace). This is the gate that catches an invented town like \"Bay Haven.\" No model rewrites the bible."
    },
```

Leave the `Chapter Outline` step's template as-is (it already says "Use the premise, character bible and setting guide in your context" — both now exist upstream). Do NOT touch the `expand:"chapters"` block or any per-chapter step.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/canon-drift-pipeline-order.test.ts` → PASS (2 tests).
Run: `node --import tsx --test tests/unit/library-pipeline-skill-refs.test.ts` → PASS (the guard now sees `romance-canon-audit` installed from Task 3; **note** `canon-drift-apply` and `deterministic-apply` are handled by the runner, not the SkillLoader — confirm the guard already tolerates `deterministic-apply` today, which it does, so `canon-drift-apply` needs the same tolerance; if the guard has an explicit allowlist for engine-only skills, add `canon-drift-apply` to it).
Run: `node --import tsx --test tests/unit/romance-pipelines.test.ts` → PASS (adjust any hard-coded step-count/index assertions there to the new order if it enumerates steps — read it first and update surgically).
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 5: Checkpoint.**

---

### Task 9: Fixture regression — project-75 "Bay Haven" bible → Gate B clean

The end-to-end proof from the spec: a real character-bible excerpt containing "Bay Haven boardwalk" + a clean `seeds.setting` anchor (Surf City / Long Beach Boulevard) → the gate emits the Bay-Haven→Long-Beach-Boulevard swap and the applied bible is clean.

**Files:**
- Test: `tests/unit/canon-drift-fixture.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/canon-drift-fixture.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCanonDriftGate, type CanonGateStep } from '../../gateway/src/services/canon-drift.js';

// Clean seeds.setting anchor as verified against the live project-75 book:
// Surf City / Long Beach Boulevard on LBI; zero "Bay Haven".
const VERIFIED_CANON = `# Verified Canon

## Verified Real-World Geography
The novel is set in Surf City on Long Beach Island (LBI), New Jersey. The main
commercial artery is Long Beach Boulevard, which runs the length of the island.
Surf City faces the Atlantic to the east and Barnegat Bay to the west. The
economy is a compressed summer season.`;

// Real drift the character bible (generated BEFORE setting) introduced:
const DRIFTED_CHARACTER_BIBLE = `# Character Bible

## Mara Whitfield
Mara grew up walking the Bay Haven boardwalk every summer with her grandmother,
selling saltwater taffy from a cart. She still knows every plank of the Bay Haven
boardwalk by heart.

## Daniel Reyes
Daniel returned to town to reopen his father's shop on Long Beach Boulevard.`;

function fixtureSteps(): CanonGateStep[] {
  return [
    { label: 'Setting', skill: 'book-bible', status: 'completed', result: VERIFIED_CANON },
    { label: 'Character Bible', skill: 'book-bible', status: 'completed', result: DRIFTED_CHARACTER_BIBLE },
    { label: 'Canon Audit — Characters', skill: 'romance-canon-audit', status: 'completed', result: '[]' }, // LLM finds nothing extra
    { label: 'Canon Gate — Characters', skill: 'canon-drift-apply', status: 'running' },
  ];
}

test('Gate B removes the invented Bay Haven boardwalk, swapping to Long Beach Boulevard', async () => {
  const steps = fixtureSteps();
  const out = await runCanonDriftGate({
    steps, step: steps[3],
    loadAnchors: async () => [VERIFIED_CANON],
  });
  assert.ok(!out.text.includes('Bay Haven'), 'no invented town remains');
  assert.ok(out.text.includes('Long Beach Boulevard'), 'canonical road present');
  assert.equal(out.stats.swaps >= 2, true, 'both Bay Haven mentions swapped'); // 2 occurrences
  assert.equal(out.stats.noAnchor, false);
  // The rest of the bible is untouched (surgical apply).
  assert.ok(out.text.includes('Mara Whitfield') && out.text.includes('saltwater taffy'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/canon-drift-fixture.test.ts`
Expected: at this point the pipeline is fully built, so it should PASS immediately if Tasks 1-4 are correct. If it FAILS, that is the signal the entity gate's road-class classification or multi-occurrence swap is wrong — fix `entityGate`/`applyDeAiEdits` usage until green (do not weaken the assertions).

Note on the two-occurrence swap: `applyDeAiEdits` replaces the FIRST occurrence per edit. To swap BOTH "Bay Haven boardwalk" mentions, `entityGate` must emit the swap once per distinct occurrence OR the applier must replace-all. **Verify current `applyDeAiEdits` behavior** (`deterministic-apply.ts:129` uses `indexOf` — first match only, recomputed per edit). Since `entityGate` dedupes by phrase (emits ONE edit for "Bay Haven boardwalk"), only the first mention is swapped. **Resolution:** in Task 1, change `entityGate` to emit one swap edit per *occurrence* (drop the per-phrase `seen` dedupe for emitting, keep it only for the `classify`/target lookup) so a phrase appearing twice yields two identical edits, and the applier swaps both on successive passes. Update the Task 1 test's clean-doc expectations accordingly (they use single occurrences, so they stay valid). Re-run Task 1 + Task 9 after the change.

- [ ] **Step 3: (If needed) adjust `entityGate` occurrence handling**

```ts
// In entityGate, replace the single-emit loop body so a phrase that occurs N
// times yields N swap edits (applyDeAiEdits swaps one occurrence per edit):
  const counts = new Map<string, number>();
  for (const phrase of [...docPlaces.roads, ...docPlaces.towns]) counts.set(phrase, (counts.get(phrase) ?? 0) + occurrences(doc, phrase));
  // …emit one {op:'swap', find, replace} per counted occurrence for unknown place-phrases…
```
where `occurrences(text, sub)` counts non-overlapping matches. (Keep it minimal; only if Step 2 proves the single-emit path leaves a second "Bay Haven" behind.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/canon-drift-fixture.test.ts` → PASS.
Re-run the whole canon suite: `node --import tsx --test tests/unit/canon-drift-*.test.ts` → all PASS. `npx tsc --noEmit` → clean.

- [ ] **Step 5: Final verification (full gate)**

Run: `npm run test:unit` (builds frontend + runs every `tests/unit/*.test.ts`) → all PASS, including the untouched pipeline/book/deterministic-apply suites.
Run: `npm run test:smoke` → gateway boots, security perimeter asserted.

---

## Self-Review

- **Spec coverage:** §1 reorder → Task 8. §2 persist anchor (`verified-canon.md` + manifest block) → Tasks 6-7 (key renamed per R1). §3A deterministic entity gate → Task 1. §3B LLM `*-canon-audit` skill → Task 3, routed in Task 8. §3 merge/dedupe + ambiguous→ConfirmationGate → Tasks 2 (merge) + 4/5 (gate routing). §4 two gates → Task 8. §Components table → all covered. §Error handling fail-soft → Tasks 1/4 no-anchor + throw-tolerant tests. §Testing (entityGate flags/passes/ignores-business; merge/dedupe/ambiguous; fixture regression; pipeline-skill-resolves) → Tasks 1, 2, 9, 8. §Out of scope (retro-fix, outline/blueprint gates, worlds) → not planned. **No gaps.**
- **Deviations flagged:** manifest key `verifiedCanon` not `grounding` (R1); server-side bridge + client-forward dependency (R2); `modelOverride: auto:newest-haiku` instead of bare `consistency` task type (R3).
- **Type consistency:** `DeAiEdit`/`applyDeAiEdits`/`parseAuditEdits` imported unchanged from `deterministic-apply.ts`. `EntityConflict`, `PlaceSet`, `CanonDriftResult`, `CanonGateStep`, `CanonGateDeps`, `CanonGateOutput`, `runCanonDriftGate`, `entityGate`, `extractPlaces`, `canonDriftAudit`, `parseVerifiedCanonBody` names are used identically across Tasks 1-9. `verifiedCanon` shape matches between `BookManifest`, `BookSelection`, and `parseVerifiedCanonBody`.
- **Shared-file discipline:** `canon-drift.ts` is new (no edit to `deterministic-apply.ts`); the three dispatch-site edits are additive `else if` branches adjacent to the existing `deterministic-apply` branch; pipeline JSON edits confined to the bible steps.
