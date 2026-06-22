# Post-Writing Consistency Auditor — Design Spec

**Date:** 2026-06-22
**Status:** Design — under review. Next: implementation plan via `superpowers:writing-plans`.
**Feature-tracking:** `docs/TODO.md` → "Post-writing consistency auditor (fact-ledger continuity checker)" + "Consistency-ledger database maintenance".
**Related:** roadmap #3 (Deep continuity engine), #12 (semantic memory + bible knowledge-graph); the existing entity-index continuity engine (`gateway/src/services/context-engine.ts` `runContinuityCheck`, old-project model); the World Repository (`docs/superpowers/specs/2026-06-21-world-repository-design.md`) as a canon source.

## Problem

Cross-chapter consistency is the #1 manual-cleanup pain in long fiction. A detail stated in chapter 1 (a character's blue eyes, a location's layout, the weather, what someone is wearing) may not recur until chapter 10 — far beyond a single context window. Authors currently brute-force it by feeding the entire prior chapter into the prompt when writing the next one (costly, inefficient, and still misses distant references). The owner's *Love between Departures* (~90k words) is unpublished for exactly this reason; other authors report the same.

Two failure classes matter:
1. **Canon divergence** — the manuscript contradicts an established source of truth (World Repository docs, series worldbuilding, character notes).
2. **Internal micro-consistency** — the manuscript contradicts *itself*: immutable details that change (eye color), or stateful details that change without cause / fail to carry forward (clean clothes in a scene with no shower since the muddy one).

## Goal

A **post-writing auditor**: run it on a finished (or in-progress) book and get a trustworthy, reviewable report of consistency problems across the whole manuscript — without re-reading the book on every check, and without flooding the author with false positives from legitimate change.

This feature is **find + report for manual review**. Per-finding apply-fix and the during-generation *inline auto-fix* mode are explicit follow-ons that reuse the same fact-ledger core.

## Locked decisions (from brainstorming)

