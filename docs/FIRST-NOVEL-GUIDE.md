# BookClaw — Your First Novel, Step by Step

A practical, end-to-end walkthrough: from a one-sentence idea to chapter files on disk. Assumes you've already installed BookClaw and the studio loads at **http://localhost:3847**. If you haven't, see [QUICKSTART.md](QUICKSTART.md) and come back here.

This guide is opinionated. It walks the *path of least resistance* for someone writing their first book with BookClaw — pipeline mode, studio-driven, with Telegram on the side for mobile control. The optional standalone Chat app (enabled by setting `BOOKCLAW_CHAT_PORT=3848`, then reachable at **http://localhost:3848**) is a phone-friendly alternative surface for the same chat interface. Once you've shipped one book this way, branch out.

---

## Mental model — what BookClaw actually does

Before you click anything, internalize this:

- **You give BookClaw a *persona* and a *premise.*** Everything downstream is built off those two anchors.
- **A book is a *pipeline* — 6 phases, run end to end.** Planning → Bible → Production → Revision → Format → Launch. You can run the whole pipeline with one command, or run each phase individually if you want to review between steps.
- **Every phase produces files** under the book's container at `workspace/books/<slug>/data/` (one markdown file per step). You can open them, edit them, and the next phase will read your edits.
- **Skills, not templates, do the actual writing.** BookClaw matches a focused skill to each step from its catalog (~50 skills) and injects that skill's content into the prompt. You don't pick skills — the planner does.
- **Pipeline state is durable.** You can `/stop` mid-novel, close your laptop, and resume from the studio or Telegram days later.
- **A book is a *container.*** Each project is bound to a book at creation (`workspace/books/<slug>/`), and its persona, voice, genre, and output routing all resolve from that binding — so multiple books can run concurrently without cross-contamination.
- **You are the editor, not the typist.** Plan to spend 10–15 minutes reviewing each phase's output before unlocking the next. Set that expectation now and the rest is easy.

---

## Before you start — a 10-minute prep checklist

Don't skip these. The single biggest determinant of output quality is the inputs you give the persona and the planning phase.

- [ ] **Decide your pen name.** Real or fictional. This will become the *Persona* and will color voice, themes, and bio.
- [ ] **Write your idea in one to three sentences.** Not a synopsis — a logline. Example: *"A burned-out hedge fund analyst on vacation falls for the rival firm's heir, only to discover their families have been at war for thirty years."*
- [ ] **Pick a genre + sub-genre.** "Romance" is too broad. "Contemporary romance, billionaire/dual-POV, heat level 4" is workable. The narrower, the better the planning. (Genre maps to a named library profile in BookClaw — a genre guide that the book container snapshots and feeds into the system prompt at every step, so a specific genre choice matters more than it used to.)
- [ ] **Pick a target word count.** 75k–95k for romance, 90k–110k for thriller, 100k–130k for epic fantasy. Don't say "long" — say "85,000 words."
- [ ] **Have a Gemini API key saved in Settings.** Free tier is enough for your first book. Add Claude later for the revision phase if you want premium edits.
- [ ] **Decide where you'll review the output.** The studio (browser) and Telegram (phone) both work. The studio is better for the first book — you see file contents inline.

If any of those bullets stall you, pause here. Five minutes of clarity now saves an hour of regenerating off-target chapters later.

---

## STEP 1 — Create your Author

The author identity is the single most-injected piece of context in every step that follows. Get it right.

> Terminology note: the studio's canonical concept is now **Author** (the pen-name identity — name, bio, voice) plus a separate **Voice** asset (prose style). This consolidates the older "persona" / "soul" concepts; where this guide says "persona," read it as your Author. The legacy `personas.json` store still exists under the hood.

### 1a. Open the New-Book picker
In the v6 studio, author/voice/genre selection is part of the **New-Book picker** flow (the `New Book` route). You pick from your library of **Author**, **Voice**, and **Genre** assets (probably sparse on a fresh install) before you create a book; you can also create or edit those assets in the **Asset Studio**.

### 1b. Create your persona
Two paths:

**Path A — AI-generated (recommended for first run).** Click **Generate with AI**. Provide:
- Pen name
- Genre + sub-genre (the narrow one you decided above)
- A one-line author bio vibe ("seasoned thriller writer with a finance background" / "warm voice, small-town romance specialist")
- Preferred TTS voice (optional — affects `/speak` output later)

BookClaw drafts a full persona profile: voice characteristics, style markers, common tropes, banned vocabulary, bio for back-matter. Review it. Edit anything that feels off.

**Path B — Manual.** Click **New Persona** and fill the fields yourself. Slower but tighter if you have a strong sense of voice already (e.g., you're a working author bringing your existing style to BookClaw).

### 1c. Lock the persona before continuing
Open the persona detail view and confirm:
- Pen name spelled exactly the way you want it on the cover
- Genre + heat/violence level set explicitly (e.g., "Heat Level 4 — explicit" or "Heat Level 1 — closed door")
- TTS voice assigned if you want to hear chapters read aloud
- Style notes that mention POV preference (1st/3rd, single/dual) — this drives chapter structure

### 1d. Where the persona lives on disk
`workspace/.config/personas.json` — back this up the first time you tune one you like. Personas survive BookClaw updates, but a hand-tuned persona is too valuable to lose to a fat-fingered reset.

---

## STEP 2 — Choose your project mode

You have two ways to start a novel. Pick one based on how much you want to babysit.

| Mode | What it does | Best for |
|---|---|---|
| **Pipeline** | Runs all 6 phases automatically, end to end | Your first book. You'll see the full system in motion. |
| **Phase-by-phase** | You run Book Planning, review, then start Book Bible, review, etc. | Books where the premise is unusual or experimental and you want to course-correct between phases. |

For this guide we run **Pipeline mode.** Once you've shipped one book this way you'll know which phases need closer supervision next time.

---

## STEP 3 — Kick off the novel pipeline

### 3a. From the studio
Studio → **Write** workspace (left rail) → chat box.

Type:
```
/novel <your one-line idea>
```

Concrete example:
```
/novel A burned-out hedge fund analyst on vacation falls for the rival firm's heir, only to discover their families have been at war for thirty years. Contemporary romance, dual POV, heat level 4, 90,000 words. Pen name: KS Rhysdale.
```

Press **Send**.

### 3b. From Telegram (alternative)
Same `/novel` command, same body. BookClaw will reply with the pipeline plan.

### 3c. What you'll see immediately
The agent replies with the pipeline outline:

```
📖 Novel pipeline created: 48 steps
   Phase 1: Book Planning    (6 steps)
   Phase 2: Book Bible       (5 steps)
   Phase 3: Book Production  (20 steps)
   Phase 4: Deep Revision    (21 steps)
   Phase 5: Format & Export  (4 steps)
   Phase 6: Book Launch      (6 steps)
   
   Phase 1 started. Persona 'KS Rhysdale' context injected.
```

The numbers vary based on word count + chapter count. A 90k-word, 30-chapter novel comes out to ~70 production steps.

### 3d. Note the project ID
The studio shows a card for the new project. The project ID looks like `proj_2026-05-28_a3f7b2`. Write it down or pin the card — you'll want it for `/files`, `/read`, `/stop`, and the API calls in `LAUNCH-GUIDE.md`.

---

## STEP 4 — Phase 1: Book Planning (the most important review)

Phase 1 runs automatically. Each step writes one markdown file into the book's container at `workspace/books/<slug>/data/` (files are named after the step, e.g. `<step-id>-premise.md`; access them by number through `/files` / `/read` rather than guessing the exact name). The planning steps cover:

| Step output | What it is | What to look for |
|---|---|---|
| Market analysis | Comp titles, audience, hooks | Does it pick the right tropes for your genre? |
| Premise | The expanded premise | Is the conflict actually conflictful? |
| Characters | Cast list with arcs | Two leads minimum. Each with a wound + a want. |
| Outline | High-level beat structure | Inciting incident, midpoint, black moment, resolution — all present? |
| Synopsis | One-page synopsis | This is the file you'd give a future agent or KDP listing. |
| Structure | Chosen story structure | Should match your genre (Romancing the Beat for romance, Save the Cat for thriller, etc.) |

### 4a. Stop the pipeline after Planning
While Phase 1 is running, watch the **Activity** view (left rail in the studio). The moment it shows **Phase 1 complete, starting Phase 2**, click **Stop** (or send `/stop`).

```
/stop
```

This is the most important checkpoint in the whole pipeline. Everything downstream — bible, chapters, revisions — compounds on Phase 1's output. A weak premise here yields a weak novel six hours later.

### 4b. Read every Phase 1 file
Studio → your project → **Files**. Or:
```
/files
/read 3
```
(`3` being the file number from the `/files` listing.)

### 4c. Edit anything that feels off
Open the files directly under the book's data directory:
```
workspace/books/<slug>/data/
```
Find the outline file (the step name is in the filename), edit it in any text editor, and save. BookClaw will read your edits when Phase 2 starts.

Things to fix at this stage:
- **Generic character names** — change them. The leads are stuck with whatever name lands here.
- **A flabby midpoint** — outline midpoints often default to "they get together." Tighten it to something that actively raises stakes.
- **Missing conflict** — if both leads agree on everything by chapter 4, the book has no engine. Add an external pressure (a deadline, a rival, a family threat).
- **Word count drift** — if the outline implies 60 chapters and you asked for 90k words, something is off. Reconcile now.

### 4d. Resume the pipeline
```
continue
```
Or click **Resume** on the project card.

---

## STEP 5 — Phase 2: Book Bible (your continuity insurance)

Phase 2 produces the documents that every subsequent chapter will be checked against (again, one markdown file per step in `workspace/books/<slug>/data/`):

| Step output | Purpose |
|---|---|
| World-building | Setting, era, technology, rules. Even contemporary romance has a "world" (the firm, the city, the social rules). |
| Character bible | Full per-character profiles — backstory, voice samples, physical detail, arc. |
| Continuity | Locations, timeline, recurring objects. This is what catches "she had brown eyes in chapter 3 and green eyes in chapter 19." |
| Themes | What the book is *about* beneath the plot. |
| Style | Voice constraints — banned words, sentence-length cadence, dialogue rhythm. |

### 5a. Same checkpoint pattern as Phase 1
Let Phase 2 finish, then `/stop`. Read every file. Edit aggressively.

The character bible is the single highest-leverage edit you can make in the whole pipeline. The chapters in Phase 3 will be only as alive as these profiles are. If a character bible reads "ambitious, smart, hardworking" — rewrite it. Make them *specific.* The bible BookClaw drafts is a starting point, not a finish line.

### 5b. Add your own files if you have them
Drop additional reference docs into the book's `workspace/books/<slug>/data/` directory and they'll be picked up by the production phase. This is where you'd paste a hand-written character backstory, a real-world location guide, or research notes.

### 5c. Resume
```
continue
```

---

## STEP 6 — Phase 3: Book Production (the chapters arrive)

This is the long phase. For a 90k-word book, expect:
- ~30 chapters
- One "write" step + one "self-review" step per chapter = ~60 steps
- Run time depends entirely on which AI provider you've routed creative writing to (free Gemini = slower per-token, premium Claude = faster + tighter prose, costs more)

### 6a. What gets produced
For each chapter, BookClaw writes one markdown file into the book's data directory, named after the step that produced it (e.g. a step labeled "Chapter 1" lands as a `…-chapter-1.md` file):
```
workspace/books/<slug>/data/
```

Use `/files` to see the numbered list and `/read N` to open one — that's more reliable than guessing the exact filename.

### 6b. Watch the first three chapters carefully
The first three chapters are where voice locks in. If chapters 1–3 feel right, the rest of the book will inherit that voice. If they feel wrong, fix them now before the agent compounds the problem 27 more times.

**Things to check on chapter 1:**
- POV character matches the outline
- Opening hook is concrete, not abstract
- Persona voice is recognizable
- Word count is in range (~2,000–3,500 for most genres)
- No banned-vocabulary slip-ups (check the style file from Phase 2 for the list)
- Chapter ends on a *hook*, not a summary

**If a chapter is off:**
```
/stop
```
Then either:
- **Edit the chapter file directly** and let the next chapter's context inherit your edits, OR
- **Delete the chapter file and ask the agent to retry**:
  ```
  /project rewrite chapter 1 with more sensory grounding and a sharper opening hook
  ```

Then `continue`.

### 6c. Let it run for the bulk of the book
After you've validated chapters 1–3, you can let the agent run unattended. It will continue writing chapter by chapter, with each step pulling context from prior chapters, the bible, and the persona.

Check in every 5–10 chapters to make sure nothing has drifted (character voice, POV, pacing).

### 6d. The "compile" step
After all chapters are drafted, the compile step stitches them into a single working manuscript:
```
workspace/books/<slug>/data/manuscript.md
```
This is your **first complete draft.** Congratulations — you have a novel.

---

## STEP 7 — Phases 4, 5, 6 (revision, export, launch)

Once Phase 3 finishes, the pipeline rolls forward. You can let it run end-to-end or stop after each phase.

All phase outputs land as step files in the same `workspace/books/<slug>/data/` directory; use `/files` to list them.

### Phase 4 — Deep Revision
Three passes — structural → scene-level → line-level — plus AI beta readers. The revised manuscript is written back into the book's data directory (a `manuscript.md` / revised-manuscript file). This is the version you'd send to a human editor.

### Phase 5 — Format & Export
Generates front matter, back matter, and KDP-ready files. DOCX export writes a `.docx` alongside the manuscript in the data directory (also reachable via `/export N docx`); the `.docx` matches KDP's trim-size templates.

### Phase 6 — Book Launch
Marketing copy — blurb, Amazon description, keywords, ad copy, social posts — each produced as its own step file in the data directory.

These are drafts. Review and edit before publishing — *especially* the blurb.

---

## Common operations you'll want during a novel run

### Check progress without interrupting
```
/status
```
or just glance at the project card in the studio.

### See all output files
```
/files
```
Numbered list. Then:
```
/read 7
```
to preview file 7.

### Export a single chapter to Word
```
/export 7 docx
```

### Have the agent read a chapter aloud
```
/speak 7
```
Uses your persona's TTS voice. Audio files self-delete after 24 hours — save them if you want to keep them.

### Pause and resume
```
/stop      ← pauses at the current step
continue   ← resumes from where it stopped
```

### Track word count toward a daily goal
Studio → **Insights** view (left rail) → today's writing progress. Set your goal in **Settings → Autonomous Heartbeat Mode**.

### Switch the active book
Studio → **Book drawer** → select a different book → **Set Active**. Each book is bound to its own persona/voice/genre, so switching the active book switches the persona that free chat uses. Or assign a persona explicitly when you create a project.

---

## When something goes wrong

| Symptom | Most likely cause | Fix |
|---|---|---|
| Chapter is generic / off-voice | Persona under-specified | Edit persona, delete the bad chapter, retry |
| Pipeline stuck at one step | Provider rate-limit or API outage | Check Settings → provider status. Add a fallback provider or wait. |
| Character names changed mid-book | Bible wasn't locked before Phase 3 | Edit the character-bible file in `workspace/books/<slug>/data/`, edit affected chapters, continue |
| Chapter ends with a summary sentence | Style guide didn't pick up | Add "no summary sentences at chapter end" to persona's style notes |
| Output too short for word target | Outline split the book into too few chapters | Stop, edit the outline file in `workspace/books/<slug>/data/` to add chapters, restart Phase 3 |
| Agent re-asks for info you already gave | Context truncation | Check `workspace/memory/` — it should have the bible + prior chapters. If not, restart the step and continue. |
| Project totally derailed | Bad Phase 1 output | Faster to start a new project with a tighter premise than to dig out |

For everything else: the **Activity** view (left rail in the studio) shows every step the agent took, what skills it called, and what the output was. Read it like a flight recorder.

---

## A realistic first-book timeline

| Phase | Active time (you) | Wall-clock time (agent) |
|---|---|---|
| Prep + persona | 20–30 min | — |
| Phase 1 (Planning) + your review | 15 min review | 10–20 min |
| Phase 2 (Bible) + your review | 20 min review | 15–25 min |
| Phase 3 (Production) — first 3 chapters | 30 min review | 30–60 min |
| Phase 3 (Production) — rest | Check in every 5 chapters | 3–10 hours unattended |
| Phase 4 (Revision) | 30 min final review | 1–3 hours |
| Phase 5 (Format) | 5 min | 5–15 min |
| Phase 6 (Launch) | 30 min editing copy | 15–30 min |

**Total active time:** ~2.5 hours of your attention. **Total wall-clock:** half a day to a full weekend, depending on provider speed.

Don't aim to ship a publish-ready novel on the first run. Aim to ship a *complete draft* that proves the pipeline. The second book will be much faster because your persona is tuned and you know which phases need closer supervision.

---

## What to do after your first novel

- **Back up your persona.** Copy `workspace/.config/personas.json` somewhere safe.
- **Save the project's bible.** Future books in the same world should reuse the world-building and continuity files from the book's `workspace/books/<slug>/data/` directory. (For a multi-book world, BookClaw also has a series container at `workspace/series/`.)
- **Note which phases you babysat.** That's the editing pass you'll always need for this genre/voice combination. Bake the lesson into the persona's style notes.
- **Add a paid provider if you're going to ship the book.** Free Gemini is fine for drafts. For revision and final polish, Claude or GPT-4o materially improves the line-edit quality. Costs are typically $1–4 per full-novel revision pass.
- **Run a second book.** This is where BookClaw earns its keep. Book 2 in the same persona, in the same world, with the same bible, will run faster and tighter than book 1 ever could.

---

## Where to look next

- **[QUICKSTART.md](QUICKSTART.md)** — install + first task (the 5-minute version of this guide)
- **[LAUNCH-GUIDE.md](LAUNCH-GUIDE.md)** — server ops, ports, Docker, security
- **[README.md](../README.md)** — full feature reference and architecture
- **[SECURITY.md](SECURITY.md)** — vault, sandbox, network posture
- **`workspace/SKILLS.txt`** — auto-generated catalog of every skill the planner can call (read this when you want to understand *why* a step picked a particular skill)

Welcome to the workflow. The first book is the hardest. The rest are mostly editing.
