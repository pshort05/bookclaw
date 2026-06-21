# Narrative Engine — Review and BookClaw Integration Plan

**Date:** 2026-06-20
**Source repository:** https://github.com/pshort05/narrative_engine (MIT)
**Status:** Assessment + plan. No code or assets imported yet.

---

## 1. What `narrative_engine` is

A Claude-Code-orchestrated, eleven-step book **design (planning)** workflow. Claude Code acts as the orchestrator and spawns specialized subagents (via the Task tool) for each stage, passing each step's outputs forward to the next. It is a *planning* system — it ends at a polished, QA-checked outline; it does not draft prose.

The eleven steps (`workflow_config.json`):

1. **NPE Extraction** — analyse an existing outline to extract the author's generic structural preferences into a Narrative Physics Engine (NPE).
2. **Dramatic Spine** — the story's tension architecture (1–3 primary tension axes, secondary axes, dominant energy, emotional progression; supports dual-genre).
3. **Theme Extraction** — themes expressed as *questions*, not statements (one main, up to two secondary).
4. **Character Development** — per-character profiles from templates; spawns one subagent per character (parallel).
5. **World Constraints** — *functional* limits (geography/culture/resources/power) that force better plotting; not a travel guide.
6. **Relationship Mapping** — identify the plot-driving relationships.
7. **Relationship Architecture** — per-pair relationship specs that evolve across three acts; one subagent per relationship (parallel).
8. **Premise Refinement** — re-ground the premise in all the established constraints.
9. **Story Outline** — synthesise everything into a three-act outline.
10. **NPE Inspection** — rigorous rule-by-rule QA of the outline against the NPE.
11. **Outline Rewrite** — rebuild the outline to full NPE compliance based on the inspection report.

Supporting assets: four agent personas (`.claude/agents/`: `npe-extractor`, `story-architect`, `character-architect`, `scene-designer`), prompt templates (`prompts/step1..step11`), a character/NPE template set (`templates/`), and a per-project `workflow_state.json` state machine for cross-chat resume.

---

## 2. The standout idea: the Narrative Physics Engine (NPE)

The NPE is the most valuable and genuinely novel element for BookClaw. It is an **author-level, book-agnostic rulebook of structural "physics"** — written as **positive constraints** (functional prohibitions framed as what *must* be true rather than what must not), so the rules are actionable by an AI during outlining and drafting.

The template (`templates/npe_template`) has eleven sections:

1. Causality & Plot Logic
2. Character Action & Decision Physics
3. Dialogue Physics
4. Pacing & Time Mechanics
5. POV & Emotional Logic
6. Information Economy
7. Genre-Alignment Rules (filled per novel)
8. Resolution Scope & Closure Physics
9. Series Architecture & Multi-Book Logic (three-tier: Book Question / Series Question / Romance Arc)
10. Intimacy Progression & Pacing (adult romance)
11. Theme & Transformation Physics

Example of the framing: *"No event may remove a major obstacle unless a character takes action that directly causes the removal. External salvation is structurally impossible. Coincidences are allowed only when they increase pressure, worsen conflict, or reduce options — never to resolve problems."*

It is paired with a **compliance loop**: extract the NPE once (step 1) -> inject it into every planning step -> **inspect the outline against it (step 10) -> rewrite to comply (step 11)**. That inspect-then-rewrite shape is the same analyze-then-apply pattern already used in the imported editorial suite.

### Why it is additive to BookClaw

The NPE is a **third identity axis** that BookClaw does not currently model:

| Axis | BookClaw asset | Concern |
|---|---|---|
| Identity + prose voice | SOUL / STYLE-GUIDE / VOICE-PROFILE | *who* writes and *how it reads* |
| Genre conventions | genre guide | tropes / beats / reader expectations |
| **Structural physics** | **(none)** | the author's **causality, decision, pacing, and resolution rules** |

It also brings a structural QA mechanism BookClaw lacks (the inspect -> rewrite compliance loop). And it is strongly aligned with the project North Star: it makes "author identity" richer — structure, not just voice — as **configuration, not code**.

---

## 3. Ranked: elements worth pulling

