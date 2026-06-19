# BookClaw Glossary — Canonical Terminology

This is the **canonical vocabulary** for BookClaw. New work, docs, API names, and
the React studio UI should use these terms. It is written to be clear to
someone seeing BookClaw for the first time.

Two kinds of things have names: **Program Elements** (the machinery that does the
work) and **Book Assets** (the content a book is made of).

> **Note on the current UI/code.** Some older terms still appear in the React
> studio UI and parts of the code (`persona`, `soul`, `book-bible`, `LLM`, the
> library `author` bundle, `section`). Those are being migrated to the terms
> below; a full UI rename is still in progress. When in doubt,
> the names on this page win. See [Reconciliation](#reconciliation-with-older-terms).

---

## Program Elements (the machinery)

The elements nest: **Series › Book › Pipeline › Step**. A Step runs a **Prompt**
(or a Program/Tool) on a **Model**, optionally guided by a **Skill**.

### Series
An ordered group of related **Books** — e.g. a trilogy or a multi-book series.
Optional; a Book does not have to belong to a Series.

### Book
The top-level **container/project**. A Book owns its assets (Author, Voice, World,
Characters, Outline, Manuscript, etc.) and the Pipeline(s) used to produce them.
A Book usually produces a manuscript, but it can also cover only part of the work
— for example a marketing-only Book that produces just blurbs and ad copy.

### Pipeline
An ordered group of **Steps** that run in sequence to produce or transform assets
(for example: *planning → world & characters → drafting → revision → format →
launch*). A Book runs a data-driven sequence of one or more named Pipelines;
pipelines are reusable, editable templates (config, not hardcoded phases).

### Step
A single unit of work in a Pipeline. A Step runs **either**:
- a **Prompt** — an instruction sent to a **Model** (an AI/LLM step), or
- a **Program/Tool** — a deterministic action (e.g. compile to DOCX/EPUB).

### Prompt
The instruction **content of an LLM Step** — the text sent to the Model (with the
relevant assets and any Skill injected). A Prompt is part of a Step, not a thing
on its own.

### Model
The **AI assigned to run a Step** — a provider (OpenRouter, Claude, Ollama, …) plus
a specific model (e.g. `gemma-3-4b-it`). The Model **can differ from Step to Step**
(cheap model for bulk drafting, premium for high-value edits). *(Informally "the
LLM"; "Model" is the precise term.)*

### Skill
A **reusable instruction block** attached to a Step and injected into its Prompt —
focused know-how (e.g. "write vivid sensory detail", "audit dialogue"). Skills are
machinery you attach to Steps, not content the Book owns.

---

## Book Assets (the content)

Everything a Book is made of. Assets are selected/created when a Book is set up and
are read by the Pipeline's Steps.

### Author
The **pen-name identity** — *who* is writing: name, bio, persona. One Author is
assigned per Book; the same Author can write many Books. *(Consolidates the older
`author` / `persona` / `soul` concepts.)*

### Voice
The **writing style and tone** — *how* it is written: prose style, sentence rhythm,
register, narrative voice. Kept separate from Author so a style can be reused or
swapped independently of the pen-name identity.

### Genre
The **market category and its conventions** — tropes, expected beats,
reader-expectations, and comparable titles ("comps"). Drives what the story must
deliver. Distinct from World (lore) and Voice (style).

### World
The **setting and its rules** — world-building, world-rules, locations, history,
lore, and themes/motifs. The "where and how this world works." *(Replaces the
catch-all "bible"; "bible" is no longer used as a term.)*

### Characters
The **cast** — major and minor characters: profiles, motivations, relationships,
arcs, and per-character voice notes.

### Outline
The **structure** — chapter-by-chapter outline, timeline, story arcs, and beats
used to generate each chapter or part.

### Manuscript
The **prose itself** — chapters and parts, plus front/back matter, and the compiled
outputs (Markdown / DOCX / EPUB). *(Front/back matter "sections" are part of the
Manuscript.)*

### Marketing
The **go-to-market content** — back-cover blurb, retailer (Amazon/KDP) description,
keywords, ad copy, newsletter/launch posts, and the launch plan. A Book may produce
Marketing on its own (a marketing-only Book) or alongside a Manuscript.

---

## At a glance

```
Series
└─ Book ─────────── assets: Author · Voice · Genre · World · Characters · Outline · Manuscript · Marketing
   └─ Pipeline
      └─ Step ────── runs a Prompt (or Program) on a Model, guided by a Skill
```

---

## Reconciliation with older terms

| Older term (still in code/UI) | Canonical term |
|---|---|
| `persona`, `soul`, library `author` bundle (identity part) | **Author** |
| `STYLE-GUIDE` / `VOICE-PROFILE` (the style part of the old author bundle) | **Voice** |
| `book-bible` (the monolithic reference) | split into **World** + **Characters** (+ Voice for the style ref) |
| `LLM` (provider + model) | **Model** |
| library `section` (front/back matter) | part of **Manuscript** |

These are mapped here so the migration is unambiguous. Code and the React studio UI
adopt the canonical terms over time; the larger UI rename is still in progress.
