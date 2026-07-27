# Pipeline improvement plan — execution

**Date:** 2026-07-27
**Source:** [full-book-audits.md](full-book-audits.md) (rounds 1–3, Two Seasons of Summer & Firefly Pond).
**Status:** agreed approach, not yet implemented (except C0, coded this session). This supersedes the earlier problem→fix chart by baking in the chosen approaches from review.

The audit's core finding: the pipeline runs 136/136 but **neither book finishes** — the outline drops out of the Scene Brief context after ~ch9, so the back half re-plots and the HEA is never written, and the self-QA steps hallucinate a completion. The fixes below are organized as **four guard layers** plus supporting canon/voice/prose-safety work.

## Guard-layer architecture

| Layer | Guards | Change(s) | Catches |
|---|---|---|---|
| Plan | the outline/premise | C11 (light pacing review) | HEA has no chapter budget; beats in the wrong act |
| Generation | each chapter as written | C1 (two-tier outline) · C2 (pacing anchor) · C9 (voice) | a chapter wandering off its beat; converged voice |
| Prose safety | the de-AI edit | C8 (seam-guard hardening) | phantom characters, POV flips, duplications |
| Final manuscript | the assembled book | C3 (ending gate + full-book continuity) | a draft that silently stopped short |

No single layer is sufficient — the outlines already *contained* the HEA, so plan-level checks pass while generation drops it; that is why C2 (generation) and C3 (final) are both required.

---

## Change register

| ID | Bundle | Pri | Change | Chosen approach |
|---|---|:--:|---|---|
| C0 | 0 · Deploy | P0* | Persist chapter-count / words-per-chapter for premise books | **Coded this session** — length-only `format` in `buildBookFormat` + `PremiseIntake` sends counts. Deploy + verify. |
| C1 | A · Finish | P0 | Outline reaches every chapter | **Two-tier outline**, deterministic per-chapter assembly |
| C2 | A · Finish | P0 | Ending actually lands | **Per-chapter pacing anchor** + beat-to-chapter map |
| C3 | A · Finish | P0 | Detect an unfinished book | **Deterministic ending gate** + full-manuscript continuity review |
| C11 | A · Finish | P1 | Plan-level pacing sanity | **Romance-light pacing review** at premise (macro) + post-outline (micro), advisory |
| C4 | B · Canon | P1 | One source of canon truth | **Persistent canon fact-sheet** (static-authority), injected into every chapter + the audit |
| C5 | B · Canon | P1 | No name drift / invented cast | **Name every hinted person at intake**; Setting stops inventing names; flag any new proper noun |
| C6 | B · Canon | P1 | Consistency Audit stops rubber-stamping | Audit checks against the fact-sheet + **deterministic pre-checks** (names, POV/tense) |
| C7 | B · Canon | P1 | Bible/setting reconciled | Character Bible + Canon-Audit-Characters cross-check the fact-sheet |
| C8 | C · Prose safety | P1 | De-AI can't ruin prose | **Harden the seam guard**; phrase-level-only prompt; log trim%/tells |
| C9 | D · Voice | P2 | Authors sound different | **Prose-mechanics style card + few-shot exemplars** injected at draft time; premise↔SOUL fit check |
| C10 | D · Voice | P2 | Fewer AI-isms at the source | **Draft-time anti-AI-ism instructions** (positive) + a **tell-score** metric |

`P0*` = P0-level impact, already coded.

---

## Detailed changes

### C0 — Deploy the chapter-count/format fix (already coded)
- **What:** `buildBookFormat` accepts a length-only format (counts without structure/form); `PremiseIntake.tsx` sends `chapterCount`/`wordsPerChapter`. Fixes `format: None` → default 25×3000 and "30 became 25."
- **Files:** `gateway/src/services/format-input.ts`, `frontend/studio/src/routes/PremiseIntake.tsx` (done); tests in `tests/unit/book-format*.test.ts` (done).
- **Do:** deploy to Mercury (`touch build_now`) + smoke; then Neptune backup-first; create one premise book and confirm the manifest carries the chosen counts.

