# Per-author scene-brief + draft models

**Date:** 2026-07-26
**Status:** Design approved; pending spec review → implementation plan.
**Owner ask:** Give each author profile a preferred model for the two prose-generating
steps (scene brief and first draft), so "this author sounds different" is partly a
function of the underlying model, held consistent across all of that author's books.

## Goal

An author profile carries a default model for the **scene-brief** step and a default
model for the **first-draft** step. The two can differ (e.g. Sonnet brief / Opus draft).
When an author is bound to a book, those defaults flow into the book; the person
generating the book can override them per-book (book board) or per-step (write screen).
Storing the model as a "newest of family" sentinel keeps "always the latest Opus"
automatic with no upkeep.

Example intent (author personas live in the workspace overlay, **not** seeded by this
change): HK Sherwood → Sonnet, KS Rhysdale → Opus, PK Short → Opus.

## Why this is more than a one-field add

Two properties of the current pipeline architecture shape the design:

1. **Production pipelines hard-pin the brief/draft models per step.** Every pipeline
   with `scene_brief`/`draft` roles bakes a `modelOverride` into those two steps
   (e.g. `anthropic/claude-opus-4.8`, temp 1). In `castStep`, a step `modelOverride`
   is the highest-priority pin ("manual", branch 2) — it beats the casting sheet, the
   book default, and would beat any author default. It is also the same field the
   write screen sets. **Consequence:** an author default is inert unless these baked
   pins are removed. This feature therefore *requires* converting the prose pipelines.

2. **`scene_brief`'s `taskType` is `outline`** (shared with the real outline step). The
   book board's existing per-stage overrides are keyed by `taskType`, so a book-board
   "Scene brief" row keyed that way would collide with "Outline." The book board must
   target scene-brief by **role**, not taskType.

The genre casting sheets already define sane `scene_brief`/`draft` role models
(romance → Sonnet brief / Opus draft, with temperatures), so removing the baked pins
lands on a quality floor rather than raw tier fallback.

## Data model

A **role-scoped model** is `{ provider: string, model?: string }`. `model` is normally an
`auto:newest-{opus,sonnet,haiku}` sentinel (resolved to the latest slug at run time),
but may be a concrete OpenRouter slug. Either field may be omitted, in which case that
role falls through to the genre casting sheet.

- **Author profile** (`library/authors/<name>/meta.json`, and the workspace overlay):
  gains optional `sceneBriefModel` and `draftModel`, alongside the existing
  `contentBrand` / `reviewCadence` inheritable fields.
- **Book manifest** (`workspace/books/<slug>/book.json`): gains `sceneBriefModel` and
  `draftModel`. Seeded from the bound author at create; edited by the book board.

There is **one** role-model layer, shared by "author default" and "book override":
the author seeds the manifest field at create; the book board edits the same manifest
field afterward. This unifies the two and sidesteps the taskType collision.

## Seams

### 1. LibraryService (`gateway/src/services/library.ts`)
- `LibraryEntry` gains `sceneBriefModel?` / `draftModel?` (mirroring `contentBrand`,
  `reviewCadence`).
- Author `meta.json` read parses both fields.
- `readEntry` surfaces both so the author editor can load them.
- `writeEntry` / `createEntry` persist both into `meta.json` (merge, preserving
  `description`). The write body accepts `sceneBriefModel` / `draftModel`.
- Validation: `provider` must be a known provider string; `model` optional. Malformed
  entries are dropped fail-soft (a bad meta.json never crashes the load), consistent
  with the existing meta-sidecar reading.

### 2. BookService.create (`gateway/src/services/book.ts`)
- Where the bound author's `contentBrand` / `reviewCadence` are read, also read
  `sceneBriefModel` / `draftModel` and set `manifest.sceneBriefModel` /
  `manifest.draftModel` when present. Absent → field omitted (falls to casting sheet).
- Add a `BookService` setter (e.g. `setRoleModels(slug, { sceneBriefModel, draftModel })`)
  used by the book-board endpoint, mirroring `setReviewCadence`. Passing an empty/blank
  model **clears** the field (assign-not-merge, like `applyBookModelConfig`).

### 3. Routing (`castStep` + `stepRouting`)
- `CastInputs` gains `authorModels?: Partial<Record<StepRole, RoleModel>>` — the
  manifest role models (`{ scene_brief, draft }`), built in `stepRouting` from the
  synced project fields.
