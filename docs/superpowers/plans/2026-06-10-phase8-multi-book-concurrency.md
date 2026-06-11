# Phase 8 — Multi-Book Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind each project to a book at creation and resolve Author/Voice/Genre/output from that binding (statelessly), so multiple books run concurrently with no cross-leakage. Spec: [docs/superpowers/specs/2026-06-10-phase8-multi-book-concurrency-design.md](../specs/2026-06-10-phase8-multi-book-concurrency-design.md).

**Architecture:** Generation currently resolves "which book" from a single global mutable pointer (`active-book.json`) at execution time. Add `Project.bookSlug` (captured at creation), give `BookService` slug-parameterised accessors (`authorDirOf/voiceDirOf/dataDirOf/genreGuideOf/pipelineOf`, with the `active…()` methods becoming thin wrappers), add a stateless `SoulService.composeForBook()`, thread an optional `bookSlug` through `handleMessage`, and route every project file read/write via `dataDirOf(project.bookSlug) ?? activeDataDir() ?? legacy`. Chat is unchanged (stays on the global pointer — per-channel is Phase 10).

**Tech Stack:** Node 22 + TypeScript (run via `tsx`, `.js` import extensions, `NodeNext`). Tests: `node --import tsx --test tests/unit/*.test.ts`; bash `tests/feature-smoke.sh` against the live container on Mercury.

