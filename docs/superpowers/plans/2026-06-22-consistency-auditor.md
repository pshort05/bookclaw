# Post-Writing Consistency Auditor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a post-writing consistency auditor that turns a book's chapters into a per-book SQLite fact ledger (LLM extraction), then deterministically finds cross-chapter inconsistencies and canon divergences and reports them for manual review.

**Architecture:** A reusable fact-ledger core — `fact-store.ts` (scoped SQLite CRUD, fail-soft) + `check-engine.ts` (pure deterministic rules) — with no LLM and no IO in the check path. On top: `extractor.ts` (one LLM pass per chapter → typed/normalized facts) and `audit.ts` (canon seeding + per-chapter orchestration), exposed via async routes mirroring the existing continuity-check, and a read-only studio report panel.

**Tech Stack:** Node 22+ / TypeScript via `tsx`; `better-sqlite3` (already a dependency, lazy-loaded fail-soft like `memory-search.ts`); Express + Socket.IO; React/Vite studio; tests via `node --import tsx --test` + a bash smoke.

**Spec:** `docs/superpowers/specs/2026-06-22-consistency-auditor-design.md`.

## Global Constraints

- **Node 22+**; TypeScript via `tsx`. Type-check with `npx tsc --noEmit`.
- **`.js` import extensions** from `.ts` source (NodeNext). Match in every new file.
- **No new runtime dependency** — `better-sqlite3` already exists; lazy-load it `await import('better-sqlite3')` and degrade fail-soft (mirror `memory-search.ts`: an `available` flag + `unavailableReason`, log `⚠`, never crash boot).
- **DB location:** the consistency DB lives at `BOOKCLAW_DB_DIR` when set (its own file `consistency.db`, separate from `memory-search.db`), else under `workspace/memory/`. Resolve the dir exactly as `phase-03-soul-memory.ts` does for memory-search and pass it in.
- **The check path is deterministic** — no LLM, no network, no filesystem inside `check-engine.ts`. The LLM appears only in `extractor.ts`.
- **Fail-soft init/runtime** (`✓ / ⚠ / ℹ`); never make boot require the native binary.
- **Commit workflow.** Repo uses `commit_message` + `./push.sh`; **do NOT run `git commit`/`git push`.** Each task ends verified (tests green + `npx tsc --noEmit` clean; frontend tasks also `npm run build:frontend`). The per-task "Checkpoint" step replaces "Commit". At plan end write the `commit_message` file.
- **Surgical, pattern-matching changes.** Professional Markdown, no emojis/icons.

---

## File Structure

```
gateway/src/services/consistency/
  types.ts          # NEW — LedgerFact, ConsistencyFinding, severities, categories (shared contract)
  fact-store.ts     # NEW — SQLite: schema + scoped CRUD + idempotent per-book rebuild, fail-soft
  check-engine.ts   # NEW — pure deterministic rules: evaluateFact(fact, priors, gap) -> finding|null
  extractor.ts      # NEW — LLM pass per chapter + parse response into typed facts + scene/time markers
  audit.ts          # NEW — orchestration: seed canon, per-chapter extract->check->merge, build report
gateway/src/api/routes/
  consistency.routes.ts  # NEW — POST /api/books/:slug/consistency-audit (async) + GET .../consistency-report
gateway/src/init/
  phase-03-soul-memory.ts  # MODIFY — instantiate ConsistencyStore with the resolved dbDir, wire onto gw
gateway/src/api/routes.ts  # MODIFY — mount consistency routes
gateway/src/index.ts       # MODIFY — expose services.consistencyStore / services.consistencyAudit (getServices)
frontend/studio/src/routes/Consistency.tsx (or a BookDrawer panel)  # NEW — run + progress + grouped findings
tests/unit/
  consistency-fact-store.test.ts  # NEW
  consistency-check-engine.test.ts # NEW
  consistency-extractor-parse.test.ts # NEW
  consistency-audit.test.ts        # NEW (stubbed extractor + in-memory store + real check-engine)
tests/consistency-smoke.sh         # NEW
```

Phase 1 = Tasks 1–2 (the no-LLM core). Phase 2 = Tasks 3–6 (pipeline + routes + smoke). Phase 3 = Task 7 (UI).

---

### Task 1: Shared types + the fact store (SQLite, scoped, fail-soft)

