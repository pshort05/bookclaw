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

### C3 — Ending gate (never ship an unfinished book / hallucinated report)  ✅ DONE (2026-07-27) — step-135 full-manuscript feed deferred
- **Goal:** never ship a book that drops the HEA, and never let the completion report claim one that isn't there.
- **Design note (forced by real data):** a purely lexical HEA detector was built and run against the two real final chapters — **both came back `uncertain`, not `missing`** (romance prose conflates plot mentions like the antagonist's "engaged/married" with the couple's resolution). So the **reliable gate is the LLM check with the beat**, and the deterministic detector is demoted to a grounding/backstop signal.
- **Implemented:**
  1. **Beat-aware chapter check (the real gate):** `maybeOpenCadenceGate` now feeds each chapter's beat (C1's `beatForChapter`) to the chapter checker; the FINAL chapter's beat is **"HEA / HFN"**, so a dropped ending returns `BEAT: missing → stall → force-gate`.
  2. **Deterministic backstop + finding:** `gateway/src/services/pipeline/ending-gate.ts` `detectEnding(finalText, leadNames?)` → `delivered | missing | uncertain` from HEA vs. rupture signals (rupture only counted in the last ~1,200 chars, resolution-guarded). Runs on the final chapter → `findings.ending`; a clear-cut `missing` also force-gates even if the LLM is unavailable.
  3. **Grounded compile report (step 136):** `buildProjectContext` injects the detected ending status into the assembly step's context ("do not claim a reunion/HEA the manuscript does not contain") — runs even **headless** (no LLM), so an autonomous book still reports the truth.
- **Files:** `gateway/src/services/pipeline/ending-gate.ts` (new); `gateway/src/services/human-review.ts`; `gateway/src/services/projects.ts`.
- **Verified:** `ending-gate` unit tests (delivered/missing/uncertain, resolution-guard, optional leads) + `romance-gate` final-chapter test (force-gate on a missing ending under autonomous cadence + Strong rating; HEA beat fed to the checker) + full suite 2426/0; `tsc` clean. Against the real books the deterministic detector reads `uncertain` and surfaces the rupture signals (Firefly: "went dark, screen dimmed") — enough to ground the report; the LLM beat-check is what firmly force-gates.
- **Deferred:** feeding the **full manuscript** to the Continuity & Arc Review (step 135) — a larger context-assembly change; the beat-check + grounded report already close the "silent unfinished book" hole.

### C11 — Romance engagement checkers (book + chapter), human-gated  ✅ DONE (2026-07-27)
Adapted the maintainer's action-oriented `engagement-checker.json` into two romance prompts and wired them to the existing human-review gate (no new gate machinery).
- **Two prompts** (`library/prompts/`): **romance-arc-checker** (whole book — arc/beat map, tension/pull audit with a romance toolkit, and an explicit **genre-promise PASS/FAIL** on HEA delivery) and **romance-chapter-checker** (single chapter — ADVANCE / TENSION / HOOK / BEAT-FIT → RATING · ISSUE · FIX). Runnable standalone via the Prompt Runner.
- **Wiring** (`services/pipeline/romance-checks.ts` + `human-review.ts` `maybeOpenCadenceGate`, gated on `project.type` matching romance, fail-soft): the **arc checker** runs on the outline at the always-on `outline_approved` gate (validate the plan before generation) → `findings.romanceArc`; the **chapter checker** runs on a **cheap route** (OpenRouter/Haiku) for **every** chapter and **FORCE-OPENS** a gate on a `Stall` verdict even when the book's cadence would not pause → `findings.romanceChapter`. Both surface in the Confirmations screen; a person approves / edits / regenerates / stops.
- **Files:** `library/prompts/romance-arc-checker.json`, `library/prompts/romance-chapter-checker.json` (new); `gateway/src/services/pipeline/romance-checks.ts` (new); `gateway/src/services/human-review.ts`; call sites in `gateway/src/api/routes/projects.routes.ts` (×2) + `gateway/src/index.ts`.
- **Verified:** `romance-checks` + `romance-gate` unit tests (verdict parse, cheap-route, fail-soft, force-gate-on-Stall, arc-annotates-outline, inert-for-non-romance) + full suite 2419/0; `tsc` clean; both prompts validate via `parsePrompt`. Headless/autonomous runs skip it (existing posture).
- **Note:** the plan-only guard still passes a complete-but-later-dropped outline, so this complements — does not replace — C3's deterministic ending gate. The C2 numeric anchor below is now largely subsumed by C1's skeleton ("deliver the ending/HEA now" on the final chapter) plus this chapter checker; the explicit "chapter N of M" line remains an optional small add.

