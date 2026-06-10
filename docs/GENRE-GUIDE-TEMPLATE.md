# Genre Guide Template

A genre in BookClaw is a directory of markdown files under `library/genres/<name>/`
(built-in) or `workspace/library/genres/<name>/` (user overlay). Every `.md` file in
the directory is snapshotted into a book at create time and injected into generation
prompts (Phase 7). Use these seven canonical files; each opens with a one-line summary
so it reads well when concatenated into a prompt.

| File | Role — what it answers |
|------|------------------------|
| `reader-expectations.md` | Genre expectations + reader promise: tone & mood, pacing, setting conventions, character archetypes/roles, and length/format norms (POV, word-count band, heat/age category). Descriptive — what the genre *feels like*. |
| `tropes.md` | Common tropes (recurring devices/situations readers love) and how to keep them fresh. Optional flavor — pick a few. |
| `themes.md` | The ideas/values the genre explores (e.g. found family, redemption, power & corruption). |
| `beats.md` | Structural beats and **obligatory scenes**: the plot set-pieces, in rough order, readers would feel cheated without. |
| `must-haves.md` | A tight, action-oriented checklist of non-negotiables — "skip these and it isn't really this genre." |
| `genre-killers.md` | The anti-checklist — what makes genre readers DNF or one-star a book. |
| `comps.md` | Comparable titles and *why* they work; a source for deriving obligatory scenes. |

Files are injected in this order: reader-expectations, tropes, themes, beats,
must-haves, genre-killers, comps. A genre may omit files; missing ones are skipped.
The per-genre `meta.json` `description` (Phase 6e) is separate and describes the genre
as a whole.
