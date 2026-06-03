# The Nerdy Novelist Workflow

Design for a net-new, human-in-the-loop novel-writing mode in BookClaw, modelled
on the four-step process described by The Nerdy Novelist
([video](http://www.youtube.com/watch?v=y2yam3wlTjE)).

Status: design approved 2026-06-02, not yet implemented. Tracked in
[TODO.md](TODO.md).

---

## 1. The source process

The Nerdy Novelist process uses a chatbot (the video uses Claude Projects, one
project per phase) to develop and draft a novel while keeping the prose human
enough to read well and to qualify for copyright. Four steps:

### Step 1 — Gathering ideas

Brainstorm the puzzle pieces of the story. **Genre and tropes are locked first**
— they give the book a built-in audience. The "container analogy": genre and
tropes are the "big rocks" placed in the jar first; original ideas and twists are
the "sand" poured in afterward so everything fits. An AI "story brainstormer"
(driven by a detailed system prompt) interviews the author about vibe,
protagonists, and tone, then emits a **Story Dossier**: logline, synopsis, and
basic lists of characters and worldbuilding elements.

### Step 2 — Story bible and outline

Expand the Dossier into a full foundation, split across three separate chats:

- **Characters** — detailed character sheets: physical descriptions, core
  motivations, Myers-Briggs profiles, and dialogue styles (the dialogue style in
  particular helps the AI write each character better later).
- **Worldbuilding** — an exhaustive list of settings, artifacts, magic systems,
  geography, lore, and politics.
- **Outline** — combine the Character Sheet, Worldbuilding Sheet, Story Dossier,
  and a **genre-specific plot template** to generate a detailed,
  chapter-by-chapter outline.

### Step 3 — Prose generation

Set up a "chapter writer" with the finalized Character Sheet, Worldbuilding
Sheet, and Outline as context (the Dossier is no longer needed). Generate
**one chapter at a time**, roughly 2,000–2,500 words. **Never bulk-generate** —
a mistake or divergence in an early chapter compounds into every later chapter.

### Step 4 — Validation and editing

The most important step for making the book sound human:

- **Humanize the text** — read the chapter and make significant manual edits.
  Remove AI-isms (over-poetic sensory description, repetitive sentence
  structure, run-ons) and inject the author's own voice.
- **Copyright** — in the US, verbatim AI output cannot be copyrighted and falls
  into the public domain; significant human edits and the specific arrangement of
  the text are what become copyrightable.
- **Update context** — save the fully edited chapter as "Previous Chapter" and
  feed it back to the AI. This gives an exact reference for where the story left
  off and trains the model on the author's edited style before "Write Chapter 2."

Cycling Steps 3 and 4 — generate, heavily edit, feed the edited version back —
writes a whole novel that keeps human creativity while moving faster.

---

## 2. How it maps onto BookClaw

This ships as a **net-new mode layered on the existing system** — it does not
rework the auto-pipeline. The author can move a single book **between
interactive and automated production per phase** (brainstorm the Dossier by
hand, let the outline generate automatically, write some chapters interactively
and batch others). That mixed-mode requirement drives the whole design: both
modes must read and write the **same canonical artifacts** for one book.

### 2.1 Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Role of the feature | Net-new, layered on existing | Ship the part asked for without reworking the auto-pipeline. |
| Build scope | All four steps | Includes the human-edit gate and "Previous Chapter" feedback. |
| Command surface | Separate command per phase | Closest 1:1 to the video's separate-projects approach. |
| Shared container | **Book = the existing project** (`workspace/projects/<slug>/`) | The auto-pipeline already operates on projects, so interop is free; matches the North Star migration note ("treat existing projects as a default book"). |
| Template home | **Skills**, new `novel` category | Reuses the Authoring editor + workspace overlay; directly delivers "build templates to follow this process"; fits the North Star. |
| Genre plot templates | Framework + one worked example (Romance) | Proves the pattern end-to-end; defers the content-heavy library. |

### 2.2 Phases and commands

Step 2 fans into three commands; Steps 3 and 4 are the prose loop on `/write`.

| Command | Step | Reads | Writes (canonical artifact) | Skill |
|---|---|---|---|---|
| `/brainstorm` | 1 — gather ideas (genre + tropes first) | — | `dossier.md` | `novel/brainstormer` |
| `/characters` | 2a — characters | `dossier.md` | `characters.md` | `novel/character-designer` |
| `/world` | 2b — worldbuilding | `dossier.md` | `world.md` | `novel/worldbuilder` |
| `/outline` | 2c — outline | `dossier.md` + `characters.md` + `world.md` + plot template | `outline.md` | `novel/outliner` |
| `/write` | 3 + 4 — prose loop | `characters.md` + `world.md` + `outline.md` + `previous-chapter.md` | `chapters/chapter-NN.md` | `novel/chapter-writer` |

**Book selection** reuses the existing global active-project concept
(`memory.getActiveProject()` / `setActiveProject()` — see `index.ts:461`). A
lightweight `/book new|use|list` sets the active book; every phase command
operates on it. (Single global active book for now; per-channel active book is
out of scope — see Section 6.)

### 2.3 Canonical artifacts — the interop contract

Both modes agree on fixed filenames under `workspace/projects/<slug>/`:

```
dossier.md
characters.md
world.md
outline.md
chapters/
  chapter-01.md
  chapter-02.md
  ...
previous-chapter.md     # the latest human-edited chapter; the Step-4 feedback
```

This is the **single place the existing pipeline is touched**: today the
`novel-pipeline` writes step outputs as `<step-id>-<label>.md`
(`index.ts:1729-1749`). The relevant writing steps gain a `canonicalOutput`
field naming their artifact, so a phase produced automatically lands the same
file an interactive phase would. This is alignment, not a rework.

### 2.4 Templates as skills (new `novel` category)

Add `'novel'` to `SKILL_CATEGORIES` (`skills/loader.ts:33`). Each skill's
`SKILL.md` body **is** the phase system prompt; document *format* is folded into
the phase skill (e.g. the Dossier shape lives inside `novel/brainstormer`) to
avoid skill sprawl. The genre plot template is the one standalone template,
because it is the piece swapped per genre.

Built-in skills shipped:

- `novel/brainstormer` — interviews the author (genre → tropes → vibe →
  protagonists → tone, in that order), then emits the Story Dossier (logline,
  synopsis, character list, worldbuilding list) with genre + tropes recorded at
  the top.
- `novel/character-designer` — detailed sheets: physical, motivation,
  Myers-Briggs, dialogue style.
- `novel/worldbuilder` — settings, artifacts, magic systems, geography, lore,
  politics.
- `novel/outliner` — chapter-by-chapter outline from the Dossier + character +
  world sheets + the selected plot template.
- `novel/chapter-writer` — one chapter, 2,000–2,500 words, with explicit
  anti-AI-ism guidance (vary sentence structure, avoid over-poetic sensory
  description and run-ons) and instructions to continue from
  `previous-chapter.md`.
- `novel/plot-template-romance` — the one worked genre example: the plot-template
  format plus romance beats and tropes.

All are editable and cloneable live in the dashboard Authoring panel; workspace
overrides under `workspace/skills/novel/**` survive Docker rebuilds and override
built-ins by name (the existing overlay mechanism).

### 2.5 Execution model — reuse pause and single-step

The engine already runs a **single** step (`startAndRunProject` runs one step,
`index.ts:1575`) and supports pause/resume, so Step 4 needs no new engine
plumbing.

- Each phase command runs as **one** interactive step via `handleMessage`
  (channel keyed to the book), injecting the phase skill via `getSkillByName`
  plus the artifacts that phase reads as `extraContext`, with an appropriate
  `overrideTaskType` so routing and output budget are correct.
- `/write` writes **exactly one** chapter, never bulk — the anti-bulk rule is
  enforced by the command, not left to the model.
- **Human-edit gate:** the author edits the chapter file between calls (in the
  Authoring/file editor or externally). `/write next` copies the latest edited
  chapter to `previous-chapter.md`, injects it, then generates the next chapter.
  Nothing auto-advances.
- **Automated mode:** the existing `novel-pipeline` / `autoRunProject` produces
  the same canonical artifacts for whichever phases the author chooses to
  automate.

### 2.6 Surfaces

Commands are available in:

- **Dashboard chat** — `/api/chat` → `handleDashboardCommand`
  (`core.routes.ts:74-112`), which already detects `message.startsWith('/')`.
- **Telegram bridge** — `handleInput` (`telegram.ts:117`), which already parses
  slash commands inline.

Discord is a stub today and is skipped.

### 2.7 Genre/trope-first enforcement

`/brainstorm` locks genre and tropes before anything else and records them at the
top of `dossier.md`. `/outline` requires a plot template (defaults to the shipped
romance template) and warns if genre/tropes are not set — enforcing "big rocks
before sand."

---

## 3. Components and boundaries

- **Phase command handlers** — one per command, each: resolve the active book →
  read its required artifacts → inject the phase skill + artifacts → run one step
  → write the canonical artifact. Thin; the difference between commands is which
  skill and which artifacts.
- **Canonical-artifact resolver** — a pure helper mapping
  `(book, phase) → file path(s)`, used by both the interactive commands and the
  pipeline's `canonicalOutput` writes. Unit-testable in isolation.
- **`novel` skills** — data, not code; editable via the Authoring panel.
- **Book selection** — thin wrapper over the existing active-project memory API.

---

## 4. Testing

- **Unit** — the loader picks up the `novel` category and its skills; the
  canonical-artifact resolver returns the expected paths for each phase.
- **API** (`tests/api/api-test.sh`) — command routing writes the correct artifact
  on a throwaway book; validation errors are friendly (no active book; `/outline`
  before `/brainstorm`; `/write next` with no prior chapter).
- **Manual** — end-to-end on Mercury: `/brainstorm` → `/characters` → `/world` →
  `/outline` → `/write` one chapter → edit → `/write next`, confirming each
  artifact lands and the previous-chapter feedback is injected.

---

## 5. Relationship to the North Star

This seeds the multi-author / multi-book direction without committing to it:

- **Book = project** establishes the book-as-container notion the North Star
  formalizes later.
- **Templates as skills** is the same editable-data pattern the customizable
  pipeline work will reuse.
- **Genre plot templates** prefigure the genre-profile entity (a swappable pack
  per book).

It deliberately does not build the four North Star entities (book, author
profile, genre profile, customizable pipeline) as first-class concepts — that
remains the umbrella item in [TODO.md](TODO.md).

---

## 6. Out of scope (documented for later)

- Broad genre plot-template library (ship romance only; users clone the rest).
- North Star multi-author / author-profile / genre-profile entities.
- Rich dashboard UI / buttons for the workflow (v1 is command-driven).
- Per-channel active book (single global active book for now).
- Discord bridge support (Discord is a stub).
