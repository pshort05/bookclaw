# Narrative Anti-Fingerprint System — Design

Date: 2026-07-06
Status: Approved (owner brainstorm session 2026-07-06)
Research basis: StoryScope (Russell et al., COLM 2026, arXiv 2604.03136), full source in `research/`

## Problem

AI-generated fiction is detectable from structural narrative choices alone — 93.2%
macro-F1 with no style features — and this signal **survives prose-level editing**
(span-level artifact removal only dropped detection 1.6 points). Readers'
"it sounds like Claude" reactions come from two separable layers:

1. **Structure** (survives editing): stated themes (77% AI vs 52% human), strict
   linear chronology, embodied-only emotion (81% vs 38%), no subplots (79% vs 57%),
   clean moral polarity, vague allusions, sealed fourth wall. Claude is the most
   identifiable model at this layer (89.3% attribution F1).
2. **Style tics** (surface): banned-vocabulary/rhythm patterns. Already covered by
   the existing `romance-humanize` skill, but only for romance.

BookClaw has prevention and cure gaps at the structural layer. This project closes
both with **content assets only** — no gateway code changes, no schema bumps.

## Decisions (owner-confirmed)

| Question | Decision |
|---|---|
| Audit scope | **Per-chapter only** (matches `editorial-alpha-read`; manuscript-level tells are reported in findings but not auto-fixed) |
| Packaging | **Skill + pipeline** — one `fingerprint-audit` skill holds the catalog; an `editorial-fingerprint` pipeline runs it per chapter |
| Human-review gate between passes | **No gate** — audit→fix chain automatically; findings persist as step outputs for post-hoc review. Fix-pass conservatism rules are therefore load-bearing |
| Scope | **Both** prevention (install drafting skill) and cure (2-pass pipeline) |
| Style layer | **Chain humanize after the structural fix** and add a genre-neutral `humanize` skill |
| Model-specific skills? | **No** — one skill with a per-model appendix (see below) |

## Model-variant decision (owner question 2)

The research rules out per-model skill files:

- The 30 **core features are model-universal** and recover 91% of detection power
  (84.8 of 93.2 F1). That is where nearly all the value is.
- Per-model fingerprint counts are small and lopsided: Claude 26, GPT 11,
  Gemini 11, DeepSeek 7, **Kimi 3** (Kimi sits at the generic AI centroid).
- Some fingerprints are directionally opposite (Gemini over-uses flashbacks,
  Claude under-varies) — only textual evidence resolves which correction applies.
- BookClaw manuscripts are **multi-model artifacts** (tier routing, fallbacks,
  per-step `modelOverride`), so a model-keyed skill would need provenance
  plumbing and still guess wrong on mixed books.

**Resolution:** a single `fingerprint-audit` skill whose checklist includes the
per-model tells as additional evidence-checked items. Model identity, when known,
is emphasis — not a selector.

## Components

### 1. Install `narrative-anti-fingerprint` (drafting-side prevention)

`research/narrative-anti-fingerprint.md` → `skills/author/narrative-anti-fingerprint/SKILL.md`.

Content is already written (7 core directives + Claude-defaults section + genre
gate). The **frontmatter must be rewritten** for BookClaw's loader:

- `SkillLoader.parseSkill` (`gateway/src/skills/loader.ts`) reads only
  single-line `description:` values — the research file's folded block
  (`description: >`) would parse as `">"`. Collapse to one line.
- Unknown keys (`priority`, `applies_to`) are ignored harmlessly; drop them and
  add house-style `name`/`author`/`version`/`permissions` instead.
- Keep triggers: `draft`, `scene`, `chapter`, `prose`, `narrative`, `fiction`,
  `story` — these auto-inject the skill into drafting steps.

The `research/` copy stays untouched (it is the research record).

### 2. `fingerprint-audit` skill (the 2-pass brain)

New `skills/author/fingerprint-audit/SKILL.md`. Both passes' rules live in one
skill so the pipeline's two steps share one source of truth. Structure:

