# MirrorShard 2 — Review and BookClaw Integration Plan

**Date:** 2026-06-20
**Source repository:** https://github.com/DroicheadNua/MirrorShard_2
**License:** MIT (permissive — use/modify/redistribute with attribution; the implementation is referenceable, not just the concepts)
**Status:** Assessment + plan. Nothing imported yet.

---

## 1. What MirrorShard 2 is

An open-source, AI-powered "integrated writing environment" / outliner (Tauri + TypeScript + Vite). Its defining surface is a **visual idea-graph "Idea Processor"**: scattered thoughts become **nodes**, joined by labeled **links/arrows** and organized into **groups** (with parent/child hierarchy), and the graph linearizes into a structured Markdown draft. The headline workflow is *graph -> Markdown*: brainstorm as a graph, connect, then "Send to Editor."

This is the first tool in the recent review batch with a **modality BookClaw genuinely lacks** — non-linear, spatial, human-driven ideation — but it comes with a real cost/fit caveat.

---

## 2. Findings — the distinctive elements

### 2.1 The visual idea-graph (the distinctive concept; larger build)

A non-linear canvas with:

- **Nodes** (idea fragments) with a content editor for detailed notes
- **Links** (plain / arrow / bidirectional) with editable labels
- **Groups** (idea clusters) with hierarchy/parenting
- An **outline panel** that mirrors the graph as hierarchical Markdown (`#` groups / `##` nodes / `###` content headings)
- **Send to Editor / Export** — linearize the graph into a Markdown draft (also HTML/PNG/PDF)

Four AI operations run *on the graph*:

| Operation | What it does | In BookClaw today? |
|---|---|---|
| **AI Free Association** | Expand a selected node into ~3 related idea-nodes | Partially (brainstorm mode generates ideas) |
| **Missing Link** | Select the link between two nodes; AI fills the logical/narrative bridge (type can be specified, e.g. character/idea) | No — novel |
| **Node Alchemy** | Fuse multiple selected nodes into one synthesized idea | No — novel |
| **Template Completion** | Context-aware fill inside a story-structure template (uses overall structure + text before cursor) | Partial |

BookClaw's ideation is entirely **linear/text** (chat brainstorm + planning pipelines that brainstorm -> select -> outline). A spatial graph canvas is genuinely additive — it serves the messy pre-outline exploration phase.

**Cost/fit caveat.** The full canvas is a **large frontend build** (node/edge editor, pan/zoom, groups, outline sync, graph<->markdown round-trip) and it serves a **human-driven visual mode that is orthogonal to BookClaw's autonomous-first design**. It is a real idea but a big investment for a non-core workflow.

### 2.2 Story Archetype templates (cheap, additive)

Built-in narrative-structure templates that auto-generate the graph's groups/nodes/connections, then the author fills each node (with AI assist):

- **Actantial Model** (A. J. Greimas role grid: Subject / Object / Sender / Receiver / Helper / Opponent)
- **Hero's Journey** (Campbell)
- **Beat Sheet** (Snyder / Save the Cat)
- **Three-Act Structure**

BookClaw's genre guides already carry "beats" that cover the Three-Act / Beat-Sheet ground, but the **Actantial Model** is a structural lens BookClaw does not have and is the most novel of the four.

### 2.3 The AI graph operations as reusable ideation primitives (the cheap kernel)

The most pragmatic extraction: **Missing Link** and **Node Alchemy** are novel *creative primitives* (bridge two concepts; fuse N concepts into a synthesis) that work over plain text — **no graph UI required**. They can drop into BookClaw's existing brainstorm/chat mode as operations or `prompt`/skill assets.

---

## 3. What is already covered (skip)

| MirrorShard feature | BookClaw equivalent |
|---|---|
| AI image generation (Stable Diffusion / Mistral Agents) | `generate_book_cover` / `generate_image` / cover sets + image providers |
| Distraction-free editor (ZEN, Spotlight, frameless) | v6 studio editor |
| Markdown / HTML preview | studio rendering |
| Multi-provider AI (Gemini/Groq/Mistral/Cohere), local AI | The 6-provider AI router (incl. Ollama, OpenRouter) |
| Export (Markdown/HTML/PDF/PNG) | DOCX/EPUB export + blurb/site export |

---

## 4. Integration plan

### Phase 1 — Cheap kernels (low cost, real ideation value)

1. **Brainstorm primitives: Missing Link + Node Alchemy.** Add two operations to the brainstorm/chat mode (and/or as `prompt`/skill assets):
   - *Missing Link* — given two concepts/ideas, generate the logical or narrative bridge between them (optionally typed: a connecting character, event, theme, or causal link).
   - *Node Alchemy* — given two or more concepts, synthesize them into a single new, unified idea.
   These are text-in/text-out and reuse the existing AI router; no graph UI needed.
2. **Story Archetype templates as assets.** Ship the four archetypes as `section`/skill assets (or planning-pipeline scaffolds): Actantial Model, Hero's Journey, Beat Sheet, Three-Act. Prioritize the **Actantial Model** (the role grid is the genuinely new lens); the others largely overlap the genre-guide beats, so import them only if a structured fill-in scaffold is wanted.

Phase 1 captures most of MirrorShard's creative value with minimal effort and no new UI.

### Phase 2 — Visual idea-graph canvas (larger; future studio feature)

If/when BookClaw wants to support human-driven visual ideation as a first-class front door:

1. **Graph model + storage** — nodes/links/groups persisted per book (a new artifact under the book container), round-tripping to a hierarchical Markdown outline.
2. **Studio canvas** — a node/edge editor (create/drag/link/group, pan/zoom, outline-panel sync). This is the bulk of the work.
3. **Graph AI operations** — wire the Phase-1 primitives plus Free Association (expand a node into N nodes) onto the canvas; "Send to Graph -> Outline" to hand the result to a planning pipeline.
4. **Reference** — MirrorShard is MIT, so its canvas/outline-sync implementation is studyable (with attribution) for the anchoring and graph<->markdown details.

### Phasing recommendation

Do **Phase 1** if/when ideation tooling is a priority — it is low-cost and additive. Treat **Phase 2** (the graph canvas) as a larger, optional studio feature; it is distinctive but heavy and adjacent to BookClaw's autonomous-first core, so it should clear a real product-need bar before being scheduled.

---

## 5. Open questions / decisions before building

- **Mode fit:** does BookClaw want to lean into human-driven, exploratory ideation at all, or stay autonomous-first with chat brainstorming? Phase 2 only makes sense if the former.
- **Archetype overlap:** the genre guides already encode beats; import only the non-overlapping archetypes (Actantial Model) unless a fillable scaffold UX is the goal.
- **Where the primitives live:** brainstorm/chat operations vs. standalone `prompt` assets vs. both (the prompt-asset form is the cheapest first step and is reusable in the Prompt Runner).
