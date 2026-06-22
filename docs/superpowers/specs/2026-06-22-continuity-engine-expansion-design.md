# Continuity Engine Expansion — Design Spec (A + B + C)

**Date:** 2026-06-22
**Status:** Design — approved. Next: implementation plan via `superpowers:writing-plans`.
**Feature-tracking:** `docs/TODO.md` → "★ Deep continuity engine — expand the consistency auditor (item #5)".
**Builds on:** the shipped post-writing consistency auditor (`docs/superpowers/specs/2026-06-22-consistency-auditor-design.md`; code under `gateway/src/services/consistency/`). Handoff context: `docs/superpowers/CONTINUITY-ENGINE-EXPANSION-HANDOFF.md`.

## Problem

The shipped fact-ledger auditor is leg 1 (canon-guard / contradiction) of strategy item #5. Two precision/capability gaps remain, plus an adjacent red-herring gap:

1. **No Selective Exclusion (A).** The auditor false-positives on legitimately non-canonical prose: a flashback (old state differs by design), a dream or hallucination (impossible details), an "if he had…" hypothetical. These are real continuity *signals* the engine must learn to exempt.
2. **No Character Knowledge Matrix (B).** The ledger tracks *what is true*, not *who knows what, when*. A character referencing or acting on information before they could have learned it (a staple bug in mystery / thriller / multi-POV) is invisible to the current engine. This is the headline differentiator.
3. **Red herrings treated as ordinary promises (C).** `plot-promises.ts` already has a `red_herring` category, but the payoff auditor treats a red herring being "resolved" as a healthy payoff — so revision is nudged toward *fixing* intentional misdirection.

## Goal

Extend the existing `extract → typed ledger → deterministic check → story clock` pipeline so the auditor (i) excludes non-canonical scenes from the consistency check, (ii) reports knowledge-timeline violations, and (iii) warns when an intentional red herring looks like it is being paid off. All three preserve the shipped architecture's invariant: **the LLM does only extraction; the check path is deterministic and fully unit-testable.**

## Locked decisions (from brainstorming)

| # | Decision |
|---|----------|
| 1 | Scope = **all three** (A Selective Exclusion, B Knowledge Matrix, C red-herring warning) in one spec. |
| 2 | **A granularity = per-scene** `canonical` flag (default true). Whole-entity exclusion is out of scope. |
| 3 | **A source = both**: extractor auto-detects scene markers **and** an author override; author override wins. The override is keyed by **chapter file stem** (stable), not scene index (a per-run extractor ordinal). |
| 4 | **B fact identity = reuse the ledger fact key** (`entity\0attribute\0value_norm`). A knowledge event references an existing/extracted consistency fact; no separate proposition namespace. |
| 5 | **B precision = explicit-use only + severity tiers** (`high`/`medium`/`low`), mirroring the auditor's existing severity model. No flagging of vague hints. |
| 6 | **B placement = independent**, inside the consistency engine (new `knowledge` table). No coupling to `plot-promises.ts`. |
| 7 | **C = inverse-warning on payoff detect**, made surgically in `plot-promises.ts`; it stays `projectId`-keyed (old project model). Migrating plot-promises to the book-slug model is explicitly out of scope. |
| 8 | **Extraction = single pass.** A and B ride the existing one-LLM-call-per-chapter extractor by extending its JSON contract; no second LLM pass, no added per-chapter cost. |

## A. Selective Exclusion (per-scene `canonical`)

### Data model

- `facts` table: add column `canonical INTEGER NOT NULL DEFAULT 1`. The `DEFAULT 1` makes the column additive over an existing DB (a fresh `consistency.db` is cheap to rebuild anyway, but the default keeps any pre-existing rows valid).
- `LedgerFact`: add `canonical: boolean`. The `ExtractedScene` shape gains `canonical: boolean`. Each fact inherits its scene's `canonical` value.

### Two sources, combined (author override wins)

1. **Auto-detect (extractor).** The extractor returns a `canonical` boolean per scene, inferred from prose markers: dream / vision (`"she dreamed that…"`, `"in the dream"`), flashback / analepsis (`"years earlier"`, `"she remembered…"`), hypothetical / counterfactual (`"if he had…"`, `"imagine if"`), and explicit unreliable-narrator / hallucination cues. Computed fresh each audit run, so there is **no persistence-key problem**.
2. **Author override.** A sidecar JSON file in the book container: `data/.non-canonical.json`, shape `{ "<chapter-file-stem>": false, … }` (a value of `false` marks the chapter non-canonical; `true` forces canonical, suppressing a false auto-detect). Keyed by chapter **file stem** (e.g. `chapter-03-write`), which is stable across runs. An override applies to **all scenes in that chapter** and wins over auto-detect in either direction. The file travels with the book container (backed up / shared with it). Absent or malformed file → no overrides (fail-soft).

