# Editors — Interactive Developmental-Editor Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Editors" feature — chat commands put a channel into a persistent developmental-editor mode where a persona (Maeve/Rosalind/Neil/Lily/Sarah, stored as a new `editor` library kind) replaces the author voice for informal brainstorming, with opt-in active-book context.

**Architecture:** A JSON `editor` library kind (mirrors `sequence`) + a small `EditorService` holding per-channel active-editor pointers (mirrors `BookService.channelBooks`). `handleMessage` swaps in the editor's `systemPrompt` when a channel is in editor mode; `/editor` commands enter/leave/list. Five built-in editors are flattened from the source configs.

**Tech Stack:** Node 22 + TS (`tsx`, NodeNext, `.js` imports), Express, React/Vite studio, `node --test`, bash smoke tests.

**Spec:** `docs/superpowers/specs/2026-06-14-editors-interactive-chat-design.md`

**Commit policy:** No per-task `git commit` (repo uses `commit_message` + `./push.sh`). Verify each step with the listed command; commit once at the end.

**Verify baseline:** `npx tsc --noEmit` (0), `node --import tsx --test tests/unit/*.test.ts`, `npm run build:frontend`, `npm run test:api`, `npm run test:smoke`.

**Parallel-execution chunks (after Phase 1):** Phase 2 (index.ts + init), Phase 3 (built-in configs), Phase 4 (frontend) are file-disjoint and can run concurrently. Phase 1 is the shared foundation; Phase 5 is integration.

---

## Phase 1 — Backend foundation: the `editor` kind + EditorService + router

### Task 1: `parseEditor` + `editor` library kind

**Files:** Create `gateway/src/services/editor-parse.ts`; Test `tests/unit/editor-parse.test.ts`; Modify `gateway/src/services/library-types.ts`, `gateway/src/services/library.ts`, `frontend/shared/src/types.ts`

- [ ] **Step 1: failing test** (`tests/unit/editor-parse.test.ts`):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEditor } from '../../gateway/src/services/editor-parse.ts';

test('parseEditor accepts a valid editor', () => {
  const e = parseEditor({ name: 'maeve', label: 'Maeve', description: 'd', systemPrompt: 'You are Maeve.', temperature: 0.8 });
  assert.equal(e.name, 'maeve');
  assert.equal(e.systemPrompt, 'You are Maeve.');
  assert.equal(e.schemaVersion, 1);
  assert.equal(e.temperature, 0.8);
});
test('parseEditor rejects empty name or systemPrompt and clamps temperature', () => {
  assert.throws(() => parseEditor({ name: '', systemPrompt: 'x' }));
  assert.throws(() => parseEditor({ name: 'x', systemPrompt: '' }));
  assert.equal(parseEditor({ name: 'x', systemPrompt: 'y', temperature: 9 }).temperature, 2);
});
```
- [ ] **Step 2:** Run `node --import tsx --test tests/unit/editor-parse.test.ts` → FAIL.
- [ ] **Step 3: implement `editor-parse.ts`:**
```ts
import type { LibraryEditor } from './library-types.js';

