# Prompt Runner — Run Writing-Craft Prompts Against Book Files — Design

Date: 2026-06-14

Bring the owner's "OpenRouter-Interface / Prompt Runner" prototype into the writing studio:
a curated library of reusable writing-craft prompts that run **one at a time** against any
file in a book, with a preview-first **Run → decide** flow (Replace the file, Save as a new
file, or Discard) and per-file version history for restore.

## Current state

- BookClaw already lists/reads a book's `data/` output files: `GET /api/books/:slug/files`
  (`BookService.listFiles`) and `GET /api/books/:slug/files/:filename` (read via `serveFile`,
  `dataDirOf(slug)` + `safePath` + `SLUG_RE` guarded). There is **no write-back endpoint**.
- The library has JSON-content kinds (`pipeline`, `sequence`, `editor`) registered in
  `LibraryService` via `FILE_KINDS` + `DIR_LAYOUT`, each parsed by a `parse*` validator and
  returned by `library.get(kind, name)` as `{ <kind>: parsed }`. The new `editor` kind is the
  closest precedent (a JSON `{ name, systemPrompt, model?, temperature? }`).
- The prototype (`~/data/Writing/AI-Tools/OpenRouter-Interface/`) stores prompts as JSON
  (`prompts/*.json`: `title`/`description`/`persona`/`instructions[]` + structured guidance)
  registered in `prompts_registry.yaml`; it runs a single prompt's persona against file input.

## Target model

A `prompt` library kind (mirrors `editor`); a stateless **run** endpoint that applies a
prompt's `systemPrompt` to file content via the AI router and returns the output **without
saving**; a **write-back + per-file versioning** path on book `data/` files; and a studio
**Prompt Runner** route (file picker → prompt picker → run → diff/preview → Replace / Save-as /
Discard, with version history).

---

## Section 1 — Data model: the `prompt` library kind

Add `prompt` to `LIBRARY_KINDS` (`library-types.ts`) and the shared `LibraryKind` union, and
register it as a JSON kind in `LibraryService` exactly like `editor` (`FILE_KINDS += 'prompt'`,
`DIR_LAYOUT.prompt = 'prompts'`, `LibraryEntryFull.prompt?: LibraryPrompt`, `loadKind`/`writeEntry`
branches validating via `parsePrompt`). `library.get('prompt', name)` returns `{ prompt: LibraryPrompt }`.

**Canonical schema** (`gateway/src/services/prompt-parse.ts`):
```ts
export interface LibraryPrompt {
  schemaVersion?: number;
  name: string;
  label?: string;
  description?: string;
  systemPrompt: string;       // the whole craft prompt (persona + instructions + guidance)
  model?: string;             // optional OpenRouter model id
  temperature?: number;
}
export function parsePrompt(raw: unknown): LibraryPrompt;  // throws on empty name/systemPrompt; clamps temperature [0,2]
```
(Identical in shape to `parseEditor`; kept as a separate kind because the run semantics differ.)

