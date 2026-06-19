# Editor modes + selection menu + AI greeting — design

Date: 2026-06-19
Status: approved (pending spec review)

## Problem

The Editors feature (interactive developmental-editor chat — `EditorService`, the
`editor` library kind, the `/editors` / `/editor:<name>` chat commands) does not
behave the way the owner expected:

1. Bare `/editor` / `/editors` does not present a pick-one menu. `/editors` lists
   editors but reads as a status dump; bare `/editor` just shows the active editor
   or a hint. The owner wants a numbered **menu** that prompts the user to choose.
2. Every editor is hardcoded as a *brainstorming* persona ("Right now you're in an
   interactive brainstorming session…"). The owner wants each editor to operate in
   **two modes** — open **Brainstorm** and **Critique/Edit** of existing text —
   selected at entry.
3. Entering an editor should open with an **in-character greeting** in that
   persona's voice, reflecting the chosen mode.

## Decisions (from brainstorming)

- **Two modes per editor**: `brainstorm` and `critique`, chosen when entering.
- **Stateless menu-then-command** selection: bare `/editor`/`/editors` prints a
  numbered menu with the exact command to type back. No half-finished server-side
  selection state.
- **Shared mode directive, neutral personas**: one directive pair covers all
  editors; the per-editor prompt keeps voice + craft and drops its hardcoded mode
  framing.
- **AI-generated greeting** on entry (recurring cost accepted by the owner).
- **Menu format**: numbered `N. Name — Specialty` (descriptions only — never dump
  the full system prompts into chat).
- **Scope**: dashboard/API chat only. Telegram bridge wiring stays the existing
  separate deferred TODO. No bridge changes here.

## Behavior

### Menu (bare `/editor` or `/editors`)

Both commands render the same menu:

```
**Editors** — reply with a command to begin:

1. Rosalind — Contemporary Romance
   brainstorm: `/editor rosalind brainstorm` · critique: `/editor rosalind critique`
2. Maeve — Romantasy
   brainstorm: `/editor maeve brainstorm` · critique: `/editor maeve critique`
3. Neil Ashford — Hard Science Fiction
   …
4. Lily — Intimate Scenes
   …
5. Sarah Chen — Character Names
   …

Add `book` to review your active book (e.g. `/editor maeve critique book`).
`/editor off` to exit.
```

- `Name` = the editor `label` text before its em/en-dash, else `name`.
- `Specialty` = new optional `specialty` field, else the `label` remainder after
  the dash, else `"developmental editor"`.
- If an editor is already active, append: `_Currently with **<label>** (<mode>)._`
- If no editors exist: `_No editors available._`

### Entry (`/editor <name> <mode> [book]`)

- `<mode>` ∈ {`brainstorm`, `critique`} (case-insensitive). Synonyms accepted:
  `brainstorm`/`bs`/`ideas` → brainstorm; `critique`/`edit`/`review` → critique.
- **Missing mode** (`/editor maeve`) → re-prompt, do not default:
  `**Maeve** has two modes — pick one: `/editor maeve brainstorm` or
  `/editor maeve critique`.` (Preserves a trailing `book` token in the re-prompt.)
- **Unknown name** → `Unknown editor; try `/editors`.`
- **Valid name + mode** →
  1. `setChannelEditor(channel, name, withBook, mode)` (persisted).
  2. Generate the greeting (below) and return it as the entry message.

### Exit

`/editor off` | `none` | `exit` → `clearChannelEditor` → "Back to normal chat."
(unchanged.)

### Active-chat routing (unchanged except mode)

`handleMessage` already swaps to the editor's composed prompt while a channel is in
editor mode. The only change: `composeEditorPrompt` receives the channel's `mode`
and appends the matching directive. Model/temperature pin, `editor_chat` tier,
memory, and opt-in `withBook` manuscript context are unchanged.

## Components

### `editor-prompt.ts` — mode directives

Add two exported constants and a `mode` parameter:

```ts
export type EditorMode = 'brainstorm' | 'critique';

export const MODE_DIRECTIVE: Record<EditorMode, string> = {
  brainstorm: `# Session mode: BRAINSTORM
You are in an open, generative brainstorming session. Help the author invent and
pressure-test ideas — premises, characters, hooks, "what if" turns, scene seeds.
Offer options, take sides, push toward the strongest version. You are not line-
editing finished text; you are thinking alongside the author.`,
  critique: `# Session mode: CRITIQUE
You are in a critique / developmental-edit session focused on the author's existing
text. Diagnose what is on the page: name the problems, classify how serious each is,
and give concrete, ranked, actionable fixes. Prioritize ruthlessly — lead with what
matters most. Stay in your craft lane and your voice.`,
};

export function composeEditorPrompt(
  editorPrompt: string,
  ctx: { memories?: string; heartbeat?: string; manuscript?: string },
  mode: EditorMode = 'brainstorm',
): string { /* prepend persona, append MODE_DIRECTIVE[mode], then existing blocks */ }
```

Directive is appended **after** the persona prompt and **before** the active-book /
memory / heartbeat blocks, so mode framing is stable regardless of context.

### Built-in editor prompts — light neutralizing edits

For each of `library/editors/{rosalind,maeve,neil,lily,sarah}.json`: remove the
sentence(s) that hardcode "you're in an interactive brainstorming session" so the
appended directive is not contradicted. Keep all voice, persona, and craft content.
Add the `specialty` field to each (Contemporary Romance / Romantasy / Hard Science
Fiction / Intimate Scenes / Character Names).

### `LibraryEditor` type + `parseEditor`

Add optional `specialty?: string` (trimmed, passed through). No other schema change.
Mode is **not** stored on the editor config — it is runtime channel state.

### `EditorService` — carry `mode`

- `ActiveEditor` gains `mode: EditorMode`.
- `setChannelEditor(channel, name, withBook, mode)`.
- `initialize()` reads `v.mode` and **defaults to `'brainstorm'`** when missing or
  invalid (backward-compatible with existing `channel-editors.json`).
- `persist()` writes `mode`.

### `index.ts` command handlers

- `editorsCommand` / the bare `/editor` branch → render the menu (shared helper).
- `editorCommand(channel, args)`:
  - parse `name`, `mode` (with synonyms), and the `book` token;
  - handle `off`, unknown name, missing mode (re-prompt) per Behavior;
  - on success: `setChannelEditor(..., mode)` then **generate + return the greeting**.
- `handleMessage`: pass `activeEditor.mode` into `composeEditorPrompt` (via the
  `buildSystemPrompt` editor branch — thread a `editorMode` field on the context).

### Greeting generation

A small helper (in `index.ts`, alongside the handlers, using `gateway.aiRouter`):

- system prompt = `composeEditorPrompt(editorCfg.systemPrompt, {…}, mode)` (same
  context assembly as a normal editor turn, incl. opt-in `withBook` manuscript);
- user instruction (fixed): *"Open the session: introduce yourself in character in
  2–4 sentences, make clear which mode we're in, and invite me to begin. Do not
  summarize these instructions."*
- route at `editor_chat` tier with the editor's model/temperature pin (same logic
  as `handleMessage`);