- **Pass semantics header:** the step prompt declares which pass is active; the
  skill defines both.
- **Pass 1 — DIAGNOSE (no rewriting).** Check the chapter against the core tell
  catalog, ordered by diagnostic power:
  1. Stated theme / moralizing (quote every instance; includes dialogue-as-
     philosophical-debate)
  2. Chronology (strict in-chapter linearity, no anachrony = flag)
  3. Emotion delivery (rough ratio embodied : named : unspoken; heavy embodied = flag)
  4. Single track (chapter feeds one clean throughline only; note tidy
     internal-understanding resolution)
  5. Moral clarity (protagonist cleanly sympathetic/right = flag)
  6. Reference specificity (vague allusions vs named works/places/brands)
  7. Sealed bubble (no reader address / fourth-wall permeability)

  Output: JSON only —
  `{"needsRevision": bool, "chapterNumber": n, "summary": "...", "findings": [{"category", "severity": "HIGH|MED|LOW", "quote", "location", "suggestion", "scope": "chapter|manuscript"}]}`
  Findings that require whole-book context or new material (missing subplots,
  book-level chronology, added ambivalence) are reported with
  `"scope": "manuscript"` so the fix pass skips them and the author sees them.
- **Per-model appendix** (evidence-checked regardless of drafting model):
  - *Claude:* flattened escalation, uniform narrative register, epilogue/
    flash-forward reflex, convention-reverence (extends rather than subverts),
    dream-sequence avoidance, quiet endings.
  - *GPT:* gossip/rumor as plot mechanism, distant-retrospective framing
    ("years later..."), habitual-narration avoidance.
  - *Gemini:* formulaic flashback insertion, bleak/oppressive settings default,
    over-tidy extended denouement.
  - *DeepSeek:* front-loaded context/backstory a human would withhold, visible
    narrator presence.
  - *(Kimi has no distinctive fingerprints — the core catalog covers it.)*
- **Pass 2 — REVISE (surgical).** Rules:
  - Act ONLY on Pass 1 findings with `"scope": "chapter"`; never restyle
    unflagged prose. `needsRevision: false` → output the chapter unchanged.
  - Stated-theme lines are **deleted**, not paraphrased into subtler restatements.
  - Emotion: convert a **portion** of embodied cues to plainly-named or unspoken —
    keep variety, do not invert the ratio.
  - Anything needing new material (subplot, ambivalence, reordering across
    chapters) is **flagged, never fabricated**.
  - Preserve dialogue, Markdown, chapter header, length (±10%), and voice.
  - Output ONLY the full revised chapter text.
- **Genre gate** mirrored from component 1: non-fiction audits only categories
  3 and 7; a stated thesis and linear order are correct in non-fiction.
