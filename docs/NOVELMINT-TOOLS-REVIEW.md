# Novelmint Comparison-Page Tools — Open-Source Review and Integration Plan

**Date:** 2026-06-20
**Source:** https://novelmint.ai/compare (a comparison page listing ~100 novel-writing tools)
**Scope:** Only tools that are **open-source and on GitHub**, excluding ones already reviewed separately (Storythread Studio, MirrorShard — each has its own doc). Six new repos qualified.
**Status:** Assessment + plan. Nothing imported yet.

---

## 1. Repositories reviewed

| Tool | Repository | License | Verdict |
|---|---|---|---|
| **The Novelist's Atelier** | https://github.com/f5alcon/The-Novelists-Atelier | Apache 2.0 | **Pull** — craft-analysis prompt taxonomy |
| **Spec Kit fiction preset** | https://github.com/adaumann/speckit-preset-fiction-book-writing | MIT | **Idea source** — interactive table-read, sensitivity, character interview |
| **markdown-to-book** | https://github.com/vpuna/markdown-to-book | MIT | **Small pull** — print-interior PDF (a real export gap) |
| **Alexandria** | https://github.com/Finrandojin/alexandria-audiobook | MIT | Partial — voice design/cloning (infra-heavy); attribution/casting already in BookClaw |
| **Novel Engine** | https://github.com/john-paul-ruf/novel-engine | AGPL-3.0 | Skip — heavy overlap; AGPL is viral |
| **AugmentedQuill** | https://github.com/StableLlamaAI/AugmentedQuill | GPL-3.0 | Skip — overlap; GPL is viral |

**Context for the verdicts:** BookClaw already has more than expected — `character-voices.ts` (per-character voice fingerprinting + speaker attribution), `kdp-exporter.ts` + `docx-export.ts` + `epub-export.ts` + Format Factory Pro (KDP/IngramSpark), the Context Engine, plot-promises, and the imported editorial suite. That makes several of these tools redundant.

---

## 2. The clear keeper — Atelier's craft-analysis prompt taxonomy

The Novelist's Atelier (Apache 2.0) is essentially a **curated library of granular craft-check prompts**, shipped as a single referenceable file (`novelist-atelier-prompts.md`). Beyond the usual dev/line/copy edits it breaks out specific audits BookClaw's editorial suite does not:

- **Tension & Engagement:** micro-tension audit, reader-curiosity tracker, chapter hook & cliffhanger audit
- **Prose Craft:** metaphor & simile audit, tonal consistency check, white-space / paragraph-rhythm check
- **Developmental:** stakes escalation, subplot resolution, scene-level conflict, tropes identification & subversion, info clarity & relevance, scene openings/endings, POV consistency, thematic cohesion
- A **10-phase editing workflow**, an **"Essential Quick List"** (10 high-impact triage prompts), and **14 genre-specific prompt sets**

These map directly onto BookClaw `prompt` assets (Prompt Runner) and/or editorial pipeline steps. **Highest value, lowest cost** of the batch — pure content that enriches BookClaw's reviewer mode and complements the already-imported editorial suite + prompt assets.

A second idea from Atelier worth carrying: **section-level inclusion modes** (Full / Brief / Extended / Custom / Off per Series/Book/Chapter section, with word-count truncation). This is a *section-level* take on context economy, complementary to Storythread Studio's *trait-level* importance tiers. It belongs as a companion note on the existing context-economy TODO rather than a separate effort.

---

## 3. Secondary ideas