**Files:**
- Create: `gateway/src/services/consistency/types.ts`
- Create: `gateway/src/services/consistency/fact-store.ts`
- Test: `tests/unit/consistency-fact-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type FactType = 'immutable' | 'stateful';
  export type FactSource = 'canon' | 'manuscript';
  export interface LedgerFact {
    world: string | null; bookSlug: string | null;
    entity: string; aliases: string[]; attribute: string;
    type: FactType; valueRaw: string; valueNorm: string;
    storyTime: number; timeLabel: string | null; transition: string | null;
    chapter: string; scene: number; source: FactSource; evidence: string;
  }
  export type FindingCategory = 'contradiction' | 'continuity' | 'impossibility' | 'canon-divergence';
  export type Severity = 'high' | 'medium' | 'low';
  export interface FindingRef { chapter: string; scene: number; quote: string; }
  export interface CanonRef { canonSource: string; quote: string; }
  export interface ConsistencyFinding {
    category: FindingCategory; severity: Severity; entity: string; attribute: string;
    a: FindingRef; b: FindingRef | CanonRef; explanation: string; suggestedFix: string;
  }
  ```
  ```ts
  // fact-store.ts
  export class ConsistencyStore {
    constructor(workspaceDir: string, dbDir?: string);
    getDbPath(): string;
    async initialize(): Promise<void>;
    isAvailable(): boolean;
    insertFacts(facts: LedgerFact[]): void;            // batch insert (transaction)
    priorFacts(scope: { world: string | null; bookSlug: string }, entity: string, attribute: string): LedgerFact[]; // book + world-canon rows, newest storyTime first
    clearBookFacts(bookSlug: string): void;            // idempotent rebuild
    canonSeedHash(world: string): string | null;       // last seeded content hash, or null
    setCanonSeed(world: string, hash: string): void;
    clearWorldCanon(world: string): void;
    saveReport(bookSlug: string, report: unknown): void;
    getReport(bookSlug: string): unknown | null;
  }
  ```

- [ ] **Step 1: Write `types.ts`** exactly as in the Produces block above. (Pure types; no test needed for this file alone — it is exercised by every later test.)

- [ ] **Step 2: Write the failing fact-store test.**

```ts
// tests/unit/consistency-fact-store.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import type { LedgerFact } from '../../gateway/src/services/consistency/types.js';

function fact(p: Partial<LedgerFact>): LedgerFact {
  return {
    world: null, bookSlug: 'b1', entity: 'John', aliases: ['John'], attribute: 'eye_color',
    type: 'immutable', valueRaw: 'blue', valueNorm: 'blue', storyTime: 0, timeLabel: null,
    transition: null, chapter: 'ch1', scene: 0, source: 'manuscript', evidence: 'his blue eyes', ...p,
  };
}

test('insert + priorFacts returns scoped rows newest-first; idempotent rebuild', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-store-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    s.insertFacts([
      fact({ chapter: 'ch1', storyTime: 0, valueNorm: 'blue' }),
      fact({ chapter: 'ch10', storyTime: 9, valueNorm: 'green' }),
      fact({ bookSlug: 'OTHER', chapter: 'x', valueNorm: 'red' }), // different book — must not leak
      fact({ world: 'w1', bookSlug: null, source: 'canon', storyTime: -1, valueNorm: 'blue' }), // world canon
    ]);

    const priors = s.priorFacts({ world: 'w1', bookSlug: 'b1' }, 'John', 'eye_color');
    // b1 rows + w1 canon row; NOT the OTHER book row
    assert.equal(priors.length, 3);
    assert.equal(priors[0].storyTime >= priors[1].storyTime, true, 'newest-first');
    assert.ok(priors.some(p => p.source === 'canon'));
    assert.ok(!priors.some(p => p.bookSlug === 'OTHER'));

    // Idempotent rebuild: clearing b1 leaves canon + OTHER intact.
    s.clearBookFacts('b1');
    assert.equal(s.priorFacts({ world: 'w1', bookSlug: 'b1' }, 'John', 'eye_color').length, 1); // only canon
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('canon seed hash + report round-trip', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-store-'));
  try {
    const s = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await s.initialize();
    if (!s.isAvailable()) return;
    assert.equal(s.canonSeedHash('w1'), null);
    s.setCanonSeed('w1', 'hash-abc');
    assert.equal(s.canonSeedHash('w1'), 'hash-abc');
    s.saveReport('b1', { findings: [1, 2] });
    assert.deepEqual(s.getReport('b1'), { findings: [1, 2] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run → FAIL** (`Cannot find module .../fact-store.js`).
Run: `node --import tsx --test tests/unit/consistency-fact-store.test.ts`

- [ ] **Step 4: Implement `fact-store.ts`.** Mirror `memory-search.ts`'s lazy-load + fail-soft exactly.

```ts
import { join, dirname } from 'path';
import type { LedgerFact } from './types.js';

export class ConsistencyStore {
  private db: any = null;                 // better-sqlite3, lazy `any`
  private dbPath: string;
  private unavailableReason: string | null = null;

  constructor(workspaceDir: string, dbDir?: string) {
    this.dbPath = dbDir ? join(dbDir, 'consistency.db') : join(workspaceDir, 'memory', 'consistency.db');
  }
  getDbPath(): string { return this.dbPath; }

