# Phase 3 Loose Ends — Author/Voice split, skills snapshot, book DELETE

**Status:** Approved (brainstorm 2026-06-06). Feeds `writing-plans`.

**Goal:** Close the three deferred items from book-container Phase 3 — make **Voice** a first-class library asset selectable independently of **Author** (mix-and-match), snapshot a book's referenced **skills** as a frozen record, and add a **book DELETE** endpoint.

**Architecture:** Extend the existing library/book/soul mechanisms rather than add new services. `Voice` becomes a fifth file-backed library kind; `BookService.create()` snapshots author + voice (+ referenced skills) into the book's `templates/`; `SoulService` composes identity from the author dir and style from a new voice dir; a new `DELETE /api/books/:slug` removes a book and re-resolves the active pointer.

**Tech stack:** Node 22 + TypeScript (NodeNext, `.js` import extensions), Express routes, `node --test` unit tests via tsx, esbuild dashboard.

---

## Background / current state

- `LibraryService` (`gateway/src/services/library.ts`) is generic over kinds. `FILE_KINDS = ['author','genre','pipeline','section']` (multi-file kinds bundle their files; pipeline/section carry parsed/`content`). `LIBRARY_KINDS` additionally includes `skill`, which is **delegated to `SkillLoader`** — i.e. `library.get('skill', name)` already returns a skill's content. `DIR_LAYOUT` maps each file kind to a subdir under the library root.
- The built-in `library/authors/<name>/` bundles four files: `SOUL.md`, `PERSONALITY.md`, `STYLE-GUIDE.md`, `VOICE-PROFILE.md`.
- `SoulService` (`gateway/src/services/soul.ts`) loads four fields — `personality` (SOUL.md), `personalityOverride` (PERSONALITY.md), `styleGuide` (STYLE-GUIDE.md), `voiceProfile` (VOICE-PROFILE.md) — all from a single `soulDir`. `load()` resets all fields first (the Phase-3 no-leak fix), then overwrites when each file exists. `useBook(authorDir)` re-points `soulDir` + reloads. `getFullContext()` concatenates them.
- `BookService` (`gateway/src/services/book.ts`): `create(sel)` copies `author.files → templates/author/`, writes `templates/pipeline.json`, optionally `templates/genre/` + `templates/sections/`, and `data/`. `book.json.pulledFrom` records `{author, genre?, pipeline, sections[]}`. Active-book pointer + `seedDefaultBook()` (re-activate newest, else seed a Default Book) exist from Phase 3.
- The glossary (`docs/GLOSSARY.md`) already defines **Author** = identity (`SOUL.md` + `PERSONALITY.md`) and **Voice** = style (`STYLE-GUIDE.md` + `VOICE-PROFILE.md`).
- No `DELETE` for books — feature-smoke leaves a throwaway book that must be `docker exec rm`'d by hand.

## Decisions (from brainstorm)

1. **Author/Voice split: full first-class (mix-and-match).** Voice is its own library kind; a Book references an Author and a Voice independently.
2. **Skills snapshot: frozen record.** Snapshot the SKILL.md content of the skills **referenced by the chosen pipeline's steps** into `templates/skills/`. `SkillLoader` matching/injection stays global and unchanged — the snapshot is a record for reproducibility, not a driver.
3. **Delete active book: re-activate newest.** After deleting the active book, activate the newest remaining book; if none remain, re-seed a fresh Default Book (reuse `seedDefaultBook`). Always leaves an active book.
4. **SoulService stays a single composer reading two dirs** (recommended over splitting into Author/Voice services — the mix-and-match win is in the data layer; the four fields already exist).
5. **No migration (decision 6 — data expendable until v6).** The lone `default-book` is reseeded fresh; old-shape books degrade fail-soft (missing voice dir → blank style, default prompt). No version-bump or migration code.

## Components

### 1. Library — new `voice` kind
**Files:** `gateway/src/services/library-types.ts`, `gateway/src/services/library.ts`, `library/voices/<name>/`, `library/authors/<name>/` (re-seed).

- `library-types.ts`: add `'voice'` to `LIBRARY_KINDS` and to the `LibraryKind` union (`skill` is already present; `voice` is new).
- `library.ts`: add `'voice'` to `FILE_KINDS` and `DIR_LAYOUT.voice = 'voices'`. Voice is a **multi-file** kind (bundles its files), identical handling to `author`/`genre` in `loadKind()` — no new branch needed.
- Re-seed built-ins: for each `library/authors/<name>/`, move `STYLE-GUIDE.md` + `VOICE-PROFILE.md` into a new `library/voices/<name>/`; leave `SOUL.md` + `PERSONALITY.md` in `authors/`. Seed at least a `default` voice (paired with the `default` author). Content restructuring only — no code migration.

### 2. Book — reference + snapshot a Voice (+ skills record)
**Files:** `gateway/src/services/book-types.ts`, `gateway/src/services/book.ts`.

