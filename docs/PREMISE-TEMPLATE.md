# Premise Template (standard, parse-friendly)

A canonical layout for a romance/novel premise document so BookClaw's premise
intake can read it **deterministically in code** — no AI re-transcription, and
therefore no output-token truncation (the failure mode that surfaces as
"Could not parse the premise into structured seeds").

The design principle:

- **Scalars go in YAML front matter** — a real YAML parse, zero ambiguity.
- **Prose goes under fixed `##` labels** — each section is sliced verbatim into a seed.
- **Undecided items go in one `## Open Questions` list** — one gap per line.

To start a new book, copy everything between the two rulers below into a new
`.md` file and fill it in. Delete the "How this maps" reference section at the
bottom (or leave it — unrecognized sections are preserved as notes, never lost).

---

```markdown
---
title: Fireflies
genre: Contemporary Romance
heat: spicy                     # sweet | spicy   (or a 1-5 level; 1-2 -> sweet, 3-5 -> spicy)
pov: dual, alternating          # free text, optional
chapters: 40                    # integer
words_per_chapter: 2500         # integer  (or total_words: 100000 -> chapters derives it)
setting_is_real: true           # true | false
setting_real_place: Sullivan County, NY   # the mappable location for grounding; omit if fictional
---

# Fireflies

## Logline
One or two sentences — the whole book in a breath.

## Premise
A paragraph or two: the central conflict, the hook, what is at stake.

## Theme
What the book is really about, in 1-3 lines.

## Characters
### Addison "Addi" Green — 28
Role, wound, want, arc.
### Jake "Jay" Ferraro — 27
Role, wound, want, arc.
### Cara Ferraro — 26
Supporting cast are more ### entries in this same section.

## Setting
The world, key locations, time period, seasonal rhythm. Name real places plainly;
mark invented businesses as fictional so grounding does not treat them as real.

## Structure
POV model, act/beat outline, and the ending. Use ### per act/beat freely.
### Act 1 — ...
### Act 2 — ...
### Act 3 — ...

## Open Questions
Things you have not locked. One per line. Optional: tag the target field in
[brackets] and add your leaning after an em dash.
- [characters] Name of Jay's ex-fiancee
- [characters] Addi's specific hobby — leaning bouldering
- [setting] Specific Sullivan County town for the cabin week
- [blueprint] Keep the optional epilogue?
```

---

## How this maps to the pipeline seeds

| Template part | Seed field | Parsed as |
|---|---|---|
| front matter `heat` | `heat` | YAML value (level -> sweet/spicy) |
| front matter `chapters`, `words_per_chapter` | `chapterCount`, `wordsPerChapter` | YAML ints (no inference) |
| front matter `setting_is_real` / `setting_real_place` | `realPlace` | filled directly; also seeds grounding |
| `## Logline` + `## Premise` + `## Theme` | `storyArc` | sections concatenated verbatim |
| `## Characters` (and all `###`) | `characters` | verbatim |
| `## Setting` | `setting` | verbatim (grounding *appends* real geography, never overwrites) |
| `## Structure` (and act `###`) | `blueprint` | verbatim |
| `## Open Questions` bullets | `gaps[]` | one gap per line; `[tag]` -> `targetField`; `— leaning` -> `proposedAnswer` |

## Rules that keep it deterministic

1. **Keep the eight `##` labels exact:** `Logline, Premise, Theme, Characters,
   Setting, Structure, Open Questions` (the H1 title is free). The parser also
   accepts obvious synonyms (`Protagonists`/`Cast` -> Characters, `Open Choices`
   -> Open Questions), but the labels above are the guaranteed path.
2. **Use `###` freely inside a section** (per character, per act). It is
   preserved verbatim.
3. **Put every number/flag in front matter.** That is the only place the parser
   looks for heat/chapters/words/real-place, so there is no guessing.
4. **One idea per line in Open Questions.** The optional `[targetField]` tag and
   `— leaning` answer remove the last bit of judgment.
5. **Anything extra is safe.** Unrecognized `##` sections (Comp Titles, Craft
   Notes, Heat Map) are appended to `blueprint` as notes — nothing is lost, it
   just is not its own seed.

## Optional / graceful defaults

- Omit `chapters` / `words_per_chapter` / `heat` and they take defaults **and**
  become auto-added gaps to resolve in the review UI.
- Omit `setting_real_place` -> grounding is skipped (fine for pure-fiction worlds).
- The only hard requirements for a clean parse are `## Logline`, `## Characters`,
  `## Setting`, `## Structure` — the four text buckets.