### C1 — Two-tier outline + deterministic per-chapter context  ✅ DONE (2026-07-27)
- **Goal:** every chapter's Scene Brief sees the whole arc **and** its exact beat.
- **Root cause (sharpened during implementation):** these projects have `type: 'romance-*-deterministic'`, so they hit the **default** branch of `buildProjectContext` — which had *no* per-chapter outline handling at all (that only existed in `book-production`). The outline reached a Scene Brief only as a head(5000)+tail(3000) slice of the outline step, so chapters ~10–23 landed in "[...middle omitted...]" — verbatim the "outline only runs through Chapter 9" drift.
- **Implemented:**
  1. New module `gateway/src/services/outline-skeleton.ts` — pure, code-only (no LLM call): `deriveShortOutline` (one compact entry per chapter: heading + **structural beat label** via `beatForChapter` + condensed POV·goal→outcome), `extractOutlineChapterSection` (moved here), `buildTwoTierOutlineBlock` (full skeleton + prior/current/next full sections; the final chapter's "next" slot instructs "deliver the ending/HEA now").
  2. `beatForChapter` uses the same `computeBeats` boundaries the outline was generated against (exported from `pipeline-vars.ts`), labelling Meet-cute / Inciting / Rising / Midpoint / Complications / Black moment / Grovel & reunion / HEA-HFN. **Content-derived tags** are layered on top (detected from the outline text, not position): **First Kiss** (first real-kiss chapter, read from the Outcome so "sets up the first kiss" isn't mistaken for it), **Intimate scene** (spice-gated — open-door pipelines only), and **Reunion** (grovel/reconciliation chapters, never the final HEA chapter). Verified on the real outlines: Firefly tags ch13 First Kiss, ch14/15/16/18/22 Intimate scene (the exact scenes the drafts had dropped), ch20–24 Reunion; Two Seasons (sweet) gets First Kiss + Reunion but no Intimate tags.
  3. Wired into `buildProjectContext`'s **default branch** for any step with a `chapterNumber`: injects the truncation-proof two-tier block and **excludes the outline step from the truncated prior-steps dump** so the model never sees a conflicting half-outline. Outline result is rehydrated (existing M6 restore) before slicing.
- **Files:** `gateway/src/services/outline-skeleton.ts` (new), `gateway/src/services/projects.ts` (import + default-branch wiring; local `extractOutlineChapterSection` removed), `gateway/src/services/pipeline-vars.ts` (export `computeBeats`).
- **Verified:** `tests/unit/outline-skeleton.test.ts` (6 tests) + full suite (2408 pass, 0 fail); against the real Two Seasons outline for ch16, all 25 chapters survive in the skeleton (no middle omitted), ch15/16/17 full sections present, beats land correctly (ch13 Midpoint, ch19 Black moment, ch25 HEA/HFN). Block ≈ 8 KB.
- **Note:** beat labels are romance-oriented (the current per-chapter pipelines are romance); parameterize by genre if a non-romance per-chapter pipeline is added later.

### C2 — Per-chapter pacing anchor
- **Goal:** force the ending to land even though the model under-weights position.
- **Approach:** build a **beat-to-chapter map** from the outline's structural beats + `chapterCount` (already have `setupEnd/midpoint/twist75/climaxStart/climaxEnd` from `buildPipelineVars`). Inject into each Scene Brief: *"You are at chapter N of M (Act X). This chapter's beat is ⟨beat⟩. The grovel/reunion/HEA must be fully delivered by chapter M."* In the final ~15% of chapters add an explicit "resolve now — do not defer to a later chapter."
- **Files:** `gateway/src/services/projects.ts` + `skills/**/romance-*-scene-brief/SKILL.md`.
- **Verify:** generate a short (6–8 ch) test book; the final chapter's brief demands the HEA and the draft delivers reunion + both leads.

### C3 — Ending gate + full-manuscript continuity review
- **Goal:** never ship an unfinished book or a hallucinated completion report.
- **Approach:**
  1. **Deterministic ending gate** after the last chapter: assert the final chapter contains the reunion, both leads present, and HEA/HFN markers. On failure → **fail loud** and route to the human **review gate** (`project.review`).
  2. Feed the **full manuscript** to the Continuity & Arc Review (step 135), chunked/map-reduce (same rehydration as C1) so it no longer sees only early chapters.
  3. Ground the Compile Report (step 136) in **detected facts** (chapter count, ending-gate result) instead of free narration.
- **Files:** new `gateway/src/services/ending-gate.ts`; steps 135/136 prompts; `projects.ts` review-gate wiring.
- **Verify:** run the gate over the two existing books → it must flag "no HEA delivered" for both.

### C11 — Romance-light pacing review (plan guard)
- **Goal:** cheap macro/micro sanity on the plan; **advisory, not a rewrite** (the heavy romantasy/MSF pacing review is too heavy-handed for romance).
- **Approach:** at **premise** (macro) confirm the arc names the required romance beats and an HEA; after **outline** (micro) confirm each act's chapter budget and that the grovel/reunion/HEA occupy the final-act window. Flag imbalances; do not rewrite.
- **Files:** new light skill `skills/**/romance-pacing-check/SKILL.md`; wire as advisory steps in `library/pipelines/romance-*-deterministic.json`.
- **Note:** this guards the plan only — it would have *passed* both audited books (their outlines were complete). It does not replace C2/C3.

### C4 — Persistent canon fact-sheet
- **Goal:** one maintained source of truth for generation **and** the consistency audit.
- **Approach:** after the Character Bible + Setting, build a **canon fact-sheet** (names + spellings, ages, relationships, POV/tense rule, key places, timeline anchors). **Static-authority** model: built once, then **flag any new proper noun** that appears during generation as a drift candidate (do not let the sheet grow unbounded). Inject the sheet (truncation-protected) into every chapter draft and hand it to the Consistency Audit.
- **Files:** new `gateway/src/services/canon-sheet.ts`; `projects.ts` context injection.
- **Verify:** sheet built from a bible lists every lead + cast with ages/POV; a chapter introducing "the Millers" gets flagged.

### C5 — Name everyone at intake; Setting stops inventing names
- **Goal:** remove the root of the name collisions (Setting seeds placeholders → Bible/drafts invent conflicting names).
- **Approach:** in **premise intake**, resolve every hinted-but-unnamed person to a canonical name, surfaced through the **existing `gaps[]` resolution UI** ("unnamed character → proposed name," human-confirmed). Stop the **Setting** step from inventing character names (separation of concerns). Names then flow bible→draft with no improvisation.
- **Files:** `gateway/src/services/premise-intake.ts` (add name-resolution gaps), `frontend/studio/src/routes/PremiseIntake.tsx`, setting prompt (`skills/**/book-bible` / setting template).
- **Verify:** a premise mentioning "her sister" and "the café owner" produces named gaps; created book's fact-sheet has those names locked.

### C6 — Consistency Audit uses the fact-sheet + deterministic pre-checks
- **Goal:** stop the empty-`[]` rubber-stamp.
- **Approach:** feed the audit the C4 fact-sheet and require per-item checks (names/ages/POV/tense/venues/timeline). Add cheap **deterministic pre-checks** that emit edits directly — name-registry membership + a POV/tense scan — so the LLM isn't the only line of defense.
- **Files:** `skills/**/romance-consistency-audit/SKILL.md`; `gateway/src/services/consistency/`.
- **Verify:** a chapter with a planted "Elena" (canon Caroline) and a present→past slip produces edits for both.

### C7 — Bible / Canon-Audit-Characters reconcile the fact-sheet
- **Goal:** stop the bible seeding contradictions the character audit misses.
- **Approach:** the Character Bible reconciles names/ages against the fact-sheet (post-C5 there is nothing to invent); Canon-Audit-Characters is given the fact-sheet and must cross-check and emit fixes rather than returning `[]`.
- **Files:** `skills/**/book-bible/SKILL.md`, `skills/**/romance-canon-audit/SKILL.md`.
- **Verify:** a bible that renames a setting-named parent gets a correcting edit from step 7.

### C8 — Harden the de-AI seam guard
- **Goal:** keep the de-AI step but make it **incapable of ruining prose** — worst case "no change," never corruption.
- **Approach:** the module is already audit→`find/replace` edit→deterministic apply with a seam guard (currently only orphaned-punct / emptied-quote). Extend the guard to **reject an edit and keep the original span** when its `replace`:
  - introduces a **proper noun or number** absent from `find` (kills "gift box"/"that woman"/"thirty-one" injections),
  - changes **grammatical person/POV** (I/me ↔ he/she/name),
  - **duplicates** an adjacent/seam sentence,
  - changes **length beyond a band** (>~30%).
  Constrain the audit prompt to **phrase-level only** ("preserve every proper noun, number, quoted line verbatim; add no characters/plot/dialogue"). **Log per-chapter trim% + tells-removed** so a bad sweep is visible.
- **Files:** `gateway/src/services/deai/merge-edits.ts` + a new `validate-edit.ts`; `run-step.ts` (prompt); logging.
- **Verify:** regression tests from the real corruptions (ch14 "gift box," ch16/18/20 POV flips, a duplicated seam sentence) — each rejected, original span retained.

### C9 — Voice-mechanics layer (make authors sound different)
- **Goal:** distinct prose even with shared elements and the same base model — the SOUL rewrites gave distinct *identity* but not distinct *prose*.
- **Approach (highest leverage first):**
  1. **Few-shot exemplars:** store 1–3 short (150–300 wd) gold passages per pen name in the voice profile; inject into the **first-draft** prompt: *"match the sentence rhythm, paragraph shape, and punctuation habits of these samples — not their content."*
  2. **Prose-mechanics style card** per author (measurable knobs, not mood words): sentence length + variance, paragraph length, punctuation fingerprint, POV/tense, metaphor domain, dialogue style — and **each author bans the other's signature**.
  3. **"How this author writes X" micro-templates** for the beats where both books converge (kiss, look, fight, humor); inject the matching one when the scene brief flags that beat.
  4. **Premise↔SOUL fit check at intake** (advisory, reuse discrepancy UI): flag when a premise is off the author's lane.
  - Inject the card + exemplars at **draft time** (not just planning) + a one-line voice reminder in the scene brief. **No post-hoc voice-rewrite pass** (drift risk); measure compliance instead.
- **Files:** `workspace/library/voices/*/VOICE-PROFILE.md` + `STYLE-GUIDE.md` (add Prose-mechanics + Exemplars blocks); `skills/**/romance-*-first-draft/SKILL.md` + scene-brief skill; `premise-intake.ts` (fit check).
- **Verify:** two chapters from different authors on the same beat diverge measurably (sentence-length distribution, punctuation rates) and do not share a climax speech.

### C10 — Draft-time anti-AI-ism instructions + tell-score
- **Goal:** cut the easy tells at the source so de-AI has less to (riskily) fix.
- **Approach:** a short, **positively-phrased** directive in the first-draft prompt ("vary sentence openings; prefer concrete verbs over felt/watched/noticed; avoid aphoristic one-line paragraph buttons"). Add a computable **tell-score** (filter-word density, fragment-button rate, burstiness) surfaced per chapter to measure whether it (and C8) actually move the needle.
- **Files:** `skills/**/romance-*-first-draft/SKILL.md`; new `gateway/src/services/deai/tell-score.ts`.
- **Verify:** tell-score drops on drafts generated with the directive vs. without.

---

## Execution order

| Phase | Changes | Exit check |
|:--:|---|---|
| 1 | **C0** (deploy the coded format fix) | Fresh premise book persists the chosen chapter/word counts |
| 2 | **C1 → C2 → C3** (+ C11) | Regenerate one short book end-to-end → **an HEA actually lands**; ending gate flags the two old books |
| 3 | **C4 → C5 → C6 → C7** | Planted name/age/tense drift is caught; no invented unregistered cast |
| 4 | **C8** | Known de-AI corruptions are rejected; prose never worse than input |
| 5 | **C9 → C10** | Two authors diverge measurably; tell-score drops |

Bundle A (phase 2) is the priority — it is what makes the books *finish*. Each phase should end by generating a short test book and re-running the relevant guard.

## Decisions locked (from review)
- **Short outline: code-derived**, not a second LLM call (fidelity + count guaranteed).
- **Canon fact-sheet: static-authority + flag-new**, not an unbounded updating registry.
- **Names resolved at intake** via the existing gap UI; Setting no longer invents names.
- **De-AI kept**, hardened to fail-safe (reject → keep original span); not replaced.
- **Voice via exemplars + measurable mechanics at draft time**; no separate voice-rewrite pass.
- **Three finish-guards are all required** (pacing review = plan, anchor = generation, ending gate = final) — none substitutes for another.

## Open items to decide before/while building
- Where the **voice exemplars** come from per pen name (author-written vs. curated-and-approved once).
- Whether the **ending gate** hard-blocks assembly or only warns + routes to the review gate (recommended: routes to review gate, consistent with the existing human-in-the-loop pattern).
- Exact **tell-score thresholds** (calibrate against the two audited books as the "too high" baseline).
