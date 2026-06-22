# World Repository — Design Spec

**Date:** 2026-06-21
**Feature:** World Repository (TODO roadmap ★ top item — see `docs/TODO.md`)
**Process:** superpowers:brainstorming → (next) superpowers:writing-plans

---

## STATUS & HOW TO RESUME (read this first)

**Where we are:** Design brainstorming is complete. All five design sections below were presented to the owner and **explicitly approved** (Sections 1–4 in the prior session; Section 5 approved 2026-06-21). The next step is `superpowers:writing-plans`.

**Implementation plans now exist** (written 2026-06-21 via `superpowers:writing-plans`): see `docs/superpowers/plans/2026-06-21-world-repository-00-index-and-contract.md` (index + shared interface contract) and the six phase plans `…-phase-1-…` through `…-phase-6-…`. The contract's "Resolved reconciliations" section is authoritative on any cross-phase conflict.

**To resume:** execute the plans in order via `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`, starting with Phase 1.

**Owner approvals captured so far:** scope = whole feature; world↔series = Mixed; relevance-pull = hybrid (AI proposes → curate); doc format = per-world config; architecture = **Approach A** (world as a library kind); bible = **curated set (a)**; Sections 1–4 approved.

---

## 1. Summary

A **World Repository** is a per-world collection of structured worldbuilding documents that is the single source of truth for a world. Everything else is a projection of it. It serves three consumers:

