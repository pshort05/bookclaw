# Phase 4 — Editor Re-point + Re-pull Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-point the dashboard editor to edit either a shared library template or the active book's snapshot (two scopes, overlay CRUD), and add per-book re-pull-from-library with a 3-way merge against a stored pristine baseline.

**Architecture:** Extend the existing `LibraryService` / `BookService` / `SoulService` / authoring routes. A new pure merge helper (`merge.ts`, backed by `node-diff3`) does the 3-way text merge; `BookService.create()` captures a `.baseline/` mirror so re-pull can diff baseline-vs-book-vs-library. The existing `authoring.js` panel becomes a two-scope editor; `books.js` hosts the re-pull surface.

**Tech Stack:** Node 22 + TypeScript (NodeNext, `.js` import extensions), Express, `node --test` via tsx, esbuild dashboard, `node-diff3` (new pure-JS dep).

**Spec:** `docs/superpowers/specs/2026-06-07-phase4-editor-repull-design.md`

**Conventions (read once):**
- Imports use `.js` extensions even from `.ts` (NodeNext). Match existing files.
- Run a single unit test file: `node --import tsx --test tests/unit/<file>.test.ts`. Full suite: `npm run test:unit`.
- Type-check: `npx tsc --noEmit`.
- Dashboard: edit `dashboard/src/**`, never `dashboard/dist/`. Rebuild with `npm run build:dashboard`.
- Commit workflow: this repo uses a `commit_message` file + `./push.sh` (the maintainer pushes). For subagent-driven execution, **make a real git commit per task** on `main` (the maintainer reconciles); use the commit messages shown. Do **not** run `./push.sh`.
- Existing `safePath(base, rel)` (in `gateway/src/api/routes/_shared.ts`) returns an absolute path within `base` or `null`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `package.json` | add `node-diff3` dep | Modify |
| `gateway/src/services/merge.ts` | pure 3-way text merge | Create |
| `gateway/src/services/library.ts` | overlay write helpers (CRUD) | Modify |
| `gateway/src/services/book.ts` | `.baseline/` capture; re-pull status + execute; path accessors | Modify |
| `gateway/src/api/routes/library.routes.ts` | library write endpoints | Modify |
| `gateway/src/api/routes/books.routes.ts` | book-snapshot edit + re-pull endpoints | Modify |
| `dashboard/src/panels/authoring.js` | two-scope editor | Modify |
| `dashboard/src/panels/books.js` | re-pull UI | Modify |
| `tests/unit/merge.test.ts` | merge helper tests | Create |
| `tests/unit/book-baseline.test.ts` | baseline capture/advance tests | Create |
| `tests/unit/library-write.test.ts` | overlay CRUD tests | Create |
| `tests/unit/book-repull.test.ts` | re-pull status + execute tests | Create |
| `tests/feature-smoke.sh` | Phase 4 e2e assertions | Modify |
| `tests/openrouter-pipeline.sh` | review/refresh vs new baseline | Modify |

---

### Task 1: Merge helper (`merge.ts`) + `node-diff3`

**Files:**
- Modify: `package.json`
- Create: `gateway/src/services/merge.ts`
- Test: `tests/unit/merge.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `npm install node-diff3@^3.1.2`
Expected: `node-diff3` appears under `dependencies` in `package.json`; `node_modules/node-diff3` exists.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/merge.test.ts`:

```ts
/**
 * Unit tests for the pure 3-way text merge helper used by book re-pull.
 * Run via: npm run test:unit  (node --test through tsx)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeText } from '../../gateway/src/services/merge.js';

test('disjoint edits merge cleanly (no conflict)', () => {
  const base = 'line1\nline2\nline3\n';
  const book = 'BOOK\nline2\nline3\n';      // edited line1
  const library = 'line1\nline2\nLIB\n';    // edited line3
  const { merged, hadConflicts } = mergeText(base, book, library);
  assert.equal(hadConflicts, false);
  assert.ok(merged.includes('BOOK'));
  assert.ok(merged.includes('LIB'));
});

test('overlapping edits produce git-style conflict markers', () => {
  const base = 'line1\nline2\nline3\n';
  const book = 'line1\nBOOKEDIT\nline3\n';
  const library = 'line1\nLIBEDIT\nline3\n';
  const { merged, hadConflicts } = mergeText(base, book, library);
  assert.equal(hadConflicts, true);
  assert.ok(merged.includes('<<<<<<< book'));
  assert.ok(merged.includes('>>>>>>> library'));
  assert.ok(merged.includes('BOOKEDIT'));
  assert.ok(merged.includes('LIBEDIT'));
});

test('identical edits on both sides do not conflict', () => {
  const base = 'a\nb\n';
  const same = 'a\nCHANGED\n';
  const { merged, hadConflicts } = mergeText(base, same, same);
  assert.equal(hadConflicts, false);
  assert.ok(merged.includes('CHANGED'));
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `node --import tsx --test tests/unit/merge.test.ts`
Expected: FAIL — `Cannot find module '.../merge.js'`.

- [ ] **Step 4: Implement `merge.ts`**

Create `gateway/src/services/merge.ts`:

```ts
/**
 * Pure 3-way text merge for book re-pull (book-container Phase 4).
 *
 * Wraps node-diff3's line-based merge: auto-merges non-conflicting changes and
 * wraps genuine collisions in git-style markers labelled `book` (the book's
 * edited snapshot) and `library` (the current library version). No fs, no
 * globals — unit-testable in isolation. Pipeline JSON does NOT use this (it is
 * merged whole-asset; see BookService.repull).
 */
import { merge as diff3Merge } from 'node-diff3';

export interface MergeResult {
  merged: string;
  hadConflicts: boolean;
}

/**
 * 3-way merge of two edited versions against their common baseline.
 * @param baseline pristine version pulled at create/last-repull time
 * @param mine     the book's current (possibly edited) snapshot
 * @param theirs   the current library version
 */
export function mergeText(baseline: string, mine: string, theirs: string): MergeResult {
  const toLines = (s: string): string[] => s.split('\n');
  // node-diff3 merge(a, o, b): a + b are the two changed sides, o the ancestor.
  const r = diff3Merge(toLines(mine), toLines(baseline), toLines(theirs), {
    label: { a: 'book', b: 'library' },
  });
  return { merged: r.result.join('\n'), hadConflicts: r.conflict };
}
```

- [ ] **Step 5: Run it to confirm it passes**

Run: `node --import tsx --test tests/unit/merge.test.ts`
Expected: PASS (3 tests). If the conflict-marker labels differ from `<<<<<<< book` / `>>>>>>> library`, adjust the `label` option to match node-diff3's output and re-run.

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` → Expected: no errors.
```bash
git add package.json package-lock.json gateway/src/services/merge.ts tests/unit/merge.test.ts
git commit -m "feat(repull): pure 3-way text merge helper (node-diff3)"
```

