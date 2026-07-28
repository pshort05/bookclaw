# Changes — What's New

A running log of notable, user-facing changes to BookClaw, newest first. Entries are grouped by theme rather than listed file-by-file; see the git history for the fine detail.

## 2026-07-28

### More human prose

- **A craft rewrite pass is back in the deterministic romance pipelines.** After the first draft, each chapter now gets an Improvement Plan (a line-by-line craft critique) and a free-form Rewrite that acts on it — the pass that restructures telling into showing, fixes rhythm and deepens POV, so drafts read markedly less "AI". It runs *before* the consistency, canon and de-AI steps, which then clean up anything the rewrite disturbed (names, POV, canon) — so you get the craft gains without an LLM rewrite silently drifting the book.

### Clearer errors

- **Premise analysis says why it failed.** When "Analyze" can't reach the AI provider, the message now names the cause and the fix — "the AI provider (OpenRouter) is out of credits — top up the account, then re-run Analyze" — instead of the opaque "Premise intake failed".

## 2026-07-27

### Book Completeness & Pacing

- **Books now generate their full, planned arc.** The complete chapter outline — every chapter's structural beat (meet-cute, first kiss, midpoint, black moment, reunion, Happily-Ever-After) and the intimate scenes a spicy book promises — now reaches each chapter as it is written. The back half of a book no longer drifts off-plan or drops its ending.
- **Chapter count and length are honored.** A book created from a premise file now generates the number of chapters and the words-per-chapter you chose, instead of falling back to a fixed default.
- **The ending is safeguarded.** Generation now checks that the final chapter actually delivers the Happily-Ever-After. A missing ending is surfaced for human review, and the completion report can no longer claim a resolution the manuscript does not contain.

### Consistency & Canon

- **Names are locked early and stay put.** Every character — including ones the premise only hints at ("her sister", "the café owner") — is named up front, with AI-cliché names steered away from, and the setting no longer invents its own cast. Names stop drifting or colliding later in the book.
- **A canon fact-sheet keeps every chapter honest.** Character names, ages, POV/tense, and key places are captured once and fed into every chapter and the consistency check; a name that sneaks in mid-book is flagged for review.
- **The consistency check stops rubber-stamping.** It now verifies each chapter against the fact-sheet (names, ages, POV/tense, places) rather than waving chapters through, with a deterministic POV/tense check as a backstop.
- **Romance engagement review, human-gated.** Whole-book (arc and pacing) and per-chapter engagement checks run during generation and pause in the Confirmations screen for your sign-off; a weak or stalled chapter is flagged automatically.
- **The Consistency Auditor scans the final chapter.** It now reads the final, humanized version of each chapter rather than the first draft, so its findings reflect the manuscript that actually ships.

### Cleaner, more human prose

- **Far fewer AI tells.** The de-AI pass's word list grew from a handful of entries to roughly sixty-five — clichés like "delve", "tapestry", and "a testament to", and filter phrases like "he watched / she noticed", are now removed or rephrased.
- **The de-AI pass can no longer damage prose.** It will never inject a stray name, flip a character's point of view, add a phantom object, or duplicate a word — worst case, it leaves a line unchanged.
- **Em-dashes are used sparingly.** A cap keeps them to a couple per chapter (dialogue interruptions exempt) instead of the one-per-paragraph flood language models tend toward.

### Distinct author voices

- **Pen names read differently.** An author's voice profile can now carry measurable "prose mechanics" (sentence rhythm, punctuation habits, metaphor domain) and short sample passages the drafting step imitates — so two pen names sound distinct even on the same beat, not just different on paper.
