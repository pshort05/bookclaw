# World Binding + Per-Book Bible Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-book world binding usable end-to-end — bind a book to a world (at creation, or an existing book), auto-build a starting bible via relevance-pull, re-curate, and unbind — through the studio UI and a clean API, with no storage-model change.

**Architecture:** A single server-side orchestration helper (`bindBookWorld`) runs relevance-pull → cap → `snapshotWorldDocs`, atomically setting `pulledFrom.world` + `worldDocs`. Two new routes (`PUT`/`DELETE /api/books/:slug/world`) and the `POST /api/books` create handler call it. The studio gains a book-page World control + a series default-world control, and the broken `saveWorldDocs` client is fixed to send the world the backend already requires.

**Tech Stack:** Node 22+ / TypeScript via `tsx` (no dev compile step); Express + Socket.IO backend; React (Vite) studio under `frontend/studio/`; tests via `node --import tsx --test` (unit) and bash smoke scripts.

**Spec:** `docs/superpowers/specs/2026-06-22-world-binding-design.md`.

## Global Constraints

- **Node 22+**; TypeScript runs through `tsx`. Type-check with `npx tsc --noEmit`.
- **Imports use `.js` extensions** even from `.ts` source (NodeNext). Match this in every new file.
- **No new runtime dependency.**
- **No schema bump.** `BOOK_SCHEMA_VERSION` stays `2`; `pulledFrom.world` + `worldDocs` are existing optional fields. Per-book writes are schema-gated through `assertWritable`.
- **Fail-soft.** Services log `  ✓ … / ⚠ … / ℹ …` and degrade rather than crash. A world-bind failure during book creation must **not** fail the creation — log `⚠` and continue.
- **Commit workflow.** This repo uses a `commit_message` + `./push.sh` workflow — the maintainer commits. **Do NOT run `git commit` / `git push`.** Each task ends at a verified, type-checking state (tests green + `npx tsc --noEmit` clean + `npm run build:frontend` green for frontend tasks). At plan end, write the one-line-summary-plus-dashes `commit_message` per `CLAUDE.md`. This overrides the writing-plans skill's literal `git commit` steps — the "Checkpoint" step in each task replaces "Commit".
- **Surgical changes**; match existing route/service/UI patterns. Professional Markdown, no emojis/icons.
- **AUTO_PROPOSE_CAP = 15** — the cap on auto-proposed initial bible docs.

---

## File Structure

- `gateway/src/api/routes/world-bind.ts` — **NEW.** `bindBookWorld(services, slug, worldName)` + `unbindBookWorld(services, slug)` + `AUTO_PROPOSE_CAP`. The shared orchestration both the new routes and the create handler call.
- `gateway/src/services/book.ts` — **MODIFY.** Add `clearWorld(slug)` (unbind: remove `templates/world/` + `.baseline/world/`, clear `pulledFrom.world` + `worldDocs`).
- `gateway/src/api/routes/worlds.routes.ts` — **MODIFY.** Add `PUT` + `DELETE /api/books/:slug/world`.
- `gateway/src/api/routes/books.routes.ts` — **MODIFY.** Resolve `body.world ?? series.world` and bind after create.
- `frontend/studio/src/lib/worldApi.ts` — **MODIFY.** Fix `saveWorldDocs` to send `{ world, docIds }`; add `bindBookWorld`/`unbindBookWorld` clients.
- `frontend/studio/src/components/book/BuildBiblePanel.tsx` — **MODIFY.** Pass the bound world to `saveWorldDocs` (via a `world` prop).
- `frontend/studio/src/components/book/WorldBindControl.tsx` — **NEW.** Book-page Bind / Change / Unbind control; wired into the book detail view.
- `frontend/studio/src/components/series/SeriesWorldRef.tsx` (or the existing series settings surface) — **NEW/MODIFY.** Set the series default world via `PUT /api/series/:id/refs`.
- `tests/unit/world-bind-orchestration.test.ts` — **NEW.** Unit tests for `bindBookWorld` + `clearWorld` (separate from the existing `world-binding.test.ts`, which covers the engine).
- `tests/world-binding-smoke.sh` — **NEW.** End-to-end route/UX smoke, mirroring `tests/world-crud-smoke.sh`.

---

### Task 1: Bind/unbind orchestration helper + `BookService.clearWorld`

