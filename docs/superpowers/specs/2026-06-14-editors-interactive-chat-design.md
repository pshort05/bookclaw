# Editors — Interactive Developmental-Editor Chat — Design

Date: 2026-06-14

A new feature, **Editors**: interactive chat with a specialized developmental-editor persona
(Maeve, Rosalind, Neil, Lily, Sarah) for informal brainstorming and finetuning ideas. You
enter an editor's "mode" in a chat channel and have a back-and-forth conversation; the
editor's persona replaces the author voice for that conversation.

## Current state

- Chat runs through `BookClawGateway.handleMessage` (`gateway/src/index.ts`), which composes a
  system prompt from the author **soul** + genre/world/sections guides + memory via
  `buildSystemPrompt`, then routes to the AI router.
- Slash commands are dispatched in `handleDashboardCommand` (whitespace split: `cmd = parts[0]`,
  `args = rest`) and mirrored to Telegram via `buildTelegramCommandHandlers()`.
- Per-channel state already exists: `BookService` keeps a per-channel active-**book** pointer
  (`channelBooks` Map + `workspace/.config/channel-books.json`, with `getChannelBook(channel)`).
- The library has JSON-content kinds (`pipeline`, `sequence`) registered in `LibraryService`
  via `FILE_KINDS` + `DIR_LAYOUT`, each parsed by a small `parse*` validator and returned by
  `library.get(kind, name)` as `{ <kind>: parsed }`.
- The five source configs live at `~/data/Writing/genres/interactive_*_editor_*.json` — rich
  JSON (persona, voice, evaluation system, feedback framework, `api_instructions.system_role`
  + `core_directives`).

## Target model

A book/genre-style **library kind `editor`**, a small **`EditorService`** that holds a
per-channel active editor (mirroring `channelBooks`), chat **commands** to enter/leave/list
editor mode, and a branch in `handleMessage` that **swaps the author-voice system prompt for
the editor's `systemPrompt`** while the channel is in editor mode (with opt-in active-book
context).

---

## Section 1 — Data model: the `editor` library kind

Add `editor` to `LIBRARY_KINDS` (`library-types.ts`) and the shared `LibraryKind` union
(`frontend/shared/src/types.ts`). Register it as a JSON-content kind in `LibraryService`
exactly like `sequence`: `FILE_KINDS += 'editor'`, `DIR_LAYOUT.editor = 'editors'`,
`LibraryEntryFull.editor?: LibraryEditor`, plus `loadKind`/`writeEntry` branches that
validate via `parseEditor`. `library.get('editor', name)` returns `{ editor: LibraryEditor }`.

**Canonical schema** (`gateway/src/services/editor-parse.ts`):
```ts
export interface LibraryEditor {
  schemaVersion?: number;
  name: string;
  label?: string;
  description?: string;
  systemPrompt: string;          // the whole editor persona as a single prompt
  model?: string;                // optional OpenRouter model id override
  temperature?: number;          // optional
}
export function parseEditor(raw: unknown): LibraryEditor; // throws on empty name/systemPrompt
```
`parseEditor` requires a non-empty `name` and `systemPrompt`; clamps `temperature` to [0,2] if
present; `model` is an optional trimmed string.

**Storage:** built-in `library/editors/<name>.json`, overlay `workspace/library/editors/<name>.json`.
Description in the same JSON (`description`), surfaced by the library list.

**The five built-ins** (`library/editors/{maeve,rosalind,neil,lily,sarah}.json`) are authored by
flattening each rich source config into one coherent `systemPrompt` (its `api_instructions.system_role`
+ `core_directives` + persona/voice/feedback-framework, rendered as instructional prose). Each
gets a `label`, a one-line `description`, and — where the source recommends one — a `model`:
- `maeve` — elite romantasy developmental editor
- `rosalind` — romance developmental editor
- `neil` — hard-SF developmental editor
- `lily` — intimate-scenes editor
- `sarah` — character-name editor

## Section 2 — Session state: `EditorService`

New `gateway/src/services/editor.ts` (`EditorService`), constructed with the workspace dir +
a reference to `LibraryService`. Responsibilities:
- `list(): Array<{ name; label?; description? }>` — available editors, from the library.
- `get(name): LibraryEditor | null` — resolve one (via `library.get('editor', name)`).
- Per-channel active-editor pointer `Map<channel, { editor: string; withBook: boolean }>`,
  persisted to `workspace/.config/channel-editors.json`, mirroring `BookService.channelBooks`
  (load on init with fail-soft pruning of editors that no longer exist; `getChannelEditor(channel)`,
  `setChannelEditor(channel, name, withBook)`, `clearChannelEditor(channel)`, `persistChannelEditors()`).

Wired in the init sequence (a Phase block in `index.ts`), after `LibraryService`. Exposed as
`gateway.editors`.