- `applyBookModelConfig` (`_shared.ts`) also syncs `sceneBriefModel` / `draftModel`
  from the manifest onto the live project (assign-not-merge), so `stepRouting` reads
  `project.sceneBriefModel` / `project.draftModel`.
- New `castStep` branch, **between** prose-pick and the genre sheet:

  1. spice re-route
  2. manual (step `modelOverride`, incl. any legacy book `stageModels` merge)
  3. **`authorModels[role]`** ← new (scene_brief / draft)
  4. prose-pick (book `preferredModel`, "all stages")
  5. genre casting sheet `roleModels[role]`
  6. tier fallback

  Rationale for placement: a role-specific setting (brief/draft) beats the blunt
  "all stages" book default; a deliberate per-step or per-stage pin still wins over it.
- **Temperature inheritance:** when the `authorModels` branch supplies provider+model
  with no temperature, inherit `sheet.roleModels[role].temperature` (so stripping the
  baked temp-1 pins does not silently drop draft to OpenRouter's 0.7 default). A manual
  per-step temperature still applies on top, as today.
- New `CastResult.source` value (e.g. `'author'`) for observability in the routing log.

### 4. Prose pipelines (12 JSON files)
Strip the `modelOverride` block from **only** the `scene_brief` and `draft` steps in:
`romance-spicy-deterministic`, `romance-sweet-deterministic`, `romance-spicy-full`,
`romance-sweet-full`, `romance-sweet-full-legacy`, `romance-spicy`, `romance-sweet`,
`msf-phase4-prose`, `nerdynovelistai-stage5-chapters`, `romantasy-production`,
`technothriller-production`, `scene-drafter`. Leave every non-brief/draft step's
`modelOverride` intact (audits, humanize, etc.). Existing in-flight books are unaffected
(they carry their own snapshotted templates); this changes new books only.

### 5. Book-board UI + endpoint
- `GET/POST /api/books/:slug/models` (`books.routes.ts`): the `ModelConfig` payload
  gains `sceneBriefModel` / `draftModel`; POST accepts and persists them via the new
  `BookService` setter.
- `BookModelsPanel.tsx`: remove the `creative_writing` ("Chapter drafting") stage row;
  add two role pickers — "Scene brief" and "First draft" — bound to the new manifest
  fields (reusing `ModelPicker`, `hideTemperature`). Keep the bible/outline/revision/
  consistency stage rows and the "all stages" default picker. On save of the draft
  role, also clear any legacy `stageModels.creative_writing` so an old pin can't shadow
  the new picker.

### 6. Author-editor UI (`ProseEditor.tsx`)
- For `kind === 'author'`, render two `ModelPicker`s ("Scene-brief model",
  "First-draft model", `hideTemperature`) bound to `sceneBriefModel` / `draftModel`,
  loaded from `readEntry` and saved via `writeEntry` (persisted to `meta.json`).
- No pickers for other kinds; the prose-file editing UI is unchanged.

## Precedence (final, for scene_brief / draft roles)

```
spice re-route
  > write-screen per-step model pin (/steps/:id/model)
  > manifest sceneBriefModel / draftModel   (author-seeded, book-board editable)  ← new
  > book "all stages" default (preferredModel)
  > genre casting sheet roleModels[role]
  > tier fallback
```

## Testing

- **castStep unit:** draft role + `authorModels.draft` → uses it (`source: 'author'`);
  scene_brief + `authorModels.scene_brief` → uses it; each role ignores the other's
  field; a step `modelOverride` still wins; `authorModels` beats prose-pick; temperature
  inherited from the sheet when `authorModels` omits it; a manual temperature still
  overrides.
- **BookService.create inheritance:** author with both fields → manifest carries them;
  author without → manifest omits them.
- **LibraryService round-trip:** write `sceneBriefModel` / `draftModel` to an author
  `meta.json`, read back via `readEntry`; malformed field is dropped fail-soft.
- **Pipeline guard test:** assert no `scene_brief`/`draft` step in the 12 converted
  pipelines carries a `modelOverride` (protects against a pin being re-added).
- **Book-board endpoint:** POST role models → manifest persisted; blank clears.

## Out of scope

- Seeding the named author personas (HK Sherwood / KS Rhysdale / PK Short) — those are
  workspace/Neptune data; set via the studio once shipped.
- Per-role models for roles other than `scene_brief` / `draft`.
- Any change to how the write-screen per-step override works (it already sits above the
  new layer).
