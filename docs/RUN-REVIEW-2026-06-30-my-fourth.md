# Run Review — "My Fourth Medical Romance" (in progress)

Date: 2026-06-30. Model: `deepseek/deepseek-v4-pro`. Reviewed read-only from Neptune.
State at review: planning + bible complete; production at chapter 17/32 (33/65 steps);
deep-revision / format / launch not yet run. Analysis covers planning, bible, and
chapters 1–17 (polish-preferred). 52,838 words so far.

This run is the first to exercise the canon-injection + meta-strip + word-budget fixes
shipped after the "My Third Medical Romance" review, so the review doubles as validation.

## What the shipped fixes DID resolve (vs the my-third baseline)

- **Canon injection works.** Every identity the bible pins held across all 17 chapters with
  zero drift: June **Harper** (`June Harper` 20×, `Nurse Harper` 19×, `June Chen` never
  appears in prose), Dr. Silas **Blackwood** (71×), **Mercy Ridge** (71×), **Lenny**. The
  my-third failure (June Albright→Miller→Mitchell→Harper, hero Vance→Blackwood→Cross) did
  not recur for any bible-pinned fact.
- **Meta-strip works.** Zero AI/meta leakage across all 17 chapters — no "Here is chapter",
  no leading acknowledgements, no trailing word-count/continuity notes.
- **Word budget works.** Every chapter is 2,500–3,900 words; no truncation (my-third
  truncated whole-manuscript passes).

The remaining problems below are failures the shipped fixes do **not** cover: facts the
bible never pinned, the style/POV directive that isn't injected, and the unguarded
planning→bible handoff.

## Problems, most critical to least

### 1. CRITICAL — Narrative person flips between 1st and 3rd, 8 times
The style bible (`project-56-step-5`, line 47) mandates "third-person limited, deep POV,
one POV per chapter." Production violates it: chapters 1–5 third-person, **6 first**, 7
third, **8 first**, 9–11 third, **12 first**, 13 third, **14–17 first**. The book cannot
decide whether it is first- or third-person. Unpublishable without a full POV-normalization
pass.
- Root cause: the injected canon block (`book-canon.ts`) carries bible/continuity/outline
  but **not** the style-tone reference, so narrative person is unpinned per chapter. The
  style guide's own deep-POV example uses first-person interior ("*…why does my chest still
  ache?*"), which the model over-extends into full first-person narration. The polish step
  does not normalize person (and is itself first-person on several chapters).

### 2. CRITICAL — Silas's dead-child backstory (his core wound) is renamed every time
The lost pediatric patient — the engine of Silas's arc, retold ~5 times — has four
different names: **Elodie** (ch4) → **Becca** (ch7) → **Ryan** (ch12–13) → **Thomas Michael
Chen** (ch13,16). The bible describes a "12-year-old girl"; the chapters make the patient a
six-year-old boy. (Distinct from the living surgical patient Melissa, ch11–17, who is
consistent, and a second emergency child Lucas in ch17.)
- Root cause: the bible never assigned the patient a fixed name, so the injected canon has
  nothing to pin and the model invents one per chapter. This is the same drift mechanism as
  my-third, now confined to canonical facts the bible left unspecified. The continuity
  registry needs to capture named-but-secondary entities (lost patient, ex, siblings), and
  the bible step must name every entity the outline references.

### 3. CRITICAL — Planning→bible handoff passes no content; the bible re-invents the protagonist
`character-profiles.md` (planning) and `character-bible.md` (bible) disagree on nearly every
fact: June **Chen** 28 / 5'3" / black hair / 2nd of **three** daughters / ex **Marcus** (a
nurse) / hometown 2hr **south** vs June **Eleanor Harper** 29 / 5'5" / ash-brown hair /
elder of **two** daughters + sister Lily / ex **Derek** (a phlebotomist) / hometown 2hr
**north**; antagonist **Hargrove**→**Fitzpatrick**; sister Lily 34/older→26/younger; Silas's
scar knuckle→jawline. Production followed the bible and discarded planning, so it did **not**
corrupt the protagonist — but: (a) all phase-1 character/relationship work was wasted; (b)
the orphaned planning surname spawned a throwaway "Dr. Chen" resident in ch3; (c) the outline
still uses the planning names (June Chen) and a different midpoint, so the outline is now
inconsistent with what's being written.
- Root cause: book-bible is a separate project. `sequencePredecessorsComplete`
  (`projects.ts:1943`) gates the bible phase on the planning phase's **status** only;
  `buildProjectContext` for a `book-bible` project hits the default branch and includes only
  that project's own prior steps — planning's outputs never reach the bible phase. Fix
  direction: feed planning's character-profiles + outline into the bible step's context, and
  instruct the bible to **expand, not replace** established identities.

### 4. HIGH — Structural beat repetition in the middle act
Chapters 14, 15, and 17 are near-identical: a date is interrupted by a child's cardiac
emergency → Silas's hands tremble → June steadies him → surgery succeeds → scrub-room
catharsis. Silas breaks and is healed three times in one arc — diminishing returns. Also
ch2 re-treads ch1's meet-cute (same Saturday), ch11 recaps ch10, and there are two competing
"midpoints" (ch13 public kiss, ch15 surgery climax). The chapter generator has no
beat-diversity guard, so it falls back on the strongest scene pattern it has seen.

### 5. HIGH — Timeline / flashback dissonance
ch14 opens with a restaurant flashback to a scene not yet shown (ch13 ended Friday night on
a bench). ch12's header says "Tuesday Evening" but the chapter opens "7:03 a.m." A
continuity/timeline gate over the chapter sequence would catch both.

### 6. MEDIUM — Write→polish double-pass is low-value and undefined
ch2/4/8 polish is ~70%+ verbatim of the write; elsewhere polish merely **expands length**
rather than refining. It does not fix POV-person or the patient-name drift, and occasionally
re-drafts rather than edits. The polish step needs a defined job (line-edit + continuity
normalization against the registry), not a free re-draft — otherwise it doubles token cost
for little craft gain.

### 7. MEDIUM — Over-repeated motif phrases
"the man from the market" (~15×), "honey in hot tea", "one Saturday at a time", "she'd let
him walk away" recur as refrains. A repetition check across the assembled manuscript would
flag these.

### 8. LOW — Minor canon imprecision
Lenny rendered "mid-fifties" vs canon 57; Silas's scar (knuckle vs jawline in the bible, and
never mentioned in the prose 1–17); Nathan Reed antagonist subplot opened and unresolved
(expected mid-book, flag for payoff).

### 9. LOW — Draft header cruft in raw step files
Step files carry "# Polish Chapter N" / "# Chapter N" headers. Harmless to the final book
because `manuscript-assembly.ts normalizeChapter` strips them — confirm the
download/assembly path is what the user reads, not the raw step files.

## One-line synthesis
The canon-injection / meta-strip / word-budget fixes hold the line on every fact the bible
pins; the remaining failures are all **unpinned** facts — narrative POV person (not in the
injected canon), the lost-patient name (never named in the bible), and the protagonist
identity (planning's profile never reaches the bible). The fix theme is the same in all
three: pin it in the injected canon, or it drifts.
