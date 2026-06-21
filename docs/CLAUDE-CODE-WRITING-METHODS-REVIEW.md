# "Claude Code for Novel Writing" Methods — Review and Integration Plan

**Date:** 2026-06-20
**Scope:** A batch of community resources on using Claude / Claude Code as a novel-writing harness. The common thread is "Claude Code as the writing system"; most of the *architecture* (autonomous orchestrator + subagents + state files + delegation) is what BookClaw already is. A few **craft ideas** are genuinely additive — the strongest is corroborated by two independent sources.
**Status:** Assessment + plan. Nothing imported yet.

## Sources reviewed

| Source | Link | License | Notes |
|---|---|---|---|
| The Crucible Writing System | https://github.com/forsonny/The-Crucible-Writing-System-For-Claude | MIT | Claude Code plugin (skills/commands/agents) built on the Crucible Structure |
| Claude-Code-Novel-Writer | https://github.com/forsonny/Claude-Code-Novel-Writer | none (all rights reserved) | Autonomous Claude Code novel engine; overlaps BookClaw |
| "My setup for writing full-length novels with Claude Code" (Medium, osushi) | https://medium.com/@osushi_cr/my-setup-for-writing-full-length-novels-with-claude-code-62d334cde91c | — (article) | Richest source; the knowledge-matrix + anti-pattern-linter ideas |
| "Claude for writing a book" (kenny-kane) | https://kenny-kane.com/claude-for-writing-a-book | — (article) | Standard Claude-Projects book workflow; minor |
| "Story Development with Claude" (intfiction, DavidC) | https://intfiction.org/t/story-development-with-claude-a-methodology-for-authored-interactive-fiction/79033 | — (forum) | Spec-driven AI-as-implementer; the "Gap Conversation" |
| r/WritingWithAI threads (x2) | (Reddit — not fetchable) | — | "Claude Code is great at writing" advocacy; nothing distinctive beyond the above |
| (bonus, surfaced via search) creative-writing-skills | https://github.com/haowjy/creative-writing-skills | — | Not deep-reviewed; pointer for later |

---

## Ranked additive ideas

### 1. Character Knowledge Matrix / "narrative-distance mapping" (top — corroborated twice)

Track, per character, **what they know and when they learn it**, plus **reader-knowledge vs. character-knowledge**, so a character never acts on information they should not possess yet. This appears in **two independent sources**: the Medium setup (its "Foreshadowing Ledger + Knowledge Matrix") and the forsonny repo (its `continuity-editor` agent and `character-knowledge.json` explicitly track "what each character knows when").

**Why additive.** BookClaw's Context Engine (`context-engine.ts`) tracks entity *changes* across chapters, and `plot-promises.ts` tracks foreshadowing/payoff, but neither models a per-character **knowledge state**. This is a new continuity dimension — high value for mystery, thriller, and multi-POV, where "who knows what, when" drives the plot and a violation is a hard continuity bug.