- **Spec Kit (MIT) — interactive multi-role table-read.** Its `roleplay` command is genuinely novel: an interactive play-through of an outline/draft chapter where the AI identifies every role in the scene (Author, Lector, scene characters, Casual Reader, Critique Reader, Editor), assigns each to AI or user, walks the chapter beat by beat pausing for reaction/Q&A/role switches, and commits the accumulated insights back as structured revision notes. Also notable: a **sensitivity-read** pass and a **character interview** mode, plus a **constitution / craft-rules** concept that is essentially the NPE idea again (reinforcing the narrative_engine TODO).
- **markdown-to-book (MIT) — print-interior PDF.** BookClaw exports DOCX + EPUB and formats KDP metadata, but `kdp-exporter.ts` does **not** produce a typeset print-interior PDF. markdown-to-book generates **paperback and hardcover PDFs** via Pandoc + XeLaTeX with KDP trim sizes, gutter-aware inner margins, front matter, TOC, scene breaks, and EB Garamond typography. That is a concrete export gap; the tool is a small Pandoc/LaTeX template set, cheap to adapt.
- **Alexandria (MIT) — per-character voice design/cloning.** BookClaw already does the script side (LLM speaker attribution, casting, audiobook prep, TTS). Alexandria adds AI **voice design + cloning + LoRA training** to auto-generate a *distinct* voice per character rather than assigning from a preset pool. Additive, but GPU/infrastructure-heavy (Qwen3-TTS, LoRA) — a "someday" audiobook enhancement, not a near-term pull.

---

## 4. Skips (and why)

- **Novel Engine (AGPL-3.0):** an autonomous editorial production pipeline driven by seven named AI agents + Pandoc export — heavy overlap with BookClaw's pipelines/editors/export. Only the "named editorial-team personas with personalities" branding is a minor UX idea. AGPL is viral, so code is off-limits regardless.
- **AugmentedQuill (GPL-3.0):** a local-first Writing-Partner chat + sourcebook (worldbuilding DB) + image-prompt generator — all already covered (chat/editors, bibles, image generation). GPL is viral.
- **markdown-to-book** is a partial skip kept only for the print-PDF gap (above).

---

## 5. Integration plan

### Phase 1 — Import the Atelier craft-analysis prompts (cheap, high value)

1. Port the distinct craft-check prompts from `novelist-atelier-prompts.md` into BookClaw **`prompt` assets** (Prompt Runner), prioritizing the audits BookClaw lacks: micro-tension audit, reader-curiosity tracker, chapter hook & cliffhanger audit, metaphor & simile audit, tonal-consistency check, white-space / paragraph-rhythm check, tropes identification & subversion, scene-level conflict, stakes escalation, subplot resolution.
2. Optionally add the **"Essential Quick List"** as a small triage editorial pipeline (chain the 10 high-impact checks), reusing the editorial-suite pattern.
3. Attribute Atelier (Apache 2.0) in the asset descriptions, as done for the humanizer-repo ports.

### Phase 2 — Cheap idea-adds

4. Add a **character-interview / roleplay** `prompt` (develop a character by interviewing them in voice) and a **sensitivity-read** `prompt` (from Spec Kit, MIT).
5. Evaluate the **interactive multi-role table-read** as a studio/chat feature (larger — it is an interactive session format, not a single prompt); record as a smaller follow-on if the reviewer mode gets built out.

### Phase 3 — Export + context-economy follow-ons

6. **Print-interior PDF export** (paperback + hardcover via Pandoc/XeLaTeX, KDP trim/gutter) as an addition to the export services — adapt markdown-to-book's templates (MIT). Closes the typeset-print-PDF gap.
7. Fold **section-level inclusion modes** into the existing context-economy TODO (Storythread importance-tiering) as the section-level companion to trait-level tiers.

### Phasing recommendation

Phase 1 is the real win and is the same low-cost fan-out-and-validate flow used for the n8n prompt-asset imports. Phases 2-3 are small, opportunistic adds.

---

## 6. Open questions / decisions

- **Prompt vs pipeline:** import each Atelier audit as a standalone `prompt` asset (Prompt Runner, ad-hoc) or also bundle the "Essential Quick List" as an editorial pipeline? The prompt-asset form is the cheapest first step and is reusable either way.
- **Overlap pruning:** skip Atelier prompts that duplicate the already-imported editorial suite (developmental/line/copy/proof); import only the net-new audits.
- **Print-PDF placement:** add as a new export target alongside `docx-export`/`epub-export`, gated behind Pandoc + TeX availability (fail-soft, matching BookClaw's optional-dependency posture).
