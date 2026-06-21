# n8n → BookClaw Pipeline Import Audit (Neptune + Mercury)

**Date:** 2026-06-20
**Sources:** two n8n instances — **Neptune** (`mcp__n8n-neptune`, 59 workflows) and **Mercury** (`mcp__n8n-mercury`, 24 workflows) = **83 total**
**Method:** every workflow fetched via `get_workflow` and node-structure-inspected by a fan-out of 12 agents (8 Neptune + 4 Mercury)
**Goal:** classify each workflow (server / type / is-it-a-book-pipeline / importable into BookClaw) as Step 1 of converting all writing workflows into BookClaw assets.

Every row below carries a **Server** column (Neptune / Mercury).

---

## Summary

| Bucket | Neptune | Mercury | Total | Meaning |
|---|---:|---:|---:|---|
| **Pipeline — to port** | 28 | 17 | **45** | Multi-step LLM chains → `library/pipelines/*.json` |
| **Sequence (orchestrator)** | 0 | 1 | **1** | Chains stage sub-workflows → a BookClaw pipeline *sequence* |
| **Pipeline — already ported** | 2 | 0 | **2** | `romantasy-planning.json` + `romantasy-production.json` |
| **Editor persona** | 6 | 0 | **6** | Single editorial pass → `editor` asset + `revision`/`final_edit` step |
| **Prompt asset** | 8 | 2 | **10** | One LLM text-transform → `prompt` asset (Prompt Runner) |
| **Not importable** | 15 | 4 | **19** | Media-ops (7), test/scratch (8), chatbot (2), Drive/FS scaffolding (2) |
| **Total** | **59** | **24** | **83** | |

