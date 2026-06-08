# Phase 6e — Per-asset descriptions + suggested-next-step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give library assets that lack one (author/voice/genre/section) an editable **description** (sidecar `meta.json`, overlay-writable, snapshotted into books), surface it through the library + book-detail APIs, and add a **suggested-next-step** endpoint per book derived from its phase + whether it has output yet. Then surface both in the existing 6c Book Drawer (closing its deferred `.adesc` + next-action bits).

**Architecture:** Backend-first, TDD (the repo runs `node --test`). Descriptions live as `{"description": "..."}` sidecars: `library/<authors|voices|genres>/<name>/meta.json` and `library/sections/<name>.meta.json`, resolved overlay-shadows-builtin exactly like the asset files. Pipelines/skills keep their existing description source (JSON field / SKILL.md frontmatter) — untouched. Books snapshot the sidecar into `templates/`. Next-step is a pure function of `phase` + a `hasOutput` boolean (data/ non-empty); endpoints expose it. Front-end: extend the book-detail response with descriptions + wire the drawer.

**Tech Stack:** Node/TS (`LibraryService`, `BookService`, Express route mounters, `safePath`); React studio (`BookDrawer`).

**Spec/outline:** `docs/superpowers/plans/2026-06-07-phase6-frontend-rewrite.md` (6e outline) + `docs/BOOK-CONTAINER-ARCHITECTURE.md`. Run after 6c.

---

## Conventions (read once)

- **No git commits during execution** — build in the working tree; the maintainer pushes via `./push.sh`. Each task ends with a verification + review checkpoint. You are on `main` (intended; no branch/worktree).
- **Backend = strict TDD**: write the failing test, run it red, implement, run it green. Backend tests: `node --import tsx --test tests/unit/<file>.test.ts`. Use the existing `seedLibrary(root)` / temp-dir harness (see `tests/unit/library.test.ts`, `book.test.ts`).
- **Front-end = no test runner**: verify via `npx tsc --noEmit` + `npm run -w frontend/studio build` + manual.
- **Surgical changes.** Match existing style. `safePath` guards every overlay/template write (see `_shared.ts`). Descriptions apply ONLY to kinds `author|voice|genre|section`; do not alter pipeline/skill description sourcing.
- **Honest next-step**: derive from `phase` (+ `hasOutput`), NOT from parsing specific data filenames (the data dir uses `<projectId>-<stepLabel>.md`, not canonical names).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `gateway/src/services/library-types.ts` | add `description?` to `LibraryWriteBody` | Modify |
| `gateway/src/services/library.ts` | read description sidecar in `list()`/`get()`; persist it in `writeEntry`/`createEntry` | Modify |
| `gateway/src/services/book.ts` | snapshot description sidecars in `create()`; include `description` in `readTemplate`/`writeTemplate`; add `nextStep(slug)`; `hasOutput` helper | Modify |
| `gateway/src/services/book-types.ts` | add `suggestedNextStep(phase, hasOutput)` pure fn + `NextStep` type | Modify |
| `gateway/src/api/routes/books.routes.ts` | `GET /api/books/active/next`, `GET /api/books/:slug/next`; add `descriptions` to the `GET /api/books/:slug` detail response | Modify |
| `tests/unit/library-description.test.ts` | sidecar read/write round-trip | Create |
| `tests/unit/book-next.test.ts` | next-step logic + description snapshot | Create |
| `frontend/shared/src/types.ts` | `NextStep` type; `descriptions` on book detail | Modify |
| `frontend/studio/src/components/BookDrawer.tsx` | render per-asset `.adesc` + a next-step line | Modify |
| `frontend/studio/src/components/BookDrawer.module.css` | `.adesc` + next-step rule (port from concept) | Modify |

---

### Task 1: Library reads the description sidecar (TDD)

**Files:** Test `tests/unit/library-description.test.ts`; Modify `gateway/src/services/library.ts`.

- [ ] **Step 1: Failing test.** Create `tests/unit/library-description.test.ts` using the `seedLibrary` harness pattern from `tests/unit/library.test.ts` (copy its `write()` helper, `fakeSkills`, and `seedLibrary`). Add a builtin author sidecar and assert it surfaces:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';

// (copy write(), fakeSkills, seedLibrary from library.test.ts)