---

### Task 2: `.baseline/` capture on create + path accessors

**Files:**
- Modify: `gateway/src/services/book.ts`
- Test: `tests/unit/book-baseline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/book-baseline.test.ts`:

```ts
/**
 * Unit tests for the pristine .baseline/ mirror captured at book create time
 * (book-container Phase 4, enables 3-way re-pull). Network-free; temp dirs.
 * Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', '# Default Author\n\ndefault soul');
  write(builtin, 'authors/default/PERSONALITY.md', 'default personality');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'voices/default/VOICE-PROFILE.md', 'default voice');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeSvc(root: string): Promise<BookService> {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  return svc;
}

test('create() captures a .baseline mirror of templates/', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-baseline-'));
  try {
    const svc = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const bookDir = join(root, 'workspace', 'books', book.slug);
    // baseline mirrors templates
    assert.ok(existsSync(join(bookDir, '.baseline', 'author', 'SOUL.md')));
    assert.ok(existsSync(join(bookDir, '.baseline', 'voice', 'STYLE-GUIDE.md')));
    assert.ok(existsSync(join(bookDir, '.baseline', 'pipeline.json')));
    assert.equal(
      readFileSync(join(bookDir, '.baseline', 'author', 'SOUL.md'), 'utf-8'),
      readFileSync(join(bookDir, 'templates', 'author', 'SOUL.md'), 'utf-8'),
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('baselineDir()/templatesDir() resolve under the active book', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-baseline-'));
  try {
    const svc = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(svc.templatesDir(book.slug), join(root, 'workspace', 'books', book.slug, 'templates'));
    assert.equal(svc.baselineDir(book.slug), join(root, 'workspace', 'books', book.slug, '.baseline'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --import tsx --test tests/unit/book-baseline.test.ts`
Expected: FAIL — `.baseline` missing / `svc.templatesDir is not a function`.

- [ ] **Step 3: Capture `.baseline/` in `create()` + add accessors**

In `gateway/src/services/book.ts`, add `cp` to the `fs/promises` import:

```ts
import { readFile, writeFile, mkdir, rm, cp } from 'fs/promises';
```

In `create()`, immediately after `await mkdir(join(dir, 'data'), { recursive: true });` (line ~138) and before the `const ref =` line, insert:

```ts
    // Phase 4: capture a pristine baseline mirror of the snapshot so re-pull can
    // 3-way-merge (baseline vs the book's edited copy vs the current library).
    // Never edited by the editor — only create() and a successful re-pull write it.
    await cp(join(dir, 'templates'), join(dir, '.baseline'), { recursive: true });
```

Add these public accessors near `activeBookDir()` (after line ~265):

```ts
  /** Absolute book dir for a slug (slug-guarded; null if invalid). */
  bookDir(slug: string): string | null {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
    return join(this.booksDir, slug);
  }

  /** Absolute templates/ dir for a slug, or null if the slug is invalid. */
  templatesDir(slug: string): string | null {
    const d = this.bookDir(slug);
    return d ? join(d, 'templates') : null;
  }

  /** Absolute .baseline/ dir for a slug, or null if the slug is invalid. */
  baselineDir(slug: string): string | null {
    const d = this.bookDir(slug);
    return d ? join(d, '.baseline') : null;
  }
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `node --import tsx --test tests/unit/book-baseline.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Confirm no regressions + type-check + commit**

Run: `node --import tsx --test tests/unit/book.test.ts tests/unit/active-book.test.ts` → Expected: PASS.
Run: `npx tsc --noEmit` → Expected: no errors.
```bash
git add gateway/src/services/book.ts tests/unit/book-baseline.test.ts
git commit -m "feat(repull): capture pristine .baseline mirror on book create"
```

---

### Task 3: Library overlay write API (CRUD)

**Files:**
- Modify: `gateway/src/services/library.ts`
- Modify: `gateway/src/api/routes/library.routes.ts`
- Test: `tests/unit/library-write.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/library-write.test.ts`:

```ts
/**
 * Unit tests for the library overlay write path (book-container Phase 4):
 * writeEntry / createEntry / deleteOverlayEntry against the workspace overlay,
 * with built-ins read-only and delete-reverts-to-builtin. Network-free.
 * Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;
function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}
async function makeLib(root: string): Promise<LibraryService> {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'builtin soul');
  write(builtin, 'genres/romantasy/tropes.md', 'builtin tropes');
  const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  return lib;
}

test('writeEntry overlays a built-in (source flips to workspace)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    assert.equal(lib.get('author', 'default')!.source, 'builtin');
    await lib.writeEntry('author', 'default', { files: { 'SOUL.md': 'edited soul' } });
    await lib.reload();
    const e = lib.get('author', 'default')!;
    assert.equal(e.source, 'workspace');
    assert.equal(e.files!['SOUL.md'], 'edited soul');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('deleteOverlayEntry reverts to the built-in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    await lib.writeEntry('genre', 'romantasy', { files: { 'tropes.md': 'edited' } });
    await lib.reload();
    assert.equal(lib.get('genre', 'romantasy')!.source, 'workspace');
    const removed = await lib.deleteOverlayEntry('genre', 'romantasy');
    assert.equal(removed, true);
    await lib.reload();
    const e = lib.get('genre', 'romantasy')!;
    assert.equal(e.source, 'builtin');
    assert.equal(e.files!['tropes.md'], 'builtin tropes');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('deleteOverlayEntry returns false for a builtin-only entry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    const removed = await lib.deleteOverlayEntry('author', 'default');
    assert.equal(removed, false); // nothing in the overlay to delete
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('createEntry writes a section and a pipeline; bad JSON rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libw-'));
  try {
    const lib = await makeLib(root);
    await lib.createEntry('section', 'epilogue', { content: '# Epilogue' });
    await lib.reload();
    assert.equal(lib.get('section', 'epilogue')!.content, '# Epilogue');

    await lib.createEntry('pipeline', 'mini', { content: JSON.stringify({ schemaVersion: 1, name: 'mini', label: 'Mini', description: 'd', steps: [] }) });
    await lib.reload();
    assert.equal(lib.get('pipeline', 'mini')!.pipeline!.name, 'mini');

    await assert.rejects(() => lib.createEntry('pipeline', 'broken', { content: '{ not json' }));
    await assert.rejects(() => lib.createEntry('pipeline', 'noSteps', { content: '{"schemaVersion":1}' }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --import tsx --test tests/unit/library-write.test.ts`