| Element | Value | Maps to BookClaw as |
|---|---|---|
| NPE concept + template | Highest | a new author-profile artifact (`NPE.md`) + the template as a `section`/skill |
| NPE extract + inspect -> rewrite loop | Highest | an `npe-extract` pipeline + an `npe-inspect` -> `npe-rewrite` compliance pipeline |
| The eleven-step planning workflow | High | a `narrative-engine-planning` pipeline/sequence (NPE-aware) |
| Relationship Architecture (per-pair, evolving across three acts) | High (distinctive) | a `book_bible` step + skill; deeper than the current character bible |
| Distinctive prompts: dramatic spine, themes-as-questions, functional world constraints | High | steps in the planning pipeline |
| Agent personas (npe-extractor, story-architect, character-architect, scene-designer) | Medium | `editor`/skill assets |
| Character templates (main/secondary) | Medium | `section`/skill assets |

---

## 4. What to skip (BookClaw already covers it, often better)

- **The orchestration runtime** (Claude-Code Task tool, `.claude/agents` spawning) — BookClaw's ProjectEngine + pipeline sequences already orchestrate.
- **`workflow_state.json` state machine / resume / `depends_on`** — BookClaw's engine already does step state, resume, and `parallel` groups with barriers (more capable than this).
- **`/create-project` command + `input/outputs` directories** — the per-book container replaces these.
- **Per-character / per-relationship parallel fan-out with `output_pattern`** — a good idea, but BookClaw has no per-arbitrary-item loop (only `expand:chapters`); the equivalent was flattened into single `book_bible` passes when porting StoryHacker. Matching it is an engine change, not a port.

---

## 5. Integration plan

### Phase 1 — Data-only drop-ins (no code change; same mechanism as the n8n imports)

All of these are `library/` assets that reference "the author's NPE in your context," so they work before any engine wiring.

1. **NPE template -> `section` (or `skill`) asset** — ship `templates/npe_template` as a starting-point Narrative Physics Engine an author can copy and customise.
2. **`npe-extract` pipeline** — analyse a supplied existing outline/manuscript and emit the author's NPE (generic, reusable; not story-specific). Ported from `prompts/step1_npe_extraction.md` + the `npe-extractor` persona.
3. **NPE compliance pipeline** — `npe-inspect` (rule-by-rule QA of an outline against the NPE) -> `npe-rewrite` (rebuild to compliance). Ported from `prompts/step10` + `step11`. Two steps, analyze -> apply, exactly like the editorial suite.
4. **`narrative-engine-planning` pipeline** — steps 2–9 (dramatic spine -> themes -> characters -> world constraints -> relationship mapping -> relationship architecture -> premise refinement -> outline), then the compliance loop. Distinctive sub-pieces to preserve: dramatic spine, themes-as-questions, functional world constraints, and the per-pair relationship architecture.
5. **Agent personas -> `editor` assets**; **character templates -> `section` assets**.

Phase 1 is the same low-risk, fan-out-and-validate workflow already used for the StoryHackerAI / MSF / editorial imports.

### Phase 2 — Wire the NPE into the author profile (one focused code change, high payoff)

Make `NPE.md` a first-class member of the author-profile bundle so it is auto-injected into every generation step, the way SOUL / STYLE-GUIDE / VOICE-PROFILE already are.

- Add `NPE.md` to the author-profile file set (the author library entry, alongside `SOUL.md` / `PERSONALITY.md`).
- Compose it into the system prompt in `SoulService.composeForBook` (the same path that injects SOUL/STYLE/VOICE), so every planning and production step is NPE-constrained automatically.
- With that in place, the `npe-inspect` -> `npe-rewrite` loop has a first-class source, and the NPE becomes a real author-identity axis rather than a document an author pastes in.

This is the change that advances the multi-author North Star (author identity = configuration), and it is small and well-bounded (one new optional file + one composition site).

### Phasing recommendation

Do **Phase 1** first (drop-in assets, immediately usable), then scope **Phase 2** (`SoulService` wiring) as its own change. The relationship-architecture step and the dramatic-spine / themes-as-questions / world-constraints prompts come in with the Phase-1 planning pipeline.

---

## 6. Open questions / decisions before building

- **NPE home:** carry it as a per-author `NPE.md` (recommended; Phase 2) or as a standalone reusable `section`/skill that pipelines reference (Phase 1 only)? Phase 1 works with the latter; Phase 2 promotes it to the former.
- **Overlap with existing assets:** NPE sections 9 (series) and 10 (intimacy) overlap somewhat with the genre guides and the romantasy pipeline's spice rules. Keep the NPE framing (author structural physics) and let the genre guide own genre conventions; reconcile any direct contradictions per book.
- **Relationship granularity:** import relationship architecture as a single `book_bible` step covering all key pairs (consistent with the current engine), and revisit per-pair fan-out only if/when a per-entity loop is added to the engine.