### C4 — Persistent canon fact-sheet  ✅ DONE (2026-07-27)
- **Goal:** one maintained source of truth for generation **and** the consistency audit.
- **Implemented (config-not-code: an LLM extraction step + a fully deterministic, unit-tested module):**
  1. **New "Canon Fact-Sheet" pipeline step** (2 deterministic pipelines, inserted after the Character-Bible canon gate, cheap Haiku, `modelOverride`): distils the bible + setting into strict JSON — `{characters:[{name,aliases,age,role,relationships}], povTense, places, timeline}`.
  2. **`gateway/src/services/pipeline/canon-sheet.ts`** (pure): `parseCanonSheet` (fail-soft JSON), `formatCanonSheet` (compact injectable block), `collectCanonNouns` (canonical name/alias/place tokens), `flagNewProperNouns` (Title-Case runs + mid-sentence single capitals not in canon, leading-stopword-trimmed, sentence-initial-skipped).
  3. **Injection** (`projects.ts` `buildProjectContext`): the formatted canon block is injected **truncation-protected** into every per-chapter step — the drafts *and* the Consistency Audit — and the raw JSON step is excluded from the truncated prior-steps dump.
  4. **Flag-new** (`human-review.ts` `maybeOpenCadenceGate`): proper nouns a chapter introduces that aren't in the sheet attach as an advisory `findings.newNouns` on whatever gate opens (not a force-gate — new capitalized words are common). Static-authority + flag-new, no unbounded growth.
- **Files:** `gateway/src/services/pipeline/canon-sheet.ts` (new); `library/pipelines/romance-{sweet,spicy}-deterministic.json` (+1 step); `gateway/src/services/projects.ts`; `gateway/src/services/human-review.ts`.
- **Verified:** `canon-sheet` unit tests (parse/format/collect/flag — incl. "Denny Alvarez"/"the Millers"/"Deja" flagged, canon names + sentence-initial skipped) + a `romance-gate` newNouns test + full suite 2433/0; `tsc` clean; both pipelines re-parse (base steps 12 → 13).
- **Note:** this also **partly serves C6** — the Consistency Audit now receives the canon sheet in context; C6 adds the explicit "check against it + deterministic name/POV/tense pre-checks" instruction.

### C5 — Name everyone at intake; Setting stops inventing names  ✅ DONE (2026-07-27) — lean/prompt-only
- **Goal:** remove the root of the name collisions (Setting seeds placeholders → Bible/drafts invent conflicting names).
- **Implemented (prompt changes, no new code — the existing `gaps[]` flow already carries name gaps into the characters seed):**
  1. **Name resolution at intake** — `premise-intake.ts` `PARSE_SYSTEM` now instructs the parser to emit a gap with a **proposed name** for every person the premise references but doesn't name (targetField `characters`), surfaced in the existing gaps UI for human confirmation.
  2. **Anti-AI-name recommendations** — the name-proposal guidance pulls the AI-tell list from the **Sarah Chen** editor (`library/editors/sarah.json`): avoid Sarah Chen / Marcus / Elara / Aria / Luna / the US top-10, cap the "-a" female-ending overuse at ~30%, keep names phonetically distinct, prefer distinctive rank-51+ culturally-grounded names.
  3. **Setting stops inventing names** — a "SETTING ONLY: do not name/roster/invent people; the character bible owns every character name" clause added to the Setting step in all **5 romance pipelines**.
  4. **Bible light touch** — a "use the character names given VERBATIM; never rename/merge/split/invent" clause added to the Character Bible step in the **2 deterministic** pipelines (the full/legacy Bible prompts phrase it differently — left for later).
- **Files:** `gateway/src/services/premise-intake.ts`; `library/pipelines/romance-{sweet,spicy}-{deterministic,full}.json` + `romance-sweet-full-legacy.json`.
- **Verified:** `tsc` clean, premise-intake unit tests + full suite 2428/0, all pipeline JSONs re-parse, clauses present. **Prompt-only, so behavioural verification is integration** — run `POST /api/books/intake` on Mercury with a premise containing unnamed people ("her sister", "the café owner") → confirm name gaps appear with non-AI names; generate a Setting → confirm no invented character names.
- **Note:** C4 (the persistent canon fact-sheet) will formally *lock* these intake-resolved names; C5 removes the improvisation, C4 anchors it.

### C6 — Consistency Audit uses the fact-sheet + deterministic pre-checks  ✅ DONE (2026-07-27)
- **Goal:** stop the empty-`[]` rubber-stamp.
- **Implemented:**
  1. **Audit anchored on the canon fact-sheet** — the Consistency-Audit **step prompt** (both deterministic pipelines) and the **`romance-consistency-audit` skill** now make the C4 fact-sheet the primary authority: verify every character name + age, the POV/tense, and every place against it and emit an edit per mismatch — "an empty array is a positive claim you verified all of them," not the default.
  2. **POV/tense pre-check bullet** added to the skill's check list (flag a present→past slip with a `rewrite` edit).
  3. **Deterministic pre-check** — `checkPovTense(chapterText, povTense)` in `canon-sheet.ts` (strips dialogue, compares narration past vs present markers; conservative thresholds) surfaces `findings.povTense` on the gate — the LLM isn't the only line of defense. (Deterministic name-drift already rides C4's `flagNewProperNouns`/`newNouns`.)
