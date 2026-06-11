# Phase 8 — Multi-Book Concurrency (design spec)

**Date:** 2026-06-10
**Status:** Decisions confirmed (owner, 2026-06-10) — ready for an implementation plan. See §5.
**Roadmap:** [BOOK-CONTAINER-ARCHITECTURE.md](../../BOOK-CONTAINER-ARCHITECTURE.md) Phase 8 (follows Phase 7 genre wiring; precedes Phase 9 book-board UI and Phase 10 per-channel active book)

## 1. Goal

Let several books be **in flight at once** without their generation cross-leaking. Today every generation path resolves "which book" from a **single global mutable pointer** (`workspace/.config/active-book.json`) read *at execution time* — so two projects for different books cannot run concurrently: flipping the active book mid-run re-points genre, Author/Voice, and output routing for everything.

Phase 8 (a) gives each **project an explicit, immutable book binding** captured at creation, and (b) makes Author/Voice/Genre composition and output routing resolve **from that binding**, statelessly, instead of from the mutable global.

### Success criteria (from the roadmap)
1. Two projects bound to different books generate against their **own** Author / Voice / Genre / Pipeline with **no cross-leakage**.
2. `SoulService` composes a bound book's identity **without** going through a global mutable pointer.
3. The "smoke run must be the sole actor" hazard is gone: two concurrent bound projects produce isolated output (the Tier-D isolation test passes while books differ).

### Explicitly out of scope
- **Per-channel active book for interactive chat** (Telegram / web / API each picking their own book) — that is **Phase 10**. In Phase 8, free chat still follows the global active pointer.
- **Book-board UI** (surfacing all in-flight books) — **Phase 9**.
- Removing the global active-book pointer. It **survives** as: the dashboard's notion of "active", the target for free chat (until Phase 10), and the **default book a new project binds to**.

## 2. Current state (grounding)

- **Nothing carries a book identity.** The `Project` interface (`gateway/src/services/projects.ts:57`) has no `bookSlug`. A project implicitly uses whatever book is globally active *when each step runs*.
- **The global pointer.** `BookService` (`gateway/src/services/book.ts`) holds `activeBookSlug` (line 62), persisted to `workspace/.config/active-book.json` via `setActiveBook()` (276). All "active" accessors derive from it: `activeBookDir()` (288), `activeAuthorDir()` (311), `activeVoiceDir()` (317), `activeDataDir()` (323), `getActiveGenreGuide()` (389), `activePipeline()` (486). Slug-keyed siblings already exist: `bookDir(slug)` (293), `templatesDir(slug)` (299).
- **Author/Voice is a stateful singleton.** `SoulService` (`gateway/src/services/soul.ts`) holds mutable fields (`soulDir`, `voiceDir`, `personality`, `styleGuide`, `voiceProfile`); `useBook(authorDir, voiceDir)` (78) re-points and `load()`s them; `getFullContext()` (111) returns the composed string. There is **no** way to compose for a book without mutating the singleton.
- **The single injection chokepoint.** `handleMessage()` (`gateway/src/index.ts:494`) computes `const soul = this.soul.getFullContext()` (542) and calls `buildSystemPrompt({ soul, genreGuide: this.books?.getActiveGenreGuide() ?? undefined, … })` (565). Every path — web chat, `/api/chat`, Telegram, Discord, **and** every pipeline step (`goal-engine` channel) — funnels through here.
- **Pipeline steps reuse the chat path.** The project-step executor calls `gateway.handleMessage(stepUserMessage, 'goal-engine', …, projectContext, taskType, provider, model)` (`index.ts:1742`, retry 1761, word-count continuation 1795). It has the `project` object in scope.
- **Output routing reads the global pointer.** Step output lands in `gateway.books?.activeDataDir?.() ?? join(workspaceDir,'projects',…)` (`index.ts:1823`; also 1923, 2123, 2162). Read paths do the same: `projects.routes.ts` (437/465/511/991), `documents.routes.ts` (432/479/533/586), `export.routes.ts`/`wave.routes.ts` (via `makeGatherChapters` resolver in `_shared.ts:79`), `heartbeat.routes.ts` (224).
- **Project creation sites** that would set the binding: `projects.routes.ts` POST `/api/projects` (~138), Telegram path `index.ts:1645` (`createProjectFromPipeline`), and the pipeline-of-projects builder `projects.ts:1414`. All converge on `ProjectEngine.createProject*` methods (`createProject` 701, `createProjectFromPipeline` 607, `createProjectResolved` 682, `createNovelPipeline`).
- **Channel isolation** already exists for conversation history: `conversationHistories: Map<channel, …>` with `getHistory(channel)` (`index.ts:221`). Phase 10 will extend *this* to per-channel book; Phase 8 does **not** touch it.