test('library reads description from an author meta.json sidecar', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libdesc-'));
  try {
    const lib = seedLibrary(root);
    // add a sidecar next to the builtin author dir
    write(join(root, 'library'), 'authors/default/meta.json', JSON.stringify({ description: 'A warm romantasy pen-name.' }));
    await lib.loadAll();
    const entry = lib.list('author').find((e) => e.name === 'default');
    assert.equal(entry?.description, 'A warm romantasy pen-name.');
    const full = lib.get('author', 'default');
    assert.equal(full?.description, 'A warm romantasy pen-name.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('library section reads description from <name>.meta.json sidecar', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libdesc-'));
  try {
    const lib = seedLibrary(root);
    write(join(root, 'library'), 'sections/front-matter.meta.json', JSON.stringify({ description: 'Title page + copyright.' }));
    await lib.loadAll();
    assert.equal(lib.list('section').find((e) => e.name === 'front-matter')?.description, 'Title page + copyright.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run red** — `node --import tsx --test tests/unit/library-description.test.ts` → FAIL (description undefined).

- [ ] **Step 3: Implement.** In `library.ts`, add a private helper that reads a description sidecar from a resolved entry directory/file, and call it where `list()`/`get()` build entries for `author|voice|genre|section` (do NOT override the pipeline/skill description). For author/voice/genre the sidecar is `<resolvedDir>/meta.json`; for section it is `<sectionsDir>/<name>.meta.json`. Resolution must respect the existing overlay-shadows-builtin logic (the same resolved path the asset files come from). Read defensively (missing/invalid JSON → undefined). Example helper:

```ts
private readDescriptionSidecar(file: string): string | undefined {
  try {
    if (!existsSync(file)) return undefined;
    const meta = JSON.parse(readFileSync(file, 'utf-8'));
    return typeof meta?.description === 'string' ? meta.description : undefined;
  } catch { return undefined; }
}
```

Wire it so the resolved sidecar path mirrors however the kind's files are resolved (overlay first, then builtin). For author/voice/genre: the directory's `meta.json`. For section: sibling `<name>.meta.json`.

- [ ] **Step 4: Run green** — the new test passes; `node --import tsx --test tests/unit/library*.test.ts` all pass; `npx tsc --noEmit` clean.

- [ ] **Step 5: Review checkpoint** — pipelines/skills description sourcing unchanged; missing sidecar → no crash, description simply absent.

---

### Task 2: Persist a description via writeEntry/createEntry (TDD)

**Files:** Modify `gateway/src/services/library-types.ts`, `gateway/src/services/library.ts`; extend `tests/unit/library-description.test.ts`.

- [ ] **Step 1: Failing test** (append to `library-description.test.ts`): write a description to the overlay and read it back via a reloaded service.

```ts
test('writeEntry persists a description sidecar to the overlay', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-libdesc-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    await lib.writeEntry('genre', 'romantasy', { description: 'Dragons + slow-burn romance.' });
    await lib.reload();
    assert.equal(lib.list('genre').find((e) => e.name === 'romantasy')?.description, 'Dragons + slow-burn romance.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run red** → FAIL (writeEntry doesn't accept/persist `description`).

- [ ] **Step 3: Implement.**
  - In `library-types.ts`, add `description?: string;` to `LibraryWriteBody`.
  - In `library.ts` `writeEntry` (and `createEntry`), after the existing file/content persistence, if `body.description` is a string AND `kind` ∈ `author|voice|genre|section`, write the sidecar JSON `{ description }` to the **overlay** path (mirror the existing `overlayPath(kind, name)`): author/voice/genre → `<overlayDir>/meta.json`; section → `<overlaySectionsDir>/<name>.meta.json`. Use `safePath`/the existing overlay-path helper; create parent dirs as the existing code does. Writing only a description (no files/content) must be allowed (don't require files).

- [ ] **Step 4: Run green** — new test passes; `library*.test.ts` + `library-write.test.ts` all pass; `tsc` clean.

- [ ] **Step 5: Review checkpoint** — description-only writes work; existing file/content writes unaffected; overlay shadows builtin.

---

### Task 3: Books snapshot the description + expose it (TDD)

**Files:** Modify `gateway/src/services/book.ts`; Test `tests/unit/book-next.test.ts` (description-snapshot portion).

- [ ] **Step 1: Failing test.** Create `tests/unit/book-next.test.ts` (use the `book.test.ts` seed pattern). Seed a genre with a description sidecar, create a book, assert `readTemplate` returns the description:

```ts
test('book snapshots the asset description and readTemplate returns it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-booknext-'));
  try {
    const lib = seedLibrary(root);
    write(join(root, 'library'), 'genres/romantasy/meta.json', JSON.stringify({ description: 'Dragons + romance.' }));
    await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.create({ title: 'B', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: ['front-matter'] });
    const t = svc.readTemplate('b', 'genre');
    assert.equal(t?.description, 'Dragons + romance.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement.** In `book.ts`:
  - `create()`: when snapshotting author/voice/genre dirs, also copy a resolved `meta.json` sidecar (if present) into the book's `templates/<kind>/meta.json`; for sections copy `<name>.meta.json` into `templates/sections/`. Source the resolved sidecar via the library (e.g. read `lib.get(kind, name)?.description` and write `{description}` into the snapshot — simplest, avoids path coupling).
  - `readTemplate(slug, kind, name?)`: for `author|voice|genre|section`, include `description?: string` in the returned object (read the snapshot's `meta.json`).
  - `writeTemplate(...)`: accept an optional `description` in the body and persist it to the book's `templates` sidecar (so the per-book copy is editable). Keep `safePath`.

- [ ] **Step 4: Run green** — test passes; `book*.test.ts` all pass; `tsc` clean.

- [ ] **Step 5: Review checkpoint** — snapshot copies description; book copy is independently editable; missing description → field simply absent.

---

### Task 4: Suggested-next-step (pure fn + endpoints) (TDD)

**Files:** Modify `gateway/src/services/book-types.ts`, `gateway/src/services/book.ts`, `gateway/src/api/routes/books.routes.ts`; extend `tests/unit/book-next.test.ts`.

- [ ] **Step 1: Failing test** (append to `book-next.test.ts`): test the pure function for each phase + hasOutput, and that `BookService.nextStep(slug)` reports `hasOutput` from the data dir.

```ts
import { suggestedNextStep } from '../../gateway/src/services/book-types.js';

test('suggestedNextStep maps every phase to a label/hint', () => {
  for (const p of ['planning','bible','production','revision','format','launch'] as const) {
    const s = suggestedNextStep(p, false);
    assert.ok(s.label.length > 0 && s.hint.length > 0, `phase ${p} has copy`);
  }
  assert.notEqual(suggestedNextStep('production', false).hint, suggestedNextStep('production', true).hint);
});

test('BookService.nextStep reports hasOutput from the data dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-booknext-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    let n = svc.nextStep('b');
    assert.equal(n?.hasOutput, false);
    // drop a file into data/
    writeFileSync(join(root, 'workspace', 'books', 'b', 'data', 'x.md'), 'hi');
    n = svc.nextStep('b');
    assert.equal(n?.hasOutput, true);
    assert.equal(n?.phase, 'planning');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run red** → FAIL.

- [ ] **Step 3: Implement.**
  - `book-types.ts`: add
    ```ts
    export interface NextStep { phase: string; hasOutput: boolean; label: string; hint: string; }
    export function suggestedNextStep(phase: string, hasOutput: boolean): { label: string; hint: string } {
      switch (phase) {
        case 'planning':  return { label: 'Plan the book',        hint: hasOutput ? 'Refine the premise and plan.' : 'Define the premise and high-level plan.' };
        case 'bible':     return { label: 'Build the story bible', hint: 'Develop characters, world, and outline.' };
        case 'production':return { label: hasOutput ? 'Continue drafting' : 'Start drafting', hint: hasOutput ? 'Write the next chapters.' : 'Begin writing chapter one.' };
        case 'revision':  return { label: 'Revise the manuscript', hint: 'Edit for craft, consistency, and pace.' };
        case 'format':    return { label: 'Format & compile',      hint: 'Produce the formatted manuscript and exports.' };
        case 'launch':    return { label: 'Launch',                hint: 'Prepare marketing and publish.' };
        default:          return { label: 'Open the book',         hint: 'Review the current state.' };
      }
    }
    ```
  - `book.ts`: add `nextStep(slug): NextStep | null` — open the book (or read its manifest) for `phase`, compute `hasOutput` by checking the book's `data/` dir has ≥1 entry (reuse the data-dir path helper, e.g. `activeDataDir`/`bookDir`), then `{ phase, hasOutput, ...suggestedNextStep(phase, hasOutput) }`. Return null if the book doesn't exist.
  - `books.routes.ts`: add `GET /api/books/:slug/next` → `{ next: svc.nextStep(slug) }` (404 if null) and `GET /api/books/active/next` → resolve the active slug then the same (matching the existing active-route pattern). Register alongside the other book routes, matching the existing mounter style.

- [ ] **Step 4: Run green** — tests pass; `tsc` clean.

- [ ] **Step 5: Review checkpoint** — endpoints match the mounter style; active-next resolves the active book or 404s cleanly.

---

### Task 5: Book-detail descriptions in the API + front-end types

**Files:** Modify `gateway/src/api/routes/books.routes.ts` (the `GET /api/books/:slug` handler), `frontend/shared/src/types.ts`.

- [ ] **Step 1: Add `descriptions` to the detail response.** In the `GET /api/books/:slug` handler, after opening the book, build `descriptions` from the snapshot via `readTemplate` for the wired kinds:
```ts
const descriptions = {
  author: services.books.readTemplate(slug, 'author')?.description,
  voice:  services.books.readTemplate(slug, 'voice')?.description,
  genre:  services.books.readTemplate(slug, 'genre')?.description,
};
res.json({ book: manifest, status, descriptions });
```
(Match the handler's existing variable names; keep the existing `{ book, status }` shape and just add `descriptions`.)

- [ ] **Step 2: Front-end types.** In `frontend/shared/src/types.ts` add:
```ts
export interface NextStep { phase: string; hasOutput: boolean; label: string; hint: string; }
export interface BookDetail { book: BookManifest; status: BookStatus; descriptions?: { author?: string; voice?: string; genre?: string }; }
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean; `node --import tsx --test tests/unit/book*.test.ts` pass.

- [ ] **Step 4: Review checkpoint** — detail response is backward-compatible (additive `descriptions`); types mirror the server.

---

### Task 6: Surface descriptions + next-step in the Book Drawer

**Files:** Modify `frontend/studio/src/components/BookDrawer.tsx`, `frontend/studio/src/components/BookDrawer.module.css`.

- [ ] **Step 1: Fetch detail (with descriptions) + next-step.** In `BookDrawer.tsx`, change the detail type to `BookDetail` and additionally fetch the next-step. In the mount effect, after the detail fetch, also `api<{ next: NextStep | null }>(\`/api/books/${encodeURIComponent(slug)}/next\`)` and store it (a `next` state). Tolerate next-step fetch failure (it's non-critical).

- [ ] **Step 2: Render per-asset `.adesc`.** Under each asset's `.v`, when `data.descriptions?.<kind>` is present render `<div className={styles.adesc}>{desc}</div>`. Port the `.adesc` rule (11px, dim, line-height 1.42) verbatim from the drawer section of `dashboard/concept/phase6-studio-shell.html`.

- [ ] **Step 3: Render the next-step.** Above or below the phase timeline, when `next` is present render a small block: `next.label` (emphasised) + `next.hint` (dim). Reuse the `.sec` label style for a "Next step" heading.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; `npm run -w frontend/studio build` succeeds. Manual: open a book whose genre has a description → the drawer shows it under Genre; the next-step line reflects the book's phase.

- [ ] **Step 5: Review checkpoint** — drawer degrades gracefully when descriptions/next are absent; no extra render cost when missing.

---

## Self-Review (6e)

- **Spec coverage:** delivers per-asset descriptions (author/voice/genre/section sidecars, overlay-writable, snapshotted) surfaced by library + book-detail APIs, and the suggested-next-step endpoints — plus it closes the 6c drawer's deferred `.adesc` + next-action. Pipelines/skills keep their existing description source (unchanged).
- **Placeholder scan:** every backend change is TDD with the failing test shown; the pure fn + endpoint shapes are literal; CSS references the concrete concept file with the named rule.
- **Type consistency:** `LibraryWriteBody.description` (Task 2) is consumed by `writeEntry` (Task 2) and the snapshot (Task 3); `suggestedNextStep`/`NextStep` (Task 4) match between server and `types.ts` (Task 5) and `BookDrawer` (Task 6); the detail `descriptions` shape matches between `books.routes.ts` (Task 5) and `BookDetail`.
- **Honesty:** next-step is phase-derived (+ hasOutput), not faked from artifact filenames the data dir doesn't use.
