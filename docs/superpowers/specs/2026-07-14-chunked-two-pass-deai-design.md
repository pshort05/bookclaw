# Chunked Two-Pass De-AI Sweep + Banned-Terms Registry — Design

**Date:** 2026-07-14
**Owner ask:** the de-AI humanizer catches ~80–90% of AI tells on one pass; the
author then does a second pass by hand. Automate that second pass, and make the
detector reliable across a full 3,000–5,000-word chapter (the author used to have to
"chunk" chapters into ~1,000-word sections to get good detection). Cost is
acceptable if it reduces manual editing. **Also** re-introduce the author's large
curated prohibited-words/phrases list — deterministically now that a fixed
replacement is a no-cost operation (e.g. `"phone buzzed" → "phone vibrated"`).

## Problem (from the project-75 chapter-1 review)

Two independent leaks produce the 10–20% remainder:

1. **Top-N per pass.** A single audit returns only the most salient handful per
   category. In ch1 the de-AI audit caught 3 rule-of-three instances and left ~4 of
   the same class. Re-running catches these.
2. **Taxonomy blind spots.** `skills/author/romance-deai-audit/SKILL.md` never names
   two categories that recur in the output, so they can't be caught *no matter how
   many identical passes run*:
   - **aphoristic "button" sentences** — "That's the thing about Fran." / "That's as
     close to praying as I get." / "That's the part nobody tells you about drowning."
   - **generalizing second-person** — "You don't stand around listening to bad news.
     You pull dough."

Separately, the audit today reads the **whole chapter in one prompt, no windowing**.
Raw context is *not* the limit (a 5K-word chapter ≈ 6–7K tokens fits every routed
model). The real limits are **attention dilution** ("lost in the middle"),
**verbatim-find accuracy** (the applier silently drops any `find` that isn't
byte-exact — longer context degrades exact quoting), and the **top-N** effect above.
Chunking to ~1,000 words fixes all three, which is why the author's manual chunking
worked.

## Goals