- **Book bibles** — composed per novel by pulling in the *relevant subset* of the repository (hybrid: AI proposes, author curates).
- **Novel appendixes** — selected documents render as reader-facing back-matter.
- **Authoring** — an in-world editor persona (the owner's "Luminarch" system) designs/writes new documents in a world-specific format, searching existing docs for continuity.

Worked example throughout: **The Shattered Cradle** world, whose repository is the owner's `Luminarch/` document set, authored via `interactive_luminarch_editor.json` (the Jorin/Kethara persona producing narrative-format Tomb/Codex/Field-Guide/Observations documents with classification codes + clearance levels).

## 2. Requirements & decisions (from the brainstorming Q&A)

| Question | Decision |
|---|---|
| Scope of this spec | **Whole feature** — repository + authoring + relevance-pull + appendix, in one design (each subsystem kept well-bounded). |
| World ↔ Series | **Mixed** — a World is a first-class thing that any number of series/standalone books attach to (many-to-one). World is *not* the same as Series. |
| Relevance-pull mechanism | **Hybrid** — AI proposes a relevant document set (with reasons); author curates; selection saved per book. |
| Document model/format | **Per-world config** — universal base fields, but each world defines its own document-type vocabulary, format/style directive, and authoring persona. |
| Storage architecture | **Approach A** — World is a new library `kind` (reuses overlay, snapshot/re-pull, editor kind, Phase-12 zip share/import). (B = first-class entity like Series, and C = extend series worldbuilding, were rejected — C conflicts with the Mixed answer.) |
| What *is* the bible | **(a) Curated set** — the bible *is* the selected source documents, snapshotted + injected as-is (no lossy synthesis). Optional synthesized "bible brief" as a companion digest. |

---

## 3. Architecture (Approach A)

A new library kind **`world`** sits alongside `author`/`voice`/`genre`/`editor`. It reuses: the library overlay (built-in `library/` + `workspace/library/` overlay), the book-container **snapshot/re-pull** engine, the existing **`editor`** kind (for authoring), and **Phase-12 zip share/import** (a whole world ships as one `.zip`). "Add a world" stays configuration, not code (North-Star aligned).

Add `'world'` to `LibraryKind` (`frontend/shared/src/types.ts:153` + backend `library.ts`).

---

## 4. Section 1 — Data model & storage  *(APPROVED)*

Each world is a folder in the library:

```
worlds/shattered-cradle/
  world.json              # per-world config
  documents/
    fg-geo-0141-geography-of-the-shattered-cradle.md
    cn-shd-001-shard-magic-primer.md
    …                     # one file per repository document
```

**`world.json`** (per-world config — the part that makes types/format world-specific):
```json
{
  "schemaVersion": 1,
  "name": "shattered-cradle",
  "label": "The Shattered Cradle",
  "description": "Earth, three million years after the Great Exodus…",
  "documentTypes": [
    { "id": "tomb", "label": "Tomb", "note": "ancient" },
    { "id": "codex", "label": "Codex", "note": "verified truth" },
    { "id": "field-guide", "label": "Field Guide", "note": "practical" },
    { "id": "observations", "label": "Observations", "note": "personal accounts" }
  ],
  "domains": ["GEO","MAG","TEC","BIO","KNW","HIS","TMP","SHD","MEM"],
  "clearanceLevels": ["General Access","Restricted","Cloister-Only"],
  "classificationScheme": "{TYPE}-{DOMAIN}-{NNNN}",
  "formatDirective": "Narrative prose only, never bullet lists (handwritten/transcribed conceit). Header carries Classification, Distribution, and in-world attribution…",
  "authoringEditor": "luminarch-adept"
}
```

**Each document** = markdown with YAML frontmatter (universal base fields) + narrative body:
```markdown
---
title: The Geography of the Shattered Cradle
type: field-guide              # must be one of world.json documentTypes
classification: FG-GEO-0141
clearance: General Access
domain: GEO
attribution: Compiled by Talen Windwalker; transcribed by Morvin Ironhand
tags: [geography, supercontinent, territories, travel]
summary: A traveler's guide to the transformed world's landscapes and territories.
appendixEligible: true
---

### FIELD GUIDE: THE GEOGRAPHY OF THE SHATTERED CRADLE
…narrative prose…
```

- `summary` + `tags` exist so **relevance-pull reasons over lightweight metadata**, not full bodies (cheap LLM calls).
- `authoringEditor` points at a library `editor` asset → bridge to Section 3.
- **New code:** `world` kind registration, `world.json` parsing (like `pipeline.json`), and **document frontmatter parsing** (the only genuinely new parser).

## 5. Section 2 — Binding + relevance-pull + snapshot  *(APPROVED)*

- **Binding:** `world` becomes a ref alongside `author`/`voice`/`genre` — set on a **series** (inherited by its books) or directly on a **standalone book**.
- **Hybrid relevance-pull:**
  1. Owner triggers "Build bible from world" for a book (at creation or any time).
  2. BookClaw gathers book signals — premise/description, title, genre, known characters/locations (bible/context-engine/data).
  3. Sends the LLM the book signals + the world's **document catalog** (per doc: title, type, summary, tags — *not* bodies); asks which docs are relevant, ranked, each with a one-line reason.
  4. Owner curates the proposed set (check/uncheck, add misses) in the UI; curated list saved on the book as `worldDocs`.
- **Snapshot + re-pull:** on confirm, selected documents snapshot into `books/<slug>/templates/world/` (pinned, copy-on-create) so editing the repo never disturbs an in-flight book; Phase-4 3-way re-pull extends to world docs.
- **Injection:** composed bible feeds `SoulService.composeForBook` / `buildSystemPrompt`, augmenting (eventually replacing) today's single freeform `worldbuilding.lore` blob. Relevance-pull bounds the injected context (dovetails with roadmap #4 importance-tiering).
- **The bible = the curated set (a).** Optional: a generated short "bible brief" digest as a companion (not a replacement).

## 6. Section 3 — Authoring assistant  *(APPROVED)*

Reuse the existing **`editor`** kind. `world.json.authoringEditor` → a library `editor` whose `systemPrompt` *is* the Jorin/Kethara persona (clearance protocols, AI-name warnings, routing = **world config in the persona prompt, not BookClaw core**). New = making an editor session **world-aware**:

1. **Format + taxonomy priming** — inject `world.json` `formatDirective` / `documentTypes` / `clearanceLevels` / `domains` into the editor prompt → drafts follow the narrative-only, classification-headered format.
2. **Continuity awareness** — hand the session the world's **document catalog** (title/type/summary/tags) + on-demand full-doc read ("ALWAYS search project knowledge"). FTS via `memory-search` is a later optimization for huge worlds; the catalog approach needs no new infra.
3. **Write-back** — editor proposes a new/revised document; on **approval** it saves into the world's `documents/` overlay with frontmatter filled and **classification auto-assigned** (next free serial for that `TYPE-DOMAIN` per `classificationScheme`). Approval-gated (owner sees the draft first).

New documents flow to books via re-pull (Section 2). The persona/routing/clearance/name-warnings are the editor asset's prompt — seeded from the owner's Luminarch JSON.

## 7. Section 4 — Novel appendixes  *(APPROVED)*

- **Eligibility:** `appendixEligible: true` frontmatter flag = candidate pool.
- **Per-book selection:** an ordered `appendix[]` of `{ docId, title?, order }`, **independent** of the bible `worldDocs` (a doc can be in one, both, or neither). `title?` overrides the printed heading.
- **Render at the format phase:** each appendix renders as back-matter *after* the manuscript — **title + in-world attribution + narrative body**, with internal **classification/clearance stripped** (world-level render setting; attribution kept for in-world charm). Plugs into `docx-export.ts` / `epub-export.ts` / `kdp-exporter.ts` (appends, never replaces); dovetails with roadmap #6.

Same repository → two outputs: **bible** (internal AI context) and **appendixes** (reader-facing, codes stripped), selected independently per book.

## 8. Section 5 — API, UI, migration, error handling, testing  *(APPROVED)*

**API.** World *entry* (config) rides the library API (`GET/POST /api/library/world[/:name]`). Richer ops in a dedicated `worlds.routes.ts`:
- Documents: `GET /api/worlds/:name/documents` (catalog), `GET …/:docId` (full), `POST` (create + auto-classify), `PUT`, `DELETE`.
- Binding + pull: `world` joins the ref set on book/series create + refs; `POST /api/books/:slug/world/propose` (relevance-pull → ranked + reasons), `PUT /api/books/:slug/world/docs` (save curated → snapshot), `PUT /api/books/:slug/world/appendix`.
- Authoring reuses the editor-session API with a world-context param; appendix render is a step in the existing compile/export path.

**UI (Asset Studio + book).**
- A **World** kind → a **repository browser**: documents grouped by type/domain with classification + clearance badges, search/filter, create/edit (authoring editor available), `world.json` config editor.
- Book / New-Book: a **World picker**; a **"Build bible from world"** panel (AI-proposed docs + reasons → curate); an **Appendix** panel (pick + order back-matter).

**Migration / worked example** (one-time, fan-out-and-validate like prior asset imports):
1. Build the `luminarch-adept` **editor** asset from `interactive_luminarch_editor.json` (persona + format + clearance + name-warnings → `systemPrompt`).
2. Create the `shattered-cradle` **world**: `world.json` from the prompt taxonomy (Tomb/Codex/Field-Guide/Observations, domains, clearance levels, `narrative_format_directive` → `formatDirective`, `authoringEditor: luminarch-adept`); import every `Luminarch/*.md` as a document, parsing existing headers (classification from codes like `FG-GEO-0141`, clearance from `Distribution:`, attribution from the "Compiled by…" line; `summary`/`tags` auto-filled).
3. Set the `world` ref on the existing **The Shattered Cradle** series → books inherit it; run propose/curate to seed their bibles.

**Error handling (fail-soft, matching BookClaw).** Bad frontmatter → "needs attention" load, never crash; relevance-pull LLM failure → fall back to manual full-catalog selection, never blocks creation; missing/deleted world ref → book runs without a world bible (logged); classification auto-assign skips used serials (manual override allowed); `schemaVersion` on `world.json` + documents, gated like other artifacts; snapshot/re-pull reuses the version-gate + 3-way merge.

**Testing.** Unit: frontmatter parser (valid/invalid), `world.json` parser, classification next-serial assignment, relevance-pull shaping with a fake AI, appendix render (codes stripped / attribution kept). Smoke (leave-in-place, like `tests/board-grouping-smoke.sh`): seed a tiny world + 3 docs, attach a book, run propose (cheap real LLM) → curate → snapshot → assert the bible composes and the appendix renders. Runnable against the Neptune writing instance (`http://192.168.1.28:3947`).

---

## 9. Source references (for whoever resumes)

- **Authoring prompt:** `/home/paul/data/Dropbox/Writing/AI-Prompts/ChatPrompts/interactive_luminarch_editor.json` — the Luminarch persona. Key sections: `narrative_format_directive` (the format), `world_knowledge_baseline.document_types` (Tomb/Codex/Field-Guide/Observations), `clearance_level_protocols`, `ai_generated_name_warnings`, `persona`/`kethara_persona`.
- **Repository documents:** `~/data/Writing/shattered-cradle-world/Luminarch/*.md` — ~40 documents; filenames + headers carry type + classification (e.g. `field-guide-for-…`, `luminarch-codex-cn-geo-0042-…`; header `Classification: FG-GEO-0141`, `Distribution: Approved for General Access`, "Compiled by … Transcribed … by …").
- **BookClaw touchpoints:** `LibraryKind` (`frontend/shared/src/types.ts:153`); `library.ts` (kinds, `createEntry`, overlay, `readMetaSidecar`); book-container snapshot/re-pull + `worldbuilding` (`services/book.ts:42`, `BookSelection`); `SoulService.composeForBook` (`services/soul.ts:172`) + `buildSystemPrompt`; series refs/worldbuilding (`api/routes/series.routes.ts`); editor kind (`services/editor.ts`, `ActiveEditor`); export services (`docx-export.ts`/`epub-export.ts`/`kdp-exporter.ts`); Phase-12 transfer (`transfer-security.ts`, `LibraryTransferService`).
- **Where it runs:** the production "writing" instance on Neptune holds the real Shattered Cradle books — see the project memory `writing-instance-neptune.md`. Import/test the world there.

## 10. Open items / next steps

1. **Section 5 final approval** + full owner read of this spec.
2. **Spec self-review** (placeholders / internal consistency / scope / ambiguity).
3. **`superpowers:writing-plans`** → implementation plan. Likely build order: (1) `world` kind + parsers + storage/CRUD; (2) Luminarch migration importer (gives real data fast); (3) binding + relevance-pull + snapshot; (4) authoring (world-aware editor session); (5) appendix render; (6) UI (repository browser + book panels).
4. Minor design refinements deferred to the plan: exact `worldDocs`/`appendix` storage location (book.json field vs sidecar); whether the optional "bible brief" ships in v1; `memory-search` indexing of world docs (later optimization).
