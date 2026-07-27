# Full-book audits — Two Seasons of Summer & Firefly Pond

**Date:** 2026-07-27
**Scope:** Two completed 25-chapter novels generated on Neptune (production) after the per-author-model / heat-routing work landed, audited across three rounds by fanned-out agents (rounds 1–2 whole-book; round 3 per-step, 0–10 against each step's intended purpose).

| Book | Slug / project | Author | Pipeline | Heat |
|---|---|---|---|---|
| **Two Seasons of Summer** | `two-seasons-of-summer` / project-81 | HK Shaewood | `romance-sweet-deterministic` | closed-door / fade-to-black |
| **Firefly Pond** | `firefly-pond` / project-82 | KS Rhysdale | `romance-spicy-deterministic` | open-door / explicit |

Both created from premise-file **seeds** (storyArc/characters/setting/blueprint); both manifests have **`format: None`** (see [Chapter-count root cause](#chapter-count-why-25-not-30)).

---

## Executive verdict

| Dimension | Two Seasons | Firefly Pond |
|---|---|---|
| Pipeline succession & completion | ✅ clean end-to-end (136/136) | ✅ clean end-to-end (136/136) |
| Author-voice fidelity | ⚠️ 5/10 | ⚠️ 4/10 |
| Author distinctness (do they read as 2 authors?) | ❌ **No — one voice, two names** | |
| Heat-level routing | ✅ closed-door confirmed | ✅ explicit confirmed |
| Residual AI-isms (post de-AI sweep) | 🟡 light–moderate (cleaner) | 🟠 moderate (heavier) |
| Consistency | 🟠 severe back-half drift | 🔴 multiple high-severity defects |
| Outline/premise faithfulness | 4.5/10 | 3.5/10 |
| Word count vs target | ❌ 71,850 (target 55–65k) | ✅ 73,066 (target 70–80k) |
| Chapter count vs selection | 25 (no target persisted) | 25 (you selected 30) |

**One-line bottom line:** the pipeline runs flawlessly and heat/models route correctly, but **neither book is actually finished** — both deliver ~the first 45–75% of their planned story with the mandatory Happy-Ever-After missing, and the system's own completion reports don't know it.

---

## Round 1 — pipeline, authors, AI-isms, consistency

### 1. Pipeline succession & completion — ✅ both clean
Both projects ran the 136-step deterministic romance pipeline exactly: 9-step planning prefix (Council → Premise → Setting → Canon Audit/Gate Setting → Character Bible → Canon Audit/Gate Characters → Chapter Outline) → 25 chapters × the exact 5-substep cycle (Scene Brief → First Draft → Consistency Audit → Consistency Apply → Humanize/De-AI Sweep) → Continuity & Arc Review → Compile. Every step `completed`, in order, no failed/skipped/duplicated/missing substeps. **All defects below are content, not orchestration.**

### 2. Author comparison — heat right, voice homogeneous
- **Heat routing worked (the clear win):** Two Seasons stays closed-door (peak = a truck kiss that fades to black); Firefly is unambiguously open-door on-page (ch24). Per-author model + heat setup does its job on heat.
- **Voice fidelity low + settings off-lane:** Two Seasons became a *bakery rivalry on Long Beach Island* (not HK Shaewood's STEM/romantasy lane); Firefly became a *Manhattan AI-startup slow-burn* (not KS Rhysdale's blue-collar grumpy/sunshine, and a **slow burn**, which her profile lists under *Avoids*). The distinctive voice markers written into each SOUL (Shaewood's high-low diction + comedic hyperbole; Rhysdale's blunt possessive dirty-talk + insta-lust) are largely absent.
- **❌ Distinctness FAIL — one voice, two names.** Both climaxes (ch25) hinge on the *same* speech ("you don't get to decide what I can carry/hold"), the *same* hidden-document betrayal device, and a shared motif kit (oat-milk coffee, face-down phones, wedding-swatch folders, gold streetlight). **Smoking gun:** Firefly ch24 calls its hero "**Ferraro**" — the *other book's* heroine's surname — a direct generation-context leak. **[Corrected in Round 3: this is NOT a cross-book leak — Ferraro is Two Seasons' canonical protagonist surname (Gia/Sal/Francesca Ferraro), and the model independently reused "Ferraro" in Firefly (hero's mother "Rosa Ferraro"). It is a model-favorite-surname / distinctness signal, not context contamination.]**
- **Why:** setting/premise come from the council step (which ignores the author's lane), and the author **SOUL profile is not strongly steering the prose voice** — generation converges to one literary register regardless of profile. Model differences (Opus/Sonnet swap) do not yield divergent voices.

### 3. Residual AI-isms (measured AFTER the de-AI humanize sweep)
- **Sweep eradicates the lexical cliché list:** "a testament to", "in that moment", "the air was thick/charged", "not just X but Y", "let out a breath he didn't know he was holding", "couldn't help but" → **0 hits in both books.** Very effective on the textbook list.
- **Structural tells survive (the sweep doesn't touch these):** filter words (felt/watched/noticed), the "the way he/she…" appositive, "the kind of", "somehow", "something in [chest/ribs]", and aphoristic sentence-fragment "buttons".
- **Two Seasons = light–moderate (cleaner):** filter-word density (`felt` 101, `watched` 58, `noticed` 36), "the way he/she" tic (133×).
- **Firefly = moderate (heavier):** aphoristic fragment-buttons are its default paragraph ending (~3× Two Seasons' rate), plus 2nd-person "the way you…" drift (21×). First-person present tense hides filter words from grep.

### 4. Consistency
Both: clean, polished openings; a structurally-divergent, **unreviewed** back half (ch24–25).
- **Firefly (🔴 worse):** fiancée named **both "Elena" and "Caroline" in the same chapter (ch1)**; "Elena" then reused as a **non-canon sister** with **impossible age math** ("known me thirty-one years" — Jay is 27); a surviving **fourth-wall break** ("*The exact thing Addi described in Chapter 1*", ch2); a **premise-contradicting hidden-secret climax**; PM flips **Priya→Sasha**; "fishbowl"→"Central Perk" room drift.
- **Two Seasons (🟠):** the canon "Nonno's" franchise black moment replaced by an unrelated real-estate "Letter of Intent" reveal; lease deadline contradicts canon (Labor Day vs October); minor geography drift; a garbled doubled sentence artifact (ch13).
- **The pipeline's own Continuity & Arc Review is not trustworthy:** in both books it audited only chapters ~1–9, **missed every high-severity later-chapter defect**, and contained at least one hallucinated/misattributed flag of its own.

---

## Round 2 — faithfulness, chapter count, word counts

### Q1 — Outline & premise faithfulness (per book)

**Both books share the identical failure shape: faithful early, back half comes off the rails, the ending is missing.**

**Two Seasons of Summer — 4.5/10.**
- Faithful ch1–11 (beats, POV, even scripted lines near-verbatim); midpoint kiss lands on schedule (ch13, reframed).
- **Re-plots ch14–25:** ch14–21 is an invented "Labor Day two-window collaboration" subplot not in the outline; ch22 is a hard continuity break (reverts to summer, re-stages a first-kiss beat already delivered in ch13, then ch23 proceeds as its "morning after" — the book kisses Cole "for the first time" twice, months apart, out of order).
- **Black moment swapped:** franchise "Nonno's" (premise/outline) → a hidden real-estate "Letter of Intent, Purchaser: Cole R. Kessler" with Sal's note "*Do not tell G until solid*" — which **contradicts the premise's explicit "not a withheld secret" design** (it turns on a concealed document).
- **Act 3 + HEA dropped:** book ends *inside* the black moment (a Monday afternoon). No grovel, no inverted grand-gesture proposal, no winter gap, no "One Year Later" epilogue. Cole-POV structural promise abandoned (book is 100% Gia POV).

**Firefly Pond — 3.5/10.**
- Faithful ch1–7 (doorknob confession + "Kayla. It was always Kayla" exact; ch7 Act-1 cabin invite lands).
- **Chapter mapping slips ~5 chapters after ch7; POV assignments inverted ch22–25; tense drifts present→past ch22–25.**
- **Central conflict replaced with the banned trope:** premise = *"Not a secret. Not a lie. A matched mutual misread"* with a stray text from **Mark** as catalyst. Delivered = a **concealed six-year fiancée** (Caroline Wexler, "a ring in a sock in that drawer for eleven months"), doled out as half-truths — the exact concealed-secret the premise forbade. Mark is written out early; his catalyst text never fires.
- **Structural promises dropped:** the seven-night single cabin week is fragmented into ~3 short trips; laddered slow burn abandoned (heat front-loaded from Tuesday).
- **Elena/Caroline identity contradiction corrupts the plot's own secret** (box labeled "Jay Ferraro & Elena Voss" in ch17 vs Caroline Wexler elsewhere).
- **Act 3 + HEA dropped:** ends on the breakup (Addi walking out at "Kayla (17)"). No grovel, reconciliation, Brooklyn move-in, or one-year-later epilogue.

**Most important system finding — the pipeline thinks it succeeded:** Firefly's `compile-manuscript-report` (step-136, dated "October 26, 2023") **rates the arc 8/10 and describes "Chapters 14–25… a satisfying resolution… hopeful conclusion" — a resolution that does not exist in the manuscript.** The automated completion report **hallucinated the HEA.** The `continuity-arc-review` (step-135) audited only chapters 1–8 in both books.

### Q2 — Chapter count: why 25, not 30 (a real bug)

Both books are **25 chapters** (not 24; not the selected 30).
- Both manifests have **`format: None`** — the chapter-count/length target was **never persisted at create**. Both were made from premise-file seeds; that flow doesn't capture a book `format`, so the "30" selection was lost between the New Book/premise step and the manifest.
- With no format, `buildPipelineVars` used its hardcoded default: `chapterCount = Number(ctx.targetChapters) || 25`. The outline prompt (`"across {{chapterCount}} chapters"`) and the `expand: chapters` loop (`for n = 1 … n ≤ vars.chapterCount`) both used **25** — which is why *both* books, regardless of selection, landed on exactly 25.
- Even an author-supplied structural **blueprint** implying 30 is overridden, because `{{chapterCount}}=25` is baked into the outline prompt.

### Q3 — Word counts vs target

| Book | Target | Delivered | Verdict |
|---|---|---|---|
| Firefly Pond | 70–80k | **73,066** (25 ch, ~2,922/ch) | ✅ in range (coincidence of the 25×3000 default) |
| Two Seasons | 55–65k | **71,850** (25 ch, ~2,874/ch) | ❌ ~7–17k over |

`wordsPerChapter` also defaults to **3000** (`Number(ctx.targetWordsPerChapter) || 3000`), so both books ran at ~25×3000 ≈ 72k regardless of target. Firefly's target happens to match; Two Seasons' smaller target didn't.

---

## Round 3 — per-step faithfulness audit (0–10 per step)

**Scope/method:** all 272 step outputs (136 × 2) pulled from Neptune and rated **0–10 against each step's intended purpose** taken from the pipeline definition, by six fanned-out subagents (planning+suffix, production ch1–13, production ch14–25, per book). The rating measures **fidelity to the step's own job**, independent of overall book quality — a Consistency Audit that emits a clean-but-blind `[]` scores low; a First Draft that faithfully executes a weak brief scores high. Both books completed **136/136**; first drafts hit the ~3,000-word target reliably (2,995–3,216).

### Mechanistic root cause (new): the outline drops out of context after ~Chapter 9
Back-half Scene Briefs in **both** books say it outright — *"the available outline runs only through Ch9,"* *"No outline text exists for Chapter 16."* Step-9's outline is correct and contains the full arc **through the HEA**, but it is **not reaching the Scene Brief prompt for chapters 10+.** From ~ch10 each brief improvises off the previous chapter — drifting the plot, dropping mandated beats (Firefly loses two mandated sex scenes because its *briefs* did), and consuming the whole 25-chapter budget on slow-burn — so **Act 3 (grovel → reunion → HEA) is never written.** This is the mechanism behind Round 2's "back half comes off the rails / ending missing": a **context-assembly bug, not model quality.** First drafts faithfully execute whatever brief they are handed, so the divergence is located precisely in the **Scene Brief** substep.

### Planning + QA steps (one-off, per book)

| Step | Two Seasons | Firefly | Note |
|---|:--:|:--:|---|
| 1 · Council origination | 9 | 9 | Full premise + relationship arc through a real HEA. |
| 2 · Premise | 9 | 9 | Couple, conflict, tropes, explicit HEA promise. |
| 3 · Setting | 9 | 8 | Accurate real geography; FF silently seeds character names the bible later contradicts. |
| 4 · Canon Audit — Setting | 5 | 7 | Valid JSON list; TS emitted one malformed non-verbatim edit; both check little. |
| 5 · Canon Gate — Setting | 7 | 6 | Correct deterministic no-op; emits a status line, not a corrected doc. |
| 6 · **Character Bible** | 9 | **5** | TS clean. **FF bible is the seedbed of the canon failures** — renames parents, collides sister "Rosa" with the mother, flips age order. |
| 7 · **Canon Audit — Characters** | 8 | **2** | FF returned `[]` while the bible contradicted the setting on names/ages — caught none of it. |
| 8 · Canon Gate — Characters | 8 | 5 | Correct given the (empty) audit; the audit→gate pair added no value in FF. |
| 9 · **Chapter Outline** | 9 | 9 | **Both reach a full HEA** (TS ch25 "One Year Later"; FF ch24 Brooklyn + ch25 epilogue). The dropped ending is downstream, not here. |
| 135 · **Continuity & Arc Review** | **2** | **1** | Both miss the one catastrophic problem (no HEA delivered) and critique outline-era beats the manuscript doesn't contain. |
| 136 · **Compile Report** | **1** | **1** | Both **hallucinate a satisfying HEA** (FF: *"culminating in a believable and hopeful conclusion"* over a book that ends on the breakup); fabricated dates too. |

### Production substeps (avg across chapters, front half → back half)

| Substep | Two Seasons (ch1–13 → ch14–25) | Firefly (ch1–13 → ch14–25) | Verdict |
|---|:--:|:--:|---|
| Scene Brief | 6.2 → 3.7 | 6.9 → 3.0 | Good until ~ch9, then off-outline (root cause above). |
| First Draft | 7.3 → 6.8 | 7.9 → 4.4 | **Faithful to its brief**, hits ~3k words, correct heat. Only as good as the brief it is handed. |
| **Consistency Audit** | 3.0 → 4.75 | 4.6 → 3.75 | **Weakest working step.** Almost always emits empty `[]`; misses name drift, age-math, venue swaps, POV/tense slips, buyer contradiction. It *can* fire (TS ch22 caught real timeline errors) — it just rarely does. |
| Consistency Apply | 9.0 → 9.6 | 8.3 → 9.5 | **Best step.** Deterministic, never corrupted prose — but can only apply what the audit found, so empty audits pass errors straight through. |
| **Humanize / De-AI** | 4.4 → 5.9 | 6.7 → 5.5 | **Net-negative in stretches.** All prose corruption in the pipeline originates *here*: phantom characters ("gift box," "that woman"), first→third-person POV breaks, duplications, continuity contradictions ("water climbing her ribs" in a receding-water scene), orphaned fragments the seam-guard missed. Clean in some ranges (TS ch21–25), damaging in others. |

### The four systemic failures (ranked by impact)
1. **Outline absent from the Scene Brief past ch9** → back-half re-plot → **no Act 3 / no HEA** in either book. *(highest impact; fixable in context assembly)*
2. **Consistency Audit rubber-stamps** (`[]`) → because Apply is faithful, every uncaught error (names, ages, tense, venue) flows into the final text.
3. **Humanize/De-AI introduces corruption** — the only step that damages prose, and the seam-guard misses several splices.
4. **Both QA steps (135, 136) are blind and misleading** — they certify a HEA that does not exist; the last line of defense actively hides the failure.

### Corrections to Rounds 1–2
- **The "Ferraro leak" is not a cross-book leak** (see corrected Round 1 note): Ferraro is Two Seasons' canonical protagonist surname; the model independently reused it in Firefly — a **distinctness** signal, not context contamination.
- The real name drift is **invented, unregistered characters** the audits never caught (Deja, Denny Alvarez, "the Millers," Renata Osei; Elena/Caroline; Simona/Simone Bonetti).
- Round 3 locates the divergence in the **Scene Brief** substep — the First Drafts execute their briefs faithfully.

### Phase-level health
Planning (steps 1–9): **TS 8.1 / FF 6.7** · Production (5 substeps): **~6.1 both** · QA suffix (135–136): **TS 1.5 / FF 1.0**. Net: the front of the pipeline is sound; the middle degrades because the outline drops out of context; the QA tail is broken.

---

## Cross-cutting root causes → recommendations

1. **Outline drift accumulates in the back half.** Each scene-brief gets the outline + prior chapter, but nothing *forces* delivered chapter N back onto outline beat N — so by Act 3 the story has wandered and the planned grovel/HEA beats are never written. → Re-ground every scene-brief to its exact outline beat + POV; validate chapter N's POV against the outline.
2. **The chapter budget runs out before the ending** — pacing spends all 25 chapters reaching the crisis; compounded by the Q2 default (fewer chapters than intended). → Persist the format target; add a "you are at chapter N of M — the HEA must land by M" pacing anchor.
3. **Self-QA is unreliable and must not gate ship** — the continuity review covers only early chapters and the compile report hallucinated an HEA. → Full-manuscript continuity review + a hard "does the final chapter deliver the genre's required ending?" gate.
4. **Chapter-count / length not captured for seed/premise-created books** (`format: None`) → make the premise-intake/guided create flow capture and persist `format.chapterCount` + `wordsPerChapter`; until then, set format via the Book Board / `PUT /api/books/:slug/format` before generating.
5. **Author differentiation not landing** (same voice, off-lane settings, cross-book leak) → constrain the council/premise step to the author's genre lane; strengthen voice steering (see the "voice ingestion" candidate in the AI-writing-process review).
6. **Name drift** (Elena/Caroline, Priya/Sasha, the Ferraro leak) → the **Character Name Registry is inert for romance/library pipelines** (open item in [TODO.md](TODO.md)); this run is concrete evidence to activate it.
7. **Residual structural AI-isms** the sweep can't catch (filter words, aphoristic fragment-buttons, "the way he/she") → a computable tell-score gate (burstiness / filter-word / fragment-button density).

---

## Method note
Data staged locally from Neptune (`workspace/books/<slug>/data/` + author `SOUL.md` + project step statuses). Audited by fanned-out subagents across three rounds: pipeline-succession, author-fidelity/distinctness, AI-ism residual, consistency (round 1); per-book outline/premise faithfulness (round 2); per-step 0–10 faithfulness against the pipeline definition — all 272 step outputs rated by six subagents split planning+suffix / production ch1–13 / production ch14–25 per book (round 3). Chapter-count and word-count facts gathered directly from the manifests, the `buildPipelineVars`/`expandSteps` code, and `wc` over the final humanized chapter files.
