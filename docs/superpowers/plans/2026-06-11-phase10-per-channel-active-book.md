# Phase 10 — Per-Channel Active Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each channel (Telegram chat, web) target its own book, by layering a persisted per-channel override on top of the global active-book pointer.

**Architecture:** `BookService` gains a `channelBooks` map (persisted to `.config/channel-books.json`) and a `resolveBook(channel) = override ?? global` helper. `handleMessage` resolves an `overrideSlug = bookSlug ?? getChannelBook(channel)` and reuses Phase 8's `composeForBook` path when set; the web/default path is unchanged because web's channel (`'webchat'`) never has an override. Telegram gets a `/book` command and channel-aware project binding.

**Tech Stack:** Node 22 + TypeScript (ESM, `.js` import extensions, `--import tsx`); tests are `node:test` under `tests/unit/`.

---

## Repo workflow (READ FIRST — differs from the skill's defaults)

- **No per-task `git commit`/`git push`.** This repo uses a `commit_message` file + the maintainer's `./push.sh`. Implementers do **not** commit. The "verify" steps below replace the skill's "Commit" steps. The **final task** writes a single `commit_message`.
- **Type-check gate:** `npx tsc --noEmit` must be clean after every code task.
- **Unit gate:** `node --import tsx --test tests/unit/*.test.ts` (currently 156 tests; this plan adds ~7).
- **Frontend gate (no FE change here, but the build must stay green):** `npm run build:frontend`.
- **Imports use `.js` extensions** even for `.ts` sources (NodeNext). Match the surrounding files.

## File structure

- **Modify** `gateway/src/services/book.ts` — add the per-channel override layer (fields, init load+prune, `getChannelBook`/`resolveBook`/`setChannelBook`/`clearChannelBook`/`persistChannelBooks`, delete-cleanup).
- **Create** `tests/unit/channel-books.test.ts` — the override resolution + persistence proof.
- **Modify** `gateway/src/index.ts` — (a) `handleMessage` override resolution; (b) `createProject` Telegram handler binds to the channel's book; (c) two new command handlers (`listBooks`, `selectBook`).
- **Modify** `gateway/src/bridges/telegram.ts` — `CommandHandlers` interface (channel on `createProject`, add `listBooks`/`selectBook`); `/book` command; `/status` book line; `/help` line; pass `telegram:${chatId}` to `createProject`.
- **Modify** docs: `docs/BOOK-CONTAINER-ARCHITECTURE.md`, `docs/COMPLETED.md`, `CLAUDE.md`, plus `commit_message` and the `.remember` handoff.

---

## Task 1: `BookService` per-channel override layer (TDD)

**Files:**
- Test: `tests/unit/channel-books.test.ts` (create)
- Modify: `gateway/src/services/book.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/channel-books.test.ts`:

