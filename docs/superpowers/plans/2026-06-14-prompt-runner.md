# Prompt Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run curated writing-craft prompts (a new `prompt` library kind) one-at-a-time against a book's `data/` files, with a preview-first Run → Replace (diff + versioned) / Save-as / Discard flow and per-file restore.

**Architecture:** A `prompt` JSON library kind (mirrors `editor`); a pure `runPrompt` runner over the AI router; a pure `file-versions` helper + write-back/restore routes on book files; a studio Prompt Runner route. Five-ish backend files + a frontend route, mirroring the just-shipped Editors feature.

**Tech Stack:** Node 22 + TS (`tsx`, NodeNext, `.js` imports), Express, React/Vite studio, `node --test`, bash smoke tests.

**Spec:** `docs/superpowers/specs/2026-06-14-prompt-runner-design.md`

**Commit policy:** No per-task `git commit` (repo uses `commit_message` + `./push.sh`). Verify each step; commit once at the end.

**Verify baseline:** `npx tsc --noEmit` (0), `node --import tsx --test tests/unit/*.test.ts`, `npm run build:frontend`, `npm run test:api`, `npm run test:smoke`.

**Parallel chunks (after Phase 1):** Phase 2 (run + write-back backend), Phase 3 (built-in prompts), Phase 4 (frontend) are file-disjoint. Phase 1 is the shared foundation; Phase 5 is integration.

---

## Phase 1 — Foundation: `prompt` kind + `file-versions` + router tier

### Task 1: `parsePrompt` + `prompt` library kind

**Files:** Create `gateway/src/services/prompt-parse.ts`; Test `tests/unit/prompt-parse.test.ts`; Modify `gateway/src/services/library-types.ts`, `gateway/src/services/library.ts`, `frontend/shared/src/types.ts`

- [ ] **Step 1: failing test** (`tests/unit/prompt-parse.test.ts`):
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePrompt } from '../../gateway/src/services/prompt-parse.ts';
test('parsePrompt accepts a valid prompt', () => {
  const p = parsePrompt({ name: 'copy-editor', label: 'Copy Editor', description: 'd', systemPrompt: 'You are a copy editor.', temperature: 0.4 });
  assert.equal(p.name, 'copy-editor');
  assert.equal(p.systemPrompt, 'You are a copy editor.');
  assert.equal(p.schemaVersion, 1);
  assert.equal(p.temperature, 0.4);
});
test('parsePrompt rejects empty + clamps temperature', () => {
  assert.throws(() => parsePrompt({ name: '', systemPrompt: 'x' }));
  assert.throws(() => parsePrompt({ name: 'x', systemPrompt: '' }));
  assert.equal(parsePrompt({ name: 'x', systemPrompt: 'y', temperature: 9 }).temperature, 2);
});
```
- [ ] **Step 2:** `node --import tsx --test tests/unit/prompt-parse.test.ts` → FAIL.
- [ ] **Step 3: implement `prompt-parse.ts`** (identical shape to `editor-parse.ts`):
```ts
import type { LibraryPrompt } from './library-types.js';
export function parsePrompt(raw: unknown): LibraryPrompt {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const systemPrompt = typeof o.systemPrompt === 'string' ? o.systemPrompt.trim() : '';
  if (!name) throw new Error('prompt.name is required');
  if (!systemPrompt) throw new Error('prompt.systemPrompt is required');
  const out: LibraryPrompt = { schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : 1, name, systemPrompt };
  if (typeof o.label === 'string') out.label = o.label;
  if (typeof o.description === 'string') out.description = o.description;
  if (typeof o.model === 'string' && o.model.trim()) out.model = o.model.trim();
  if (typeof o.temperature === 'number') out.temperature = Math.max(0, Math.min(2, o.temperature));
  return out;
}
```
- [ ] **Step 4:** `library-types.ts`: add `'prompt'` to `LIBRARY_KINDS`; add the `LibraryPrompt` interface (`{ schemaVersion?, name, label?, description?, systemPrompt, model?, temperature? }`).
- [ ] **Step 5:** `frontend/shared/src/types.ts`: add `'prompt'` to the `LibraryKind` union; add a `LibraryPrompt` interface + `prompt?: LibraryPrompt` on `LibraryEntryFull` (mirror the `editor` additions already there).
- [ ] **Step 6:** `library.ts`: register `prompt` mirroring `editor` **exactly** (read every `editor` site: `FILE_KINDS`, `DIR_LAYOUT.prompt='prompts'`, `LibraryEntryFull.prompt?`, overlayPath `<name>.json` guard, `writeEntry` branch via `parsePrompt(JSON.parse(raw))`, `loadKind` branch via `parsePrompt({...JSON,name})` → `{ ..., prompt }`). Import `parsePrompt`.
- [ ] **Step 7:** test → PASS; `npx tsc --noEmit` → 0 (any exhaustive-`Record<LibraryKind>` gaps in frontend studio files are Phase 4's — list them if they appear).

### Task 2: `file-versions` helper

**Files:** Create `gateway/src/services/file-versions.ts`; Test `tests/unit/file-versions.test.ts`

- [ ] **Step 1: failing test** (`tests/unit/file-versions.test.ts`) — use `mkdtempSync(os.tmpdir())` as the dataDir. Assert: first `writeWithVersion(dir,'a.md','v1')` creates `a.md` with no version (no prior); second `writeWithVersion(dir,'a.md','v2')` snapshots `v1` into `.versions/a.md/` → `listVersions` length 1 with the `v1` bytes; `restoreVersion(dir,'a.md', <id>)` restores `v1` content AND snapshots `v2` first (so `listVersions` length is now 2). A brand-new filename writes with zero versions.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: implement `file-versions.ts`:**
```ts
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const vdir = (dataDir: string, filename: string) => join(dataDir, '.versions', filename);

