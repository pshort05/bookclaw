# Book-Container Phase 3 — Per-book wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan. Each task is bite-sized and independently verifiable; complete tasks in order, run the Verify gate after each, and STOP if a gate fails.

**Goal:** Make the active **Book** the single source of the **Author** identity, the **Pipeline**, and the output location, so generation runs against a book's own snapshot (`workspace/books/<slug>/`) instead of the global singletons (`workspace/soul/`, the hardcoded `PROJECT_TEMPLATES`, `workspace/projects/<id>/`).

**Architecture:** A global active-book pointer (`workspace/.config/active-book.json`) is resolved once and drives three things: `SoulService` reads the book's `templates/author/` (via a new `useBook()`), the engine builds **Steps** from the book's `templates/pipeline.json` (dynamic `novel-pipeline` still code-generated), and all step/chapter/manuscript output writes land under the book's `data/`. The caller (routes / index) resolves the active book and passes its pipeline definition + data dir into the engine, keeping `ProjectEngine` decoupled from `BookService`. Per decision 6, runs are NOT gated on book `status` — the gate stays an informational badge only.

**Tech Stack:** TypeScript (NodeNext, `.js` import extensions), Node `node:test` via `tsx` (`npm run test:unit`), Express routes, vanilla-JS dashboard built with `node dashboard/build.mjs` (`npm run build:dashboard`). Verify with `npx tsc --noEmit`.

---

## File Structure

**Created**
- `tests/unit/active-book.test.ts` — unit coverage for `getActiveBook`/`setActiveBook` persistence + Default Book seed.
- `tests/unit/soul-usebook.test.ts` — unit coverage for `SoulService.useBook()` re-point + fail-soft fallback.
- `tests/unit/pipeline-from-json.test.ts` — unit coverage for `ProjectEngine.createProjectFromPipeline()` reading a `LibraryPipeline`.
- `commit_message` — final maintainer hand-off message (maintainer runs `./push.sh`).

**Modified**
- `gateway/src/services/book.ts` — active-book pointer (`getActiveBook`/`setActiveBook`, persisted) + `seedDefaultBook()` first-run seed + helpers `activeBookDir()`/`activeAuthorDir()`/`activeDataDir()`/`activePipeline()`.
- `gateway/src/services/soul.ts` — `useBook(authorDir)` re-points `soulDir` + reloads, fail-soft.
- `gateway/src/services/projects.ts` — `createProjectFromPipeline(pipeline, title, description, context)` + dynamic-config builder; **delete** `PROJECT_TEMPLATES`, `exportBuiltinPipelines()`, the `ProjectTemplate` interface, and re-point `getTemplates()`.
- `gateway/src/api/routes/books.routes.ts` — add `GET /api/books/active` + `POST /api/books/active`.
- `gateway/src/api/routes/projects.routes.ts` — route create/auto-execute through the active book's pipeline + book `data/` output dir.
- `gateway/src/index.ts` — Telegram `createProject` handler + output writes redirect to the active book's `data/`; `getTemplates()` consumers unchanged.
- `gateway/src/init/phase-05-research-skills.ts` — after `BookService` construct: `seedDefaultBook()` + resolve active book + `gw.soul.useBook(activeAuthorDir)`.
- `dashboard/src/panels/books.js` — active-book selector (radio/active marker) calling `/api/books/active`.
- `dashboard/src/main.js` + `dashboard/src/index.html` — header active-book indicator hookup (no broad UI rename).

**Deleted**
- `scripts/gen-library-pipelines.ts` — generator (JSON is now canonical).
- `tests/unit/library-pipelines.test.ts` — drift guard (no longer meaningful once `PROJECT_TEMPLATES`/`exportBuiltinPipelines` are gone).

---

# Phase 3a — Active-book state + Default Book seed

Foundation only; no generation change. New code uses the canonical terms **Book**, **Author**, **Pipeline** (per `docs/GLOSSARY.md`).

## Task 3a-1 — `BookService` active-book state (TDD)

**Files**
- `gateway/src/services/book.ts`
- `tests/unit/active-book.test.ts` (new)

