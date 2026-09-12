# Story State Ledger — Design

**Date:** 2026-08-08
**Owner ask:** track quantities that move across a book — a depleting toll, an
accumulating count, a story clock — and have later chapters *be written* knowing
the current value, not merely be audited against it afterward.

## Problem

BookClaw already has a state ledger, and it cannot express any of this.

`gateway/src/services/consistency/fact-store.ts` maintains a SQLite ledger with a
`facts` table typed `immutable | stateful`, a `knowledge` table (who learned what,
when, and whether they were told / witnessed / deduced it), and a `story_time` +
`story_elapsed` clock per scene. `check-engine.ts` uses elapsed story-time to
decide whether a changed fact is a legitimate change or a contradiction. That
machinery is good and stays.

Three properties block the ask:

1. **Values are strings.** `LedgerFact.valueRaw` / `valueNorm`. Nothing can be
   counted, so nothing can accumulate or deplete. `cracks: 3` → `cracks: 4` does
   not read as progression; it reads as a *contradiction*.
2. **`stateful` is a permission, not a trajectory.** Per `extractor.ts:218` it
   means "this fact can legitimately change" (clothing, current location, injury
   healing, weather). It licenses change. It does not track one.
3. **The ledger only looks backward.** Facts are extracted *from* written chapters
   and compared. Nothing feeds forward: the drafting prompt receives
   `buildBookCanonBlock` (title, author, POV, name registry, bible, outline) and
   the `canon-sheet.ts` block (names, ages, places, timeline anchors) — both
   static. No chapter is ever told "as of now, Colt has lost four memories."

The consequence is the failure mode this feature exists to prevent: a book whose
central mechanic is a moving quantity drifts, because the only thing that ever
sees the quantity is a post-hoc audit the author then has to fix by hand.

## Goals

- A quantity declared once can be **spent or accrued per chapter**, and every
  chapter's generation prompt sees its value **as of that chapter**.
- Direction is a property, not a type: depleting, accumulating, and free-moving
  tracks use one mechanism.
- A **single story clock**, authored rather than inferred, from which every
  countdown, age, and interval is *derived* — never separately tracked.
- Arithmetic that cannot work is surfaced **at outline time**, before drafting.
- **Rewrite-proof**: redrafting a chapter's prose cannot desync the ledger.
- **Zero behaviour change** for every book that does not declare state.

## Design

### 1. Storage — JSON in the book's data dir, not the SQLite ledger

State lives at `workspace/books/<slug>/data/state.json`, beside the bible,
outline, and canon sheet.

This is a deliberate rejection of reusing `fact-store.ts`. `better-sqlite3` is
imported lazily and **fails soft** — `fact-store.ts:65` logs
`⚠ better-sqlite3 unavailable … Consistency auditor disabled` and the gateway
continues. That is correct for an audit: you lose findings, and you can see that
you lost them. It is *not* acceptable for generation steering, where the same
degradation would silently write an entire book with no state block and nothing
would look wrong. A feature that changes prose must not sit behind an optional
native dependency.

JSON also matches every other canon artifact in `data/`, is hand-editable when the
author wants to override the AI's proposal, and rides along with the existing
per-book backup/restore.

### 2. Data model

Track **definitions** live in `state.json`. Track **deltas** live in the outline,
which is already the plan of record and already injected as canon.

```jsonc
// workspace/books/<slug>/data/state.json
{
  "schemaVersion": 1,
  "clock": { "unit": "days", "startLabel": "October 3" },
  "tracks": [
    { "id": "memory_toll", "label": "Memory toll",
      "kind": "counter", "law": "monotone-down", "start": 12, "min": 0,
      "thresholds": [
        { "at": 0, "consequence": "Colt does not recognize Seth",
          "requireBeat": true }
      ] },

    { "id": "seal_cracks", "label": "Seal integrity",
      "kind": "counter", "law": "monotone-up", "start": 0, "max": 7,
      "thresholds": [
        { "at": 7, "consequence": "The seal breaks", "requireBeat": true }
      ] }
  ],
  "events": [
    { "id": "harvest_moon", "label": "the harvest moon", "atClock": 30 }
  ]
}
```

```jsonc
// outline chapter entry — two additive, optional fields
{ "chapter": 7,
  "beat": "Colt kills the crawler at the Hollis farm",
  "advance": "2d",
  "state": [ { "track": "memory_toll", "by": -1, "note": "the Colorado job" },
             { "track": "seal_cracks", "by": 1 } ] }
```

`law` is the generalization: `monotone-down` | `monotone-up` | `free`. One fold
serves all three. `law` exists so that a wrong-direction delta is *detectable*
rather than silently absorbed — without it, an increasing and a decreasing track
are indistinguishable and neither can be validated.

`note` is what makes the injected block worth its tokens. `lost: the Colorado job
(Ch7)` steers a draft; `8/12` does not.

`min` / `max` bound a track. A threshold is a value with a consequence in prose,
and optionally a requirement that the crossing chapter's beat carry it.

### 3. The fold — derive, never store