The testable core. `bindBookWorld` runs relevance-pull (capped) then `snapshotWorldDocs`; `clearWorld` removes the snapshot and clears the manifest fields.

**Files:**
- Create: `gateway/src/api/routes/world-bind.ts`
- Modify: `gateway/src/services/book.ts` (add `clearWorld`, near `snapshotWorldDocs` ~line 913)
- Test: `tests/unit/world-bind-orchestration.test.ts`

**Interfaces:**
- Consumes:
  - `WorldService.proposeWorldDocs(slug, signals, worldName, ai): Promise<Array<{docId,title,rank,reason}>>` (`gateway/src/services/world.ts:137`)
  - `WorldService.getConfig(name)`, `WorldService.getDocument(name, docId)`
  - `BookService.open(slug)`, `BookService.worldbuildingOf(slug)`, `BookService.snapshotWorldDocs(slug, {name,source}, docIds, getConfigRaw, getDocSerialized)` (`book.ts:867`)
  - `serializeWorldDoc(meta, body)` (`gateway/src/services/world-parse.ts:135`)
  - `services.aiRouter.complete(req)`, `services.aiRouter.selectProvider(taskType)`
  - `services.library.get('world', name)?.source`
- Produces:
  - `export const AUTO_PROPOSE_CAP = 15;`
  - `export interface BindResult { world: string; worldDocs: string[]; proposed: number; }`
  - `export async function bindBookWorld(services: any, slug: string, worldName: string): Promise<BindResult>`
  - `export async function unbindBookWorld(services: any, slug: string): Promise<boolean>`
  - `BookService.clearWorld(slug: string): Promise<boolean>`

- [ ] **Step 1: Add `clearWorld` to `BookService`** (after `snapshotWorldDocs`, ~line 913). Reuses the already-imported `rm`, `join`, `writeFile`.

```ts
  /**
   * World binding: unbind a book's world. Removes templates/world/ + .baseline/world/,
   * clears pulledFrom.world + worldDocs, appends a `world-unbind` history entry.
   * Schema-gated via assertWritable (mirrors snapshotWorldDocs). Returns false if no book.
   */
  async clearWorld(slug: string): Promise<boolean> {
    await this.assertWritable(slug);
    const base = this.bookDir(slug);
    if (!base) throw new Error(`Invalid slug: ${slug}`);
    await rm(join(base, 'templates', 'world'), { recursive: true, force: true });
    await rm(join(base, '.baseline', 'world'), { recursive: true, force: true });
    const opened = await this.open(slug);
    if (!opened) return false;
    const m = opened.manifest;
    if (m.pulledFrom) m.pulledFrom.world = null;
    m.worldDocs = [];
    m.lastWrittenByApp = this.appVersion;
    m.history.push({ at: new Date().toISOString(), event: 'world-unbind' });
    await writeFile(join(base, 'book.json'), JSON.stringify(m, null, 2) + '\n', 'utf-8');
    return true;
  }
```

- [ ] **Step 2: Write the failing unit test.** Mirrors the `makeSvc`/`seedLibrary` harness from `tests/unit/book-baseline.test.ts`, plus seeds a world overlay and a stub aiRouter.

