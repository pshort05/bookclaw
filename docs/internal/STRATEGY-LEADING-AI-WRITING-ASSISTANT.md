# Strategy: Making BookClaw the Leading AI Writing Assistant

**Date:** 2026-06-21
**North Star:** A multi-author, multi-book studio where one operator runs several novels at once — each owned by a distinct author identity, in its own genre, against a series or standalone, all in different states of progress.
**Status:** Strategy + plan. Covers the five items in the owner's brief.

---

## Item 1 — The "Easy Button" for new users

**Recommendation: a guided Quick-Start mode + Starter Bundles inside the existing studio, not a separate app.** A second interface is a maintenance and divergence burden; the better pattern is **progressive disclosure** over the engine BookClaw already has.

### 1a. Quick-Start wizard ("3-click novel")
One decision at a time, sensible defaults for everything else:
1. "Describe your book in a sentence" (the braindump → `{{description}}`).
2. "Pick a genre" (the 192-genre picker with search/groups already built).
3. "Start writing" — BookClaw auto-creates the book, binds a **default author voice** and the **standard novel pipeline sequence**, defaults models to the free/cheap tier, and runs planning while showing progress.

Everything else (author profiles, pipeline editing, the asset library, model routing) stays hidden behind an **Advanced** toggle. As the user completes a book, surface graduation nudges: "customize your author voice," "edit your pipeline," "add a genre."

### 1b. Starter Bundles (template gallery)
Pre-built **author + genre + pipeline** bundles a beginner picks in one click — e.g. "Cozy Small-Town Romance starter," "Mundane Sci-Fi starter," "Romantasy starter." These bundles *are* the multi-author assets being imported in Item 4, so this reuses existing infrastructure rather than building new. The gallery doubles as the demo/marketing surface.

