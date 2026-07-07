# Visual Drag-and-Drop Pipeline Builder — Design

Date: 2026-07-06
Status: Approved (brainstorming session with owner)
Scope: `frontend/studio` only — no gateway changes, no new API endpoints.

## Problem

BookClaw's pitch is "pipelines are configuration, not code," but the Asset Studio's
pipeline editor is a form-style accordion: steps reorder via up/down buttons, new
steps arrive as a blank template requiring the author to type a `taskType` string
by hand, and structural groups (`{ parallel: [...] }` fan-outs and
`{ expand: "chapters" }` per-chapter repeats) cannot be created, filled, or
dissolved from the UI at all — they are author-by-JSON only. Non-technical authors
cannot build or restructure a pipeline today.

## Decisions made during brainstorming

| Decision | Choice |
|---|---|
| Form factor | Enhanced vertical flow (top-to-bottom list stays; no node-graph canvas — the data model is linear with fan-out groups, not an arbitrary graph) |
| Palette contents | Step presets + skills library + structural group blocks (cross-pipeline step copying deferred) |
| Drag mechanics | `@dnd-kit/core` + `@dnd-kit/sortable` (+utilities) — deliberate new dependency; nested-group DnD is where hand-rolled HTML5 drag gets long and buggy |
| Scope | PipelineEditor + SequenceEditor drag-reorder. SkillEditor phases deferred |
| Structure | Approach B: shared DnD primitives in `components/asset/dnd/`, pure transforms in `lib/`, PipelineEditor composes them |

## Interaction design

The pipeline editor pane becomes two columns: a narrow collapsible **step palette**
(left, ~220px) and the existing **vertical step flow** (right). Every top-level row
(plain step or group) and every group member gets a drag handle.

- **Reorder**: drag any row — or a whole group — up/down; an insertion indicator
  shows the drop position.
- **Regroup**: drag a plain step over an expanded group's body to move it into the
  group; drag a member out to the top level to extract it.
- **Add from palette** (three sections):
  - **Step presets** — curated templates that land with a sensible label,
    `taskType`, `phase`, and starter prompt. Preset `taskType` values must be
    canonical `TASK_TIERS` keys from `gateway/src/ai/router.ts` (`general`,
    `research`, `creative_writing`, `revision`, `style_analysis`, `marketing`,
    `outline`, `book_bible`, `consistency`, `final_edit`). Initial catalog:
    Draft chapter (`creative_writing`), Outline (`outline`), Critique/Review
    (`revision`), Rewrite (`revision`), Book bible (`book_bible`), Consistency
    check (`consistency`), Final edit (`final_edit`), Marketing copy
    (`marketing`), General step (`general`).
  - **Skills** — every entry from `GET /api/library/skill` (the editor already
    fetches this list) as a draggable card with a filter box; dropping one creates
    a step bound to that skill.
  - **Blocks** — "Run in parallel" and "Repeat per chapter": empty group
    containers dropped into the flow, then filled by dragging steps in.
  - Clicking any palette card appends at the end of the pipeline
    (touch/accessibility fallback).
- **Unchanged**: click a row to expand the accordion and edit
  label/taskType/model/skill/prompt exactly as today; the ↑/↓/Remove buttons stay
  as an accessible fallback; the parallel-group implicit-join help note stays;
  dynamic pipelines stay read-only.
- **Group members become compact rows**: to be draggable, members render as
  collapsed header bars (label + pills + handle) that expand on click — the same
  accordion pattern as top-level rows, replacing today's always-open member
  editors.
- **Not a thing**: nested groups. The gateway model is groups-of-plain-steps, so a
  group is never a valid drop target for another group or block.
- **SequenceEditor**: its flat ordered list of pipelines gets the same drag-handle
  reorder; its add-pipeline dropdown is unchanged.

## Architecture

New dependency (studio workspace only): `@dnd-kit/core`, `@dnd-kit/sortable`,
`@dnd-kit/utilities` (~12 kB gzipped total, React-native, no transitive deps).

| Piece | Role |
|---|---|
| `frontend/studio/src/lib/pipelineEdits.ts` (new) | Pure `EditorStep[]` transforms: `moveEntry(steps, from, to)`, `insertAt(steps, i, entry)`, `moveIntoGroup(steps, from, groupIndex, memberIndex)`, `extractFromGroup(steps, groupIndex, memberIndex, to)`, `removeAt`, plus factories `presetStep(preset)`, `skillStep(name)`, `emptyGroup(kind)`. No React, no dnd-kit imports — unit-testable under `node:test` (same pattern as `fileTree.ts` / `pipelineSteps.ts`). |
| `frontend/studio/src/lib/stepPresets.ts` (new) | The preset catalog as data. |
| `frontend/studio/src/components/asset/dnd/` (new) | Thin generic dnd-kit wrappers: `SortableList`, `DragHandle`, drop-zone helpers, drag overlay. Nothing pipeline-specific. |
| `frontend/studio/src/components/asset/StepPalette.tsx` (new) | The three palette sections; draggable cards + click-to-append; skills filter box. |
| `PipelineEditor.tsx` (modified) | Hosts a single `DndContext` spanning palette + flow so cross-container drags work; `onDragEnd` dispatches to `pipelineEdits` transforms; extends the existing `stepIds` stable-key pattern to group members (per-group member id arrays). Accordion field editing (`StepFields`) untouched. |
| `SequenceEditor.tsx` (modified) | Wraps its list in `SortableList`. |

Drop resolution runs in `onDragEnd` only — no live cross-container re-parenting
preview while dragging. Behavior is identical; the code is much simpler, a
deliberate trade for a single-user LAN app.

## Data flow and state

The pipeline JSON object remains the single source of truth. A drag gesture
resolves to one pure transform on `steps[]`, producing only the three shapes
`lib/pipelineSteps.ts` guards (plain step / expand group / parallel group). Dirty
tracking, the Save button, and `writeEntry` serialization are unchanged. Mistakes
are recoverable the same way as today: don't save, or re-open the entry.

## Edge cases

- **Group-into-group** drops are filtered out as invalid drop targets.
- **Emptied groups** (last member dragged out) survive with a "drop steps here"
  hint; the gateway's `expandSteps` already skips empty groups at generation
  time, so even saving that state is harmless.
- **Skills API failure**: the palette's skills section shows a quiet empty state
  (fail-soft, matching studio posture); presets and blocks still work.
- **Dynamic pipelines**: no palette, no drag — the existing read-only notice
  stands.

## Testing

Repo pattern is `node:test` + build-then-assert (no React render harness):

- `tests/unit/pipeline-edits.test.ts` (new) — drives every transform: top-level
  reorder, move into/out of both group kinds, palette inserts (preset / skill /
  block), nested-group rejection, empty-group survival, and a round-trip
  assertion that every transform output classifies under the `pipelineSteps`
  guards (i.e. stays serializable and renderable).
- `tests/unit/step-presets.test.ts` (new) — pins every preset `taskType` to the
  canonical task-type list so a router rename cannot silently orphan a preset.
- Existing guards keep working: `pipeline-editor-steps.test.ts` (renderability of
  built-in pipelines), `studio-build.test.ts` (tsc + Vite compile).
- Verification bar: full unit suite green, `npm run -w frontend/studio build`
  clean, manual drag pass in the studio against a parallel-group pipeline
  (e.g. `msf-phase1-ideation`).

## Out of scope (explicitly deferred)

- Node-graph canvas / read-only flow visualization.
- Cross-pipeline step copying in the palette.
- SkillEditor phase drag-reorder (adopt the primitives later).
- Undo/redo (the explicit-Save model already provides recovery).
