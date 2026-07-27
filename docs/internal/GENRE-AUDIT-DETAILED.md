# Genre Guide Audit — Detailed Analysis
**Date:** 2026-06-20  
**Standard:** workplace-romance (RICH, 2,581 words, all 7 files complete)  
**Total Audited:** 193 genres

---

## Executive Summary

| Grade | Count | Status |
|-------|-------|--------|
| A+ (100) | 182 | **Structurally complete** — all 7 required files present; vary in depth/richness |
| A (92) | 8 | **Nearly complete** — thin content (300–360 words); weak comps/must-haves/genre-killers |
| F (2) | 2 | **Critical failure** — only meta.json; all 7 markdown files missing |

**The story:** 94.3% of genres are fully structured. Two genres are non-functional skeletons.

---

## Critical Failures (Must Fix)

### Genre: `satire` [Score: 2/D]
- **Status:** Only `meta.json` exists. **All 7 required markdown files are missing.**
- **Impact:** Cannot be used for generation; will fail injecting into prompts.
- **Word count:** 0 (no content files)
- **Fix:** Create all 7 files (reader-expectations, tropes, themes, beats, must-haves, genre-killers, comps).
- **Note:** Related genre `satire-fiction` exists separately with full content (2,961 words, RICH).

### Genre: `portal-sf` [Score: 2/D]
- **Status:** Only `meta.json` exists. **All 7 required markdown files are missing.**
- **Impact:** Cannot be used for generation; will fail injecting into prompts.
- **Word count:** 0 (no content files)
- **Fix:** Create all 7 files.
- **Note:** Related genres exist: `portal-fantasy` (RICH, 2,348 words), `portal-science-fiction` (MODERATE, 1,067 words) — neither is `portal-sf`.

---

## Nearly-Complete Genres (Tier 2 Priority)