- `book.ts`: the `BookSelection` interface gains `voice: string`. `book-types.ts`: `BookManifest.pulledFrom` gains `voice: PulledRef` and `skills?: string[]` (snapshotted skill names, optional record).
- `book.ts`:
  - `DEFAULT_BOOK_SELECTION` gains `voice: 'default'`.
  - `create(sel)`: resolve `this.library.get('voice', sel.voice)` (throw on unknown, mirroring author); snapshot `voice.files → templates/voice/`.
  - **Skills snapshot:** read the chosen pipeline's steps, collect the distinct non-empty `step.skill` names, and for each call `this.library.get('skill', name)`; write the returned content to `templates/skills/<name>/SKILL.md` (create dir). Skip fail-soft if a skill isn't found (warn). Record the successfully-snapshotted names in `manifest.pulledFrom.skills`.
  - `pulledFrom.voice = ref(sel.voice, voice.source)`.
  - New accessor `activeVoiceDir(): string | null` → `templates/voice/` of the active book.

### 3. SoulService — compose author + voice from two dirs
**Files:** `gateway/src/services/soul.ts`, `gateway/src/init/phase-05-research-skills.ts`, `gateway/src/api/routes/books.routes.ts`.

- `soul.ts`: add a `voiceDir` field. `useBook(authorDir: string, voiceDir: string | null)` re-points `soulDir = authorDir` and `voiceDir`, then `load()`. In `load()`, read `SOUL.md` + `PERSONALITY.md` from `soulDir` (unchanged) and read `STYLE-GUIDE.md` + `VOICE-PROFILE.md` from `voiceDir` (falling back to `soulDir` if `voiceDir` is null — so an old-shape book whose `templates/author/` still has all four files still works). Keep the reset-first behavior and the fail-soft restore-on-error (restore both prev dirs). `getFullContext()` output is unchanged.
- `phase-05`: after `seedDefaultBook()`, call `gw.soul.useBook(gw.books.activeAuthorDir(), gw.books.activeVoiceDir())`.
- `books.routes.ts` `POST /api/books/active`: after `setActiveBook(slug)`, call `gateway.soul.useBook(gateway.books.activeAuthorDir(), gateway.books.activeVoiceDir())`.

### 4. Skills snapshot — covered in #2 (no new service; uses `library.get('skill', …)`).

### 5. Book DELETE
**Files:** `gateway/src/services/book.ts`, `gateway/src/api/routes/books.routes.ts`, `dashboard/src/panels/books.js`, `dashboard/src/main.js` (refresh).

- `book.ts` `async delete(slug): Promise<{ active: string | null }>`:
  - Validate slug with the same `^[a-z0-9][a-z0-9-]*$` guard (defense in depth); the route has already confirmed existence, so `delete()` assumes the dir exists.
  - `rm -rf` the book dir (`fs/promises` `rm({recursive:true, force:true})`).
  - If the deleted slug was active: set `activeBookSlug = null`, clear/rewrite the pointer, then `await seedDefaultBook()` (re-activates newest or seeds a fresh Default Book). Return the resulting active slug. If the deleted slug was **not** active, leave the active pointer untouched and return the current active slug.
- `books.routes.ts` `DELETE /api/books/:slug`: validate slug → 400; `open()` to confirm existence → 404 if missing; `const { active } = await books.delete(slug)`; if `active` differs from the slug the caller had been using (i.e. the active book changed), call `gateway.soul.useBook(gateway.books.activeAuthorDir(), gateway.books.activeVoiceDir())`. Return `{ deleted: slug, active }`.
- Dashboard `books.js`: a **Delete** button per row → `confirm()` dialog → `DELETE /api/books/:slug` → re-render list + `refreshActiveBook()`.

## Testing

**Unit (`tests/unit/`):**
- `library.test`/new: `list('voice')` + `get('voice','default')` returns the two voice files; `voice` is in the kinds.
- `book` create: snapshots `templates/voice/*` and `templates/skills/<name>/SKILL.md` for pipeline-referenced skills; `pulledFrom.voice` + `pulledFrom.skills` populated; unknown voice → throws.
- `soul-usebook`: with author dir (SOUL+PERSONALITY) + separate voice dir (STYLE-GUIDE+VOICE-PROFILE), `getFullContext()` includes both; switching to a book whose voice dir lacks files does not leak the prior book's style (extends the existing no-leak test); `voiceDir=null` falls back to reading style from the author dir.
- `book` delete: deleting the active book re-activates the newest remaining; deleting the last book re-seeds a Default Book; deleting unknown → throws (404 at route); slug-guard rejects traversal.

**feature-smoke (`tests/feature-smoke.sh`):**
- Tier A: assert `library list` includes a `voice` kind; create a book passing both `author` and `voice`.
- Teardown: replace the manual `docker exec rm` note with a real `DELETE /api/books/:slug` cleanup.

## Out of scope (unchanged)
- **Genre** stays snapshot-but-unwired (not injected into prompts this round).
- **Version gate** stays informational (decision 6); no enforcement, no migration runners.
- **Concurrency / multi-active-book** deferred.
- Per-channel active-book selection; the dashboard "book board" UI.

## Success criteria
- A Book can be created with an Author and a Voice chosen independently; the same Voice is reusable across Authors.
- Generated prose for a book reflects its Author (identity) + its Voice (style); switching the active book switches both with no cross-book leakage.
- A book's `templates/skills/` contains the SKILL.md content its pipeline references at create time; global skill matching is unchanged.
- `DELETE /api/books/:slug` removes a book; deleting the active one leaves a sensible new active book; the dashboard can delete with a confirm.
- `npx tsc --noEmit` clean; unit suite green; feature-smoke green against a deployed build, with book cleanup via the new DELETE.