Expected: FAIL — `lib.writeEntry is not a function`.

- [ ] **Step 3: Add write helpers to `LibraryService`**

In `gateway/src/services/library.ts`, add `writeFile, mkdir, rm` to the `fs/promises` import (it currently imports only `readFile, readdir`):

```ts
import { readFile, readdir, writeFile, mkdir, rm } from 'fs/promises';
```

Add this near the top-level constants (after `DIR_LAYOUT`):

```ts
/** Filenames allowed inside a multi-file overlay entry (no path separators). */
const MD_FILE_RE = /^[A-Za-z0-9._-]+\.md$/;
const ENTRY_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface LibraryWriteBody {
  files?: Record<string, string>; // author/voice/genre
  content?: string;               // section / pipeline (raw JSON text)
}
```

Add these methods to the `LibraryService` class (after `reload()`):

```ts
  /** Absolute overlay dir/file path for an entry, or null if name invalid. */
  private overlayPath(kind: FileKind, name: string): string | null {
    if (!ENTRY_NAME_RE.test(name)) return null;
    const dir = join(this.workspaceDir, DIR_LAYOUT[kind]);
    if (kind === 'pipeline') return join(dir, `${name}.json`);
    if (kind === 'section') return join(dir, `${name}.md`);
    return join(dir, name); // author/voice/genre: a directory
  }

  /** True if a workspace-overlay entry exists for this kind/name. */
  overlayExists(kind: FileKind, name: string): boolean {
    const p = this.overlayPath(kind, name);
    return !!p && existsSync(p);
  }

  /** Validate + persist an overlay entry. Throws on bad input. Caller reloads. */
  async writeEntry(kind: FileKind, name: string, body: LibraryWriteBody): Promise<void> {
    const target = this.overlayPath(kind, name);
    if (!target) throw new Error(`Invalid name: ${name}`);
    if (kind === 'pipeline') {
      const raw = String(body.content ?? '');
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { throw new Error('pipeline content must be valid JSON'); }
      const p = parsed as { steps?: unknown; schemaVersion?: unknown };
      if (!Array.isArray(p.steps) || typeof p.schemaVersion !== 'number') {
        throw new Error('pipeline JSON must have a steps array and a numeric schemaVersion');
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, raw.endsWith('\n') ? raw : raw + '\n', 'utf-8');
      return;
    }
    if (kind === 'section') {
      if (typeof body.content !== 'string') throw new Error('section requires content (string)');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body.content, 'utf-8');
      return;
    }
    // author / voice / genre: a directory of .md files
    const files = body.files;
    if (!files || Object.keys(files).length === 0) throw new Error(`${kind} requires at least one .md file`);
    for (const fname of Object.keys(files)) {
      if (!MD_FILE_RE.test(fname)) throw new Error(`Invalid file name: ${fname}`);
      if (typeof files[fname] !== 'string') throw new Error(`File content must be a string: ${fname}`);
    }
    await mkdir(target, { recursive: true });
    for (const [fname, content] of Object.entries(files)) {
      await writeFile(join(target, fname), content, 'utf-8');
    }
  }

  /** Create a NEW entry; throws if the name already exists in any source. */
  async createEntry(kind: FileKind, name: string, body: LibraryWriteBody): Promise<void> {
    if (!ENTRY_NAME_RE.test(name)) throw new Error(`Invalid name: ${name}`);
    if (this.get(kind, name)) throw new Error(`Entry already exists: ${kind}/${name}`);
    await this.writeEntry(kind, name, body);
  }

  /** Remove a workspace-overlay entry. Returns false if none existed (builtin stays). */
  async deleteOverlayEntry(kind: FileKind, name: string): Promise<boolean> {
    const p = this.overlayPath(kind, name);
    if (!p || !existsSync(p)) return false;
    await rm(p, { recursive: true, force: true });
    return true;
  }
```

Add `dirname` to the `path` import at the top of the file:

```ts
import { join, dirname } from 'path';
```

> Note: `writeEntry`/`createEntry`/`deleteOverlayEntry`/`overlayExists` take a `FileKind` (author/voice/genre/pipeline/section). `skill` is handled by the existing `/api/skills` endpoints — the library write route rejects `kind === 'skill'`.

- [ ] **Step 4: Run it to confirm it passes**

Run: `node --import tsx --test tests/unit/library-write.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the write endpoints to `library.routes.ts`**

In `gateway/src/api/routes/library.routes.ts`, after the existing `GET /api/library/:kind/:name` handler and before the closing `}` of `mountLibrary`, add:

```ts
  // ── Write path (Phase 4): workspace-overlay CRUD. Built-ins are read-only;
  // skills are handled by /api/skills (SkillLoader overlay). ─────────────────
  const WRITABLE = ['author', 'voice', 'genre', 'pipeline', 'section'] as const;
  const isWritable = (v: string): v is (typeof WRITABLE)[number] =>
    (WRITABLE as readonly string[]).includes(v);

  // Create a new entry. 409 if the name already exists in any source.
  app.post('/api/library/:kind', async (req: Request, res: Response) => {
    const kind = String(req.params.kind);
    if (!isWritable(kind)) return res.status(400).json({ error: `Cannot create kind "${kind}" here (skills use /api/skills)` });
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    try {
      await services.library.createEntry(kind, name, { files: req.body?.files, content: req.body?.content });
      await services.library.reload();
      res.json({ success: true, kind, name, source: 'workspace' });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      res.status(/already exists/i.test(msg) ? 409 : 400).json({ error: msg });
    }
  });

  // Upsert (edit) an overlay entry.
  app.put('/api/library/:kind/:name', async (req: Request, res: Response) => {
    const kind = String(req.params.kind);
    if (!isWritable(kind)) return res.status(400).json({ error: `Cannot edit kind "${kind}" here (skills use /api/skills)` });
    try {
      await services.library.writeEntry(kind, String(req.params.name), { files: req.body?.files, content: req.body?.content });
      await services.library.reload();
      res.json({ success: true, kind, name: String(req.params.name), source: 'workspace' });
    } catch (err) {
      res.status(400).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // Delete an overlay entry (reverts to built-in if one exists). 404 if no overlay.
  app.delete('/api/library/:kind/:name', async (req: Request, res: Response) => {
    const kind = String(req.params.kind);
    if (!isWritable(kind)) return res.status(400).json({ error: `Cannot delete kind "${kind}" here (skills use /api/skills)` });
    try {
      const removed = await services.library.deleteOverlayEntry(kind, String(req.params.name));
      if (!removed) return res.status(404).json({ error: 'No workspace overlay entry to delete (built-ins are read-only)' });
      await services.library.reload();
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error)?.message || String(err) });
    }
  });