```ts
/**
 * Unit tests for the Phase 10 per-channel active-book override layer on
 * BookService: getChannelBook / resolveBook / setChannelBook / clearChannelBook,
 * persistence to .config/channel-books.json, stale-prune on init, and
 * delete()-cleanup of overrides pointing at a removed book.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice style');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({
    schemaVersion: 1, name: 'novel-pipeline', label: 'Novel',
    description: 'd', dynamic: true, steps: [],
  }));
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeSvcWithTwoBooks(root: string) {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  const a = await svc.create({ title: 'Book A', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
  const b = await svc.create({ title: 'Book B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
  return { lib, svc, a: a.slug, b: b.slug };
}

test('resolveBook falls back to the global active book when no override is set', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { svc, b } = await makeSvcWithTwoBooks(root);
    await svc.setActiveBook(b);
    assert.equal(svc.resolveBook('webchat'), b);
    assert.equal(svc.getChannelBook('webchat'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a channel override is isolated from the global pointer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { svc, a, b } = await makeSvcWithTwoBooks(root);
    await svc.setActiveBook(b);                 // global = B (web default)
    await svc.setChannelBook('telegram:1', a);  // telegram override = A
    assert.equal(svc.resolveBook('telegram:1'), a, 'telegram resolves to its override');
    assert.equal(svc.resolveBook('webchat'), b, 'web still resolves to the global default');
    assert.equal(svc.getChannelBook('telegram:1'), a);
    assert.equal(svc.getChannelBook('webchat'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setChannelBook throws on an unknown slug', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { svc } = await makeSvcWithTwoBooks(root);
    await assert.rejects(() => svc.setChannelBook('telegram:1', 'no-such-book'), /Unknown book/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('overrides persist across a fresh BookService over the same dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { lib, svc, a, b } = await makeSvcWithTwoBooks(root);
    await svc.setActiveBook(b);
    await svc.setChannelBook('telegram:1', a);
    const svc2 = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc2.initialize();
    assert.equal(svc2.getChannelBook('telegram:1'), a, 'override restored after reload');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('clearChannelBook removes the override', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { svc, a } = await makeSvcWithTwoBooks(root);
    await svc.setChannelBook('telegram:1', a);
    await svc.clearChannelBook('telegram:1');
    assert.equal(svc.getChannelBook('telegram:1'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a stale override (book deleted) is pruned on init and on delete()', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-chbk-'));
  try {
    const { lib, svc, a, b } = await makeSvcWithTwoBooks(root);
    await svc.setActiveBook(b);
    await svc.setChannelBook('telegram:1', a);
    await svc.delete(a);                                   // live override dropped now
    assert.equal(svc.getChannelBook('telegram:1'), null, 'delete() drops the live override');
    // And a reload must not resurrect it.
    const svc2 = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc2.initialize();
    assert.equal(svc2.getChannelBook('telegram:1'), null, 'init prunes a stale override');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/channel-books.test.ts`
Expected: FAIL — `svc.resolveBook is not a function` / `svc.getChannelBook is not a function`.

- [ ] **Step 3: Implement the override layer in `book.ts`**

(3a) Add the fields next to `activeBookSlug` (currently lines 62–63):

```ts
  private activeBookSlug: string | null = null;
  private readonly activePtrPath: string;
  // Phase 10: per-channel active-book overrides (channel → slug). Persisted so a
  // Telegram chat's selection survives restarts; resolution falls back to the
  // global pointer for any channel without an override (web/default included).
  private channelBooks: Map<string, string> = new Map();
  private readonly channelPtrPath: string;
```

(3b) In the constructor (after `this.activePtrPath = …`, line 71), add:

```ts
    this.channelPtrPath = join(dirname(this.booksDir), '.config', 'channel-books.json');
```

(3c) In `initialize()`, after the active-pointer restore block (the `try { … } catch { … }` ending at line 87), add:

```ts
    // Phase 10: restore per-channel overrides, pruning any whose book is gone.
    try {
      if (existsSync(this.channelPtrPath)) {
        const obj = JSON.parse(readFileSync(this.channelPtrPath, 'utf-8'));
        let pruned = false;
        for (const [ch, slug] of Object.entries(obj ?? {})) {
          if (typeof slug === 'string' && existsSync(join(this.booksDir, slug, 'book.json'))) {
            this.channelBooks.set(ch, slug);
          } else {
            pruned = true;
          }
        }
        if (pruned) await this.persistChannelBooks();
      }
    } catch (err) {
      console.warn('  ⚠ Books: could not read channel-books overrides — ignoring', err);
    }
```

(3d) Add the methods next to the active-book accessors (e.g. right after `setActiveBook`, before `activeBookDir()` at line 287):

```ts
  /** The raw per-channel override for a channel, or null (no fallback). */
  getChannelBook(channel: string): string | null {
    return this.channelBooks.get(channel) ?? null;
  }

  /** Resolve the effective book for a channel: its override, else the global active book. */
  resolveBook(channel: string): string | null {
    return this.channelBooks.get(channel) ?? this.activeBookSlug;
  }

  /** Pin a channel to a book and persist. Rejects an unknown slug. */
  async setChannelBook(channel: string, slug: string): Promise<void> {
    if (!SLUG_RE.test(slug) || !existsSync(join(this.booksDir, slug, 'book.json'))) {
      throw new Error(`Unknown book: ${slug}`);
    }
    this.channelBooks.set(channel, slug);
    await this.persistChannelBooks();
  }

  /** Drop a channel's override (e.g. reset to default) and persist if it existed. */
  async clearChannelBook(channel: string): Promise<void> {
    if (this.channelBooks.delete(channel)) await this.persistChannelBooks();
  }

  /** Write the per-channel overrides to .config/channel-books.json. */
  private async persistChannelBooks(): Promise<void> {
    await mkdir(dirname(this.channelPtrPath), { recursive: true });
    const obj = Object.fromEntries(this.channelBooks);
    await writeFile(this.channelPtrPath, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  }
```