**Maps to:** a knowledge-state structure on the Context Engine (per character: facts/secrets known, the chapter each was learned, and a reader-knows-but-character-doesn't flag), plus a continuity check that flags any line where a character uses information their knowledge state says they should not have. The per-chapter `characters[]` already tracked on `ChapterSummary` gives the scene roster to check against.

### 2. The Crucible Structure (MIT, referenceable)

A distinctive **36-beat, three-strand** narrative framework: **Quest** (external plot) + **Fire** (internal arc) + **Constellation** (relationships), braided through **Four Forge Points + an Apex** (convergence moments where all three strands collide), plus a **"Mercy Engine"** (track acts of mercy that must pay off at the climax) and a **"Dark Mirror"** (antagonist-as-mirror) concept.

**Why additive.** It is a genuinely different structural lens from the frameworks already noted (Hero's Journey / Save the Cat / the Actantial Model from the MirrorShard review). The explicit external/internal/relational **strand braiding** with convergence forge points is its unique selling point.

**Maps to:** a BookClaw genre-agnostic **`section`/skill asset** (the structure as reference, like the genre-guide beats) and/or a planning-pipeline scaffold (a "crucible-planning" pipeline that develops the three strands and maps the 36 beats to chapters). The Crucible ships its content as Markdown skill/reference files (MIT), so the framework text is referenceable with attribution.

### 3. Red-herring / misdirection ledger (cheap)

Track red herrings **separately** from genuine foreshadowing, so a revision pass does not accidentally "correct" intentional misdirection. A small extension to the existing `plot-promises.ts` (add a `redHerring` kind/flag that the payoff-auditor treats inversely — it should *not* resolve to a real payoff).

### 4. Deterministic anti-pattern linter with frequency budgets + self-correction (medium)

A configurable list of overused micro-actions / phrases / sentence shapes (e.g. "half-step back," "closed her eyes," weakening sentence endings, consecutive same-grammatical-ending sentences) with **per-chapter and per-book limits**, run by the writing/revision step on its **own** output to self-correct before review.

**Why additive.** BookClaw has the humanize pipelines + forbidden-words, but those are LLM-judged. A **deterministic, frequency-budgeted** checker catches *repetition the LLM misses in its own output* (the model is bad at noticing it overused a tic). It fits BookClaw's "tests must be scripted" posture: a small script + YAML config that the revision step consults, surfacing counts that exceed the budget.

### 5. Voice differentiation table (minor)

A structured table of how each character speaks **under stress**, their verbal tics, and how their patterns *differ* from each other — forcing differentiated characterization. Refines BookClaw's existing `character-voices.ts` (voice fingerprinting) rather than adding a new system.

---

## Corroboration (validates BookClaw; not new work)

Several patterns recur across these sources and confirm BookClaw's existing design rather than suggesting changes:

- **"Main session designs; delegate prose to a fresh agent with a crystallized brief"** -> BookClaw pipeline steps already separate design context from per-step generation prompts.
- **Concept -> outline -> draft -> revise -> human synthesis** -> BookClaw's planning/production pipelines + the editorial suite.
- **Autonomous orchestrator + specialized subagents + JSON state** -> BookClaw's ProjectEngine + Context Engine + plot-promises.
- The intfiction **"Gap Conversation"** (flag missing specs rather than improvise) reinforces the human-in-the-loop direction already captured in the Storythread Studio TODO.

---

## Skip

- The forsonny **autonomous engine architecture** — overlaps BookClaw and has **no license** (code off-limits regardless).
- **Claude-Code-plugin mechanics** (skills/commands/output-styles/marketplace) — BookClaw is a different runtime; these do not port.
- **kenny-kane**'s basic Claude-Projects workflow and the general Reddit advocacy — no distinctive system beyond the above.

---

## Integration plan

### Phase 1 — Character Knowledge Matrix (the prize)

1. Add a per-character **knowledge-state** structure to the Context Engine: for each character, a list of `{ fact, learnedInChapter, source, readerKnowsButCharacterDoesNot? }`.
2. Populate it during the existing per-chapter summarization pass (the summary prompt already extracts characters + events; extend it to emit "what each character learned this chapter").
3. Add a **knowledge-continuity check** (a new category in the continuity report, or a `prompt`/editorial step): flag any passage where an on-page character acts on or references information their knowledge state says they have not learned yet.
4. Surface it in the continuity report alongside the existing character/timeline/setting checks.

### Phase 2 — Cheap craft adds

5. **Red-herring ledger:** add a `redHerring` flag to `plot-promises.ts`; the payoff auditor treats flagged items inversely (warn if a red herring resolves like a genuine promise).
6. **Crucible Structure asset:** ship the 36-beat three-strand framework (Quest/Fire/Constellation + forge points) as a `section`/skill reference asset (attribute the MIT Crucible repo); optionally a `crucible-planning` pipeline later.

### Phase 3 — Deterministic anti-pattern linter

7. A scripted checker (under `tests/` or a service) reading a YAML of overused phrases/micro-actions/sentence shapes with per-chapter/per-book limits; the revision step consults it and the counts feed a self-correction instruction. Pairs with the humanize pipelines.

### Phasing recommendation

Phase 1 (knowledge matrix) is the standout and the most defensibly novel — schedule it first. Phases 2-3 are cheap, opportunistic adds that extend services BookClaw already has (plot-promises, the genre-asset library, the humanize/forbidden-words tooling).

---

## Open questions / decisions

- **Knowledge-matrix authority:** auto-extracted by the Context Engine (cheap, approximate) vs. author-curated (accurate, more effort) vs. both. Start auto-extracted and let the author correct, mirroring how summaries/entities already work.
- **Crucible as reference vs. pipeline:** ship the structure as a reference asset first (cheap); only build a dedicated planning pipeline if authors actually adopt the framework.
- **Linter scope:** keep the anti-pattern budgets per-book-configurable (genres tolerate different repetition); ship a sensible default list, author-overridable — same posture as the genre/forbidden-words assets.