- **Files:** `library/pipelines/romance-{sweet,spicy}-deterministic.json` (step prompt); `skills/author/romance-consistency-audit/SKILL.md`; `gateway/src/services/pipeline/canon-sheet.ts`; `gateway/src/services/human-review.ts`.
- **Verified:** `checkPovTense` unit test (clear present→past slip flagged, matching tense + no-rule pass) + full suite 2434/0; `tsc` clean; pipelines re-parse.
- **Note:** deterministic edits that AUTO-FIX names/ages aren't emitted (which side is canonical is ambiguous to fix blindly) — the sheet-anchored LLM audit does the fixing; the deterministic layer FLAGS (newNouns, povTense) so nothing silently slips.

### C7 — Bible / Canon-Audit-Characters reconcile  ✅ DONE (2026-07-27) — prompt-only
- **Goal:** stop the bible seeding contradictions the character audit misses.
- **Ordering correction:** the C4 fact-sheet is built *after* the bible, so the bible/audit reconcile against the **premise + intake-resolved names** (upstream), not the fact-sheet. C5 already reinforced the bible; C7 makes the character audit actually cross-check.
- **Implemented (prompt-only):**
  1. **Canon-Audit-Characters** — the `romance-canon-audit` skill gains a **"Character consistency"** section (the premise + intake character notes are anchors for a character bible; flag any character the bible renamed / re-aged / mis-related / invented; an empty array asserts you checked every named person), and the **step-7 prompt** (both deterministic pipelines) now requires that cross-check and forbids empty-by-default.
  2. **Character Bible** — the C5 verbatim-names clause extended to **names, ages AND relationships** ("never rename, re-age, re-relate, merge, split, or invent named characters").
- **Files:** `skills/author/romance-canon-audit/SKILL.md`; `library/pipelines/romance-{sweet,spicy}-deterministic.json` (step-7 + bible prompts).
- **Verified:** full suite 2434/0 (no code change); both pipelines re-parse; all three edits (skill section, step-7 cross-check, bible ages/relationships) confirmed present.
- **Note:** deterministic bible-vs-premise name flagging wasn't added (C5 removed the root — Setting no longer invents names — and C4's `newNouns` catches invented names at the chapter level); could be added if the sheet-anchored audit still misses bible-level drift.

