# Phase 10 — Per-Channel Active Book (design spec)

**Date:** 2026-06-11
**Status:** Decisions confirmed (owner, 2026-06-11) — ready for an implementation plan. See §6.
**Roadmap:** [BOOK-CONTAINER-ARCHITECTURE.md](../../BOOK-CONTAINER-ARCHITECTURE.md) Phase 10 (follows Phase 9 book-board UI; precedes Phase 11 backup & recovery — the release gate)

## 1. Goal

Let each **channel** target its own book. Today free chat resolves "which book" from a **single global pointer**, so a Telegram user and the web studio cannot work on different books at the same time — switching the active book in the studio re-points Telegram's chat too. Phase 10 extends the existing **per-channel conversation-history isolation** (`conversationHistories: Map<channel, …>`) to a **per-channel active-book override**, so Telegram (and, later, API) callers each select a book independently of the global/web pointer.

This is the interactive-chat analog of Phase 8: Phase 8 bound *projects* to a book so concurrent generation can't cross-leak; Phase 10 binds *channels* to a book so concurrent free chat can't cross-leak.

### Success criteria (from the roadmap)
1. A Telegram command and a web session target **different** books concurrently, with no cross-contamination.
2. Selecting a book on one channel does **not** change any other channel's book.
3. The web studio and `'webchat'` behavior are **unchanged** (the global pointer remains the web/default book).

### Explicitly out of scope
- **API (`/api/chat`) per-channel selection.** The `'api'` channel keeps following the global pointer this phase. A later, tiny change can let `/api/chat` carry an optional book selector. (Decision: defer.)
- **Discord** — remains a stub, per existing project posture.
- **Any change to the global-pointer or studio "Set as active" semantics.** The global pointer survives unchanged as the default and the web channel's book.
- Removing or refactoring the Phase-8 project binding. Phase 10 layers on top of it.

## 2. Decisions (owner-confirmed 2026-06-11)

1. **Web stays on the global pointer.** The studio's "Set as active" (`POST /api/books/active`) is unchanged; the global pointer *is* the web/default book. Only Telegram (and future API) channels can override it. Smallest change, zero risk to the primary UI.
2. **Per-channel overrides persist.** They are written to `.config/channel-books.json` (mirrors `active-book.json`, fail-soft) so a Telegram user's selection survives the frequent deploys here — rather than an in-memory map that resets to global on every restart.
3. **API deferred** (see out of scope).
4. **Telegram UX:** `/book` (no arg) lists books; `/book <name|slug>` selects one for that chat; `/status` shows the current selection.

## 3. Current state (grounding)

- **The global pointer.** `BookService` (`gateway/src/services/book.ts`) holds `activeBookSlug` (line 62), persisted to `.config/active-book.json` via `setActiveBook()` (276); `getActiveBook()` (267) returns it. Restored fail-soft in `initialize()` (74–88). Slug-parameterised accessors already exist (Phase 8): `authorDirOf`/`voiceDirOf`/`dataDirOf`/`genreGuideOf`/`pipelineOf`.
- **Channels.** Web chat is a single shared channel `'webchat'` (`index.ts:475`, all sockets share it); Telegram is per-chat `telegram:<chatId>`; REST is `'api'`. The `channel.startsWith('telegram:')` / `=== 'api'` discrimination already appears throughout `handleMessage`.
- **Conversation history is already per-channel.** `conversationHistories: Map<string, …>` with `getHistory(channel)` (`index.ts:221`). Phase 10 extends *this* isolation pattern to books.
- **The single prompt chokepoint.** `handleMessage()` (`index.ts:494`, signature ends with the Phase-8 `bookSlug?` 8th arg, 502). The soul/genre composition (555–563) branches:
  - `bookSlug` set (project steps) → `composeForBook(authorDirOf, voiceDirOf) || getFullContext()` for soul, `genreGuideOf(bookSlug)` for genre (the asymmetric-fallback block, 547–554).
  - `bookSlug` absent (free chat) → global `getFullContext()` / `getActiveGenreGuide()`.
