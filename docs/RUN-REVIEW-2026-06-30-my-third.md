# Run review — "My Third Medical Romance" (2026-06-30)

Detailed review of the first full 6-phase autonomous run (model: `openrouter/google/gemini-3.5-flash`). All six projects completed (planning → bible → production → revision → format → launch). The line-level prose is competent, but the run has **catastrophic cross-step + in-prose consistency failure** and several structural bugs. Reviewed via 6 parallel analysis agents over the run's `data/` outputs.

## Problems found (running list)

### Consistency (the dominant failure)
- **Cross-phase canon drift.** The bible regenerated a *different book* than planning: heroine June **Albright→Miller→Mitchell→Harper** (4 surnames), hero **Ethan Vance→Julian Vance→Julian Blackwood→Julian Cross→Dr. Vance**, town **St. Jude's Falls→Oak Creek→Briarwood MA→Cedar Ridge→Maple Grove**, hospital + specialty + meet-cute + supporting cast all changed.
- **In-prose drift, chapter to chapter.** Within production alone the heroine, hero, best friend (Tessa→Vanessa), ex (Greg/Nathan/Derek), state (MA↔ME), job (new-grad↔NP↔decade-vet), ICU floor (3↔4), and timeline (6 days yet Oct→Dec) all change. The hero ends up sharing the **villain's** surname (Vance); the villain itself swaps (Margaret Vance↔Richard Sterling).
- **Title/author/series hallucinated everywhere.** ≥6 distinct titles ("Where the Heart Beats", "The Quiet Anatomy of Us", "The Saturday Remedy", "The Saturday Stranger", …), author "Claire Wilder" invented in format only, contradictory series (Cedar Ridge **Book 3** vs Maple Grove **Book 1**). The manifest title is never used.
- **Root cause:** each phase is a separate project, so writing/revision steps **never saw the bible's name registry or the outline**, and only a couple of prompts interpolated the title. The bible's "Series continuity tracker" — a real name registry — was pure dead documentation, never consulted.

### Structural bugs
- **Production "compile" = a completion REPORT, not the novel** (and itself truncated). No assembled manuscript existed.
- **Revision "apply … full manuscript rewrite" truncated catastrophically:** macro→~10%, scene-level dropped ch9–18, line-level stopped at ch5 (75% lost). Running these as the manuscript would destroy the book. The 21 *analysis* steps were genuinely good.
- **Format "export DOCX/EPUB" = AI text reports, not real files** (fabricated ISBN/publisher/word-count/pub-date).
- **Meta-commentary leaked** into saved outputs ("Okay, let's…", "Would you like to proceed to Step 4?", "Let's keep this momentum going!", "### Saving to Book Bible…", a stray "# Polish Chapter N" header, and an invented addressee "Silas").
- **"Polish" step is a near-verbatim line-edit** that fixes none of the drift (largely wasted cost).
- **Bible "World-building document" output never persisted** to `data/`.
- **Front-matter truncated** mid-copyright-sentence (567-byte stub).

### Model capability
`gemini-3.5-flash` writes fluent per-chapter prose but **cannot** (a) hold canon across separate phases/chapters or (b) read-in + emit a whole ~80K manuscript in one call (the revision truncation). Fixes: bind it to an injected canon, never ask for whole-manuscript regeneration (per-chapter only), assemble deterministically. A larger-context model for the bible/revision would help further.

## Fixes shipped this session (TDD)
- **Deterministic manuscript assembly + shrink validator** (`services/manuscript-assembly.ts`): latest polish>write per chapter, ordered, step-headers stripped → the real full novel; validates chapter count / word count so a shrink/truncation can't pass silently. Verified: assembles the real 32-ch / 123,649-word novel from this run.
- **Download the latest full novel** — `GET /api/books/:slug/download/latest-manuscript?format=md|docx` (assembles + real DOCX via `generateDocxBuffer`) + a **Studio "Full novel .md / .docx"** button on the Publish page. (Goal #4.)
- **Story-canon injection** (`services/book-canon.ts`): every generation step now gets a pinned **STORY CANON** block (manifest title/author + the bible's character bible, continuity/name registry, and outline read from the book's `data/`) with hard "use exactly; never rename/retitle/relocate/invent" rules. Root mitigation for the title/name drift.
- **Auto consistency audit built into the pipeline** (`onProjectCompleted`): runs after the production + revision phases, background, provider-gated, fail-soft — no explicit run needed. (Goal #3.)
- **Meta-commentary stripper** (`services/strip-meta.ts`) applied at every step-save: removes the leaked chatbot framing; conservative (never touches prose).

## Deferred follow-ups (see docs/TODO.md)
- Change the deep-revision "apply" steps from whole-manuscript regeneration to **per-chapter** patch/diff (gated by the new shrink validator).
- Wire the format-export pipeline's "export" steps to call the **real** DOCX/EPUB compiler against the assembled manuscript (and persist a real `manuscript.md/.docx` at production end).
- Fix the bible **world-building** persistence gap; fix the manifest title typo ("Medial").
- A lightweight, model-free **registry consistency gate** (entity-diff per chapter vs canon) as a cheaper complement to the LLM audit.
- Consider a larger-context model for the bible + revision phases.
