# Continuity Engine Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the shipped consistency auditor with Selective Exclusion (per-scene `canonical`), a Character Knowledge Matrix (`knowledge-violation` findings), and a red-herring inverse-warning in plot-promises.

**Architecture:** All changes ride the existing `extract → typed ledger → deterministic check → story clock` pipeline. The LLM does only extraction; every check is a deterministic, fixture-tested pure function. A new `knowledge` table sits beside `facts` in the same `consistency.db`. The red-herring change is a surgical, isolated edit to `plot-promises.ts`.

**Tech Stack:** Node 22+, TypeScript via `tsx` (NodeNext, `.js` import extensions), `better-sqlite3` (fail-soft optional), Node built-in test runner (`node --import tsx --test`).

## Global Constraints

- Node 22+; TypeScript run through `tsx`; **all relative imports use `.js` extensions** (NodeNext).
- `better-sqlite3` is optional — every DB path must **fail-soft** (`isAvailable()` guard, `⚠` log), never crash startup or the audit.
- Deterministic check path: **no LLM in any check function**. The LLM appears only in `extractor.ts`.
- `better-sqlite3` binding rejects JS booleans and `undefined` — store `canonical` as INTEGER `1`/`0`; never bind a raw boolean or `undefined`.
- Unit tests: `node --import tsx --test tests/unit/*.test.ts` (run a single file with `node --import tsx --test tests/unit/<file>.test.ts`). Tests skip gracefully when `!store.isAvailable()`.
- Backward compatibility: existing extractor stubs in `tests/unit/consistency-audit.test.ts` return `ExtractResult` **without** `canonical` on scenes/facts and **without** `knowledge`. New fields must default (scene/fact `canonical` → `true`; `knowledge` → `[]`) so those tests keep passing untouched.
- Workflow: `commit_message` + `./push.sh` (do not `git commit`/`git push` directly); work on `main`; professional Markdown, no emojis.

---

### Task 1: `facts.canonical` column + `priorFacts` filter

**Files:**
- Modify: `gateway/src/services/consistency/types.ts` (add `canonical` to `LedgerFact`; add `'knowledge-violation'` to `FindingCategory`)
- Modify: `gateway/src/services/consistency/fact-store.ts` (schema column, insert mapping, query filter, row mapping)
- Test: `tests/unit/consistency-fact-store.test.ts` (extend)