```ts
// tests/unit/world-bind-orchestration.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import { WorldService } from '../../gateway/src/services/world.js';
import { bindBookWorld, unbindBookWorld, AUTO_PROPOSE_CAP } from '../../gateway/src/api/routes/world-bind.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

function worldDoc(title: string, code: string): string {
  return `---\ntitle: ${title}\ntype: field-guide\nclassification: ${code}\nclearance: General Access\ndomain: GEO\ntags: [geo]\nsummary: ${title} summary\n---\n\nBODY ${title}\n`;
}

async function harness(root: string) {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', '# A\n\nsoul');
  write(builtin, 'authors/default/PERSONALITY.md', 'p');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 's');
  write(builtin, 'voices/default/VOICE-PROFILE.md', 'v');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  // World overlay in the workspace library: world.json + 20 docs (to exercise the cap).
  const wsLib = join(root, 'workspace', 'library');
  write(wsLib, 'worlds/test-world/world.json', JSON.stringify({
    schemaVersion: 1, name: 'test-world', label: 'Test World',
    documentTypes: [{ id: 'field-guide', label: 'Field Guide' }],
    domains: ['GEO'], clearanceLevels: ['General Access'],
    classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}', formatDirective: 'narrative only',
  }));
  for (let i = 1; i <= 20; i++) {
    const code = `fg-geo-${String(i).padStart(4, '0')}`;
    write(wsLib, `worlds/test-world/documents/${code}.md`, worldDoc(`Doc ${i}`, code.toUpperCase()));
  }
  const lib = new LibraryService(builtin, wsLib, fakeSkills);
  await lib.loadAll();
  const books = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await books.initialize();
  const world = new WorldService(lib, wsLib);
  // Stub router: force proposeWorldDocs into its fail-soft fallback (returns full catalog).
  const aiRouter = { complete: async () => { throw new Error('no ai in test'); }, selectProvider: () => ({ id: 'stub' }) };
  const services = { books, world, library: lib, aiRouter };
  return { services, books, world };
}

test('bindBookWorld sets pulledFrom.world + caps the auto-proposed bible', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bind-'));
  try {
    const { services, books } = await harness(root);
    const book = await books.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const res = await bindBookWorld(services, book.slug, 'test-world');
    assert.equal(res.world, 'test-world');
    assert.equal(res.worldDocs.length, AUTO_PROPOSE_CAP); // 20 docs in catalog, capped to 15
    const opened = await books.open(book.slug);
    assert.equal(opened!.manifest.pulledFrom.world!.name, 'test-world');
    assert.equal(opened!.manifest.worldDocs!.length, AUTO_PROPOSE_CAP);
    const bdir = join(root, 'workspace', 'books', book.slug);
    assert.ok(existsSync(join(bdir, 'templates', 'world', 'world.json')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('bindBookWorld throws on unknown world', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bind-'));
  try {
    const { services, books } = await harness(root);
    const book = await books.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await assert.rejects(() => bindBookWorld(services, book.slug, 'no-such-world'), /not found/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('unbindBookWorld clears pulledFrom.world + worldDocs + removes templates/world', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-bind-'));
  try {
    const { services, books } = await harness(root);
    const book = await books.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await bindBookWorld(services, book.slug, 'test-world');
    const ok = await unbindBookWorld(services, book.slug);
    assert.equal(ok, true);
    const opened = await books.open(book.slug);
    assert.equal(opened!.manifest.pulledFrom.world, null);
    assert.deepEqual(opened!.manifest.worldDocs, []);
    assert.ok(!existsSync(join(root, 'workspace', 'books', book.slug, 'templates', 'world')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 3: Run the test to verify it fails.**

Run: `node --import tsx --test tests/unit/world-bind-orchestration.test.ts`
Expected: FAIL — `Cannot find module '.../world-bind.js'`.

- [ ] **Step 4: Implement `gateway/src/api/routes/world-bind.ts`.**

```ts
import { serializeWorldDoc } from '../../services/world-parse.js';

/** Max docs auto-proposed into a book's initial bible at bind time (user trims). */
export const AUTO_PROPOSE_CAP = 15;

export interface BindResult { world: string; worldDocs: string[]; proposed: number; }

/**
 * Bind a book to a world: relevance-pull (capped) → snapshot as the initial bible.
 * snapshotWorldDocs sets pulledFrom.world + worldDocs atomically. Idempotent /
 * re-bindable (rm+rewrite of the snapshot). Throws on unknown world / unwritable book.
 */
export async function bindBookWorld(services: any, slug: string, worldName: string): Promise<BindResult> {
  const world = services.world;
  const books = services.books;
  if (!world || !books) throw new Error('World/Books service not initialized');
  if (!world.getConfig(worldName)) throw new Error(`World not found: ${worldName}`);

  const opened = await books.open(slug);
  if (!opened) throw new Error(`Book not found: ${slug}`);

  const signals = {
    title: opened.manifest.title,
    description: '',
    genre: opened.manifest.pulledFrom?.genre?.name ?? null,
    knownEntities: books.worldbuildingOf?.(slug) ?? '',
  };
  const ai = {
    complete: (r: any) => services.aiRouter.complete(r),
    select: (t: string) => services.aiRouter.selectProvider(t),
  };
  const proposals = await world.proposeWorldDocs(slug, signals, worldName, ai);
  const docIds = proposals.slice(0, AUTO_PROPOSE_CAP).map((p: any) => p.docId);

  const source = services.library?.get?.('world', worldName)?.source ?? 'workspace';
  const getConfigRaw = (n: string) => { const c = world.getConfig(n); return c ? JSON.stringify(c, null, 2) : null; };
  const getDocSerialized = (n: string, id: string) => { const d = world.getDocument(n, id); return d ? serializeWorldDoc(d.meta, d.body) : null; };

  const { written } = await books.snapshotWorldDocs(slug, { name: worldName, source }, docIds, getConfigRaw, getDocSerialized);
  return { world: worldName, worldDocs: written, proposed: proposals.length };
}