```

- [ ] **Step 6: Type-check + commit**

Run: `npx tsc --noEmit` → Expected: no errors.
```bash
git add gateway/src/services/library.ts gateway/src/api/routes/library.routes.ts tests/unit/library-write.test.ts
git commit -m "feat(library): workspace-overlay write API (edit/create/delete)"
```

---

### Task 4: Book-snapshot edit API (active book templates/)

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts`

This task wires HTTP endpoints over existing primitives; verification is by type-check + the feature-smoke assertions added in Task 9 (the dashboard has no unit-test runner, and these are thin fs handlers guarded by `safePath`). Keep handlers minimal.

- [ ] **Step 1: Add imports + a "wired" helper**

At the top of `gateway/src/api/routes/books.routes.ts`, add:

```ts
import { join } from 'path';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { safePath } from './_shared.js';
```

Inside `mountBooks`, after `const services = gateway.getServices();`, add:

```ts
  // Which snapshot kinds currently DRIVE generation (Phase 3): author + voice
  // (via SoulService) and pipeline. genre/sections/skills are stored records,
  // not yet injected — the UI labels them so editing them isn't a silent no-op.
  const WIRED_KINDS = new Set(['author', 'voice', 'pipeline']);
  // Relative location under templates/ for each kind.
  const TEMPLATE_SUBDIR: Record<string, string> = {
    author: 'author', voice: 'voice', genre: 'genre',
    sections: 'sections', skills: 'skills',
  };
  // Resolve the active book's templates/ dir, or null when none is active.
  const activeTemplates = (): string | null => {
    const slug = services.books.getActiveBook();
    return slug ? services.books.templatesDir(slug) : null;
  };
```

- [ ] **Step 2: Add GET (read snapshot) endpoint**

```ts
  // Read the active book's snapshot for a kind. Multi-file kinds → {files};
  // pipeline → {content} (raw JSON); section by name → {content}.
  app.get('/api/books/active/templates/:kind/:name?', async (req: Request, res: Response) => {
    const base = activeTemplates();
    if (!base) return res.status(409).json({ error: 'No active book' });
    const kind = String(req.params.kind);
    try {
      if (kind === 'pipeline') {
        const p = safePath(base, 'pipeline.json');
        if (!p || !existsSync(p)) return res.status(404).json({ error: 'pipeline.json not found' });
        return res.json({ kind, content: await readFile(p, 'utf-8'), wired: true });
      }
      if (kind === 'sections') {
        const name = String(req.params.name || '');
        if (!name) {
          const dir = safePath(base, 'sections');
          const list = dir && existsSync(dir) ? (await readdir(dir)).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')) : [];
          return res.json({ kind, entries: list, wired: false });
        }
        const p = safePath(base, join('sections', `${name}.md`));
        if (!p || !existsSync(p)) return res.status(404).json({ error: 'section not found' });
        return res.json({ kind, name, content: await readFile(p, 'utf-8'), wired: false });
      }
      // author / voice / genre / skills: directory of files
      const sub = TEMPLATE_SUBDIR[kind];
      if (!sub) return res.status(400).json({ error: `Unknown kind: ${kind}` });
      const dir = safePath(base, kind === 'skills' && req.params.name ? join('skills', String(req.params.name)) : sub);
      if (!dir || !existsSync(dir)) return res.status(404).json({ error: `${kind} snapshot not found` });
      const files: Record<string, string> = {};
      for (const f of await readdir(dir)) {
        if (f.endsWith('.md')) files[f] = await readFile(join(dir, f), 'utf-8');
      }
      return res.json({ kind, files, wired: WIRED_KINDS.has(kind) });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });
```

- [ ] **Step 3: Add PUT (write snapshot) endpoint**

