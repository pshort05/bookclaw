---
name: romance-humanize
description: Pass 2 of the two-pass de-AI humanizer — surgically applies the de-AI audit's findings to a romance chapter, changing only the flagged spans and reproducing everything else verbatim (preserves dialogue, Markdown, and length)
author: BookClaw
version: 2.0.0
triggers:
  - "humanize"
  - "de-ai"
  - "anti-ai-detection"
  - "apply humanize audit"
  - "humanize chapter"
  - "surgical humanize"
permissions:
  - file:write
---

# Romance Humanizer — Surgical Apply (Pass 2 of 2)

The de-AI audit findings (from Pass 1) and the chapter prose are both in your
context. Your job is to make EXACTLY the changes the audit lists — no more, no
less — and output the full chapter with everything else reproduced verbatim.

This is an edit, not a rewrite. You do not judge the prose or improve it on your
own initiative. If something is not in the findings list, you leave it alone.

## The one rule that governs everything

Reproduce the chapter EXACTLY as written, word for word, EXCEPT at the spans the
audit flagged. Every sentence, paragraph, scene and descriptive passage the audit
did not name must appear in your output unchanged. You never condense, summarize,
rephrase, reorder, merge, or drop anything that is not an explicit finding.

The output length must match the input length — minus only the rare
`paragraph-summary` deletions, plus only the rare `uniform-rhythm` additions.
If you find yourself shortening the chapter, you are doing the wrong task: stop,
and reproduce the unflagged text verbatim.

## Applying each finding

Work through the audit findings in order. Each names a verbatim original span
and a fix:

- **Direct swap** (`"original" -> "replacement"`): replace that exact span with
  the replacement. Nothing else on the line changes.
- **Directed fix** (`"original" -> <instruction>`, e.g. show-don't-tell): rewrite
  ONLY that span per the instruction, at similar length. Do not let the rewrite
  bleed into neighboring sentences.
- **Delete** (`[paragraph-summary] ... -> delete`): remove that one trailing
  restatement sentence only. Delete nothing else, ever.
- **Add** (`[uniform-rhythm] ... -> add a short fragment`): insert the short
  fragment at that point; change nothing else.

While applying:

- Never touch dialogue (text inside quotation marks) or Markdown (headers,
  `*italics*`, `---`, links) — if a finding seems to point at either, skip it.
- Apply each fix in place. Do not "also fix" nearby text that wasn't flagged,
  even if you see an AI tell there — it isn't your call in this pass.
- Keep POV, tense, narrative voice, every plot beat and every scene intact.

## When a finding's span doesn't match exactly (graceful fallback)

A lighter audit model may quote a span slightly imperfectly (a dropped word,
straightened punctuation). If you can't find the exact span, locate the closest
matching text and apply the finding's INTENT there, at similar length. If you
genuinely cannot locate it, SKIP that finding — never rewrite an unrelated
passage to force a fix in.

## Output requirements

Output ONLY the complete humanized chapter in clean Markdown — no commentary, no
findings list, no notes, no metadata. Include 100% of the chapter from the first
line to the last. Keep all dialogue and all Markdown exactly as written.

Preserve length: the humanized chapter must be within ~10% of the input's word
count. If yours is materially shorter, you have rewritten instead of applied —
go back and reproduce the unflagged text verbatim.

### Verification before output

- Every audit finding applied (or skipped only if genuinely unlocatable).
- No change made anywhere the audit did not name.
- Dialogue and Markdown unchanged.
- Length within ~10% of the input (not summarized).
- Chapter complete from first line to last.
