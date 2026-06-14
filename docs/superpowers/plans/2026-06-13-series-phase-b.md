# Series Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Series-owned world-building (characters/places/lore.md) that books snapshot at create-time and that reaches generation prompts, plus the API + pull wiring.

**Architecture:** `SeriesBibleService` gains world-building file get/set under the per-series dir. `BookService.create` snapshots `selection.worldbuilding` into `templates/worldbuilding/`; `applySeriesAssets` resyncs it; `worldbuildingOf`/`getActiveWorldbuilding` compose it (mirroring `genreGuideOf`); `index.ts` injects it via `buildSystemPrompt`. `POST /api/books` (series path) + `POST /api/series/:id/pull/:slug` thread the series world-building in.

**Tech Stack:** Node 22 + TS (tsx), Express, node:test, bash smoke.

---

## File structure
- Modify `gateway/src/services/series-bible.ts` — `getWorldbuilding`/`setWorldbuilding`.
- Modify `gateway/src/services/book.ts` — `BookSelection.worldbuilding`; write in `create`; `applySeriesAssets` 3rd arg; `worldbuildingOf`/`getActiveWorldbuilding`.
- Modify `gateway/src/services/book-types.ts` — `WIRED_KINDS += 'worldbuilding'`.
- Modify `gateway/src/index.ts` — resolve `worldGuide` + `buildSystemPrompt` injection.
- Modify `gateway/src/api/routes/series.routes.ts` — GET/PUT worldbuilding; pass to pull.
- Modify `gateway/src/api/routes/books.routes.ts` — thread series worldbuilding into create.
- Create `tests/unit/series-worldbuilding.test.ts`, `tests/unit/book-worldbuilding.test.ts`.
- Modify `tests/extended-feature-smoke.sh` (Tier G) + `tests/series-smoke.sh`.

---

## Task 1: Series world-building store
**Files:** `series-bible.ts`; Test `tests/unit/series-worldbuilding.test.ts`
- [ ] Failing test: `setWorldbuilding(id,{characters:'C',lore:'L'})` then `getWorldbuilding(id)` → `{characters:'C',places:'',lore:'L'}`; files exist at `workspace/series/<id>/worldbuilding/*.md`; empty/missing → ''.
- [ ] Run → FAIL.
- [ ] Implement `getWorldbuilding(id)` (read 3 files, '' when absent) + `setWorldbuilding(id, files)` (mkdir worldbuilding dir, write each provided key tmp+rename, skip undefined). Keys: characters/places/lore only.
- [ ] Run → PASS. Commit.

## Task 2: Book create snapshot + worldbuildingOf
**Files:** `book.ts`, `book-types.ts`; Test `tests/unit/book-worldbuilding.test.ts`
- [ ] Failing tests: `create({…, worldbuilding:{characters:'Cap. Vane',lore:'The Drowned God'}})` writes `templates/worldbuilding/characters.md`+`lore.md` and `.baseline/worldbuilding/characters.md`; `worldbuildingOf(slug)` returns a string containing both under `## World-Building — Characters` / `## World-Building — Lore` headers, characters before lore; returns null when no worldbuilding.
- [ ] Run → FAIL.
- [ ] Implement: `BookSelection.worldbuilding?`; in `create()` (before the `.baseline` cp) write `templates/worldbuilding/<k>.md` for each non-empty of characters/places/lore; `WIRED_KINDS` add `'worldbuilding'`; `worldbuildingOf(slug)` (order characters→places→lore, `## World-Building — <Title>` headers, extra .md alphabetical, null when empty) + `getActiveWorldbuilding()`.
- [ ] Run → PASS. Commit.

## Task 3: applySeriesAssets world-building re-snapshot
**Files:** `book.ts`; Test add to `tests/unit/book-worldbuilding.test.ts`
- [ ] Failing test: book created with worldbuilding A; `applySeriesAssets(slug, {}, {characters:'B'})` → `templates/worldbuilding/characters.md` == 'B', `places.md`/`lore.md` removed (rm+rewrite), `.baseline` matches.
- [ ] Run → FAIL.
- [ ] Implement: `applySeriesAssets(slug, refs, worldbuilding?)` — when `worldbuilding` present, for both `templates` and `.baseline`: rm `worldbuilding/` dir, mkdir, write each non-empty key. (Existing ref logic unchanged.)
- [ ] Run → PASS. Commit.

## Task 4: Prompt injection
**Files:** `index.ts`
- [ ] Implement: resolve `const worldGuide = overrideSlug ? (this.books?.worldbuildingOf(overrideSlug) ?? undefined) : (this.books?.getActiveWorldbuilding() ?? undefined);` next to `genreGuide`; add `worldGuide` to the `buildSystemPrompt({…})` call; add `worldGuide?: string | null` to the `buildSystemPrompt` param type and emit, right after the genre-guide block:
```
if (context.worldGuide) {
  prompt += '# Active Book — World-Building\n\n';
  prompt += 'Treat the following as canon for this book — keep characters, places, and lore consistent with it:\n\n';
  prompt += context.worldGuide + '\n\n';
}
```
- [ ] Verify: `npx tsc --noEmit` clean. Commit.

## Task 5: API + inheritance wiring
**Files:** `series.routes.ts`, `books.routes.ts`
- [ ] series.routes: `GET /api/series/:id/worldbuilding` → `sb.getWorldbuilding(id)` (404 unknown series); `PUT /api/series/:id/worldbuilding` `{characters?,places?,lore?}` → `sb.setWorldbuilding` → 200. In `POST /:id/pull/:slug`, pass `sb.getWorldbuilding(id)` as the 3rd arg to `applySeriesAssets`.
- [ ] books.routes `POST /api/books` (series branch): after resolving refs, `const wb = services.seriesBible?.getWorldbuilding?.(body.series);` and include `worldbuilding: wb` in the `create()` selection.
- [ ] Verify: `npx tsc --noEmit` clean; full unit suite green. Commit.

## Task 6: Smoke + full verify
**Files:** `tests/extended-feature-smoke.sh` (Tier G), `tests/series-smoke.sh`
- [ ] Tier G: after creating the series, `PUT /api/series/:id/worldbuilding {characters:"Smoke FX hero"}`; after create-in-series, assert the book snapshot has it (`GET /api/books/:slug/templates/worldbuilding` via the existing book-templates read route, or a new read) → contains "Smoke FX hero".
- [ ] series-smoke.sh: set worldbuilding on the series before creating the 2 books; assert both series books' worldbuilding snapshot contains it and the standalone's does not.
- [ ] Verify: `bash -n`; full unit suite green; `npx tsc --noEmit` clean; `npm run build:frontend` green. Commit.

## Self-review
- Spec coverage: store (T1), snapshot+compose (T2), pull resync (T3), injection (T4), API+wiring (T5), smoke (T6). Divergence + UI deferred.
- Types: `getWorldbuilding`/`setWorldbuilding`, `BookSelection.worldbuilding {characters?,places?,lore?}`, `applySeriesAssets(slug,refs,worldbuilding?)`, `worldbuildingOf`, `buildSystemPrompt.worldGuide` — consistent across tasks.