```ts
foldStateAt(state: StoryState, outline: OutlineChapter[], upTo: number): StateSnapshot
```

A pure function, no I/O. Applies each chapter's deltas in order from 1 to `upTo`
and returns: per-track current value, the ordered note trail, clock position,
derived countdowns (`event.atClock − clockNow`), and any threshold crossed at or
before `upTo`.

**Nothing stores a current value.** This is the property that makes the feature
survive the Rewrite pass: the ledger is derived from the *plan*, not the prose, so
redrafting Chapter 7 cannot desync it. `clearChapterFacts()` exists in
`fact-store.ts` precisely because prose-derived state has this problem; the fold
does not have it to solve.

It also gives `valueAtChapter(n)` for free, which is the only query the drafting
prompt actually needs — Chapter 14 must see the Chapter 14 value even when
Chapter 20 already exists.

### 4. Consumer A — injection into generation

`formatStateBlock(snapshot)` renders:

```
STORY STATE — as of Chapter 14
  Memory toll .......... 8 / 12  (falling)
    lost: mother's face (Ch3), the Colorado job (Ch7),
          Seth's 10th birthday (Ch9), Dad's voice (Ch12)
    ⚠ at 0: Colt does not recognize Seth
  Seal integrity ....... 5 cracks (rising, breaks at 7)
  Story clock .......... Day 19  ·  4 days to the harvest moon
```

The block is **appended to `buildBookCanonBlock`** (`book-canon.ts:107`), so it
reaches every generation step through prompt plumbing that already exists.
Truncation-protected on the same `SECTION_CAP` pattern as the rest of the canon
block, trimming the note trail oldest-first before it trims track lines.

**Resolving "as of chapter N".** `buildBookCanonBlock(dataDir, manifest)` has no
notion of which chapter is being written, so it cannot fold on its own. It gains a
third optional parameter:

```ts
buildBookCanonBlock(dataDir, manifest, chapter?: number)
```

`chapter` is resolved at the two call sites (`index.ts:2453`,
`projects.routes.ts:1193`) from the executing step's label, which already encodes
it (`first-draft-chapter-7`, `humanize-de-ai-sweep-chapter-7`). A shared
`chapterFromStepLabel(label): number | null` helper does the parse — deliberately
**not** reusing `manuscript-assembly.ts`'s `CHAPTER_RE`, which is documented in
TODO.md as failing to match the deterministic pipelines' labels and is being fixed
separately.

When `chapter` is absent or unparseable (whole-book steps: bible, outline,
revision, assembly), the snapshot folds to the **end of the book** and the block is
labelled `STORY STATE — end of book` rather than being omitted. Those steps reason
about the arc as a whole, so the final values are the correct view for them.

### 5. Consumer B — the outline state gate (warn, non-blocking)

`checkOutlineState(state, outline)` runs at plan time, after the outline step and
before drafting, folding the **whole book** before a word is written. It reports:

| Finding | Example |
|---|---|
| Overspend past a bound | outline spends 14 from a pool of 12 — overspend at Ch24 (−2) |
| `law` violation | negative delta on a `monotone-up` track |
| Unmet `requireBeat` | seal breaks at Ch9 but no beat carries the consequence |
| Stale reliance | Ch14–Ch20 beats assume a seal that broke at Ch9 |
| Unknown track | a delta names a track absent from `state.json` |
| Event out of span | a derived event lands past the last chapter |

**The gate warns; it does not block.** Findings are surfaced where outline
findings already surface, and generation proceeds. Rationale: the fold is checked
against a plan that is still being iterated, and a hard block on arithmetic would
interrupt exactly the moment the author is reworking chapter beats. This differs
deliberately from the ending gate, which blocks because a missing HEA is a defect
in a finished artifact rather than a work in progress.

"Stale reliance" is the one heuristic finding: it looks for beats after a
threshold crossing whose text mentions the track's label or consequence terms. It
is best-effort and reported at lower confidence than the arithmetic checks.

### 6. Time — one authored clock

The clock is `kind: "clock"`; chapters carry `advance: "2d"` / `"6h"` / `"3w"`.
Every countdown, age, and interval is derived from it and injected — no countdown
is ever tracked as its own counter, so two countdowns over the same span cannot
drift apart.

**The clock is a single number in `clock.unit`, and sub-unit advances are
fractional.** With `unit: "days"`, a `6h` advance adds `0.25`. Rendering floors to
whole units (`Day 19`), so two half-day advances within one day do not advance the
displayed day, while `atClock` arithmetic stays exact. `atClock` and `start` are
always expressed in `clock.unit`. This is the reason the clock is not stored as a
calendar date: fractional accumulation is exactly what makes "later that
afternoon" and "three weeks on" compose in one field.

`check-engine.ts` gains one optional input: when an authored clock exists, the
elapsed distance between chapters comes from the fold instead of prose inference,
so the auditor and the plan agree on a single number.

**When no clock is declared, `check-engine.ts` behaves byte-identically to
today.** This is the safe default and is what keeps the 21 existing Neptune books
working untouched.

