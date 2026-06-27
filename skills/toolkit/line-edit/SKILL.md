---
name: line-edit
description: Tighten prose at the line level while keeping the author's voice — flag style choices, never flatten
author: BookClaw
version: 1.0.0
triggers:
  - "line edit"
  - "line-edit"
  - "tighten this"
  - "tighten the prose"
  - "edit this passage"
  - "cut the filler"
permissions:
  - file:read
---

# Line Editor

Tighten the prose **without flattening the voice**. The goal is the author's sentences,
sharper — not generic clean copy. Preserve what makes the writing theirs.

## What to deliver

Given a passage:

- **Tighten** wordy or weak sentences.
- **Cut** filler and redundancy.
- **Flag, do not auto-fix**, anything that is a style choice the author might want to
  keep — an intentional fragment, a repeated word for rhythm, an unusual register.

Then output, in this order:

1. **The edited version** of the passage.
2. **A short list of the most important changes**, each with a one-line *why*.

## Discipline

- Keep the author's voice. If a "cleaner" version would sound like every other piece of
  prose, it's the wrong edit.
- Distinguish **errors** (fix or tighten) from **choices** (flag, leave for the author).
- Do not rewrite for taste, expand the passage, or impose your own style.
