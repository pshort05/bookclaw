# Changes — What's New

A running log of notable, user-facing changes to BookClaw, newest first. Entries are grouped by theme rather than listed file-by-file; see the git history for the fine detail.

## 2026-09-12

### Reading your book

- **View Book — read the whole book in one place.** A new button beside "Open in Write" opens your book as a book: contents down the left (front matter, the chapters, back matter, reference documents and launch copy), the chapter typeset for reading in the middle, and its raw markdown on the right. Click any chapter to jump to it; the latest version always opens first. Press **b** from anywhere to pull it up. Older books that were never attached to a run open too: whatever markdown the book holds is listed under Reference — a whole-book `Manuscript` first — and is readable and editable there.
- **Every draft of a chapter, one click apart.** The pipeline writes seven files per chapter — scene brief, first draft, improvement plan, rewrite, consistency audit, consistency apply, de-AI sweep. The version trail lists them in order with the current one marked, so reading an earlier draft no longer means guessing at file names. Earlier versions are read-only; only the current one can be edited.
- **Edit while you read.** The raw pane saves straight back to the chapter's own file. When the book is paused at a gate, saving becomes "Approve with my edits" — your text becomes the chapter and the run continues, instead of being overwritten when the pipeline resumes.
- **Approve a chapter where you actually read it.** A paused run now shows its state in the header, greys out the chapters it hasn't written yet, and puts the approve/regenerate/stop decision on the gated chapter itself, under the findings — rather than in a queue where you approve prose you can't comfortably read.
- **See what hasn't been written.** Front matter, back matter and launch copy your book doesn't have yet are listed but greyed, each naming the skill or pipeline that writes it, runnable from the page.
- **Compile the book into one file.** One button assembles front matter, chapters and back matter into a single manuscript, readable in the same view. An unfinished book still compiles and says how much of it went in.
- **The panes are yours to size.** Drag the divider on either side of the chapter to widen the contents list or the raw markdown; the view remembers your widths. Double-click a divider to reset it, or focus it and use the arrow keys. The chapter text now fills 80% of its pane rather than a fixed measure, so it grows as you give it room.
- **Long consistency flags fit the contents list.** A flag whose text ran off the edge of the column now clips with the full wording on hover, and a chapter with more than three flags shows the most serious three plus a "+N more" count instead of a wall of orange.

### Fixes

- **Full-manuscript assembly works for the deterministic romance pipelines again.** Assembling or downloading a complete manuscript matched only the older `write`/`polish` chapter files, so books written by the deterministic pipelines assembled to nothing. The same fix stops manuscript analysis from being handed each chapter twice.

## 2026-08-18

### Mobile

- **You can approve from your phone.** The Confirmations screen — where generation pauses for your sign-off — no longer squeezes the item under review into an unreadable one-word-per-line column. On a phone the queue and the item now stack full-width: the chapter prose, the pre-review notes and the Approve / Reject buttons are all readable and tappable without sideways scrolling. Editing a chapter in place works too — the editor no longer triggers iOS's zoom-on-focus. Desktop is unchanged.

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