These 8 genres have all 7 files but are **thin/generic** (283–360 words vs. workplace-romance's 2,581):

| Rank | Genre | Words | Depth | Issues |
|------|-------|-------|-------|--------|
| 183 | `uchronia` | 315 | THIN | Weak comps, thin must-haves, weak killers, sparse reader expectations |
| 184 | `teen-angst-romance` | 304 | THIN | Weak comps, thin must-haves, weak killers, sparse reader expectations |
| 185 | `sword-and-sorcery` | 305 | THIN | Weak comps, thin must-haves, weak killers, sparse reader expectations |
| 186 | `survival-fiction` | 283 | BARE | Weak comps, thin must-haves, weak killers, sparse reader expectations |
| 187 | `superhero` | 294 | BARE | Weak comps, thin must-haves, weak killers, sparse reader expectations |
| 188 | `steampunk` | 297 | BARE | Weak comps, thin must-haves, weak killers, sparse reader expectations |
| 189 | `spy-thriller` | 304 | THIN | Weak comps, thin must-haves, weak killers, sparse reader expectations |
| 190 | `sports-romance` | 360 | THIN | Weak comps, thin must-haves, weak killers, sparse reader expectations |

**Recommended:** Expand these to 1,200+ words (double the depth) — particularly beef up comps and must-haves.

---

## Healthy Genres — Full Ranking

**A+ (100/100) — All requirements met; sorted by word count (richest to thinnest):**

| Rank | Genre | Words | Notes |
|------|-------|-------|-------|
| 1 | `mystery` | 32,503 | Exceptional depth; comprehensive system |
| 2 | `nautical-historical-fiction` | 17,880 | Encyclopedic; strong setting conventions |
| 3 | `cosy-motorcycle-club-romance` | 15,068 | Rich subgenre specificity |
| 4 | `adventure-fantasy` | 14,551 | Robust dual-genre mechanics |
| 5 | `detective` | 11,407 | Deep procedural frameworks |
| 6 | `love-story` | 11,043 | Literary core genre; well-crafted |
| 7 | `fantasy` | 11,074 | Genre foundation; solid |
| 8 | `jungle-adventure` | 11,670 | Atmospheric setting guide |
| 9 | `isekai` | 10,090 | Transmigration mechanics well-explained |
| 10 | `mafia-romance` | 10,281 | Crime + romance synthesis solid |

**Continued A+ (100/100):**

| Rank | Genre | Words | Notes |
|------|-------|-------|-------|
| — | `military-thriller` | 9,174 | Procedural + tension balance |
| — | `galactic-empire` | 9,757 | Space-opera scale framework |
| — | `western-mystery` | 5,744 | Subgenre mashup; coherent |
| — | `spy-thriller-fiction` | 7,688 | Espionage craft focus |
| — | `western-fiction` | 8,967 | Foundational western guide |
| — | `vampire-fiction` | 8542 | Paranormal-romance synthesis |
| — | `action` | 8,462 | Action-beat frameworks solid |
| — | `dark-fantasy` | 8,726 | Grimdark tone calibration |
| — | `apocalyptic-fiction` | 8,757 | Post-civilisation craft |
| — | `military-romance` | 6,222 | Military/romance dual arc |
| — | `historical-romance` | 9,215 | Time-period conventions clear |

**Healthy Middle Tier A+ (100/100) — 2,000–4,000 words range** (similar to workplace-romance):

| Genre | Words | Status |
|-------|-------|--------|
| `workplace-romance` | 2,581 | Reference standard ✓ |
| `women-s-sports-romance` | 2,472 | Recently completed; healthy |
| `space-romance` | 2,826 | Recently completed; healthy |
| `space-fantasy-romance` | 3,528 | Recently completed; healthy |
| `neurodiverse-romance` | 3,860 | Recently completed; healthy |
| `blue-collar-romance` | 6,522 | Recently completed; healthy |
| `clean-romantasy` | 4,444 | Recently completed; healthy |
| `literary-romantasy` | 4,693 | Recently completed; healthy |
| `gaslamp-romantasy` | 7,514 | Recently completed; healthy |
| `lgbtq-plus-romance` | 2,377 | Recently completed; healthy |
| `alternative-sports-romance` | 2,655 | Recently completed; healthy |

**All remaining 152 genres:** Complete, RICH or MODERATE content depth. Sorted best-to-adequate in main audit report.

---

## Issues by Category

### A. Missing/Weak File Sections

**Sparse Reader Expectations** (generic descriptor, lacks subsections):
- ~80 genres flag this across A+ tier
- Most have headings but lack granular detail on Tone, Pacing, Setting Conventions, Archetypes, Length
- **Impact on generation:** Model receives less guidance on emotional register and reader contract

**Weak Comps** (<100 words; thin comp list):
- `time-travel-romance`, `time-travel`, `thriller`, `swashbuckler`, `suspense-thriller`, `comedy-thriller`, `folk-horror`, `dark-romantasy`, `mafia-thriller`
- **Impact:** Insufficient author reference pool for calibrating craft

**Thin Must-Haves** (<100 words):
- `time-travel-romance`, `time-travel`, `thriller`, `swashbuckler`, `superhero-action`, `medieval-science-fiction`, `dark-academia`, `cozy-historical-mystery-romance`, `culinary-mystery`, `satire-fiction`, `dystopian-fiction`
- **Impact:** Weak self-check guidance during generation

**Weak Genre-Killers** (<100 words):
- `time-travel-romance`, `time-travel`, `thriller`, `swashbuckler`, `superhero-action`, `medieval-science-fiction`, `culinary-mystery`, `cozy-dystopia`
- **Impact:** Model lacks negative constraints; anti-patterns not reinforced

### B. Structural Completeness

✓ **All 193 genres have `meta.json`** — picker descriptions present for all.

⚠ **Two genres have missing all 7 content files** — `satire` and `portal-sf`.

✓ **191 genres have all 7 required markdown files** — structural integrity sound.

### C. Content Depth Distribution

| Depth Level | Count | Examples |
|------------|-------|----------|
| RICH (1,500+ words) | ~155 | mystery (32.5K), nautical (17.8K), fantasy (11K+) |
| MODERATE (800–1,500 words) | ~20 | urban-fantasy-romance, time-travel, techno-thriller |
| THIN (300–800 words) | ~10 | swashbuckler, superhero-action, sports-romance |
| BARE (<300 words) | 3 | survival-fiction, superhero, steampunk |
| EMPTY (0 words, meta only) | 2 | satire, portal-sf |

---

## Ranking Summary (Best to Worst)

### Tier 1: A+ (182 genres) — Ready for Production
- All 7 required files present
- Depth ranges from MODERATE to RICH
- Can generate reliably
- Minor gaps in sparse reader-expectations or weak comps don't break function
- **Recommend:** Use as-is; enhance sparse-expectations genres over time (see Tier 2)

### Tier 2: A (8 genres) — Usable but Thin
- All 7 files present
- Depth: THIN to BARE (283–360 words)
- Weak comps, must-haves, genre-killers
- Can generate, but guidance is generic
- **Recommend:** Priority for depth expansion; reference workplace-romance as template for enrichment

### Tier 3: F (2 genres) — Non-Functional
- Only `meta.json` exists
- All 7 markdown files missing
- Cannot generate; will fail injection
- **Recommend:** URGENT — create all content before deployment, or remove from picker

---

## Files Available

1. **`genre-audit-report.txt`** — Full ranked listing (193 genres, all scores)
2. **`GENRE-AUDIT-DETAILED.md`** (this file) — Strategic analysis and recommendations

---

## Next Steps (Priority Order)

1. **[CRITICAL]** Fix `satire` and `portal-sf`:
   - Option A: Create full 7-file guides (3–5 hours work each, or parallel agents)
   - Option B: Remove from picker (mark as deprecated; redirect to `satire-fiction` and `portal-fantasy`/`portal-science-fiction`)

2. **[HIGH]** Expand Tier 2 thin genres (8 genres):
   - Target: 1,200+ words each (double current depth)
   - Focus: richer comps (4–5 real titles with craft notes), expanded must-haves + genre-killers

3. **[MEDIUM]** Reduce "sparse reader-expectations" flags:
   - Add subsection breakouts (Tone & Mood, Pacing, Setting, Archetypes, Length & Format)
   - ~80 genres would benefit (but already functional)

4. **[MAINTENANCE]** Validate workplace-romance remains reference standard:
   - Use as template for tier 2 expansion
   - Quarterly audit: ensure 80% of genres reach MODERATE+ depth (800+ words)

---

## Methodology Notes

**Scoring formula:**
- Base: 100 points
- Per missing file: −14 points
- No meta.json: −2 points
- <200 words: −15 points
- 200–500 words: −8 points
- Clamped to [0, 100]

**Depth classification:**
- **BARE:** <300 words
- **THIN:** 300–799 words
- **MODERATE:** 800–1,499 words
- **RICH:** 1,500+ words

**Flags per file weakness:**
- "Sparse expectations" = brief/generic content in reader-expectations.md
- "Weak comps" = <100 words in comps.md
- "Thin must-haves" = <100 words in must-haves.md
- "Weak killers" = <100 words in genre-killers.md