## Section 3 — Commands (`handleDashboardCommand` + Telegram handlers)

Normalize the colon form first: if `cmd` matches `/editor:<name>`, rewrite to `cmd = '/editor'`,
`args = '<name>' + rest`. Then:
- **`/editors`** — list available editors (name — description), plus the current active editor for the channel.
- **`/editor <name>` (or `/editor:<name>`)** — enter `<name>` mode for this channel. Unknown name → list valid ones. Trailing `book` (e.g. `/editor maeve book`) sets `withBook: true`. Reply confirms ("You're now in session with **Maeve**…").
- **`/editor off`** (also `none`/`exit`) — clear the channel's editor; reply confirms normal chat resumed.
- **`/editor`** (no arg) — show the current editor (+ `withBook`) and a short help line.

Both surfaces call the same handlers (add to `buildTelegramCommandHandlers()` so Telegram gets
them too). Help text added to `/help`.

## Section 4 — Chat composition while in editor mode

In `handleMessage`, after `overrideSlug` is resolved (~`index.ts:575`), resolve
`const activeEditor = this.editors?.getChannelEditor(channel)`. When present:
- **The editor's `systemPrompt` becomes the system prompt** (the editor replaces the author
  voice). `buildSystemPrompt` gains an optional `editorPrompt?: string`; when set, it builds an
  editor-framed prompt — the editor persona as the dominant instruction + memory/heartbeat —
  and **does not** inject the author soul, genre, world, or sections.
- **Opt-in book context:** when `activeEditor.withBook`, inject a "Manuscript under review" block
  — the active book's genre guide + premise + a recent-output excerpt (resolved from the
  per-channel active book via existing `books` accessors) — appended after the editor persona.
- **Routing:** `taskType = 'editor_chat'` (new task type → mid tier, generous output budget) so
  feedback is high quality; if `activeEditor` resolves an editor with a `model`, pass it as the
  exact model override (provider `openrouter`), bypassing tier routing.
- **History:** the channel's existing conversation history is reused (one continuous thread).
  No author-model "observe"/skill-matching changes are required; skills still match but are
  irrelevant under the editor prompt (acceptable; the editor prompt dominates).

Add `editor_chat` to the router's `TASK_TIERS`/`TASK_OUTPUT_BUDGET` (`gateway/src/ai/router.ts`).

## Section 5 — Surfaces & UI

- **Commands work in dashboard chat, the studio Chat app, and Telegram** (shared handlers).
- **Studio (minimal):** the `editor` kind appears in the Asset Studio (KindRail + `KIND_DEFS`/glossary)
  with a small **EditorEditor** — `label`, `description`, `model`, `temperature`, and a
  `systemPrompt` textarea — so editors are user-creatable/editable (the payoff of the library-kind
  choice). The library import/export pipeline covers `editor` like other JSON kinds.
- **Deferred (non-MVP):** a dedicated Editors picker UI / an active-editor badge in the chat
  header. Commands + the Asset Studio editor are the MVP.

## Section 6 — Testing

**Unit (`tests/unit/`):**
- `editor-parse.test.ts` — `parseEditor` accepts a valid editor; rejects empty `name`/`systemPrompt`; clamps `temperature`.
- `editor-store.test.ts` — `EditorService` per-channel set/get/clear + persistence round-trip; prunes a removed editor on load; `list()`/`get()` resolve from a stub library.
- `editor-prompt.test.ts` — `buildSystemPrompt({ editorPrompt })` yields the editor persona as the system prompt and omits the author soul/genre/world; `withBook` adds the manuscript block.
- A built-in load test — each of the 5 `library/editors/*.json` parses via `parseEditor`.

**API (`tests/api/api-test.sh`):** `GET /api/library?kind=editor` lists `maeve`; `GET /api/library/editor/maeve` returns its `systemPrompt`.

**Smoke (new `tests/editors-smoke.sh`, real OpenRouter):** `/editors` lists the built-ins;
`/editor maeve` enters mode; a brainstorming line gets an in-character reply (assert non-empty,
no `[AI provider failure]`); `/editor off` returns to normal chat. Uses the dashboard
command + chat endpoints; forces OpenRouter; self-cleaning (clears the channel editor).

## Decisions & non-goals

- **Editor replaces the author voice** in editor mode (you talk *to* the editor); genre/world/sections
  are dropped unless `withBook` is on.
- **Shared channel history** (one continuous thread), not a separate editor thread.
- **Dedicated Editors picker UI deferred**; commands + Asset Studio editor are MVP.
- **No ConfirmationGate** — editor chat has no external side effects; the injection detector still
  runs on inbound messages.
- **TODO bookkeeping:** add the "Editors" feature to `docs/TODO.md` before starting; move to
  `docs/COMPLETED.md` on completion (2026-06-14).
