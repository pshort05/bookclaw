# Canon Drift Gate — Design

**Date:** 2026-07-14
**Owner ask:** small canon errors introduced during bible/character generation
"manifest through the entire book." Add a drift detector after the setting- and
character-bible stages so contradictions are caught **once, at the source**,
instead of being fought 36 times downstream by the per-chapter consistency audit.

## Problem (root cause, from the project-75 "Two Months of Summer" run)

- The `romance-sweet-deterministic` canon order is **characters before setting**:
  1 council → 2 premise → **3 character bible** → **4 setting bible** → 5 outline →
  6 per-chapter (brief → draft → consistency-audit → de-ai → humanize) → 7 revision → 8 assemble.
- The character bible (step 3) invented **"Bay Haven boardwalk"** — a non-existent
  town (blend of *Barnegat Bay* + *Beach Haven*) on a boardwalk Surf City does not
  have — *before* the setting bible (step 4) established the correct
  **"Surf City / Long Beach Boulevard, LBI."** Nothing reconciles the two.
  This is the same bug-class as the earlier "Siren Beach" drift (project-74).
- There is **no gate** between canon establishment (steps 1–5) and chapter
  production (step 6). The only consistency check is the **per-chapter** audit,
  which runs far downstream and compares each chapter against the *already
  contradictory* canon — so it returns `[]` on a chapter that faithfully inherited
  a drifted bible.
- The human-verified grounding produced at intake — the **grounding dossier**
  ("Verified Real-World Geography", real-web-research-backed when
  `status: 'grounded'`) and the **typed discrepancies** (`targetField:
  setting|blueprint|characters`, each pass/fail, resolved by the author) — is
  **thrown away** after the book is created. Only the *blended* `seeds.setting`
  survives in `book.json`.

Verified against the live book: `seeds.setting` is clean (Surf City ×7, Long Beach
Boulevard ×5, Bay Haven ×0), so the drift is confined to the character bible, which
was generated before setting and never anchored to it.

## Goals

1. Establish canon in **dependency order**: setting before characters.
2. Give every canon document a **fixed, human-blessed thing to validate against**,
   terminating at something the author signed off on at intake.
3. Catch the exact unknown-proper-noun drift class (Siren Beach / Bay Haven)
   deterministically and for free, plus semantic contradictions via an LLM pass.
4. Reuse the shipped **audit → deterministic-apply** machinery; no chapter/canon
   regeneration.
5. Backward compatible: books without a persisted anchor fall back to today's
   behavior (no gate), fail-soft.

## Design

### 1. Reorder canon generation (setting before characters)
Swap steps 3 and 4 in `romance-sweet-deterministic.json` (and the spicy twin) so the
setting bible generates first and the character bible generates with the setting
bible already in context. This alone removes the "characters invent geography in a
vacuum" failure. The character-bible step's prior-phase context must include the
setting bible output.

### 2. Persist the verified intake anchor (the one net-new persistence)
At premise-file intake, persist the grounding result as a durable per-book artifact
so the cascade has a clean root of trust:

- **Where:** `workspace/books/<slug>/data/verified-canon.md` plus a
  `manifest.grounding` block (`{ status, citations, discrepancies }`).
- **What:** the grounding dossier text + the resolved discrepancy ledger (each
  entry: `premiseClaim`, `finding`, `status`, `targetField`, `suggestion?`).
- **Why durable, not just `seeds.setting`:** the discrepancy ledger is where the
  *human verification* actually lives (typed, pass/fail, citation-backed); it is the
  strongest machine-checkable anchor and it is exactly what currently evaporates.
- Wired in `premise-intake.ts` / the intake route that already computes
  `GroundingResult`; write on book create.

**Anchor precedence (resolution model = cascade, per owner):**
`verified-canon` (human-blessed) **>** setting bible **>** character bible. Downstream
docs reconcile *to* the anchor; the anchor is never rewritten by a gate.

### 3. Hybrid detector (deterministic entity gate + LLM contradiction pass)
A reusable `canonDriftAudit(doc, anchors[])` producing the same
`DeAiEdit[]` edit-list shape consumed by `applyDeAiEdits`:

- **(A) Deterministic entity gate (always runs, free):** extract the proper-noun /
  place / road set from the anchor(s); flag any proper noun in `doc` that is absent
  from — or contradicts — the anchor set (e.g. a town name not in the verified place
  list). Emits `swap` edits to the anchor's canonical value. Catches the exact
  Siren-Beach / Bay-Haven class deterministically, independent of any model.
- **(B) LLM contradiction pass:** a `*-canon-audit` skill reads `doc` + anchors and
  returns contradiction edits (semantic drift the string check can't see — e.g. a
  backstory that violates the nine-week-economy fact). Routes to the `consistency`
  task type (currently newest-haiku).
- **Merge + apply:** union the two edit-lists, dedupe by `find`, `applyDeAiEdits`
  once to the canon doc. Unambiguous entity mismatches auto-reconcile; genuinely
  ambiguous conflicts (both sources plausible, no clear anchor winner) route to the
  existing **ConfirmationGate / human review cadence** rather than auto-editing.

### 4. Two gates
Inserted as pipeline steps immediately after each canon doc:

- **Gate A — setting bible vs `verified-canon`.** After the setting bible generates.
- **Gate B — character bible vs {setting bible, `verified-canon`}.** After the
  character bible generates. This is the gate that catches "Bay Haven."

Each gate is a `*-canon-audit` step + a deterministic-apply step, mirroring the
per-chapter `consistency-audit → apply` pair already in the pipeline.

## Components / boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| intake anchor persist | write `verified-canon.md` + `manifest.grounding` at create | `premise-intake.ts`, `BookService` |
| `entityGate(doc, anchors)` | deterministic proper-noun / place diff → edit-list | none (pure string/registry) |
| `*-canon-audit` skill | LLM contradiction detection → edit-list | AIRouter (`consistency` task) |
| `canonDriftAudit` | merge (A)+(B), route ambiguous → gate | ConfirmationGate |
| pipeline wiring | reorder + insert Gate A/B steps | `romance-*-deterministic.json`, ProjectEngine |

## Error handling / fail-soft
- No persisted anchor (older books, non-premise intake) → gates no-op, log `ℹ`.
- Entity extraction / LLM pass error → fail-soft, log `⚠`, do not block the pipeline
  (same posture as the rest of the SQLite/consistency usage).
- `applyDeAiEdits` already drops any `find` that isn't byte-exact, so a bad audit
  edit can't corrupt canon.

## Testing
- Unit: `entityGate` flags a town not in the anchor place-set; passes a clean doc;
  ignores fictional-business names (mirrors intake's "fictional business is not a
  discrepancy" rule).
- Unit: `canonDriftAudit` merges/dedupes (A)+(B); ambiguous conflict routes to gate
  rather than emitting an edit.
- Fixture regression: the project-75 character bible ("Bay Haven boardwalk") +
  clean `seeds.setting` anchor → Gate B emits the Bay-Haven→Long-Beach-Boulevard
  swap and the applied bible is clean.
- Pipeline: reordered `romance-sweet-deterministic` still resolves all skill refs
  (extend the existing pipeline-skill-resolves guard test).

## Out of scope
- Retro-fixing books already generated (owner's live run stays untouched).
- Extending gates to the outline/blueprint (can follow once the two bible gates prove out).
- Worlds/series-bible canon (separate subsystem).
