# Continuity and Consistency

## What it is

BookClaw runs a layered continuity-and-consistency system that watches your manuscript for the kinds of errors that survive every read-through: an eye colour that changes between chapters, a character who knows a secret before they were told it, a magic rule that quietly contradicts itself, a mystery the opening promised but the climax never paid off, or a fact in book seven that disagrees with book two.

It is built from five cooperating layers, each solving a different problem:

1. **Context Engine** — per-chapter summaries and an entity index that travel with a project and feed future chapters.
2. **Continuity check** — a project-level, AI-driven scan over those summaries and entities (character, timeline, setting, naming).
3. **Consistency Auditor** — a per-book SQLite **fact ledger**: every checkable fact is extracted, typed, normalized, and time-stamped, then checked **deterministically** against the accumulated ledger and your seeded canon.
4. **The continuity-engine expansion** — three additions to the auditor: a **Character Knowledge Matrix** (who knows what, when), **Selective Exclusion** (dream/flashback/hypothetical scenes are exempt), and a **red-herring inverse-warning** (do not "fix" intentional misdirection).
5. **Plot Promises** and the **Series Bible** — Sanderson-style promises-and-payoffs tracking, and cross-book entity dedup plus contradiction detection across a whole series.

The design principle that runs through layers 3 and 4: **the LLM only extracts; every check is deterministic.** The model reads prose and emits typed facts; the comparison that flags a contradiction is plain code with no model in the loop, so the same manuscript always produces the same findings.

## Why it matters

Continuity errors are the most common reason a finished draft reads as amateur, and they are the hardest for an author to catch — your brain fills in what you *meant* to write. The deeper problem is that ordinary "AI proofreaders" re-read the whole book and guess; they are non-deterministic, they miss things across long spans, and they cannot reason about a story clock or about who learned what when.

BookClaw's auditor instead builds a structured record of every fact, stamps it on a story timeline, and checks new facts against that record by lookup. That makes it possible to catch errors no single-pass reader can:

- An **immutable** attribute (eye colour, species, a long-healed scar) that changes — flagged as a **contradiction**.
- A **stateful** attribute (clothing, location, a wound) that changes with no stated cause and no time elapsed — a **continuity** error; but a legitimate change (a shower, a healed wound over weeks) is *not* flagged.
- Two incompatible values at the **same point in story time** — an **impossibility**.
- A manuscript fact that diverges from your **canon** (World Repository docs or series worldbuilding) — a **canon-divergence**.
- A character who **uses** knowledge before any in-story moment where they **acquired** it — a **knowledge-violation**.

And it knows what to leave alone: a dream sequence's impossibilities, a flashback's old state, and an intentional red herring are all treated correctly instead of being "corrected."

## How to use it

### Context Engine (automatic, per project)

The Context Engine runs in the background as a multi-step writing project produces chapters. After each chapter it stores a summary (key events, characters, locations, a timeline marker, plot threads, ending state) and merges named entities into a per-project index. Later chapters are written with the relevant slice of this context injected into the prompt, so the agent already knows where things stand and who is in the scene. You do not invoke this directly — it is what makes the later checks possible.

### Continuity check (project-level)

Run a four-phase continuity scan over a project's summaries and entity index:

- **Studio:** open a project and run the continuity check from its panel; progress streams live and the report is stored.
- **API:**
  - `POST /api/projects/:id/continuity-check` — starts the scan asynchronously and returns immediately. Progress and completion arrive over Socket.IO as `continuity-progress`, `continuity-complete`, and `continuity-error`.
  - `GET /api/projects/:id/continuity-report` — returns the last stored report (or `null`).

The report groups issues by `category` (`character`, `timeline`, `setting`, `naming`, `plot_thread`) and `severity` (`error`, `warning`, `info`), each with the chapters involved, the conflicting evidence, and a suggested fix.

### Consistency Auditor (per book)

This is the fact-ledger auditor and the deepest layer. It operates on a **book** (a `workspace/books/<slug>/` container), not a project.