- **Project-creation binding (Phase 8).** Binds `bookSlug` to the **global** active book: Telegram `/novel` at `index.ts:1665` (`getActiveBook()`), web/API at `projects.routes.ts:113`. Projects carry `bookSlug` via `context.bookSlug` (`projects.ts:550/641/675/744`).
- **Telegram bridge** (`gateway/src/bridges/telegram.ts`) is a command switch (`/start`,`/novel`,`/write`,`/projects`,`/project`,`/status`,`/research`,`/files`,`/read`,`/export`,`/clean`,`/voice`,`/speak`,`/stop`). Commands translate into internal handler calls. There is **no** book-selection command today; `/status` (line 246) does not show a book.

## 4. Design

### 4.1 Per-channel override layer on `BookService`

Add a thin override layer to `BookService` (cohesive — it already owns `activeBookSlug` and the `.config` pointer pattern; the fallback in resolution needs the global slug, so a separate service would just have to call back into `BookService`).

```ts
private channelBooks: Map<string, string> = new Map();
private readonly channelPtrPath: string; // .config/channel-books.json
```

- **`initialize()`** also loads `channel-books.json` (fail-soft: missing/corrupt → empty map). **Prune** any entry whose `slug` no longer has a `book.json` on disk (mirrors how the active pointer is validated at 81), then rewrite the file if pruning changed it.
- **`getChannelBook(channel): string | null`** — the raw override (`channelBooks.get(channel) ?? null`), **no** fallback.
- **`resolveBook(channel): string | null`** — `channelBooks.get(channel) ?? this.activeBookSlug`. The single resolution helper used by callers.
- **`setChannelBook(channel, slug): Promise<void>`** — validate the slug has a `book.json` (throw on unknown, like `setActiveBook` 276–282 does); set the map; persist.
- **`clearChannelBook(channel): Promise<void>`** — delete the entry; persist. (Used if a selected book is later deleted, and available for a future "reset to default".)
- **Persist format:** a flat JSON object `{ "telegram:123456": "the-clockwork-orchard", … }`. Write via the same atomic pattern as the active pointer.
- **Book deletion hygiene:** `delete(slug)` (book.ts:~505) already clears the global pointer when it matches; extend it to also drop any `channelBooks` entries pointing at the deleted slug (and persist). Prevents dangling overrides.

### 4.2 `handleMessage` — the only prompt-path change

Replace the Phase-8 `bookSlug` with an **override slug** that folds in the per-channel selection:

```ts
// Phase 10: a project-step binding (bookSlug) or a per-channel override both
// pin composition to a specific book; otherwise (web/default) the global path runs.
const overrideSlug = bookSlug ?? this.books?.getChannelBook(channel) ?? undefined;
```

Then use `overrideSlug` wherever `bookSlug` was used in the soul/genre block (555–563). The semantics are identical to Phase 8:
- **Override present** (project step *or* a channel that selected a book) → `composeForBook` / `genreGuideOf(overrideSlug)` — the proven Phase-8 path, including the asymmetric genre fallback (no global genre leak).
- **No override** (web `'webchat'`, `'api'`, or any channel that never selected) → the existing global `getFullContext()` / `getActiveGenreGuide()` path, **byte-for-byte unchanged**.

This is the whole prompt-path change: one new local + a rename of the variable used in three places. Web/default behavior is provably unchanged because `getChannelBook('webchat')` is always `null`.

> Note: project channels (`'projects'`/`'project-engine'`/`'goal-engine'`) always receive an explicit `bookSlug` and never have an override, so `getChannelBook` returns `null` for them — no behavior change.

### 4.3 Project-creation binding follows the channel

The Telegram `/novel` creation path (`index.ts:1665`) binds to the **channel's resolved book** instead of the global one:

```ts
const activeBook = gateway.books?.resolveBook(telegramChannel) ?? undefined;
```

where `telegramChannel` is the `telegram:<chatId>` channel already in scope in that handler. So a project a Telegram user starts binds to the book they selected with `/book`. The web/API route (`projects.routes.ts:113`) passes its channel (`'webchat'`/`'api'`) to `resolveBook`, which returns the global slug — **unchanged**. (If threading the channel into `projects.routes.ts` is more than a one-liner, that route may simply keep `getActiveBook()` since `resolveBook('webchat') === getActiveBook()` by construction; the plan will pick the cleaner of the two.)