> **Repo workflow — do NOT `git commit`/`git push`.** Per `CLAUDE.md`, the implementer writes a `commit_message` file at the repo root; the maintainer runs `./push.sh`. Work directly on `main`; no worktree (deploy builds the working tree). "Commit" is replaced throughout by a **verification gate** (run the listed command, confirm the expected output) plus a single `commit_message` write in the final task. Deploy = `touch build_now` (Mercury's timer builds the working tree, ~1 min; poll `.build-logs/last-build.status` for a fresh timestamp + `result=PASS`).

> **Invariants used across tasks (must hold exactly):**
> - Back-compat ladder for every project file path: `dataDirOf(project.bookSlug) ?? activeDataDir() ?? <legacy flat projects/ dir>`.
> - `active…()` accessors must return **identical** results to today after refactor (they become `…Of(activeBookSlug)`).
> - `composeForBook()` must **not** mutate any `SoulService` instance field; its output shape must match `getFullContext()`.
> - `handleMessage` with no `bookSlug` must behave **exactly** as today (chat unchanged).

---

## File Structure

- **Modify** `gateway/src/services/book.ts` — add `authorDirOf/voiceDirOf/dataDirOf/genreGuideOf/pipelineOf(slug)`; rewrite the five `active…()` methods as wrappers.
- **Modify** `gateway/src/services/soul.ts` — extract a stateless compose helper; add `composeForBook(authorDir, voiceDir)`.
- **Modify** `gateway/src/services/projects.ts` — add `Project.bookSlug`; lift `context.bookSlug` onto the project in `createProject`/`createProjectFromPipeline`/`createProjectResolved`.
- **Modify** `gateway/src/index.ts` — add `bookSlug?` param to `handleMessage`; per-book `soul`/`genreGuide` when set; pass `project.bookSlug` at the 3 `goal-engine` call sites; route output via the ladder at 1823/1923/2123/2162; set `bookSlug` at the Telegram creation site (1645).
- **Modify** `gateway/src/api/routes/projects.routes.ts` — set `bookSlug` at POST `/api/projects`; resolve file paths via the ladder at 437/465/511/991.
- **Modify** `gateway/src/api/routes/documents.routes.ts` — ladder at 432/479/533/586.
- **Modify** `gateway/src/api/routes/{export,wave}.routes.ts` + `_shared.ts` — pass the project's slug into the gather resolver.
- **Modify** `gateway/src/api/routes/heartbeat.routes.ts` — ladder at 224 (uses active book; no project — keep `activeDataDir()` but document why).
- **Create** `tests/unit/book-slug-accessors.test.ts`, `tests/unit/soul-compose.test.ts`; **extend** `tests/unit/genre-guide.test.ts`, `tests/unit/projects*.test.ts` (project carries bookSlug).
- **Modify** `tests/feature-smoke.sh` — upgrade the two-book block to the concurrent-binding assertion.
- **Modify** `docs/BOOK-CONTAINER-ARCHITECTURE.md` (Phase 8 → Implemented), `docs/TODO.md`, `docs/COMPLETED.md`; write `commit_message`.

---

## Task 1: Slug-parameterised accessors on `BookService`

- [ ] In `gateway/src/services/book.ts`, add `authorDirOf(slug)`, `voiceDirOf(slug)`, `dataDirOf(slug)`, `pipelineOf(slug)`, `genreGuideOf(slug)`. Each takes `slug: string | null`, returns `null` for null/invalid slug (reuse `bookDir(slug)`), and otherwise returns what the matching `active…()` returns today but for `slug`.
- [ ] Move the body of the current `getActiveGenreGuide()` into `genreGuideOf(slug)` (read from `bookDir(slug)/templates/genre` instead of `activeBookDir()`), preserving the canonical ORDER/TITLES exactly.
- [ ] Rewrite the five `active…()` methods as one-liners delegating to the `…Of` variant with `this.activeBookSlug`. Keep their JSDoc.
- **Verify:** `npx tsc --noEmit` clean. Add `tests/unit/book-slug-accessors.test.ts`: for a created (but **not** active) book, each `…Of(slug)` returns a path/string; `…Of(null)` and `…Of('no-such')` return `null`; `genreGuideOf(slug)` of a 2-file genre composes in canonical order. Run `node --import tsx --test tests/unit/book-slug-accessors.test.ts` → pass.

## Task 2: Stateless `SoulService.composeForBook()`

- [ ] In `gateway/src/services/soul.ts`, extract the file-read+compose logic into a private helper operating on **locals** (e.g. `private async composeFrom(authorDir, voiceDir): Promise<string>` returning the same concatenation `getFullContext()` builds). Have `load()` set fields from it (or keep `load()` and add the helper reading independently — implementer's call, but `composeFrom` must not touch `this.*`).
- [ ] Add `async composeForBook(authorDir, voiceDir): Promise<string>` that returns `composeFrom(authorDir, voiceDir)`, fail-soft to `''` when `authorDir` is missing/unreadable. **No** instance-field writes.
- **Verify:** Add `tests/unit/soul-compose.test.ts`: load the singleton from dir A, snapshot `getFullContext()`, call `composeForBook(dirB, …)`, assert (i) it returns B's content, (ii) `getFullContext()` is **byte-identical** to the pre-call snapshot (no mutation), (iii) missing dir → `''`. Run the test → pass; `npx tsc --noEmit` clean.

## Task 3: `Project.bookSlug` binding at creation

- [ ] In `gateway/src/services/projects.ts`, add `bookSlug?: string` to the `Project` interface (after `pipelineId`/`pipelinePhase`).
- [ ] In `createProject`, `createProjectFromPipeline`, and `createProjectResolved`, read `context?.bookSlug` (string) and set it on the constructed project. Do not require it (legacy/no-book → `undefined`). Ensure it survives `saveState()`/reload (it will — state is saved wholesale).
- **Verify:** Extend an existing projects unit test (or add a focused one): `createProjectFromPipeline(pl, …, { bookSlug: 'foo' })` → `project.bookSlug === 'foo'`; without it → `undefined`; reload from disk preserves it. Run the unit suite → green; `npx tsc --noEmit` clean.

## Task 4: Set the binding at the three creation call sites

- [ ] `gateway/src/api/routes/projects.routes.ts` POST `/api/projects` (~138): pass `{ ...context, bookSlug: services.books?.getActiveBook() ?? undefined }` into the create call.
- [ ] `gateway/src/index.ts` Telegram path (~1645): same — bind to `gateway.books?.getActiveBook()` when building the project.
- [ ] `gateway/src/services/projects.ts` pipeline-of-projects builder (~1414, `createProjectResolved`): ensure the per-phase child projects inherit the parent's `bookSlug` (thread it via the `config`/`context` passed down).
- **Verify:** `npx tsc --noEmit` clean. (End-to-end binding proven by the Task 7 smoke assertion.)

## Task 5: Per-book composition in `handleMessage` + pass it from step executor

- [ ] In `gateway/src/index.ts`, add a trailing optional param `bookSlug?: string` to `handleMessage` (8th arg). Where `const soul = this.soul.getFullContext()` (542) and the `genreGuide` arg (567) are computed: if `bookSlug` is set, use `await this.soul.composeForBook(this.books.authorDirOf(bookSlug), this.books.voiceDirOf(bookSlug))` (falling back to `getFullContext()` when it returns `''`) and `this.books?.genreGuideOf(bookSlug) ?? undefined`. When unset, keep the exact current lines.
- [ ] At the three project-step `handleMessage('goal-engine', …)` call sites (1742, 1761, 1795), pass `project.bookSlug` as the new last arg.
- **Verify:** `npx tsc --noEmit` clean. Run the full unit suite → green. (Behavioral proof in Task 7.)

## Task 6: Route project output/reads by the project's book

- [ ] `gateway/src/index.ts` output + lookup sites (1823, 1923, 2123, 2162): replace `gateway.books?.activeDataDir?.()` with `gateway.books?.dataDirOf?.(project.bookSlug) ?? gateway.books?.activeDataDir?.()` (then the existing legacy fallback). Use the `project` already in scope.
- [ ] `gateway/src/api/routes/projects.routes.ts` (437, 465, 511, 991): same ladder, using the `project` loaded by id in each handler.
- [ ] `gateway/src/api/routes/documents.routes.ts` (432, 479, 533, 586): same ladder where a project is in scope.
- [ ] `export.routes.ts`/`wave.routes.ts` + `_shared.ts` `makeGatherChapters`: pass the **project's** slug (not the active resolver) when exporting a specific project; keep the active resolver as fallback.
- [ ] `heartbeat.routes.ts` (224): no project in scope — leave on `activeDataDir()`; add a one-line comment noting it's intentionally the active book (auto-input is a global convenience).
- **Verify:** `npx tsc --noEmit` clean; unit suite green. Build the frontend (`npm run build:frontend`) → no breakage.

## Task 7: Concurrent-binding isolation test (the Tier-D fix)

- [ ] In `tests/feature-smoke.sh`, upgrade the sequential two-book block to the Phase 8 guarantee: create book A (genre with an unguessable sentinel token in `must-haves.md`) and book B (different sentinel); create a one-step project bound to A; **switch the global active book to B**; run A's step; assert (i) A's output file is under A's `data/` dir and **absent** from B's, and (ii) the step response echoes A's sentinel and **not** B's. Guard each `POST /api/books/active` for HTTP 200 so a failed activate doesn't mis-blame routing. Keep the existing `-v` log streaming.
- **Verify:** locally `npx tsc --noEmit` + `node --import tsx --test tests/unit/*.test.ts` green; then deploy (`touch build_now`, poll `.build-logs/last-build.status` for fresh `result=PASS`) and run the live feature-smoke against Mercury (`BASE_URL=http://192.168.1.32:3847`). Expect the new isolation assertion to PASS and the suite count to rise with 0 failures.

## Task 8: `/code-review` (high), docs, tracking, commit_message

- [ ] Run `/code-review` at high effort over the working-tree diff (finder angles: missed read site / soul mutation leak / binding not threaded to child projects / legacy fallback regressions). Triage findings; apply correctness fixes, record refusals with rationale.
- [ ] Re-run gates after any fix (`tsc`, unit, frontend build, re-deploy + live smoke if code changed).
- [ ] `docs/BOOK-CONTAINER-ARCHITECTURE.md`: mark Phase 8 **Implemented (2026-06-10)** with a one-line summary + verify note. Move the Phase 8 item from `docs/TODO.md` to `docs/COMPLETED.md` (preserve bullet text, prepend `2026-06-10`, link spec+plan). Note Phase 9 (book-board UI) is next.
- [ ] Update `CLAUDE.md`'s `workspace/books/` line to state projects are now book-bound (drop the "Not yet driving generation"-style staleness if present for Phase 8).
- [ ] Write `commit_message` (`feat(phase8): bind projects to books — multi-book concurrency`; dash-prefixed detail per the repo convention). Do **not** commit.
- **Verify:** `git status` shows the expected file set + a `commit_message`; the live feature-smoke is green; the handoff (`.remember/remember.md`) and memory index reflect Phase 8 done.

---

## Out of scope (do not do here)

- Per-channel active book for chat (**Phase 10**); book-board UI (**Phase 9**); removing the global pointer; "move a project to another book"; Discord parity beyond the existing stub.