/** Validate + normalize an editor config (from JSON content). Throws on invalid. */
export function parseEditor(raw: unknown): LibraryEditor {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const systemPrompt = typeof o.systemPrompt === 'string' ? o.systemPrompt.trim() : '';
  if (!name) throw new Error('editor.name is required');
  if (!systemPrompt) throw new Error('editor.systemPrompt is required');
  const out: LibraryEditor = {
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : 1,
    name,
    systemPrompt,
  };
  if (typeof o.label === 'string') out.label = o.label;
  if (typeof o.description === 'string') out.description = o.description;
  if (typeof o.model === 'string' && o.model.trim()) out.model = o.model.trim();
  if (typeof o.temperature === 'number') out.temperature = Math.max(0, Math.min(2, o.temperature));
  return out;
}
```
- [ ] **Step 4:** Add to `library-types.ts`: `'editor'` in `LIBRARY_KINDS`, and the interface:
```ts
export interface LibraryEditor {
  schemaVersion?: number;
  name: string;
  label?: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
}
```
- [ ] **Step 5:** In `frontend/shared/src/types.ts`, add `'editor'` to the `LibraryKind` union.
- [ ] **Step 6:** In `library.ts`, register `editor` as a JSON kind **mirroring `sequence` exactly** (read the file's `sequence` handling first): add `editor?: LibraryEditor` to `LibraryEntryFull`; `editor: 'editors'` in `DIR_LAYOUT`; `'editor'` in `FILE_KINDS`; the overlay-path `<name>.json` guard; a `writeEntry` branch validating via `parseEditor(JSON.parse(raw))`; a `loadKind` branch parsing JSON via `parseEditor({ ...JSON, name })` so `library.get('editor', name)` returns `{ editor }`.
- [ ] **Step 7:** Run the test → PASS. `npx tsc --noEmit` → 0.

### Task 2: `EditorService` (per-channel active editor)

**Files:** Create `gateway/src/services/editor.ts`; Test `tests/unit/editor-store.test.ts`

- [ ] **Step 1: failing test** (`tests/unit/editor-store.test.ts`) — construct an `EditorService` with a temp workspace dir + a stub library (`{ get: (k,n)=> n==='maeve'?{editor:{name:'maeve',systemPrompt:'p'}}:undefined, list:()=>[{kind:'editor',name:'maeve',description:'d'}] }`); assert `list()` returns maeve; `get('maeve').systemPrompt==='p'`; `setChannelEditor('web','maeve',true)` then `getChannelEditor('web')` deep-equals `{editor:'maeve',withBook:true}`; `clearChannelEditor('web')` → `getChannelEditor('web')` is null; a fresh instance over the same dir (after init) restores the pointer; a pointer to a now-unknown editor is pruned on init. Match how `tests/unit/book*.test.ts` set up temp dirs.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: implement `editor.ts`** mirroring `BookService.channelBooks`:
```ts
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import type { LibraryEditor } from './library-types.js';

interface LibraryLike {
  get(kind: string, name: string): { editor?: LibraryEditor } | undefined;
  list(): Array<{ kind: string; name: string; label?: string; description?: string }>;
}
export interface ActiveEditor { editor: string; withBook: boolean; }

export class EditorService {
  private library: LibraryLike;
  private channelEditors = new Map<string, ActiveEditor>();
  private readonly ptrPath: string;

  constructor(workspaceDir: string, library: LibraryLike) {
    this.library = library;
    this.ptrPath = join(workspaceDir, '.config', 'channel-editors.json');
  }

  async initialize(): Promise<void> {
    this.channelEditors.clear();
    try {
      if (!existsSync(this.ptrPath)) return;
      const raw = JSON.parse(readFileSync(this.ptrPath, 'utf-8'));
      const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, any> : {};
      let pruned = obj !== raw;
      for (const [ch, v] of Object.entries(obj)) {
        const name = v && typeof v === 'object' ? v.editor : undefined;
        if (typeof name === 'string' && this.get(name)) {
          this.channelEditors.set(ch, { editor: name, withBook: !!v.withBook });
        } else { pruned = true; }
      }
      if (pruned) await this.persist();
    } catch { /* fail-soft: no editor sessions */ }
  }

