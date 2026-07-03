# Flagship Consistency Spine Implementation Plan (Plan 3 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Wire the existing consistency engine (`consistency/fact-store` `ConsistencyStore`, the Character Knowledge Matrix + Selective Exclusion + red-herring engine, and `runConsistencyAudit`) into every phase so it prevents drift before drafting, detects and flags it after, gates at act boundaries, audits before export, and runs standalone on imported past novels.

**Architecture:** The fact ledger + knowledge matrix seed from the bible phase. Before each chapter drafts, relevant canon + the knowledge matrix + forbidden moves are injected into the Scene Brief/Draft prompt. After each chapter, new facts are extracted (updating the ledger) and a `continuity` check flags contradictions, which feed the analyze-then-apply polish (Plan 4). The full `runConsistencyAudit` runs pre-export and is also exposed as a standalone import-and-audit path.

**Tech Stack:** Node 22+, TypeScript (NodeNext, `.js` imports), `node --import tsx --test`. `better-sqlite3` is optional/fail-soft (the store already degrades gracefully).

## Global Constraints

- Same as Plan 1 (`.js` imports; `node:test`; `commit_message` workflow; no direct git; no placeholders).
- Fail-soft: a missing `better-sqlite3` or an empty ledger must never break generation — continuity injection/detection degrades to a no-op, matching the existing consistency service posture.
- Reuse, don't reinvent: `ConsistencyStore` (`fact-store.ts`), `runConsistencyAudit` (`audit.ts`), the knowledge-matrix/selective-exclusion code, and the ConsistencyJobRegistry (already guards concurrent audits after bug-review #22). Do NOT add a second fact store.
- **Re-ground note:** confirm the current `ConsistencyStore` method names (`clearBookFacts`, fact insert/query, knowledge-matrix accessors) and `runConsistencyAudit(slug, deps)` signature before writing test code — read `gateway/src/services/consistency/*.ts` first.

## File Structure

- Create `gateway/src/services/consistency/canon-inject.ts` — `buildCanonBlock(slug, chapterNumber, store, opts)` returning the pre-draft canon + knowledge-matrix + forbidden-moves block (composes existing selective-exclusion + `book-canon`).
- Create `gateway/src/services/consistency/continuity-check.ts` — `checkChapter(slug, chapterNumber, text, store, aiComplete)` returning structured contradiction flags.
- Modify `gateway/src/init/phase-06-content.ts` — seed the ledger from the bible-phase completion (extend the existing step-completed hook).
- Modify `gateway/src/api/routes/projects.routes.ts` — inject the canon block pre-draft; run `checkChapter` post-draft and attach flags to the step result for Plan 4's polish.
- Modify `gateway/src/api/routes/consistency.routes.ts` — add `POST /api/books/:slug/consistency/import-audit` (import a manuscript file, split into chapters, run `runConsistencyAudit`).
- Casting: ensure the `continuity` role in each casting sheet pins a high-reasoning model (already true for romance; add for others in Plan 7).
- Tests: `tests/unit/canon-inject.test.ts`, `tests/unit/continuity-check.test.ts`, `tests/unit/consistency-import-audit.test.ts`, plus an extension to `tests/unit/consistency-audit.test.ts`.

## Tasks

### Task 1: `buildCanonBlock` (pre-draft prevention)
**Files:** create `canon-inject.ts`; test `canon-inject.test.ts`.
**Interfaces:** `buildCanonBlock(args: { slug: string; chapterNumber: number; store: ConsistencyStore; selectiveExclusion?: boolean }): string` — pulls the facts relevant up to `chapterNumber`, the knowledge matrix ("what each character knows now"), and forbidden-moves (facts marked not-yet-revealed), and formats a prompt block. Empty string when the store is unavailable/empty.
- [ ] TDD: seed a temp store with facts across chapters (1..N), assert the block for chapter 5 includes ch<=5 canon and the knowledge-matrix section, excludes not-yet-revealed facts, and is `''` for an empty store. Implement by composing the existing selective-exclusion + knowledge-matrix accessors (read them first). Commit.

### Task 2: `checkChapter` (post-draft detection)
**Files:** create `continuity-check.ts`; test `continuity-check.test.ts`.
**Interfaces:** `checkChapter(args: { slug: string; chapterNumber: number; text: string; store: ConsistencyStore; aiComplete: (r:any)=>Promise<{text:string}> }): Promise<{ flags: Array<{ kind: 'contradiction'|'timeline'|'knowledge'|'red_herring'; detail: string; span?: string }> }>` — extracts the chapter's facts (reuse the extractor), diffs against the ledger for contradictions/timeline/knowledge violations, and detects premature reveals (red-herring). Fail-soft → `{flags:[]}`.
- [ ] TDD: with a fake `aiComplete` + a seeded store where the ledger says "Anna has brown eyes" and the chapter text says "Anna's blue eyes", assert a `contradiction` flag; a chapter where a character acts on info they don't have → a `knowledge` flag. Commit.

### Task 3: Seed the ledger from the bible phase
**Files:** modify `phase-06-content.ts` (the existing project/step completion hook). 
- [ ] TDD (at the existing phase-06 hook test seam): on completion of a bible/`role:'bible'` step for a book, the fact store is seeded (extract facts from the bible content). Reuse the existing auto-consistency-audit registry guard pattern (#22). Assert facts exist for the slug afterward. Commit.

### Task 4: Wire canon injection + continuity check into the per-chapter loop
**Files:** modify `projects.routes.ts` (per-chapter draft path, same site Plan 2 T7 touches).
- [ ] TDD (integration, fake engine + store): before a `draft`-role chapter, `buildCanonBlock` output is present in the assembled prompt; after generation, `checkChapter` runs and its flags are attached to the step result (a new `step.continuityFlags` field) for Plan 4 to consume. Behind a book-has-bible guard (fail-soft when no ledger). Commit.

### Task 5: Act-boundary mini-audit at the gate
**Files:** modify the gate surfacing (coordinate with Plan 5's gate cadence — this task may be finalized after Plan 5). 
- [ ] TDD: at a per-act human gate, a cross-chapter continuity summary (aggregated `checkChapter` flags for the act's chapters) is attached to the gate payload. If Plan 5 isn't built yet, implement the aggregation function + test now and wire it into the gate in Plan 5. Commit.

### Task 6: Standalone import-and-audit route (past novels)
**Files:** modify `consistency.routes.ts`; test `consistency-import-audit.test.ts`.
**Interfaces:** `POST /api/books/:slug/consistency/import-audit` body `{ filename }` (a manuscript under the book data dir or an uploaded doc) → splits into chapters (`splitManuscriptIntoChapters` from `audit.ts`), runs `runConsistencyAudit(slug, deps)` (registry-guarded), returns the report.
- [ ] TDD (route harness like Plan 1's document tests): import a 3-chapter fixture manuscript with a planted contradiction; assert the audit report contains the contradiction and the route is auth-gated (401 without token). Confirm it reuses `runConsistencyAudit` (no second audit implementation). Commit.

## Self-Review
- Spec coverage (§4.7): seed (T3), pre-draft prevention (T1, T4), post-draft detection feeding polish (T2, T4), act-gate mini-audit (T5), full audit + standalone import path (T6), high-reasoning `continuity` casting (Plan 1 sheet + Plan 7). Reuses existing engine; no duplicate store.
- Downstream: T4's `step.continuityFlags` is consumed by Plan 4's analyze-then-apply polish; T5 finalizes against Plan 5's gate.