### 4.4 Telegram `/book` command

Add a `/book` branch to the bridge command switch, and a small gateway helper it calls (the bridge translates commands into internal calls; it should not reach into `BookService` internals directly — match how other commands delegate to `gateway`):

- **`/book`** (no arg) → list books: slug + title, marking the chat's current selection (and noting the fallback "(global default)" when none is set). Backed by a gateway method, e.g. `listBooksForChannel(channel)` returning `{ slug, title, current }[]` plus the resolved default.
- **`/book <name|slug>`** → resolve the argument to a slug (exact slug match, else case-insensitive title match; ambiguous/!found → a helpful error listing candidates), call `setChannelBook(channel, slug)`, confirm with the title.
- **`/status`** (line 246) → add a line: `Book: <title> (<slug>)` or `Book: <global default title> (default)`.

Discord is **not** updated (stub posture).

## 5. Verification

- **Unit — `tests/unit/channel-books.test.ts`** (the core decision logic): against a temp workspace with two real books A and B,
  1. `resolveBook(ch)` falls back to the global slug when no override is set;
  2. `setChannelBook('telegram:1', A)` while global = B ⇒ `resolveBook('telegram:1') === A` **and** `resolveBook('webchat') === B` (the isolation proof);
  3. `getChannelBook` returns `null` for an unset channel and the slug for a set one;
  4. persist round-trip: a second `BookService` over the same dir restores the override after `initialize()`;
  5. `setChannelBook` throws on an unknown slug;
  6. stale-prune: an override pointing at a since-deleted book is dropped on `initialize()`, and `delete(slug)` drops live overrides pointing at it.
- **Feature-smoke (`tests/feature-smoke.sh`)** keeps asserting the web/global path is unchanged (existing coverage). **The override-setting surface is Telegram-only** (API deferred), so there is **no HTTP hook to script the Telegram leg** end-to-end. That leg is covered by the unit resolver/persistence tests (which exercise the exact decision point `handleMessage` consumes) plus a **documented manual `/book` check** in the plan. This limitation is stated plainly rather than papered over with a fake assertion. (If, during implementation, a cheap test-only hook proves worthwhile, the plan may add one — but it is not required to meet the success criteria, which the unit tests cover.)
- **Gates:** `npx tsc --noEmit` clean; full unit suite green; `npm run build:frontend` green (no frontend change expected, but the gate runs); Mercury deploy PASS; live feature-smoke green.

## 6. Implementation outline (for the plan)

1. **`BookService`**: add `channelBooks` map + `channelPtrPath`; load/prune in `initialize()`; add `getChannelBook`/`resolveBook`/`setChannelBook`/`clearChannelBook` + persist helper; extend `delete()` to drop matching overrides. **Unit tests first** (TDD) for the resolver + persistence.
2. **`handleMessage`** (`index.ts`): introduce `overrideSlug = bookSlug ?? this.books?.getChannelBook(channel)`; use it in the soul/genre block.
3. **Project binding**: Telegram `/novel` path → `resolveBook(telegramChannel)`.
4. **Telegram bridge**: `/book` list+select, `/status` book line; add the small gateway helper(s) it delegates to.
5. **Docs**: update `BOOK-CONTAINER-ARCHITECTURE.md` Phase 10 to "Implemented"; move the TODO/architecture note; `docs/COMPLETED.md`; `CLAUDE.md` workspace-dir note (`.config/channel-books.json`); `commit_message`; the `.remember` handoff.

## 7. Risks / notes

- **Single-user app.** All web clients share `'webchat'`, so "per-channel" is really web-vs-Telegram(-per-chat) here, which is exactly the target. No multi-tenant web isolation is implied or needed.
- **Fallback correctness.** Because `resolveBook('webchat') === getActiveBook()` by construction, every web/default path is unchanged; the risk surface is confined to channels that explicitly call `setChannelBook`.
- **No genre cross-leak.** The override path reuses Phase 8's asymmetric genre fallback (a bound/overridden book with no genre guide gets *none*, never the global book's), so per-channel selection cannot leak the global book's genre.