  list(): Array<{ name: string; label?: string; description?: string }> {
    return this.library.list().filter((e) => e.kind === 'editor')
      .map((e) => ({ name: e.name, label: e.label, description: e.description }));
  }
  get(name: string): LibraryEditor | null {
    return this.library.get('editor', name)?.editor ?? null;
  }
  getChannelEditor(channel: string): ActiveEditor | null {
    return this.channelEditors.get(channel) ?? null;
  }
  async setChannelEditor(channel: string, name: string, withBook: boolean): Promise<void> {
    this.channelEditors.set(channel, { editor: name, withBook });
    await this.persist();
  }
  async clearChannelEditor(channel: string): Promise<void> {
    this.channelEditors.delete(channel);
    await this.persist();
  }
  private async persist(): Promise<void> {
    try {
      await mkdir(dirname(this.ptrPath), { recursive: true });
      const obj: Record<string, ActiveEditor> = {};
      for (const [ch, v] of this.channelEditors) obj[ch] = v;
      await writeFile(this.ptrPath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch { /* non-fatal */ }
  }
}
```
- [ ] **Step 4:** Run → PASS. `npx tsc --noEmit` → 0.

### Task 3: `editor_chat` task type in the router

**Files:** Modify `gateway/src/ai/router.ts`

- [ ] **Step 1:** Read the `TASK_TIERS`, `TASK_OUTPUT_BUDGET` (and `TASK_REASONING` if present) maps. Add `editor_chat`: tier `mid`, output budget ~4096 (a conversational-feedback budget; match a comparable chat/creative task's value). No test needed (covered by the smoke); `npx tsc --noEmit` → 0 after.

---

## Phase 2 — Chat integration (index.ts) — depends on Phase 1

### Task 4: `buildSystemPrompt` editor branch + `handleMessage` swap + init wiring

**Files:** Modify `gateway/src/index.ts`; Create an init phase file if the init sequence uses one (e.g. `gateway/src/init/phase-06x-editors.ts`) or instantiate inline following the existing pattern; Test `tests/unit/editor-prompt.test.ts`

- [ ] **Step 1: failing test** (`tests/unit/editor-prompt.test.ts`) — `buildSystemPrompt` is a public method on the gateway. Instantiate the gateway (or call the method on a minimal instance as other tests do — check existing tests for how the gateway/buildSystemPrompt is exercised; if not unit-testable in isolation, extract the editor-framing into a pure helper `composeEditorPrompt(editorPrompt, { memories, heartbeat, manuscript? })` in a new `gateway/src/services/editor-prompt.ts` and test THAT). Test: given `editorPrompt='You are Maeve.'` the result contains the editor prompt and does NOT contain author-soul markers; with a `manuscript` block it includes "Manuscript under review".
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Preferred: add a pure helper `gateway/src/services/editor-prompt.ts`:
```ts
export function composeEditorPrompt(editorPrompt: string, ctx: { memories?: string; heartbeat?: string; manuscript?: string }): string {
  let p = editorPrompt.trim();
  if (ctx.manuscript && ctx.manuscript.trim()) {
    p += `\n\n# Manuscript under review\n${ctx.manuscript.trim()}`;
  }
  if (ctx.memories && ctx.memories.trim()) p += `\n\n# Recent conversation context\n${ctx.memories.trim()}`;
  if (ctx.heartbeat && ctx.heartbeat.trim()) p += `\n\n${ctx.heartbeat.trim()}`;
  return p;
}
```
Then in `buildSystemPrompt`, accept optional `editorPrompt?: string` and `manuscript?: string`; when `editorPrompt` is set, `return composeEditorPrompt(editorPrompt, { memories, heartbeat: heartbeatContext, manuscript })` instead of the author-voice assembly (do NOT add soul/genre/world/sections).
- [ ] **Step 4:** In `handleMessage`, after `overrideSlug` is resolved (~`index.ts:575`):
```ts
const activeEditor = this.editors?.getChannelEditor(channel) ?? null;
const editorCfg = activeEditor ? this.editors!.get(activeEditor.editor) : null;
```
When `editorCfg` is set: build `manuscript` only if `activeEditor!.withBook` (compose from the channel's active book: `overrideSlug` genre guide + the latest project output excerpt via existing `books`/`memory` accessors — keep it short, e.g. first ~1500 chars); pass `editorPrompt: editorCfg.systemPrompt` + `manuscript` into `buildSystemPrompt`; set `taskType = 'editor_chat'`; if `editorCfg.model`, pass it as the model override with provider `openrouter` (mirror how a per-step model override flows into `selectProvider`/`complete`). When no editor, behave exactly as today.
- [ ] **Step 5:** Instantiate `EditorService` in the init sequence after `LibraryService` (`this.editors = new EditorService(join(ROOT_DIR,'workspace'), this.library); await this.editors.initialize();`), declare `public editors!: EditorService;`, and re-init it in any post-restore re-init path alongside books. Pass to `createAPIRoutes` only if needed (the library API already serves the `editor` kind; no new route required).
- [ ] **Step 6:** Run the unit test → PASS. `npx tsc --noEmit` → 0.

### Task 5: `/editor` + `/editors` commands

**Files:** Modify `gateway/src/index.ts` (`handleDashboardCommand` + `buildTelegramCommandHandlers` + `/help`)

- [ ] **Step 1:** In `handleDashboardCommand`, before the normal split-based dispatch, normalize the colon form: if `parts[0]` matches `/^\/editor:(.+)$/i`, treat as `cmd='/editor'`, `args = '<captured> ' + originalArgs`. Read the file's existing dispatch to insert consistently.
- [ ] **Step 2:** Add handlers (shared via `buildTelegramCommandHandlers` so Telegram gets them):
  - `/editors` → list `this.editors.list()` as `**name** — description` lines + the channel's current active editor (or "none").
  - `/editor` with args: parse `name` (first token) and an optional trailing `book` token. `name==='off'|'none'|'exit'` → `await this.editors.clearChannelEditor(channel)` + "Back to normal chat." Unknown name → "Unknown editor 'x'. Try `/editors`." Else `await this.editors.setChannelEditor(channel, name, /book/.test(args))` + "You're now in session with **<label||name>**." (+ "(reviewing your active book)" when withBook).
  - `/editor` with no args → show current editor + `withBook` + one help line.
- [ ] **Step 3:** Add a line to `/help` documenting `/editors` and `/editor:<name>`.
- [ ] **Step 4:** `npx tsc --noEmit` → 0. (Behavior covered by the smoke in Phase 5.)

---

## Phase 3 — Built-in editor configs (content) — depends only on the Task-1 schema

### Task 6: Author the five built-in editors

**Files:** Create `library/editors/{maeve,rosalind,neil,lily,sarah}.json`

- [ ] **Step 1:** For each source config under `~/data/Writing/genres/interactive_*_editor_*.json`, produce a canonical editor JSON `{ schemaVersion:1, name, label, description, systemPrompt, model? }`. `systemPrompt` is a coherent instructional flattening of the source's `api_instructions.system_role` + `core_directives` + persona/voice/feedback-framework/interaction-guidelines/output-format — written as a single second-person prompt that makes the editor behave in character for an interactive brainstorming chat. Keep each `systemPrompt` substantial but focused (roughly 400–1200 words). Map: `interactive_romantasy_editor_maeve.json`→`maeve`, `interactive_romance_editor_rosalind.json`→`rosalind`, `interactive_hardsf_editor_neil.json`→`neil`, `interactive_intimate_scenes_editor_lilly.json`→`lily`, `interactive_name_editor_sarah.json`→`sarah`.
- [ ] **Step 2:** Each file must `parseEditor`-validate. Quick check:
```bash
for f in library/editors/*.json; do node --import tsx -e 'import("./gateway/src/services/editor-parse.ts").then(m=>{m.parseEditor(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")));console.log(process.argv[1],"ok")})' "$f"; done
```

---

## Phase 4 — Frontend (Asset Studio editor kind) — depends on Task-1 shared type

### Task 7: `editor` kind in the Asset Studio

**Files:** Modify `frontend/studio/src/lib/glossary.ts`, `frontend/studio/src/components/asset/EntryList.tsx`, `frontend/studio/src/components/asset/KindRail.tsx`, `frontend/studio/src/routes/AssetStudio.tsx`; Create `frontend/studio/src/components/asset/EditorEditor.tsx`

- [ ] **Step 1:** Add `editor` to `GLOSSARY` (`glossary.ts`) and `KIND_LABELS`/`WRITABLE_KINDS` + a `STARTER_EDITOR_JSON` in `EntryList.tsx`, and a `KindRail` item ("Editors"). (These are exhaustive `Record<LibraryKind,…>` maps — adding the kind requires updating them or the build fails.)
- [ ] **Step 2:** Create `EditorEditor.tsx` (model on `PipelineEditor.tsx` for load/save/`scope`/`name`/`displayName` props): loads the editor JSON via the library read API, renders inputs for `label`, `description`, `model`, `temperature`, and a large `systemPrompt` textarea; serializes to `{ schemaVersion:1, name, label, description, systemPrompt, model, temperature }` and saves via the same write path. Read `PipelineEditor.tsx`/`SequenceEditor.tsx` first to match conventions.
- [ ] **Step 3:** In `AssetStudio.tsx`, render `EditorEditor` when `kind === 'editor'`.
- [ ] **Step 4:** `npm run build:frontend` → clean.

---

## Phase 5 — Tests, smoke, integration

### Task 8: API-test assertion

**Files:** Modify `tests/api/api-test.sh`

- [ ] **Step 1:** Add (match existing helper style): `body_has "/api/library?kind=editor" '"maeve"' "library lists the maeve editor"` and `body_has "/api/library/editor/maeve" 'systemPrompt' "editor/maeve returns its systemPrompt"`.
- [ ] **Step 2:** `bash -n tests/api/api-test.sh` → OK.

### Task 9: Real-money editors smoke

**Files:** Create `tests/editors-smoke.sh` (model on `tests/spend-smoke.sh` for token/`req`/`code`/`jget` helpers + OpenRouter gating + self-clean)

- [ ] **Step 1:** Find the dashboard chat + command endpoints (grep routes for the chat message endpoint and the `handleDashboardCommand` route, e.g. `/api/chat` and a command route). Script:
  1. `GET /api/library/editor/maeve` resolves (non-empty `systemPrompt`).
  2. Send command `/editors` → response lists `maeve`.
  3. Send command `/editor maeve` → response confirms entering Maeve mode.
  4. Send a normal chat message ("I have a romantasy idea about a rebel sky-sailor — poke holes in it.") with provider forced to OpenRouter → assert a non-empty reply, not `[AI provider failure]`.
  5. Send `/editor off` → response confirms normal chat.
  Use the same channel name throughout; force OpenRouter (`SMOKE_OR_MODEL`); self-clean (`/editor off`).
- [ ] **Step 2:** `bash -n tests/editors-smoke.sh` → OK.

### Task 10: Bookkeeping

**Files:** Modify `docs/TODO.md`, `docs/COMPLETED.md`

- [ ] **Step 1:** Move the "Editors — interactive developmental-editor chat" item from `docs/TODO.md` to `docs/COMPLETED.md` with a `2026-06-14` date.

### Task INT1: Full verify + review + deploy (integrator)
- [ ] `npx tsc --noEmit` → 0; `node --import tsx --test tests/unit/*.test.ts` → all pass (prior + new); `npm run build:frontend` → clean; `npm run test:api` → pass (incl. editor assertions); `npm run test:smoke` → pass.
- [ ] Run `/code-review` (high) over the diff; fix every medium+ finding; re-verify.
- [ ] Write `commit_message`; `touch build_now` to trigger the Mercury deploy; after it's live, run `BASE_URL=http://192.168.1.32:3847 tests/editors-smoke.sh`.

---

## Self-Review

- **Spec coverage:** §1 editor kind → T1; EditorService session → T2; router tier → T3; §4 composition swap → T4; §3 commands → T5; built-ins → T6; §5 UI → T7; §6 tests → T8/T9; bookkeeping → T10. All sections mapped.
- **Placeholder scan:** real code in the algorithmic tasks (parseEditor, EditorService, composeEditorPrompt, command parsing); content/frontend/test tasks give exact contracts + "read file first to match conventions" (deliberate, mirroring existing components). No TBD/TODO.
- **Type consistency:** `LibraryEditor{name,systemPrompt,model?,temperature?}`, `parseEditor`, `EditorService`/`ActiveEditor{editor,withBook}`, `getChannelEditor`/`setChannelEditor`/`clearChannelEditor`, `composeEditorPrompt`, `editor_chat`, `'editor'` kind used consistently across tasks.