- **Studio:** the **Consistency Auditor** panel (Consistency route). Pick a book, run the audit, and watch progress stream chapter by chapter. Findings are grouped by severity then category, each finding showing the two conflicting references (chapter, scene, quote) or the canon source it diverged from, an explanation, and a suggested fix. The panel is read-only — it reports, it does not auto-edit.
- **API:**
  - `POST /api/books/:slug/consistency-audit` — kicks off the audit asynchronously and returns `{ status: 'started', slug }`. Progress streams over Socket.IO as `consistency-progress`; completion as `consistency-complete` (carrying the report); failures as `consistency-error`.
  - `GET /api/books/:slug/consistency-report` — returns the stored report (`{ report }`, or `report: null` if it has never run).
- **MCP / agent tools:** `continuity_check` and `get_continuity_report`.

Both endpoints return `404` if the book does not exist and `503` if the consistency database is unavailable (see *Under the hood*).

The audit is **idempotent** — re-running clears that book's manuscript facts and rebuilds them, so you can run it repeatedly as you revise. The report includes `chaptersScanned`, `factCount`, `knowledgeEventCount`, and `nonCanonicalSceneCount` alongside the findings.

#### Selective Exclusion (dreams, flashbacks, hypotheticals)

Not every scene is "true." A dream, a vision, a flashback, or a hypothetical ("if he had…") states things that are deliberately not the story's present reality. The auditor flags each scene with a `canonical` boolean:

- **Auto-detection:** the extractor marks dream / vision / hallucination / flashback / counterfactual scenes as non-canonical (and defaults to canonical when unsure).
- **Author override:** drop a `data/.non-canonical.json` file in the book container mapping a chapter file stem to a boolean (`true` = canonical, `false` = excluded). The override **wins** over auto-detection and travels with the book.

Non-canonical facts are stored but **excluded from the check both ways** — they are not used as priors (so a flashback's old state can't masquerade as current truth) and not checked as subjects (so a dream's impossibilities don't generate noise).

#### Character Knowledge Matrix (who knows what, when)

The same extraction pass records **knowledge events**: when a character *acquires* a fact (is told it, witnesses it, or deduces it) and when they *use* it (state it or act on it). A separate deterministic check then flags any **use** by a character who has no **canonical** acquisition of that fact at an earlier-or-equal point in story time. A secret learned only in a dream does not count as having learned it.

Severity scales with how egregious the leak is: no acquisition at all, or an explicit verbal reference to knowledge never gained, is **high**; acting on un-acquired knowledge is **medium**. These appear as `knowledge-violation` findings in the same report.

### Plot Promises (promises and payoffs)

Brandon Sanderson's "promises and payoffs" framework, made operational. The opening chapters implicitly promise the reader things — a mystery, a romance, a confrontation, a magic rule that will be tested. Every promise wants a payoff.

- **Extract** promises from the opening: `POST /api/projects/:id/plot-promises/extract`. By default it uses your first 1–3 completed chapters; pass `openingText` in the body to override. Each promise has a category (`mystery`, `romance`, `confrontation`, `transformation`, `world_revelation`, `consequence`, `reunion`, `magic_rule`, `red_herring`, `other`), a confidence, and a status.
- **Review and edit:** `GET /api/projects/:id/plot-promises` lists them; `PATCH /api/projects/:id/plot-promises/:promiseId` edits one; `POST /api/projects/:id/plot-promises` adds your own; `DELETE /api/projects/:id/plot-promises/:promiseId` removes one.
- **Audit:** `GET /api/projects/:id/plot-promises/audit?progress=<pct>&riskThreshold=<pct>`. Near the end of the manuscript (default: at 80% progress) it flags still-open promises as **at-risk** so you can pay them off in the climax, mark them intentionally unpaid, or accept the dropped thread. It never blocks completion and never auto-rewrites.
- **MCP / agent tools:** `extract_plot_promises`, `get_plot_promises`, `audit_plot_promises`.

#### The red-herring inverse-warning