- Triggers: `fingerprint`, `ai tells`, `narrative audit`, `structural tells`,
  `de-ai structure`, `story fingerprint`. (Chosen not to collide with
  `romance-humanize`'s style-layer triggers.)

### 3. `editorial-fingerprint` pipeline

New `library/pipelines/editorial-fingerprint.json` (`schemaVersion: 1`), modeled
on `editorial-alpha-read`: one `expand: "chapters"` block, three steps per
chapter, **no gates**:

| # | Label | Skill | taskType | phase | Notes |
|---|---|---|---|---|---|
| 1 | Fingerprint Audit — Chapter {{n}} | `fingerprint-audit` | `revision` | `analyze` | JSON findings only; `role: "rewrite"` |
| 2 | Apply Fingerprint Fixes — Chapter {{n}} | `fingerprint-audit` | `final_edit` | `apply` | `wordCountTarget: {{wordsPerChapter}}`; acts only on chapter-scope findings |
| 3 | Humanize — Chapter {{n}} | `humanize` | `final_edit` | `apply` | style-layer polish; `wordCountTarget: {{wordsPerChapter}}` |

- **No hardcoded `modelOverride`s** — tier routing decides (`revision` → mid,
  `final_edit` → mid); deployments can override per-step. (Neptune only has
  ollama + openrouter; a baked override would break there.)
- Description documents that manuscript-scope findings land in the audit step
  outputs for author review and are not auto-applied.

### 4. Generic `humanize` skill

New `skills/author/humanize/SKILL.md`, generalized from `romance-humanize`:

- Same absolute-protection rules (dialogue and Markdown untouched, full-document
  integrity, meaning preservation).
- Same framework (grammar floor, AI-vocabulary elimination, rhythm variation),
  minus romance-specific framing.
- **Fallback banned-list**: when no forbidden-words document is in context, use a
  compact built-in list of AI-tell vocabulary/constructions (the romance skill
  assumes a context-supplied list; the generic one must not).
- **`romance-humanize` stays untouched.** It is referenced by the live
  `romance-sweet`/`romance-spicy` pipelines and is snapshotted into existing book
  containers on Neptune — renaming or editing it risks production books.
- Trigger overlap: `SkillLoader.matchSkills` injects **every** skill whose
  trigger is a substring of the input, and `romance-humanize` already owns
  `humanize`/`de-ai`/`remove ai tells` — so any humanize-ish chat input will
  inject both skills. **Accepted**: the instruction sets are same-directional,
  and pipelines reference skills by exact name so step resolution is unaffected.
  The generic skill uses the natural triggers (`humanize`, `de-ai`,
  `remove ai tells`, `humanise`) without contortions to avoid the collision.

## What this does NOT do

- No gateway/TypeScript code changes; no `BOOK_SCHEMA_VERSION` /
  `WORKSPACE_SCHEMA_VERSION` bump. Deployable to Neptune as a plain rebuild.
- No manuscript-level auto-restructuring (owner chose per-chapter scope).
- No per-model skill files and no drafting-model provenance plumbing.
- No MCP changes: the pipeline is served by the existing generic library/
  pipeline routes; no new gateway route is added, so the MCP lockstep rule is
  not triggered.
- Does not modify `romance-humanize` or any existing pipeline.

## Testing

**TDD (write failing tests first):**

- `tests/unit/fingerprint-pipeline.test.ts`, mirroring
  `romance-pipelines.test.ts`:
  1. Pipeline parses via `parsePipelineJson`, `schemaVersion` 1, has an
     `expand: chapters` block with 3 stages in taskType order
     `revision, final_edit, final_edit`.
  2. Expands via `expandSteps`/`buildPipelineVars` to `chapters × 3` steps with
     no unsubstituted `{{vars}}`; fix + humanize steps carry `wordCountTarget`.
  3. All three new skills load via the real `SkillLoader` with non-empty
     single-line descriptions and expected trigger sets; category `author`.
  4. Audit skill content contains both pass rule-blocks and the per-model
     appendix headings; humanize skill contains the fallback banned-list marker.
- The existing `library-pipeline-skill-refs.test.ts` guard automatically covers
  the new pipeline's skill references resolving.

**Smoke test (integration surface):**

- New Phase 8 in `tests/smoke-test.sh` (pattern: Phase 7): with auth,
  `GET /api/library/pipeline` lists `editorial-fingerprint`;
  `GET /api/library/pipeline/editorial-fingerprint` serves the 3-stage expand
  block; `GET /api/skills` (`authoring.routes.ts`) includes `fingerprint-audit`,
  `humanize`, and `narrative-anti-fingerprint`.

**Verification commands:** `node --import tsx --test tests/unit/fingerprint-pipeline.test.ts`,
full `npm run test:unit`, `npx tsc --noEmit`, `bash tests/smoke-test.sh`.

## Rollout

Mercury first (`touch build_now`), verify the pipeline appears in the Studio and
a test book runs it; then Neptune via the documented manual deploy
(`docs/DEPLOYMENT.local.md`) with the standard pre-deploy backup.
