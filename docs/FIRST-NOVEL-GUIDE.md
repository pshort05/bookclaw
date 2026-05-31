# BookClaw — Your First Novel, Step by Step

A practical, end-to-end walkthrough: from a one-sentence idea to chapter files on disk. Assumes you've already installed BookClaw and the dashboard loads at **http://localhost:3847**. If you haven't, see [QUICKSTART.md](QUICKSTART.md) and come back here.

This guide is opinionated. It walks the *path of least resistance* for someone writing their first book with BookClaw — pipeline mode, dashboard-driven, with Telegram on the side for mobile control. Once you've shipped one book this way, branch out.

---

## Mental model — what BookClaw actually does

Before you click anything, internalize this:

- **You give BookClaw a *persona* and a *premise.*** Everything downstream is built off those two anchors.
- **A book is a *pipeline* — 6 phases, run end to end.** Planning → Bible → Production → Revision → Format → Launch. You can run the whole pipeline with one command, or run each phase individually if you want to review between steps.
- **Every phase produces files** under `workspace/projects/<project-id>/`. You can open them, edit them, and the next phase will read your edits.
- **Skills, not templates, do the actual writing.** BookClaw dynamically picks 19 focused skills per step. You don't pick skills — the planner does.
- **Pipeline state is durable.** You can `/stop` mid-novel, close your laptop, and resume from the dashboard or Telegram days later.
- **You are the editor, not the typist.** Plan to spend 10–15 minutes reviewing each phase's output before unlocking the next. Set that expectation now and the rest is easy.

---

## Before you start — a 10-minute prep checklist

Don't skip these. The single biggest determinant of output quality is the inputs you give the persona and the planning phase.

- [ ] **Decide your pen name.** Real or fictional. This will become the *Persona* and will color voice, themes, and bio.
- [ ] **Write your idea in one to three sentences.** Not a synopsis — a logline. Example: *"A burned-out hedge fund analyst on vacation falls for the rival firm's heir, only to discover their families have been at war for thirty years."*
- [ ] **Pick a genre + sub-genre.** "Romance" is too broad. "Contemporary romance, billionaire/dual-POV, heat level 4" is workable. The narrower, the better the planning.
- [ ] **Pick a target word count.** 75k–95k for romance, 90k–110k for thriller, 100k–130k for epic fantasy. Don't say "long" — say "85,000 words."
- [ ] **Have a Gemini API key saved in Settings.** Free tier is enough for your first book. Add Claude later for the revision phase if you want premium edits.
- [ ] **Decide where you'll review the output.** Dashboard (browser) and Telegram (phone) both work. The dashboard is better for the first book — you see file contents inline.

If any of those bullets stall you, pause here. Five minutes of clarity now saves an hour of regenerating off-target chapters later.

---

## STEP 1 — Create your Author Persona

The persona is the single most-injected piece of context in every step that follows. Get it right.

### 1a. Open the Personas tab
Dashboard → **Personas** (sidebar). You'll see a card grid, probably empty on a fresh install.

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

### 3a. From the dashboard
Dashboard → **Home** tab → chat box at the bottom.

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
The dashboard shows a card for the new project under **Projects**. The project ID looks like `proj_2026-05-28_a3f7b2`. Write it down or pin the card — you'll want it for `/files`, `/read`, `/stop`, and the API calls in `LAUNCH-GUIDE.md`.

---

## STEP 4 — Phase 1: Book Planning (the most important review)

Phase 1 runs automatically. It produces ~6 files in `workspace/projects/<project-id>/01-planning/`:

| File | What it is | What to look for |
|---|---|---|
| `market-analysis.md` | Comp titles, audience, hooks | Does it pick the right tropes for your genre? |
| `premise.md` | The expanded premise | Is the conflict actually conflictful? |
| `characters.md` | Cast list with arcs | Two leads minimum. Each with a wound + a want. |
| `outline.md` | High-level beat structure | Inciting incident, midpoint, black moment, resolution — all present? |
| `synopsis.md` | One-page synopsis | This is the file you'd give a future agent or KDP listing. |
| `structure.md` | Chosen story structure | Should match your genre (Romancing the Beat for romance, Save the Cat for thriller, etc.) |

### 4a. Stop the pipeline after Planning
While Phase 1 is running, watch the Activity Log. The moment the dashboard shows **Phase 1 complete, starting Phase 2**, click **Stop** (or send `/stop`).

```
/stop
```

This is the most important checkpoint in the whole pipeline. Everything downstream — bible, chapters, revisions — compounds on Phase 1's output. A weak premise here yields a weak novel six hours later.

### 4b. Read every Phase 1 file
Dashboard → Projects → your project → **Files**. Or:
```
/files
/read 3
```
(`3` being the file number from the `/files` listing.)

### 4c. Edit anything that feels off
Open the files directly:
```
workspace/projects/<project-id>/01-planning/outline.md
```
Edit in any text editor. Save. BookClaw will read your edits when Phase 2 starts.

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

Phase 2 produces the documents that every subsequent chapter will be checked against:

| File | Purpose |
|---|---|
| `world-building.md` | Setting, era, technology, rules. Even contemporary romance has a "world" (the firm, the city, the social rules). |
| `character-bible.md` | Full per-character profiles — backstory, voice samples, physical detail, arc. |
| `continuity.md` | Locations, timeline, recurring objects. This is what catches "she had brown eyes in chapter 3 and green eyes in chapter 19." |
| `themes.md` | What the book is *about* beneath the plot. |
| `style.md` | Voice constraints — banned words, sentence-length cadence, dialogue rhythm. |