**Steps**
- [ ] Write the failing test file `tests/unit/active-book.test.ts`:
  ```ts
  /**
   * Unit tests for book-container Phase 3a: the global active-book pointer
   * (persisted to workspace/.config/active-book.json) and the Default Book seed.
   * Network-free; runs over a real temp library + books dir.
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
    write(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
    write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
    return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
  }

  async function makeSvc(root: string): Promise<BookService> {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.initialize();
    return svc;
  }

  test('getActiveBook is null on a fresh workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-active-'));
    try {
      const svc = await makeSvc(root);
      assert.equal(svc.getActiveBook(), null);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('setActiveBook persists and survives a reload', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-active-'));
    try {
      const svc = await makeSvc(root);
      const book = await svc.create({ title: 'My Novel', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
      await svc.setActiveBook(book.slug);
      assert.equal(svc.getActiveBook(), book.slug);
      // Persisted to disk
      const ptr = JSON.parse(readFileSync(join(root, 'workspace', '.config', 'active-book.json'), 'utf-8'));
      assert.equal(ptr.slug, book.slug);
      // A fresh service instance reads the same pointer
      const svc2 = await makeSvc(root);
      assert.equal(svc2.getActiveBook(), book.slug);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('setActiveBook rejects an unknown slug', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-active-'));
    try {
      const svc = await makeSvc(root);
      await assert.rejects(() => svc.setActiveBook('does-not-exist'));
      assert.equal(svc.getActiveBook(), null);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('seedDefaultBook creates + activates a Default Book on an empty workspace', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-active-'));
    try {
      const svc = await makeSvc(root);
      const slug = await svc.seedDefaultBook();
      assert.ok(slug, 'returns the active slug');
      assert.equal(svc.getActiveBook(), slug);
      assert.equal(svc.list().length, 1);
      assert.ok(existsSync(join(root, 'workspace', 'books', slug!, 'templates', 'author', 'SOUL.md')));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('seedDefaultBook activates the newest book when books exist but none active', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-active-'));
    try {
      const svc = await makeSvc(root);
      await svc.create({ title: 'Older', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
      const newer = await svc.create({ title: 'Newer', author: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
      const slug = await svc.seedDefaultBook();
      assert.equal(slug, newer.slug); // list() sorts newest-first
      assert.equal(svc.list().length, 2); // did NOT create a Default Book
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  ```
- [ ] Run `npm run test:unit` and confirm `active-book.test.ts` FAILS (methods don't exist yet).
- [ ] In `gateway/src/services/book.ts`, add imports for `dirname`, and read/parse helpers. The top import block currently is:
  ```ts
  import { readFile, writeFile, mkdir } from 'fs/promises';
  import { existsSync, readdirSync, readFileSync } from 'fs';
  import { join } from 'path';
  ```
  Change the `path` import to:
  ```ts
  import { join, dirname } from 'path';
  ```
- [ ] Add a private field and a constant. Inside `class BookService`, immediately after the existing fields (`private appVersion: string;`), add:
  ```ts
    private activeBookSlug: string | null = null;
    private readonly activePtrPath: string;
  ```
- [ ] In the constructor, after `this.appVersion = appVersion;`, add:
  ```ts
      // The active-book pointer lives next to the books dir under .config so it
      // sits beside projects-state.json and the other workspace config.
      this.activePtrPath = join(dirname(this.booksDir), '.config', 'active-book.json');
  ```
- [ ] In `initialize()`, after `await mkdir(this.booksDir, { recursive: true });`, load the persisted pointer:
  ```ts
      // Restore the active-book pointer (fail-soft: a missing/corrupt file just
      // means "no active book yet" — the boot seed will resolve one).
      try {
        if (existsSync(this.activePtrPath)) {
          const ptr = JSON.parse(readFileSync(this.activePtrPath, 'utf-8'));
          if (ptr && typeof ptr.slug === 'string' && existsSync(join(this.booksDir, ptr.slug, 'book.json'))) {
            this.activeBookSlug = ptr.slug;
          }
        }
      } catch (err) {
        console.warn('  ⚠ Books: could not read active-book pointer — ignoring', err);
      }
  ```
- [ ] Add the active-book API methods at the end of the class, just before the closing `}` (after `uniqueSlug`):
  ```ts
    /** The currently-active book slug, or null if none has been set. */
    getActiveBook(): string | null {
      return this.activeBookSlug;
    }

    /**
     * Set the active book and persist the pointer. Rejects an unknown slug.
     * Per decision 6 (data expendable until v6) we do NOT block activation on the
     * book's version-gate status — status stays an informational badge. A non-`ok`
     * book still activates but we log a warning.
     */
    async setActiveBook(slug: string): Promise<void> {
      const opened = await this.open(slug);
      if (!opened) throw new Error(`Unknown book: ${slug}`);
      if (opened.status !== 'ok') {
        console.warn(`  ⚠ Books: activating "${slug}" with status="${opened.status}" (informational only — runs are not blocked)`);
      }
      this.activeBookSlug = slug;
      await mkdir(dirname(this.activePtrPath), { recursive: true });
      await writeFile(this.activePtrPath, JSON.stringify({ slug, at: new Date().toISOString() }, null, 2) + '\n', 'utf-8');
    }

    /** Absolute dir of the active book, or null. */
    activeBookDir(): string | null {
      return this.activeBookSlug ? join(this.booksDir, this.activeBookSlug) : null;
    }

    /** Absolute templates/author/ dir of the active book, or null. */
    activeAuthorDir(): string | null {
      const d = this.activeBookDir();
      return d ? join(d, 'templates', 'author') : null;
    }

    /** Absolute data/ dir of the active book (where outputs land), or null. */
    activeDataDir(): string | null {
      const d = this.activeBookDir();
      return d ? join(d, 'data') : null;
    }
  ```
- [ ] **Verify:** `npx tsc --noEmit` clean AND `npm run test:unit` passes (all of `active-book.test.ts` except the two `seedDefaultBook` tests, which are implemented in 3a-2 — they will still fail here; if you prefer a single green gate, implement 3a-2 before running). Implement 3a-2 next, then run the full unit gate.

## Task 3a-2 — Default Book seed + active pipeline accessor

**Files**
- `gateway/src/services/book.ts`

**Steps**
- [ ] Add a built-in default selection constant near the top of `book.ts`, after the existing `BookSelection` interface:
  ```ts
  /** The library names used to seed the first-run Default Book. */
  const DEFAULT_BOOK_SELECTION: BookSelection = {
    title: 'Default Book',
    author: 'default',
    genre: null,
    pipeline: 'novel-pipeline',
    sections: [],
  };
  ```
- [ ] Add `seedDefaultBook()` and `activePipeline()` methods to the class (place beside the active-book methods from 3a-1):
  ```ts
    /**
     * First-run seed (book-container Phase 3a):
     *  - no books            → create a Default Book (built-in default Author +
     *                          default pipeline) and activate it.
     *  - books but no active → activate the newest by createdAt (list() is sorted
     *                          newest-first).
     *  - active already set  → no-op.
     * Returns the resolved active slug (or null if seeding failed fail-soft).
     */
    async seedDefaultBook(): Promise<string | null> {
      if (this.activeBookSlug) return this.activeBookSlug;
      const books = this.list();
      try {
        if (books.length === 0) {
          const created = await this.create(DEFAULT_BOOK_SELECTION);
          await this.setActiveBook(created.slug);
          console.log(`  ✓ Books: seeded Default Book "${created.slug}" and set active`);
          return created.slug;
        }
        const newest = books[0].slug; // list() sorts newest-first
        await this.setActiveBook(newest);
        console.log(`  ✓ Books: no active book — activated newest "${newest}"`);
        return newest;
      } catch (err) {
        console.warn(`  ⚠ Books: default-book seed failed (continuing without an active book): ${(err as Error)?.message || err}`);
        return null;
      }
    }

    /**
     * Parse and return the active book's snapshotted pipeline definition
     * (templates/pipeline.json → LibraryPipeline shape). Null if no active book
     * or the file is missing/corrupt (fail-soft — the caller decides what to do).
     */
    activePipeline(): import('./library-types.js').LibraryPipeline | null {
      const d = this.activeBookDir();
      if (!d) return null;
      const p = join(d, 'templates', 'pipeline.json');
      if (!existsSync(p)) return null;
      try {
        return JSON.parse(readFileSync(p, 'utf-8'));
      } catch (err) {
        console.warn(`  ⚠ Books: could not parse active pipeline.json — ${(err as Error)?.message || err}`);
        return null;
      }
    }
  ```
- [ ] **Verify:** `npx tsc --noEmit` clean AND `npm run test:unit` passes (all of `active-book.test.ts` green now).

## Task 3a-3 — Wire the seed at boot

**Files**
- `gateway/src/init/phase-05-research-skills.ts`

**Steps**
- [ ] In `initResearchAndSkills`, locate the block that constructs `gw.books` and logs `✓ Books: ... book(s)`:
  ```ts
    gw.books = new BookService(
      join(ROOT_DIR, 'workspace', 'books'),
      gw.library,
      await appVersion(),
    );
    await gw.books.initialize();
    console.log(`  ✓ Books: ${gw.books.list().length} book(s)`);
  ```
  Immediately AFTER that `console.log` line, add the seed call:
  ```ts
    // ── Phase 3a: resolve the active book (seed a Default Book on first run) ──
    const activeBook = await gw.books.seedDefaultBook();
    console.log(`  ✓ Books: active book = ${activeBook ?? '(none)'}`);
  ```
  > Note: `SoulService.useBook()` re-point is wired in Task 3b-2 — leave a placeholder mental note here; do not call it yet (`useBook` does not exist until 3b-1).
- [ ] **Verify:** `npx tsc --noEmit` clean. (No new unit test for the init wiring — covered by `feature-smoke.sh` post-deploy.)

## Task 3a-4 — `GET`/`POST /api/books/active`

**Files**
- `gateway/src/api/routes/books.routes.ts`

**Steps**
- [ ] In `mountBooks`, add the two routes BEFORE the `app.get('/api/books/:slug', ...)` route (so the literal `/active` path is matched before the `:slug` param route):
  ```ts
    app.get('/api/books/active', async (_req: Request, res: Response) => {
      const slug = services.books.getActiveBook();
      if (!slug) return res.json({ active: null });
      const result = await services.books.open(slug);
      if (!result) return res.json({ active: null });
      res.json({ active: { slug, book: result.manifest, status: result.status } });
    });

    app.post('/api/books/active', async (req: Request, res: Response) => {
      const slug = typeof req.body?.slug === 'string' ? req.body.slug : '';
      if (!slug) return res.status(400).json({ error: 'slug (string) is required' });
      try {
        await services.books.setActiveBook(slug);
        // Re-point the Author identity to the newly-active book (Phase 3b).
        const authorDir = services.books.activeAuthorDir();
        if (authorDir && gateway.soul) await gateway.soul.useBook(authorDir);
        res.json({ success: true, active: slug });
      } catch (err) {
        const msg = (err as Error)?.message || String(err);
        res.status(/unknown/i.test(msg) ? 404 : 500).json({ error: msg });
      }
    });
  ```
  > The `gateway.soul.useBook(...)` call references `useBook` (added in 3b-1) and `gateway.soul` — confirm `gateway` is in scope (the function signature is `mountBooks(app, gateway, _baseDir)`; `services = gateway.getServices()`, and `gateway.soul` is a public field on the gateway). If `useBook` is not yet implemented when you reach this task, implement 3b-1 first, then return.
- [ ] **Verify:** `npx tsc --noEmit` clean. Manual check deferred to `feature-smoke.sh`.

---

# Phase 3b — SoulService → active book's Author

## Task 3b-1 — `SoulService.useBook()` (TDD)

**Files**
- `gateway/src/services/soul.ts`
- `tests/unit/soul-usebook.test.ts` (new)

**Steps**
- [ ] Write the failing test `tests/unit/soul-usebook.test.ts`:
  ```ts
  /**
   * Unit tests for book-container Phase 3b: SoulService.useBook() re-points the
   * source dir to a book's templates/author/ and reloads, falling back to the
   * built-in default author dir when the snapshot is missing (fail-soft).
   * getFullContext() output must change when the active book changes.
   */
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { SoulService } from '../../gateway/src/services/soul.js';

  function authorDir(root: string, name: string, soul: string): string {
    const d = join(root, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'SOUL.md'), soul, 'utf-8');
    return d;
  }

  test('useBook re-points the source and reload changes getFullContext', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-soul-'));
    try {
      const a = authorDir(root, 'authorA', '# Author A\n\nVoice of A');
      const b = authorDir(root, 'authorB', '# Author B\n\nVoice of B');
      const soul = new SoulService(a);
      await soul.load();
      assert.match(soul.getFullContext(), /Voice of A/);
      assert.equal(soul.getName(), 'Author A');

      await soul.useBook(b);
      assert.match(soul.getFullContext(), /Voice of B/);
      assert.equal(soul.getName(), 'Author B');
      assert.doesNotMatch(soul.getFullContext(), /Voice of A/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('useBook is fail-soft: a missing dir keeps the prior author loaded', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-soul-'));
    try {
      const a = authorDir(root, 'authorA', '# Author A\n\nVoice of A');
      const soul = new SoulService(a);
      await soul.load();
      await soul.useBook(join(root, 'does-not-exist'));
      // Falls back: prior author context is retained, not blanked.
      assert.match(soul.getFullContext(), /Voice of A/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  ```
- [ ] Run `npm run test:unit` and confirm `soul-usebook.test.ts` FAILS (`useBook` does not exist).
- [ ] In `gateway/src/services/soul.ts`, add `useBook()` after the existing `reload()` method:
  ```ts
    /**
     * Re-point this SoulService at a book's Author snapshot
     * (workspace/books/<slug>/templates/author/) and reload, so getFullContext()
     * now returns the active book's Author identity (book-container Phase 3b).
     *
     * Fail-soft: if the dir is missing/unreadable we keep the currently-loaded
     * Author rather than blanking it — generation must never lose its voice.
     * getFullContext() consumers are unchanged.
     */
    async useBook(authorDir: string): Promise<void> {
      if (!authorDir || !existsSync(authorDir)) {
        console.warn(`  ⚠ Soul: author snapshot not found at "${authorDir}" — keeping current Author`);
        return;
      }
      const prev = this.soulDir;
      this.soulDir = authorDir;
      try {
        await this.load();
      } catch (err) {
        // Restore the previous source on a load error and keep the prior context.
        this.soulDir = prev;
        console.warn(`  ⚠ Soul: failed to load author snapshot at "${authorDir}" — keeping current Author: ${(err as Error)?.message || err}`);
      }
    }
  ```
  > `load()` is already idempotent — note it only OVERWRITES `personality`/`styleGuide`/`voiceProfile` when the corresponding file exists. The book Author snapshot always contains `SOUL.md`/`STYLE-GUIDE.md`/`VOICE-PROFILE.md` (copied at create-time from `library/authors/default/`), so a clean overwrite is fine. The fallback test above relies on `existsSync` short-circuiting before any mutation; do NOT reset the fields to `''` at the top of `load()`.
- [ ] **Verify:** `npx tsc --noEmit` clean AND `npm run test:unit` passes (`soul-usebook.test.ts` green).

## Task 3b-2 — Wire `useBook()` at boot

**Files**
- `gateway/src/init/phase-05-research-skills.ts`

**Steps**
- [ ] In the block added in Task 3a-3 (right after `const activeBook = await gw.books.seedDefaultBook();` and its log line), append the soul re-point:
  ```ts
    // ── Phase 3b: re-point the Author identity to the active book's snapshot ──
    // SoulService was constructed against workspace/soul/ in phase-03; once a book
    // is active it must read that book's templates/author/. Fail-soft inside
    // useBook() keeps the default Author if the snapshot is missing.
    const activeAuthorDir = gw.books.activeAuthorDir();
    if (activeAuthorDir) {
      await gw.soul.useBook(activeAuthorDir);
      console.log(`  ✓ Soul: using active book's Author ("${gw.soul.getName()}")`);
    }
  ```
  > `gw.soul` is constructed in `initSoulMemory` (phase-03), which runs at index.ts:390 BEFORE `initResearchAndSkills` (index.ts:392). So `gw.soul` is guaranteed present here.
- [ ] **Verify:** `npx tsc --noEmit` clean. End-to-end re-point validated by `feature-smoke.sh` post-deploy.

---

# Phase 3c — Engine reads `pipeline.json` + outputs to the book's `data/` + deletions

## Task 3c-1 — `ProjectEngine.createProjectFromPipeline()` (TDD)

Add a pipeline-driven create path while `PROJECT_TEMPLATES` still exists, so the new path can be tested in isolation before the deletion.

**Files**
- `gateway/src/services/projects.ts`
- `tests/unit/pipeline-from-json.test.ts` (new)

**Steps**
- [ ] Write the failing test `tests/unit/pipeline-from-json.test.ts`:
  ```ts
  /**
   * Unit tests for book-container Phase 3c: ProjectEngine builds a project's Steps
   * from a LibraryPipeline (the book's templates/pipeline.json) instead of the
   * deleted PROJECT_TEMPLATES. Dynamic pipelines delegate to the code generator.
   */
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { mkdtempSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { ProjectEngine } from '../../gateway/src/services/projects.js';
  import type { LibraryPipeline } from '../../gateway/src/services/library-types.js';

  const staticPipeline: LibraryPipeline = {
    schemaVersion: 1,
    name: 'book-planning',
    label: 'Book Planning',
    description: 'd',
    steps: [
      { label: 'Market analysis', skill: 'research', taskType: 'research', promptTemplate: 'Analyze: {{description}} ({{title}})' },
      { label: 'Premise', skill: 'premise', taskType: 'general', promptTemplate: 'Genre is {{genre}}.' },
    ],
  };

  function engine(): ProjectEngine {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-pj-'));
    return new ProjectEngine(undefined, root);
  }

  test('createProjectFromPipeline builds Steps from JSON + interpolates context', () => {
    const eng = engine();
    const p = eng.createProjectFromPipeline(staticPipeline, 'My Book', 'a heist story', { genre: 'thriller' });
    assert.equal(p.steps.length, 2);
    assert.equal(p.steps[0].label, 'Market analysis');
    assert.equal(p.steps[0].taskType, 'research');
    assert.match(p.steps[0].prompt, /Analyze: a heist story \(My Book\)/);
    assert.match(p.steps[1].prompt, /Genre is thriller\./);
    assert.equal(p.type, 'book-planning');
  });

  test('createProjectFromPipeline with dynamic=true delegates to the novel generator', () => {
    const eng = engine();
    const dyn: LibraryPipeline = { schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] };
    const p = eng.createProjectFromPipeline(dyn, 'Epic', 'a saga', { targetChapters: 3, targetWordsPerChapter: 1000, genre: 'fantasy' });
    assert.equal(p.type, 'novel-pipeline');
    assert.ok(p.steps.length > 3, 'generated multiple steps incl. per-chapter');
  });
  ```
- [ ] Run `npm run test:unit` and confirm `pipeline-from-json.test.ts` FAILS (`createProjectFromPipeline` does not exist).
- [ ] In `gateway/src/services/projects.ts`, add the new public method directly above the existing `createProject(...)` method (~line 1577). It reuses the existing `expandTemplate`, `enhanceWithAuthorOS`, and (for dynamic) `createNovelPipeline`:
  ```ts
    /**
     * Create a project from a data-driven pipeline definition (the active book's
     * templates/pipeline.json, LibraryPipeline shape). This replaces the deleted
     * PROJECT_TEMPLATES lookup (book-container Phase 3c).
     *
     *  - `dynamic: true` (novel-pipeline) → delegate to the code generator using
     *    config pulled from the book context (genre/chapters/words).
     *  - else → build Steps from `pipeline.steps[]`, interpolating {{title}},
     *    {{description}}, {{genre}} (and any other string keys in `context`).
     *
     * The pipeline `name` becomes the project `type` so downstream phase/assembly
     * logic (which keys off type === 'novel-pipeline' etc.) keeps working.
     */
    createProjectFromPipeline(
      pipeline: LibraryPipeline,
      title: string,
      description: string,
      context?: Record<string, any>,
    ): Project {
      if (pipeline.dynamic || pipeline.name === 'novel-pipeline') {
        // Dynamic novel pipeline stays code-generated; map book context → config.
        const cfg: NovelPipelineConfig = {
          genre: context?.genre,
          pov: context?.pov,
          logline: context?.logline,
          themes: context?.themes,
          setting: context?.setting,
          tone: context?.tone,
          tense: context?.tense,
          targetChapters: context?.targetChapters,
          targetWordsPerChapter: context?.targetWordsPerChapter,
          protagonistName: context?.protagonistName,
          antagonistName: context?.antagonistName,
        };
        return this.createNovelPipeline(title, description, cfg);
      }

      const id = `project-${this.nextId++}`;
      const now = new Date().toISOString();
      let steps: ProjectStep[] = pipeline.steps.map((s, i) => ({
        id: `${id}-step-${i + 1}`,
        label: s.label,
        skill: s.skill,
        toolSuggestion: s.toolSuggestion,
        taskType: s.taskType,
        prompt: this.expandTemplate(s.promptTemplate, { title, description, ...context }),
        status: 'pending' as const,
        ...(s.phase ? { phase: s.phase } : {}),
        ...(s.wordCountTarget ? { wordCountTarget: s.wordCountTarget } : {}),
        ...(s.chapterNumber ? { chapterNumber: s.chapterNumber } : {}),
      }));

      if (this.authorOS) steps = this.enhanceWithAuthorOS(steps);

      const project: Project = {
        id,
        type: (pipeline.name as ProjectType),
        title,
        description,
        status: 'pending',
        progress: 0,
        steps,
        createdAt: now,
        updatedAt: now,
        context: context || {},
      };
      this.projects.set(id, project);
      this.persistState();
      console.log(`  ✓ Project "${title}": built ${steps.length} Step(s) from pipeline "${pipeline.name}"`);
      return project;
    }
  ```
  > `LibraryPipeline` and `NovelPipelineConfig` are already imported/declared in this file (`import type { LibraryPipeline } from './library-types.js';` at line 19; `NovelPipelineConfig` at line 96). No new imports needed.
- [ ] **Verify:** `npx tsc --noEmit` clean AND `npm run test:unit` passes (`pipeline-from-json.test.ts` green). `PROJECT_TEMPLATES` still exists at this point — both paths compile.

## Task 3c-2 — Route create + pipeline create through the active book

**Files**
- `gateway/src/api/routes/projects.routes.ts`

**Steps**
- [ ] In `app.post('/api/projects/create', ...)`, the four branches currently call `engine.createNovelPipeline` / `engine.createBookProduction` / `engine.planProject` / `engine.createProject`. Replace the **template-based fallback** branch (the final block, currently):
  ```ts
    // Template-based fallback
    const projectType = inferredType;
    const project = engine.createProject(projectType, title, description, context);
    applyProjectOptions(project);
    res.json({ project, planning: 'template' });
  ```
  with the active-book pipeline path:
  ```ts
    // Pipeline-based path: source Steps from the ACTIVE BOOK's pipeline.json
    // (book-container Phase 3c). Falls back to the legacy single-step custom
    // create only if no active book / pipeline is resolvable.
    const activePipeline = services.books?.activePipeline?.();
    if (activePipeline) {
      const project = engine.createProjectFromPipeline(activePipeline, title, description, context);
      applyProjectOptions(project);
      return res.json({ project, planning: 'book-pipeline', pipeline: activePipeline.name });
    }
    const project = engine.createProject(inferredType, title, description, context);
    applyProjectOptions(project);
    res.json({ project, planning: 'template' });
  ```
  > Keep the `novel-pipeline` and `book-production` early-return branches as-is — they already delegate to the dynamic generators, which the new dynamic branch of `createProjectFromPipeline` also routes to. They remain valid entry points for the dashboard's explicit-type requests.
- [ ] In `app.post('/api/pipeline/create', ...)` (the 6-phase chain), no change is required for 3c — `createPipeline` builds 6 sub-projects via `createProject`/`createBookProduction`. Leave as-is for this phase (the active-book pipeline is a single pipeline, not the 6-phase macro-chain; the macro-chain keeps its own composition). Add a one-line code comment above the `engine.createPipeline(...)` call:
  ```ts
      // NOTE (Phase 3c): the 6-phase macro-chain composes the built-in phase
      // sequence; per-book single-pipeline creation goes through /api/projects/create.
  ```
- [ ] **Verify:** `npx tsc --noEmit` clean AND `npm run test:unit` passes.

## Task 3c-3 — Redirect output writes to the active book's `data/` (routes)

**Files**
- `gateway/src/api/routes/projects.routes.ts`

The route auto-execute handler computes `workspaceDir = join(baseDir, 'workspace')` once (line ~487) and derives `projectDir = join(workspaceDir, 'projects', <slug>)` in three places. Redirect all of them to the active book's `data/`, with a fail-soft fallback to the legacy path only when no active book is resolvable.

**Steps**
- [ ] Right after `const workspaceDir = join(baseDir, 'workspace');` (line ~487), add a resolver that prefers the active book's data dir:
  ```ts
      // Phase 3c: outputs land under the ACTIVE BOOK's data/ dir. Fall back to the
      // legacy flat workspace/projects/<slug>/ only if no book is active (keeps a
      // headless run from silently dropping output). Resolved once per execution.
      const activeDataDir: string | null = services.books?.activeDataDir?.() ?? null;
      const outDirFor = (slug: string) =>
        activeDataDir ? activeDataDir : join(workspaceDir, 'projects', slug);
  ```
- [ ] Replace the per-step save block (lines ~672-677):
  ```ts
          const projectDir = join(workspaceDir, 'projects', currentProject.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
          await mkdir(projectDir, { recursive: true });
          const stepFileName = `${activeStep.id}-${activeStep.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
          await writeFile(join(projectDir, stepFileName), `# ${activeStep.label}\n\n${response}`, 'utf-8');
  ```
  with:
  ```ts
          const projectDir = outDirFor(currentProject.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
          await mkdir(projectDir, { recursive: true });
          const stepFileName = `${activeStep.id}-${activeStep.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
          await writeFile(join(projectDir, stepFileName), `# ${activeStep.label}\n\n${response}`, 'utf-8');
  ```
- [ ] Replace the manuscript-assembly dir (line ~782-783):
  ```ts
            const projectSlug = currentProject.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const projectDir = join(workspaceDir, 'projects', projectSlug);
  ```
  with:
  ```ts
            const projectSlug = currentProject.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
            const projectDir = outDirFor(projectSlug);
  ```
  (Lines ~792, ~802, ~809 read/write `join(projectDir, ...)` — they now follow the redirected `projectDir` automatically.)
- [ ] The retry/restart/delete handlers (lines ~421, ~449, ~959) also compute `j(baseDir, 'workspace', 'projects', projectSlug)` for cleanup. Redirect these too so cleanup targets the book's `data/`. For each of the three, replace the legacy path construction with the active-book data dir, falling back to the legacy path. Example for the **retry** handler (~line 421):
  ```ts
          const projectDir = jp(baseDir, 'workspace', 'projects', projectSlug);
  ```
  →
  ```ts
          const projectDir = services.books?.activeDataDir?.() ?? jp(baseDir, 'workspace', 'projects', projectSlug);
  ```
  Apply the equivalent change in the **restart** handler (~line 449, uses `jp`) and the **delete** handler (~line 959, uses `j`), matching each handler's local path-join alias.
  > Note: book `data/` is shared across projects of the same active book (no per-`<id>` subdir, per the spec's `data/` target). The retry/delete cleanup deletes specific step files by name, so it remains correct; the delete handler's `rm(projectDir, { recursive: true })` would now wipe the whole book `data/` — guard it. In the delete handler, change the recursive `rm(projectDir, ...)` to delete only that project's step files: replace the `rm(projectDir, { recursive: true })` call with a loop over `readdir(projectDir)` filtering filenames that start with `${project.id}-` (mirror the retry handler's per-file `unlink`). If the active book is null (legacy path), keep the existing recursive removal.
- [ ] **Verify:** `npx tsc --noEmit` clean AND `npm run test:unit` passes.

## Task 3c-4 — Redirect output writes to the active book's `data/` (Telegram path in index.ts)

**Files**
- `gateway/src/index.ts`

**Steps**
- [ ] Find the Telegram/heartbeat auto-execute output block (~line 1793):
  ```ts
        const projectDir = join(workspaceDir, 'projects', project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  ```
  Replace with:
  ```ts
        // Phase 3c: route output to the active book's data/ (fall back to legacy
        // flat projects/ dir only when no book is active).
        const projectDir = this.books?.activeDataDir?.() ??
          join(workspaceDir, 'projects', project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  ```
  > Confirm `this.books` is a public field on the gateway (it is — `gw.books` set in phase-05; the class field is declared in index.ts). The assembly block at ~line 1877/1888/1896 reuses this `projectDir`, so it follows automatically.
- [ ] Update the user-facing string at ~line 1980 (`📁 Files saved to workspace/projects/`) to reflect the book data dir:
  ```ts
              `📁 Files saved to the active book's data/ folder\n` +
  ```
- [ ] In the Telegram `createProject` handler (~line 1604-1610, `handlers.createProject`), the path currently calls `createNovelPipeline` for novel requests and otherwise should now source from the active book pipeline. Locate:
  ```ts
        async createProject(title: string, description: string, config?: Record<string, any>): Promise<{ id: string; steps: number }> {
          ...
          project = gateway.projectEngine.createNovelPipeline(title, description, config);
  ```
  Leave the explicit novel-pipeline branch as-is, but for the non-novel branch, route through the active book's pipeline when available. Read the surrounding code, and where the handler falls to a generic `createProject(...)`, replace it with:
  ```ts
            const activePipeline = gateway.books?.activePipeline?.();
            project = activePipeline
              ? gateway.projectEngine.createProjectFromPipeline(activePipeline, title, description, config)
              : gateway.projectEngine.createProject(gateway.projectEngine.inferProjectType(description), title, description, config);
  ```
  > Verify the exact local variable names in that handler before editing (the handler assigns to a `project` variable). Do not change the novel-pipeline explicit branch.
- [ ] **Verify:** `npx tsc --noEmit` clean AND `npm run test:unit` passes.

## Task 3c-5 — Delete `PROJECT_TEMPLATES`, `exportBuiltinPipelines()`, the generator script, and the drift-guard test

Do this LAST so all callers are migrated first.

**Files**
- `gateway/src/services/projects.ts`
- `scripts/gen-library-pipelines.ts` (delete)
- `tests/unit/library-pipelines.test.ts` (delete)

**Steps**
- [ ] In `gateway/src/services/projects.ts`, delete the `ProjectTemplate` interface (lines ~114-128) and the entire `const PROJECT_TEMPLATES: ProjectTemplate[] = [ ... ];` constant (lines ~144-1078).
  > KEEP `TASK_TYPE_MAP` (used by `planProject`'s planner prompt at line ~1456) and `NovelPipelineConfig`. KEEP `createNovelPipeline`, `createBookProduction`, `createPipeline`, `planProject`, `createProject`, `expandTemplate`.
- [ ] Delete the `exportBuiltinPipelines()` function (lines ~1080-1106) and its doc comment.
- [ ] Re-point `getTemplates()` (line ~1413) — it currently maps `PROJECT_TEMPLATES`. Replace its body so the dashboard template list is sourced from the library pipelines via a hardcoded descriptor (the canonical pipeline `name`/`label`/`description` now live in `library/pipelines/*.json`, but `getTemplates()` runs inside the engine which has no library handle). The simplest correct change: have `getTemplates()` return the static descriptor list derived from the known pipeline names, OR accept an injected list. Choose the **injected list** approach:
  - Add a private field and setter:
    ```ts
      private templateCatalog: Array<{ type: ProjectType; label: string; description: string; stepCount: number; stepCountLabel?: string }> = [];

      /** Inject the available template catalog (sourced from the library at boot). */
      setTemplateCatalog(catalog: Array<{ type: ProjectType; label: string; description: string; stepCount: number; stepCountLabel?: string }>): void {
        this.templateCatalog = catalog;
      }
    ```
  - Replace `getTemplates()` body with:
    ```ts
      getTemplates(): Array<{ type: ProjectType; label: string; description: string; stepCount: number; stepCountLabel?: string }> {
        return this.templateCatalog;
      }
    ```
- [ ] Update the imports at the top of `projects.ts`: `PIPELINE_SCHEMA_VERSION` (line 20) was only used by `exportBuiltinPipelines`. Remove it from the import if now unused:
  ```ts
  import { PIPELINE_SCHEMA_VERSION } from './library-types.js';
  ```
  → delete this line if `PIPELINE_SCHEMA_VERSION` has no other references (grep to confirm). Keep `import type { LibraryPipeline } from './library-types.js';`.
- [ ] In `gateway/src/init/phase-06-content.ts`, the `getTemplates()` call (line ~32) now returns an empty list until the catalog is injected. After `gw.projectEngine.setAI(...)`, inject the catalog from the loaded library pipelines (built at boot from `gw.library`):
  ```ts
    // Phase 3c: the engine no longer owns PROJECT_TEMPLATES — source the dashboard
    // template catalog from the library's pipeline entries.
    const pipelineRows = gw.library?.list?.('pipeline') ?? [];
    gw.projectEngine.setTemplateCatalog(pipelineRows.map((r: any) => ({
      type: r.name,
      label: r.name,
      description: r.description || '',
      stepCount: r.name === 'novel-pipeline' ? 30 : 0,
      stepCountLabel: r.name === 'novel-pipeline' ? '30+ auto-generated steps' : undefined,
    })));
    const templates = gw.projectEngine.getTemplates();
    console.log(`  ✓ Project engine: ${templates.length} pipeline templates + dynamic AI planning`);
  ```
  > `gw.library` is constructed in phase-05 which runs before phase-06 (index.ts ordering: research/skills → content). Confirm `LibraryService.list('pipeline')` returns rows with `name`/`description` (it does — `toRow` maps these). Replace the existing `const templates = gw.projectEngine.getTemplates();` + log line (lines ~32-33) with the block above.
- [ ] Delete the file `scripts/gen-library-pipelines.ts`.
- [ ] Delete the file `tests/unit/library-pipelines.test.ts`.
- [ ] Grep-sweep for orphaned references:
  ```
  grep -rn "PROJECT_TEMPLATES\|exportBuiltinPipelines\|gen-library-pipelines\|ProjectTemplate\b" gateway/ scripts/ tests/ package.json
  ```
  Resolve every hit (e.g. an npm script in `package.json` that runs `gen-library-pipelines` must be removed; check `package.json` `scripts` for a `gen:pipelines`-style entry and delete it).
- [ ] **Verify:** `npx tsc --noEmit` clean AND `npm run test:unit` passes (note: `library-pipelines.test.ts` is gone; the remaining suites must be green).

## Task 3c-6 — Dashboard active-book selector

**Files**
- `dashboard/src/panels/books.js`
- `dashboard/src/main.js`
- `dashboard/src/index.html`

**Steps**
- [ ] In `dashboard/src/panels/books.js`, in `renderList()`, fetch the active book alongside the list and render an "Active" marker + a "Set active" action per row. After `data = await api('GET', '/api/books');`, add:
  ```js
  let active = null;
  try { const a = await api('GET', '/api/books/active'); active = a.active?.slug || null; } catch (e) { /* non-fatal */ }
  ```
- [ ] Add an Active column to the header row and an action cell to each `<tr>`. In the header `html += '<tr ...>...'`, add a `<th>Active</th>` before `<th>Created</th>`. In the per-book loop, add a cell:
  ```js
      const isActive = b.slug === active;
      html += '<td style="text-align:center;">' +
        (isActive
          ? '<span class="badge" style="background:var(--success);color:#fff;">active</span>'
          : '<button class="small secondary bkSetActive" data-slug="' + esc(b.slug) + '">Set active</button>') +
        '</td>';
  ```
  (Insert this cell in the same position as the new header column.)
- [ ] After `el.innerHTML = html;` in `renderList()`, wire the buttons:
  ```js
  el.querySelectorAll('.bkSetActive').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api('POST', '/api/books/active', { slug: btn.dataset.slug });
        showToast('Active book set: ' + btn.dataset.slug);
        await renderList();
      } catch (e) { showToast('Failed: ' + e.message, 'error'); }
    });
  });
  ```
- [ ] In `dashboard/src/index.html`, add a small active-book indicator element in the header bar (find the existing header/status area; do NOT rename existing labels — terms stay as-is per "no broad UI rename"). Add an element with id `activeBookIndicator` (a `<span>` styled like the other header badges).
- [ ] In `dashboard/src/main.js`, on initial load (and after panel switches that may change it), populate the indicator. Add a helper and call it during init:
  ```js
  async function refreshActiveBook() {
    try {
      const a = await api('GET', '/api/books/active');
      const el = document.getElementById('activeBookIndicator');
      if (el) el.textContent = a.active ? '📖 ' + (a.active.book?.title || a.active.slug) : '📖 (no active book)';
    } catch (e) { /* non-fatal */ }
  }
  ```
  Call `refreshActiveBook()` from the dashboard's existing init sequence (alongside the other initial `loadXxx()` calls), and re-call it from the `books.js` set-active handler by dispatching a custom event or by importing/calling it — choose the pattern already used in `main.js` for cross-panel refresh (read `main.js` to match the existing convention; if panels are isolated, simply call `refreshActiveBook()` after `renderList()` inside the set-active handler by importing it).
- [ ] Build the dashboard: `npm run build:dashboard`.
- [ ] **Verify:** `npm run build:dashboard` exits 0; `npx tsc --noEmit` clean (TS only checks gateway, but run it to be safe).

## Task 3c-7 — Final sweep + maintainer hand-off

**Files**
- `commit_message` (new)

**Steps**
- [ ] Output-path sweep — confirm no remaining live writes to the flat projects dir except the explicit legacy fallback:
  ```
  grep -rn "workspace', 'projects'\|workspace/projects" gateway/src/
  ```
  Every hit must be one of the intentional `?? join(workspaceDir, 'projects', ...)` fallbacks (no active book). No unconditional `workspace/projects` write should remain.
- [ ] Deletion sweep — confirm zero references:
  ```
  grep -rn "PROJECT_TEMPLATES\|exportBuiltinPipelines\|gen-library-pipelines\|library-pipelines.test" gateway/ scripts/ tests/ package.json
  ```
  must return nothing.
- [ ] Full gate: `npx tsc --noEmit` clean AND `npm run test:unit` green AND `npm run build:dashboard` exits 0.
- [ ] Write `commit_message` (repo root) for the maintainer (who runs `./push.sh`). Per repo convention, do NOT `git commit`/`git push`. Content:
  ```
  Book-Container Phase 3 — per-book wiring (active book drives Author + Pipeline + output)

  3a Active-book state + Default Book seed
    - BookService: getActiveBook/setActiveBook persisted to workspace/.config/active-book.json
    - seedDefaultBook() first-run seed (default Author + default pipeline) + activate-newest
    - GET/POST /api/books/active; dashboard active-book selector + header indicator
  3b SoulService per-book
    - SoulService.useBook(authorDir) re-points + reloads (fail-soft); wired at boot + on activation
    - getFullContext() consumers unchanged
  3c Engine reads pipeline.json + outputs to book data/ + deletions
    - ProjectEngine.createProjectFromPipeline() builds Steps from the active book's
      templates/pipeline.json; dynamic novel-pipeline stays code-generated
    - all step/chapter/manuscript output writes redirected to workspace/books/<slug>/data/
    - DELETED PROJECT_TEMPLATES, exportBuiltinPipelines(), scripts/gen-library-pipelines.ts,
      tests/unit/library-pipelines.test.ts (library/pipelines/*.json is now canonical)
    - getTemplates() now sourced from the library pipeline catalog
  No version-gate enforcement (decision 6 — data expendable until v6; status is informational).

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- [ ] **Verify:** `commit_message` exists at repo root.

---

## Self-review / risks

- **Deletion sweep:** after 3c-5, `grep -rn "PROJECT_TEMPLATES\|exportBuiltinPipelines\|gen-library-pipelines\|library-pipelines.test\|ProjectTemplate\b"` over `gateway/ scripts/ tests/ package.json` must return nothing. The drift-guard test and generator script are gone; `library/pipelines/*.json` is now the hand-maintained canonical source. `getTemplates()` is re-sourced from `LibraryService.list('pipeline')` — confirm the dashboard template picker still shows all 7 pipelines.
- **Output-path sweep:** after 3c-3/3c-4, `grep -rn "workspace/projects\|workspace', 'projects'" gateway/src/` must show only the explicit `?? join(workspaceDir, 'projects', ...)` no-active-book fallbacks. The delete handler's recursive `rm` must be guarded so deleting one project never wipes the whole book `data/` when a book is active.
- **Shared `data/` caveat:** all projects of the active book write into one shared `data/` dir (no per-`<id>` subdir, matching the spec). Step files are uniquely named by `${step.id}-...`, so collisions are avoided; manuscript assembly overwrites `manuscript.md`/`manuscript.docx` (one canonical manuscript per book — acceptable for Phase 3).
- **Soul fail-soft:** `useBook()` must never blank the Author — it short-circuits on a missing dir and restores the prior `soulDir` on a load error. Verify the `load()` overwrite semantics (only overwrites when a file exists) are preserved.
- **No gate enforcement (decision 6):** runs are NOT blocked on book `status`; `setActiveBook` only warns for non-`ok` books. The `ok`/`readonly`/`quarantined` badge stays informational.
- **Glossary terms:** new code/prose uses Book, Pipeline, Step, Author, Model (`docs/GLOSSARY.md`); no broad UI rename (deferred).
- **End-to-end safety net (manual, post-deploy — do NOT run from here):** `tests/feature-smoke.sh` and `tests/openrouter-pipeline.sh` run real OpenRouter/Mercury calls and are the only coverage that the rewired soul + engine + output path works end-to-end. After the maintainer runs `./push.sh` and deploys, both must pass and generated outputs must appear under `workspace/books/<active>/data/`.