(3e) In `delete()` (lines 506–514), after the `await rm(...)` and before the `return`, add the override cleanup:

```ts
    await rm(join(this.booksDir, slug), { recursive: true, force: true });
    // Phase 10: drop any per-channel overrides pointing at the deleted book.
    let overridesChanged = false;
    for (const [ch, s] of this.channelBooks) {
      if (s === slug) { this.channelBooks.delete(ch); overridesChanged = true; }
    }
    if (overridesChanged) await this.persistChannelBooks();
    if (this.activeBookSlug === slug) {
      this.activeBookSlug = null;
      await this.seedDefaultBook();
    }
    return { active: this.activeBookSlug };
```

(`SLUG_RE`, `existsSync`, `readFileSync`, `mkdir`, `writeFile`, `join`, `dirname` are all already imported in this file.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/channel-books.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Verify gates**

Run: `npx tsc --noEmit` → Expected: clean (exit 0).
Run: `node --import tsx --test tests/unit/*.test.ts` → Expected: all pass (≈162).

---

## Task 2: `handleMessage` resolves the per-channel override

**Files:**
- Modify: `gateway/src/index.ts` (the soul/genre block at ~547–563)

There is no unit harness for `handleMessage` (it pulls in the whole gateway); this change is verified by `tsc` + the Task 1 resolver tests (which cover the exact decision point) + the final feature-smoke (web/default path unchanged). That is the spec's stated verification for this leg.

- [ ] **Step 1: Edit the soul/genre composition block**

Replace the comment + `soul`/`genreGuide` block (currently lines 543–563) so the Phase-8 `bookSlug` is generalized to an `overrideSlug` that also honors the per-channel override:

```ts
    // ── Build context ──
    // Phase 8 + 10: composition pins to a specific book when EITHER a project-step
    // binding (bookSlug) OR a per-channel override (a channel that ran /book) is
    // present. Otherwise (web/default, or any channel without an override) the
    // global path runs unchanged — getChannelBook() is null for those channels.
    //
    // The soul/genre fallbacks are intentionally ASYMMETRIC. Soul falls back to
    // getFullContext() when the pinned book has no readable Author snapshot —
    // generation must never lose its voice. Genre has NO such fallback: a pinned
    // book with no genre guide must get NONE, because falling back to
    // getActiveGenreGuide() would inject the *globally active* book's genre —
    // exactly the cross-leak Phases 8/10 exist to prevent. Do not "fix" into symmetry.
    const overrideSlug = bookSlug ?? this.books?.getChannelBook(channel) ?? undefined;
    const soul = overrideSlug
      ? ((await this.soul.composeForBook(
          this.books?.authorDirOf(overrideSlug) ?? '',
          this.books?.voiceDirOf(overrideSlug) ?? null
        )) || this.soul.getFullContext())
      : this.soul.getFullContext();
    const genreGuide = overrideSlug
      ? (this.books?.genreGuideOf(overrideSlug) ?? undefined)
      : (this.books?.getActiveGenreGuide() ?? undefined);
```

(This is the existing block with `bookSlug` → `overrideSlug` and the new `overrideSlug` line + an updated comment. No other lines change.)

- [ ] **Step 2: Verify gates**

Run: `npx tsc --noEmit` → Expected: clean.
Run: `node --import tsx --test tests/unit/*.test.ts` → Expected: all pass.

---

## Task 3: Telegram project creation binds to the channel's book

**Files:**
- Modify: `gateway/src/bridges/telegram.ts` (`CommandHandlers.createProject` signature + 3 call sites)
- Modify: `gateway/src/index.ts` (`buildTelegramCommandHandlers().createProject`)

- [ ] **Step 1: Add `channel` to the `createProject` handler type**

In `gateway/src/bridges/telegram.ts`, the `CommandHandlers` interface, change the `createProject` line to:

```ts
  createProject: (title: string, description: string, config?: Record<string, any>, channel?: string) => Promise<{ id: string; steps: number }>;
```

- [ ] **Step 2: Pass the channel at the 3 call sites**

In `telegram.ts`, update each `createProject` call inside `handleInput(chatId, …)` to pass `telegram:${chatId}` as the 4th arg:

- `/novel` (≈line 152): `const result = await this.commandHandlers.createProject(idea, \`Write a complete novel: ${idea}\`, undefined, \`telegram:${chatId}\`);`
- `/write` (≈line 180): `const project = await this.commandHandlers.createProject(idea, idea, undefined, \`telegram:${chatId}\`);`
- `/project` (≈line 228): `const project = await this.commandHandlers.createProject(description, description, undefined, \`telegram:${chatId}\`);`

- [ ] **Step 3: Make the handler bind to the channel's resolved book**

In `gateway/src/index.ts`, `buildTelegramCommandHandlers()`, update `createProject` (lines 1658–1679). Change the signature and the book resolution:

```ts
      async createProject(title: string, description: string, config?: Record<string, any>, channel?: string): Promise<{ id: string; steps: number }> {
        const inferredType = gateway.projectEngine.inferProjectType(description);
        let project;

        // Phase 8 + 10: bind to the channel's resolved book (its per-channel
        // override, else the global active book) at creation time, so the project
        // stays bound even if the active book changes later.
        const boundSlug = (channel ? gateway.books?.resolveBook(channel) : gateway.books?.getActiveBook()) ?? undefined;
        if (inferredType === 'novel-pipeline') {
          project = gateway.projectEngine.createNovelPipeline(title, description, config);
          if (boundSlug) project.bookSlug = boundSlug;
        } else {
          // Route non-novel creation through the BOUND book's pipeline when resolvable.
          const boundPipeline = gateway.books?.pipelineOf(boundSlug ?? null) ?? undefined;
          const contextWithSlug = { ...(config || {}), bookSlug: boundSlug };
          project = boundPipeline
            ? gateway.projectEngine.createProjectFromPipeline(boundPipeline, title, description, contextWithSlug)
            : gateway.projectEngine.createProjectResolved(gateway.projectEngine.inferProjectType(description), title, description, contextWithSlug);
        }
```

(Only the `activeBook`→`boundSlug` resolution and the `activePipeline()`→`pipelineOf(boundSlug ?? null)` call change; the rest of the method body — the activity log, return, etc. — is untouched.)

- [ ] **Step 4: Verify gates**

Run: `npx tsc --noEmit` → Expected: clean.

---

## Task 4: Telegram `/book` command, command handlers, and `/status` line

**Files:**
- Modify: `gateway/src/bridges/telegram.ts` (`CommandHandlers` interface; `/book` branch; `/status` line; `/help` line)
- Modify: `gateway/src/index.ts` (`buildTelegramCommandHandlers()` — add `listBooks` + `selectBook`)

- [ ] **Step 1: Extend the `CommandHandlers` interface**

In `telegram.ts`, add to the `CommandHandlers` interface (after `createProject`):

```ts
  listBooks: (channel: string) => { books: Array<{ slug: string; title: string }>; currentSlug: string | null; overridden: boolean };
  selectBook: (channel: string, query: string) => Promise<
    | { ok: true; slug: string; title: string }
    | { ok: false; error: string; candidates?: Array<{ slug: string; title: string }> }
  >;
```

- [ ] **Step 2: Implement the handlers in `index.ts`**

In `gateway/src/index.ts`, `buildTelegramCommandHandlers()`, add these two handlers to the returned object (alongside `createProject` etc.):

```ts
      listBooks(channel: string) {
        const books = (gateway.books?.list() ?? []).map((b) => ({ slug: b.slug, title: b.title }));
        const currentSlug = gateway.books?.resolveBook(channel) ?? null;
        const overridden = (gateway.books?.getChannelBook(channel) ?? null) !== null;
        return { books, currentSlug, overridden };
      },

      async selectBook(channel: string, query: string) {
        const all = (gateway.books?.list() ?? []).map((b) => ({ slug: b.slug, title: b.title }));
        const q = query.trim();
        const ql = q.toLowerCase();
        let match = all.find((b) => b.slug === q) ?? all.find((b) => b.title.toLowerCase() === ql);
        if (!match) {
          const subs = all.filter((b) => b.title.toLowerCase().includes(ql) || b.slug.includes(ql));
          if (subs.length === 1) match = subs[0];
          else if (subs.length > 1) return { ok: false as const, error: 'multiple matches', candidates: subs };
        }
        if (!match) return { ok: false as const, error: 'not found', candidates: all };
        try {
          await gateway.books!.setChannelBook(channel, match.slug);
        } catch (e) {
          return { ok: false as const, error: String((e as Error)?.message || e) };
        }
        return { ok: true as const, slug: match.slug, title: match.title };
      },
```

- [ ] **Step 3: Add the `/book` command branch in `telegram.ts`**

In `handleInput`, after the `/status` block (after line 268's `return;`), add:

```ts
    // ── /book — list books, or pin this chat to a book ──
    if (text === '/book' || text.startsWith('/book ')) {
      if (!this.commandHandlers) return;
      const channel = `telegram:${chatId}`;
      const arg = text.replace(/^\/book\s*/, '').trim();
      if (!arg) {
        const { books, currentSlug, overridden } = this.commandHandlers.listBooks(channel);
        if (books.length === 0) { await this.sendMessage(chatId, 'No books yet. Create one in the studio.'); return; }
        const list = books.map((b) => `${b.slug === currentSlug ? '📖' : '   '} ${b.title} — \`${b.slug}\``).join('\n');
        const note = overridden ? '' : '\n\n_(following the global default — `/book <name>` to pin one to this chat)_';
        await this.sendMessage(chatId, `*Books:*\n${list}${note}`);
        return;
      }
      const result = await this.commandHandlers.selectBook(channel, arg);
      if (result.ok) {
        await this.sendMessage(chatId, `📖 This chat now writes into *${result.title}* (\`${result.slug}\`).`);
      } else if (result.candidates && result.candidates.length) {
        const cands = result.candidates.map((b) => `• ${b.title} — \`${b.slug}\``).join('\n');
        await this.sendMessage(chatId, `Couldn't pick a book (${result.error}). Try one of:\n${cands}`);
      } else {
        await this.sendMessage(chatId, `Couldn't select a book: ${result.error}`);
      }
      return;
    }