**64 of 83 workflows are writing-related and importable.** 2 are already ported. The remaining **62** are the backlog — but they **deduplicate heavily** (see [Clusters](#clusters--dedup)).

> **✅ Import status (updated 2026-06-20).** The two Mercury suites flagged as the top targets are now **imported into BookClaw** (`library/pipelines/` + `library/sequences/`) — see [COMPLETED.md](COMPLETED.md):
> - **StoryHackerAI → the `nerdynovelistai` suite** — 5 pipelines (`nerdynovelistai-stage1-dossier`, `-stage2-characters`, `-stage3-worldbuilding`, `-stage4-outline`, `-stage5-chapters`) + the `nerdynovelistai` **sequence**. (BookClaw brand "NerdyNovelistAI"; the n8n source provenance still cites StoryHackerAI.)
> - **MSF → the `msf` suite** — 6 pipelines (`msf-phase1-ideation`, `-phase2-developmental`, `-phase3-outline`, `-phase4-prose`, `-phase5-summary-bible`, `-phase6-finalize`) + the `msf` **sequence**. The four Phase-1 ideation variants were consolidated into one `msf-phase1-ideation`; the all-in-one `xjfw8` is covered by phases 1–3 (not separately ported).
>
> **Still open:** the Neptune editor personas (cluster 10), the standalone prompt assets, and folding the romantasy/numbered-suite/scene-drafter/humanizer variants into the ported pipelines.

```
Importability (of 83 workflows)            N=Neptune  M=Mercury
  Pipeline — to port      45  ███████████████████████████████████████████  (N28 M17)
  Not importable          19  ███████████████████                          (N15 M4)
  Prompt asset            10  ██████████                                   (N8  M2)
  Editor persona           6  ██████                                       (N6  M0)
  Pipeline — already done  2  ██                                           (N2  M0)
  Sequence (orchestrator)  1  █                                            (M1)

Per server
  Neptune  59  ███████████████████████████████████████████████████████████
  Mercury  24  ████████████████████████
```

---

## Cross-server picture (the important part)

The two servers hold **different generations** of the same effort:

- **Mercury = the newer, cleaner architecture.** Two modular, **local-filesystem-based** novel systems:
  - **StoryHackerAI** — a real **Orchestrator** (`formTrigger` → `switch` → `executeWorkflow`) driving **Stage 1→5** sub-workflows (Braindump→Dossier→Characters/Worldbuilding→Outline→Chapters). This is the single best port target: it already *is* a pipeline sequence, uses clean caller-input contracts (no Google Docs), and each stage's gen→critique→revise triad maps 1:1 to BookClaw steps.
  - **MSF (Mundane Science Fiction)** — a phase-numbered suite **Phase 0→6** (init → ideation → developmental → outline → prose → summary/bible → finalize+cover), with **four Phase-1 ideation variants** (plain / Parallel / Divergent / Divergent v2) exploring multi-model fan-out. Manual-triggered per phase (no orchestrator yet) but shares one `msf-novels/<slug>/` tree → a BookClaw sequence.
- **Neptune = the older R&D pile.** The already-ported **romantasy** pair, a Google-Docs-based **numbered `0-`…`9-`** suite, the **editor-template family** (dev/line/copy/proof/alpha + Council-of-LLMs), single-purpose **scene-brief / humanizer / summarizer** tools, plus all the **media-ops** (Kometa/Plex/Stash) and `My workflow N` **scratch**. Mixes Dropbox local files and Google Docs I/O.

**Cross-server duplicate families** (same workflow, two servers — port once):
- `Full Book Automation: Braindump to Dossier` — **Neptune** ×3 (`6MKov`, `qtl37`, `EdB61` "1-") **+ Mercury** ×2 (`NOCDm`, `hEgRw`). StoryHacker **Stage 1** (`np4mq`, Mercury) is the refined successor.
- `Book to Summary+` — **Neptune** (`dOUOe`) **+ Mercury** (`KneULz`).
- `Idea to Book Outline - <genre>` — **Neptune** Romantasy V1/V2 **+ Mercury** Mundane-SF (`xjfw8`).
- The 2 already-ported pipelines came from **Neptune's romantasy** family; **Mercury's MSF/StoryHacker** are not yet ported and are the cleaner basis going forward.

---

## Clusters — dedup

The 62 to-port workflows collapse to **~10 canonical BookClaw assets**.

| # | Canonical asset | BookClaw target | Workflows (Server) |
|---|---|---|---|
| 1 | **StoryHackerAI suite** (braindump→dossier→characters→worldbuilding→outline→chapters) | ✅ **IMPORTED** → `nerdynovelistai` sequence + 5 `nerdynovelistai-stage*` pipelines | Orchestrator `S9Wj9`·Stage1 `np4mq`·Stage2 `icKFk`·Stage3 `5Zgxw`·Stage4 `iuvb9`·Stage5 `yERwi` — **all Mercury** |
| 2 | **MSF suite** (ideation→developmental→outline→prose→summary/bible→finalize) | ✅ **IMPORTED** → `msf` sequence + 6 `msf-phase*` pipelines | Phase1 `JAQiF`/`OUDFs`/`Tz6c8`/`C531B` (4 variants → one `msf-phase1-ideation`)·Phase2 `QcHrn`·Phase3 `pVBBr`·Phase4 `UMkGj`·Phase5 `KTtEo`·Phase6 `F7jpU`·all-in-one `xjfw8` (covered by phases 1-3) — **all Mercury** (Phase0 `PS5w9` = scaffold, skip) |
| 3 | **Braindump → Dossier** (planning) | planning pipeline | `6MKov`·`qtl37`·`EdB61` (N) · `NOCDm`·`hEgRw` (M) — superseded by StoryHacker Stage 1 |
| 4 | **Dossier → Outline** (planning) | planning pipeline | `FX8H6`·`HH4QQ`·`io0Ie`·`tgU3C` (N) |
| 5 | **Romantasy planning** ✅*ported* + variants | `romantasy-planning.json` | `a02D2` V2 **ported** · `kxxF5` V1 · `RBCVT` · `AW7L9` (N) |
| 6 | **Outline → Chapters** (production) | production pipeline | `IHTaF`·`ZzKHM`·`86NzV`·`9XdYI`·`lkWKu` (N) |
| 7 | **Romantasy production** ✅*ported* + variants | `romantasy-production.json` | `FSkMG` **ported** · `9M6Wc`·`Jtq3M`·`gmExi`·`xrJRe` (N) · `aq1zq` (M, mislabeled "MSF") |
| 8 | **Scene drafter** (beat→brief→prose) | small production pipeline + scene-brief prompt | `Eu0e5`·`F9pZp`·`7Zrv`·`qj7Vw`·`hXYjx` (N) |
| 9 | **Humanize / de-AI polish** (10-stage) | revision pipeline + external prompt corpus | `2cld7`·`qZJnF`·`dgGYp`·`ashDN` (N) |
| 10 | **Editor personas** (dev/line/copy/proof/alpha + Council) | 6 `editor` assets | `0lPjG`·`5cLbh`·`2mBFA`·`8cURn`·`I5qY9`·`T1CaY` (N) |
| — | **Standalone prompt assets** | `prompt` assets | scene-brief `Xznp2`/`iZGg5` · summary `V09sr`/`dOUOe`/`ml4PU`/`KneULz`(M) · public-domain `m6OBl` · story-hack `ArzkC`/`b9wH7` · blurb `F7jpU`(M) |

### Recommended port order
1. ✅ **DONE — StoryHackerAI suite (Mercury, cluster 1)** → the `nerdynovelistai` sequence + 5 stage pipelines (2026-06-20). The cleanest, most modular design and a 1:1 match for a BookClaw pipeline **sequence**; this was the reference port.
2. ✅ **DONE — MSF suite (Mercury, cluster 2)** → the `msf` sequence + 6 phase pipelines (2026-06-20). The four Phase-1 ideation variants were consolidated into one `msf-phase1-ideation` (the **Parallel/Divergent** fan-out → a `parallel` block with per-step `modelOverride`); Phase 6's blurb step became a `marketing` step and the cover-image step was dropped (native BookClaw tooling). Provisional per-step model IDs — confirm against OpenRouter.
3. **Neptune editor personas (cluster 10)** — uniform analyze→apply template; quick wins as `editor` assets. ← next up
4. **Standalone prompt assets** — trivial single-transform ports.
5. **Fold Neptune romantasy + numbered-suite variants** into the ported pipelines rather than duplicating.

### Common adaptation (applies to nearly every pipeline)
- **I/O:** swap Google Docs/Drive (Neptune numbered suite + a few Mercury) and local-FS reads-writes (`/home/node/.n8n-files/msf-novels/<slug>/`, `Dropbox/Writing/`) for BookClaw's per-book `templates/` + `data/`.
- **Context inputs:** Outline / Characters / Worldbuilding / Genre-Guide / Series-Bible / Style-Sheet / Forbidden-Words → BookClaw **genre/section/skill** assets injected into step prompts.
- **Iteration:** `splitInBatches` per-chapter loops + "last 2000/20000 words" continuity hacks → native `expand:chapters` + multi-pass continuation.
- **Orchestration:** `executeWorkflow`/`switch` orchestrators → a BookClaw pipeline **sequence**; `Merge`-tree multi-model juries → `parallel` blocks + per-step `modelOverride`.
- **Triggers/gates:** form/webhook/fileSystemWatcher + `wait` human-review gates → project creation + (future) approval steps.

---

## Full classification — pipelines to port (45)

### Mercury — StoryHackerAI + MSF (17)

| Server | ID | Name | n8n shape | Importable | BookClaw target |
|---|---|---|---|---|---|
| Mercury | S9Wj9rpKeJu48fjF | StoryHackerAI - Orchestrator | form → switch → 6× executeWorkflow (Stages 1-5 + "All") | **Yes — sequence** | ✅ `nerdynovelistai` sequence |
| Mercury | np4mq7VxlnJhTJHd | StoryHackerAI - Stage 1 - Braindump to Dossier | 10 agents: genre→brainstorm→select→dossier→emotional/name/logic critiques→rewrite; caller inputs | Partial | ✅ `nerdynovelistai-stage1-dossier` |
| Mercury | icKFkDFb09c6CUyp | StoryHackerAI - Stage 2 - Dossier to Characters | per-char expand→logic-check→rewrite loop + relationship map; FS append | Partial | ✅ `nerdynovelistai-stage2-characters` |
| Mercury | 5ZgxWWFz1omUjL4Z | StoryHackerAI - Stage 3 - Dossier to Worldbuilding | per-element expand(12 categories)→critique→revise loop | Partial | ✅ `nerdynovelistai-stage3-worldbuilding` |
| Mercury | iuvb9uqQPvSX6wXV | StoryHackerAI - Stage 4 - Outline Generator | 7 agents: outline→emotional→sliders→logic→rewrite; caller inputs | Yes | ✅ `nerdynovelistai-stage4-outline` |
| Mercury | yERwiwXhZ0m6dz84 | StoryHackerAI - Stage 5 - Outline to Chapters | 15-step per-chapter: briefs→draft→chronology/style checks→rewrite; FS continuity | Yes | ✅ `nerdynovelistai-stage5-chapters` |
| Mercury | JAQiF42ZGs4bCOOP | MSF Phase 1 — Brainstorming | 4 idea gens (multi-model) → 3 lenses → EiC select; FS | Partial | ✅ `msf-phase1-ideation` (consolidated) |
| Mercury | OUDFsVkqfClqFFQH | MSF Phase 1 Parallel — Brainstorming | 4 parallel gens → merge → 3 lenses → merge → pick | Partial | ✅ `msf-phase1-ideation` (consolidated) |
| Mercury | Tz6c8EustLCmJvhm | MSF Phase 1 Divergent — Open-Seed Inversion | 5 parallel gens (invert seeds) → 5 lenses → select → make-strange | Partial | ✅ `msf-phase1-ideation` (consolidated) |
| Mercury | C531Bskvz4zCS6NK | MSF Phase 1 Divergent v2 — Question Distillation | 13 agents: distill → 5 gens → 5 scorers → select → make-strange | Partial | ✅ `msf-phase1-ideation` (primary source) |
| Mercury | QcHrnaiKGwvXffpr | MSF Phase 2 — Developmental | 4 critique→apply pairs (world/name/engagement) + char profiles | Partial | ✅ `msf-phase2-developmental` |
| Mercury | pVBBrhrCvw3wbGS5 | MSF Phase 3 — Outline | 8 agents: flesh outline→compliance→engagement→title→reconcile | Yes | ✅ `msf-phase3-outline` |
| Mercury | UMkGjJiJT7iSNulz | MSF Phase 4 — Prose | per-chapter brief→draft(Opus)→protect→diagnostic→rewrite; cross-model | Partial | ✅ `msf-phase4-prose` |
| Mercury | KTtEozf5Ti9c9bOr | MSF Phase 5 — Book Summary + World Bible Update | per-chapter summary loop + series-bible merge; FS + backup | Partial | ✅ `msf-phase5-summary-bible` |
| Mercury | xjfw8PIspJZxLZrE | Idea to Book Outline - Mundane Science Fiction | 19+ agents all-in-one ideation→outline + 2 human-review `wait` gates | Partial | covered by `msf-phase1-3` (not separately ported) |
| Mercury | NOCDmsomWWIbyFwa | Full Book Automation: Braindump to Dossier | 5 agents brainstorm→select→dossier→critique→rewrite; Google Docs | Partial | planning pipeline (cluster 3; superseded by `nerdynovelistai-stage1`) |
| Mercury | hEgRwJjwxpTWUpEW | Full Book Automation: Braindump to Dossier Local Files | same 5-agent chain; **Google Docs** despite the name | Partial | planning pipeline (cluster 3; superseded by `nerdynovelistai-stage1`) |

### Neptune — planning (10)

| Server | ID | Name | Importable | BookClaw target |
|---|---|---|---|---|
| Neptune | 6MKovtb92mf7smGj | Full Book Automation: Braindump to Dossier | Yes | planning (cluster 3) |
| Neptune | qtl37mKx40rUlKal | Full Book Automation: Braindump to Dossier (dup) | Yes | planning (cluster 3) |
| Neptune | EdB6180dpByT9XdD | 1-Braindump to Dossier | Partial | planning (cluster 3) |
| Neptune | FX8H6wsqWioIy930 | 2-Dossier to Full Outline | Partial | planning (cluster 4) |
| Neptune | HH4QQX5JmmiiY7Kx | Full Book Automation: Dossier to Full Outline (dup) | Partial | planning (cluster 4) |
| Neptune | io0IerH6if4PkqvJ | Full Book Automation: Dossier to Full Outline (dup) | Yes | planning (cluster 4) |
| Neptune | tgU3CT60aCHZULmI | Synopsis to Outline (Single Book) | Yes | planning (cluster 4) |
| Neptune | kxxF5CaM8nNlZ8Eo | Idea to Book Outline - Romantasy (V1) | Yes | romantasy-planning (cluster 5) |
| Neptune | RBCVT2PXZPUjI47w | Concept to Book Outline - Romantasy | Yes | romantasy-planning (cluster 5) |
| Neptune | AW7L9DvVRMdqcxqy | Romantasy Story Builder | Partial | romantasy-planning (cluster 5) |

### Neptune — production (9)

| Server | ID | Name | Importable | BookClaw target |
|---|---|---|---|---|
| Neptune | IHTaF4BCUIm8Bjtc | Full Book Automation: Outline to Chapters | Partial | production (cluster 6) |
| Neptune | ZzKHMwYR6KDs5IIS | 3-Full Book Automation: Outline to Chapters | Partial | production (cluster 6) |
| Neptune | 86NzVe9VPQVrM0oc | Full book from outline - silo version | Partial | production (cluster 6) |
| Neptune | 9XdYIrZ04I8EDvUo | My Book Name | Partial | production (cluster 6) |
| Neptune | lkWKuWbeagM2oZc5 | Full book from Outline | Yes | production (cluster 6) |
| Neptune | 9M6WcBiXNpgaa6ro | Book Writer Test | Partial | romantasy-production (cluster 7) |
| Neptune | Jtq3M3lAOmpcJUEb | Soft Edge of Wild | Partial | romantasy-production (cluster 7) |
| Neptune | gmExiseWY9fa3u8o | Romance Book Writer | Yes | romantasy-production (cluster 7) |
| Neptune | xrJRegKnFsLwIvXk | Cross Lines | Yes | romantasy-production (cluster 7) |

### Neptune — scene drafter + humanize (9)

| Server | ID | Name | Importable | BookClaw target |
|---|---|---|---|---|
| Neptune | Eu0e5ZQI7lAG0rur | My workflow 9 | Yes | scene drafter (cluster 8) |
| Neptune | F9pZpsVGhT2rBKY8 | My workflow 10 | Yes | scene drafter (cluster 8) |
| Neptune | 7ZrvOMZTkcuGVBMg | My workflow 8 | Partial | scene drafter (cluster 8) |
| Neptune | qj7VwWtQiTBmvFE0 | My workflow 11 | Yes | scene drafter (cluster 8) |
| Neptune | hXYjxdEladPGpE7G | My workflow | Partial | scene drafter (cluster 8, broken connections) |
| Neptune | 2cld7SZHBaJVoVDz | My workflow 14 | Partial | humanize (cluster 9) |
| Neptune | qZJnFE8lZdGSKDfJ | My workflow 13 | Yes | humanize (cluster 9) |
| Neptune | dgGYpgXReFw34xKo | Gemini Humanizer | Partial | humanize (cluster 9) |
| Neptune | ashDNDZ5fqp7WfSk | GeminiHumanizer | Yes | humanize (cluster 9) |

## Already ported (2)

| Server | ID | Name | BookClaw asset |
|---|---|---|---|
| Neptune | a02D2zwwK6Yt6wbM | Idea to Book Outline - Romantasy V2 | `romantasy-planning.json` ✅ |
| Neptune | FSkMGDuNQjxPhcy4 | Romantasy Book Writer - Shattered Cradle World | `romantasy-production.json` ✅ |

## Editor personas (6 — all Neptune)

| Server | ID | Name | BookClaw target |
|---|---|---|---|
| Neptune | 0lPjGX4hKt19GxlZ | 6-Developmental editor automation | `editor` (developmental) + `revision` |
| Neptune | 5cLbhkSaeVdRnKfF | 7-Line editor automation | `editor` (line) + `revision` |
| Neptune | 2mBFAeaLFBAvmMG7 | 8-Copy editor automation | `editor` (copy) + `final_edit` |
| Neptune | 8cURnEYyaRIM9inR | 9-Proof reader automation | `editor` (proofread) + `final_edit` |
| Neptune | I5qY93U4k21w6Uto | 4-Alpha read improvement automation | `editor` (alpha) / `revision` |
| Neptune | T1CaY8Z27Aj0MHtU | Council of LLMs - 3 Chapter Outline Improvement | `editor` (developmental, multi-model) → `parallel` + synthesis |

## Prompt assets (10)

| Server | ID | Name | BookClaw target |
|---|---|---|---|
| Neptune | Xznp2EgWq3ldmmwW | Read File Test | `prompt` (scene brief) |
| Neptune | iZGg5MpsEz6ulhKo | My workflow 6 | `prompt` (scene brief) |
| Neptune | V09srqg26ct3B2yt | Summarize Mountain Complex | `prompt` (`summary`) |
| Neptune | dOUOekOS9Py7TkZx | Book to Summary+ | `prompt` (`summary`) |
| Mercury | KneULzdBpLSfAWTB | Book to Summary+ | `prompt` (`summary`) — dup of Neptune `dOUOe` |
| Neptune | ml4PUJFRgPfW0qvN | My workflow 12 | `prompt` (char-arc `summary`) |
| Neptune | m6OBl9GAelNafArH | Public Domain (Cleaned-up Version) | `prompt` (`final_edit`) |
| Neptune | ArzkCOfprpjSVdGW | Book/Script Story Hacking 3 | `prompt` (analysis) ×1-3 |
| Neptune | b9wH7oFc26KMiCMs | Short Story Hack | `prompt` (analysis) |
| Mercury | F7jpU2uA67HSn4Wb | MSF Phase 6 — Finalize + Cover | `prompt` (blurb) + native cover tooling |

## Not importable (19)

| Server | ID | Name | Category | Why |
|---|---|---|---|---|
| Neptune | 1F78iEHkF3ofmTAf | Nightly Kometa Plex Update | media-ops | cron → Kometa |
| Neptune | KrUW8oSMcaFcLpjO | Nightly Kometa Plex Update | media-ops | dup cron |
| Neptune | Xpt0h4yBZCYI8BXG | Nightly Kometa Plex Update | media-ops | dup cron |
| Neptune | OdF5mEdXb24ljvC3 | Kometa Maintenance (operations) Sunday | media-ops | ssh runKometa (active) |
| Neptune | SQMikAYKtFFZ9swZ | Kometa Display (collections+overlays) | media-ops | ssh runKometa (active) |
| Neptune | 1H4EUSHeVAORtAAQ | Stash nightly maintenance | media-ops | Stash/Whisparr (active) |
| Neptune | z0QLWkz6jKQKJqMm | Email New Plex Movies and Shows | media-ops | Tautulli→email; ⚠ plaintext creds |
| Neptune | A6JHh3TbqBnpz6m1 | Demo: My first AI Agent in n8n | chatbot | stock tutorial |
| Neptune | XrqpAyGPLBzGa9y8 | Simple Chatbot | chatbot | generic demo |
| Neptune | 2uCB1XKGx3vaYQdp | My workflow 5 | test-scratch | empty-prompt beat reader |
| Neptune | 7lQiXP5yRMM2CEqh | Mountain Complex Scene Generator Minimal | test-scratch | API probe |
| Neptune | OW76vttXVfXAagKe | My workflow 2 | test-scratch | API smoke test |
| Neptune | ehGct1AR14Ue6SOu | My workflow 4 | test-scratch | API test |
| Neptune | qie1R99kEblRIdu5 | My workflow 3 | test-scratch | API test stub |
| Neptune | nyMIK4e2rNZ8P7YR | 0-Create documents | other | zero-AI Google Drive scaffolding |
| Mercury | PS5w9ISnEU0ZTtf4 | MSF Phase 0 — Initialize Input Files | other | zero-AI FS template scaffolding (could seed library/soul defaults) |
| Mercury | I6VqjiTn1QIb3nuk | Read Local File Test | test-scratch | archived FS read test |
| Mercury | qabvywekuvm6Ka8d | Read Local File and Set Variable | test-scratch | FS read test |
| Mercury | QTh5d9u5uGhY4JcP | Read Local File Test | test-scratch | archived FS read test |

---

## Incidental finding (security)

`z0QLWkz6jKQKJqMm` (Neptune — Email New Plex Movies and Shows) stores a **Tautulli API key and Plex token in plaintext** node params and references an SMTP credential. Out of scope for the import effort; worth rotating into n8n credentials.

## Next step

**Done (2026-06-20):** the Mercury **StoryHackerAI** suite → the `nerdynovelistai` sequence + 5 pipelines, and the Mercury **MSF** suite → the `msf` sequence + 6 pipelines (see [COMPLETED.md](COMPLETED.md); provisional per-step model IDs to confirm against OpenRouter).

**Remaining** (per `docs/TODO.md`): the Neptune **editor personas** (cluster 10) → `editor` assets, the **standalone prompt assets** → `prompt` assets, then **fold** the Neptune romantasy + numbered-suite + scene-drafter/humanizer variants into the ported pipelines rather than duplicating.
