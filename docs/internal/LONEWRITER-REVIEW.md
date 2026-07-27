# LoneWriter — Review and BookClaw Integration Plan

**Date:** 2026-06-20
**Source repository:** https://github.com/sergio-snchez/LoneWriter
**License:** MIT (permissive — referenceable with attribution)
**Status:** Assessment + plan. Nothing imported yet. (This is the "LoneWriter" tagged on the Novelmint comparison page that had no GitHub link there.)

---

## 1. What LoneWriter is

A polished, **100% local-first, privacy-first** browser writing app (React + Vite + Dexie/IndexedDB, PWA). Your manuscript and compendium live only in the browser; AI is bring-your-own-key direct to the provider; a local RAG engine runs in-browser. It is a well-executed product, but for BookClaw's purposes it mostly **corroborates** the existing direction (entity tracking + continuity linting + RAG ambitions) rather than introducing a big new concept like the NPE (narrative_engine) or the Character Knowledge Matrix (Claude-Code methods batch).

---

## 2. Findings — feature-by-feature vs. BookClaw

| LoneWriter feature | BookClaw status |
|---|---|
| **Oracle** — real-time, paragraph-by-paragraph continuity linter vs. the bible (dead character reappears, object changes owner, "elf -> human") | BookClaw has `continuity_check` / continuity reports (batch). Real-time/inline is a UX refinement |
| **Selective Exclusion** — exempt chosen entities/scenes from coherence analysis (dreams, flashbacks, unreliable narrator) | **Net-new** — BookClaw has no scene-level continuity exemption |
| **MPC** ("Compendium Proposal Monitor") — live entity auto-detection while writing + one-click "add to compendium" | BookClaw's Context Engine extracts entities post-hoc; the *live, one-click-add* is a UX refinement |
| **Local RAG** — in-browser semantic search + entity detection via Transformers.js (`all-MiniLM-L6-v2`) | Reinforces the deferred "semantic memory" idea (BookClaw's `memory-search` is FTS5 keyword/BM25) |
| **Nexus** — 2D/3D knowledge graph of bible entities + relationships + a chronological scene timeline (react-force-graph + Three.js + vis-timeline) | Relates to the MirrorShard graph-canvas TODO, but for the *bible/entities*, not idea brainstorming |
| **Debate System** — multiple AI agents debate a scene over configurable rounds | BookClaw has parallel-evaluator "juries" + the Council-of-LLMs pipeline; multi-round debate is a minor variation |
| **Magic Autocomplete** — AI scans the novel to auto-fill a bible entry's description/traits/relationships | Minor; BookClaw could do this from the Context Engine |
| Knowledge Base file upload (TXT/MD/CSV/JSON as AI context) | BookClaw has `workspace/documents/` |
| Local-first / IndexedDB / PWA / Drive sync / multilingual / Zen / themes / DOCX export | Covered by BookClaw equivalents or N/A |
| Roadmap: Pacing Analysis, EPUB/PDF export, peer-review | `pacing_heatmap` exists; EPUB/PDF mostly exists; peer-review is a minor gap |

---

## 3. The takeaways worth recording

### 3.1 Selective Exclusion (net-new, cheap — the one real find)

LoneWriter lets the author mark Compendium entities **or scenes** as **exempt from coherence analysis**, so a dream, flashback, hallucination, or unreliable-narrator scene does not trip false continuity violations. This is a small, smart addition that materially improves any continuity checker: a per-scene "do not continuity-check this against canon" flag.

It pairs directly with the **Character Knowledge Matrix** continuity work already on the TODO — those checks risk exactly the false positives Selective Exclusion prevents (a "dead" character appearing in a flashback, a secret "known" by a character only in a dream sequence).

### 3.2 Local embeddings prove lightweight semantic RAG is viable (reinforcement)

LoneWriter runs `all-MiniLM-L6-v2` embeddings **fully in-browser** via Transformers.js for semantic search and entity detection. This is concrete evidence that the deferred "hybrid semantic memory" idea (flagged in the AI_NovelGenerator review, where BookClaw's `memory-search` was noted as FTS5-keyword-only) is **more feasible than previously weighted** — a small local embedding model is enough; a heavyweight vector DB is not required.

### 3.3 UX refinements (strengthen existing TODOs)

- **Live entity auto-detect + one-click add** (MPC) — a lower-friction version of BookClaw's post-hoc entity extraction; note under the Context-Engine / Knowledge-Matrix work.
- **Nexus bible knowledge-graph visualization** (entities + relationships + timeline) — note under the MirrorShard graph-canvas TODO as the "visualize the bible" variant (distinct from MirrorShard's "brainstorm ideas" graph).

---

## 4. What to skip

The architecture and the bulk of the feature set are already covered by BookClaw: continuity reports, entity tracking, multi-agent critique (parallel evaluators + Council pipeline), document context, DOCX export, pacing analysis (`pacing_heatmap`), and provider routing. Local-first/PWA/Drive-sync/i18n/themes are product-shape choices, not capabilities to port.

---

## 5. Integration plan (lightweight — extends existing work)

1. **Selective Exclusion** — add a per-scene (and per-entity) "exclude from continuity analysis" flag, honored by `continuity_check` / the continuity report and by the planned Character Knowledge Matrix check. Default off; the author marks dream/flashback/unreliable scenes. Small, high-precision win.
2. **Fold the reinforcement into the semantic-memory note** — when the deferred hybrid-semantic-memory idea is revisited, cite LoneWriter's in-browser MiniLM approach as evidence a lightweight local model suffices.
3. **Note the UX refinements** on the Context-Engine / Knowledge-Matrix and MirrorShard-graph TODOs (live one-click entity add; bible knowledge-graph view) — no separate effort; adopt if/when those features are built.

There is no large standalone build here. The actionable item is **Selective Exclusion** (best done alongside the Character Knowledge Matrix / continuity work); the rest is corroboration and refinement notes.

---

## 6. Open questions

- **Exclusion granularity:** per-scene flag, per-entity flag, or both? Both is most flexible (a scene marked "dream" exempts everything; an entity marked "non-canonical" exempts just that entity) — start per-scene, which covers the common dream/flashback case.
- **Where it lives:** a field on the scene/chapter metadata that the continuity services read — keep it data-driven so it travels with the book container.