```

- [ ] **Step 4: Add the book line to `/status`**

In the `/status` block, replace the final send (line 267):

```ts
      if (!summary) summary = 'Nothing running. Use /project or /novel to start.\n';
      await this.sendMessage(chatId, summary + `\n📊 Dashboard: http://localhost:3847`);
```

with a version that prepends the current book:

```ts
      if (!summary) summary = 'Nothing running. Use /project or /novel to start.\n';
      let bookLine = '';
      if (this.commandHandlers) {
        const { books, currentSlug, overridden } = this.commandHandlers.listBooks(`telegram:${chatId}`);
        const cur = books.find((b) => b.slug === currentSlug);
        if (cur) bookLine = `📖 Book: ${cur.title}${overridden ? '' : ' (default)'}\n`;
      }
      await this.sendMessage(chatId, bookLine + summary + `\n📊 Dashboard: http://localhost:3847`);
```

- [ ] **Step 5: Add `/book` to `/help`**

In the `/start`/`/help` text, add a line after the `/status` line (line 129):

```ts
        `/book — Pick which book this chat writes into\n` +
```

- [ ] **Step 6: Verify gates**

Run: `npx tsc --noEmit` → Expected: clean.
Run: `node --import tsx --test tests/unit/*.test.ts` → Expected: all pass.
Run: `npm run build:frontend` → Expected: green (no FE change, gate stays green).

---

## Task 5: Docs, commit message, handoff

**Files:**
- Modify: `docs/BOOK-CONTAINER-ARCHITECTURE.md` (Phase 10 → Implemented)
- Modify: `docs/COMPLETED.md` (new dated entry)
- Modify: `CLAUDE.md` (workspace `.config` note: add `channel-books.json`)
- Create: `commit_message`
- Modify: `.remember/remember.md` + the memory status file

- [ ] **Step 1: Mark Phase 10 implemented in the architecture doc**

In `docs/BOOK-CONTAINER-ARCHITECTURE.md`, the `Phase 10 — Per-channel active book` bullet (≈line 542): prepend `**(Implemented 2026-06-11.)** ` and append a one-sentence note: persisted per-channel overrides in `.config/channel-books.json`, `resolveBook(channel)=override ?? global`, web follows the global pointer, Telegram `/book` selects, API deferred.

- [ ] **Step 2: Add the COMPLETED.md entry**

Under `## 2026-06-11`, add a bullet describing Phase 10 (mirror the Phase 8/9 entries' style): the override layer, the one-line `handleMessage` change, Telegram `/book` + `/status` + channel-bound project creation, API deferred, and the verification (channel-books unit tests + web-path-unchanged smoke + documented manual `/book` check).

- [ ] **Step 3: Update the `CLAUDE.md` stateful-directories note**

In `CLAUDE.md`, the `workspace/.config/` line currently reads `personas.json`, `projects-state.json`. Add `channel-books.json` (Phase 10 per-channel active-book overrides) to that list.

- [ ] **Step 4: Write `commit_message`**

```
feat(phase10): per-channel active book

- BookService gains a persisted per-channel override layer
  (.config/channel-books.json): getChannelBook/resolveBook(override ?? global)
  /setChannelBook/clearChannelBook, fail-soft load + stale-prune on init, and
  delete() drops overrides pointing at a removed book
- handleMessage resolves overrideSlug = bookSlug ?? getChannelBook(channel);
  overridden channels use the Phase-8 composeForBook path, web/default unchanged
- Telegram: /book lists/selects this chat's book, /status shows it, and project
  creation (/novel /write /project) binds to the chat's resolved book
- web stays on the global pointer (studio unchanged); API deferred
- tests/unit/channel-books.test.ts (override isolation + persistence + prune)
- docs: architecture Phase 10 -> Implemented, COMPLETED, CLAUDE.md .config note

Verified: npx tsc --noEmit clean, unit suite green, npm run build:frontend green.
```

- [ ] **Step 5: Update the handoff + memory**

Update `.remember/remember.md` and the memory status file (`~/.claude/projects/-home-paul-data-dev-bookclaw/memory/book-container-status.md` + `MEMORY.md` index line) to: Phase 10 implemented + deployed + verified; next = Phase 11 backup & recovery (release gate).

---

## Task 6: Deploy and verify on Mercury

- [ ] **Step 1: Local gates green** — `npx tsc --noEmit`, `node --import tsx --test tests/unit/*.test.ts`, `npm run build:frontend` all pass.

- [ ] **Step 2: Deploy** — `touch build_now`, then poll `.build-logs/last-build.status` for a fresh timestamp + `result=PASS` (~1 min).

- [ ] **Step 3: Live feature-smoke** —
  ```bash
  TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '"')
  BASE_URL=http://192.168.1.32:3847 BOOKCLAW_AUTH_TOKEN="$TOKEN" bash tests/feature-smoke.sh
  ```
  Expected: all pass (the web/global chat path is unchanged).

- [ ] **Step 4: Documented manual Telegram check** (the per-channel leg has no HTTP hook): with two books present, in Telegram send `/book` (lists books, marks current), `/book <other title>` (confirms the switch), `/status` (shows the pinned book), then a plain chat message and confirm the reply reflects the pinned book's Author/genre. Note the result in the handoff.

---

## Self-review (completed by plan author)

- **Spec coverage:** §4.1 override layer → Task 1. §4.2 handleMessage → Task 2. §4.3 channel-bound project creation → Task 3. §4.4 Telegram `/book` + `/status` → Task 4. §5 verification → Task 1 unit tests + Task 6 smoke + manual check. §6 docs → Task 5. API/Discord out-of-scope: untouched. ✓
- **Placeholder scan:** no TBD/TODO; every code step shows full code. ✓
- **Type consistency:** `getChannelBook`/`resolveBook`/`setChannelBook`/`clearChannelBook`/`persistChannelBooks` names match across book.ts + tests + handlers; `createProject(…, channel?)`, `listBooks(channel)`, `selectBook(channel, query)` signatures match between the `CommandHandlers` interface (telegram.ts) and the implementations (index.ts); `pipelineOf(slug|null)` matches book.ts. ✓
- **Verification honesty:** the Telegram leg's lack of a scriptable HTTP hook is stated, with unit coverage of the resolver + a manual check, per the spec. ✓
```