```ts
  // Write the active book's snapshot for a kind. Same body shapes as the library
  // write API. author/voice → soul.reload(); others read at run-time or unwired.
  app.put('/api/books/active/templates/:kind/:name?', async (req: Request, res: Response) => {
    const base = activeTemplates();
    if (!base) return res.status(409).json({ error: 'No active book' });
    const kind = String(req.params.kind);
    try {
      if (kind === 'pipeline') {
        const raw = String(req.body?.content ?? '');
        try { const p = JSON.parse(raw); if (!Array.isArray(p.steps) || typeof p.schemaVersion !== 'number') throw 0; }
        catch { return res.status(400).json({ error: 'pipeline content must be JSON with a steps array and numeric schemaVersion' }); }
        const dest = safePath(base, 'pipeline.json');
        if (!dest) return res.status(403).json({ error: 'Path traversal blocked' });
        await writeFile(dest, raw.endsWith('\n') ? raw : raw + '\n', 'utf-8');
        return res.json({ success: true, kind, wired: true });
      }
      if (kind === 'sections') {
        const name = String(req.params.name || '');
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return res.status(400).json({ error: 'section name required' });
        if (typeof req.body?.content !== 'string') return res.status(400).json({ error: 'content (string) required' });
        const dest = safePath(base, join('sections', `${name}.md`));
        if (!dest) return res.status(403).json({ error: 'Path traversal blocked' });
        await mkdir(join(dest, '..'), { recursive: true });
        await writeFile(dest, req.body.content, 'utf-8');
        return res.json({ success: true, kind, name, wired: false });
      }
      const sub = TEMPLATE_SUBDIR[kind];
      if (!sub || kind === 'skills') {
        // skills snapshot edits target skills/<name>/SKILL.md
        if (kind !== 'skills') return res.status(400).json({ error: `Unknown kind: ${kind}` });
      }
      const files = req.body?.files;
      if (!files || typeof files !== 'object') return res.status(400).json({ error: 'files (object) required' });
      const rel = kind === 'skills' ? join('skills', String(req.params.name || '')) : sub;
      for (const fname of Object.keys(files)) {
        if (!/^[A-Za-z0-9._-]+\.md$/.test(fname)) return res.status(400).json({ error: `Invalid file name: ${fname}` });
        const dest = safePath(base, join(rel, fname));
        if (!dest) return res.status(403).json({ error: 'Path traversal blocked' });
        await mkdir(join(dest, '..'), { recursive: true });
        await writeFile(dest, String(files[fname]), 'utf-8');
      }
      if (kind === 'author' || kind === 'voice') await gateway.soul?.reload?.();
      return res.json({ success: true, kind, wired: WIRED_KINDS.has(kind) });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });
```

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit` → Expected: no errors.
```bash
git add gateway/src/api/routes/books.routes.ts
git commit -m "feat(books): edit the active book's templates snapshot (two-scope editor backend)"
```

---

### Task 5: Re-pull engine (`BookService.repullStatus` + `repull`)

**Files:**
- Modify: `gateway/src/services/book.ts`
- Test: `tests/unit/book-repull.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/book-repull.test.ts`:

```ts
/**
 * Unit tests for per-asset re-pull (book-container Phase 4): status
 * classification + 3-way merge / whole-asset pipeline / no-baseline fallback.
 * Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;
function write(base: string, rel: string, body: string): void {
  const p = join(base, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body, 'utf-8');
}
function seedLibrary(root: string): LibraryService {
  const b = join(root, 'library');
  write(b, 'authors/default/SOUL.md', 'soul v1\nline2\nline3\n');
  write(b, 'voices/default/STYLE-GUIDE.md', 'style v1');
  write(b, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  return new LibraryService(b, join(root, 'workspace', 'library'), fakeSkills);
}
async function makeSvc(root: string): Promise<{ svc: BookService; lib: LibraryService; builtin: string }> {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  return { svc, lib, builtin: join(root, 'library') };
}

test('repullStatus reports in-sync right after create', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-rp-'));
  try {
    const { svc } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const status = await svc.repullStatus(book.slug);
    const author = status.find(a => a.kind === 'author');
    assert.equal(author!.status, 'in-sync');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('library-updated asset re-pulls cleanly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-rp-'));
  try {
    const { svc, builtin, lib } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    // library changes a line the book didn't touch
    write(builtin, 'authors/default/SOUL.md', 'soul v1\nline2 CHANGED\nline3\n');
    await lib.reload();
    const status = await svc.repullStatus(book.slug);
    assert.equal(status.find(a => a.kind === 'author')!.status, 'library-updated');
    const r = await svc.repull(book.slug, 'author', 'default', {});
    assert.equal(r.hadConflicts, false);
    const merged = readFileSync(join(root, 'workspace', 'books', book.slug, 'templates', 'author', 'SOUL.md'), 'utf-8');
    assert.ok(merged.includes('line2 CHANGED'));
    // baseline advanced to library version
    const baseline = readFileSync(join(root, 'workspace', 'books', book.slug, '.baseline', 'author', 'SOUL.md'), 'utf-8');
    assert.ok(baseline.includes('line2 CHANGED'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('diverged asset with overlapping edits produces conflict markers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-rp-'));
  try {
    const { svc, builtin, lib } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const tdir = join(root, 'workspace', 'books', book.slug, 'templates', 'author', 'SOUL.md');
    writeFileSync(tdir, 'soul v1\nBOOK EDIT\nline3\n', 'utf-8');         // book edits line2
    write(builtin, 'authors/default/SOUL.md', 'soul v1\nLIB EDIT\nline3\n'); // library edits line2
    await lib.reload();
    assert.equal((await svc.repullStatus(book.slug)).find(a => a.kind === 'author')!.status, 'diverged');
    const r = await svc.repull(book.slug, 'author', 'default', {});
    assert.equal(r.hadConflicts, true);
    assert.ok(readFileSync(tdir, 'utf-8').includes('<<<<<<< book'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('no-baseline book falls back to take-library and creates a baseline', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-rp-'));
  try {
    const { svc } = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    // simulate a pre-Phase-4 book: remove its baseline
    rmSync(join(root, 'workspace', 'books', book.slug, '.baseline'), { recursive: true, force: true });
    assert.equal((await svc.repullStatus(book.slug)).find(a => a.kind === 'author')!.status, 'no-baseline');
    const r = await svc.repull(book.slug, 'author', 'default', { resolution: 'take-library' });
    assert.equal(r.hadConflicts, false);
    assert.ok(existsSync(join(root, 'workspace', 'books', book.slug, '.baseline', 'author', 'SOUL.md')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --import tsx --test tests/unit/book-repull.test.ts`
Expected: FAIL — `svc.repullStatus is not a function`.

- [ ] **Step 3: Implement re-pull in `book.ts`**

Add the merge import near the top of `gateway/src/services/book.ts`:

```ts
import { mergeText } from './merge.js';
```

Add these types above the `BookService` class (after the `BookSelection` interface):

```ts
export type RepullStatus =
  | 'in-sync' | 'library-updated' | 'locally-edited' | 'diverged'
  | 'library-removed' | 'no-baseline';

export interface RepullAsset {
  kind: 'author' | 'voice' | 'genre' | 'pipeline' | 'section' | 'skill';
  name: string;
  status: RepullStatus;
  libraryPresent: boolean;
  hasBaseline: boolean;
  wired: boolean;
}

export interface RepullResult { merged: boolean; hadConflicts: boolean; }
```

Add these methods to the `BookService` class (after `activePipeline()`), plus the helper imports `readFileSync`-style reads via the existing `fs` import (already imports `existsSync, readdirSync, readFileSync`):

```ts
  // ── Phase 4: per-asset re-pull from the library ────────────────────────────

  private readonly WIRED = new Set(['author', 'voice', 'pipeline']);

  /** Read a file under a book subdir, or null if missing. */
  private rd(slug: string, rel: string): string | null {
    const base = this.bookDir(slug);
    if (!base) return null;
    const p = join(base, rel);
    return existsSync(p) ? readFileSync(p, 'utf-8') : null;
  }

  /** The library's current files/content for an asset, normalised to a file map. */
  private libraryFiles(kind: RepullAsset['kind'], name: string): Record<string, string> | null {
    const e = this.library.get(kind, name);
    if (!e) return null;
    if (e.files) return e.files;
    if (kind === 'pipeline' && e.pipeline) return { 'pipeline.json': JSON.stringify(e.pipeline, null, 2) + '\n' };
    if (typeof e.content === 'string') return { [kind === 'section' ? `${name}.md` : 'SKILL.md']: e.content };
    return null;
  }

  /** templates/ relative dir for an asset's files. */
  private assetRel(kind: RepullAsset['kind'], name: string): string {
    if (kind === 'pipeline') return '';                 // file lives at templates/pipeline.json
    if (kind === 'section') return 'sections';
    if (kind === 'skill') return join('skills', name);
    return kind;                                        // author/voice/genre dir
  }

  /** Map a library file name to its on-disk name under templates/. */
  private assetFileName(kind: RepullAsset['kind'], libFileName: string, name: string): string {
    if (kind === 'pipeline') return 'pipeline.json';
    if (kind === 'section') return `${name}.md`;
    return libFileName;
  }

  /** Compare two file maps for equality (keys + contents). */
  private sameFiles(a: Record<string, string> | null, b: Record<string, string> | null): boolean {
    if (!a || !b) return a === b;
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every(k => a[k] === b[k]);
  }

  /** Read a templates/ or .baseline/ asset as a file map (relative to that root). */
  private readAssetFrom(slug: string, root: 'templates' | '.baseline', kind: RepullAsset['kind'], name: string): Record<string, string> | null {
    const base = this.bookDir(slug);
    if (!base) return null;
    const rel = this.assetRel(kind, name);
    if (kind === 'pipeline') {
      const p = join(base, root, 'pipeline.json');
      return existsSync(p) ? { 'pipeline.json': readFileSync(p, 'utf-8') } : null;
    }
    const dir = join(base, root, rel);
    if (!existsSync(dir)) return null;
    const out: Record<string, string> = {};
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.md')) out[f] = readFileSync(join(dir, f), 'utf-8');
    }
    if (kind === 'section') {
      const p = join(base, root, 'sections', `${name}.md`);
      return existsSync(p) ? { [`${name}.md`]: readFileSync(p, 'utf-8') } : null;
    }
    return Object.keys(out).length ? out : null;
  }

  /** The list of snapshotted assets for a book, from its pulledFrom manifest. */
  private async assetsOf(slug: string): Promise<Array<{ kind: RepullAsset['kind']; name: string }>> {
    const opened = await this.open(slug);
    if (!opened) return [];
    const pf = opened.manifest.pulledFrom;
    const out: Array<{ kind: RepullAsset['kind']; name: string }> = [
      { kind: 'author', name: pf.author.name },
      { kind: 'pipeline', name: pf.pipeline.name },
    ];
    if (pf.voice) out.push({ kind: 'voice', name: pf.voice.name });
    if (pf.genre) out.push({ kind: 'genre', name: pf.genre.name });
    for (const s of pf.sections || []) out.push({ kind: 'section', name: s });
    for (const s of pf.skills || []) out.push({ kind: 'skill', name: s });
    return out;
  }

  /** Per-asset re-pull status for a book. */
  async repullStatus(slug: string): Promise<RepullAsset[]> {
    const assets = await this.assetsOf(slug);
    return assets.map(({ kind, name }) => {
      const lib = this.libraryFiles(kind, name);
      const baseline = this.readAssetFrom(slug, '.baseline', kind, name);
      const book = this.readAssetFrom(slug, 'templates', kind, name);
      const hasBaseline = !!baseline;
      const wired = this.WIRED.has(kind);
      if (!lib) return { kind, name, status: 'library-removed' as const, libraryPresent: false, hasBaseline, wired };
      if (!hasBaseline) return { kind, name, status: 'no-baseline' as const, libraryPresent: true, hasBaseline, wired };
      const locallyEdited = !this.sameFiles(baseline, book);
      const libraryChanged = !this.sameFiles(baseline, lib);
      const status: RepullStatus =
        locallyEdited && libraryChanged ? 'diverged'
        : libraryChanged ? 'library-updated'
        : locallyEdited ? 'locally-edited'
        : 'in-sync';
      return { kind, name, status, libraryPresent: true, hasBaseline, wired };
    });
  }

  /**
   * Re-pull one asset. With a baseline + a text kind: 3-way merge per file,
   * write merged into templates/, advance baseline to the library version.
   * Pipeline + no-baseline fall back to opts.resolution (take-library | keep-book).
   */
  async repull(
    slug: string,
    kind: RepullAsset['kind'],
    name: string,
    opts: { resolution?: 'take-library' | 'keep-book' },
  ): Promise<RepullResult> {
    const base = this.bookDir(slug);
    if (!base) throw new Error(`Invalid slug: ${slug}`);
    const lib = this.libraryFiles(kind, name);
    if (!lib) throw new Error(`Library no longer has ${kind}/${name}`);
    const baseline = this.readAssetFrom(slug, '.baseline', kind, name);
    const book = this.readAssetFrom(slug, 'templates', kind, name);

    const writeMap = async (root: 'templates' | '.baseline', files: Record<string, string>) => {
      const rel = this.assetRel(kind, name);
      const dir = kind === 'pipeline' ? join(base, root) : join(base, root, rel);
      await mkdir(dir, { recursive: true });
      for (const [libName, content] of Object.entries(files)) {
        await writeFile(join(dir, this.assetFileName(kind, libName, name)), content, 'utf-8');
      }
    };

    // Pipeline (JSON) or no baseline → whole-asset keep/take.
    if (kind === 'pipeline' || !baseline) {
      const res = opts.resolution ?? 'take-library';
      if (res === 'take-library') {
        await writeMap('templates', lib);
        await writeMap('.baseline', lib);
      } else { // keep-book: leave templates, just establish/advance baseline
        await writeMap('.baseline', book ?? lib);
      }
      return { merged: true, hadConflicts: false };
    }

    // Text 3-way merge per file (union of file names across baseline/book/library).
    const names = new Set([...Object.keys(baseline), ...Object.keys(book ?? {}), ...Object.keys(lib)]);
    const mergedFiles: Record<string, string> = {};
    let hadConflicts = false;
    for (const f of names) {
      const b = baseline[f] ?? '';
      const m = (book ?? {})[f] ?? '';
      const t = lib[f] ?? '';
      const { merged, hadConflicts: c } = mergeText(b, m, t);
      mergedFiles[f] = merged;
      if (c) hadConflicts = true;
    }
    await writeMap('templates', mergedFiles);
    await writeMap('.baseline', lib); // baseline advances to the just-pulled library version
    return { merged: true, hadConflicts };
  }
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `node --import tsx --test tests/unit/book-repull.test.ts`
Expected: PASS (4 tests). If `readAssetFrom` for `section`/`skill` returns the directory-scan map before the section-specific block, verify the section branch returns the single `<name>.md` map — adjust ordering if a test fails on section reads.