## 3. Design

### 3.1 Bind a book to each project (the per-context binding)

Add an optional field to `Project`:

```ts
bookSlug?: string;   // the book this project writes into; captured at creation, immutable
```

- Set at creation from the **current global active book** (`books.getActiveBook()`), threaded into the `ProjectEngine.createProject*` methods via `context` (no new positional args — reuse the existing `context: Record<string, any>` channel: callers pass `{ bookSlug }`, the engine lifts it onto the project and strips it from `context` or leaves it — see plan).
- Persisted in `workspace/.config/projects-state.json` with the rest of the project (already saved wholesale).
- **Immutable**: never re-derived from the global pointer after creation. This is what lets the active book change without disturbing an in-flight project.

### 3.2 Stateless per-slug accessors on `BookService`

Generalize the six global accessors to take a slug; keep the `active…()` names as thin wrappers so existing callers (chat, dashboard) are untouched:

| New (slug-parameterised) | Existing wrapper becomes |
|---|---|
| `authorDirOf(slug)` | `activeAuthorDir() = authorDirOf(activeBookSlug)` |
| `voiceDirOf(slug)` | `activeVoiceDir() = voiceDirOf(activeBookSlug)` |
| `dataDirOf(slug)` | `activeDataDir() = dataDirOf(activeBookSlug)` |
| `genreGuideOf(slug)` | `getActiveGenreGuide() = genreGuideOf(activeBookSlug)` |
| `pipelineOf(slug)` | `activePipeline() = pipelineOf(activeBookSlug)` |

