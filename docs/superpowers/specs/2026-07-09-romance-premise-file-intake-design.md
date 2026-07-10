# Romance Premise-File Intake — Design & Spec

- **Date:** 2026-07-09
- **Status:** Brainstorming complete; design approved. Next step: spec review → `superpowers:writing-plans`.
- **Method:** `superpowers:brainstorming`. This document is the saved design.
- **Relationship to prior work:** The 4th seed-collection mode of the **Romance Workflow**
  (see `docs/superpowers/specs/2026-07-08-romance-workflow-design.md`). Peer to the planned
  Guided / Adaptive / Council modes. Depends **only** on the shipped Foundation sub-project
  (seed contract + `manifest.seeds` persistence + `/api/books` → project-context threading).
  Independent of the (unbuilt) Council pause-resume gate.

## What this is

A way to seed a new romance novel from a **free-form premise markdown file** — the kind of
brainstorming doc an author writes while working out a story (canonical example:
`research/ferraros-premise.md`). These files vary widely in breadth: some hand-design a full act
structure, POV strategy, and ending; others give only a logline and a couple of characters. The
system reads whatever is there, honors it, and generates only the missing pieces — then puts a
structured review in front of the author before drafting begins.

Delivered as a new entry: **New ▸ Advanced ▸ From Premise File** in the studio.

## Locked decisions (from brainstorming)

1. **Fidelity — honor what's there, expand gaps (per section).** Whatever structure the file
   specifies (act breakdown, POV strategy, black-moment mechanic, exact ending) is preserved as
   canon; only genuinely-missing pieces are generated. A thin file falls back to generation.