/** Unbind a book's world (clear binding + bible). Returns false if the book is gone. */
export async function unbindBookWorld(services: any, slug: string): Promise<boolean> {
  const books = services.books;
  if (!books) throw new Error('Books service not initialized');
  return books.clearWorld(slug);
}
```

- [ ] **Step 5: Run the test to verify it passes.**

Run: `node --import tsx --test tests/unit/world-bind-orchestration.test.ts`
Expected: PASS (3 tests). Then `npx tsc --noEmit` → clean.

- [ ] **Step 6: Checkpoint.** Tests green + `tsc` clean. Do **not** `git commit` (maintainer runs `./push.sh`).

---

### Task 2: `PUT` + `DELETE /api/books/:slug/world` routes

Expose the helper. Bind on `PUT`, unbind on `DELETE`. Behavior is covered end-to-end by the smoke test (Task 7); this task wires and type-checks.

**Files:**
- Modify: `gateway/src/api/routes/worlds.routes.ts` (add two handlers inside `mountWorlds`; import the helper)

**Interfaces:**
- Consumes: `bindBookWorld`, `unbindBookWorld` (Task 1); `SLUG_RE` (already imported at `worlds.routes.ts:2`); `services.books.exists(slug)`.
- Produces: routes `PUT /api/books/:slug/world` → `{ world, worldDocs, proposed }`; `DELETE /api/books/:slug/world` → `{ unbound: boolean }`.

- [ ] **Step 1: Add the import** at the top of `worlds.routes.ts`:

```ts
import { bindBookWorld, unbindBookWorld } from './world-bind.js';
```

- [ ] **Step 2: Add the two handlers** inside `mountWorlds`, after the existing `/api/books/:slug/world/docs` handler:

```ts
  // Bind a book to a world: set pulledFrom.world + auto-propose the initial bible.
  app.put('/api/books/:slug/world', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    const worldName = req.body?.world;
    if (typeof worldName !== 'string' || !worldName) return res.status(400).json({ error: 'world (string) is required' });
    try {
      const result = await bindBookWorld(services, slug, worldName);
      res.json(result);
    } catch (err) {
      const msg = (err as Error)?.message || 'bind failed';
      res.status(/not found/i.test(msg) ? 404 : 400).json({ error: msg });
    }
  });

  // Unbind a book's world (clear binding + bible).
  app.delete('/api/books/:slug/world', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    try {
      const unbound = await unbindBookWorld(services, slug);
      res.json({ unbound });
    } catch (err) {
      res.status(400).json({ error: (err as Error)?.message || 'unbind failed' });
    }
  });
```

- [ ] **Step 3: Type-check.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Checkpoint.** `tsc` clean. Do not `git commit`.

---

### Task 3: Creation inheritance — bind on `POST /api/books`

Resolve `body.world ?? series.world`; if a world resolves, bind after the book is created. Fail-soft: a bind failure logs `⚠` and does not fail creation.

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts` (the `POST /api/books` handler — series-resolution block ~line 360, and the create-success block ~line 329)

**Interfaces:**
- Consumes: `bindBookWorld` (Task 1); `services.seriesBible.getSeries(id)` → `{ pulledFrom: { world?: { name } | null } }`; `services.world.getConfig(name)`.
- Produces: a book created with a world is bound (pulledFrom.world + worldDocs populated) before the response returns.

- [ ] **Step 1: Add the import** at the top of `books.routes.ts`:

```ts
import { bindBookWorld } from './world-bind.js';
```

- [ ] **Step 2: Capture the series default world.** In the `if (typeof body.series === 'string' && body.series)` block (where `seriesProvenance`/`seriesWorldbuilding` are set, ~line 360), add a `seriesWorldName` declared in the handler's outer scope alongside `seriesProvenance`:

```ts
    // near the other `let` declarations in the handler:
    let seriesWorldName = '';
    // inside the series block, after `seriesWorldbuilding = ...`:
    seriesWorldName = series.pulledFrom.world?.name ?? '';
```