Each `…Of(null)` returns `null` (mirrors today's "no active book" behavior). Slugs are guarded by the existing `SLUG_RE`/`bookDir()` path. `genreGuideOf` is a pure refactor of the current `getActiveGenreGuide()` body to read from `bookDir(slug)` instead of `activeBookDir()`.

### 3.3 Stateless Author/Voice composition on `SoulService`

Add a method that composes a book's identity **without mutating instance state**:

```ts
async composeForBook(authorDir: string, voiceDir: string | null): Promise<string>
```

- Reads `SOUL.md` / `PERSONALITY.md` from `authorDir` and `STYLE-GUIDE.md` / `VOICE-PROFILE.md` from `voiceDir ?? authorDir`, and returns the **same** string shape `getFullContext()` produces — but as a pure local computation (no writes to `this.*`).
- Implemented by extracting the read+compose logic shared by `load()`/`getFullContext()` into a private helper that operates on locals; `composeForBook` calls it and returns; `load()` keeps assigning to fields for the chat singleton.
- **Fail-soft**: if `authorDir` is missing/unreadable, return `''` so the caller can fall back to the global singleton's `getFullContext()` (generation must never lose its voice).

### 3.4 Thread the binding through generation

Add one optional trailing param to `handleMessage`:

```ts
async handleMessage(content, channel, respond, extraContext?, overrideTaskType?,
                    preferredProvider?, overrideModel?, bookSlug?: string)
```

- When `bookSlug` is provided:
  - `soul` = `await this.soul.composeForBook(this.books.authorDirOf(bookSlug), this.books.voiceDirOf(bookSlug))`, falling back to `this.soul.getFullContext()` if that returns `''`.
  - `genreGuide` = `this.books?.genreGuideOf(bookSlug) ?? undefined`.
- When absent: **current behavior** (singleton `getFullContext()` + `getActiveGenreGuide()`) — i.e. chat is unchanged.
- The project-step executor passes `project.bookSlug` at all three `handleMessage('goal-engine', …)` call sites (`index.ts:1742/1761/1795`).

### 3.5 Route output by the project's book

Everywhere a **project's** files are written or read, resolve the dir from the project's binding with a back-compat ladder:

```
dataDirOf(project.bookSlug) ?? activeDataDir() ?? <legacy flat projects/ dir>
```

Sites: `index.ts` 1823/1923/2123/2162; `projects.routes.ts` 437/465/511/991; `documents.routes.ts` 432/479/533/586; `_shared.ts` gather resolver (passed the project's slug by `export.routes.ts`/`wave.routes.ts`); `heartbeat.routes.ts` 224. Each route already loads the `project` by id, so `project.bookSlug` is available. Legacy projects (no `bookSlug`) keep working via the `activeDataDir()` rung.

### 3.6 Pipeline selection at creation

`createProjectFromPipeline` already snapshots the pipeline definition into the project's steps at creation, so a project's steps are **already** immutable w.r.t. later active-book changes. Phase 8 only needs to ensure the pipeline is read from the book being bound at create time (today it reads `activePipeline()` — correct, since binding == active-at-creation). No change beyond recording `bookSlug` for provenance.

## 4. Verification strategy

- **Unit** (`tests/unit/`):
  - `book.ts` slug accessors: `authorDirOf/voiceDirOf/dataDirOf/pipelineOf/genreGuideOf` resolve a **non-active** book correctly and return `null` for `null`/unknown slug; `genreGuideOf` composes the same order as the old `getActiveGenreGuide` (extend `genre-guide.test.ts`).
  - `soul.ts`: `composeForBook(A)` returns A's identity **and leaves the singleton's `getFullContext()` unchanged** (the core no-mutation guarantee); missing dir → `''`.
  - `projects.ts`: a project created with `{ bookSlug }` carries it through save/reload; absent → `undefined` (legacy).
- **Feature-smoke** (`tests/feature-smoke.sh`): the existing sequential two-book isolation assertion is upgraded to the Phase 8 guarantee — create books A and B with **distinct sentinel genres**, bind a one-step project to A, switch the global active book to B, run A's step, and assert (i) A's output landed in A's `data/` (not B's), and (ii) the step's prompt carried A's sentinel, not B's. This is the deterministic proof that binding (not the mutable pointer) drove the run.

## 5. Decisions (owner-confirmed 2026-06-10)

- **D1 — Scope = per-project binding; chat stays global.** "SoulService composes per-book without a global mutable pointer" is satisfied for the **bound-project generation path** via `composeForBook`. The singleton + global pointer remain for interactive chat and as the new-project default; true per-channel chat selection is **Phase 10**. (Surfaced to and approved by the owner before planning.)
- **D2 — Binding is immutable and captured at creation** from the then-active book. No "move project to another book" in Phase 8.
- **D3 — Back-compat ladder** `dataDirOf(bookSlug) ?? activeDataDir() ?? legacy` so pre-Phase-8 projects and any no-book state keep working.
- **D4 — No new positional creation args**: the `bookSlug` rides the existing `context` object into `ProjectEngine`, keeping the creation signatures stable.

## 6. Risks

- **Missed read site** → a project reads/writes the wrong book's `data/`. Mitigation: the read-site list in §3.5 is exhaustive (from a full grep map); the upgraded smoke assertion catches routing leaks.
- **`composeForBook` drift from `getFullContext()`** → bound projects get a subtly different prompt shape than chat. Mitigation: both share the extracted compose helper; a unit test pins equality of shape.
- **Singleton still mutated elsewhere** (`useBook` on activate/delete) is fine — chat is allowed to follow the pointer; only the bound path must avoid it.
