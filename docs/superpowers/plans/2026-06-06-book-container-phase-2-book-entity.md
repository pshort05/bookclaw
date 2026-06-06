# Book-Container Phase 2 — Book entity + snapshot + version gate + New Book page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a **book** a first-class, self-contained container: `BookService.create()` snapshots chosen library templates into `workspace/books/<slug>/templates/`, a `book.json` manifest carries a `schemaVersion`, `BookService.open()` enforces a compatibility gate, a read/create REST API exposes it, and a dashboard **New Book** page lets the author pick components and create a book.

**Architecture:** `BookService` mirrors `LibraryService`'s place in the codebase and depends on it: to create a book it resolves the effective (user-overlay-or-built-in) library entries for the selected author/genre/pipeline/sections and **copies** them into the book's `templates/` snapshot (copy-on-create, no auto-propagation). Books live as plain directories under `workspace/books/<slug>/` (`book.json` + `templates/` + an empty `data/` for future outputs). The version gate classifies each book on open (in-range → ok; too-new → read-only; too-old → quarantine) — the data-protection core. Phase 2 **stores** books; it does **not** wire them into generation (`SoulService`/`ProjectEngine` still read the global soul + hardcoded pipelines — that's Phase 3).

**Tech Stack:** TypeScript (NodeNext, `.js` import extensions), Express, `node --test` via `tsx`, esbuild (dashboard), Docker.

**Source of truth for design:** `docs/BOOK-CONTAINER-ARCHITECTURE.md` — the `book.json` manifest sketch (lines ~113–135), the three resolution layers, the version gate table (~232–251), and the Phase 2 bullet. This plan implements the **lean** Phase 2 agreed 2026-06-06 (owner decisions below).

---

## Scope and decisions (owner, 2026-06-06)

**In scope:**
- `book.json` manifest + types; `BOOK_SCHEMA_VERSION = 1`.
- `BookService`: `create(selection)` (snapshot), `list()`, `get(slug)`, `open(slug)` (version gate), persistence under `workspace/books/`.
- **Version gate** (refuse too-old → quarantine; too-new → read-only; in-range → ok). Data-protection core — ships now.
- Read/create API: `GET /api/books`, `GET /api/books/:slug`, `POST /api/books`.
- **New Book dashboard page**: a "Books" nav panel listing existing books (with gate-status badge) + a creation form that pulls library components (via the Phase 1 `GET /api/library`) with per-component selection, then `POST /api/books`.

**Deferred (lean — nothing exercises them yet):**
- Migration *runners* (vN→vN+1 step chains, "upgrade book" command/UI) and existing-data migration — there is no v2 schema and no existing projects/soul data to convert. The version *gate* still ships; only the step machinery waits for a real schema bump.
- **Skills in the book snapshot** — skills only matter once injected into a book's pipeline (Phase 3); deferring avoids plumbing per-book skill-category trees now. The library still *lists* skills; they just don't join the snapshot in Phase 2.
- Backup/recovery (Phase 6), share/import (Phase 5), per-book edit/re-pull (Phase 4).

**Out of scope (Phase 3):** wiring `SoulService`/`ProjectEngine` to read the active book; an "active book" concept; making book creation change generation behavior.

**Baked-in implementation decisions (stated, not silently chosen):**
- **Snapshot covers author + genre + pipeline + sections.** Author/genre are directories of `.md` (copied file-by-file); pipeline is a single `pipeline.json`; sections are individual `.md`.
- **Selection model** (`POST /api/books` body): `{ title (req), author (req, default "default"), genre (string|null), pipeline (req), sections (string[], default = all available) }`. Author/genre/pipeline are singular (a book has one of each); sections are multi.
- **Slug** derived from title (lowercase, non-alphanumeric → `-`, trimmed, ≤60 chars); uniqueness-checked against existing `workspace/books/` dirs (append `-2`, `-3`, …); empty → `book`.
- **`status` (ok/readonly/quarantined) is computed at open from the gate, not stored.** `phase` defaults to `"planning"`. `history` starts `[]`.
- **No index file** — `workspace/books/` IS the store; `list()` scans `*/book.json`.
- **`safePath`** guards every book path against the `workspace/books` base; the slug is regex-validated before use.

## File structure

**Create:**
- `gateway/src/services/book-types.ts` — `BookManifest`, `BookStatus`, `BookSummary`, `BOOK_SCHEMA_VERSION`, `BOOK_SUPPORTED` range, `slugify`.
- `gateway/src/services/book.ts` — `BookService`.
- `gateway/src/api/routes/books.routes.ts` — `mountBooks` (GET list, GET one, POST create).
- `dashboard/src/panels/books.js` — the New Book + book-list panel.
- `tests/unit/book.test.ts` — slug, gate classification, create-snapshot, list.
- `tests/unit/book-slug.test.ts` — (folded into book.test.ts; see Task 1) — *not a separate file; ignore.*

**Modify:**
- `gateway/src/index.ts` — `public books!: BookService;` field + import + `getServices()` entry.
- `gateway/src/init/phase-05-research-skills.ts` — construct `gw.books` after `gw.library`.
- `gateway/src/api/routes.ts` — import + `mountBooks(...)`.
- `gateway/src/services/library.ts` — **no change expected** (skills deferred; author/genre/section/pipeline reads already return `files`/`content`/`pipeline`). If `get('author'|'genre')` doesn't return `files`, that's a Phase-1 bug to fix here — verify in Task 2.
- `tests/api/api-test.sh` — books endpoint assertions.
- `dashboard/src/index.html` — add a "Books" nav item + an empty `<div class="panel" id="panel-books">`.
- `dashboard/src/main.js` — import `loadBooks`, add `books` to `panelTitles`, add a `switchPanel` case.
- `CLAUDE.md` — "Stateful directories": add `workspace/books/`.
- `docs/BOOK-CONTAINER-ARCHITECTURE.md` / `docs/TODO.md` — Phase 2 status (on completion).

---

### Task 1: `book-types.ts` — manifest types, version constants, slug

**Files:** Create `gateway/src/services/book-types.ts`; Test `tests/unit/book.test.ts` (slug + gate cases).

- [ ] **Step 1: Write the failing test** — `tests/unit/book.test.ts` (slug + gate portion first):

```ts
/**
 * Unit tests for the book entity (book-container Phase 2): slug derivation,
 * the version-gate classification, and BookService create/list/open over a
 * real temp library + books dir. Network-free.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugify, classifyVersion, BOOK_SCHEMA_VERSION } from '../../gateway/src/services/book-types.js';

test('slugify normalizes titles and is non-empty', () => {
  assert.equal(slugify("The Dragon's Heir"), 'the-dragon-s-heir');
  assert.equal(slugify('  Hello,  World!! '), 'hello-world');
  assert.equal(slugify('***'), 'book'); // empty result falls back
  assert.equal(slugify('a'.repeat(100)).length, 60); // capped
});

test('classifyVersion gates by supported range', () => {
  // CURRENT = BOOK_SCHEMA_VERSION; supported [1, CURRENT].
  assert.equal(classifyVersion(BOOK_SCHEMA_VERSION), 'ok');
  assert.equal(classifyVersion(BOOK_SCHEMA_VERSION + 1), 'readonly'); // too new → read-only
  assert.equal(classifyVersion(0), 'quarantined');                    // too old → quarantine
});
```

- [ ] **Step 2: Run to verify it fails** — `npm run test:unit 2>&1 | grep -A2 'book\.test'` → FAIL (cannot find `book-types.js`).

- [ ] **Step 3: Implement `book-types.ts`:**

```ts
/**
 * Types + constants for the book entity (book-container Phase 2).
 *
 * A book is a self-contained directory: book.json manifest + templates/ snapshot
 * + data/ outputs. schemaVersion gates compatibility (fail-closed per book).
 */

/** Bump ONLY when book.json / the container layout changes in a breaking way. */
export const BOOK_SCHEMA_VERSION = 1;
/** Oldest book schema this app can open without migration. */
export const BOOK_MIN_SUPPORTED = 1;

/** Gate outcome for a book on open. */
export type BookStatus = 'ok' | 'readonly' | 'quarantined';

/** Provenance for one snapshotted component. */
export interface PulledRef {
  name: string;
  source: 'builtin' | 'workspace' | 'synthetic';
  version?: number; // pipelines carry one; prose templates don't
}

export interface BookManifest {
  id: string;                 // stable id (= slug at creation)
  slug: string;               // dir name under workspace/books/
  title: string;
  schemaVersion: number;      // THE compatibility gate
  createdByApp: string;       // provenance only — never gates
  lastWrittenByApp: string;   // provenance only
  phase: 'planning' | 'bible' | 'production' | 'revision' | 'format' | 'launch';
  createdAt: string;          // ISO
  pulledFrom: {
    author: PulledRef;
    genre?: PulledRef | null;
    pipeline: PulledRef;
    sections: string[];       // section names snapshotted
  };
  history: Array<{ at: string; event: string; detail?: string }>;
}

/** A book + its computed gate status (status is not stored in book.json). */
export interface BookSummary {
  slug: string;
  title: string;
  phase: string;
  schemaVersion: number;
  status: BookStatus;
  createdAt: string;
}

/** Classify a stored schemaVersion against this app's supported range. */
export function classifyVersion(v: number): BookStatus {
  if (v < BOOK_MIN_SUPPORTED) return 'quarantined'; // too old for this app
  if (v > BOOK_SCHEMA_VERSION) return 'readonly';    // written by a newer app
  return 'ok';
}

/** Derive a filesystem-safe slug from a title. Never returns ''. */
export function slugify(title: string): string {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'book';
}
```

- [ ] **Step 4: Run to verify pass** — `npm run test:unit 2>&1 | grep -A2 'book\.test'` → the two tests PASS. **Step 5: `npx tsc --noEmit`** → clean.

- [ ] **Step 6: Commit-message note** — do NOT commit (per repo workflow: work on `main`, write `commit_message`, maintainer runs `./push.sh`). Accumulate changes; the final task writes `commit_message`.

---

### Task 2: `BookService` — create (snapshot), list, get, open (gate)

**Files:** Create `gateway/src/services/book.ts`; extend `tests/unit/book.test.ts`.

First **verify the LibraryService read shapes** the snapshot relies on: `get('author', name)` and `get('genre', name)` must return `{ files: Record<string,string> }`; `get('pipeline', name)` returns `{ pipeline: {...} }`; `get('section', name)` returns `{ content: string }`. (These were implemented in Phase 1 `gateway/src/services/library.ts`.) If any is missing, fix it minimally here and note it.

- [ ] **Step 1: Write the failing test** (append to `tests/unit/book.test.ts`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'default soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'genres/romantasy/tropes.md', 'romantasy tropes');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  write(builtin, 'sections/front-matter.md', 'FRONT');
  write(builtin, 'sections/back-matter.md', 'BACK');
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

test('BookService.create snapshots selected templates and writes a manifest', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root);
    await lib.loadAll();
    const booksDir = join(root, 'workspace', 'books');
    const svc = new BookService(booksDir, lib, '9.9.9');

    const created = await svc.create({
      title: "The Dragon's Heir",
      author: 'default',
      genre: 'romantasy',
      pipeline: 'novel-pipeline',
      sections: ['front-matter', 'back-matter'],
    });

    assert.equal(created.slug, 'the-dragon-s-heir');
    const dir = join(booksDir, created.slug);
    // Manifest correct
    const manifest = JSON.parse(readFileSync(join(dir, 'book.json'), 'utf-8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.title, "The Dragon's Heir");
    assert.equal(manifest.pulledFrom.author.name, 'default');
    assert.equal(manifest.pulledFrom.pipeline.name, 'novel-pipeline');
    assert.deepEqual(manifest.pulledFrom.sections, ['front-matter', 'back-matter']);
    // Snapshot copied
    assert.ok(readFileSync(join(dir, 'templates/author/SOUL.md'), 'utf-8').includes('default soul'));
    assert.ok(readFileSync(join(dir, 'templates/genre/tropes.md'), 'utf-8').includes('romantasy tropes'));
    assert.ok(existsSync(join(dir, 'templates/pipeline.json')));
    assert.ok(readFileSync(join(dir, 'templates/sections/front-matter.md'), 'utf-8').includes('FRONT'));
    // data/ created for future outputs
    assert.ok(existsSync(join(dir, 'data')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('BookService.create de-duplicates slugs and validates inputs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const a = await svc.create({ title: 'Same', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const b = await svc.create({ title: 'Same', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(a.slug, 'same');
    assert.equal(b.slug, 'same-2');
    // Unknown author / pipeline rejected
    await assert.rejects(() => svc.create({ title: 'X', author: 'nope', genre: null, pipeline: 'novel-pipeline', sections: [] }), /author/i);
    await assert.rejects(() => svc.create({ title: 'X', author: 'default', genre: null, pipeline: 'nope', sections: [] }), /pipeline/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('BookService.list returns summaries with computed gate status', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-book-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const booksDir = join(root, 'workspace', 'books');
    const svc = new BookService(booksDir, lib, '9.9.9');
    await svc.create({ title: 'Good Book', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    // Hand-write a too-new book to exercise the gate.
    const dir = join(booksDir, 'future-book');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'book.json'), JSON.stringify({ slug: 'future-book', title: 'Future', phase: 'planning', schemaVersion: 999, createdAt: '2026-01-01T00:00:00Z' }));

    const list = svc.list();
    const good = list.find(b => b.slug === 'good-book');
    const future = list.find(b => b.slug === 'future-book');
    assert.equal(good?.status, 'ok');
    assert.equal(future?.status, 'readonly'); // schemaVersion 999 > current
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify it fails** — `npm run test:unit 2>&1 | grep -A2 'BookService'` → FAIL (no `book.js`).

- [ ] **Step 3: Implement `gateway/src/services/book.ts`:**

```ts
/**
 * BookClaw Book Service (book-container Phase 2).
 *
 * A book is a self-contained directory under workspace/books/<slug>/:
 *   book.json      — manifest (schemaVersion gates compatibility)
 *   templates/     — SNAPSHOT copied from the resolved library at create time
 *     author/*.md  genre/*.md  pipeline.json  sections/*.md
 *   data/          — generated outputs (populated from Phase 3 on)
 *
 * Phase 2 STORES books; it does not wire them into generation (Phase 3). Skills
 * are not snapshotted yet (Phase 3/4). Reads/writes go through safePath.
 */
import { readdir, readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { LibraryService } from './library.js';
import {
  BOOK_SCHEMA_VERSION, slugify, classifyVersion,
  type BookManifest, type BookSummary, type PulledRef,
} from './book-types.js';

export interface BookSelection {
  title: string;
  author: string;          // library author name
  genre: string | null;    // library genre name, or null
  pipeline: string;        // library pipeline name
  sections: string[];      // library section names
}

export class BookService {
  private booksDir: string;
  private library: LibraryService;
  private appVersion: string;

  constructor(booksDir: string, library: LibraryService, appVersion: string) {
    this.booksDir = booksDir;
    this.library = library;
    this.appVersion = appVersion;
  }

  async initialize(): Promise<void> {
    await mkdir(this.booksDir, { recursive: true });
  }

  /** Create a book: resolve + snapshot the selected library templates. */
  async create(sel: BookSelection): Promise<BookManifest> {
    const title = String(sel.title || '').trim();
    if (!title) throw new Error('title is required');

    // Resolve components up-front so we fail before writing anything.
    const author = this.library.get('author', sel.author);
    if (!author || !author.files) throw new Error(`Unknown author template: ${sel.author}`);
    const pipeline = this.library.get('pipeline', sel.pipeline);
    if (!pipeline || !pipeline.pipeline) throw new Error(`Unknown pipeline template: ${sel.pipeline}`);
    let genre = null as ReturnType<LibraryService['get']> | null;
    if (sel.genre) {
      genre = this.library.get('genre', sel.genre);
      if (!genre || !genre.files) throw new Error(`Unknown genre template: ${sel.genre}`);
    }
    const sectionEntries = (sel.sections || []).map((name) => {
      const s = this.library.get('section', name);
      if (!s || typeof s.content !== 'string') throw new Error(`Unknown section template: ${name}`);
      return { name, content: s.content };
    });

    const slug = this.uniqueSlug(slugify(title));
    const dir = join(this.booksDir, slug);
    const now = new Date().toISOString();

    // Snapshot author files
    await mkdir(join(dir, 'templates', 'author'), { recursive: true });
    for (const [file, content] of Object.entries(author.files)) {
      await writeFile(join(dir, 'templates', 'author', file), content, 'utf-8');
    }
    // Snapshot genre files
    if (genre && genre.files) {
      await mkdir(join(dir, 'templates', 'genre'), { recursive: true });
      for (const [file, content] of Object.entries(genre.files)) {
        await writeFile(join(dir, 'templates', 'genre', file), content, 'utf-8');
      }
    }
    // Snapshot pipeline (single JSON)
    await writeFile(join(dir, 'templates', 'pipeline.json'), JSON.stringify(pipeline.pipeline, null, 2) + '\n', 'utf-8');
    // Snapshot sections
    if (sectionEntries.length) {
      await mkdir(join(dir, 'templates', 'sections'), { recursive: true });
      for (const s of sectionEntries) {
        await writeFile(join(dir, 'templates', 'sections', `${s.name}.md`), s.content, 'utf-8');
      }
    }
    // data/ for future outputs
    await mkdir(join(dir, 'data'), { recursive: true });

    const ref = (e: { name: string; source: PulledRef['source']; version?: number }): PulledRef =>
      ({ name: e.name, source: e.source, ...(e.version != null ? { version: e.version } : {}) });

    const manifest: BookManifest = {
      id: slug,
      slug,
      title,
      schemaVersion: BOOK_SCHEMA_VERSION,
      createdByApp: this.appVersion,
      lastWrittenByApp: this.appVersion,
      phase: 'planning',
      createdAt: now,
      pulledFrom: {
        author: ref({ name: sel.author, source: author.source }),
        genre: genre ? ref({ name: sel.genre as string, source: genre.source }) : null,
        pipeline: ref({ name: sel.pipeline, source: pipeline.source, version: pipeline.pipeline.schemaVersion }),
        sections: sectionEntries.map((s) => s.name),
      },
      history: [{ at: now, event: 'created' }],
    };
    await writeFile(join(dir, 'book.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    return manifest;
  }

  /** All books as summaries, each with a computed gate status. Skips unreadable dirs. */
  list(): BookSummary[] {
    if (!existsSync(this.booksDir)) return [];
    const out: BookSummary[] = [];
    // Sync read is fine here (small dir; called by API handlers); mirror skill/library style if you prefer async.
    const entries = require('fs').readdirSync(this.booksDir, { withFileTypes: true }) as Array<{ isDirectory(): boolean; name: string }>;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const mf = join(this.booksDir, e.name, 'book.json');
      if (!existsSync(mf)) continue;
      try {
        const m = JSON.parse(require('fs').readFileSync(mf, 'utf-8'));
        out.push({
          slug: m.slug || e.name,
          title: m.title || e.name,
          phase: m.phase || 'planning',
          schemaVersion: m.schemaVersion ?? 0,
          status: classifyVersion(m.schemaVersion ?? 0),
          createdAt: m.createdAt || '',
        });
      } catch (err) {
        console.warn(`  ⚠ Books: could not read ${e.name}/book.json — skipping`, err);
      }
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Read one book's manifest + computed status, or undefined if absent/unreadable. */
  async open(slug: string): Promise<{ manifest: BookManifest; status: BookSummary['status'] } | undefined> {
    const mf = join(this.booksDir, slug, 'book.json');
    if (!existsSync(mf)) return undefined;
    try {
      const manifest = JSON.parse(await readFile(mf, 'utf-8')) as BookManifest;
      return { manifest, status: classifyVersion(manifest.schemaVersion ?? 0) };
    } catch {
      return undefined;
    }
  }

  private uniqueSlug(base: string): string {
    if (!existsSync(join(this.booksDir, base))) return base;
    for (let i = 2; i < 1000; i++) {
      const cand = `${base}-${i}`;
      if (!existsSync(join(this.booksDir, cand))) return cand;
    }
    return `${base}-${Date.now()}`;
  }
}
```

> Note: `list()`/`uniqueSlug` use `existsSync` + synchronous reads for simplicity (small directory, called from request handlers). If the reviewer prefers, convert `list()` to async `readdir`/`readFile` to match `LibraryService` style — behavior identical. The `require('fs')` calls can be replaced with top-level `import { readdirSync, readFileSync } from 'fs'`; prefer the import form — **use `import { readdirSync, readFileSync } from 'fs'` and drop the `require` calls** (NodeNext: `require` is not idiomatic here).

- [ ] **Step 4: Replace the `require('fs')` calls with proper imports** (add `readdirSync, readFileSync` to the `import ... from 'fs'` line; use them directly). Re-run.

- [ ] **Step 5: Run tests to verify pass** — `npm run test:unit 2>&1 | grep -E 'BookService|# (tests|pass|fail)'` → all pass. **Step 6: `npx tsc --noEmit`** → clean.

---

### Task 3: Wire `BookService` into init + `getServices()`

**Files:** Modify `gateway/src/index.ts`, `gateway/src/init/phase-05-research-skills.ts`.

- [ ] **Step 1: `index.ts`** — add import near `LibraryService`:
```ts
import { BookService } from './services/book.js';
```
add field after `public library!: LibraryService;`:
```ts
  public books!: BookService;
```
add to `getServices()` after `library: this.library,`:
```ts
      books: this.books,
```

- [ ] **Step 2: `phase-05-research-skills.ts`** — add import:
```ts
import { BookService } from '../services/book.js';
```
and after the `✓ Library:` block, construct + initialize (read app version from package.json the same way the gateway banner does, or pass a constant; simplest: import the version the gateway already loads — if not readily available, use `process.env.npm_package_version || '0.0.0'`). Use:
```ts
  gw.books = new BookService(
    join(ROOT_DIR, 'workspace', 'books'),
    gw.library,
    gw.appVersion || '0.0.0',
  );
  await gw.books.initialize();
  console.log(`  ✓ Books: ${gw.books.list().length} book(s)`);
```
**Before writing this, grep `index.ts` for how the app version is held** (e.g. a `this.version` / banner string / package.json read). If there's a gateway field like `this.version`, expose it as `gw.appVersion` or pass that field; otherwise read `package.json` once. Pick the existing mechanism — do not add a second package.json read if one exists. Report what you used.

- [ ] **Step 3: `npx tsc --noEmit`** → clean. **Step 4: boot-verify on an isolated port** (NOT 3847 — live container) per the Phase-1 method:
```bash
BOOKCLAW_BIND=127.0.0.1 BOOKCLAW_PORT=4944 BOOKCLAW_AUTH_TOKEN=tmp \
  timeout 25 node --import tsx gateway/src/index.ts > /tmp/bc-p2-boot.log 2>&1 &
BP=$!; sleep 12; grep -E '✓ (Library|Books):' /tmp/bc-p2-boot.log || true
kill $BP 2>/dev/null; wait $BP 2>/dev/null; pkill -9 -f 'BOOKCLAW_PORT=4944' 2>/dev/null; rm -f /tmp/bc-p2-boot.log
```
Expect a `✓ Books: 0 book(s)` line and no crash. Confirm port 4944 freed and the 3847 container untouched.

---

### Task 4: Books API — `GET /api/books`, `GET /api/books/:slug`, `POST /api/books`

**Files:** Create `gateway/src/api/routes/books.routes.ts`; modify `gateway/src/api/routes.ts`; extend `tests/api/api-test.sh`.

- [ ] **Step 1: Implement `books.routes.ts`:**
```ts
import { Application, Request, Response } from 'express';

/**
 * Books API (book-container Phase 2). Read + create. No edit/delete yet (Phase 4).
 * Behind the same bearer-auth + IP allowlist as the rest of /api/*.
 */
export function mountBooks(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  app.get('/api/books', (_req: Request, res: Response) => {
    res.json({ books: services.books.list() });
  });

  app.get('/api/books/:slug', async (req: Request, res: Response) => {
    const result = await services.books.open(String(req.params.slug));
    if (!result) return res.status(404).json({ error: 'Book not found' });
    res.json({ book: result.manifest, status: result.status });
  });

  app.post('/api/books', async (req: Request, res: Response) => {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'title (string) is required' });
    if (typeof body.author !== 'string' || !body.author) return res.status(400).json({ error: 'author (string) is required' });
    if (typeof body.pipeline !== 'string' || !body.pipeline) return res.status(400).json({ error: 'pipeline (string) is required' });
    const genre = (typeof body.genre === 'string' && body.genre) ? body.genre : null;
    const sections = Array.isArray(body.sections) ? body.sections.filter((s: unknown) => typeof s === 'string') : [];
    try {
      const manifest = await services.books.create({ title, author: body.author, genre, pipeline: body.pipeline, sections });
      res.json({ success: true, book: manifest });
    } catch (err) {
      // Unknown-template errors are client errors (400); anything else is 500.
      const msg = (err as Error)?.message || String(err);
      res.status(/unknown|required/i.test(msg) ? 400 : 500).json({ error: msg });
    }
  });
}
```

- [ ] **Step 2: Mount in `routes.ts`** — add import after `mountLibrary`:
```ts
import { mountBooks } from './routes/books.routes.js';
```
and the call after `mountLibrary(app, gateway, baseDir);`:
```ts
  mountBooks(app, gateway, baseDir);
```

- [ ] **Step 3: API assertions** — append to `tests/api/api-test.sh` (use the file's real `has_status`/`body_has` helpers, matching the Phase-1 library block style):
```sh
# ── Books (book-container Phase 2) ──
log ""
log "books"
has_status "/api/books" "200" "books list -> 200"
body_has   "/api/books" '"books"' "books list shape"
has_status "/api/books/no-such-book" "404" "unknown book -> 404"
# POST validation (missing title) -> 400
check_post_status "/api/books" '{}' "400" "create without title -> 400"
```
**Read `tests/api/api-test.sh` first** to confirm the helper names and whether a POST helper exists. If there is no POST helper (`check_post_status` above is illustrative), either add a minimal one consistent with the file's style or assert the POST with an inline `curl -s -o /dev/null -w '%{http_code}' -X POST -H "$AUTH" -H 'Content-Type: application/json' -d '{}' "$BASE/api/books"` compared to 400. Keep it hermetic (do not create real books on the shared instance — the missing-title case 400s before writing; do NOT POST a valid create in the API test, to avoid leaving a book behind).

- [ ] **Step 4: Run API test on an isolated port** (NOT 3847) via the throwaway-copy method used in Phase 1 (copy `tests/api/api-test.sh` into `tests/api/`, set `PORT` + `BOOKCLAW_PORT` to a free port, run, delete the copy). Also `npm run test:unit`. **Step 5: `npx tsc --noEmit`** → clean. Confirm no book was created on disk by the test and no temp copy left behind.

---

### Task 5: New Book dashboard page

**Files:** Create `dashboard/src/panels/books.js`; modify `dashboard/src/index.html`, `dashboard/src/main.js`.

- [ ] **Step 1: `index.html`** — add a nav item after the `library` nav item (around line 45-48):
```html
    <div class="nav-item" data-panel="books">
      <span class="nav-icon">📚</span> Books
    </div>
```
(Match the existing `nav-item` markup — copy the structure of an adjacent item, e.g. the `library` one, including whatever icon span pattern it uses.) And add an empty panel div near the other panels (e.g. after `panel-library`):
```html
    <div class="panel" id="panel-books"></div>
```
**Read the existing nav-item + panel markup first** and mirror it exactly (icon element, classes).

- [ ] **Step 2: `main.js`** — add the import with the other panel imports:
```js
import { loadBooks } from './panels/books.js';
```
add `books: 'Books'` to the `panelTitles` object; add a `switchPanel` case:
```js
  } else if (name === 'books') {
    loadBooks();
```

- [ ] **Step 3: Implement `dashboard/src/panels/books.js`:**
```js
// Books panel (book-container Phase 2): list existing books and create a new one
// by selecting library components. Backed by /api/books and /api/library.
import { api } from '../lib/api.js';
import { showToast } from '../lib/ui.js';
import { esc } from '../lib/format.js';

function statusBadge(status) {
  const map = { ok: 'var(--success)', readonly: 'var(--info)', quarantined: 'var(--danger)' };
  const color = map[status] || 'var(--muted)';
  return '<span class="badge" style="font-size:9px;background:transparent;border:1px solid ' + color + ';color:' + color + ';">' + esc(status) + '</span>';
}

export async function loadBooks() {
  const root = document.getElementById('panel-books');
  if (!root) return;
  root.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
      '<h3 style="margin:0;flex:1;">Books</h3>' +
      '<button class="small" id="bkNew">+ New Book</button>' +
    '</div>' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;">A book is a self-contained container. Creating one snapshots the chosen library templates into the book; editing the library later does not change existing books (Phase 4 adds re-pull). Books do not drive generation yet — that lands in a later phase.</div>' +
    '<div id="bkList"></div>' +
    '<div id="bkCreate" style="display:none;margin-top:16px;border-top:1px solid var(--border);padding-top:16px;"></div>';

  root.querySelector('#bkNew').addEventListener('click', () => openCreate());
  await renderList();
}

async function renderList() {
  const el = document.getElementById('bkList');
  if (!el) return;
  let data = { books: [] };
  try { data = await api('GET', '/api/books'); }
  catch (e) { el.innerHTML = '<div style="color:var(--danger);">Failed to load books: ' + esc(e.message) + '</div>'; return; }
  if (!data.books.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px;">No books yet. Click “New Book” to create one.</div>'; return; }
  let html = '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
  html += '<tr style="text-align:left;color:var(--muted);font-size:11px;text-transform:uppercase;"><th style="padding:6px 8px;">Title</th><th>Phase</th><th>Status</th><th>Created</th></tr>';
  for (const b of data.books) {
    html += '<tr style="border-top:1px solid var(--border);">' +
      '<td style="padding:6px 8px;">' + esc(b.title) + ' <span style="color:var(--muted);font-size:11px;">' + esc(b.slug) + '</span></td>' +
      '<td>' + esc(b.phase) + '</td>' +
      '<td>' + statusBadge(b.status) + '</td>' +
      '<td style="color:var(--muted);">' + esc((b.createdAt || '').slice(0, 10)) + '</td>' +
      '</tr>';
  }
  html += '</table>';
  el.innerHTML = html;
}

async function openCreate() {
  const box = document.getElementById('bkCreate');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '<div style="color:var(--muted);font-size:13px;">Loading library components…</div>';

  let lib;
  try { lib = await api('GET', '/api/library'); }
  catch (e) { box.innerHTML = '<div style="color:var(--danger);">Failed to load library: ' + esc(e.message) + '</div>'; return; }

  const byKind = { author: [], genre: [], pipeline: [], section: [] };
  for (const e of (lib.entries || [])) { if (byKind[e.kind]) byKind[e.kind].push(e); }

  const opts = (arr) => arr.map((e) => '<option value="' + esc(e.name) + '">' + esc(e.name) + ' (' + esc(e.source) + ')</option>').join('');
  const sectionChecks = byKind.section.map((e) =>
    '<label style="display:block;font-size:13px;"><input type="checkbox" class="bkSection" value="' + esc(e.name) + '" checked> ' + esc(e.name) + '</label>').join('') || '<span style="color:var(--muted);font-size:12px;">none</span>';

  box.innerHTML =
    '<h4 style="margin:0 0 12px;">New Book</h4>' +
    '<div style="display:grid;grid-template-columns:120px 1fr;gap:10px 12px;max-width:560px;align-items:center;">' +
      '<label>Title</label><input id="bkTitle" type="text" placeholder="My Novel" style="width:100%;">' +
      '<label>Author</label><select id="bkAuthor">' + opts(byKind.author) + '</select>' +
      '<label>Genre</label><select id="bkGenre"><option value="">(none)</option>' + opts(byKind.genre) + '</select>' +
      '<label>Pipeline</label><select id="bkPipeline">' + opts(byKind.pipeline) + '</select>' +
      '<label style="align-self:start;">Sections</label><div>' + sectionChecks + '</div>' +
    '</div>' +
    '<div style="margin-top:14px;display:flex;gap:8px;">' +
      '<button class="small" id="bkCreateBtn">Create book</button>' +
      '<button class="small secondary" id="bkCancel">Cancel</button>' +
    '</div>' +
    '<div id="bkErr" style="color:var(--danger);font-size:12px;margin-top:8px;"></div>';

  box.querySelector('#bkCancel').addEventListener('click', () => { box.style.display = 'none'; box.innerHTML = ''; });
  box.querySelector('#bkCreateBtn').addEventListener('click', () => submitCreate(box));
}

async function submitCreate(box) {
  const title = box.querySelector('#bkTitle').value.trim();
  const author = box.querySelector('#bkAuthor').value;
  const genre = box.querySelector('#bkGenre').value || null;
  const pipeline = box.querySelector('#bkPipeline').value;
  const sections = Array.from(box.querySelectorAll('.bkSection:checked')).map((c) => c.value);
  const err = box.querySelector('#bkErr');
  err.textContent = '';
  if (!title) { err.textContent = 'Title is required.'; return; }
  if (!author) { err.textContent = 'Pick an author (the library has none — create one first).'; return; }
  if (!pipeline) { err.textContent = 'Pick a pipeline.'; return; }
  try {
    const res = await api('POST', '/api/books', { title, author, genre, pipeline, sections });
    showToast('Created book: ' + res.book.title, 'success');
    box.style.display = 'none'; box.innerHTML = '';
    await renderList();
  } catch (e) {
    err.textContent = 'Create failed: ' + e.message;
  }
}
```

- [ ] **Step 4: Build the dashboard** — `npm run build:dashboard` → clean; confirm the `__BOOKCLAW_AUTH_TOKEN__` placeholder still present in `dashboard/dist/index.html` and that `loadBooks` is bundled (grep the dist for `panel-books`). **Step 5: `npm run test:unit && npx tsc --noEmit`** → green/clean (the dist is committed; the build regenerates it).

> No headless click-test is required here; acceptance is a human click-through on Mercury after deploy (Task 6). The build guard + the API tests cover the wiring.

---

### Task 6: Docs, tracking, and hand-off for push

**Files:** `CLAUDE.md`, `docs/BOOK-CONTAINER-ARCHITECTURE.md`, `docs/TODO.md`, `docs/BOOK-CONTAINER-PHASE-2-STATUS.md` (create), and `commit_message`.

- [ ] **Step 1: `CLAUDE.md`** — in "Stateful directories", add:
```markdown
- `workspace/books/<slug>/` — per-book container: `book.json` manifest (`schemaVersion`-gated) + `templates/` snapshot (author/genre/pipeline/sections, copied from the library at create time) + `data/` outputs. Created by `BookService` (book-container Phase 2). Not yet driving generation (Phase 3).
```
(And confirm `workspace/books/` is gitignored — it should already be covered; if not, add it. Check `git check-ignore workspace/books/x/book.json`.)

- [ ] **Step 2: `docs/BOOK-CONTAINER-ARCHITECTURE.md`** — mark the Phase 2 bullet implemented (lean: entity + snapshot + gate + API + New Book page; migration runners + skills-in-snapshot deferred), dated, mirroring the Phase 1 style.

- [ ] **Step 3: `docs/TODO.md`** — under the multi-author umbrella, mark Phase 2 done (lean) and note deferrals (migration runners; skills join the book snapshot in Phase 3/4). Move nothing to COMPLETED until deployed + accepted.

- [ ] **Step 4: Create `docs/BOOK-CONTAINER-PHASE-2-STATUS.md`** — phase table, decisions (lean scope; skills deferred; snapshot covers author/genre/pipeline/sections), how-to-resume, deploy steps. Mirror the Phase 1 status file.

- [ ] **Step 5: Write `commit_message`** (root) so the maintainer can `./push.sh`:
```
feat(books): book entity + snapshot-on-create + version gate + New Book page (Phase 2)

- BookService.create snapshots selected library templates (author/genre/pipeline/sections) into workspace/books/<slug>/templates/ + book.json manifest; list/open enforce the schemaVersion compatibility gate (too-old → quarantine, too-new → read-only)
- API: GET /api/books, GET /api/books/:slug, POST /api/books
- dashboard: New Book panel — pick library components, create a book; lists books with gate-status badges
- lean scope: migration runners + skills-in-snapshot deferred (no v2 schema / skills wired yet); books do not drive generation until Phase 3
```
- [ ] **Step 6: Do NOT run git/push.** Report that the work is staged-in-working-tree and the maintainer should run `./push.sh`. Then deploy (`touch build_now`) is the maintainer's separate step; after deploy, human click-through: open the Books panel, create a book, confirm it lists with `ok` status and the files exist under `workspace/books/<slug>/`.

---

## Self-review

**Spec coverage:** book.json + types (T1) · BookService create/snapshot/list/open + gate (T2) · init wiring (T3) · API (T4) · New Book page (T5) · docs/tracking/push hand-off (T6). Version gate ships (T1 classify + T2 list/open). Skills-in-snapshot + migration runners explicitly deferred. ✓

**Placeholder scan:** the API-test POST helper (`check_post_status`) is flagged as "confirm/adapt to the file's real helpers" — an integration instruction, not a code placeholder. The `require('fs')` in the BookService draft is explicitly called out to be replaced with `import { readdirSync, readFileSync } from 'fs'` in T2 Step 4. The app-version source in T3 is "grep for the existing mechanism" — resolve at implementation. No silent TBDs in shipped code. ✓

**Type consistency:** `BookManifest`/`BookSummary`/`BookStatus`/`PulledRef`/`BookSelection` are used identically across `book-types.ts`, `book.ts`, `books.routes.ts`, and the tests. `BookService(booksDir, library, appVersion)` matches the test and the T3 construction. `classifyVersion`/`slugify`/`BOOK_SCHEMA_VERSION` exports match their importers. ✓

**Risk notes for the executor:**
- Verify `LibraryService.get('author'|'genre')` returns `files` and `get('section')` returns `content` and `get('pipeline')` returns `pipeline` (Phase 1). If not, fix minimally in T2 and note it.
- Keep the API test hermetic: assert the **400 (missing title)** path only; do NOT POST a valid create against the shared instance (it would leave a book on disk). Valid-create is covered by the unit test against a temp dir.
- Per repo workflow: work on `main`, do **not** `git commit`/`git push`; accumulate changes and write `commit_message` (T6). The maintainer runs `./push.sh`.
