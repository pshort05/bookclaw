# Changes — What's New

A running log of notable, user-facing changes to BookClaw, newest first. Entries are grouped by theme rather than listed file-by-file; see the git history for the fine detail.

## 2026-09-16

### Writing passes that earn their place

- **The de-AI sweep is now optional, and off where it is redundant.** The romance pipelines' own drafting instructions already forbid the things the sweep removes — the first-draft skill has a section headed "Avoid these AI tells" and bans adverbs, clichés, em-dashes and filter language. Measured across twelve chapters of a live book, the sweep matched **zero** entries from its own tell list, because the draft never contained any. With nothing on-task to do it line-edited instead, injecting four passages of new prose and rewriting eight impersonal "you"s into "I" — against its own rule that it may only remove, never add. Pipelines whose drafting instructions carry those rules now mark the sweep optional and skip it; pipelines that don't (romantasy, technothriller) keep running it. Set `deaiSweep: "run"` on a book to turn it back on.
- **A skipped pass no longer takes the review gate with it.** Generation pauses for you at the last step of a chapter — which was the sweep. Skipping it would have silently stopped every per-chapter and act review from firing. The boundary now lands on the last step that actually runs, and a skipped stage shows in the version trail with the reason it was skipped rather than leaving a hole.

## 2026-09-14

### Choosing models for a whole book

- **Change one step's model, change them all.** Picking a different model for chapter 7's First Draft used to leave the other 24 chapters behind, and re-pinning by hand across a long book was not realistic. The model editor in the Write rail now offers **"Apply to every First Draft"** (it names whichever step you opened), which sets that step *kind* across the entire book in one click. Other kinds are untouched — changing the draft never drags your scene briefs or revisions onto the same model.
- **It covers chapters you have not written yet.** The choice is saved on the book itself, not only on the chapters that currently exist, so chapter 38 of a 38-chapter book picks it up when it is finally written. Your creative and surgical temperature settings are carried across unchanged — switching a model never quietly re-heats the prose.

### The canon gate means something now

- **Approving or rejecting a flagged place name now changes what happens next.** The canon check pauses when a chapter introduces a place the book's grounding doesn't recognise, and asks you to decide — but nothing read your answer. Approve and reject were the same no-op: the name stayed in the document either way, and the same name was flagged again on the next run. Accepting a place now records it as part of the book's canon, so it stops being questioned; declining records that too. The buttons say what they do ("Accept as canon" / "Not canon") rather than implying an edit that never happened.
- **A place the checker simply can't verify no longer looks like an error.** A book anchored to one small town but set across several real places had every street it named — Ludlow, Delancey, Canal, Fifth Avenue, Queens Boulevard — reported as invented, because the anchor listed no streets to check against and "nothing to compare" was being reported as "wrong". Seventeen flags, none of them actionable. The gate now separates the two: where there is a real alternative to offer, it still asks; where there is nothing to check against, it notes the name and keeps going instead of stopping you for a decision you can't make.

### Consistency you can trust

- **The consistency checker stopped inventing contradictions.** Three defects made it report problems that were not there — on the last book, 19 flags across three chapters and *every one* was an artifact. Every chapter's facts were stamped with the same story time, so a scene in chapter 1 and a scene in chapter 2 were compared as if they happened at the same moment ("Jay is both at the office and at his apartment"). Values that differed only by a trailing full stop, a curly apostrophe or a stray space were treated as different, producing a "contradiction" between two identical-looking sentences. And a deleted book left its facts behind, so a rebuilt book was checked against the chapters of the book it replaced — flagging chapter 1 against a chapter 24 that no longer existed.
- **Deleting a book now clears its consistency data** — its facts, its knowledge and its cached consistency report — so a book you recreate starts clean instead of inheriting a ghost. Canon shared with other books in the same world is deliberately preserved.
- **Fewer missed real problems, too.** Fixing the above surfaced two ways genuine errors were being *hidden*: a "used knowledge before learning it" violation was suppressed whenever the facts came from a full audit, and a real contradiction could be excused because the live check had no clock to compare against. Both now behave.

## 2026-09-13

### Chapter length you asked for

- **The outline now writes to your word target.** Setting 25 chapters of 2,400 words produced an outline planning ~90,000 words with 3,200-word chapters: the outline step was told the chapter count but never the word target, while the premise's own pacing notes ("24–28 chapters, 80,000–90,000 words") were handed to it as canon, so it followed the only number it had. Every outline prompt now states the per-chapter target, and says plainly that your chapter and word settings override any length stated in the premise or blueprint. The chapters themselves were always drafted to your target — it was the plan that drifted.
- **A premise that disagrees with your settings now says so.** When the premise file states a book length or chapter count that contradicts what you chose, intake flags it alongside the other fact-checks, quoting the line from the premise and telling you which number wins, instead of letting the two disagree silently. The check re-runs as you edit the chapter count or words-per-chapter on the review screen, so a disagreement you introduce there is caught too — and clears itself the moment you fix the numbers.

### Consistency that acts

- **The consistency checker's findings now reach the writing.** Every contradiction, knowledge-leak and timeline slip the ledger catches after a chapter's first draft is handed to the Rewrite pass as a named list of issues to fix — alongside the craft and dialogue notes it already received. Until now those findings only ever appeared in a review panel: *Three Months of Summer* carries 113 of them across all 24 chapters, and not one reached the pass that could have fixed it, because the wiring looked for step names the romance pipelines don't use.
- **A chapter thick with contradictions now stops for you.** When a chapter crosses a threshold of contradictions (six by default), generation pauses for review once that chapter is finished, with the count and the specific contradictions listed in plain language. Previously only a beat or ending problem could stop a run — a chapter could ship with nine contradictions without pausing. The pause happens once per chapter, after the rewrite has had its chance, and never interrupts a book you've set to run autonomously. Set `BOOKCLAW_CONTRADICTION_GATE` to tune the threshold, or to `off` to disable it; the setting is reported at startup.

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
