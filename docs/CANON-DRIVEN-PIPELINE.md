# Canon-Driven Novel Pipeline — Process Outline

Status: research / pre-design notes for a new BookClaw pipeline set.
Source: an r/WritingWithAI post by a published Japanese light-novel author
("Published novelist (15+ fantasy books, 1M+ views on a fully AI-written work)…",
reddit.com/r/WritingWithAI/comments/1u6g6e4, retrieved 2026-06-15), plus the
author's follow-up answers in the comment thread. An archived PDF of the page is
kept alongside this file at `CANON-DRIVEN-PIPELINE-source.pdf`. This document reconstructs the
process in full from that source and maps it onto BookClaw's existing model. It is
**descriptive of the source workflow first, then a mapping** — it is not yet an
approved implementation plan. The TODO umbrella item ("Canon-driven novel pipeline
set") tracks the work.

## 1. Reported result (the claim being reproduced)

A single Claude Code run produced one full 20-chapter arc of an ongoing series:

- 20 chapters generated from one invocation.
- 137,806 characters total (~70K English-word equivalent).
- ~96 minutes wall-clock runtime.
- ~89 sub-agents running in parallel.
- Internal quality score 87.5 → 89.0 (out of 100) after a consistency-review pass.
- The author (who designed the plot but had the AI write every word) reports the
  output was indistinguishable from their own writing, and a comparable
  AI-assisted, openly-tagged work passed 1M page views on Kakuyomu.

The output is explicitly a **draft**: the author still hand-polishes 30–60 minutes
per chapter.

## 2. The core insight

> "AI doesn't write a novel. AI drafts massively, in compliance with a Canon you
> build."

The bottleneck is not the prompt, the model, or the chat history — it is the
**Canon**: a set of structured Markdown files that define the story's "physical
laws." The author's framing (from the comments) is that Canon files are **not
reference docs and not prompts** — they are the *control mechanism*. Every agent
reads them fresh before acting, so the per-chapter instruction can be tiny ("Write
Chapter 12, scenes 1–3") while voice, world, and constraints come entirely from the
Canon. Build the Canon well and a competent agent writes 20 chapters in the author's
voice; skip it and the output is generic "AI slop."

Cost of the Canon: the author reports it takes roughly **2 days** to build well, and
that "if your Canon is wrong, your 20 chapters will be consistently wrong." The Canon
is the human judgment; the agents are the typing.

## 3. Layer 1 — The Canon (foundation, built once per series)

Seven shared Markdown files, read by every downstream agent. They live at the project
root and are shared across all chapters (one copy, not per-chapter).

| File | Role |
|------|------|
| `canon.md` | The engine — what makes this story *this* story: core conflict, tone, the things that are always true. |
| `character_bible.md` | Per-character voice, "calling patterns" (how each character addresses others), and behavioral DNA. |
| `glossary.md` | Every proper noun, locked (consistent spelling/usage of names). |
| `timeline.md` | Relative dates and event ordering — what happens when. |
| `world_bible.md` | The world's rules. |
| `style_guide.md` | Sentence rhythm, density, and format. |
| `forbidden_patterns.md` | What characters (and the prose) will **never** do or say — the anti-AI-slop filter. |

### `style_guide.md` — specifics the author gave

- Sentence-length distribution (e.g. "average 15–25 words, never three short
  sentences in a row for emphasis").
- Paragraph-rhythm rules.
- A list of banned rhetorical patterns (cross-referenced from `forbidden_patterns.md`).

### `forbidden_patterns.md` — example rules the author quoted

These exist to suppress recognizable AI tics. Verbatim examples from the thread:

- "Never use 'It's not X, it's Y' as a reveal structure."
- "No rule-of-three lists in narration."
- "No single-word sentences for dramatic effect."
- "No 'little did they know' or 'what they didn't realize'."
- "No starting paragraphs with 'And yet' or 'But here's the thing'."

The author notes the forbidden set is language-specific: a Japanese-language project
bans a different list of tics (overused "まるで〜のように" simile structures, narrator
over-explanation via explanatory past-tense endings, over-explicit emotion such as
"her chest tightened with pain" instead of showing it, and over-formal narration for
casual characters). Takeaway for a general implementation: the forbidden list should
be authorable per project/genre/language, not hardcoded.

Why per-file separation works: each agent only thinks about one thing. The prose agent
does not agonize over voice (that is already fixed by `character_bible.md`); the plot
agent does not worry about style (that is `style_guide.md`). This is the inverse of
dumping everything into a single chat context.

## 4. Layer 2 — The per-chapter pipeline (4 agents, run for all chapters in parallel)

Each chapter passes through a four-stage agent chain. Each stage consumes the prior
stage's output plus the shared Canon, and specializes in exactly one job:

1. **Plot agent** — emits **structured JSON**: the chapter's role in the arc, its key
   scenes, and its hook.
2. **Scene Card agent** — expands the plot JSON into a scene-by-scene breakdown: POV,
   each scene's start/end state, and the forbidden items for that scene.
3. **Writing Brief agent** — produces the final pre-write instructions: density limits
   and required elements for the chapter (the last gate before prose).
4. **Prose agent** — writes the actual chapter text, 5,000–8,000 characters, reading
   all Canon files plus the brief.

All 20 chapters run their four-stage chains concurrently. With reviews, the author
counts roughly 20 chapters × 4 layers + review agents ≈ 89 agents total.

Output: one Markdown file per chapter (`chapters/chapter_01.md`, `chapter_02.md`, …).
One file per chapter keeps review/edit/track-state simple (polished vs. raw).

## 5. Layer 3 — Parallel review (consistency gate)

After all chapters are generated, a review phase checks every chapter across **four
continuity dimensions**:

- Character continuity
- World continuity
- Plot continuity
- Operational continuity

When a dimension flags an error (the author's example: a deceased character appearing
in a later chapter), the workflow **loops back** and re-runs that specific chapter's
chain with a correction instruction, rather than regenerating the whole book. This
review pass is what moved the reported quality score from 87.5 to 89.0.

## 6. Models and orchestration

- **Planning / Canon design:** Claude Opus (the author cited 4.7) — "save it for the
  thinking."
- **Prose generation:** Claude Sonnet — fast, cheap, and strong at following detailed
  instructions; Opus is described as overkill for the writing itself.
- **Orchestration:** Claude Code's Workflows feature spawns the parallel sub-agents.
  The whole pipeline is a single Workflow script: "for each chapter: plan → break into
  scenes → write brief → write prose → review," then run.

(A commenter posted an unofficial *local* re-creation — vLLM/Ollama + CrewAI/AutoGen,
70B orchestrator + 3B/8B prose workers, `asyncio.gather` fan-out over chapters. It is
third-party speculation, not the author's setup, but it confirms the shape: heavy model
for Canon-compile and continuity review, many light models for parallel prose.)

## 7. Directory layout (as described)

```
project/
├── canon.md               (shared)
├── character_bible.md     (shared)
├── glossary.md            (shared)
├── timeline.md            (shared)
├── world_bible.md         (shared)
├── style_guide.md         (shared)
├── forbidden_patterns.md  (shared)
└── chapters/
    ├── chapter_01.md      (generated)
    ├── chapter_02.md      (generated)
    └── ...
```

Markdown is chosen deliberately: plain text the model reads with no conversion,
explicit semantic structure via headings/lists, line-diffable for Canon edits, and
lightweight in context.

## 8. Operating characteristics and honest limits

- Canon build is the real work: ~2 days, and it is the human-judgment bottleneck.
- Output is a **draft**; budget 30–60 minutes of human polish per chapter.
- The model is weakest at: first appearances of characters, key foreshadowing setups,
  and chapter-ending atmosphere — flag these for human attention.
- A wrong Canon produces *consistently* wrong chapters (the failure mode is systematic,
  not random).
- The forbidden-pattern filter reduces but does not eliminate AI tics; human editing is
  still the final pass.
- Reported throughput multiplier: 5–10× — by replacing the typing, not the judgment.

## 9. Mapping onto BookClaw (how this becomes a new pipeline set)

This workflow maps cleanly onto BookClaw's config-not-code pipeline/sequence engine.
The pieces and the gaps:

- **Canon ⇒ the per-book `templates/` snapshot.** The seven Canon files correspond to
  BookClaw's Author/Voice/Genre/Sections/World material. Decision: model "Canon" as a
  dedicated `sections` set, a genre-guide variant, or a new library kind. `style_guide`
  and `forbidden_patterns` are the novel additions — `forbidden_patterns` in particular
  is a clean fit for the existing prose-quality / on-the-nose prompt-runner prompts and
  for an authorable "negative constraints" section injected into every prose step.
- **Layer 2 ⇒ a 4-stage per-chapter sub-pipeline.** BookClaw already has the
  `expand:chapters` construct that flattens per-chapter steps. Extend it from today's
  Write/Polish pair into a four-stage hand-off (Plot → Scene-card → Writing-brief →
  Prose) where stage *n* consumes stage *n−1*'s structured output. The Plot agent's
  **structured JSON** output is the contract between stages and needs a defined schema.
- **Layer 3 ⇒ a review pipeline** running four continuity dimensions, mirroring the
  existing continuity / craft-critique passes, with a **loop-back-and-regenerate** for a
  flagged chapter (BookClaw has no targeted single-chapter re-run path today — new).
- **Model routing** maps to the AI router's tiers: planning/Canon on a premium tier,
  prose on a mid tier — already how `TASK_TIERS` works; add task types for the four
  chapter stages and the review dimensions with appropriate output budgets (the prose
  step needs the 16K-class budget already used for `creative_writing`).

### The one real architectural gap: parallelism

The source fans out ~80–89 agents **in parallel**; BookClaw runs pipeline steps
**sequentially** (one Project per phase, steps in order). The first scoping decision is
whether to:

1. Add genuine fan-out chapter execution (a Workflow-style orchestrator over chapters),
   matching the source's runtime profile but introducing concurrency, cost-spike, and
   partial-failure handling; or
2. Run the same canon → 4-stage → review flow **sequentially** as a new pipeline
   sequence — slower wall-clock, but it reuses the existing engine, cost accounting, and
   pause/resume with no new concurrency machinery.

For a first cut, option 2 (sequential) delivers the *quality* mechanism (the Canon and
the staged hand-off are what produce the result, not the parallelism) while deferring
the orchestration risk; parallel fan-out becomes a later performance enhancement.

## 10. Open questions to resolve before implementation

- Canon storage shape: new library kind vs. sections set vs. genre-guide extension.
- The Plot-agent JSON schema and how each later stage consumes it.
- Where `forbidden_patterns` / `style_guide` inject in the prompt stack, and whether
  they are global, per-author, per-genre, or per-book (the source implies per-project,
  and language-dependent).
- Sequential vs. parallel chapter execution (Section 9), and the cost ceiling for a
  full 20-chapter run.
- The targeted single-chapter regeneration path for the review loop-back.
- How this relates to the existing Nerdy-Novelist canonical-artifacts mode
  (`dossier.md` / `characters.md` / `world.md` / `outline.md` / `chapters/`), which
  already overlaps the Canon concept — reuse vs. parallel track.
