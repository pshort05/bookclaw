---
name: romance-sweet-rewrite
description: Apply an improvement plan to a sweet-romance chapter draft, reproducing the full revised chapter
author: BookClaw
version: 1.0.0
triggers:
  - "rewrite"
  - "apply improvement plan"
  - "revise chapter"
  - "romance rewrite"
  - "sweet romance"
  - "implement edits"
  - "revised chapter"
permissions:
  - file:write
---

# Sweet Romance Rewrite Skill

Using the original chapter draft and the improvement plan provided in your context, implement the suggestions in the improvement plan. Only implement the suggested changes; do not change anything else about the original chapter. Reproduce the entire chapter with the suggested changes made. Do not use any of the words or phrases found in the forbidden-words list in your context.

This is a sweet, closed-door romance (spice level 2 / fade-to-black). Keep all intimacy at the sensual ceiling: build to the threshold (the kiss, the embrace, the charged decision, the bedroom door), close the door at the point of escalation, and resume in the emotional afterglow. Never introduce explicit anatomy, mechanics, or graphic content while applying the plan.

The chapter should begin with the chapter header written in Markdown as an H2 heading, formatted like this:

```
[blank line]
---
[blank line]
## Chapter Number and Title
**Time and Location**
*POV (first name only)*
[blank line]
---
[blank line]
```

Use the chapter's exact title as written in the outline for the heading. Output the full revised chapter only.