1. Automate the second pass (author currently does it by hand).
2. Close the taxonomy blind spots (leak #2).
3. Restore full-chapter detection recall + verbatim accuracy via chunking.
4. Keep the shipped **audit → deterministic-apply** contract (no regeneration;
   length-neutral; only named spans touched).
5. Model diversity across passes (detector family ≠ writer family — see §4).

## Design

### 0. Deterministic banned-terms pass + forbidden-words injection (no LLM)
A curated prohibited-terms registry applied by pure string replacement — no model,
zero cost, 100% recall. This is a strictly better tool than an LLM for anything with
a fixed answer, so it owns those cases and keeps them out of the LLM's limited
attention budget.

- **Two entry types (the behavioral axis, not the author's AI-vs-personal buckets):**
  - **Fixed substitution** `{find, replace}` — `"phone buzzed" → "phone vibrated"`.
    Applied deterministically. Most of the personal never-use list.
  - **Ban-only** `{find}` (blank replacement) — a term to remove whose correct
    replacement is context-dependent (e.g. "delve", "a tapestry of"). NOT
    hard-replaced (that would flatten prose); instead **injected into the LLM de-AI
    audit as the forbidden-words list** (fulfilling the skill's existing
    "forbidden-words list in your context" reference), so the model rewrites it in
    context.
- **Narration only — dialogue is always skipped** (text inside quotation marks), for
  both the deterministic pass and the ban-only injection. Rationale: these are the
  *author's* voice filters; applying them to dialogue would homogenize characters
  toward the author. Skipping dialogue is how the list actively **protects** character
  distinctiveness. Consistent with the de-AI audit's existing "never flag dialogue"
  rule. Markdown (headers, `---`, `*italics*` markers) is also skipped.
- **Matching:** case-insensitive match, **case-preserving** replace ("Phone buzzed"
  at a sentence start → "Phone vibrated"); **word-boundary** aware so a bare word
  can't hit inside another word. Prefer **phrase** entries over bare words where
  context matters; genuinely ambiguous single words belong in the ban-only bucket.
  Literal phrases only (no morphology inference — the author lists variants
  explicitly).
- **Storage — CSV, global master + per-book overlay** (mirrors the library/skills
  overlay). Columns: `find,replace,bucket?` — blank `replace` = ban-only; `bucket`
  (`ai|personal`) is organizational, ignored by code. Global:
  `workspace/.config/banned-terms.csv`; per-book overlay:
  `workspace/books/<slug>/banned-terms.csv` (extends, create-or-override by `find`).
  Seed the global file by importing the old `ClaudeHumanizer`/`GeminiHumanizer` list.
- **Runs FIRST**, before the LLM passes (see §3), clearing known offenders for free
  so the LLM only spends attention on context-dependent tells.
- **Preview/dry-run + reporting:** a dry-run reports what *would* change before
  applying (tune a new entry before it rewrites 36 chapters); the live pass logs
  per-term replacement counts (extend the `applyDeAiEdits` stats) so dead entries can
  be pruned.

### 1. Broaden the taxonomy (`romance-deai-audit`, and the spicy twin if separate)
Add to the "What to flag" list:
- **aphoristic-button / sententious one-liner** — a short declarative that buttons a
  paragraph/scene with a "profound" generalization → `rewrite`: ground it in the
  concrete beat, similar length, or cut.
- **generalizing-second-person** — a "you"-addressed general truth used as interior
  narration → `rewrite`: return to the narrator's specific first person, similar
  length.
Directly closes leak #2 so pass 1's 80–90% covers more categories to begin with.

### 2. Chunk the chapter (~1,000-word windows)
- Split the draft at **paragraph / scene-break (`---`) boundaries**, never
  mid-sentence, targeting ~1,000 words per window (a window may run over to avoid
  splitting a paragraph). Verbatim `find` spans stay clean.
- Audit **each window independently**; merge the per-window edit-lists; run
  `applyDeAiEdits` **once** on the whole chapter.
- **Seam context:** give each window the previous window's **last paragraph as
  read-only context** (detect cross-seam tells — echo-line, a button echoing an
  earlier line — but only emit edits *inside* the current window). Prevents seams
  from hiding pairs.

### 3. Two passes (second-reader), capped at 2
Per-chapter order: **banned-terms replace (§0) → de-AI pass 1 → apply → de-AI pass 2
→ apply.** The ban-only terms from §0 are injected into both LLM passes' context.
- **Pass 1 — broad sweep, chunked:** the (broadened) `romance-deai-audit` per window.
- **Pass 2 — second-reader, chunked:** re-window the **applied** text; a pass-2
  prompt framing — "the obvious tells are already gone; hunt the subtler residue that
  survives a first edit: sententious buttons, echo rhythms, generalizing asides." This
  redirects attention rather than re-surfacing the same top-N (the "completeness
  critic" pattern — the automated version of the author's manual pass).
- **Cap at 2 passes; short-circuit** any pass whose merged edit-list is empty.
- Over-edit is structurally bounded: the applier is length-neutral and only touches
  named spans, so extra passes cannot flatten voice.

### 4. Per-pass model config (detector family ≠ writer family)
- Chapters in the reference book are written by **Claude Opus 4.8**. A model is
  weakest at detecting its **own family's** tells, so the primary detector should be a
  **different family** from the writer.
- **Defaults:** Pass 1 = **Gemini** (non-Anthropic; best at catching Opus tells;
  Flash/Fast tier is fine — chunking compensates for its looser quoting). Pass 2 =
  **Haiku** (different eyes from Gemini; Anthropic models quote byte-exactly, useful
  for the subtle residue pass).
- **Configurable, not hardcoded:** add `deai_pass1` / `deai_pass2` slots to the
  existing per-book `stageModels` map (this book already carries
  `creative_writing`/`revision`/`outline`/`consistency` there). If the *writing* model
  ever changes family, the author flips the detector defaults with no code change.
- Same-family-two-tiers (e.g. Haiku+Opus) is the weak version; the win is different
  *families*. Note: today the two audit *types* already split models
  (consistency→Haiku, de-AI→Gemini-Pro), so a per-pass split on the de-AI stage
  extends an existing concept.

## Components / boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| banned-terms registry | load global CSV + per-book overlay; expose fixed-map + ban-only sets | overlay resolver |
| `applyBannedTerms(text)` | case-preserving, word-boundary, narration-only deterministic replace + stats | dialogue/markdown span detector |
| `chunkChapter(text, ~1000)` | paragraph/scene-break windows + prev-paragraph seam context | none (pure) |
| de-AI audit (pass 1/2) | per-window LLM detection → edit-list | AIRouter (`deai_pass1/2` model), `romance-deai-audit` |
| merge/dedupe | union per-window edit-lists, dedupe by `find` | none |
| `applyDeAiEdits` | existing deterministic splice (unchanged) | `deterministic-apply.ts` |
| pipeline wiring | two audit passes + one apply per chapter | ProjectEngine / projects.routes |

## Error handling / fail-soft
- A window audit error → skip that window's edits, log `⚠`, continue (never block the
  chapter).
- Non-exact `find` → already dropped by `applyDeAiEdits` (unchanged).
- Empty merged list on a pass → short-circuit (no apply, no wasted call).

## Testing
- Unit: `applyBannedTerms` — case-preserving replace at sentence start; word-boundary
  (bare word doesn't hit inside another word); **dialogue untouched** (a banned term
  inside quotes survives); markdown untouched; blank-replace entry is NOT
  hard-replaced but surfaces in the injected forbidden-words set; per-term counts
  reported; per-book overlay overrides global by `find`.
- Unit: `chunkChapter` never splits mid-sentence; windows ≈1K words; seam paragraph
  passed read-only; a chapter < 1K words → single window (no behavior change).
- Unit: merge/dedupe unions windows and drops duplicate `find`s.
- Fixture regression (ch1): the aphoristic-button and generalizing-second-person
  lines are flagged (leak #2 closed); after 2 passes the residual rule-of-three count
  drops to 0 in the fixture.
- Cost guard: assert pass count ≤ 2 and empty-pass short-circuit fires.

## Cost note
~5 windows × 2 passes ≈ 10 small audit calls/chapter (tiny outputs, cheap models) vs
1 today. Baseline book ≈ $20; the added detection cost is a few dollars at most —
explicitly acceptable per owner in exchange for removing the manual pass.

## Out of scope
- A studio UI for editing the banned-terms list — author hand-edits the CSV for now
  (a management screen can follow once the format proves out).
- Regex/pattern banned-term entries and morphology inference (literal phrases only v1).
- Applying chunking to the *consistency* audit (separate; could follow).
- Iterate-to-convergence beyond 2 passes (revisit only if 2 proves insufficient).
- Changing the deterministic apply itself (contract unchanged).
