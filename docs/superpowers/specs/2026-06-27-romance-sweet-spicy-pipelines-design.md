# Sweet & Spicy romance pipelines (n8n → BookClaw)

**Date:** 2026-06-27
**Status:** Approved

## Goal

Two new built-in novel pipelines, derived from three n8n "Romance Book Writer"
workflows on Neptune, with **each generative step converted into a reusable
BookClaw skill**:

- **`romance-sweet`** — adapted from the WF1/WF2 twins (use the newer, **WF2
  "Cross Lines"**), with every intimacy instruction rewritten to **Fade to Black
  (spice level 2)**.
- **`romance-spicy`** — built from **WF3 "Romance Book Writer"** (newest, most
  refined), keeping its **Heat Level 4** explicit intimacy.

## Source analysis (the three workflows)

All three share one backbone, a per-chapter loop:
`Find Chapter Names → Scene Brief → First Draft → Improvement Plan → Rewrite →
Humanize → Intimacy`, fed by a six-doc "book bible" (Outline, Characters,
Locations, Dialogue/Writing-Style, Forbidden-Words) plus a rolling last-2,000-words
continuity excerpt.

- **WF1 "Soft Edge of Wild"** & **WF2 "Cross Lines"** — near-twins (WF1 cloned from
  WF2; its output doc is still titled "Cross Lines"). Both self-describe Spicy HL4.
  WF2 is the newer (updated 2025-12-24 19:49 vs WF1 02:07) → **WF2 is the Sweet base.**
- **WF3 "Romance Book Writer"** (2026-01) — newest, much larger/refined prompts
  (Scene Brief ≈17K vs ≈3.4K), a *conditional* intimacy branch, a "beach read"
  content floor, and name/location research guardrails. → **Spicy base.**

Note: none of the sources is genuinely "sweet"; Sweet is **derived** by toning the
heat down to fade-to-black.

## Decisions (locked)

- **Location:** built-in `library/pipelines/` + `skills/author/` (committed,
  deployed to Mercury + Neptune). Consistent with `romantasy-production.json`.
- **Skill category:** `author` (the `SKILL_CATEGORIES` enum in
  `gateway/src/skills/loader.ts` is hardcoded — a new `romance` category would
  require code changes in several places; `author` needs none).
- **Models:** preserve each workflow's per-step model family, bumped to the newer
  ids `romantasy-production.json` uses (`claude-opus-4.8`, `claude-sonnet-4.6`,
  `google/gemini-3-pro`), all via the `openrouter` provider.
- **Skill sharing:** one shared `romance-humanize` **if** the WF2 and WF3 humanize
  prompts are >~90% identical; otherwise split into `romance-sweet-humanize` /
  `romance-spicy-humanize`. (Decide at build by diffing the two.)

## The skill ⇄ pipeline contract

The user's ask — "each step becomes a skill" — differs from `romantasy-production`,
which reuses the generic `outline`/`write`/`revise` skills. So:

- **SKILL.md content** = the step's **reusable craft methodology** (the bulk of the
  n8n prompt: structure, rules, constraints, prose-style laws, forbidden-words list,
  heat handling), generalized to be book-agnostic. Skills are **static markdown** —
  no `{{vars}}`; they reference "the book's outline / character bible / world guide
  in your context."
- **Pipeline `promptTemplate`** = a **thin per-chapter invocation** carrying the
  `{{n}}`/`{{title}}`/`{{wordsPerChapter}}` vars: e.g. *"Create the SCENE BRIEF for
  Chapter {{n}} of \"{{title}}\". Follow your scene-brief methodology (in context).
  Use the chapter outline, character bible, and world guide in your context. Output
  the brief only."*

This makes the skills genuinely reusable (chat, other pipelines) while the pipeline
owns per-chapter wiring + model + word target.

### Context mapping (n8n Google Docs → BookClaw)

`OUTLINE`→ the book's chapter outline · `CHARACTERS`→ character bible ·
`LOCATIONS`→ world guide · `DIALOGUE_GUIDE`+`WRITING_STYLE`→ soul/style-guide +
genre guide · `FORBIDDEN_WORDS`→ baked into the first-draft/improvement/rewrite/
humanize skills as an explicit banned-vocabulary list. The non-generative n8n nodes
(Find/Parse Chapter Names, Get-Last-2000-Words, Add-to-Document) map to BookClaw's
native `expand: chapters` loop, rolling context, and per-book output routing — they
are **not** skills.