- **record cost** for the call;
- append the assistant greeting to the channel's conversation history so the
  session continues coherently (no synthetic user turn stored);
- on AI failure, fall back to a static line: `You're now with **<label>**
  (<mode>). What are we working on?` (never block entry on a failed greeting).

### `EditorEditor.tsx` (Asset Studio)

Add a `specialty` text input (load from `ed.specialty`, include in the save
payload) so editing an editor via the UI does not strip the field. No mode UI —
mode is runtime, not config.

## Data flow

```
/editor (bare)            -> menu string
/editor maeve             -> mode re-prompt
/editor maeve brainstorm  -> setChannelEditor(mode) -> greeting AI call -> reply
(subsequent messages)     -> handleMessage -> composeEditorPrompt(..., mode)
/editor off               -> clearChannelEditor
```

## Error handling

- Missing mode → re-prompt (no default at entry; default only applies to legacy
  persisted records on load).
- Unknown name / mode synonym miss → guidance pointing back to `/editors`.
- Greeting AI failure → static fallback; entry still succeeds.
- `channel-editors.json` corrupt / legacy → existing fail-soft load; missing
  `mode` → `brainstorm`.

## Testing

Unit:
- `editor-prompt`: `composeEditorPrompt` appends the correct directive per mode;
  default mode is brainstorm; directive precedes context blocks.
- `editor-store` (channel-editors): `mode` persists + round-trips; legacy record
  without `mode` loads as `brainstorm`; stale-editor prune still works.
- command parse: bare → menu; `name` only → re-prompt; `name + mode` → enter; mode
  synonyms; `book` token preserved; `off`.
- `parseEditor`: `specialty` passthrough; absent is fine.

Smoke (real AI, `tests/editors-smoke.sh` extended or a new sub-smoke):
- `/editor` returns the numbered menu;
- `/editor maeve brainstorm` returns a non-empty in-character greeting;
- a follow-up message stays in editor mode (voice preserved);
- `/editor off` returns to normal chat.

## Out of scope

- Telegram bridge command wiring (existing separate TODO).
- Per-mode authored prompts or per-mode greetings (shared directive + AI greeting
  cover it).
- Discord.