Resolution per scene: `canonical = override[chapterStem] ?? autoDetected`.

### Check behavior

A non-canonical fact (`canonical = 0`) is **still stored** (so it is auditable and available to the Matrix) but **excluded from the consistency check both as a prior and as a subject**:

- `ConsistencyStore.priorFacts(...)` filters `canonical = 1` — non-canonical facts never serve as priors, so a flashback's old eye-colour can't masquerade as the current truth.
- The `audit.ts` per-fact loop **skips `evaluateFact` for any incoming non-canonical fact** — a dream's impossible details don't generate findings.

The in-memory `entityCurrentState` / `entityAliases` digest is updated only from **canonical** facts, so the known-entity digest fed to later chapters reflects the real timeline, not dream/flashback state.

## B. Character Knowledge Matrix

### Data model — new `knowledge` table (same `consistency.db`, separate from `facts`)

| column | meaning |
|---|---|
| `id` | pk |
| `world` | world name (mirrors `facts`, for scoping); else `NULL` |
| `book_slug` | the book; `NULL` only for shared canon (knowledge is manuscript-only in v1, so always set) |
| `knower` | resolved canonical entity name (the character) |
| `fact_key` | `entity\0attribute\0value_norm` — references the consistency fact this knowledge is *about* |
| `kind` | `acquire` \| `use` |
| `source` | `told` \| `witnessed` \| `deduced` \| `reference` \| `act_on` |
| `story_time` | integer scene-clock ordinal (same clock as `facts`) |
| `chapter` | chapter file stem |
| `scene` | scene index within chapter |
| `canonical` | `INTEGER NOT NULL DEFAULT 1` — a dream/flashback acquisition does not count as real learning |
| `evidence` | short verbatim quote |

Index: `(world, book_slug, knower, fact_key)`. CRUD scoped by `(world, book_slug)`; the per-book idempotent rebuild clears this table for the book alongside `facts`.

### Extraction (same single pass)