## Skills (under `skills/author/`)

| n8n step | Sweet skill | Spicy skill |
|----------|-------------|-------------|
| Scene Brief | `romance-sweet-scene-brief` | `romance-spicy-scene-brief` |
| First Draft | `romance-sweet-first-draft` | `romance-spicy-first-draft` |
| Improvement Plan | `romance-sweet-improvement-plan` | `romance-spicy-improvement-plan` |
| Rewrite | `romance-sweet-rewrite` | `romance-spicy-rewrite` |
| Humanize | `romance-humanize` (shared if identical) | ← |
| Intimacy | `romance-sweet-intimacy` **(Fade-to-Black, HL2)** | `romance-spicy-intimacy` **(HL4 explicit)** |

**Sweet intimacy adaptation (the core change):** take WF2's HL4 INTIMACY prompt and
rewrite it as fade-to-black — build tension to the threshold (the kiss, the charged
decision), **close the door at the point of escalation**, and resume in the emotional
afterglow. No explicit anatomy or mechanics. Sweet scene-brief/first-draft heat cues
are dialed to longing, tension, and emotional intimacy. Spice level 2.

Each SKILL.md uses the standard frontmatter (`name`, `description`, `author: BookClaw`,
`version`, `triggers`, `permissions`) + the methodology body. Typos in the n8n source
("thoroghly", "Itallics", "experice", etc.) are fixed.

## Pipelines

`library/pipelines/romance-sweet.json` and `library/pipelines/romance-spicy.json`,
`schemaVersion: 1`, each an `expand: chapters` block of **six** per-chapter stages
plus a compile step (mirrors `romantasy-production.json` but keeps Humanize and
Intimacy as **separate** stages):

| # | Stage | skill | taskType | model (openrouter) | temp |
|---|-------|-------|----------|--------------------|------|
| 1 | Scene Brief — Ch {{n}} | romance-{sweet,spicy}-scene-brief | outline | sweet: claude-sonnet-4.6 · spicy: claude-opus-4.8 | 1 |
| 2 | First Draft — Ch {{n}} | romance-{sweet,spicy}-first-draft | creative_writing | claude-opus-4.8 | 1 |
| 3 | Improvement Plan — Ch {{n}} | romance-{sweet,spicy}-improvement-plan | revision | google/gemini-3-pro | 0.7 |
| 4 | Rewrite — Ch {{n}} | romance-{sweet,spicy}-rewrite | revision | google/gemini-3-pro | 0.7 |
| 5 | Humanize — Ch {{n}} | romance-humanize | final_edit | claude-sonnet-4.6 | 0.2 |
| 6 | Intimacy — Ch {{n}} | romance-{sweet,spicy}-intimacy | creative_writing | claude-sonnet-4.6 | 0.2 |
| — | Compile manuscript report | — | general | (default) | — |

Stages 2/4/6 carry `wordCountTarget: "{{wordsPerChapter}}"`; every per-chapter stage
carries `chapterNumber: "{{n}}"` and a `phase` label (brief/draft/critique/rewrite/
humanize/intimacy). Pipeline vars come from `buildPipelineVars`
(`{{title}}`, `{{n}}`, `{{wordsPerChapter}}`, `{{chapterCount}}`, `{{description}}`).

## Testing

- `tests/unit/romance-pipelines.test.ts` (mirrors `romantasy-pipeline.test.ts`):
  both JSONs are valid (`parsePipelineJson`), each has an `expand:chapters` block of
  **6** stages with taskTypes `[outline, creative_writing, revision, revision,
  final_edit, creative_writing]`, `expandSteps` flattens to `chapters*6 + 1` with no
  unsubstituted `{{vars}}`, and the per-chapter word target threads through stages
  2/4/6.
- Boot the skill loader / smoke check that all new `skills/author/romance-*` parse
  (valid frontmatter) and the two pipelines load via `LibraryService`.

## Out of scope

- No new `romance` skill category (uses `author`).
- The cheap "Find Chapter Names" parse + Google-Doc I/O are not ported (engine
  handles chapter expansion + output).
- MODEL bumps beyond the agreed newer ids; users can re-pin per step via the model
  picker.