### 7. Declaration — a "Story State" pipeline step

A new step sits after the bible steps and before `outline` (i.e. between steps 9
and 10 of `romance-*-deterministic`), following the `canon-sheet.ts` split:

- **LLM half** — a new `skills/author/story-state/SKILL.md` that reads the bible
  and premise and proposes tracks, thresholds, and a clock as strict JSON.
- **Deterministic half** — `gateway/src/services/pipeline/story-state.ts` parses
  that JSON (reusing the `extractJson` fence-tolerant pattern from
  `canon-sheet.ts`), validates it against the schema, and writes `state.json`.

The step is **human-gated** before `state.json` is written, matching the existing
propose→confirm pattern in `canon-drift` and `romance-checks`. The author can edit
the proposal at the gate, or edit `state.json` by hand afterward.

A book with no declared tracks skips the step's effects entirely; the step emits
an empty `tracks: []` and nothing downstream fires.

## Components / boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `services/state/types.ts` | `StoryState`, `Track`, `Threshold`, `StateDelta`, `StateSnapshot` | — |
| `services/state/fold.ts` | `foldStateAt` — pure arithmetic | types |
| `services/state/format.ts` | `formatStateBlock` — pure rendering + truncation | types |
| `services/state/step-label.ts` | `chapterFromStepLabel` — pure label → chapter number | — |
| `services/state/gate.ts` | `checkOutlineState` — pure validation, returns findings | types, fold |
| `services/state/store.ts` | read/write `state.json`, schema-validate, fail-soft | types, `BookService.dataDirOf` |
| `services/pipeline/story-state.ts` | parse the LLM proposal → validated `StoryState` | types, store |
| `skills/author/story-state/SKILL.md` | the proposal prompt | — |

`fold`, `format`, and `gate` are pure and have no I/O, no AI, and no network. That
is the point of the boundary: the whole behavioural core is unit-testable without
a running gateway.

Modified: `book-canon.ts` (append the block), `check-engine.ts` (optional authored
clock), the deterministic romance pipeline JSONs (insert the step), and wherever
outline findings render.

## Error handling / fail-soft

- **No `state.json`** → no block, no gate, no clock override. Identical to today's
  behaviour. This is the path every existing book takes.
- **Malformed or unreadable `state.json`** → log `⚠`, treat as absent, continue
  generating. Never crash a run over it; matches the house fail-soft pattern.
- **Delta naming an unknown track** → gate finding; ignored by the fold.
- **Delta violating `law`** → gate finding; the fold applies it anyway, so the
  injected block reflects the outline as actually written rather than a value the
  author cannot trace back.
- **Value past `min`/`max`** → clamped in the snapshot, reported by the gate.
- **Story State step fails or the AI is unreachable** → no `state.json`, warning
  surfaced, pipeline continues to `outline`. State is an enhancement; its absence
  must never stop a book.

## Testing

Pure functions, so all of this lands in the existing unit suite with no AI or
network:

- **Fold** — empty outline; single delta; multi-chapter accumulation both
  directions; `free` law moving both ways; clamping at `min`/`max`; unknown-track
  delta ignored; **rewrite-invariance** (re-folding after a chapter's prose
  changes yields an identical snapshot).
- **Thresholds** — detected exactly at the boundary; detected when crossed past;
  not detected one short; multiple thresholds on one track.
- **Clock** — unit parsing (`2d`, `6h`, `3w`); cumulative advance; **fractional
  sub-unit advance** (two `6h` advances inside one day do not advance the
  displayed day but do shift `atClock` arithmetic); derived countdown before, at,
  and after the event; event beyond the last chapter.
- **Chapter resolution** — `chapterFromStepLabel` on
  `first-draft-chapter-7` / `humanize-de-ai-sweep-chapter-7` /
  `polish-chapter-12`; returns `null` for whole-book labels; the `null` path folds
  to end-of-book and labels the block accordingly.
- **Format** — block rendering; note-trail truncation trims oldest-first;
  empty-state renders nothing rather than an empty header.
- **Gate** — one case per finding class in the §5 table, plus a clean outline
  producing zero findings.
- **Store** — round-trip; malformed JSON treated as absent; missing file treated
  as absent.
- **Regression** — `check-engine` with no authored clock produces the same
  findings as before the change (pin with an existing fixture).

## Out of scope

- **Set-membership tracks** (who knows the secret, who is alive, what is in the
  bag). The `knowledge` table in `fact-store.ts` already models this, including
  acquisition source; duplicating it here would create a second truth.
- **A rules engine / event detection** ("every kill with the bone-iron blade costs
  1"). Deltas are authored. Detection is the fragile part, and a missed or
  hallucinated event silently corrupts the fold.
- **Re-reporting deltas from prose.** The ledger describes the plan, not the draft.
- **Studio UI** beyond rendering gate findings where outline findings already
  render, and `state.json` being visible in the existing Files explorer.
- **Retrofitting existing books.** No migration; books without `state.json` are
  unaffected by design.
