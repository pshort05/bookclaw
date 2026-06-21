# Storythread Studio — Review and BookClaw Integration Plan

**Date:** 2026-06-20
**Source repository:** https://github.com/StoryThread-Dean/StorythreadStudio
**License:** Apache 2.0 (permissive — use/modify/redistribute with attribution; their implementation is referenceable, not just the concepts)
**Status:** Assessment + plan. Nothing imported yet.

---

## 1. What Storythread Studio is

A local-first Markdown writing app for fiction writers (Tauri + React + CodeMirror 6 + FastAPI). Its defining philosophy is the **inverse of BookClaw's**: the **writer drafts; the AI is a reviewer, editor, and brainstorm partner — never a ghostwriter.** Because of that inversion, its best ideas strengthen BookClaw's **human-in-the-loop** mode (a complement to BookClaw's autonomous generation, not a replacement).

Core features: a distraction-free Markdown editor; a structured **Profile Builder** (characters/relationships/locations/lore); a **Smart Advisor** that reviews a chapter and surfaces findings as anchored inline suggestions; a **Writing Companion** chat; series support; and Markdown export with snapshots.

---

## 2. Findings — two genuinely additive ideas

Unlike the two tools reviewed just before this (AI_NovelGenerator, whose state-tracking BookClaw already exceeds; and ContentOS, which is proprietary and content-marketing-focused), Storythread Studio has two ideas worth building into BookClaw.

### 2.1 Importance-tiered context injection (the standout)

Every character/world trait in a profile carries an **importance level** that controls **when and whether the trait is sent to the AI**, and at what prompt position:

| Level | Behavior |
|---|---|
| **Core** | Always sent, at the top of the prompt |
| **Present** | Sent only when the character is in the scene |
| **Background** | Sent only when directly relevant |
| **Contextual** | Sent only when the writer explicitly attaches it |
| **Hidden** | **Never sent** — writer-only reference; the AI may express it as subtext but may never name it |

Traits are authored as small "trait blocks" (`trait` / `description` / `importance`), each with an adaptive word-count gauge tuned to its level. Companion tooling: **AI Importance Audit** (flag mis-tiered traits), **AI Trim** (tighten bloated descriptions), and a *"How AI uses this"* preview.

**Why this is additive for BookClaw.** BookClaw currently injects **whole bibles + the genre guide into every prompt**; the architecture notes explicitly warn about output/context budget (`router.ts` `TASK_OUTPUT_BUDGET`, the "under-budgeting silently truncates" caution). Importance-tiering is a principled fix:

- **Context economy** — inject `Core` always, `Present` only for on-page characters, `Background`/`Contextual` only when relevant. Less prompt bloat, lower cost, better relevance.
- **A genuine craft control** — the `Hidden` tier lets an author encode secrets/subtext the model expresses but never states outright (mystery reveals, dramatic irony, unspoken motives).
- **North-Star aligned** — it makes per-book/author context richer and *configurable*, which is the multi-author/multi-book direction.

### 2.2 Smart Advisor — anchored inline-review UX (second priority)

The Smart Advisor runs Readability / Structure / Context passes over a chapter and renders findings as **colored inline highlights anchored to the exact passages the AI quoted**. Clicking a highlight shows an explanation, a **word-level diff** against the suggested rewrite, and **accept / ignore / re-cast** controls, plus targeted micro-operations (Rewrite, Expand, Shorten, Describe, Rephrase, Add Sensory Detail, Change Tone) and per-category subcategory scoping (e.g. Readability -> Grammar + Clarity only).

**Why this is additive.** BookClaw already has a studio selection menu + brainstorm/critique modes and the imported editorial pipelines (developmental/line/copy/proof), but those run as **bulk chapter rewrites**. The Smart Advisor is a much higher-fidelity **in-place, accept/reject, diffable** review layer. Wiring the editorial findings into an anchored-inline-suggestion UI turns the AI-as-editor mode from "rewrite the whole chapter" into "here are N anchored suggestions; accept the ones you want."

---

## 3. What is already covered (skip)

| Storythread feature | BookClaw equivalent |
|---|---|
| Markdown editor / local-first / project folder | v6 React studio + plain-file `workspace/` |
| Series (shared canonical profiles + per-book arcs) | Series tools (`create_series`, worldbuilding, reading order, divergence) + per-book arc overrides |
| Export / dated snapshots | DOCX/EPUB export + `BackupService` |
| Writing Companion chat | Chat + editor chat personas (`editor.ts`, `editor-command.ts`) |
| OpenRouter/provider + per-stage model config | The 6-provider AI router + per-step `modelOverride` |
| Profile system (characters/locations/lore) | Book bibles + Context Engine entity tracking (`context-engine.ts` `EntityEntry`) + `section` library assets |

The *structured profile* concept itself is largely covered by BookClaw's entity tracking and bibles; the **importance tier on top of it** is the new part.

---

## 4. Integration plan

### Phase 1 — Importance-tiered context injection (the prize; mostly backend/data-model)

1. **Data model** — add an `importance` field (`core | present | background | contextual | hidden`) to the trait/attribute level of the Context Engine's `EntityEntry` (and/or to a structured profile section in the book bible). Default existing data to `present`/`core` so nothing regresses.
2. **Composition layer** — in the prompt-composition path (`SoulService.composeForBook` / `context-engine` / `buildSystemPrompt`), select what to inject by importance:
   - `core` always (top position); `present` when the entity is on-page for the step (use the step's chapter/scene character list); `background`/`contextual` only when directly referenced; `hidden` never injected (optionally pass a single "this character has undisclosed depths — express as subtext, never state" hint without the content).
3. **On-page detection** — reuse the Context Engine's per-chapter `characters[]` (already tracked on `ChapterSummary`) to decide which `present` traits apply to a given chapter/step.
4. **Companion tools (optional, follow-on)** — an "Importance Audit" prompt/skill (flag mis-tiered traits) and an "AI Trim" prompt (tighten bloated trait descriptions); both can ship as `prompt` assets first, UI later.
5. **Studio UI (optional, follow-on)** — surface importance as an editable control on bible/profile entries with the adaptive word-count gauge.

Phase 1 is high value and well-bounded: a data-model field plus a selection rule in the composition layer. It directly reduces prompt bloat and adds the Hidden-subtext craft control.

### Phase 2 — Smart Advisor anchored inline-review UX (larger, frontend-heavy)

1. **Findings contract** — have the editorial/advisor pass return structured findings: `{ quote, charRange (anchor), category, subcategory, explanation, suggestedRewrite }` instead of a bulk rewrite.
2. **Anchoring** — match each finding's `quote` to a CodeMirror range in the studio manuscript editor; render as a colored inline highlight (handle quote drift with fuzzy match).
3. **Interaction** — click a highlight -> popover with explanation + **word-level diff** of the suggested rewrite + **accept / ignore / re-cast**; accept applies the edit to the document.
4. **Micro-ops + scoping** — selection-level operations (Rewrite/Expand/Shorten/Describe/Rephrase/Add Sensory Detail/Change Tone) and per-category subcategory toggles to scope a pass.
5. Reuse the imported `editorial-*` pipelines as the analysis backend; the new work is the structured-findings output shape + the studio review UI. Apache-2.0 source is referenceable (with attribution) for the anchoring/diff details.

### Phasing recommendation

Do **Phase 1** first — it is the higher-leverage, lower-effort change and benefits *every* generation step immediately. Scope **Phase 2** separately as a studio feature when the human-in-the-loop editing mode is a priority.

---

## 5. Open questions / decisions before building

- **Importance home:** put `importance` on the Context Engine `EntityEntry` traits (engine-managed, automatic) or on author-facing structured-profile `section` assets (hand-authored), or both? The richest version is author-authored importance that the engine then honors.
- **Default tier:** migrate existing bible content to which level so behavior does not regress (suggest `core` for protagonists/central rules, `present` otherwise)?
- **Hidden-trait handling:** inject nothing, or inject a content-free "express undisclosed depth as subtext" nudge? Decide whether the nudge risks the model inventing details.
- **Interaction with the genre guide:** importance-tiering applies cleanly to character/world traits; the genre guide stays wholesale (it is reader-contract, not per-scene). Keep them separate.