2. **Gap handling — a structured Q/A review gate**, not a conversational interview. Intake drafts
   the "Open Choices" list (the file's explicit open choices **plus** implicit gaps it infers) as
   discrete decisions, each with a proposed answer and alternatives. The author ratifies/edits in a
   single pass. (A conversational interview is deferred to a later iteration.)
3. **Entry point — paste/upload in the studio** under New ▸ Advanced ▸ From Premise File.
4. **Mechanism — hybrid `blueprint` seed.** Intake produces the existing `storyArc` / `characters`
   / `setting` strings **plus one new `blueprint` seed** (acts / POV / ending scaffold) **plus** the
   gap list. Premise/bible steps expand-phrase over the strings as they do today; the **outline
   step is taught to honor `{{blueprint}}`**. Production block unchanged.
5. **Setting grounding — research + author verification.** When `setting` names a real, mappable
   place, a grounding step gathers verified geography into a **setting dossier** that becomes the
   review gate's centerpiece for the local author to verify. Fictional businesses are placed on real
   streets. Invented settings skip grounding.
6. **Premise fact-check (discrepancy pass).** For a detected real place, grounding also **audits the
   real-world facts the premise itself asserts** (street names, town placement, geography) against
   research and **flags discrepancies** — it never silently rewrites them. Discrepancies surface in
   the review gate as their own list, distinct from gaps, each resolvable as *correct* or *keep as
   intentional artistic license*.

## Naming note (collision avoided)

`structure` is **already** a `/api/books` field (the narrative-structure preset — three-act /
Save-the-Cat, cf. the `recommend_structure` / `list_structures` MCP tools). The new authored-scaffold
seed is therefore named **`blueprint`**, not `structure`.

## End-to-end flow

```
1. Studio ▸ New ▸ Advanced ▸ From Premise File → paste or upload a .md file
2. INTAKE (one structured-output AI call): doc →
     seeds { storyArc, characters, setting, blueprint,
             suggested heat, suggested chapterCount, suggested wordsPerChapter }
     + gaps[]            (explicit open choices + inferred implicit gaps)
     + realPlace         (is `setting` a real, mappable location? + canonical name)
3. GROUND (only if realPlace): research → verified setting dossier
     (towns, roads, geography, seasonal texture); fictional businesses placed on real streets;
     + FACT-CHECK the premise's asserted real-world facts → discrepancies[]
4. REVIEW GATE (structured Q/A, in the studio): seeds editable; the grounded setting
     dossier front-and-center for the local author to verify/fix; discrepancies flagged
     (correct / keep intentional); each gap a decision with its proposed answer + alternatives
5. FINALIZE: ratified gap answers spliced into their target seed fields
6. POST /api/books with finalized seeds → book created; the romance-*-full pipeline
     auto-runs as today. The outline step honors {{blueprint}}; scenes use grounded {{setting}}
```

No mid-pipeline pause/resume gate is involved — the review is entirely **pre-creation**. Once the
book is created the shipped auto-execute pipeline runs untouched.

## Components

### 1. Intake pass

A single structured-output AI call. **Input:** raw markdown premise text. **Output** (JSON):

- `seeds`:
  - `storyArc` — logline + core romantic conflict + theme (from Logline / Core Theme).
  - `characters` — the cast (from Principal Characters).
  - `setting` — the raw setting text as written (from Setting); becomes the grounding input.
  - `blueprint` — the authored scaffold: act breakdown, POV strategy, black-moment mechanic,
    ending (from Structure & POV Map + The Ending + "Why the Pop-Up Solves Everything").
  - `heat` — inferred `'sweet' | 'spicy'` (suggestion; confirmed in the review gate).
  - `chapterCount`, `wordsPerChapter` — inferred suggestions; confirmed in the review gate.
- `gaps[]` — each `{ id, question, proposedAnswer, alternatives?, targetField }`:
  - **Explicit:** items the file itself flags (for Ferraro's: cousin's name, storm name,
    Gia-vs-Mia, Cole's self-awareness fork, black-moment transparency, father's tone).
  - **Implicit:** gaps the intake infers are missing for a draftable book.
  - `targetField` names which seed the ratified answer is spliced into (e.g. cousin name →
    `characters`; storm name → `blueprint`; heat confirmation → `heat`).
- `realPlace` — `{ isReal: boolean, canonicalName?: string }` — whether `setting` names a real,
  mappable location and, if so, the canonical name to research (e.g. "Long Beach Island, New Jersey").

**Mapping for a file like Ferraro's:** Logline / Core Theme → `storyArc`; Principal Characters →
`characters`; Setting → `setting`; Structure & POV Map + The Ending + Why-the-Pop-Up → `blueprint`;
heat inferred sweet.

**Thin-file behavior:** any section absent → its seed interpolates to `''` downstream and the
pipeline generates it. `blueprint` empty → the outline step falls back to today's beat-var generation.

### 2. Setting-grounding step (reusable)

Runs only when `realPlace.isReal`. Uses BookClaw's existing **research** capability to gather verified
facts about `realPlace.canonicalName` — real towns, main roads, geography (orientation, water bodies,
notable public landmarks), and seasonal/economic texture — and composes a **setting dossier**
(markdown) that becomes the finalized `setting` seed.

**Fact-check (discrepancy pass).** In the same step, the real-world facts the **premise itself
asserts** are audited against the research and returned as `discrepancies[]`:

- Each discrepancy: `{ id, premiseClaim, finding, suggestion, targetField }` — e.g.
  `premiseClaim: "Ferraro's is on Surf City, Long Beach Boulevard"`,
  `finding: "Surf City and Long Beach Boulevard are both real and correctly placed on LBI"` (a
  *pass* is also recorded so the author sees what was verified), versus a *fail* such as
  `premiseClaim: "…on Beachfront Ave"`, `finding: "no Beachfront Ave exists on LBI",
  suggestion: "Long Beach Boulevard (the island's main road)"`.
- **Never auto-rewrites.** Discrepancies are advisory. The author resolves each in the review gate as
  **correct** (apply the suggestion — spliced into `targetField`) or **keep as intentional** (artistic
  license; premise text preserved).
- Only facts *asserted by the premise* are audited — the pass does not invent claims to check.

- **Fictional-business rule:** real *public* geography (streets, towns, beaches, bay) is grounded and
  accurate; invented *businesses* (Ferraro's, Salt & Crumb) stay fictional but are *placed* on real
  streets. The dossier must not assert real private businesses as story locations. A fictional
  business is **not** a discrepancy; a wrong *real* street or town placement **is**.
- **Reusability:** built as a standalone step invoked by intake, so the later Guided / Adaptive modes
  can reuse it when their `setting` is a real place. (Not wired into those modes in this sub-project.)
- **Fail-soft:** if the research gate is unavailable, fall back to an LLM-knowledge draft of the
  dossier **and** raise a "research unavailable — verify carefully" banner in the review gate. Never
  blocks book creation.

### 3. Review gate (studio, structured Q/A)

A new studio screen shown after intake+grounding, before creation:

- The finalized seed fields (`storyArc`, `characters`, `setting`, `blueprint`, heat, counts) render
  as editable fields.
- The grounded **setting dossier is front-and-center** for the local author to verify/correct.
- `discrepancies[]` render as a **flagged list** (visually distinct from gaps) — each showing the
  premise's claim, the research finding, and a suggestion, resolved as **correct** (apply suggestion)
  or **keep intentional** (preserve as artistic license). Verified *passes* are shown too, so the
  author can see what was checked.
- `gaps[]` render as a compact decision list — each with its `proposedAnswer` pre-selected and
  `alternatives` selectable, plus a free-text override. This mirrors the shape of the file's own
  "Open Choices to Lock Before Drafting" section.
- **Start Book** is disabled until every gap **and every failed discrepancy** is resolved (an accepted
  proposal / a "keep intentional" both count as resolved).

### 4. Finalize

Ratified gap answers are spliced into their `targetField` seed — a light **deterministic merge**
(no second AI call). If splicing ever reads badly in practice, a small AI finalize pass can be added
later; not in v1.

### 5. Create-surface plumbing

- **New endpoint** `POST /api/books/intake` — accepts premise text; returns `{ seeds, gaps,
  discrepancies, realPlace, groundingStatus }` (running intake + grounding + fact-check server-side).
  The review gate consumes this, then calls the existing `POST /api/books` with the finalized seeds.
- **Seed contract extension:** add `blueprint` to the seed contract, persist it on `manifest.seeds`,
  and thread it into project `context` (extends the exact path Foundation shipped). Context key
  `blueprint` → template var `{{blueprint}}`.
- **Outline step change:** in **both** `library/pipelines/romance-sweet-full.json` and
  `romance-spicy-full.json` (the outline step is shared front-half), add expand-phrasing that treats
  `{{blueprint}}` as canon — *"reproduce this act / POV / ending structure faithfully; generate only
  the beats it leaves unspecified"* — and collapses cleanly when `{{blueprint}}` is empty.
- **MCP lockstep:** mirror the intake as an MCP tool and add `blueprint` to `create_book`, in the
  **same commit** as the gateway route change.

## Scope & non-goals

**In scope:** the intake pass, the reusable setting-grounding step **with the premise fact-check /
discrepancy pass**, the studio review gate (gaps + discrepancies), the `blueprint` seed + outline
honoring, the `POST /api/books/intake` endpoint, MCP lockstep, and the scripted test.

**Non-goals (explicitly out):**
- Conversational interview for gaps (deferred to a later iteration).
- Any mid-pipeline pause/resume gate (that is the unbuilt Council sub-project).
- Changes to the Guided / Adaptive / Council modes.
- Persisting/caching the setting dossier for reuse across books in the same place (future; a series
  on the same island would benefit, but out of scope here).
- Second AI finalize pass for gap merging (only if deterministic splicing proves inadequate).

## Error handling / fail-soft

Follows the repo's fail-soft init posture (log, continue degraded; never crash):

- **Oversized / malformed premise doc** or malformed intake JSON → surface a clear studio error and
  fall back to the ordinary empty-seed manual create path. Never crash.
- **Empty `gaps[]`** is valid (a fully-specified file).
- **Research gate unavailable** → LLM-knowledge dossier fallback + review-gate banner (see §2). The
  premise fact-check is best-effort in this mode (no authoritative source to diff against) and the
  banner states that discrepancies could not be verified.
- **Invented (non-real) setting** → grounding skipped; `setting` used as written.
- **Unknown / absent heat** → default per the selected pipeline; confirmed in the review gate.

## Testing

Scripted under `tests/` (per the repo scripted-test rule; expose `-v` verbose that streams the
server log):

1. Feed `research/ferraros-premise.md` to `POST /api/books/intake` and assert:
   - `seeds.storyArc` / `characters` / `setting` / `blueprint` are populated.
   - Expected explicit gaps surface (cousin name, storm name, Gia-vs-Mia, Cole self-awareness,
     black-moment transparency, father's tone).
   - `realPlace.isReal === true` with a canonical name resolving to Long Beach Island / NJ.
   - The grounded setting dossier is present (or, if research is stubbed/unavailable, the fallback
     banner status is returned).
   - The premise fact-check runs: Surf City / Long Beach Boulevard are recorded as **verified passes**.
   - **Injected-error case:** a premise variant asserting a non-existent street (e.g. "Beachfront Ave,
     Surf City") produces a **failed discrepancy** with a suggestion, and Start-Book stays blocked
     until it is resolved.
2. After a finalized create, assert `{{blueprint}}` reaches the outline step prompt and `{{setting}}`
   carries the grounded dossier in the expanded pipeline.
3. **Thin-doc case:** a minimal premise (logline only) collapses cleanly — front half still
   generates, no dangling seed labels, outline falls back to beat-var generation.
4. **Research-unavailable case:** grounding falls back without blocking creation.

## Open items to confirm at plan time

- Exact `taskType` / tier for the intake and grounding AI calls (structured-output JSON required for
  intake). Reuse an existing tier; do not add a new task type unless routing demands it.
- Confirm `blueprint` does not collide with any `buildPipelineVars` computed key (`setupEnd`,
  `incitingEnd`, `midpoint`, `twist75`, `climaxStart`, `climaxEnd`) — it does not, but verify at plan
  time alongside the existing `storyArc`/`characters`/`setting` keys.
- The precise studio route/component placement for the review gate under New ▸ Advanced.