**Why this beats a separate bare-bones app:** it expands the addressable market (the #2 killer feature) without forking the product, and it makes the power-user path a natural upgrade rather than a migration. **Difficulty: Medium** (a frontend wizard + a bundle-seeding step over the existing book-creation flow).

---

## Item 2 — Market themes and gaps (from novelmint.ai/compare + the tool reviews)

Recurring themes across ~100 tools on the comparison page and the deep-dive reviews ([NARRATIVE-ENGINE](NARRATIVE-ENGINE-INTEGRATION.md), [STORYTHREAD](STORYTHREAD-STUDIO-INTEGRATION.md), [MIRRORSHARD](MIRRORSHARD-INTEGRATION.md), [NOVELMINT-TOOLS](NOVELMINT-TOOLS-REVIEW.md), [CLAUDE-CODE-METHODS](CLAUDE-CODE-WRITING-METHODS-REVIEW.md), [LONEWRITER](LONEWRITER-REVIEW.md)):

| Market theme | BookClaw status |
|---|---|
| Local-first / privacy / bring-your-own-key | Self-hostable (LAN/Docker) — close, but not *marketed* as a privacy product |
| AI-as-reviewer, not ghostwriter (human-in-the-loop) | Has editors/brainstorm-critique; lacks the anchored-inline accept/reject UX |
| Continuity / canon-guard / consistency | Strong (Context Engine + plot-promises + continuity reports); deepen with Knowledge Matrix |
| Worldbuilding bible / codex / knowledge graph | Has bibles + entity tracking; no graph visualization |
| Voice matching / "style DNA" | Has voice profiles; the owner's PKstyle DNA not yet imported |
| Semantic memory / RAG | FTS5 keyword only — a real gap (on TODO) |
| Structure frameworks (beat sheets, etc.) | Has genre beats; could add Crucible/Farland/Actantial |
| Beta-reader / simulated reader feedback | **Already has** `run_beta_reader` + beta archetypes |
| Publishing / KDP last mile | Has DOCX/EPUB + KDP metadata + covers; lacks typeset print finishing (Item 3) |
| Audiobook / TTS | Has TTS + per-character voice fingerprinting; lacks voice cloning/design |
| Reader/serialization distribution | Has site rendering; no Royal Road/Wattpad-style serialization |

**Genuine gaps worth closing (most are already on the TODO):** semantic memory; AI-as-reviewer inline UX; onboarding (Item 1); print-finishing (Item 3); a privacy/local-first *positioning*; and a bible knowledge-graph. **BookClaw is already ahead of the market on continuity, multi-author, and the curated craft library** — the strategy is to widen those leads and close the onboarding + last-mile gaps.

---

## Item 3 — Integrate WritingUtils into the workflow

`~/data/Writing/AI-Tools/WritingUtils/` (Python, MIT, owner-authored) is the **print-finishing layer** BookClaw's `format` phase lacks. It provides:
- **`clean-markdown`** — paragraph indentation + blank-line normalization.
- **`clean-docx`** — the core: remove Google-Docs artifacts, page-break before each chapter, scene-break drawings → `* * *`, **KDP TOC-SDT unwrap**, first-paragraph spacing, first-line indent, excerpt block-indent, **chapter drop-cap initial**, line spacing, inter-paragraph gap, document-wide font conversion.
- **`format-docx`** — page size/margins/headers/footers for KDP/print (in development).
- **`strip_embedded_fonts.py`** — removes embedded fonts.
- YAML-config driven (per-book, e.g. `thunderwing.yaml`), so it is repeatable.

**Integration plan.** Wire it as the **format-phase finisher** in BookClaw's pipeline (`planning → bible → production → revision → format → launch`):
1. BookClaw compiles the manuscript (it already produces markdown/DOCX via `docx-export.ts`).
2. A new **format service** derives a per-book WritingUtils YAML from the book's metadata (trim size, fonts, scene-break marker, drop-cap preference) — the owner's `kdp_templates/` supply the print templates and the metadata defaults.
3. BookClaw **shells out** to the WritingUtils CLI (`clean-docx -c <book>.yaml`, then `format-docx` when it ships) to produce the **KDP-upload-ready DOCX** (and later the print-PDF). Treat Python as an **optional, fail-soft dependency** (matching BookClaw's posture for `better-sqlite3`/`yt-dlp`): if absent, fall back to the current plain DOCX export with a notice.
4. Surface the result through the existing launch/export UI and the AI-disclosure step (`disclosures.ts`).

This closes the typeset-print gap found in the markdown-to-book review and gives BookClaw a professional idea→KDP last mile. **Difficulty: Medium** (a format service + config mapping + shell-out; the tool already exists and is proven on the owner's real books, e.g. *Thunderwing*, *Where Bones Remember*).

---

## Item 4 — Assets to import from ~/data/Writing/

The directory is the **origin** of much already ported (StoryHackerAI → `nerdynovelistai`, `science_fiction_novels/msf` → `msf`, Shattered Cradle → `romantasy-*`, the humanizers → `humanize-*`). Beyond those, a direct scan found a large trove of **ready-to-import assets** — mostly pure data, the same low-risk import flow used for the n8n batches.

### 4a. Author identities + brand (-> `library/authors` + `library/voices`) — highest North-Star value
- `romance_novels/author-configs/`: **author-1-wholesome**, **author-2-spicy**, **HK Shaewood** (`hk-shaewood.json`), **KS Rhysdale** (`ks-rhysdale.json`) — distinct pen-name configs.
- `romance_novels/TD-Wood/` — **TD Wood** author identity.
- `calibre/` pen names — **Paul Short**, **Emily Smith**.
- `ShadowRoseBooks/` — a real **publishing brand/imprint** (site `shadowrosebooks.com`, admin system, author roster, logos) → brand metadata + the author roster.
These directly populate the multi-author studio with real, distinct identities.

### 4b. The owner's Voice DNA (-> a `voice` profile)
- `AI-Prompts/PKstyle/` — **PKstyle**: `PKstyle.md`, `PKstyle_prompt.json` (+ no-sample variant), `prose_sample.md`, `writing_sample.md`, `similar_styles.md`. This is the owner's personal writing-style DNA → a first-class `VOICE-PROFILE.md` / `STYLE-GUIDE.md` voice asset ("write in *my* voice").

### 4c. Curated craft prompts (-> `library/prompts`)
- `AI-Prompts/WritingPrompts/` (~20 JSON prompts): scene-sequencing, silent Strunk-&-White editor, **Male Character Quality Audit (13 mistakes)**, on-the-nose detector, 7-point character development/review, bad-ending checker, engagement checker, romance editor, copy editor v1.3, human-writing, text-quality, silent dialogue editor, ai-text-cleaner, prohibited-words. Many are net-new vs the editorial suite; import the distinct ones as `prompt` assets (dedupe against the imported set + the Atelier taxonomy).

### 4d. Named editor personas (-> `library/editors`)
- `genres/interactive_*_editor_*.json`: **Maeve** (romantasy), **Rosalind** (romance), **Neil** (hard SF), **Lilly** (intimate scenes), **Sarah** (names). These are ready-made interactive **editor personas** (BookClaw's `editor` kind) — Maeve is already referenced by the romantasy pipeline. High-value, on-brand.

### 4e. Craft methodologies + structure (-> `section`/`skill`)
- `writing-series/`: **David Farland's Million Dollar Outlines / Writing Wonder / Blockbuster Book Signings** + derived prompts (plotting process, plot/story improvers) — a complete outlining methodology → craft skills.
- `genres/`: Bell's Story Structure, Author Style Comparison (Brown & Baldacci), the **romantasy guide set** (Keys to Good Romance, Lore/Morally-Gray-HEA, Tropes & Must-Haves, Yarros guide), **Mundane SF guide**, SF Development Guidelines, `master_prohibited_words.md`.

### 4f. Series bibles + worldbuilding (-> book/series seed + `section`)
- `shattered-cradle-world/Where-Bones-Remember/`: **character profiles**, **character voice guide**, **foreshadowing ledger** (note: the foreshadowing ledger pairs with the plot-promises/red-herring work).
- `science_fiction_novels/`: **msf-series-bible**, **msf-genre-guide**, **uncle-bob-series-bible**, **dark-margins-series-timeline**, mundane-sf authors guide.

### 4g. KDP templates (-> Item 3 export)
- `kdp_templates/`: KDP manuscript templates (Endure font, 6x9 paperback, 6x9 hardcover, style guide) — feed the WritingUtils format step.

**Import priority:** (1) author identities + PKstyle voice + named editor personas (advance the North Star immediately, pure data), (2) the curated prompts + craft methodologies, (3) the series bibles as `section` assets / book seeds, (4) wire kdp_templates into the format phase (Item 3). **Difficulty: Low-Medium** — the same fan-out-and-validate import flow already used for the n8n assets.

---

## Item 5 — Ten killer features, ranked (with difficulty)

Ranked by differentiation x impact — "what makes BookClaw stand out," not just parity.

| # | Killer feature | Why it stands out | Difficulty |
|---|---|---|---|
| 1 | **Multi-author, multi-book concurrent studio** (the North Star) | No competitor runs several novels, each with a *distinct author identity + genre + pipeline*, concurrently. This is the unique positioning. Partially built (book containers, per-book binding). | High (it is the platform) |
| 2 | **The "Easy Button" — 3-click novel + Starter Bundles** | Couples a power engine with beginner on-ramp; almost no tool has both. Expands the market and de-risks adoption. | Medium |
| 3 | **Author Voice DNA — capture + apply per author/book** | "Write in YOUR voice" is a top market demand; BookClaw can do it *per author identity* across many books. The owner's PKstyle is a ready seed. | Medium |
| 4 | **Narrative Physics Engine (NPE)** — structural author rules + inspect/rewrite compliance loop | A structural-consistency layer (causality, pacing, resolution physics) no competitor offers; a third author-identity axis. | Medium-High |
| 5 | **Deep continuity engine** — Character Knowledge Matrix + Selective Exclusion + canon-guard | Best-in-class continuity: "who knows what, when" + dream/flashback exemption + contradiction detection. Continuity is a top market theme; this goes deeper than rivals. | Medium |
| 6 | **AI-as-reviewer inline editing** — anchored findings + word-level diff + accept/ignore | Captures the large "AI should edit, not ghostwrite" segment; makes BookClaw a co-writer, not only an autopilot. | High (frontend) |
| 7 | **Pro publishing last mile** — KDP-ready DOCX + typeset print PDF + cover + AI disclosures | Idea -> uploadable book, including the typeset print finish (WritingUtils) most tools skip. | Medium |
| 8 | **Importance-tiered context economy** — core/present/background/contextual/hidden injection | Cheaper, sharper prompts + the Hidden-subtext craft control; an invisible quality/cost edge that compounds across a long book. | Medium |
| 9 | **Curated craft library at scale** — 192 genres + named editor personas (Maeve/Neil/...) + craft-prompt taxonomy + structure frameworks (Crucible/Farland/Actantial) | Breadth and named-persona polish no competitor matches; mostly data the owner already has. | Low-Medium |
| 10 | **Hybrid semantic memory + bible knowledge-graph** | Semantic recall over long books (vs current keyword search) + a visual worldbuilding graph; closes two market themes at once. | High (infra) |

**Reading the ranking:** 1-2 are about *positioning and reach* (be the only power-tool a beginner can use). 3-5 are *quality differentiators* BookClaw can lead on. 6-7 close the two biggest experience gaps (human-in-the-loop editing, the publishing last mile). 8-10 are compounding/technical edges. Several (4, 5, 8, 9) are already scoped in the review-TODO backlog; this strategy elevates them from "ideas" to "the roadmap."

---

## Suggested sequencing

1. **Now / low-risk data:** import the Item-4 author identities + PKstyle voice + named editor personas + curated prompts (advances the North Star and feeds the Starter Bundles).
2. **Near term:** the Easy Button (Item 1) on top of those bundles; wire WritingUtils into the format phase (Item 3).
3. **Differentiators:** NPE (#4), Knowledge Matrix + Selective Exclusion (#5), importance-tiering (#8) — backend-heavy, already scoped.
4. **Experience:** AI-as-reviewer inline UX (#6); publishing last-mile polish (#7).
5. **Later/infra:** semantic memory + bible graph (#10).

---

## Addendum (2026-06-21): insights merged from the AGY (Gemini) review

A parallel review ([AGY-FEATURE-REVIEW.md](AGY-FEATURE-REVIEW.md)) answered the same brief and **strongly corroborates** this strategy — both independently converged on importance-tiered context, the NPE, the Character Knowledge Matrix / continuity engine, voice DNA, AI-as-reviewer inline editing, cross-book series memory, the Easy Button (wizard + template library + progressive disclosure), and the serialization/audio/monetization gaps. Its code references checked out (`style-clone.ts`, `track-changes.ts`, `craft-critic.ts`, `series-bible.ts`, `launch-orchestrator.ts`, `ams-ads.ts`, `release-calendar.ts`, `file-versions.ts`, `beta-reader.ts`, `writing-judge.ts` all exist) — so several features are **lower-effort than assumed because the plumbing already exists.**

### Net-new features worth adding to the roadmap

1. **Adaptive Voice Auto-Tuning (a learning loop) — upgrades killer-feature #3.** Diff the AI's draft against the author's human-edited final and auto-update the voice profile so it *improves with every edit*. `style-clone.ts` + `track-changes.ts` already exist, so this is wiring, not new infra. **Effort: Medium.** Turns "write in your voice" into a self-sharpening loop on top of the Item-4 PKstyle import.
2. **Branching Drafts / "Multiverse Mode" (new killer feature).** When stuck, draft 2-3 different next-scene directions in parallel ("fight / flee / negotiate"); the author picks one, the rest are versioned as alternate timelines. `file-versions.ts` + the parallel engine already exist. **Effort: Medium.** Distinctive and demo-friendly.
3. **Predictive Co-Writing / "Drive Mode" (new killer feature — fills a gap in this strategy).** Ghost-text autocomplete that streams the next paragraph in the author's voice as they type/pause — the Sudowrite-style manual-assist mode this strategy omitted. Pairs with AI-as-reviewer to cover the entire "write by hand, with help" segment. **Effort: High** (low-latency streaming over the existing Socket.IO + speculative execution).
4. **Unified Launch Orchestrator — sharpens killer-feature #7 and lowers its effort.** One "Launch" phase emitting print-ready PDF + KDP EPUB + KDP metadata + cover/portraits + ad copy + a 30-day social calendar. `launch-orchestrator.ts`, `ams-ads.ts`, `release-calendar.ts`, `kdp-exporter.ts`, and the cover tools already exist — mostly UI unification (wire WritingUtils + the audiobook step in here too). **Effort: Low-Medium.**
5. **Editorial Council as a debating named-persona "beta panel" — sharpens #6/#9.** Run the imported named editors (Maeve/Neil/Rosalind/Lilly/Sarah) as a concurrent panel that critiques a chapter, then a Judge LLM synthesizes one actionable revision plan. `beta-reader.ts` + `craft-critic.ts` + the parallel engine + the imported `editorial-outline-council` pattern make this near-assembly. **Effort: Medium.**
6. **Onboarding: add the "AI Muse" conversational option to the Easy Button (Item 1).** Alongside the 3-click wizard and Starter Bundles, offer a chat-interview first-run that extracts genre/lore/characters in conversation and builds the config in the background. BookClaw already has the chat infrastructure; it suits authors who would rather talk than fill a form.

### Sharper market-gap framing

- **Storefront Generator (monetization).** Auto-deploy a lightweight SEO landing page with **Stripe** for direct-to-consumer sales (no Amazon royalty) — builds on the existing site rendering (`render_site`). A monetization angle this strategy lacked.
- **Serialization Orchestrator.** Scheduled drip-publish of chapters to Substack / Patreon / WordPress — the concrete version of this strategy's "serialization" gap.
- **CYOA / Twine export.** If Branching Drafts ships, export branching storyboards to Twine/JSON for interactive fiction — a niche differentiator.

### One correction to carry forward

The Gemini review calls `memory-search.ts` a "SQLite **vector** index" (its #2). It is **FTS5 keyword/BM25, not vector** (verified). So semantic cross-book series-RAG still requires a vector/embedding layer — do not under-budget killer-feature #10; `series-bible.ts` exists, but the *semantic recall* does not.

### Competitive positioning (named anchors)

The Gemini review names 2026 leaders to position against: **Sudowrite** (prose generation + autocomplete — validates building "Drive Mode"), **Novelcrafter** (BYOK codex/lore — our multi-author + continuity must clearly out-do it), **EPOS-AI** (continuity — we must lead here via the Knowledge Matrix), and **Novelmint** (Write+Publish+Earn — the Storefront idea). Throughline: BookClaw's defensible edge is **multi-author autonomous production + deepest continuity + the publishing last mile**; the features above widen those leads while closing the autocomplete and onboarding fronts where Sudowrite and the newcomers are strong.