### C8 — Harden the de-AI seam guard  ✅ DONE (2026-07-27)
- **Goal:** keep the de-AI step but make it **incapable of ruining prose** — worst case "no change," never corruption.
- **Implemented:**
  1. **`gateway/src/services/deai/validate-edit.ts`** (new, pure) — `unsafeEditReason(find, replace)` rejects a de-AI edit whose `replace` injects a **proper noun** (phantom/POV-intrusion names like "Addi", name-vs-sentence-starter aware), a **number** (digit or a "thirty-one"-style word ≥ twenty), **flips grammatical person** (first ↔ third), or **duplicates a word** ("involuntary, involuntary").
  2. **Scoped to the de-AI path** — `applyDeAiEdits` gains an `opts.guardEntities` flag; a rejected edit keeps the original span (`skipped`+`malformed`). **Only the de-AI call site sets it** — the *consistency* apply is untouched, because a consistency edit legitimately swaps names/numbers ("Elena"→"Caroline", age 31→27).
  3. **Prompt constraint** — `run-step.ts` appends HARD CONSTRAINTS to every audit window (preserve proper nouns/numbers/quotes, keep person/POV, add no content, no repeated words) so the model stops emitting the edits the guard rejects.
  4. **Per-chapter log** — trim% + count of unsafe edits rejected, so a bad sweep is visible.
  5. **Em-dash frequency cap** (`deai/em-dash.ts`, new) — LLMs over-produce em-dashes (one per paragraph vs. a human's one or two per chapter). A deterministic final pass keeps the first `EM_DASH_BUDGET` (3) MID-SENTENCE em-dashes and converts the excess to commas; **dialogue-interruption em-dashes** (`—"` / line-end) are exempt and never counted. Verified on the real chapters (e.g. Two Seasons ch25: 10 → 5, Firefly ch12: 7 → 3). Not a global *ban* (voice-safe), a *cap*.
- **Files:** `gateway/src/services/deai/validate-edit.ts` (new); `gateway/src/services/deai/em-dash.ts` (new); `gateway/src/services/deterministic-apply.ts` (guardEntities); `gateway/src/services/deai/run-step.ts` (constraint + em-dash cap + log).
- **Verified:** `deai-validate-edit` tests (the real corruptions rejected — name intrusion, POV flip, "involuntary, involuntary", "thirty-one"; legit rephrases like the "let out a breath…"→"exhaled" trim pass) + a `deterministic-apply` test proving the guarded de-AI apply rejects while the unguarded consistency apply still applies the same name swap + full suite 2437/0; `tsc` clean.
- **Honest limit:** a same-length swap of one common noun for a phantom ("her hand" → "the gift box") is not deterministically detectable — the prompt constraint + the length guard address it, the entity guard does not.

### C9 — Voice-mechanics layer (make authors sound different)  ✅ DONE (2026-07-27)
- **Goal:** distinct prose even with shared elements and the same base model — the SOUL rewrites gave distinct *identity* but not distinct *prose*.
- **Key realization:** the injection is **free** — `SoulService.composeForBook` already reads each voice's `STYLE-GUIDE.md` + `VOICE-PROFILE.md` **in full** into the draft system prompt. So C9 = a convention + an instruction + content, no new wiring.
- **Implemented:**
  1. **Few-shot exemplars + prose-mechanics convention** — the voice `STYLE-GUIDE.md` gains a `## Prose Mechanics` block (measurable knobs: sentence length/variance, paragraph length, punctuation fingerprint, POV/tense, metaphor domain, dialogue) and a `## Voice Exemplars` block (1–3 short gold passages), **each pen name banning the other's signature**.
  2. **The instruction that makes exemplars work** — both `romance-{sweet,spicy}-first-draft` skills now say: match the exemplars' rhythm/paragraph-shape/punctuation (imitate the *style*, not content/names), hit the prose-mechanics targets, and never drift to a generic register.
  3. **Seeded the two live authors** (Neptune): HK Shaewood (short punchy NYC-contemporary, parentheticals + italics, food/transit metaphors, closed-door) and KS Rhysdale (longer flowing present-tense dual-POV, bodily/sensory, heat-on-the-page) each got a Prose Mechanics card + a starter exemplar — pushed via the library API (STYLE-GUIDE.md, reloaded).
  4. **Convention documented** in `docs/HOW-TO-CREATE-AUTHOR-PROFILES.md` for future pen names.
- **Deliberately not done:** a post-hoc voice-rewrite pass (drift risk — the plan itself rules it out). **Deferred:** the premise↔SOUL fit-check at intake (#4) and the "how this author writes X" beat micro-templates (#3) — the exemplars + mechanics are the high-leverage 80%.
- **Files:** `skills/author/romance-{sweet,spicy}-first-draft/SKILL.md`; `docs/HOW-TO-CREATE-AUTHOR-PROFILES.md`; (data) Neptune `voices/{hk-shaewood,ks-rhysdale}/STYLE-GUIDE.md`.
- **Verify:** two chapters from different authors on the same beat diverge measurably (sentence-length distribution, punctuation rates) and do not share a climax speech — an integration check on newly-generated books.

### C10 — Draft-time anti-AI-ism instructions + tell-score  ✅ DONE (2026-07-27) — drew on the maintainer's long de-AI prompt
- **Goal:** cut the easy tells at the source so de-AI has less to (riskily) fix.
- **Implemented:**
  1. **Draft-time directive** — a short "Avoid these AI tells" block added to both `romance-{sweet,spicy}-first-draft` skills (no filter verbs she-felt/he-watched; no "the way he/she" crutch or aphoristic one-line buttons; a tight never-use list; plain-over-wordy). Kept short on purpose (the long-prompt "bleed-through" lesson).
  2. **Tell-score already exists** — the **craft-critic** computes `filterWordRate`, `adverbRate`, and telling-density per chapter and is already surfaced at the review gate (C2 wired `analyzeChapter`). No new tell-score module needed.
- **Also into C8 (from the same source prompt):** `library/banned-terms.csv` grew **4 → 65 rows** — 10 safe **fixed** narration swaps ("in order to"→"to", utilize→use…) + 55 **ban-only** AI clichés and filter phrases (tapestry, meticulous, poignant, "a testament to", "he watched"…) injected into the de-AI audit's forbidden list. The registry was nearly empty, which is why lexical tells bled through; this is the biggest single de-AI improvement.
- **Deliberately NOT added:** a global **em-dash ban** — it's voice-dependent (HK Shaewood's SOUL *uses* em-dashes); leave to a per-author overlay.
- **Files:** `skills/author/romance-{sweet,spicy}-first-draft/SKILL.md`; `library/banned-terms.csv`.
- **Verified:** banned-terms loader tests 13/0 against the populated CSV + full suite 2437/0; `tsc` clean.
- **Optional follow-up:** a residual-AI-word count surfaced per chapter would need the book's banned list threaded into the gate; `forbiddenWordsInNarration` already exists to compute it.

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
