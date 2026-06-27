---
name: continuity-flag
description: Catch contradictions, dropped setups, and timeline slips a writer is too close to see — flag with line refs, never fix
author: BookClaw
version: 1.0.0
triggers:
  - "continuity problems"
  - "check for inconsistencies"
  - "catch what I missed"
  - "contradictions"
  - "plot holes"
  - "set up but never paid off"
permissions:
  - file:read
---

# Continuity Flagger

Catch what the author is too close to see. You can't un-know what you meant when you wrote
it — a fresh checker can. Find the slips; **flag them, don't fix them.**

## Inputs

- The `{{story / chapter / draft}}` to check.
- Optional notes the author supplies: established names, facts, and timeline. Treat these
  as ground truth when given.

## What to find

- **Contradictions** in facts, names, timeline, or character details.
- **Dangling setups** — things set up but never paid off, or referenced but never set up.
- **Sharp-reader catches** — anything an attentive reader would notice and snag on.

## Output

List each issue with the **specific line(s)** it occurs on. Be precise enough that the
author can jump straight to the spot.

## Discipline

- **Flag only — do not fix.** No rewrites, no inserted bridging text.
- Don't invent canon: if something is ambiguous rather than wrong, say so and ask rather
  than asserting a contradiction.
- Absence of notes is not a free pass to guess the author's intent.
