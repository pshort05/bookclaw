---
name: fingerprint-audit
description: Two-pass structural de-AI for a drafted chapter — Pass 1 diagnoses the narrative fingerprints that make AI fiction detectable (StoryScope core tells plus per-model quirks) as JSON findings; Pass 2 surgically fixes only what Pass 1 flagged
author: BookClaw
version: 1.0.0
triggers:
  - "fingerprint"
  - "ai tells"
  - "narrative audit"
  - "structural tells"
  - "de-ai structure"
  - "story fingerprint"
permissions:
  - file:read
  - file:write
---

# Fingerprint Audit (two-pass find → fix)

You are auditing and repairing the *structural* narrative fingerprints that make
AI-generated fiction detectable at the discourse level (StoryScope, Russell et
al. 2026). These tells live in plot architecture, time handling, and how meaning
is delivered — they survive prose polishing, so they must be found and fixed as
deliberate structural edits, never as a general rewrite.

This skill defines BOTH passes. The step prompt tells you which pass is active.
Never mix them: Pass 1 changes nothing; Pass 2 invents nothing.

## Genre gate (read first)

- FICTION: apply the full catalog below.
- NON-FICTION (essay, argument, guide): audit ONLY categories 3 (EMOTION
  DELIVERY) and 7 (SEALED BUBBLE). A stated thesis, linear progression, and a
  clear resolution are correct in non-fiction — report those categories as
  "clear" without checking.

## PASS 1 — DIAGNOSE (no rewriting)

Audit the chapter. Do NOT rewrite anything. For each category, quote the
specific line(s) or describe the specific structural choice, then rate severity
(HIGH / MED / LOW). If a category is clean, omit it from findings.

Check, in order of diagnostic power:

1. STATED THEME (highest priority) — Any line where a character or narrator
   articulates what the story means, names its lesson or moral, or delivers a
   summarizing reflection. Includes dialogue used as philosophical debate that
   co-authors the theme, and paragraph-final "takeaway" lines. Quote every
   instance.
2. CHRONOLOGY — Is the chapter told strictly front-to-back? Note any flashback,
   flash-forward, ellipsis, or nonlinear framing. Strict linearity with no
   anachrony = flag.
3. EMOTION DELIVERY — Estimate the ratio of emotion conveyed through physical
   sensation (chest, breath, pulse, cold sweat) vs. named plainly vs. left
   unspoken. Heavy reliance on bodily routing = flag (AI runs 81% embodied vs.
   38% for humans).
4. SINGLE TRACK — Does everything in the chapter serve one clean throughline?
   Note any subplot or unresolved thread; flag tidy protagonist-driven
   resolution via internal understanding.
5. MORAL CLARITY — Is the protagonist cleanly sympathetic or clearly right in
   this chapter? Flag clean polarity; genuine ambivalence is human.
6. REFERENCE SPECIFICITY — Does the chapter name real books, authors, places,
   or brands, or stay vague ("an old novel," "a distant city")? Flag vagueness.
7. SEALED BUBBLE — Any direct reader address or fourth-wall permeability, or is
   the narrative hermetically closed? Closed = flag (LOW unless the voice
   invites address).

### Per-model appendix (check ALL of these against the text)

These are model-specific fingerprints. Check them regardless of which model
drafted the chapter — the evidence is in the text, not the byline. When a
finding matches one, name the pattern in the finding's `category` (e.g.
"claude:flattened-escalation").

- **Claude**: event intensity flattened into restraint (no genuine escalation);
  one uniform narrative register held throughout; epilogue or flash-forward
  ending as a reflex; conventions gracefully extended rather than subverted;
  quiet endings where an avalanche is earned; dream/vision sequences avoided
  entirely.
- **GPT**: gossip or rumor as a load-bearing plot mechanism; distant
  retrospective framing ("years later, she would remember..."); habitual or
  iterative narration entirely absent.
- **Gemini**: formulaic flashback insertion (frequent, mechanical); default
  bleak/oppressive setting mood; over-tidy extended denouement.
- **DeepSeek**: crucial context or backstory front-loaded where a human would
  withhold it; conspicuously visible narrator presence; backstory interleaved
  at perfectly even intervals.

(Kimi has no distinctive fingerprints — the core catalog above covers it.)

### Pass 1 output — JSON only

```json
{
  "needsRevision": true,
  "chapterNumber": 0,
  "summary": "1-sentence overview of the dominant tells.",
  "findings": [
    {
      "category": "STATED THEME",
      "severity": "HIGH",
      "quote": "exact text (or structural description if not quotable)",
      "location": "where in the chapter",
      "suggestion": "the specific surgical fix",
      "scope": "chapter"
    }
  ]
}
```

- `scope` is `"chapter"` when the fix is executable inside this chapter alone.
- `scope` is `"manuscript"` when the fix needs whole-book context or NEW
  material — a missing subplot, added moral ambivalence, cross-chapter
  reordering. These are for the author; Pass 2 must not act on them.
- If every category is clean: `{"needsRevision": false, "chapterNumber": 0,
  "summary": "No structural fingerprints found.", "findings": []}`.
- Output ONLY the JSON. No prose before or after.

## PASS 2 — REVISE (act only on Pass 1's findings)

Using the Pass 1 findings JSON in your context, revise the chapter. Rules:

- Change ONLY what a finding with `"scope": "chapter"` flags. Do not restyle,
  resmooth, or "improve" unflagged prose. If `needsRevision` is false, output
  the chapter unchanged.
- Work highest severity first.
- STATED THEME: delete the thesis line entirely. Do NOT replace it with a
  subtler restatement — let the surrounding image or action carry it.
- CHRONOLOGY: only in-chapter reordering (e.g. open the chapter mid-scene and
  let the opening beat arrive as a brief flashback). Cross-chapter reordering
  is manuscript scope.
- EMOTION DELIVERY: convert a PORTION — not all — of the physical-sensation
  cues to plainly named or unspoken emotion. Keep variety; do not invert the
  ratio into a new uniformity.
- REFERENCE SPECIFICITY: sharpen vague allusions to named specifics only when
  the book bible or context supplies real referents; never invent facts that
  could contradict canon.
- SINGLE TRACK / MORAL CLARITY / anything needing NEW material: do not
  fabricate a subplot, an ambivalent act, or a new thread. These stay flagged
  for the author (they should already be `"scope": "manuscript"`).
- Preserve ALL dialogue, all Markdown formatting, the chapter header, the
  original voice, and length (within ±10% of the original).
- Output ONLY the full revised chapter text in Markdown — no explanations, no
  JSON, no change list.

## What NOT to do with this skill

- Never run both passes in one step: diagnosis and revision are separate steps
  so the findings are recorded before any change lands.
- Never use a finding to justify a style rewrite; style is the humanize pass's
  job, downstream.
- Never invent new narrative material to satisfy a flag. Missing subplots and
  moral ambivalence are authorial decisions — surface them, don't fake them.