- [ ] **Step 5: Full unit suite + type-check + commit**

Run: `npm run test:unit` → Expected: all pass (existing + new).
Run: `npx tsc --noEmit` → Expected: no errors.
```bash
git add gateway/src/services/book.ts tests/unit/book-repull.test.ts
git commit -m "feat(repull): per-asset 3-way merge engine + status (BookService.repull)"
```

---

### Task 6: Re-pull endpoints

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts`

- [ ] **Step 1: Add the GET status + POST execute endpoints**

In `gateway/src/api/routes/books.routes.ts`, after the template PUT handler from Task 4, add:

```ts
  // Per-asset re-pull status for the active book.
  app.get('/api/books/active/repull', async (_req: Request, res: Response) => {
    const slug = services.books.getActiveBook();
    if (!slug) return res.status(409).json({ error: 'No active book' });
    try {
      res.json({ slug, assets: await services.books.repullStatus(slug) });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // Re-pull one asset of the active book. body: { resolution?: 'take-library' | 'keep-book' }.
  app.post('/api/books/active/repull/:kind/:name', async (req: Request, res: Response) => {
    const slug = services.books.getActiveBook();
    if (!slug) return res.status(409).json({ error: 'No active book' });
    const kind = String(req.params.kind), name = String(req.params.name);
    const resolution = req.body?.resolution === 'keep-book' ? 'keep-book'
      : req.body?.resolution === 'take-library' ? 'take-library' : undefined;
    try {
      const result = await services.books.repull(slug, kind as any, name, { resolution });
      if (kind === 'author' || kind === 'voice') await gateway.soul?.reload?.();
      res.json({ success: true, ...result });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      res.status(/no longer has|invalid/i.test(msg) ? 400 : 500).json({ error: msg });
    }
  });
```

> Note: `:name` is required on the POST route (every asset in `pulledFrom` has a name, including `pipeline` = the pipeline name). No optional-name variant is needed.

- [ ] **Step 2: Type-check + smoke boot + commit**

Run: `npx tsc --noEmit` → Expected: no errors.
Run: `npm run test:smoke` → Expected: existing smoke still passes (auth/CORS/IP perimeter unaffected).
```bash
git add gateway/src/api/routes/books.routes.ts
git commit -m "feat(repull): active-book re-pull status + execute endpoints"
```

---

### Task 7: Two-scope editor UI (`authoring.js`)

**Files:**
- Modify: `dashboard/src/panels/authoring.js`
- Modify (if new markup needed): `dashboard/src/index.html`

The dashboard is plain JS bundled by esbuild — no unit-test runner. Verification = `npm run build:dashboard` succeeds and the panel renders/saves (covered end-to-end by Task 9 feature-smoke for the API; UI itself verified by a manual click-through note). **Read `dashboard/src/panels/authoring.js` and `dashboard/src/lib/api.js` fully before editing** to match the existing `api()` helper, panel-render pattern, and event wiring.

- [ ] **Step 1: Add a scope + kind + entry selector to the panel**

In `dashboard/src/panels/authoring.js`, add UI state and controls at the top of the panel render:
- A **scope** toggle: `Library` | `This Book` (default `This Book` when a book is active, else `Library`).
- A **kind** selector: `Author, Voice, Genre, Sections, Skills, Pipeline`.
- An **entry** picker: in Library scope, populated from `GET /api/library/:kind` (`entries[].name`, with a read-only badge when `source === 'builtin'`); in Book scope, fixed to the active book's snapshot (no picker for single-instance kinds; a file/section sub-picker for multi-file kinds).

Concrete wiring (follow the file's existing `api()` + element-building style):

```js
// scope: 'library' | 'book'
async function loadEntryList(scope, kind) {
  if (scope === 'library') {
    const r = await api('GET', `/api/library/${kind}`);
    return (r.entries || []).map(e => ({ name: e.name, source: e.source }));
  }
  return [{ name: '(active book)', source: 'book' }];
}
```

- [ ] **Step 2: Load content for the selected scope/kind/entry into the editor**

```js
async function loadContent(scope, kind, name) {
  if (kind === 'skill') { // skills keep their existing endpoints
    const r = await api('GET', `/api/skills/${name}`); return { content: r.skill?.content || '' };
  }
  if (scope === 'library') {
    const r = await api('GET', `/api/library/${kind}/${name}`);
    return r.entry?.files ? { files: r.entry.files } : { content: r.entry?.content ?? JSON.stringify(r.entry?.pipeline ?? {}, null, 2) };
  }
  // book scope
  const path = kind === 'sections' ? `/api/books/active/templates/sections/${name}` : `/api/books/active/templates/${kind}`;
  const r = await api('GET', path);
  return r.files ? { files: r.files, wired: r.wired } : { content: r.content, wired: r.wired };
}
```

For multi-file kinds (author/voice/genre), show a file sub-picker (keys of `files`) and edit one file at a time in the existing textarea. For `pipeline`, edit the raw JSON and disable Save until `JSON.parse` succeeds client-side. Show a "stored — not yet active in generation" note when `wired === false`.

- [ ] **Step 3: Route Save to the correct endpoint**

```js
async function saveContent(scope, kind, name, fileName, value) {
  if (kind === 'skill') return api('PUT', `/api/skills/${name}`, { category: currentSkillCategory, content: value });
  if (scope === 'library') {
    if (kind === 'pipeline' || kind === 'section') return api('PUT', `/api/library/${kind}/${name}`, { content: value });
    return api('PUT', `/api/library/${kind}/${name}`, { files: { [fileName]: value } });
  }
  // book scope
  if (kind === 'pipeline') return api('PUT', `/api/books/active/templates/pipeline`, { content: value });
  if (kind === 'sections') return api('PUT', `/api/books/active/templates/sections/${name}`, { content: value });
  return api('PUT', `/api/books/active/templates/${kind}`, { files: { [fileName]: value } });
}
```

- [ ] **Step 4: Add New / Delete controls (library scope only)**

- "New entry" button → prompt for name → `POST /api/library/:kind` with an empty `files`/`content` skeleton, then reload the entry list.
- Per-entry Delete (only when `source === 'workspace'`) → `confirm()` → `DELETE /api/library/:kind/:name` → reload list. Built-in entries show a read-only badge and no Delete.

- [ ] **Step 5: Build the dashboard**

Run: `npm run build:dashboard`
Expected: esbuild writes `dashboard/dist/index.html` with no errors.

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/panels/authoring.js dashboard/src/index.html dashboard/dist/index.html
git commit -m "feat(editor): two-scope editor — library overlay + active-book snapshot"
```

---

### Task 8: Re-pull UI (`books.js`)

**Files:**
- Modify: `dashboard/src/panels/books.js`

**Read `dashboard/src/panels/books.js` fully first** (it already has list render, create form, delete, `refreshActiveBook()`); match its style.

- [ ] **Step 1: Add a "Re-pull from library" action + status table**

For the active book, add a button that fetches status and renders a per-asset table:

```js
async function renderRepull(container) {
  const r = await api('GET', '/api/books/active/repull');
  const rows = (r.assets || []).map(a => {
    const badge = {
      'in-sync': 'in sync', 'library-updated': 'library updated', 'locally-edited': 'locally edited',
      'diverged': 'both changed', 'library-removed': 'removed from library', 'no-baseline': 'no baseline',
    }[a.status] || a.status;
    const canMerge = a.status === 'library-updated' || a.status === 'diverged' || a.status === 'locally-edited';
    const needsChoice = a.kind === 'pipeline' || a.status === 'no-baseline';
    return `<tr data-kind="${a.kind}" data-name="${a.name}">
      <td>${a.kind}/${a.name}</td><td>${badge}${a.wired ? '' : ' <em>(record only)</em>'}</td>
      <td>${a.status === 'in-sync' || a.status === 'library-removed' ? '' :
        needsChoice
          ? `<button class="rpTake">take library</button> <button class="rpKeep">keep book</button>`
          : `<button class="rpMerge">re-pull</button>`}</td></tr>`;
  }).join('');
  container.innerHTML = `<table><tbody>${rows}</tbody></table>`;
  // wire buttons → POST /api/books/active/repull/:kind/:name
}
```

- [ ] **Step 2: Wire the re-pull buttons**

```js
async function doRepull(kind, name, resolution) {
  const r = await api('POST', `/api/books/active/repull/${kind}/${name}`, resolution ? { resolution } : {});
  if (r.hadConflicts) {
    notify('Re-pulled with conflicts — open the editor (This Book scope) to resolve the <<<<<<< markers and save.');
  } else {
    notify('Re-pulled cleanly.');
  }
  await renderRepull(/* container */);
  await refreshActiveBook();
}
```

(`notify` = the panel's existing toast/status helper; reuse whatever `books.js` already uses for user messages.)

- [ ] **Step 3: Build + commit**

Run: `npm run build:dashboard` → Expected: no errors.
```bash
git add dashboard/src/panels/books.js dashboard/dist/index.html
git commit -m "feat(repull): per-asset re-pull panel with status badges + conflict notice"
```

---

### Task 9: Final — review & update both e2e safety nets, run against deploy

**Files:**
- Modify: `tests/feature-smoke.sh`
- Modify: `tests/openrouter-pipeline.sh`

**Read both scripts fully first.** This task gates phase completion (spec "Final step — safety-net review & update").

- [ ] **Step 1: Add Phase 4 assertions to `tests/feature-smoke.sh`**

In the Tier A (cheap/no-LLM) section, after the existing library + books assertions, add:
1. **Library write round-trip:** `PUT /api/library/genre/smoke-tmp-<rand>` with `{"files":{"tropes.md":"smoke"}}` → expect `success`; `GET /api/library/genre/smoke-tmp-<rand>` → expect `source":"workspace"`; `DELETE` it → expect `success`; `GET` again → expect 404.
2. **Book-snapshot edit:** with the smoke book active, `GET /api/books/active/templates/author` → expect `files`; `PUT` it back → expect `success`.
3. **Re-pull status:** `GET /api/books/active/repull` → expect an `assets` array containing `author`.
4. **Re-pull clean merge:** edit the smoke book's **library** author (`PUT /api/library/author/<the book's author>` with a one-line change), then `GET .../repull` → expect `author` status `library-updated`; `POST /api/books/active/repull/author/<name>` → expect `"hadConflicts":false`.

Match the script's existing assertion helper (the `check`/`pass`/`fail` pattern) and increment the printed check count. Ensure the throwaway library genre entry and any edits are cleaned up; the book is already torn down by the existing `DELETE /api/books/:slug` teardown (CREATED_BOOKS).

- [ ] **Step 2: Review + refresh `tests/openrouter-pipeline.sh` against the new baseline**

Re-read the script end-to-end. Update it where Phase 4 changed behavior:
- If it reads generation outputs, confirm it still targets the active book's `data/` dir (Phase 3 path) — no Phase 4 change expected, but verify the assertions still hold given `.baseline/` now exists alongside `templates/` (the script must not assume `templates/` is the only subdir under a book, or that a book dir contains only `templates/`+`data/`).
- Confirm it still performs a real OpenRouter call (cheap model) end-to-end and cleans up its book via `DELETE /api/books/:slug`.
- Add a single Phase 4 line if cheap to do so: after the pipeline run, `GET /api/books/active/repull` returns `200` with an `assets` array (proves the rewired book exposes re-pull). Keep it free of extra paid calls.

- [ ] **Step 3: Run the unit suite + type-check locally**

Run: `npm run test:unit` → Expected: all pass.
Run: `npx tsc --noEmit` → Expected: no errors.

- [ ] **Step 4: Deploy + run both safety nets against the deployed build**

Deploy via the project's sentinel build (the maintainer's flow): `touch build_now` and wait for the Mercury build, OR ask the maintainer to deploy. Then:
Run: `bash tests/feature-smoke.sh -v` against the deployed host → Expected: all checks pass (record the count).
Run: `bash tests/openrouter-pipeline.sh` against the deployed host → Expected: pipeline completes; record pass counts and cost. (Free-tier OpenRouter can 429 under back-to-back runs — if early phases 429, that's rate-limiting, not a code failure; re-run spaced out.)

- [ ] **Step 5: Commit**

```bash
git add tests/feature-smoke.sh tests/openrouter-pipeline.sh
git commit -m "test(phase4): library-write + book-snapshot + re-pull e2e assertions; refresh pipeline baseline"
```

---

## Post-plan: docs + final review

After all tasks, before finishing:
- Move the Phase 4 TODO entry to `docs/COMPLETED.md` with today's date; update the Phase 4 line in `docs/BOOK-CONTAINER-ARCHITECTURE.md` to "Implemented".
- Update `gateway/src/api/routes/library.routes.ts` header comment (currently says the write path is Phase 4 / not built) to reflect it now exists.
- Write the `commit_message` file summarizing the whole phase for the maintainer's `./push.sh` (per repo workflow). Run the final code-review pass (e.g. `/code-review`) over the branch diff.

---

## Self-review notes (author)

- **Spec coverage:** merge helper (T1), baseline (T2), library CRUD (T3), book-snapshot edit (T4), re-pull engine (T5) + endpoints (T6), editor UI (T7), re-pull UI (T8), both safety nets (T9). All spec §1–§7 + final step mapped.
- **Type consistency:** `RepullAsset.kind` union, `RepullStatus`, `mergeText` signature, `LibraryWriteBody`, `writeEntry/createEntry/deleteOverlayEntry/overlayExists`, `bookDir/templatesDir/baselineDir` are defined once (T1/T2/T3/T5) and reused verbatim in routes (T4/T6) and UI (T7/T8).
- **Known follow-up for the implementer:** node-diff3's exact conflict-marker label format is verified in T1 Step 5 (adjust `label` if the library emits a different marker style); the `readAssetFrom` section/skill branch ordering is called out in T5 Step 4.