A deliberate red herring is *supposed* to look like an unresolved promise — "fixing" it would ruin the misdirection. When the payoff detector decides a `red_herring` promise has been "paid off," it does **not** close it. Instead it records `redHerringResolvedAtChapter` and surfaces a `redHerringWarnings` entry in the audit, so revision warns you rather than erasing intentional craft.

### Series Bible (across books)

For multi-book series, the Series Bible merges the per-project entity indexes into one canonical view with alias-based **deduplication**, per-book deltas, and cross-book **contradiction detection** (attribute, timeline, plot, location). It is how the agent remembers a background character's eye colour from book two while you write book seven.

- **API:** `GET /api/series/:id/report` builds the merged report; `GET /api/series/:id/divergence/:slug` reports one book's divergence from the series.
- **MCP / agent tools:** `get_series_report`, `get_series_divergence`, `get_series_worldbuilding`.

## Under the hood

Key files, by layer:

- **Context Engine** — `gateway/src/services/context-engine.ts`. Per-project summaries + entity index (`workspace/context/<projectId>.json`), the relevant-context builder used during writing, and the four-phase `runContinuityCheck`. Project routes: `gateway/src/api/routes/documents.routes.ts`.
- **Consistency Auditor** — `gateway/src/services/consistency/`:
  - `types.ts` — `LedgerFact`, `ConsistencyFinding`, `KnowledgeEvent`, and the finding categories (`contradiction`, `continuity`, `impossibility`, `canon-divergence`, `knowledge-violation`).
  - `extractor.ts` — the LLM extraction prompt and the pure `parseExtractorResponse`. Pulls scenes (with the `canonical` flag), typed/normalized/alias-resolved facts, and knowledge events from one chapter.
  - `check-engine.ts` — the deterministic checks: `evaluateFact` (canon divergence → immutable mismatch → impossibility → continuity, with a story-clock `Gap`) and `evaluateKnowledge` (the Knowledge Matrix).
  - `fact-store.ts` — `ConsistencyStore`, the SQLite ledger (`facts`, `knowledge`, `canon_seed`, `audit_reports` tables), with `priorFacts` filtering to `canonical = 1` and indexes on `(world, book_slug, entity, attribute)`.
  - `audit.ts` — `runConsistencyAudit`: chapter selection (`selectChapterFiles` — prose only, highest-stage version, chapter-number order), canon seeding (world-keyed when the book is bound to a World, else book-keyed), story-clock `inferGap`, the `.non-canonical.json` override (`loadNonCanonicalOverride` / `effectiveCanonical`), and report assembly.
  - Routes: `gateway/src/api/routes/consistency.routes.ts`. Wiring: `gateway/src/index.ts` (`consistencyAudit`) and `gateway/src/init/phase-03-soul-memory.ts`.
  - Studio: `frontend/studio/src/routes/Consistency.tsx`.
- **Plot Promises** — `gateway/src/services/plot-promises.ts` (extract / per-chapter payoff detection / audit, stored under `workspace/plot-promises/`). Routes: `gateway/src/api/routes/knowledge.routes.ts`.
- **Series Bible** — `gateway/src/services/series-bible.ts`. Routes: `gateway/src/api/routes/series.routes.ts`.

The consistency ledger is a **SQLite** database (`consistency.db`). By default it lives at `workspace/memory/consistency.db`, but it can be relocated to non-synced local disk via the `BOOKCLAW_DB_DIR` environment variable (or `config memory.dbDir`). It depends on the optional native module `better-sqlite3`; if that module fails to load, the auditor degrades **fail-soft** — the endpoints return `503` and the rest of BookClaw runs unaffected. This mirrors the memory-search posture: optional native dependencies never block startup.

## Related

- [World Repository](./world-repository.md) — the canon your books are checked against; world-bound books seed shared per-world canon.
- [Craft and editorial](./craft-and-editorial.md) — the broader revision and editorial toolset these checks feed into.
- [Series](./series.md) — managing multi-book series, reading order, and shared worldbuilding behind the Series Bible.