### 5a. Same checkpoint pattern as Phase 1
Let Phase 2 finish, then `/stop`. Read every file. Edit aggressively.

The character bible is the single highest-leverage edit you can make in the whole pipeline. The chapters in Phase 3 will be only as alive as these profiles are. If a character bible reads "ambitious, smart, hardworking" — rewrite it. Make them *specific.* The bible BookClaw drafts is a starting point, not a finish line.

### 5b. Add your own files if you have them
Drop additional reference docs into `workspace/projects/<project-id>/02-bible/` and they'll be picked up by the production phase. This is where you'd paste a hand-written character backstory, a real-world location guide, or research notes.

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
For each chapter, BookClaw writes:
```
workspace/projects/<project-id>/03-production/ch-01.md
workspace/projects/<project-id>/03-production/ch-02.md
...
```

Files are zero-padded so they sort correctly (`ch-01.md` not `ch-1.md`). This matters for the format phase later.

### 6b. Watch the first three chapters carefully
The first three chapters are where voice locks in. If chapters 1–3 feel right, the rest of the book will inherit that voice. If they feel wrong, fix them now before the agent compounds the problem 27 more times.

**Things to check on chapter 1:**
- POV character matches the outline
- Opening hook is concrete, not abstract
- Persona voice is recognizable
- Word count is in range (~2,000–3,500 for most genres)
- No banned-vocabulary slip-ups (check `02-bible/style.md` for the list)
- Chapter ends on a *hook*, not a summary

**If a chapter is off:**
```
/stop
```
Then either:
- **Edit `ch-01.md` directly** and let the next chapter's context inherit your edits, OR
- **Delete `ch-01.md` and ask the agent to retry**:
  ```
  /project rewrite chapter 1 with more sensory grounding and a sharper opening hook
  ```

Then `continue`.

### 6c. Let it run for the bulk of the book
After you've validated chapters 1–3, you can let the agent run unattended. It will continue writing chapter by chapter, with each step pulling context from prior chapters, the bible, and the persona.

Check in every 5–10 chapters to make sure nothing has drifted (character voice, POV, pacing).

### 6d. The "compile" step
After all chapters are drafted, Phase 3's last step compiles them into a single working manuscript:
```
workspace/projects/<project-id>/03-production/manuscript.md
```
This is your **first complete draft.** Congratulations — you have a novel.

---

## STEP 7 — Phases 4, 5, 6 (revision, export, launch)

Once Phase 3 finishes, the pipeline rolls forward. You can let it run end-to-end or stop after each phase.

### Phase 4 — Deep Revision (21 steps)
Three passes — structural → scene-level → line-level — plus AI beta readers. Output:
```
workspace/projects/<project-id>/04-revision/manuscript-final.md
```
This is the version you'd send to a human editor.

### Phase 5 — Format & Export (4 steps)
Generates front matter, back matter, and KDP-ready files:
```
workspace/projects/<project-id>/05-format/<title>.docx
workspace/projects/<project-id>/05-format/<title>.epub
```
The `.docx` matches KDP's trim-size templates; the `.epub` is valid EPUB3.

### Phase 6 — Book Launch (6 steps)
Marketing copy:
```
workspace/projects/<project-id>/06-launch/blurb.md
workspace/projects/<project-id>/06-launch/amazon-description.html
workspace/projects/<project-id>/06-launch/keywords.md
workspace/projects/<project-id>/06-launch/ad-copy.md
workspace/projects/<project-id>/06-launch/social-posts.md
```

These are drafts. Review and edit before publishing — *especially* the blurb.

---

## Common operations you'll want during a novel run

### Check progress without interrupting
```
/status
```
or just glance at the project card on the dashboard.

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
Dashboard → **Home** → today's writing progress bar. Set your goal in **Settings → Autonomous Heartbeat Mode**.

### Switch the active persona
Dashboard → **Personas** → click a card → **Set Active**. Or assign a persona explicitly when you create a project.

---

## When something goes wrong

| Symptom | Most likely cause | Fix |
|---|---|---|
| Chapter is generic / off-voice | Persona under-specified | Edit persona, delete the bad chapter, retry |
| Pipeline stuck at one step | Provider rate-limit or API outage | Check Settings → provider status. Add a fallback provider or wait. |
| Character names changed mid-book | Bible wasn't locked before Phase 3 | Edit `02-bible/character-bible.md`, edit affected chapters, continue |
| Chapter ends with a summary sentence | Style guide didn't pick up | Add "no summary sentences at chapter end" to persona's style notes |
| Output too short for word target | Outline split the book into too few chapters | Stop, edit `01-planning/outline.md` to add chapters, restart Phase 3 |
| Agent re-asks for info you already gave | Context truncation | Check `workspace/memory/` — it should have the bible + prior chapters. If not, run `/compact` and continue. |
| Project totally derailed | Bad Phase 1 output | Faster to start a new project with a tighter premise than to dig out |

For everything else: the **Activity Log** tab on the dashboard shows every step the agent took, what skills it called, and what the output was. Read it like a flight recorder.

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
- **Save the project's bible.** Future books in the same world should reuse `02-bible/world-building.md` and `02-bible/continuity.md`.
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