**Built-ins** (`library/prompts/<name>.json`): a **curated, de-duplicated subset** of the
prototype's prompts (the registry has ~29 with several near-duplicates) — roughly 12–15 distinct,
high-value writing-craft prompts (e.g. 7-point character review, expert dialogue editor, copy
editor, on-the-nose editor, bad-chapter-ending checker, engagement checker, show-don't-tell /
human-writing editor, first-chapter checker, female/male character audits, "improve the middle
third"). Each flattens its source `persona` + `instructions` + structured guidance into one
coherent `systemPrompt` ending with a clear output instruction; gets a `label` + one-line
`description`. Skip duplicates and prompts that don't suit file-transform use; list what was skipped.

## Section 2 — Running a prompt

A pure runner `gateway/src/services/prompt-runner.ts`:
```ts
export async function runPrompt(
  deps: { prompts?: { get(name: string): LibraryPrompt | null }; aiRouter: { complete(req: any): Promise<{ text: string; tokensUsed?: number; estimatedCost?: number }> }; costs?: { record(p: string, t: number, c?: number, b?: string): void } },
  promptName: string, content: string, bookSlug?: string,
): Promise<{ text: string } | null>;   // null if prompt unknown; throws -> caller maps to error
```
It resolves the prompt, calls `aiRouter.complete({ system: prompt.systemPrompt, messages:[{role:'user',content}], maxTokens, provider, model? })`, records cost (attributed to `bookSlug`), and returns the text. **Neutral run** — the book's author/voice/genre are NOT injected (these are editorial operations; the prompt persona is the instruction).

Route: `POST /api/prompts/run` `{ prompt, content, bookSlug? }` → `{ output }` (does NOT save).
Validate `content` non-empty + a length cap (e.g. 100K chars). Routed at a new `prompt_run`
task type (mid tier, **16K** output budget so a full-chapter rewrite isn't truncated — added to
`TASK_TIERS`/`TASK_OUTPUT_BUDGET` in `router.ts`); a prompt's optional `model` pins OpenRouter
atomically (only when the resolved provider is OpenRouter — mirror the editor-model fix).

## Section 3 — File write-back + per-file versioning

A pure helper `gateway/src/services/file-versions.ts` operating on a resolved `dataDir`:
```ts
writeWithVersion(dataDir: string, filename: string, content: string): Promise<void>;  // snapshot prior -> .versions/<filename>/<ts>.md, then write
listVersions(dataDir: string, filename: string): Array<{ id: string; at: string; bytes: number }>;
restoreVersion(dataDir: string, filename: string, id: string): Promise<void>;          // snapshot current, then overwrite from the version
```
Versions live at `workspace/books/<slug>/.versions/<filename>/<timestamp>.md`. `writeWithVersion`
copies the existing file (if any) into `.versions/` before overwriting; `restoreVersion`
snapshots the current content first (so a restore is itself undoable), then writes the chosen
version back.

Routes (in `books.routes.ts`, all `SLUG_RE` + `dataDirOf` + `safePath` guarded like the existing
read route):
- `PUT /api/books/:slug/files/:filename` `{ content }` → `writeWithVersion` → `{ ok: true }`.
  (Filename may be a new name for "Save as new file".)
- `GET /api/books/:slug/files/:filename/versions` → `{ versions }`.
- `POST /api/books/:slug/files/:filename/restore` `{ id }` → `restoreVersion` → `{ ok: true }`.
`.versions/` is excluded from the `listFiles` output and from the file picker.

## Section 4 — UI: the Prompt Runner studio route

A new studio route **Prompt Runner** (Rail entry "Prompt Runner"):
- **File picker** — the active book's `data/` files (reuse `GET /api/books/:slug/files`).
- **Prompt picker** — the `prompt` library (`GET /api/library?kind=prompt`), name + description.
- **Run** — `POST /api/prompts/run` with the selected file's content; shows a spinner, then the
  output pane.
- **Output actions:** **Replace** (opens an original-vs-output **diff**; on confirm `PUT`s the
  file via `writeWithVersion`), **Save as new file** (prompt for a name → `PUT`), **Discard**.
- **Version history** — a panel listing `GET …/versions` with a **Restore** action per entry.
- Editors are user-creatable: a minimal **PromptEditor** for the `prompt` kind in the Asset
  Studio (label/description/model/temperature + a `systemPrompt` textarea), mirroring the
  `EditorEditor`. Add `prompt` to `KIND_DEFS`/glossary/KindRail/NewBook map.

## Section 5 — Testing

**Unit (`tests/unit/`):**
- `prompt-parse.test.ts` — `parsePrompt` valid/invalid/clamp.
- `prompt-runner.test.ts` — `runPrompt` resolves + calls a fake AI with the prompt's systemPrompt + the content; unknown prompt → null.
- `file-versions.test.ts` — `writeWithVersion` snapshots prior + writes; `listVersions` ordering; `restoreVersion` snapshots current then restores; new-file write makes no spurious version.
- built-in load test — all `library/prompts/*.json` parse via `parsePrompt`.

**API (`tests/api/api-test.sh`):** `GET /api/library?kind=prompt` lists a known prompt;
`PUT`/`GET versions`/`POST restore` round-trip on a temp book file (create a book, write a file,
version it, restore, clean up).

**Smoke (new `tests/prompt-runner-smoke.sh`, real AI):** create a book, write a small `data/`
file, `POST /api/prompts/run` a built-in prompt against it (assert non-empty, non-failure
output), `PUT` the output back, assert a prior version now exists via `GET …/versions`; clean up.

## Decisions & non-goals

- **Single prompt at a time;** the prototype's multi-prompt *chains* are deferred.
- **Neutral run** (prompt persona only); an "apply book voice" toggle is a future enhancement.
- **Per-file `.versions/` sidecar**, not the whole-workspace `BackupService`.
- **No ConfirmationGate** — local book-file edits, not external side effects; `safePath` + the
  versioned prior copy are the safety net.
- **`prompt` is a distinct kind from `editor`** (one-shot file transform vs interactive chat),
  though the JSON shape is shared.
- **TODO bookkeeping:** the "Prompt Runner" TODO item moves to `COMPLETED.md` on completion (2026-06-14).