| # | Decision |
|---|----------|
| 1 | Checks **both** canon divergence **and** internal micro-consistency. |
| 2 | Input is a **BookClaw book** (chapters = natural chunks; carries whatever bible it has). Must work with **no** World Repository world bound (lean on internal consistency + series/character notes). |
| 3 | Architecture = a **per-book SQLite fact ledger**: LLM **extraction** per chapter; **deterministic** checking (no LLM in the check path). |
| 4 | Facts are typed **`immutable`** vs **`stateful`**; stateful facts carry forward along a **story clock** and only flag on change-without-cause / impossibility. |
| 5 | **Per-world canon extracted once** (shared across the world's books); **per-book manuscript facts**, idempotent rebuild; one DB at `BOOKCLAW_DB_DIR`, indexed by `(world, book_slug, entity, attribute)`. |
| 6 | Output v1 = **report only** (manual review). Apply-fix + inline mode are follow-ons. |

## Architecture & the fact model

A single SQLite DB at `BOOKCLAW_DB_DIR` — **its own `consistency.db` file, separate from the memory-search index** but in the same off-the-synced-workspace location (a live SQLite DB under cloud sync corrupts). Fail-soft: if `better-sqlite3` is unavailable the service logs `⚠` and the audit endpoint returns a clear "consistency DB unavailable" error, mirroring `memory-search`.

**`facts` table** — one row per (entity, attribute, assertion):

| column | meaning |
|---|---|
| `id` | pk |
| `world` | world name when this is shared canon; else `NULL` |
| `book_slug` | the book (manuscript facts); `NULL` for shared per-world canon |
| `entity` | resolved canonical name (e.g. `John Marsh`) |
| `aliases` | JSON array of surface forms seen (`["John","Marsh","he"]`) |
| `attribute` | normalized key (`eye_color`, `clothing_state`, `location`, `weather`, `hair_state`, `injury`, …) |
| `type` | `immutable` \| `stateful` |
| `value_raw` | as written (`"emerald"`) |
| `value_norm` | normalized for comparison (`"green"`) |
| `story_time` | integer scene-clock ordinal (monotonic per book) |
| `time_label` | the in-story marker that set it (`"that evening"`, `"next morning"`) |
| `transition` | for stateful: the event that set this value (`"showered"`, `"changed clothes"`, `NULL`) |
| `chapter` | chapter id/index |
| `scene` | scene index within chapter |
| `source` | `canon` \| `manuscript` |
| `evidence` | verbatim quote the fact was drawn from |

Indexes: `(world, book_slug, entity, attribute)` and `(book_slug, chapter)`. **Auxiliary tables:** `audit_reports` (per book: the latest findings JSON + run metadata) and `canon_seed` (`world` → content hash + seeded-at, to detect stale canon).

**Pipeline (per book audit):**
1. **Seed canon** (once per world, refreshed on hash change) — extract canonical facts from the book's bible sources.
2. **For each chapter, in reading order:** extract facts → resolve/normalize → **deterministic check** against the accumulated ledger (book rows + its world canon) → record findings → **merge** (append immutables; advance each entity's current stateful value along the story clock).
3. Persist the findings report; emit progress over Socket.IO.

The LLM does only **extraction + normalization + typing**; the **check is deterministic**, so it scales to 90k words and never re-reads the book.

## Scale & scoping

Sizes are modest for SQLite (~2k–6k rows/book; a full library well under ~200k rows — a few MB, sub-millisecond indexed lookups). The scoping rules are for cleanliness and efficiency, not to avoid a performance wall:

- **Shared per-world canon, extracted once** (`world` set, `book_slug NULL`) — every book bound to that world reuses it; re-seeded only when the world's content hash changes. The big efficiency win for complex worlds (Shattered Cradle's 56 docs are turned into facts once, not per book).
- **Per-book manuscript facts** (`book_slug` set) — a re-audit **deletes the book's rows and rebuilds**, so re-runs never grow the table unbounded.
- A book's check queries only its own rows + its world's canon rows, regardless of how many other books exist.

Lifecycle housekeeping (pruning deleted books, re-seeding stale canon, `VACUUM`, orphan detection, size monitoring) is the separate **"Consistency-ledger database maintenance"** TODO.

## Extraction (the one LLM pass per chapter)

A curated extractor prompt. Input: the chapter prose **plus a compact "known entities + current state" digest** from the ledger (entity names + aliases + current stateful values) so the model resolves aliases and doesn't re-introduce duplicates. Output: strict JSON — a list of facts, each `{ entity, aliases, attribute, type, value_raw, value_norm, transition?, evidence }`, plus the chapter's **time markers** (ordered scene boundaries + relative-time phrases). Fail-soft: an unparseable response skips that chapter's *new* facts (logged), never aborts the audit. One mid-tier call per chapter (≈ Summary+ cost). The extractor is the only model-dependent unit; everything downstream is deterministic.

## Story clock

A deterministic step converts each chapter's time markers into a monotonic `story_time` ordinal and a coarse elapsed estimate (same scene / same day / next day / longer). This is what distinguishes a *legitimate* stateful reset ("next day, showered") from a *suspect* change ("clothes clean in the very next scene, no transition"). The clock is best-effort; when markers are absent it advances by scene order and elapsed defaults to "unknown", which downgrades a stateful flag from "error" to "review".

## Deterministic check engine (the core, no LLM)

For each incoming fact, look up prior facts for the same resolved `entity` + `attribute` (book rows + world canon), then apply:

- **`immutable` mismatch** — `value_norm` differs from an established `immutable`/`canon` value → **Contradiction** (severity high). Carries both chapter refs + quotes (or the canon source for divergence).
- **`stateful` change without cause** — differs from the current value, no `transition`, and the story-clock gap is small (same scene/day) → **Continuity error** (severity medium). With an unknown gap → **Review** (low).
- **`stateful` impossibility** — two incompatible values asserted in the **same scene/`story_time`** (character in two places), or a change impossible for the elapsed time (an injury established as severe, healed by the next morning) → **Impossibility** (high).
- **Canon divergence** — a manuscript fact contradicts a seeded `canon` fact for the same entity+attribute → **Canon divergence** (high).

Each finding: `{ category, severity, entity, attribute, a:{chapter,scene,quote}, b:{chapter,scene,quote}|canonSource, explanation, suggestedFix }`. `suggestedFix` is a deterministic templated sentence ("Chapter 10 says John's eyes are green; Chapter 1 (and the character bible) establish blue — reconcile."), **not** an LLM rewrite. The engine is a pure function of (ledger, new facts) → findings — fully unit-testable with fixtures, no network.

## Canon seeding

Reuse the extractor against the book's bible sources, marking `source = canon`:
- **World Repository** `worldDocs` (when a world is bound) → `world`-keyed, shared.
- **Series worldbuilding** (`characters`/`places`/`lore`) and any **character notes** → `book_slug`-keyed (or `world`-keyed if it belongs to a shared world).
Canon facts default to `immutable`. A content hash over the sources drives re-seeding; unchanged sources skip extraction.

## API & orchestration

- `POST /api/books/:slug/consistency-audit` — async (mirrors `continuity-check`): ensure canon seeded → per-chapter extract/check/merge → store report → emit `consistency-progress` / `consistency-complete` / `consistency-error` over Socket.IO. Returns `{ status: 'started', slug }`.
- `GET /api/books/:slug/consistency-report` — the stored findings, grouped by category + severity, with chapter refs, quotes, and suggested fixes; plus run metadata (chapters scanned, fact counts, elapsed, model). Read-only in v1.

These live in a new `gateway/src/api/routes/consistency.routes.ts`; the engine + store live in `gateway/src/services/consistency/` (split: `fact-store.ts` SQLite, `check-engine.ts` pure rules, `extractor.ts` LLM pass + parsing, `audit.ts` orchestration). Schema-gated/fail-soft per the repo's conventions.

## UI (studio)

A **Consistency** panel on the book (in `BookDrawer` or a dedicated route): a **Run audit** button → live progress → the findings report grouped by severity, each finding showing the two locations (chapter links + quotes), the explanation, and the suggested fix. v1 is read-only review. (Per-finding "apply fix" is a follow-on, gated through the existing confirmation gate + snapshot.)

## Relationship to the existing continuity engine

The existing `context-engine.ts` `runContinuityCheck` is entity-index-based, bound to the **old project model**, LLM-driven for the check, and limited to character + timeline. This feature supersedes it for the **book-container** model with a broader, deterministic, fact-ledger approach. v1 ships as a **new, separate** system and does not modify the old engine; consolidating or retiring the old path is a later cleanup, not part of this spec.

## Testing

- **Unit — `check-engine.ts` (no LLM, fixture-driven):** immutable mismatch → Contradiction; stateful change with transition → no flag; stateful change without transition, small gap → Continuity error; unknown gap → Review; same-scene incompatible values → Impossibility; manuscript-vs-canon mismatch → Canon divergence; alias resolution unifies `John`/`Marsh`/`he`.
- **Unit — `fact-store.ts`:** insert/query scoped by `(world, book_slug)`; idempotent per-book rebuild deletes + replaces; world canon shared across two books; index-backed lookup returns the right prior facts.
- **Extractor:** parsing of a fixture JSON response into typed facts (pure parse test); the live LLM extraction is covered by the real-call feature smoke, not a unit test.
- **Smoke (`tests/consistency-smoke.sh`):** seed a tiny world + a 2-chapter book with a planted eye-color contradiction and a planted clothing-reset (legitimate, with a shower) → run the audit → assert the contradiction is reported and the legitimate reset is **not** flagged. Hermetic; cleans up.

## Build phasing (for the plan)

1. **Fact-ledger core** — `fact-store.ts` (SQLite schema + scoped CRUD + idempotent rebuild) and `check-engine.ts` (pure deterministic rules). Fully unit-tested with fixtures, **no LLM, no routes**. This is the reusable heart (also feeds the future inline mode).
2. **Audit pipeline** — `extractor.ts` (LLM pass + story clock + parsing), `audit.ts` (canon seeding + per-chapter orchestration), the two API routes, the smoke test.
3. **Studio report UI** — the Consistency panel.
4. **(Follow-ons, separate specs)** per-finding apply-fix; during-generation inline auto-fix mode; the DB-maintenance item.

## Out of scope (v1)

- LLM-based fix/rewrite of prose (auto-fix). v1 reports + suggests only.
- The during-generation inline mode (shares the core; separate work).
- Arbitrary uploaded non-book documents (book-container input only).
- Consolidating/retiring the old `runContinuityCheck`.
- DB lifecycle maintenance (its own TODO).

## Constraints

- Node 22+, TypeScript via `tsx`; `.js` import extensions (NodeNext). `better-sqlite3` already a dependency; fail-soft if unavailable. DB at `BOOKCLAW_DB_DIR`.
- Fail-soft init/runtime (`✓ / ⚠ / ℹ`); deterministic check path; the LLM appears only in extraction.
- `commit_message` + `./push.sh` workflow; work on `main`; professional Markdown, no emojis.
- Surgical, pattern-matching changes; reuse the `memory-search` SQLite + `BOOKCLAW_DB_DIR` patterns.