The extractor's JSON contract gains a `knowledgeEvents` array. Each event:
`{ knower, factEntity, factAttribute, factValueNorm, kind: "acquire"|"use", source, scene, evidence }`.
- **Acquisitions** come from `X learns / is told / discovers / overhears / witnesses Y`.
- **Uses** come from `X states / references / acts on Y` — **explicit** use only (decision #5). The prompt instructs the model not to emit a `use` for a character merely guessing or for narration the character isn't party to.
The parser composes `fact_key = factEntity\0factAttribute\0factValueNorm` (normalized exactly like `facts`), inherits `story_time`/`canonical` from the event's scene, and coerces unknown `source`/`kind` values to safe defaults (drop the event if `knower` or `fact_key` is empty).

### Deterministic check — new category `knowledge-violation`

Runs **after** A's canonical flags are resolved for the book. For each `use` event by a knower:

1. Gather that knower's **canonical** `acquire` events for the same `fact_key`.
2. Let `firstAcquire = min(story_time)` over those acquires.
3. **Flag when** there is no canonical acquire at all, **or** `use.story_time < firstAcquire`.

Severity:
- `high` — the use `source` is `reference` and the evidence states the fact outright (the character *says* the secret); or no acquire exists anywhere.
- `medium` — the use `source` is `act_on` (acts on knowledge they lack).
- `low` — borderline / allusive; downgraded to review.

A finding reuses the existing `ConsistencyFinding` shape: `category: 'knowledge-violation'`, `entity = knower`, `attribute = the fact's attribute`, `a = the use ref`, `b = the (missing or later) acquire ref or a synthetic "never learned" note`, with a templated `explanation` + `suggestedFix` (e.g. *"Elena references that her father is the killer in chapter-04 but is not shown learning it until chapter-09 — move the reveal earlier or cut the reference."*). No LLM in this path.

### Ordering

`knowledge-violation` evaluation is a **second deterministic pass** over the book's collected knowledge events, executed after the per-chapter fact loop completes (so all acquisitions across the whole book are known before any use is judged, and canonical flags are final). A character can legitimately *use* knowledge acquired in a **later chapter only if** the story clock places the acquisition earlier — the check is on `story_time`, not file order.

## C. Red-herring inverse-warning (`plot-promises.ts`)

No data-model change — `red_herring` category and `intentionally_unpaid` status already exist. In the payoff-detection path, when the chapter-payoff detector returns `paid_off` or `partial_payoff` **for a promise whose `category === 'red_herring'`**, do **not** record it as a healthy payoff. Instead emit a warning finding into the promise-audit report:

> *"Chapter N appears to resolve an intentional red herring (`<title>`). Confirm this isn't accidentally 'fixing' deliberate misdirection; if the misdirection is intended, leave it `intentionally_unpaid`."*

The promise's status is left for the author (not auto-set to `paid_off`). Keyed by `projectId` as today. The book-slug model mismatch with the consistency engine is **noted and out of scope**; no fact-ledger coupling.

## Report & API

- **No new routes for A/B** — they ride the existing async `POST /api/books/:slug/consistency-audit`.
- `GET /api/books/:slug/consistency-report` returns the new `knowledge-violation` findings folded into the existing category/severity grouping (the studio Consistency panel renders them with no structural change — a new category label). Run metadata gains `knowledgeEventCount` and `nonCanonicalSceneCount`.
- **C** surfaces through the existing plot-promise audit report (a new warnings list), not the consistency endpoints.

## Studio UI

The existing read-only Consistency panel already groups findings by category + severity; `knowledge-violation` appears as a new category heading with the same finding card (two locations, explanation, suggested fix). No new panel. The red-herring warnings appear in the existing promise-audit surface. Minimal/no frontend structural change.

## Testing (TDD — write failing tests first)

**`check-engine.ts` units (no LLM, fixtures):**
- Non-canonical incoming fact → **not** evaluated (no finding) even when it contradicts a prior.
- Non-canonical fact → **not** returned by `priorFacts`, so it never serves as a prior (a later canonical fact contradicting the *real* prior still flags; contradicting only the dream value does not).
- Knowledge: `use` with no canonical `acquire` anywhere → flag (high).
- Knowledge: `use.story_time < firstAcquire.story_time` → flag.
- Knowledge: `use.story_time >= firstAcquire.story_time` → no flag.
- Knowledge: only a **non-canonical** (dream) acquire exists before the use → still flags (dream ≠ learning).
- Severity tiers: `reference`/outright → high; `act_on` → medium.

**`fact-store.ts` units:**
- `canonical` column round-trips on insert/select.
- `priorFacts` filters `canonical = 0`.
- `knowledge` table insert/query scoped by `(world, book_slug)`; idempotent per-book rebuild clears both `facts` and `knowledge`.

**`extractor.ts` parser units (pure parse, no network):**
- `sceneCanonical` parses into `ExtractedScene.canonical` (default true when absent).
- `knowledgeEvents` parse into typed events; `fact_key` composed correctly; malformed events dropped.

**`plot-promises.ts` unit:**
- A `red_herring` promise with a `paid_off` detection yields the inverse warning and does **not** set status to `paid_off`.
- A non-red-herring `paid_off` detection behaves exactly as before (regression guard).

**Smoke (`tests/consistency-smoke.sh` extension), real LLM, hermetic:**
- Add a **dream scene** asserting an impossibility (e.g. the protagonist flying) → assert it is **NOT** flagged (Selective Exclusion works end-to-end).
- Add a character **stating a secret before learning it** → assert a `knowledge-violation` is reported.
- Keep the existing planted eye-colour contradiction + legitimate clothing reset assertions (regression). Cleans up after itself.

## Build phasing (for the plan)

1. **Fact-ledger core extensions (no LLM, no routes):** `facts.canonical` column + `priorFacts` filter; the `knowledge` table + CRUD + idempotent rebuild; `check-engine.ts` knowledge-violation rule + canonical exclusion. Fully unit-tested with fixtures. *This is the reusable deterministic heart.*
2. **Extractor contract + audit orchestration:** extend the extractor prompt + parser for `sceneCanonical` and `knowledgeEvents`; load `data/.non-canonical.json` override; wire the canonical resolution + the second knowledge pass into `audit.ts`; extend report metadata.
3. **Red-herring warning:** the surgical `plot-promises.ts` change + its unit.
4. **Smoke test extension** and (if needed) the studio category label.

## Out of scope (v1)

- Whole-entity (vs per-scene) exclusion.
- A separate proposition/secret namespace for the Matrix (reuse the fact key).
- LLM-based auto-fix of any finding (report-only, consistent with the shipped auditor).
- Migrating `plot-promises.ts` to the book-slug model.
- Reader-knows-vs-character-knows distinction beyond the knower timeline (a later enhancement).
- A second LLM extraction pass (single pass only).

## Constraints

- Node 22+, TypeScript via `tsx`; `.js` import extensions (NodeNext). `better-sqlite3` already a dependency; fail-soft if unavailable (mirrors the shipped store). DB at `BOOKCLAW_DB_DIR`.
- Fail-soft init/runtime (`✓ / ⚠ / ℹ`); deterministic check path; the LLM appears only in extraction.
- `commit_message` + `./push.sh` workflow; work on `main`; professional Markdown, no emojis.
- Surgical, pattern-matching changes; reuse the shipped consistency patterns and the `memory-search` SQLite + `BOOKCLAW_DB_DIR` conventions.