- [ ] **Step 3: Bind after create.** In the `try { const manifest = await services.books.create(...)` block, after `if (seriesProvenance) await services.seriesBible?.addBook?.(...)` and before `res.json({ success: true, book: manifest })`:

```ts
      const worldName = (typeof body.world === 'string' && body.world) ? body.world : seriesWorldName;
      if (worldName && services.world?.getConfig?.(worldName)) {
        try {
          await bindBookWorld(services, manifest.slug, worldName);
        } catch (e) {
          console.log(`  ⚠ World bind on create failed for ${manifest.slug}: ${(e as Error)?.message || e}`);
        }
      }
```

- [ ] **Step 4: Type-check.**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Checkpoint.** `tsc` clean. Do not `git commit`. (End-to-end inheritance is asserted in Task 7's smoke.)

---

### Task 4: Fix the broken `saveWorldDocs` client + `BuildBiblePanel`

`saveWorldDocs` must send the `{ world, docIds }` the backend already requires. The panel learns the bound world via a prop.

**Files:**
- Modify: `frontend/studio/src/lib/worldApi.ts:33-34`
- Modify: `frontend/studio/src/components/book/BuildBiblePanel.tsx` (props + `save()`)

**Interfaces:**
- Produces: `saveWorldDocs(slug: string, world: string, docIds: string[])`; `BuildBiblePanel` gains a required `world: string` prop.

- [ ] **Step 1: Fix `saveWorldDocs`** in `worldApi.ts`:

```ts
export const saveWorldDocs = (slug: string, world: string, docIds: string[]) =>
  api<{ worldDocs: string[] }>(`/api/books/${encodeURIComponent(slug)}/world/docs`, { method: 'PUT', body: JSON.stringify({ world, docIds }) });
```

- [ ] **Step 2: Thread the world prop through `BuildBiblePanel`.** Add `world: string` to its props type, and update `save()`:

```ts
      await saveWorldDocs(slug, world, [...sel]);
```

Update the component's prop destructuring to include `world`, and update its single call site (the book detail view that renders `<BuildBiblePanel slug=… world=… />`) to pass the book's bound world (`manifest.pulledFrom?.world?.name`). If the call site lacks the manifest world, pass it down from there.

- [ ] **Step 3: Type-check + build.**

Run: `npx tsc --noEmit && npm run build:frontend`
Expected: both clean (the studio dist builds).

- [ ] **Step 4: Checkpoint.** `tsc` + `build:frontend` green. Do not `git commit`.

---

### Task 5: Book-page World control (Bind / Change / Unbind) + clients

A control on the book detail view that shows the current binding and lets the user bind to a world (defaulting to the series world), change it, or unbind. This is how the 20 existing books get bound.

**Files:**
- Modify: `frontend/studio/src/lib/worldApi.ts` (add bind/unbind clients)
- Create: `frontend/studio/src/components/book/WorldBindControl.tsx`
- Modify: the book detail view that renders book asset panels (wire `<WorldBindControl>` in; same view that renders `BuildBiblePanel`).

**Interfaces:**
- Consumes: `listWorlds()`, the book manifest (`pulledFrom.world?.name`, `series?.title`/series world), `PUT`/`DELETE /api/books/:slug/world`.
- Produces: `bindWorld(slug, world)`, `unbindWorld(slug)` clients; `WorldBindControl` component; on bind/unbind it refreshes the book view so `BuildBiblePanel` sees the new world.

- [ ] **Step 1: Add the clients** to `worldApi.ts`:

```ts
export const bindWorld = (slug: string, world: string) =>
  api<{ world: string; worldDocs: string[]; proposed: number }>(`/api/books/${encodeURIComponent(slug)}/world`, { method: 'PUT', body: JSON.stringify({ world }) });

export const unbindWorld = (slug: string) =>
  api<{ unbound: boolean }>(`/api/books/${encodeURIComponent(slug)}/world`, { method: 'DELETE' });
```

- [ ] **Step 2: Implement `WorldBindControl.tsx`.** A small panel: shows the bound world or "Not bound"; a world `<select>` (from `listWorlds()`, defaulting to the series world when present); a Bind/Change button calling `bindWorld`, and an Unbind button (shown when bound) calling `unbindWorld`. On success, call an `onChanged` callback so the parent re-fetches the book (so the bible panel updates). Mirror the styling/structure of an existing small book panel (e.g. the genre/asset row). Disable buttons while the request is in flight; surface errors inline (match `BuildBiblePanel`'s error pattern).

```tsx
import { useEffect, useState } from 'react';
import { listWorlds, bindWorld, unbindWorld, type WorldListRow } from '../../lib/worldApi.js';

export function WorldBindControl({ slug, boundWorld, seriesWorld, onChanged }: {
  slug: string; boundWorld?: string | null; seriesWorld?: string | null; onChanged: () => void;
}) {
  const [worlds, setWorlds] = useState<WorldListRow[]>([]);
  const [sel, setSel] = useState<string>(boundWorld ?? seriesWorld ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { listWorlds().then(setWorlds).catch(() => {}); }, []);
  async function doBind() {
    if (!sel || busy) return; setBusy(true); setError(null);
    try { await bindWorld(slug, sel); onChanged(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function doUnbind() {
    if (busy) return; setBusy(true); setError(null);
    try { await unbindWorld(slug); onChanged(); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return (
    <div>
      <div>World: <b>{boundWorld || 'Not bound'}</b></div>
      <select value={sel} onChange={(e) => setSel(e.target.value)} disabled={busy}>
        <option value="">(choose a world)</option>
        {worlds.map((w) => <option key={w.name} value={w.name}>{w.label || w.name}</option>)}
      </select>
      <button onClick={doBind} disabled={busy || !sel}>{boundWorld ? 'Change + rebuild bible' : 'Bind + build bible'}</button>
      {boundWorld && <button onClick={doUnbind} disabled={busy}>Unbind</button>}
      {error && <div role="alert">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the book detail view** next to `BuildBiblePanel`, passing `slug`, `boundWorld={manifest.pulledFrom?.world?.name}`, `seriesWorld` (the book's series default world, if resolvable), and an `onChanged` that re-fetches the book manifest.

- [ ] **Step 4: Type-check + build.**

Run: `npx tsc --noEmit && npm run build:frontend`
Expected: both clean.

- [ ] **Step 5: Checkpoint.** Green. Do not `git commit`.

---

### Task 6: Series default-world control

Let the user set a series' default world so new books in the series inherit it.

**Files:**
- Create/Modify: a series settings surface in `frontend/studio/src/components/series/` (follow how author/voice/genre series refs are set), using `PUT /api/series/:id/refs`.
- Modify: `frontend/studio/src/lib/` series API client if a refs setter doesn't already exist (mirror the existing author/voice/genre ref calls).

**Interfaces:**
- Consumes: `PUT /api/series/:id/refs` (the `world` ref kind already exists server-side); `listWorlds()`.
- Produces: a series-settings control that sets `series.pulledFrom.world`.

- [ ] **Step 1: Confirm the existing series-refs client.** Find where the studio sets a series' author/voice/genre ref (search `'/api/series/'` + `refs` in `frontend/studio/src`). If a generic `setSeriesRef(id, kind, name)` exists, reuse it with `kind: 'world'`; otherwise add one mirroring the existing call.

- [ ] **Step 2: Add a world picker to the series settings UI** alongside the existing author/voice/genre pickers, sourced from `listWorlds()`, writing via the refs client. Match the existing pickers' structure/styling.

- [ ] **Step 3: Type-check + build.**

Run: `npx tsc --noEmit && npm run build:frontend`
Expected: both clean.

- [ ] **Step 4: Checkpoint.** Green. Do not `git commit`.

---

### Task 7: End-to-end smoke test + final verification

A hermetic smoke that boots the gateway and exercises bind/curate/inherit/unbind over HTTP, mirroring `tests/world-crud-smoke.sh`.

**Files:**
- Create: `tests/world-binding-smoke.sh` (model on `tests/world-crud-smoke.sh`: boot the gateway on a free port with auth via env, `set -e`, helper `req()` wrapping `curl` with the bearer token, cleanup trap that kills the server; `-v` streams the server log)

**Interfaces:**
- Consumes: the running gateway's `/api/worlds`, `/api/library`, `/api/series`, `/api/books`, and the new `/api/books/:slug/world` routes.

- [ ] **Step 1: Write the smoke script.** Phases (assert HTTP codes + JSON fields with `node -e` parsing, as `world-crud-smoke.sh` does):
  1. **Seed:** create a `world` (POST a `world.json` via the library API or copy a fixture into the workspace library overlay, then reload) with ≥3 documents; create a series; create a book in the series.
  2. **Bind existing book:** `PUT /api/books/<slug>/world {world}` → assert `200`, `worldDocs.length >= 1`, and `GET /api/books/<slug>` shows `pulledFrom.world.name`.
  3. **Re-curate:** `PUT /api/books/<slug>/world/docs {world, docIds:[oneId]}` → assert `200` and `worldDocs == [oneId]` (confirms the fixed save contract).
  4. **Series inheritance:** set the series world via `PUT /api/series/:id/refs {kind:'world', name}`; create a second book in the series with no explicit world; assert it comes back with `pulledFrom.world.name` set.
  5. **Override:** create a third book with an explicit different/`none` world and assert the binding matches the override, not the series default.
  6. **Unbind:** `DELETE /api/books/<slug>/world` → assert `200 {unbound:true}` and `GET` shows `pulledFrom.world == null`, `worldDocs == []`.
  Non-destructive and self-contained (binds loopback, supplies token via env, kills the server on exit).

- [ ] **Step 2: Run the smoke.**

Run: `bash tests/world-binding-smoke.sh`
Expected: all phases PASS.

- [ ] **Step 3: Full regression.**

Run: `npm run test:unit && npx tsc --noEmit && npm run build:frontend`
Expected: unit suite green (including the existing `world-binding.test.ts` and the new `world-bind-orchestration.test.ts`), `tsc` clean, frontend builds.

- [ ] **Step 4: Move the TODO item to COMPLETED.** Per `CLAUDE.md`: cut the "World binding + per-book bible wiring" bullet from `docs/TODO.md` and add it to `docs/COMPLETED.md` with a `2026-…` completion date and a one-line summary.

- [ ] **Step 5: Write `commit_message`** (one-line summary + dash detail lines covering the helper, routes, create inheritance, the `saveWorldDocs` fix, the UI controls, and the tests). Do **not** `git commit` — the maintainer runs `./push.sh`.

---

## Self-Review

**Spec coverage.**
- Decision 1 (series default + per-book override): Task 3 (creation inheritance from `series.world`), Task 5 (per-book bind/change/unbind override), Task 6 (set series default). ✓
- Decision 2 (blob + world docs both inject): no code change — already true (`world-binding.test.ts` covers `worldGuide` concat); the smoke's bound book exercises both. ✓
- Decision 3 (auto-propose on bind, capped): Task 1 (`bindBookWorld` + `AUTO_PROPOSE_CAP`, tested). ✓
- Decision 4 (dedicated endpoint): Task 2 (`PUT`/`DELETE /api/books/:slug/world`). ✓
- Gap 1 (bind at creation): Task 3. ✓ Gap 2 (`saveWorldDocs` missing world): Task 4. ✓ Gap 3 (propose chicken-and-egg): Task 1 calls `proposeWorldDocs` with the explicit `worldName`, no pre-binding. ✓ Gap 4 (bind existing book): Tasks 2 + 5. ✓
- Unbind (spec API table): Task 1 (`clearWorld`/`unbindBookWorld`) + Task 2 (`DELETE`). ✓
- No-schema-change: confirmed — only existing optional fields written. ✓

**Placeholder scan.** No "TBD"/"add error handling"/"similar to Task N". Frontend Tasks 5/6 reference existing call sites by search term rather than line number because the studio book/series view files aren't pinned here; each gives the concrete component code and the exact wiring instruction. The unit-test code, helper, routes, and create-handler edits are complete and literal.

**Type consistency.** `bindBookWorld(services, slug, worldName): Promise<BindResult>` and `unbindBookWorld(services, slug): Promise<boolean>` are used identically in Tasks 1/2/3. `saveWorldDocs(slug, world, docIds)` (Task 4) matches its `BuildBiblePanel` call. `bindWorld(slug, world)`/`unbindWorld(slug)` (Task 5) match the routes from Task 2. `clearWorld(slug)` defined in Task 1, called by `unbindBookWorld`. `AUTO_PROPOSE_CAP` defined once, asserted in the Task 1 test.

**Ambiguity.** Re-bind is explicitly overwrite (idempotent, per spec). Create-time bind is fail-soft (logged `⚠`, never fails creation). The auto-propose fallback (AI down → full catalog) is bounded by the cap.