async function snapshot(dataDir: string, filename: string): Promise<void> {
  const src = join(dataDir, filename);
  if (!existsSync(src)) return;
  const dir = vdir(dataDir, filename);
  await mkdir(dir, { recursive: true });
  const prior = await readFile(src, 'utf-8');
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + Math.random().toString(36).slice(2, 6);
  await writeFile(join(dir, `${id}.md`), prior, 'utf-8');
}

export async function writeWithVersion(dataDir: string, filename: string, content: string): Promise<void> {
  await snapshot(dataDir, filename);
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, filename), content, 'utf-8');
}
export async function listVersions(dataDir: string, filename: string): Promise<Array<{ id: string; at: string; bytes: number }>> {
  const dir = vdir(dataDir, filename);
  if (!existsSync(dir)) return [];
  const out: Array<{ id: string; at: string; bytes: number }> = [];
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.md')) continue;
    const st = await stat(join(dir, f));
    out.push({ id: f.replace(/\.md$/, ''), at: st.mtime.toISOString(), bytes: st.size });
  }
  return out.sort((a, b) => b.id.localeCompare(a.id)); // newest first
}
export async function restoreVersion(dataDir: string, filename: string, id: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('invalid version id');
  const vfile = join(vdir(dataDir, filename), `${id}.md`);
  if (!existsSync(vfile)) throw new Error('version not found');
  const content = await readFile(vfile, 'utf-8');
  await snapshot(dataDir, filename); // current snapshotted so a restore is itself undoable
  await writeFile(join(dataDir, filename), content, 'utf-8');
}
```
- [ ] **Step 4:** Run → PASS.

### Task 3: `prompt_run` router task type + hide `.versions` from listFiles

**Files:** Modify `gateway/src/ai/router.ts`, `gateway/src/services/book.ts` (`listFiles`)

- [ ] **Step 1:** `router.ts`: add `prompt_run` to `TASK_TIERS` (tier `mid`) and `TASK_OUTPUT_BUDGET` (16000 — match `creative_writing`/`book_bible`'s 16K so a chapter rewrite isn't truncated).
- [ ] **Step 2:** `book.ts` `listFiles`: read it and ensure it skips the `.versions` dir and dotfiles (so version sidecars don't appear in the file picker). If it already returns only files (not dirs), add an explicit `name !== '.versions' && !name.startsWith('.')` filter.
- [ ] **Step 3:** `npx tsc --noEmit` → 0.

---

## Phase 2 — Backend: run endpoint + file write-back (depends on Phase 1)

### Task 4: `runPrompt` + `POST /api/prompts/run`

**Files:** Create `gateway/src/services/prompt-runner.ts`, `gateway/src/api/routes/prompts.routes.ts`; Test `tests/unit/prompt-runner.test.ts`; Modify the route registrar (`gateway/src/api/routes.ts` or wherever `mount*` files are wired) to mount `mountPrompts`.

- [ ] **Step 1: failing test** (`tests/unit/prompt-runner.test.ts`): a fake `aiRouter.complete` records the request and returns `{ text: 'OUT', tokensUsed: 10, estimatedCost: 0.001 }`; a stub `prompts.get` returns `{ name:'p', systemPrompt:'SYS' }` for `'p'`. Assert `runPrompt({prompts, aiRouter}, 'p', 'INPUT')` → `{ text:'OUT' }`, the captured request `.system==='SYS'` and `.messages[0].content==='INPUT'`; `runPrompt(..., 'missing', 'x')` → null.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: implement `prompt-runner.ts`:**
```ts
import type { LibraryPrompt } from './library-types.js';
export async function runPrompt(
  deps: {
    prompts?: { get(name: string): LibraryPrompt | null };
    aiRouter: { selectProvider?(t: string, p?: string): { id: string }; complete(req: any): Promise<{ text: string; tokensUsed?: number; estimatedCost?: number }> };
    costs?: { record(provider: string, tokens: number, estimatedCost?: number, bookSlug?: string): void };
  },
  promptName: string, content: string, bookSlug?: string,
): Promise<{ text: string } | null> {
  const prompt = deps.prompts?.get(promptName) ?? null;
  if (!prompt) return null;
  const provider = deps.aiRouter.selectProvider?.('prompt_run', prompt.model ? 'openrouter' : undefined) ?? { id: 'openrouter' };
  const model = prompt.model && provider.id === 'openrouter' ? prompt.model : undefined;
  const res = await deps.aiRouter.complete({
    provider: provider.id,
    system: prompt.systemPrompt,
    messages: [{ role: 'user', content }],
    maxTokens: 16000,
    ...(model ? { model } : {}),
    ...(typeof prompt.temperature === 'number' ? { temperature: prompt.temperature } : {}),
  });
  try { deps.costs?.record(provider.id, res.tokensUsed ?? 0, res.estimatedCost, bookSlug); } catch { /* non-fatal */ }
  return { text: res.text };
}
```
- [ ] **Step 4: implement `prompts.routes.ts`** (a `mountPrompts(app, gateway, baseDir)` mirroring other route files; read another small route file for the exact signature + how `services` is obtained):
```ts
import type { Application, Request, Response } from 'express';
import { runPrompt } from '../../services/prompt-runner.js';
export function mountPrompts(app: Application, gateway: any): void {
  const services = gateway.getServices();
  app.post('/api/prompts/run', async (req: Request, res: Response) => {
    const { prompt, content, bookSlug } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt) return res.status(400).json({ error: 'prompt required' });
    if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'content required' });
    if (content.length > 100000) return res.status(400).json({ error: 'content too long (max 100k chars)' });
    try {
      const out = await runPrompt(
        { prompts: { get: (n: string) => services.library.get('prompt', n)?.prompt ?? null }, aiRouter: services.aiRouter, costs: services.costs },
        prompt, content, typeof bookSlug === 'string' ? bookSlug : undefined,
      );
      if (out === null) return res.status(404).json({ error: 'Unknown prompt' });
      res.json({ output: out.text });
    } catch (err: any) {
      res.status(500).json({ error: 'Prompt run failed: ' + String(err?.message || err) });
    }
  });
}
```
- [ ] **Step 5:** Wire `mountPrompts(app, gateway)` into the route registrar next to the other `mount*` calls (read `gateway/src/api/routes.ts` to match the call pattern + import).
- [ ] **Step 6:** unit test → PASS; `npx tsc --noEmit` → 0.

### Task 5: file write-back + versions + restore routes

**Files:** Modify `gateway/src/api/routes/books.routes.ts`

- [ ] **Step 1:** Import `writeWithVersion, listVersions, restoreVersion` from `../../services/file-versions.js`. After the existing `GET /api/books/:slug/files/:filename` route, add three routes, each guarded with `SLUG_RE` + `dataDirOf(slug)` (404 if null) + `safePath(dataDir, filename)` (403 if null) exactly like the read route:
```ts
app.put('/api/books/:slug/files/:filename', async (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
  const dataDir = services.books.dataDirOf(slug);
  if (!dataDir) return res.status(404).json({ error: 'Book not found' });
  const filename = String(req.params.filename);
  if (!safePath(dataDir, filename)) return res.status(403).json({ error: 'Path traversal blocked' });
  const { content } = req.body ?? {};
  if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
  await writeWithVersion(dataDir, filename, content);
  res.json({ ok: true });
});
app.get('/api/books/:slug/files/:filename/versions', async (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
  const dataDir = services.books.dataDirOf(slug);
  if (!dataDir) return res.status(404).json({ error: 'Book not found' });
  const filename = String(req.params.filename);
  if (!safePath(dataDir, filename)) return res.status(403).json({ error: 'Path traversal blocked' });
  res.json({ versions: await listVersions(dataDir, filename) });
});
app.post('/api/books/:slug/files/:filename/restore', async (req: Request, res: Response) => {
  const slug = String(req.params.slug);
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
  const dataDir = services.books.dataDirOf(slug);
  if (!dataDir) return res.status(404).json({ error: 'Book not found' });
  const filename = String(req.params.filename);
  if (!safePath(dataDir, filename)) return res.status(403).json({ error: 'Path traversal blocked' });
  const { id } = req.body ?? {};
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id required' });
  try { await restoreVersion(dataDir, filename, id); res.json({ ok: true }); }
  catch (err: any) { res.status(404).json({ error: String(err?.message || err) }); }
});
```
- [ ] **Step 2:** `npx tsc --noEmit` → 0. (Round-trip covered by the api-test in Phase 5.)

---

## Phase 3 — Built-in prompts (content) — depends only on the Task-1 schema

### Task 6: Author the curated built-in prompts

**Files:** Create `library/prompts/<name>.json` (a curated, de-duplicated subset)

- [ ] **Step 1:** From `~/data/Writing/AI-Tools/OpenRouter-Interface/prompts/*.json` (+ `config/prompts_registry.yaml` for titles/enabled), pick ~12–15 DISTINCT, high-value writing-craft prompts (skip near-duplicates like the 3–4 dialogue variants — keep one; skip generator/code prompts that don't suit file editing). For each, write `library/prompts/<slug>.json` = `{ schemaVersion:1, name, label, description, systemPrompt }`, where `systemPrompt` is a coherent flattening of the source `persona` + `instructions` + structured guidance, ending with a clear instruction to return either the revised text or the analysis. Slugs lowercase-hyphen.
- [ ] **Step 2:** Each must `parsePrompt`-validate:
```bash
for f in library/prompts/*.json; do node --import tsx -e 'import("./gateway/src/services/prompt-parse.ts").then(m=>{m.parsePrompt(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")));console.log(process.argv[1],"ok")})' "$f"; done
```
List which source prompts were imported vs skipped (and why).

---

## Phase 4 — Frontend (depends on Task-1 shared type + Phase-2 endpoints)

### Task 7: Prompt Runner route + Asset Studio `prompt` kind

**Files:** Create `frontend/studio/src/routes/PromptRunner.tsx` (+ a `.module.css`), `frontend/studio/src/components/asset/PromptEditor.tsx`; Modify `frontend/studio/src/lib/glossary.ts`, `frontend/studio/src/components/asset/EntryList.tsx`, `frontend/studio/src/components/asset/KindRail.tsx`, `frontend/studio/src/routes/AssetStudio.tsx`, `frontend/studio/src/routes/NewBook.tsx`, the Rail/router (add the route + nav entry)

- [ ] **Step 1:** Add `prompt` to the exhaustive `Record<LibraryKind,…>` maps (the kind-widening forces these or the build fails): `GLOSSARY` (glossary.ts; label "Prompt", def "A reusable writing-craft prompt you run against a book file"), `KIND_LABELS`/`WRITABLE_KINDS` + a `STARTER_PROMPT_JSON` in `EntryList.tsx`, a `KindRail` item, the `NewBook.tsx` map key. Mirror exactly how the `editor` kind was added (read those diffs/files).
- [ ] **Step 2:** Create `PromptEditor.tsx` (mirror `EditorEditor.tsx`: reads `entry.prompt` first then `entry.content`; renders label/description/model/temperature + a `systemPrompt` textarea; saves via the library write path). Render it in `AssetStudio.tsx` when `kind === 'prompt'`.
- [ ] **Step 3:** Create `PromptRunner.tsx` — the route: a file picker (`GET /api/books/:slug/files` for the active book via `useActiveBook`), a prompt picker (`GET /api/library?kind=prompt`), a **Run** button (`POST /api/prompts/run { prompt, content: <selected file text via GET /api/books/:slug/files/:name>, bookSlug }`), an output pane, and three actions: **Replace** (show an original-vs-output diff — a simple line-level side-by-side or a unified text diff is fine for v1; on confirm `PUT /api/books/:slug/files/:name { content: output }`), **Save as new file** (prompt for a name → `PUT` to that name), **Discard**. A **Version history** panel: `GET …/versions` with a **Restore** button (`POST …/restore { id }`). Read an existing route (e.g. `Files.tsx`) for the active-book + api() conventions.
- [ ] **Step 4:** Add a Rail nav entry + route registration for `/prompt-runner` (read `Rail.tsx` + the router setup to match how `Files`/`Write` are registered).
- [ ] **Step 5:** `npm run build:frontend` → clean.

---

## Phase 5 — Tests, smoke, integration

### Task 8: API-test round-trip

**Files:** Modify `tests/api/api-test.sh`

- [ ] **Step 1:** Add (match existing helper style): `body_has "/api/library?kind=prompt" '"<a-built-in-name>"' "library lists a built-in prompt"`. Then a write-back round-trip: create a book (`sequence:'novel'` like the existing sequence test), `PUT /api/books/:slug/files/probe.md {content:"v1"}`, `PUT` again `{content:"v2"}`, `GET …/probe.md/versions` → asserts a version exists, `POST …/probe.md/restore {id:<that id>}` → 200, then `DELETE` the book to clean up. (Reuse the book-slug extraction from the existing sequence assertion.)
- [ ] **Step 2:** `bash -n tests/api/api-test.sh` → OK.

### Task 9: Real-AI prompt-runner smoke

**Files:** Create `tests/prompt-runner-smoke.sh` (model on `tests/editors-smoke.sh` / `spend-smoke.sh` helpers)

- [ ] **Step 1:** Script: create a book; `PUT` a small `data/` file (a few sentences of prose); `POST /api/prompts/run { prompt:<a built-in>, content:<the prose>, bookSlug }` → assert non-empty output, not `[AI provider failure]`; `PUT` the output back to the file; `GET …/versions` → assert ≥1 version exists (the prior content was snapshotted); clean up (DELETE the book). Force OpenRouter where needed; self-clean.
- [ ] **Step 2:** `bash -n tests/prompt-runner-smoke.sh` → OK.

### Task 10: Bookkeeping

**Files:** Modify `docs/TODO.md`, `docs/COMPLETED.md`

- [ ] Move the "Prompt Runner" item from `docs/TODO.md` to `docs/COMPLETED.md` (2026-06-14), preserving the bullet.

### Task INT1: Full verify + review + deploy (integrator)
- [ ] `npx tsc --noEmit` 0; `node --import tsx --test tests/unit/*.test.ts` all pass; `npm run build:frontend` clean; `npm run test:api` pass (incl. prompt assertions); `npm run test:smoke` pass.
- [ ] `/code-review` (high) over the diff; fix every medium+ finding; re-verify.
- [ ] Write `commit_message`; `touch build_now`; after redeploy run `BASE_URL=http://192.168.1.32:3847 tests/prompt-runner-smoke.sh`; fix anything it surfaces.

---

## Self-Review

- **Spec coverage:** §1 prompt kind → T1; §2 run → T3(tier)+T4; §3 versioning → T2+T5; §4 UI → T7; §5 testing → T8/T9; built-ins → T6; bookkeeping → T10. All mapped.
- **Placeholder scan:** real code in the algorithmic tasks (parsePrompt, file-versions, runPrompt, routes); content/frontend give exact contracts + "read file first to mirror the editor kind." No TBD/TODO.
- **Type consistency:** `LibraryPrompt{name,systemPrompt,model?,temperature?}`, `parsePrompt`, `runPrompt`, `writeWithVersion`/`listVersions`/`restoreVersion`, `prompt_run`, `'prompt'` kind, `POST /api/prompts/run`, `PUT /api/books/:slug/files/:filename` used consistently across tasks.