  async initialize(): Promise<void> {
    try {
      // @ts-ignore — optional native dep, lazy-loaded as any.
      const mod: any = await import('better-sqlite3');
      const Database: any = mod.default || mod;
      const { mkdir } = await import('fs/promises');
      await mkdir(dirname(this.dbPath), { recursive: true });
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS facts (
          id INTEGER PRIMARY KEY,
          world TEXT, book_slug TEXT,
          entity TEXT NOT NULL, aliases TEXT NOT NULL, attribute TEXT NOT NULL,
          type TEXT NOT NULL, value_raw TEXT NOT NULL, value_norm TEXT NOT NULL,
          story_time INTEGER NOT NULL, time_label TEXT, transition TEXT,
          chapter TEXT NOT NULL, scene INTEGER NOT NULL,
          source TEXT NOT NULL, evidence TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_facts_lookup ON facts (world, book_slug, entity, attribute);
        CREATE INDEX IF NOT EXISTS idx_facts_book ON facts (book_slug, chapter);
        CREATE TABLE IF NOT EXISTS canon_seed (world TEXT PRIMARY KEY, hash TEXT NOT NULL, seeded_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit_reports (book_slug TEXT PRIMARY KEY, report TEXT NOT NULL, updated_at TEXT NOT NULL);
      `);
    } catch (err: any) {
      this.unavailableReason = `better-sqlite3 unavailable: ${err?.message || err}. Consistency auditor disabled.`;
      console.warn(`  ⚠ ${this.unavailableReason}`);
      this.db = null;
    }
  }
  isAvailable(): boolean { return this.db !== null; }

  insertFacts(facts: LedgerFact[]): void {
    if (!this.db || facts.length === 0) return;
    const stmt = this.db.prepare(`INSERT INTO facts
      (world, book_slug, entity, aliases, attribute, type, value_raw, value_norm, story_time, time_label, transition, chapter, scene, source, evidence)
      VALUES (@world,@bookSlug,@entity,@aliases,@attribute,@type,@valueRaw,@valueNorm,@storyTime,@timeLabel,@transition,@chapter,@scene,@source,@evidence)`);
    const tx = this.db.transaction((rows: LedgerFact[]) => {
      for (const f of rows) stmt.run({ ...f, aliases: JSON.stringify(f.aliases) });
    });
    tx(facts);
  }

  priorFacts(scope: { world: string | null; bookSlug: string }, entity: string, attribute: string): LedgerFact[] {
    if (!this.db) return [];
    const rows = this.db.prepare(`SELECT * FROM facts
      WHERE entity = ? AND attribute = ?
        AND ( book_slug = ? OR (source = 'canon' AND world IS ? ) )
      ORDER BY story_time DESC, id DESC`).all(entity, attribute, scope.bookSlug, scope.world);
    return rows.map((r: any) => ({
      world: r.world, bookSlug: r.book_slug, entity: r.entity, aliases: JSON.parse(r.aliases),
      attribute: r.attribute, type: r.type, valueRaw: r.value_raw, valueNorm: r.value_norm,
      storyTime: r.story_time, timeLabel: r.time_label, transition: r.transition,
      chapter: r.chapter, scene: r.scene, source: r.source, evidence: r.evidence,
    }));
  }

  clearBookFacts(bookSlug: string): void { if (this.db) this.db.prepare('DELETE FROM facts WHERE book_slug = ?').run(bookSlug); }
  clearWorldCanon(world: string): void {
    if (!this.db) return;
    this.db.prepare("DELETE FROM facts WHERE world = ? AND source = 'canon'").run(world);
    this.db.prepare('DELETE FROM canon_seed WHERE world = ?').run(world);
  }
  canonSeedHash(world: string): string | null {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT hash FROM canon_seed WHERE world = ?').get(world);
    return row ? row.hash : null;
  }
  setCanonSeed(world: string, hash: string): void {
    if (this.db) this.db.prepare('INSERT OR REPLACE INTO canon_seed (world, hash, seeded_at) VALUES (?,?,?)').run(world, hash, new Date().toISOString());
  }
  saveReport(bookSlug: string, report: unknown): void {
    if (this.db) this.db.prepare('INSERT OR REPLACE INTO audit_reports (book_slug, report, updated_at) VALUES (?,?,?)').run(bookSlug, JSON.stringify(report), new Date().toISOString());
  }
  getReport(bookSlug: string): unknown | null {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT report FROM audit_reports WHERE book_slug = ?').get(bookSlug);
    return row ? JSON.parse(row.report) : null;
  }
}
```
Note on the `priorFacts` canon clause: `world IS ?` correctly matches `NULL = NULL` in SQLite when `scope.world` is null (so a book with no world only gets `book_slug` rows). Verify both the world-bound and no-world cases compile and behave (the test covers world-bound; add a no-world assertion if you extend it).

- [ ] **Step 5: Run → PASS.** Then `npx tsc --noEmit` → clean. **Checkpoint** (no git commit). If `better-sqlite3` is unavailable in the dev env, the tests self-skip — note that in the report and rely on the smoke (Task 6) running where the binary builds.

---

### Task 2: The deterministic check engine (pure, no LLM/IO)

**Files:**
- Create: `gateway/src/services/consistency/check-engine.ts`
- Test: `tests/unit/consistency-check-engine.test.ts`

**Interfaces:**
- Consumes: `LedgerFact`, `ConsistencyFinding` (Task 1 `types.ts`).
- Produces:
  ```ts
  export type Gap = 'same' | 'day' | 'longer' | 'unknown';
  // Evaluate ONE incoming manuscript fact against its prior facts (newest-first,
  // book + world-canon, same entity+attribute) and the story-clock gap to the
  // latest manuscript prior. Returns one finding or null. Pure.
  export function evaluateFact(fact: LedgerFact, priors: LedgerFact[], gap: Gap): ConsistencyFinding | null;
  ```

- [ ] **Step 1: Write the failing test** (this encodes the spec's rule table — it is the heart of the feature).

```ts
// tests/unit/consistency-check-engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFact, type Gap } from '../../gateway/src/services/consistency/check-engine.js';
import type { LedgerFact } from '../../gateway/src/services/consistency/types.js';

const F = (p: Partial<LedgerFact>): LedgerFact => ({
  world: null, bookSlug: 'b1', entity: 'John', aliases: ['John'], attribute: 'eye_color',
  type: 'immutable', valueRaw: 'blue', valueNorm: 'blue', storyTime: 5, timeLabel: null,
  transition: null, chapter: 'ch10', scene: 0, source: 'manuscript', evidence: 'green eyes', ...p,
});

test('immutable mismatch -> contradiction (high)', () => {
  const f = F({ valueNorm: 'green', chapter: 'ch10' });
  const prior = F({ valueNorm: 'blue', chapter: 'ch1', storyTime: 0 });
  const finding = evaluateFact(f, [prior], 'longer');
  assert.equal(finding?.category, 'contradiction');
  assert.equal(finding?.severity, 'high');
  assert.equal(finding?.a.chapter, 'ch10');
  assert.equal((finding?.b as any).chapter, 'ch1');
});

test('manuscript fact contradicting canon -> canon-divergence (high)', () => {
  const f = F({ valueNorm: 'green' });
  const canon = F({ valueNorm: 'blue', source: 'canon', world: 'w1', bookSlug: null, evidence: 'Character Bible: blue', chapter: 'CANON' });
  const finding = evaluateFact(f, [canon], 'unknown');
  assert.equal(finding?.category, 'canon-divergence');
  assert.equal((finding?.b as any).canonSource !== undefined, true);
});

test('stateful change WITH transition -> no finding', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean suit', transition: 'changed clothes', chapter: 'ch3' });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', chapter: 'ch2', storyTime: 2 });
  assert.equal(evaluateFact(f, [prior], 'day'), null);
});

test('stateful change WITHOUT transition, small gap -> continuity (medium)', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean suit', transition: null, chapter: 'ch3' });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', chapter: 'ch2', storyTime: 2 });
  const finding = evaluateFact(f, [prior], 'same');
  assert.equal(finding?.category, 'continuity');
  assert.equal(finding?.severity, 'medium');
});

test('stateful change without transition, UNKNOWN gap -> low (review)', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean', transition: null });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', storyTime: 2 });
  assert.equal(evaluateFact(f, [prior], 'unknown')?.severity, 'low');
});

test('stateful change without transition, LONGER gap -> no finding (legit reset)', () => {
  const f = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'clean', transition: null });
  const prior = F({ attribute: 'clothing_state', type: 'stateful', valueNorm: 'muddy', storyTime: 2 });
  assert.equal(evaluateFact(f, [prior], 'longer'), null);
});

test('two incompatible stateful values in SAME story_time -> impossibility (high)', () => {
  const f = F({ attribute: 'location', type: 'stateful', valueNorm: 'the docks', storyTime: 4, chapter: 'ch4' });
  const prior = F({ attribute: 'location', type: 'stateful', valueNorm: 'the manor', storyTime: 4, chapter: 'ch4', scene: 1 });
  const finding = evaluateFact(f, [prior], 'same');
  assert.equal(finding?.category, 'impossibility');
  assert.equal(finding?.severity, 'high');
});

test('same value as prior -> no finding', () => {
  assert.equal(evaluateFact(F({ valueNorm: 'blue' }), [F({ valueNorm: 'blue', chapter: 'ch1' })], 'longer'), null);
});

test('no priors -> no finding', () => {
  assert.equal(evaluateFact(F({}), [], 'unknown'), null);
});
```

- [ ] **Step 2: Run → FAIL.**
Run: `node --import tsx --test tests/unit/consistency-check-engine.test.ts`

- [ ] **Step 3: Implement `check-engine.ts`** (actual rules, no placeholders).

```ts
import type { LedgerFact, ConsistencyFinding, FindingRef, CanonRef } from './types.js';

export type Gap = 'same' | 'day' | 'longer' | 'unknown';

const refOf = (f: LedgerFact): FindingRef => ({ chapter: f.chapter, scene: f.scene, quote: f.evidence });
const canonRefOf = (f: LedgerFact): CanonRef => ({ canonSource: f.evidence, quote: f.evidence });

function finding(
  category: ConsistencyFinding['category'], severity: ConsistencyFinding['severity'],
  fact: LedgerFact, prior: LedgerFact, explanation: string, suggestedFix: string,
): ConsistencyFinding {
  return {
    category, severity, entity: fact.entity, attribute: fact.attribute,
    a: refOf(fact), b: prior.source === 'canon' ? canonRefOf(prior) : refOf(prior),
    explanation, suggestedFix,
  };
}

export function evaluateFact(fact: LedgerFact, priors: LedgerFact[], gap: Gap): ConsistencyFinding | null {
  if (priors.length === 0) return null;
  const diff = priors.filter(p => p.valueNorm !== fact.valueNorm);
  if (diff.length === 0) return null; // consistent with everything

  // 1) Canon divergence — any seeded canon value differs.
  const canon = diff.find(p => p.source === 'canon');
  if (canon) {
    return finding('canon-divergence', 'high', fact, canon,
      `${fact.entity}'s ${fact.attribute} is "${fact.valueRaw}" here but canon establishes "${canon.valueRaw}".`,
      `Chapter ${fact.chapter} says ${fact.entity}'s ${fact.attribute} is "${fact.valueRaw}"; the bible establishes "${canon.valueRaw}" — reconcile.`);
  }

  // 2) Immutable mismatch — an immutable attribute changed value.
  if (fact.type === 'immutable') {
    const prior = diff.find(p => p.type === 'immutable') ?? diff[0];
    return finding('contradiction', 'high', fact, prior,
      `${fact.entity}'s ${fact.attribute} is "${fact.valueRaw}" but was "${prior.valueRaw}" in ${prior.chapter}.`,
      `${fact.entity}'s ${fact.attribute} should not change: "${prior.valueRaw}" (${prior.chapter}) vs "${fact.valueRaw}" (${fact.chapter}) — reconcile.`);
  }

  // 3) Stateful.
  // 3a) Impossibility — incompatible value at the SAME story_time.
  const sameTime = diff.find(p => p.storyTime === fact.storyTime);
  if (sameTime) {
    return finding('impossibility', 'high', fact, sameTime,
      `${fact.entity}'s ${fact.attribute} is both "${fact.valueRaw}" and "${sameTime.valueRaw}" at the same point in the story.`,
      `Same moment, two values for ${fact.entity}'s ${fact.attribute}: "${sameTime.valueRaw}" vs "${fact.valueRaw}" — pick one.`);
  }
  // 3b) A transition justifies the change.
  if (fact.transition) return null;
  // 3c) Change without cause — severity by elapsed gap.
  if (gap === 'longer') return null;                 // enough time passed: legitimate reset
  const severity = gap === 'unknown' ? 'low' : 'medium';
  const prior = diff[0];
  return finding('continuity', severity, fact, prior,
    `${fact.entity}'s ${fact.attribute} changed from "${prior.valueRaw}" (${prior.chapter}) to "${fact.valueRaw}" (${fact.chapter}) with no stated cause.`,
    `${fact.entity}'s ${fact.attribute} was "${prior.valueRaw}" in ${prior.chapter} and is "${fact.valueRaw}" in ${fact.chapter} with nothing in between — add a transition or fix.`);
}
```

- [ ] **Step 4: Run → PASS (9 tests).** Then `npx tsc --noEmit` → clean. **Checkpoint.**

---

### Task 3: The extractor — LLM pass + deterministic response parser

**Files:**
- Create: `gateway/src/services/consistency/extractor.ts`
- Test: `tests/unit/consistency-extractor-parse.test.ts`

**Interfaces:**
- Consumes: `LedgerFact`, `FactType` (types.ts); an injected `ai.complete` (same shape as `prompt-runner.ts` uses: `(req) => Promise<{ text: string }>`).
- Produces:
  ```ts
  export interface ExtractedScene { storyTime: number; timeLabel: string | null; }
  export interface ExtractResult { facts: Omit<LedgerFact,'world'|'bookSlug'|'chapter'>[]; scenes: ExtractedScene[]; }
  /** Pure: parse the model's JSON into typed facts + scenes. Throws on unparseable JSON; the caller fail-softs. */
  export function parseExtractorResponse(text: string, chapterStoryBase: number): ExtractResult;
  /** The LLM pass: builds the prompt (chapter prose + known-entity digest), calls ai.complete, parses. */
  export async function extractChapterFacts(deps: { ai: { complete(req:any): Promise<{ text:string }>; select(t:string):{id:string} } }, chapterText: string, knownEntities: { entity:string; aliases:string[]; current: Record<string,string> }[], chapterStoryBase: number): Promise<ExtractResult>;
  ```

- [ ] **Step 1: Write the failing parse test** (only the pure parser is unit-tested; the LLM call is covered by the smoke).

```ts
// tests/unit/consistency-extractor-parse.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtractorResponse } from '../../gateway/src/services/consistency/extractor.js';

const SAMPLE = JSON.stringify({
  scenes: [{ timeLabel: 'that evening' }, { timeLabel: 'next morning' }],
  facts: [
    { entity: 'John Marsh', aliases: ['John','Marsh'], attribute: 'eye_color', type: 'immutable', valueRaw: 'emerald', valueNorm: 'green', scene: 0, transition: null, evidence: 'his emerald eyes' },
    { entity: 'John Marsh', aliases: ['John'], attribute: 'clothing_state', type: 'stateful', valueRaw: 'muddy work clothes', valueNorm: 'muddy', scene: 0, transition: null, evidence: 'still in his muddy work clothes' },
  ],
});

test('parses facts with normalized values + types and assigns scene story-time off the base', () => {
  const r = parseExtractorResponse(SAMPLE, 100);
  assert.equal(r.facts.length, 2);
  assert.equal(r.facts[0].valueNorm, 'green');
  assert.equal(r.facts[0].type, 'immutable');
  assert.equal(r.facts[0].storyTime, 100); // base + scene index 0
  assert.equal(r.scenes.length, 2);
  assert.equal(r.scenes[1].timeLabel, 'next morning');
});

test('tolerates code-fenced JSON and rejects pure garbage', () => {
  const fenced = '```json\n' + SAMPLE + '\n```';
  assert.equal(parseExtractorResponse(fenced, 0).facts.length, 2);
  assert.throws(() => parseExtractorResponse('not json at all', 0));
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `extractor.ts`.** The parser strips fences, `JSON.parse`s, coerces each fact to the shape (defaulting `aliases`→`[entity]`, `type`→`'stateful'` when missing, `valueNorm`→lowercased `valueRaw` when missing), and computes `storyTime = chapterStoryBase + (scene ?? 0)`. `extractChapterFacts` builds the system prompt (an expert continuity extractor — instruct: return STRICT JSON only `{scenes:[{timeLabel}], facts:[{entity,aliases,attribute,type,valueRaw,valueNorm,scene,transition,evidence}]}`; classify `immutable` vs `stateful`; normalize values; resolve names to the canonical `entity` using the supplied known-entity digest; capture weather/time/clothing/location/injury and any world-rule claims), passes the chapter prose + a compact digest of `knownEntities` as the user message, calls `ai.complete({ provider: ai.select('consistency').id, system, messages:[{role:'user',content}], maxTokens: 4000, temperature: 0.1 })`, and returns `parseExtractorResponse(res.text, chapterStoryBase)`. Provide the literal system-prompt string in the implementation.

- [ ] **Step 4: Run parse test → PASS.** `npx tsc --noEmit` → clean. **Checkpoint.**

---

### Task 4: Audit orchestration + service wiring

**Files:**
- Create: `gateway/src/services/consistency/audit.ts`
- Modify: `gateway/src/init/phase-03-soul-memory.ts` (instantiate `ConsistencyStore` with the resolved `dbDir`, `await initialize()`, assign `gw.consistencyStore`)
- Modify: `gateway/src/index.ts` (expose `consistencyStore` + the audit runner in `getServices()`)
- Test: `tests/unit/consistency-audit.test.ts`

**Interfaces:**
- Consumes: `ConsistencyStore` (Task 1), `evaluateFact`/`Gap` (Task 2), `extractChapterFacts`/`parseExtractorResponse` (Task 3); `BookService.dataDirOf`/`listBookFiles`/`worldDocsOf`/`worldbuildingOf`; `AIRouter`.
- Produces:
  ```ts
  export interface AuditDeps {
    store: ConsistencyStore;
    books: { dataDirOf(s:string): string|null; worldDocsOf(s:string): string|null; worldbuildingOf(s:string): string|null; open(s:string): Promise<any> };
    extract: (chapterText: string, known: any[], base: number) => Promise<import('./extractor.js').ExtractResult>;
    onProgress?: (msg: string) => void;
  }
  export interface AuditReport { findings: import('./types.js').ConsistencyFinding[]; chaptersScanned: number; factCount: number; generatedAt: string; }
  export async function runConsistencyAudit(slug: string, deps: AuditDeps): Promise<AuditReport>;
  ```

- [ ] **Step 1: Write the failing audit test** (deterministic: a STUB `extract` returns fixture facts; real in-memory store + real check-engine).

```ts
// tests/unit/consistency-audit.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import { runConsistencyAudit } from '../../gateway/src/services/consistency/audit.js';

test('audit reports a planted eye-color contradiction across two chapters', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-audit-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('sqlite unavailable — skipping'); return; }

    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'chapter-1.md'), 'John has blue eyes.');
    writeFileSync(join(dataDir, 'chapter-2.md'), 'John has green eyes.');

    // Stub extractor: chapter 1 -> blue (immutable), chapter 2 -> green (immutable).
    const extract = async (text: string, _k: any[], base: number) => ({
      scenes: [{ storyTime: base, timeLabel: null }],
      facts: [{ entity: 'John', aliases: ['John'], attribute: 'eye_color', type: 'immutable' as const,
        valueRaw: text.includes('blue') ? 'blue' : 'green', valueNorm: text.includes('blue') ? 'blue' : 'green',
        storyTime: base, timeLabel: null, transition: null, scene: 0, source: 'manuscript' as const, evidence: text }],
    });
    const books = {
      dataDirOf: () => dataDir, worldDocsOf: () => null, worldbuildingOf: () => null, open: async () => ({ manifest: { pulledFrom: {} } }),
    };
    const report = await runConsistencyAudit('b1', { store, books, extract });
    assert.equal(report.chaptersScanned, 2);
    const c = report.findings.find(f => f.category === 'contradiction' && f.attribute === 'eye_color');
    assert.ok(c, 'eye-color contradiction reported');
    assert.equal(c!.severity, 'high');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `audit.ts`.** Steps: resolve `dataDirOf(slug)`; list chapter `.md` files **sorted naturally** (`chapter-1, chapter-2, … chapter-10` — sort by the trailing integer, falling back to locale sort); `clearBookFacts(slug)`; seed canon (read `worldDocsOf(slug)` + `worldbuildingOf(slug)`; if present, run `extract` over them once as `source:'canon'`, keyed by the book's bound world name from `open(slug)` manifest `pulledFrom.world?.name` (else `book_slug`), set via `setCanonSeed` keyed by a content hash; skip if hash unchanged); then for each chapter in order, maintain a `storyBase` cursor (increment by the chapter's scene count), build the known-entity digest by querying the store, call `deps.extract(chapterText, digest, storyBase)`, derive the `Gap` from consecutive `timeLabel`s (a small deterministic map: "next morning"/"that evening"→`day` or `same`; "days/weeks later"→`longer`; none→`unknown`), call `evaluateFact` for each new fact against `store.priorFacts(scope, entity, attribute)`, collect non-null findings, then `insertFacts` the new (chapter-stamped, world/bookSlug-stamped) facts. Return `{ findings, chaptersScanned, factCount, generatedAt }`. Fail-soft per chapter (a thrown extract/parse skips that chapter's facts, `onProgress` logs it). **Wiring:** in `phase-03` build `new ConsistencyStore(join(ROOT_DIR,'workspace'), dbDir)` (reuse the already-resolved `dbDir`), `await initialize()`, assign `gw.consistencyStore`; in `index.ts` `getServices()` add `consistencyStore` and a thin `consistencyAudit` runner that constructs `AuditDeps` from `services.books` + an `extract` closure over `extractChapterFacts({ ai })`.

- [ ] **Step 4: Run audit test → PASS.** `npx tsc --noEmit` → clean. **Checkpoint.**

---

### Task 5: API routes (async audit + report)

**Files:**
- Create: `gateway/src/api/routes/consistency.routes.ts`
- Modify: `gateway/src/api/routes.ts` (import + `mountConsistency(app, gateway, baseDir)`)

**Interfaces:**
- Consumes: `services.consistencyStore`, `services.consistencyAudit` (Task 4); `SLUG_RE`, `services.books.exists`.
- Produces: `POST /api/books/:slug/consistency-audit` → `{ status:'started', slug }` (async; emits `consistency-progress|complete|error` on `gateway.io`); `GET /api/books/:slug/consistency-report` → `{ report }`.

- [ ] **Step 1: Implement the routes**, mirroring the `continuity-check` async pattern (`documents.routes.ts:861`): validate slug + book exists; for the GET, return `services.consistencyStore?.getReport(slug) ?? null`; for the POST, if `!consistencyStore?.isAvailable()` return `503 {error:'Consistency DB unavailable'}`, else respond `{status:'started',slug}` immediately and run `services.consistencyAudit(slug, onProgress)` in the background, emitting socket events and `store.saveReport(slug, report)` on completion.

- [ ] **Step 2: Mount** in `routes.ts` (find where `mountWorlds`/`mountPrompts` are mounted and add `mountConsistency` beside them).

- [ ] **Step 3:** `npx tsc --noEmit` → clean. (Behavior is covered end-to-end by Task 6.) **Checkpoint.**

---

### Task 6: End-to-end smoke test

**Files:**
- Create: `tests/consistency-smoke.sh` (model on `tests/world-crud-smoke.sh`: boot the gateway on port 3849 with an env token, `set -uo pipefail`, cleanup trap killing the server + removing the seeded book, `-v` streams the server log).

- [ ] **Step 1: Write the smoke.** Seed a 2-chapter book in the real workspace (create via `POST /api/books`, then write `data/chapter-1.md` with "John's blue eyes ... muddy work clothes" and `data/chapter-2.md` with "John's green eyes ... showered and changed into a clean suit the next morning"). `POST /api/books/<slug>/consistency-audit`; poll `GET .../consistency-report` until non-null (or timeout). Assert: the report contains a **contradiction** for `eye_color` (blue vs green), and does **NOT** contain a continuity finding for `clothing_state` (the clean suit is justified by "showered"/"next morning"). Uses real OpenRouter on the cheap model if Ollama is unavailable. If `consistencyStore` is unavailable (no native sqlite) the audit returns 503 — assert that path cleanly instead and SKIP the content asserts (so the smoke passes on a box without the binary, like the deploy target builds it).

- [ ] **Step 2: Run `bash tests/consistency-smoke.sh`** → all asserts pass (against a local boot). **Checkpoint.**

---

### Task 7: Studio report panel

**Files:**
- Create: `frontend/studio/src/routes/Consistency.tsx` (or a `BookDrawer` panel — match how `PromptRunner`/`BuildBiblePanel` are structured) + a Rail entry if it's a route.
- Modify: the studio client lib to add `runConsistencyAudit(slug)` (POST) + `getConsistencyReport(slug)` (GET) + a socket listener for `consistency-progress|complete`.

- [ ] **Step 1: Implement the panel** — a book selector (reuse the PromptRunner book selector pattern), a **Run audit** button, a live progress line (from the socket events), and the findings grouped by severity (high→low) then category, each row showing the two locations (chapter + quote), the explanation, and the suggested fix. Read-only. Match existing studio styling (reuse `vmeta`/asset classes).

- [ ] **Step 2:** `npx tsc --noEmit && npm run build:frontend` → both clean. **Checkpoint.**

---

## Self-Review

**Spec coverage.** Fact model + SQLite store → Task 1. Deterministic check rules (immutable/contradiction, stateful continuity/impossibility, canon-divergence, gap severities) → Task 2. Extraction + story clock + normalization/typing → Task 3. Canon seeding (world docs / series worldbuilding, hash re-seed) + per-chapter orchestration + idempotent rebuild + scoping → Task 4. API (async audit + report, mirrors continuity-check) → Task 5. Smoke (planted contradiction reported, legit reset not flagged) → Task 6. Read-only report UI → Task 7. Scale/scoping (shared per-world canon, per-book rebuild, indexes) → Task 1 schema + Task 4 orchestration. Fail-soft/`BOOKCLAW_DB_DIR` → Task 1 + Task 4 wiring. DB maintenance is explicitly out of scope (separate TODO).

**Placeholder scan.** Tasks 1–2 (the deterministic core) carry complete literal code + tests. Tasks 3–7 give the exact interfaces, the parser's literal test, concrete step lists, and the exact existing patterns to mirror (`memory-search` fail-soft, `continuity-check` async route, `PromptRunner` UI) — the model-prompt string and UI JSX are described to write in full, not stubbed. No "TBD"/"handle edge cases".

**Type consistency.** `LedgerFact`/`ConsistencyFinding`/`FactType`/`Gap` are defined once in `types.ts` (Task 1) and used verbatim in Tasks 2–7. `evaluateFact(fact, priors, gap)` signature matches between Task 2's definition and Task 4's call. `ConsistencyStore` method names (`priorFacts`, `clearBookFacts`, `insertFacts`, `canonSeedHash`, `setCanonSeed`, `saveReport`, `getReport`, `isAvailable`) match between Task 1 and Tasks 4–5. `extractChapterFacts`/`parseExtractorResponse`/`ExtractResult` match between Task 3 and Task 4.

**Ambiguity.** Per-chapter fail-soft is explicit (skip facts, log, never abort). The `priorFacts` canon clause uses `world IS ?` so a no-world book gets only its own rows. Story-clock gap mapping is a small deterministic table in Task 4; when unknown, stateful flags downgrade to `low`.
