# Multi-step skills — Phase B (Asset Studio editor) design (2026-06-13)

Phase A shipped the engine (executable skills via `steps.json`, `SkillRunner`, pipeline
wiring, the `PUT /api/skills` write API that already accepts `steps`/`retries`). Phase B
adds the **studio editor** so authors create/edit executable skills (phases: model /
temperature / prompt, + retries) without hand-writing JSON. Skills are currently
**read-only** in the Asset Studio (`ProseEditor` `isReadOnly` for `kind==='skill'`), so
this also makes skills editable for the first time.

## Scope

- New **`SkillEditor`** component, rendered by `AssetStudio` when `kind === 'skill'`
  (replacing the read-only `ProseEditor` view for skills). It edits:
  - **Category** (select: core/author/marketing/ops — premium excluded, matches the writer).
  - **SKILL.md content** (textarea — the frontmatter + markdown body / `{{guidance}}`).
  - **Executable phases** (optional): an ordered list; each phase has `name?`, `model`
    (OpenRouter id), `temperature?`, `prompt` (with `{{input}}` / `{{previous}}` /
    `{{guidance}}` helper hints). Add / remove / reorder (▲▼). A skill with zero phases
    saves as **passive** (no `steps.json`).
  - **Retries** (0–4) — shown only when there is ≥1 phase.
  - A short legend explaining the templating tokens + that executable skills are
    **OpenRouter-only** and each phase is a separate billed call.
- **Load:** `GET /api/skills/:name` → `{ skill }` (carries `content`, `steps?`, `retries?`,
  `category`, `source`).
- **Save:** `PUT /api/skills/:name` `{ category, content, steps, retries }` (Phase A API).
  Editing a **built-in** (`source !== 'workspace'`) saves a **workspace overlay** copy
  (existing PUT behavior) — surface a "saving creates an editable copy" note.
- **Validation (client):** each phase needs a non-empty model + prompt before Save
  enables (mirrors the server's `parseSteps`); retries clamped 0–4. Server re-validates.
- **Delete** stays via the existing per-skill delete (workspace only).

## Share / import (steps.json)

Skill share/import currently transfers `SKILL.md`. Verify whether the transfer copies
the whole skill dir (so `steps.json` rides along) or only `SKILL.md`; if only the latter,
include `steps.json` in the skill export/import bundle (`library-transfer.ts`) so an
executable skill survives a round-trip. (Small backend add; do it only if needed.)

## Out of scope

- On-demand (non-pipeline) skill invocation.
- A rich prompt editor / live template preview (plain textareas).

## Files

- Create `frontend/studio/src/components/asset/SkillEditor.tsx` (+ reuse Asset Studio CSS
  or a small module).
- Modify `frontend/studio/src/routes/AssetStudio.tsx` (render `SkillEditor` for skills).
- Possibly `gateway/src/services/library-transfer.ts` (steps.json in skill bundles — only
  if the transfer doesn't already copy the dir).

## Testing

- No React component-test runner — verified by `npm run build:frontend` (tsc + Vite),
  the existing `tests/skill-steps-smoke.sh` (exercises the same `PUT /api/skills` write +
  execution the editor drives), and a deploy click-through.
- If `library-transfer` is touched, add/extend a unit test for steps.json round-trip.