**Interfaces:**
- Produces: `LedgerFact.canonical: boolean`; `ConsistencyStore.priorFacts(...)` returns only `canonical === true` rows; `insertFacts` accepts `canonical` and stores `1`/`0`.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/consistency-fact-store.test.ts`:

```typescript
test('priorFacts excludes non-canonical rows', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-canon-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) return;
    s.insertFacts([
      fact({ chapter: 'ch1', storyTime: 0, valueNorm: 'blue', canonical: true }),
      fact({ chapter: 'ch2-dream', storyTime: 1, valueNorm: 'red', canonical: false }), // dream — must not be a prior
    ]);
    const priors = s.priorFacts({ world: null, bookSlug: 'b1' }, 'John', 'eye_color');
    assert.equal(priors.length, 1);
    assert.equal(priors[0].valueNorm, 'blue');
    assert.equal(priors[0].canonical, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

Also update the shared `fact()` helper in that file to include `canonical: true` in its defaults so existing tests still compile against the widened `LedgerFact`:

```typescript
    transition: null, chapter: 'ch1', scene: 0, source: 'manuscript', evidence: 'his blue eyes', canonical: true, ...p,
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/consistency-fact-store.test.ts`
Expected: FAIL — either a type error (`canonical` not on `LedgerFact`) or the new test asserting `priors.length === 1` fails (currently returns 2).

- [ ] **Step 3: Write minimal implementation**

In `types.ts`, add to the `LedgerFact` interface (after `evidence`):

```typescript
  evidence: string;
  /** False for dream/flashback/hypothetical scenes — stored but excluded from the check. */
  canonical: boolean;
```

And widen `FindingCategory`:

```typescript
export type FindingCategory = 'contradiction' | 'continuity' | 'impossibility' | 'canon-divergence' | 'knowledge-violation';
```

In `fact-store.ts` `initialize()`, add the column to the `CREATE TABLE facts` body (after `evidence TEXT NOT NULL`):

```sql
          source TEXT NOT NULL, evidence TEXT NOT NULL,
          canonical INTEGER NOT NULL DEFAULT 1
```

In `insertFacts`, add `canonical` to the column list and values, and convert the boolean in the transaction:

```typescript
    const stmt = this.db.prepare(`INSERT INTO facts
      (world, book_slug, entity, aliases, attribute, type, value_raw, value_norm, story_time, time_label, transition, chapter, scene, source, evidence, canonical)
      VALUES (@world,@bookSlug,@entity,@aliases,@attribute,@type,@valueRaw,@valueNorm,@storyTime,@timeLabel,@transition,@chapter,@scene,@source,@evidence,@canonical)`);
    const tx = this.db.transaction((rows: LedgerFact[]) => {
      for (const f of rows) stmt.run({ ...f, aliases: JSON.stringify(f.aliases), canonical: f.canonical ? 1 : 0 });
    });
```

In `priorFacts`, add the canonical filter to the WHERE clause and map the column back:

```typescript
    const rows = this.db.prepare(`SELECT * FROM facts
      WHERE entity = ? AND attribute = ? AND canonical = 1
        AND ( book_slug = ? OR (source = 'canon' AND world IS ? ) )
      ORDER BY story_time DESC, id DESC`).all(entity, attribute, scope.bookSlug, scope.world);
    return rows.map((r: any) => ({
      world: r.world, bookSlug: r.book_slug, entity: r.entity, aliases: JSON.parse(r.aliases),
      attribute: r.attribute, type: r.type, valueRaw: r.value_raw, valueNorm: r.value_norm,
      storyTime: r.story_time, timeLabel: r.time_label, transition: r.transition,
      chapter: r.chapter, scene: r.scene, source: r.source, evidence: r.evidence,
      canonical: r.canonical !== 0,
    }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/consistency-fact-store.test.ts`
Expected: PASS (all tests in the file, including the existing two).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/consistency/types.ts gateway/src/services/consistency/fact-store.ts tests/unit/consistency-fact-store.test.ts
git commit -m "feat(consistency): per-fact canonical column + priorFacts exclusion"
```

---

### Task 2: `knowledge` table + CRUD + idempotent rebuild

**Files:**
- Modify: `gateway/src/services/consistency/types.ts` (knowledge types)
- Modify: `gateway/src/services/consistency/fact-store.ts` (table, insert, query, per-book clear)
- Test: `tests/unit/consistency-fact-store.test.ts` (extend)

**Interfaces:**
- Produces:
  - `KnowledgeKind = 'acquire' | 'use'`
  - `KnowledgeSource = 'told' | 'witnessed' | 'deduced' | 'reference' | 'act_on'`
  - `KnowledgeEvent { world: string|null; bookSlug: string|null; knower: string; factKey: string; kind: KnowledgeKind; source: KnowledgeSource; storyTime: number; chapter: string; scene: number; canonical: boolean; evidence: string }`
  - `ConsistencyStore.insertKnowledge(events: KnowledgeEvent[]): void`
  - `ConsistencyStore.knowledgeForBook(scope: { world: string|null; bookSlug: string }): KnowledgeEvent[]`
  - `ConsistencyStore.clearBookKnowledge(bookSlug: string): void`

- [ ] **Step 1: Write the failing test** — append to `tests/unit/consistency-fact-store.test.ts`:

```typescript
import type { KnowledgeEvent } from '../../gateway/src/services/consistency/types.js';

function ke(p: Partial<KnowledgeEvent>): KnowledgeEvent {
  return {
    world: null, bookSlug: 'b1', knower: 'Elena', factKey: 'Marsh killer_identity guilty',
    kind: 'use', source: 'reference', storyTime: 3, chapter: 'ch4', scene: 0, canonical: true,
    evidence: 'Elena said Marsh did it', ...p,
  };
}

test('knowledge insert/query scoped by book; per-book clear', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-know-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) return;
    s.insertKnowledge([
      ke({ kind: 'acquire', storyTime: 1, chapter: 'ch2' }),
      ke({ kind: 'use', storyTime: 3, chapter: 'ch4' }),
      ke({ bookSlug: 'OTHER', chapter: 'x' }),
    ]);
    const rows = s.knowledgeForBook({ world: null, bookSlug: 'b1' });
    assert.equal(rows.length, 2);
    assert.ok(!rows.some(r => r.bookSlug === 'OTHER'));
    s.clearBookKnowledge('b1');
    assert.equal(s.knowledgeForBook({ world: null, bookSlug: 'b1' }).length, 0);
    assert.equal(s.knowledgeForBook({ world: null, bookSlug: 'OTHER' }).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/consistency-fact-store.test.ts`
Expected: FAIL — `insertKnowledge`/`knowledgeForBook`/`clearBookKnowledge` not defined.

- [ ] **Step 3: Write minimal implementation**

In `types.ts`, append:

```typescript
export type KnowledgeKind = 'acquire' | 'use';
export type KnowledgeSource = 'told' | 'witnessed' | 'deduced' | 'reference' | 'act_on';
export interface KnowledgeEvent {
  world: string | null; bookSlug: string | null;
  knower: string;
  /** entity\0attribute\0value_norm — references a consistency fact. */
  factKey: string;
  kind: KnowledgeKind; source: KnowledgeSource;
  storyTime: number; chapter: string; scene: number; canonical: boolean; evidence: string;
}
```

In `fact-store.ts`, import the type:

```typescript
import type { LedgerFact, KnowledgeEvent } from './types.js';
```

Add the table to the `db.exec(...)` schema block in `initialize()`:

```sql
        CREATE TABLE IF NOT EXISTS knowledge (
          id INTEGER PRIMARY KEY,
          world TEXT, book_slug TEXT,
          knower TEXT NOT NULL, fact_key TEXT NOT NULL,
          kind TEXT NOT NULL, source TEXT NOT NULL,
          story_time INTEGER NOT NULL, chapter TEXT NOT NULL, scene INTEGER NOT NULL,
          canonical INTEGER NOT NULL DEFAULT 1, evidence TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_lookup ON knowledge (world, book_slug, knower, fact_key);
```

Add the methods to the class:

```typescript
  insertKnowledge(events: KnowledgeEvent[]): void {
    if (!this.db || events.length === 0) return;
    const stmt = this.db.prepare(`INSERT INTO knowledge
      (world, book_slug, knower, fact_key, kind, source, story_time, chapter, scene, canonical, evidence)
      VALUES (@world,@bookSlug,@knower,@factKey,@kind,@source,@storyTime,@chapter,@scene,@canonical,@evidence)`);
    const tx = this.db.transaction((rows: KnowledgeEvent[]) => {
      for (const e of rows) stmt.run({ ...e, canonical: e.canonical ? 1 : 0 });
    });
    tx(events);
  }

  knowledgeForBook(scope: { world: string | null; bookSlug: string }): KnowledgeEvent[] {
    if (!this.db) return [];
    const rows = this.db.prepare('SELECT * FROM knowledge WHERE book_slug = ? ORDER BY story_time ASC, id ASC').all(scope.bookSlug);
    return rows.map((r: any) => ({
      world: r.world, bookSlug: r.book_slug, knower: r.knower, factKey: r.fact_key,
      kind: r.kind, source: r.source, storyTime: r.story_time, chapter: r.chapter,
      scene: r.scene, canonical: r.canonical !== 0, evidence: r.evidence,
    }));
  }

  clearBookKnowledge(bookSlug: string): void { if (this.db) this.db.prepare('DELETE FROM knowledge WHERE book_slug = ?').run(bookSlug); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/consistency-fact-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/consistency/types.ts gateway/src/services/consistency/fact-store.ts tests/unit/consistency-fact-store.test.ts
git commit -m "feat(consistency): knowledge table + scoped CRUD"
```

---

### Task 3: `evaluateKnowledge` deterministic check

**Files:**
- Modify: `gateway/src/services/consistency/check-engine.ts` (add pure function)
- Test: `tests/unit/consistency-check-engine.test.ts` (extend)

**Interfaces:**
- Consumes: `KnowledgeEvent` (Task 2), `ConsistencyFinding`/`FindingCategory` (Task 1).
- Produces: `evaluateKnowledge(events: KnowledgeEvent[]): ConsistencyFinding[]` — pure, no LLM. Emits one `knowledge-violation` finding per offending `use`.

Rules (per spec): group by `knower + factKey`. For each `use`, consider only **canonical** `acquire` events for the same `knower + factKey`. Let `firstAcquire = min(storyTime)`. Flag when there is no canonical acquire, or `use.storyTime < firstAcquire`. Severity: no acquire at all → `high`; otherwise `reference` → `high`, `act_on` → `medium`, else `low`.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/consistency-check-engine.test.ts`:

```typescript
import { evaluateKnowledge } from '../../gateway/src/services/consistency/check-engine.js';
import type { KnowledgeEvent } from '../../gateway/src/services/consistency/types.js';

const K = (p: Partial<KnowledgeEvent>): KnowledgeEvent => ({
  world: null, bookSlug: 'b1', knower: 'Elena', factKey: 'Marsh killer guilty',
  kind: 'use', source: 'reference', storyTime: 5, chapter: 'ch5', scene: 0, canonical: true,
  evidence: 'Elena named Marsh', ...p,
});

test('use before acquire -> knowledge-violation', () => {
  const acquire = K({ kind: 'acquire', source: 'told', storyTime: 9, chapter: 'ch9' });
  const use = K({ kind: 'use', source: 'reference', storyTime: 5, chapter: 'ch5' });
  const findings = evaluateKnowledge([acquire, use]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, 'knowledge-violation');
  assert.equal(findings[0].severity, 'high'); // reference
  assert.equal(findings[0].entity, 'Elena');
});

test('use after acquire -> no finding', () => {
  const acquire = K({ kind: 'acquire', storyTime: 2, chapter: 'ch2' });
  const use = K({ kind: 'use', storyTime: 5, chapter: 'ch5' });
  assert.deepEqual(evaluateKnowledge([acquire, use]), []);
});

test('no acquire anywhere -> high violation', () => {
  const use = K({ kind: 'use', source: 'act_on', storyTime: 5 });
  const findings = evaluateKnowledge([use]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'high'); // never learned
});

test('only a non-canonical (dream) acquire before use -> still flags', () => {
  const dream = K({ kind: 'acquire', source: 'witnessed', storyTime: 1, canonical: false });
  const use = K({ kind: 'use', source: 'act_on', storyTime: 5 });
  const findings = evaluateKnowledge([dream, use]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'high'); // dream doesn't count -> no real acquire
});

test('act_on before acquire -> medium', () => {
  const acquire = K({ kind: 'acquire', storyTime: 9 });
  const use = K({ kind: 'use', source: 'act_on', storyTime: 5 });
  assert.equal(evaluateKnowledge([acquire, use])[0].severity, 'medium');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/consistency-check-engine.test.ts`
Expected: FAIL — `evaluateKnowledge` not defined.

- [ ] **Step 3: Write minimal implementation** — append to `check-engine.ts`:

```typescript
import type { KnowledgeEvent } from './types.js';

/**
 * Deterministic knowledge-timeline check. For each `use` event, a character must
 * have a CANONICAL `acquire` of the same fact at an earlier-or-equal story_time.
 * Dream/flashback (non-canonical) acquisitions do not count as learning.
 */
export function evaluateKnowledge(events: KnowledgeEvent[]): ConsistencyFinding[] {
  const byKey = new Map<string, KnowledgeEvent[]>();
  for (const e of events) {
    const k = `${e.knower} ${e.factKey}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(e);
  }

  const findings: ConsistencyFinding[] = [];
  for (const group of byKey.values()) {
    const acquires = group.filter(e => e.kind === 'acquire' && e.canonical);
    const firstAcquire = acquires.length
      ? acquires.reduce((m, e) => (e.storyTime < m.storyTime ? e : m))
      : null;
    for (const use of group.filter(e => e.kind === 'use')) {
      const learned = firstAcquire !== null && firstAcquire.storyTime <= use.storyTime;
      if (learned) continue;
      const attribute = use.factKey.split(' ')[1] ?? use.factKey;
      const severity: ConsistencyFinding['severity'] =
        firstAcquire === null ? 'high' : use.source === 'reference' ? 'high' : use.source === 'act_on' ? 'medium' : 'low';
      const a: FindingRef = { chapter: use.chapter, scene: use.scene, quote: use.evidence };
      const b: FindingRef | CanonRef = firstAcquire
        ? { chapter: firstAcquire.chapter, scene: firstAcquire.scene, quote: firstAcquire.evidence }
        : { canonSource: 'never learned in-story', quote: '' };
      const where = firstAcquire ? `not until ${firstAcquire.chapter}` : 'at no point in the story';
      findings.push({
        category: 'knowledge-violation', severity, entity: use.knower, attribute, a, b,
        explanation: `${use.knower} acts on "${attribute}" in ${use.chapter} but learns it ${where}.`,
        suggestedFix: `Move ${use.knower}'s discovery of "${attribute}" before ${use.chapter}, or cut the reference.`,
      });
    }
  }
  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/consistency-check-engine.test.ts`
Expected: PASS (all, including the existing eight).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/consistency/check-engine.ts tests/unit/consistency-check-engine.test.ts
git commit -m "feat(consistency): evaluateKnowledge knowledge-violation rule"
```

---

### Task 4: Extractor parser — `sceneCanonical` + `knowledgeEvents`

**Files:**
- Modify: `gateway/src/services/consistency/extractor.ts` (`ExtractedScene`, `ExtractResult`, `parseExtractorResponse`, prompt text)
- Test: `tests/unit/consistency-extractor-parse.test.ts` (extend)

**Interfaces:**
- Consumes: `KnowledgeKind`/`KnowledgeSource`/`KnowledgeEvent` (Task 2), `LedgerFact.canonical` (Task 1).
- Produces:
  - `ExtractedScene` gains `canonical: boolean` (default `true`).
  - `ExtractResult` gains `knowledge: ExtractedKnowledge[]` where `ExtractedKnowledge = { knower: string; factKey: string; kind: KnowledgeKind; source: KnowledgeSource; storyTime: number; scene: number; canonical: boolean; evidence: string }`.
  - Each parsed fact gets `canonical = scene.canonical` (auto-detected; author override applied later in audit).

- [ ] **Step 1: Write the failing test** — append to `tests/unit/consistency-extractor-parse.test.ts`:

```typescript
const SAMPLE_V2 = JSON.stringify({
  scenes: [{ timeLabel: 'that evening', canonical: true }, { timeLabel: 'in the dream', canonical: false }],
  facts: [
    { entity: 'John', aliases: ['John'], attribute: 'eye_color', type: 'immutable', valueRaw: 'blue', valueNorm: 'blue', scene: 0, transition: null, evidence: 'blue eyes' },
    { entity: 'John', aliases: ['John'], attribute: 'can_fly', type: 'stateful', valueRaw: 'flying', valueNorm: 'flying', scene: 1, transition: null, evidence: 'he soared' },
  ],
  knowledgeEvents: [
    { knower: 'Elena', factEntity: 'Marsh', factAttribute: 'killer', factValueNorm: 'guilty', kind: 'use', source: 'reference', scene: 0, evidence: 'Elena named Marsh' },
    { knower: '', factEntity: 'X', factAttribute: 'y', factValueNorm: 'z', kind: 'use', source: 'reference', scene: 0, evidence: 'dropme' }, // empty knower -> dropped
  ],
});

test('parses sceneCanonical onto scenes and facts (default true)', () => {
  const r = parseExtractorResponse(SAMPLE_V2, 0);
  assert.equal(r.scenes[0].canonical, true);
  assert.equal(r.scenes[1].canonical, false);
  assert.equal(r.facts[0].canonical, true);   // scene 0
  assert.equal(r.facts[1].canonical, false);  // scene 1 (dream)
});

test('parses knowledgeEvents; composes factKey; drops malformed', () => {
  const r = parseExtractorResponse(SAMPLE_V2, 100);
  assert.equal(r.knowledge.length, 1);
  assert.equal(r.knowledge[0].knower, 'Elena');
  assert.equal(r.knowledge[0].factKey, 'Marsh killer guilty');
  assert.equal(r.knowledge[0].storyTime, 100); // base + scene 0
});

test('v1 response (no canonical / no knowledge) defaults cleanly', () => {
  const r = parseExtractorResponse(SAMPLE, 0); // SAMPLE = the existing v1 fixture
  assert.equal(r.facts[0].canonical, true);
  assert.deepEqual(r.knowledge, []);
  assert.equal(r.scenes[0].canonical, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/consistency-extractor-parse.test.ts`
Expected: FAIL — `canonical`/`knowledge` undefined on the parse result.

- [ ] **Step 3: Write minimal implementation** — in `extractor.ts`:

Add the import and types near the top:

```typescript
import type { LedgerFact, FactType, FactSource, KnowledgeKind, KnowledgeSource } from './types.js';

export interface ExtractedScene {
  storyTime: number;
  timeLabel: string | null;
  canonical: boolean;
}

export interface ExtractedKnowledge {
  knower: string; factKey: string;
  kind: KnowledgeKind; source: KnowledgeSource;
  storyTime: number; scene: number; canonical: boolean; evidence: string;
}

export interface ExtractResult {
  facts: Omit<LedgerFact, 'world' | 'bookSlug' | 'chapter'>[];
  scenes: ExtractedScene[];
  knowledge: ExtractedKnowledge[];
}
```

In `parseExtractorResponse`, widen the parsed shape and build the new fields. Replace the `parsed` type annotation's `scenes`/add `knowledgeEvents`, then:

```typescript
  const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  const scenes: ExtractedScene[] = rawScenes.map((s: any, i: number) => ({
    storyTime: chapterStoryBase + i,
    timeLabel: s.timeLabel ?? null,
    canonical: s.canonical === false ? false : true,
  }));
```

Set `canonical` on each fact from its scene (inside the `rawFacts.map`, after `scene` is computed, include in the returned object):

```typescript
    const scene = f.scene ?? 0;
    const source: FactSource = f.source === 'canon' ? 'canon' : 'manuscript';
    return {
      entity, aliases, attribute: f.attribute ?? '', type, valueRaw, valueNorm,
      storyTime: chapterStoryBase + scene,
      timeLabel: rawScenes[scene]?.timeLabel ?? null,
      transition: f.transition ?? null, scene, source, evidence: f.evidence ?? '',
      canonical: rawScenes[scene]?.canonical === false ? false : true,
    };
```

Build the knowledge array (after `facts`):

```typescript
  const rawKnow = Array.isArray((parsed as any).knowledgeEvents) ? (parsed as any).knowledgeEvents : [];
  const knowledge: ExtractedKnowledge[] = rawKnow.map((k: any) => {
    const knower = String(k.knower ?? '').trim();
    const factEntity = String(k.factEntity ?? '').trim();
    const factAttribute = String(k.factAttribute ?? '').trim();
    const factValueNorm = String(k.factValueNorm ?? '').trim().toLowerCase();
    const scene = typeof k.scene === 'number' ? k.scene : 0;
    const kind: KnowledgeKind = k.kind === 'acquire' ? 'acquire' : 'use';
    const allowedSources: KnowledgeSource[] = ['told', 'witnessed', 'deduced', 'reference', 'act_on'];
    const source: KnowledgeSource = allowedSources.includes(k.source) ? k.source : (kind === 'acquire' ? 'told' : 'reference');
    return {
      knower,
      factKey: `${factEntity} ${factAttribute} ${factValueNorm}`,
      kind, source,
      storyTime: chapterStoryBase + scene,
      scene,
      canonical: rawScenes[scene]?.canonical === false ? false : true,
      evidence: String(k.evidence ?? ''),
    };
  }).filter((e: ExtractedKnowledge) => e.knower !== '' && e.factKey !== '  ');

  return { facts, scenes, knowledge };
```

Update the `SYSTEM_PROMPT` so the model emits the new fields. Add `"canonical": boolean` to the `scenes` shape and a `knowledgeEvents` array to the JSON template, plus these definition lines:

```
scenes[].canonical
  false when the scene is a dream, vision, hallucination, flashback/analepsis, or a hypothetical/counterfactual ("if he had…", "she imagined…"). true for normal narrative present. Default true if unsure.

knowledgeEvents
  Who knows what, and when. Emit an entry when a character LEARNS a fact (kind "acquire": is told, witnesses, overhears, deduces) or EXPLICITLY USES it (kind "use": states it outright, or acts on it). Only emit "use" for explicit reference or action — never for a guess or for narration the character is not party to.
  knower         canonical character name who knows/uses the fact.
  factEntity, factAttribute, factValueNorm   identify the fact (same normalization as facts above).
  kind           "acquire" | "use".
  source         "told" | "witnessed" | "deduced" (for acquire) | "reference" | "act_on" (for use).
  scene          0-based index into "scenes".
  evidence       short verbatim quote (under 80 chars).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/consistency-extractor-parse.test.ts`
Expected: PASS (including the existing two v1 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/consistency/extractor.ts tests/unit/consistency-extractor-parse.test.ts
git commit -m "feat(consistency): extractor emits sceneCanonical + knowledgeEvents"
```

---

### Task 5: Audit orchestration — canonical resolution, override sidecar, knowledge pass, report metadata

**Files:**
- Modify: `gateway/src/services/consistency/audit.ts`
- Test: `tests/unit/consistency-audit.test.ts` (extend)

**Interfaces:**
- Consumes: `priorFacts` canonical filter (Task 1); `insertKnowledge`/`knowledgeForBook`/`clearBookKnowledge` (Task 2); `evaluateKnowledge` (Task 3); `ExtractResult.{scenes[].canonical, knowledge}` (Task 4).
- Produces: `AuditReport` gains `knowledgeEventCount: number` and `nonCanonicalSceneCount: number`. New helper `loadNonCanonicalOverride(dataDir: string): Record<string, boolean>` exported for unit testing.

Behavior added to `runConsistencyAudit`:
1. Read `data/.non-canonical.json` once (fail-soft) → `override: Record<chapterStem, boolean>`.
2. Clear the book's knowledge rows alongside facts (`store.clearBookKnowledge(slug)`).
3. Per chapter: compute each scene's effective canonical = `override[chapterStem] ?? scene.canonical`; default missing `canonical` to `true`; default missing `knowledge` to `[]`. Apply the effective canonical to each fact (by its scene) and each knowledge event.
4. **Skip `evaluateFact` for non-canonical facts** (still insert them). Update `entityCurrentState`/`entityAliases` only from **canonical** facts.
5. Collect all chapters' knowledge events (with `world`/`bookSlug`/`chapter` filled and effective canonical applied), insert them, then after the loop run `evaluateKnowledge(allKnowledge)` and append findings.
6. Count `nonCanonicalSceneCount` and `knowledgeEventCount` into the report.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/consistency-audit.test.ts`:

```typescript
test('Selective Exclusion: a dream scene impossibility is NOT flagged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-excl-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) return;
    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'chapter-1.md'), 'John has blue eyes.');
    writeFileSync(join(dataDir, 'chapter-2.md'), 'In the dream John had red eyes.');

    // ch1: canonical blue immutable. ch2: dream scene (canonical:false) asserts red.
    const extract = async (text: string, _k: any[], base: number) => {
      const isDream = text.includes('dream');
      return {
        scenes: [{ storyTime: base, timeLabel: isDream ? 'in the dream' : null, canonical: !isDream }],
        knowledge: [],
        facts: [{ entity: 'John', aliases: ['John'], attribute: 'eye_color', type: 'immutable' as const,
          valueRaw: isDream ? 'red' : 'blue', valueNorm: isDream ? 'red' : 'blue',
          storyTime: base, timeLabel: null, transition: null, scene: 0, source: 'manuscript' as const,
          evidence: text, canonical: !isDream }],
      };
    };
    const books = { dataDirOf: () => dataDir, worldDocsOf: () => null, worldbuildingOf: () => null, open: async () => ({ manifest: { pulledFrom: {} } }) };
    const report = await runConsistencyAudit('b1', { store, books, extract });
    assert.equal(report.findings.find(f => f.attribute === 'eye_color'), undefined, 'dream eye-color must NOT contradict');
    assert.equal(report.nonCanonicalSceneCount, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Knowledge Matrix: use-before-acquire reported via audit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-know-audit-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) return;
    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'chapter-1.md'), 'Elena names the killer.');
    writeFileSync(join(dataDir, 'chapter-2.md'), 'Elena is told the killer.');

    const extract = async (text: string, _k: any[], base: number) => {
      const isUse = text.includes('names');
      return {
        scenes: [{ storyTime: base, timeLabel: null, canonical: true }],
        facts: [],
        knowledge: [{
          knower: 'Elena', factKey: 'Marsh killer guilty',
          kind: isUse ? 'use' as const : 'acquire' as const,
          source: isUse ? 'reference' as const : 'told' as const,
          storyTime: base, scene: 0, canonical: true, evidence: text,
        }],
      };
    };
    const books = { dataDirOf: () => dataDir, worldDocsOf: () => null, worldbuildingOf: () => null, open: async () => ({ manifest: { pulledFrom: {} } }) };
    const report = await runConsistencyAudit('b1', { store, books, extract });
    const kv = report.findings.find(f => f.category === 'knowledge-violation');
    assert.ok(kv, 'knowledge-violation expected (use in ch1 precedes acquire in ch2)');
    assert.equal(report.knowledgeEventCount, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('loadNonCanonicalOverride reads sidecar; fail-soft on missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-ov-'));
  try {
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    assert.deepEqual(loadNonCanonicalOverride(dataDir), {});
    writeFileSync(join(dataDir, '.non-canonical.json'), JSON.stringify({ 'chapter-2': false }));
    assert.deepEqual(loadNonCanonicalOverride(dataDir), { 'chapter-2': false });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

Add `loadNonCanonicalOverride` to the import line at the top of the test:

```typescript
import { selectChapterFiles, inferGap, loadNonCanonicalOverride } from '../../gateway/src/services/consistency/audit.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/consistency-audit.test.ts`
Expected: FAIL — `loadNonCanonicalOverride` not exported; `nonCanonicalSceneCount`/`knowledgeEventCount` undefined; dream fact currently flags.

- [ ] **Step 3: Write minimal implementation** — in `audit.ts`:

Extend imports and the report interface:

```typescript
import { evaluateFact, evaluateKnowledge, type Gap } from './check-engine.js';
import type { ConsistencyFinding, LedgerFact, KnowledgeEvent } from './types.js';
```

```typescript
export interface AuditReport {
  findings: ConsistencyFinding[];
  chaptersScanned: number;
  factCount: number;
  knowledgeEventCount: number;
  nonCanonicalSceneCount: number;
  generatedAt: string;
}
```

Add the exported helper (near `inferGap`):

```typescript
/** Read data/.non-canonical.json (chapterStem -> canonical boolean). Fail-soft -> {}. */
export function loadNonCanonicalOverride(dataDir: string): Record<string, boolean> {
  try {
    const p = join(dataDir, '.non-canonical.json');
    if (!existsSync(p)) return {};
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') out[k] = v;
    return out;
  } catch { return {}; }
}
```

Update the early-return `AuditReport` literals (there are three: missing dataDir, readdir failure, and the final report) to include the two new counters initialised to `0`. For the two early returns:

```typescript
    return { findings: [], chaptersScanned: 0, factCount: 0, knowledgeEventCount: 0, nonCanonicalSceneCount: 0, generatedAt: new Date().toISOString() };
```

After `store.clearBookFacts(slug);` add:

```typescript
  store.clearBookKnowledge(slug);
  const override = loadNonCanonicalOverride(dataDir);
  const allKnowledge: KnowledgeEvent[] = [];
  let nonCanonicalSceneCount = 0;
  let knowledgeEventCount = 0;
```

In the per-chapter loop, after `const chapterName = filename.replace(/\.md$/, '');` the override key is `chapterName` (the file stem). After computing `extractResult`, fold in the effective canonical and count non-canonical scenes:

```typescript
    // Effective per-scene canonical: author override (by chapter stem) wins over auto-detect.
    const chapterOverride = override[chapterName];
    const sceneCanonical = (extractResult.scenes ?? []).map(s =>
      chapterOverride !== undefined ? chapterOverride : (s.canonical !== false));
    nonCanonicalSceneCount += sceneCanonical.filter(c => !c).length;
```

Replace the fact-building block so each fact's `canonical` is the effective scene value, non-canonical facts are inserted but **not** evaluated, and the in-memory digest updates only from canonical facts:

```typescript
    for (const f of extractResult.facts) {
      const isCanonical = chapterOverride !== undefined ? chapterOverride : (f.canonical !== false);
      const full: LedgerFact = { ...f, world: worldName, bookSlug: slug, chapter: chapterName, canonical: isCanonical };
      if (isCanonical) {
        const ledgerPriors = store.priorFacts(scope, full.entity, full.attribute);
        const intraChapterPriors = chapterFacts.filter(
          c => c.entity === full.entity && c.attribute === full.attribute && c.type === 'immutable' && c.canonical,
        );
        const priors = [...intraChapterPriors, ...ledgerPriors];
        const finding = evaluateFact(full, priors, gap);
        if (finding) findings.push(finding);
        if (!entityAliases.has(full.entity)) entityAliases.set(full.entity, new Set());
        for (const alias of full.aliases) entityAliases.get(full.entity)!.add(alias);
        if (full.type === 'stateful') entityCurrentState.set(`${full.entity} ${full.attribute}`, full.valueNorm);
      }
      chapterFacts.push(full);
    }
```

After the fact loop in the chapter (before persisting facts), collect knowledge events for the chapter:

```typescript
    for (const k of (extractResult.knowledge ?? [])) {
      const isCanonical = chapterOverride !== undefined ? chapterOverride : (k.canonical !== false);
      allKnowledge.push({
        ...k, world: worldName, bookSlug: slug, chapter: chapterName, canonical: isCanonical,
      });
    }
    knowledgeEventCount += (extractResult.knowledge ?? []).length;
```

After the chapter loop, run the knowledge pass and persist:

```typescript
  if (allKnowledge.length > 0) {
    try { store.insertKnowledge(allKnowledge); } catch (err) { progress(`Warning: failed to persist knowledge: ${(err as Error)?.message ?? err}`); }
    for (const kf of evaluateKnowledge(allKnowledge)) findings.push(kf);
  }
```

Update the final report literal:

```typescript
  const report: AuditReport = {
    findings, chaptersScanned, factCount,
    knowledgeEventCount, nonCanonicalSceneCount,
    generatedAt: new Date().toISOString(),
  };
```

Note: the `intraChapterPriors` filter now references `c.canonical` — that is set on every `full` pushed to `chapterFacts`, so the type is satisfied.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/consistency-audit.test.ts`
Expected: PASS (including the existing four audit tests — the v1 stubs default `canonical`/`knowledge`).

- [ ] **Step 5: Run the whole consistency unit suite**

Run: `node --import tsx --test tests/unit/consistency-*.test.ts`
Expected: PASS across fact-store, check-engine, extractor-parse, audit.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/services/consistency/audit.ts tests/unit/consistency-audit.test.ts
git commit -m "feat(consistency): selective exclusion + knowledge pass in audit"
```

---

### Task 6: Red-herring inverse-warning in plot-promises

**Files:**
- Modify: `gateway/src/services/plot-promises.ts` (`PlotPromise`, `PromiseAuditReport`, `detectPayoffsInChapter`, `audit`)
- Test: `tests/unit/plot-promises-redherring.test.ts` (create)

**Interfaces:**
- Produces: `PlotPromise.redHerringResolvedAtChapter?: number`; `PromiseAuditReport.redHerringWarnings: { id: string; title: string; chapter: number }[]`.
- Behavior: in `detectPayoffsInChapter`, a `paid_off`/`partial_payoff` detection for a `category === 'red_herring'` promise does **not** set status to `paid_off`; it sets `redHerringResolvedAtChapter`, records the chapter in `touchedAtChapters`, and returns the promise in `updated`. `audit` surfaces all such promises in `redHerringWarnings`.

- [ ] **Step 1: Write the failing test** — create `tests/unit/plot-promises-redherring.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlotPromisesService } from '../../gateway/src/services/plot-promises.js';

const aiSelectProvider = () => ({ id: 'stub' });
const paidOffComplete = async () => ({ text: JSON.stringify({ status: 'paid_off', confidence: 0.9, evidence: 'resolved' }) });

test('red herring "paid off" yields a warning, not a payoff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pp-rh-'));
  try {
    const svc = new PlotPromisesService(join(root, 'workspace'));
    await svc.addPromise('proj1', {
      title: 'The butler did it', description: 'misdirection toward the butler',
      category: 'red_herring', introducedAtChapter: 1, status: 'open',
    } as any);

    const updated = await svc.detectPayoffsInChapter({
      projectId: 'proj1', chapterNumber: 5, chapterText: 'The butler is cleared.',
      aiComplete: paidOffComplete, aiSelectProvider,
    });
    assert.equal(updated.length, 1);
    assert.notEqual(updated[0].status, 'paid_off', 'red herring must NOT auto-close as paid_off');
    assert.equal(updated[0].redHerringResolvedAtChapter, 5);

    const report = await svc.audit('proj1', 100);
    assert.equal(report.redHerringWarnings.length, 1);
    assert.equal(report.redHerringWarnings[0].chapter, 5);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('non-red-herring "paid off" still closes (regression)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pp-norm-'));
  try {
    const svc = new PlotPromisesService(join(root, 'workspace'));
    await svc.addPromise('proj1', {
      title: 'Find the heir', description: 'mystery of the heir',
      category: 'mystery', introducedAtChapter: 1, status: 'open',
    } as any);
    const updated = await svc.detectPayoffsInChapter({
      projectId: 'proj1', chapterNumber: 5, chapterText: 'The heir is revealed.',
      aiComplete: paidOffComplete, aiSelectProvider,
    });
    assert.equal(updated[0].status, 'paid_off');
    const report = await svc.audit('proj1', 100);
    assert.equal(report.redHerringWarnings.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/plot-promises-redherring.test.ts`
Expected: FAIL — `redHerringResolvedAtChapter`/`redHerringWarnings` not defined; red herring currently closes as `paid_off`.

- [ ] **Step 3: Write minimal implementation** — in `plot-promises.ts`:

Add the field to `PlotPromise` (after `closedAtTimestamp` or near the status fields):

```typescript
  /** Set when the payoff detector thinks an intentional red herring is being resolved. */
  redHerringResolvedAtChapter?: number;
```

Add to `PromiseAuditReport` (alongside `atRiskPromises`):

```typescript
  redHerringWarnings: { id: string; title: string; chapter: number }[];
```

In `detectPayoffsInChapter`, replace the `paid_off`/`partial_payoff` branches so a red herring diverts to the warning path:

```typescript
        if ((status === 'paid_off' && confidence > 0.6) ||
            (status === 'partial_payoff' && confidence > 0.5 && promise.status === 'open')) {
          if (promise.category === 'red_herring') {
            promise.redHerringResolvedAtChapter = input.chapterNumber;
            if (!promise.touchedAtChapters.includes(input.chapterNumber)) promise.touchedAtChapters.push(input.chapterNumber);
            updated.push(promise);
          } else if (status === 'paid_off') {
            promise.status = 'paid_off';
            promise.closedAtChapter = input.chapterNumber;
            promise.closedAtTimestamp = new Date().toISOString();
            promise.touchedAtChapters.push(input.chapterNumber);
            updated.push(promise);
          } else {
            promise.status = 'partial_payoff';
            promise.touchedAtChapters.push(input.chapterNumber);
            updated.push(promise);
          }
        } else if (status === 'touched' && confidence > 0.5) {
          if (!promise.touchedAtChapters.includes(input.chapterNumber)) {
            promise.touchedAtChapters.push(input.chapterNumber);
          }
        }
```

In `audit`, build the warnings list and include it in the returned report:

```typescript
    const redHerringWarnings = project.promises
      .filter(p => typeof p.redHerringResolvedAtChapter === 'number')
      .map(p => ({ id: p.id, title: p.title, chapter: p.redHerringResolvedAtChapter! }));
```

Add `redHerringWarnings,` to the returned object literal.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/plot-promises-redherring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/plot-promises.ts tests/unit/plot-promises-redherring.test.ts
git commit -m "feat(plot-promises): warn when an intentional red herring looks paid off"
```

---

### Task 7: Type-check + smoke test extension

**Files:**
- Modify: `tests/consistency-smoke.sh` (add a dream-exclusion chapter + a knowledge-violation chapter and their assertions)

**Interfaces:** none (end-to-end shell).

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors. Fix any type fallout from the widened `LedgerFact`/`ExtractResult`/`AuditReport`/`PromiseAuditReport` (e.g. any other constructor of these types).

- [ ] **Step 2: Add a dream chapter + a knowledge chapter to the smoke**

In `tests/consistency-smoke.sh`, after the existing `chapter-2.md` heredoc (around line 144), add two more chapters:

```bash
# chapter-3.md: a DREAM scene asserting an impossibility (purple eyes) — must NOT be flagged
# because the scene is explicitly a dream (Selective Exclusion).
cat > "${DATA_DIR}/chapter-3.md" <<'MD'
# Chapter 3

That night John dreamed. In the dream, his eyes burned a brilliant purple and he soared above
the rooftops, weightless. He woke with a start, the vision already fading.
MD

# chapter-4.md establishes Elena LEARNS the killer's identity; chapter-5.md has her
# reference it EARLIER would be the violation. We plant the use BEFORE the acquire:
# chapter-4 (earlier) has Elena state the secret; chapter-5 (later) she is told it.
cat > "${DATA_DIR}/chapter-4.md" <<'MD'
# Chapter 4

Elena turned to the inspector. "Marsh is the killer," she said flatly. "He has been all along."
The inspector frowned; no one had told her that yet.
MD

cat > "${DATA_DIR}/chapter-5.md" <<'MD'
# Chapter 5

It was in Chapter 5 that the inspector finally told Elena the truth: Marsh was the killer.
She received the news as though hearing it for the very first time.
MD
```

- [ ] **Step 3: Add assertions after the existing clothing assertion (section 5)**

In the `if [ -n "${REPORT_JSON}" ]; then` block, after the clothing check, add:

```bash
  # 5c. Selective Exclusion: the dream's impossible eye-color (purple) must NOT be flagged.
  DREAM_FINDING="$(printf '%s' "${REPORT_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
const findings = (d.report && d.report.findings) ? d.report.findings : [];
const hit = findings.find(f => /purple/i.test(JSON.stringify(f)));
process.stdout.write(hit ? JSON.stringify(hit) : '');
" 2>/dev/null || true)"
  [ -z "${DREAM_FINDING}" ] \
    && pass "dream-scene impossibility not flagged (Selective Exclusion works)" \
    || { fail "dream-scene detail was flagged (exclusion failed): ${DREAM_FINDING}"; }

  # 5d. Knowledge Matrix: Elena referencing the killer (ch4) before being told (ch5)
  #     must produce a knowledge-violation finding.
  KNOW_FINDING="$(printf '%s' "${REPORT_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
const findings = (d.report && d.report.findings) ? d.report.findings : [];
const hit = findings.find(f => f.category === 'knowledge-violation');
process.stdout.write(hit ? JSON.stringify(hit) : '');
" 2>/dev/null || true)"
  [ -n "${KNOW_FINDING}" ] \
    && pass "knowledge-violation reported (use precedes acquire)" \
    || { fail "no knowledge-violation finding (Knowledge Matrix): findings=$(printf '%s' "${REPORT_JSON}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(JSON.stringify((d.report||{}).findings||[]))" 2>/dev/null)"; }
```

Update the header comment block of the script to mention the two new assertions.

- [ ] **Step 4: Run the smoke locally (best-effort)**

Run: `tests/consistency-smoke.sh -v`
Expected: PASS, or a clean `SKIP` if `better-sqlite3` is unavailable on this box. Real-LLM behavior may need a provider key; the authoritative smoke run happens on Mercury (deploy step).

- [ ] **Step 5: Commit**

```bash
git add tests/consistency-smoke.sh
git commit -m "test(consistency): smoke covers selective exclusion + knowledge matrix"
```

---

## Self-Review

**Spec coverage:**
- A Selective Exclusion data model → Task 1 (column) + Task 4 (scene/fact canonical) + Task 5 (override + skip-as-subject). ✓
- A author override sidecar (chapter-stem keyed, wins) → Task 5 `loadNonCanonicalOverride` + effective-canonical logic. ✓
- A excluded as prior → Task 1 `priorFacts` filter. ✓
- B knowledge table → Task 2. ✓
- B fact-key reuse → Task 4 `factKey` composition. ✓
- B explicit-use + severity tiers → Task 3 `evaluateKnowledge`. ✓
- B independent / new category → Task 1 `FindingCategory` + Task 3. ✓
- B single-pass extraction → Task 4 (same extractor). ✓
- B ordering (after canonical) → Task 5 (knowledge pass after loop; canonical applied). ✓
- C inverse warning, projectId-keyed → Task 6. ✓
- Report metadata (`knowledgeEventCount`, `nonCanonicalSceneCount`) → Task 5. ✓
- Tests (check-engine, fact-store, parser, plot-promises, smoke) → Tasks 1-7. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `canonical: boolean` on `LedgerFact` (Task 1) used in fact-store, extractor, audit; `KnowledgeEvent` fields identical across Tasks 2/3/4/5; `evaluateKnowledge` signature `(KnowledgeEvent[]) => ConsistencyFinding[]` consistent (Tasks 3, 5); `redHerringResolvedAtChapter`/`redHerringWarnings` consistent (Task 6); SQLite `canonical` stored as `1`/`0` everywhere it is bound (Tasks 1, 2). ✓
