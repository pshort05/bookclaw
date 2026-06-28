# Files explorer — design

**Date:** 2026-06-28
**Status:** Approved (design)
**Scope:** Rewrite the studio **Files** screen into a book-centric file explorer (tree + view/edit pane), plus one new backend upload-into-a-directory endpoint.

## Problem

The current Files screen (`frontend/studio/src/routes/Files.tsx`) is a flat, two-tab list — **Documents** (workspace uploads) and **Books** (a flat list of one book's `data/` files) with a markdown/text preview. It does not let you browse a book's directory structure or edit files in place, and its upload only targets workspace documents. The owner wants a familiar file-explorer experience: a book selector at the top, a browsable directory tree, a view/edit pane on the right, and upload into the currently selected directory.

## Goals

1. A **book selector** at the top, defaulting to the active book, switchable to any book.
2. A **directory tree** of the selected book's files, rooted at the top of its structure.
3. A **view/edit pane** on the right for the selected file.
4. The **upload** button remains and uploads into the **currently selected directory**.

## Non-goals (YAGNI — out of scope)

- Browsing `book.json` / `.baseline/` (deliberately hidden by the path API; editing them can corrupt a book).
- Deleting book files; folder create/rename/move; drag-and-drop.
- Binary uploads (this pass: text only — `.md/.txt/.json/.csv`).
- Any MCP change (the new endpoint is gateway-only; MCP exposes no book-path file ops).

## What the backend already provides (no new read/list/edit work)

- `GET /api/books/:slug/runner-files` → `RunnerFile[]` where `RunnerFile = { path: string; group: 'Outputs'|'Templates'; bytes: number; modified: string }`. `path` is the book-root relative path (`data/manuscript.md`, `templates/genre/world.md`). This is the **recursive list** the tree is built from. Confined to `data/` + `templates/` (book.json/.baseline excluded).
- `GET /api/books/:slug/file?path=…` → read any `data/`/`templates/` file (`mapRunnerPath`-guarded; `?download=1` for attachment).
- `PUT /api/books/:slug/file` `{ path, content }` → write with version snapshot.
- `GET /api/books/:slug/file/versions?path=…` + restore (already wired; surfaced as "(versioned)" affordance, optional this pass).
- Documents root: `GET /api/documents` → `{ documents: [{ filename, size, wordCount?, uploadedAt? }] }`; `GET /api/documents/:filename` (read/download); `DELETE /api/documents/:filename`; `POST /api/documents/upload` (multer, `.txt/.md/.docx`). **No document-edit endpoint exists** → Documents files are view/download/delete only.

`mapRunnerPath(bookDir, relPath)` matches `^(data|templates)/(.+)$` and returns `{ baseDir, filename }` or `null` — the confinement primitive reused below.

## Design

### Layout

A two-pane explorer with a top bar (VS Code-style tree + editor, chosen over a Finder folder-grid because the editor stays persistent on the right):

```
[ Book ▾ selected ]                              [⬆ Upload]
┌── tree ──────────────┬── view / edit ──────────────────────┐
│ ▾ Documents/         │  path: data/manuscript.md            │
│ ▾ data/              │  ┌────────────────────────────────┐  │
│     manuscript.md    │  │ editor (text) / viewer (md/bin) │  │
│ ▾ templates/         │  └────────────────────────────────┘  │
│     genre/ author/…  │  [Save]  [Download]  [render/raw]     │
└──────────────────────┴──────────────────────────────────────┘
```

### Components

- **`Files` route** (orchestrator) — owns `slug` (selected book, default active), `selected` (the chosen node: source `book|documents` + path), `dirty`/`content` editor state, and `currentDir` (the directory upload targets).
- **`FileTree`** — pure presentational tree built from a `TreeNode` model. Roots: `Documents/` (from `/api/documents`), `data/`, `templates/` (from `runner-files`). Folders expand/collapse; clicking a file selects it; clicking a folder sets `currentDir` (the upload target). Folder/file icons, indentation.
- **`FileViewer`** — given a selected node, fetches content and renders: text (`md/txt/json/csv`) → editable `<textarea>` + Save (book files only); markdown → render/raw toggle; binary (`docx/epub/png/…`) → "binary — download only" + a download link. Documents text is shown **read-only** (no edit endpoint) with a note.
- **`filesExplorerApi`** (lib) — thin wrappers abstracting the two sources: `listBookFiles(slug)`, `readBookFile(slug, path)`, `writeBookFile(slug, path, content)`, `uploadToBookDir(slug, dir, file)`, and `listDocuments()/readDocument(name)/deleteDocument(name)/uploadDocument(file)`. Keeps the route thin and testable.

### Tree model

`buildTree(runnerFiles, documents)` — pure function turning the flat lists into a `TreeNode[]`:
```ts
interface TreeNode {
  name: string;            // segment label
  path: string;            // full book-root path (book) or filename (documents)
  source: 'book' | 'documents';
  kind: 'dir' | 'file';
  bytes?: number;
  children?: TreeNode[];   // dirs only
}
```
Built by splitting each `runner-files` `path` on `/` and folding into a nested structure; `Documents/` is a synthetic dir whose children are the flat documents list. Directories sort before files, alphabetically. This function is unit-tested (the only non-trivial frontend logic).

### Data flow

1. On mount / book change: `loadBooks()`; default `slug` to the active book; fetch `runner-files` + `documents`; `buildTree` → render tree; clear selection; `currentDir` defaults to `data` (the natural upload root).
2. Click a folder → set `currentDir` to that folder's book-root path (or `documents` for the Documents root). Click a file → select it; `FileViewer` fetches content.
3. Edit a text **book** file → Save → `PUT /api/books/:slug/file` (versioned) → toast + refresh that file's row.
4. Upload (top-bar button) → file picker → send to the **currentDir**: a book dir → the new `POST /api/books/:slug/upload`; the Documents root → `POST /api/documents/upload`. On success, refresh the tree and select the new file.

### The one new backend endpoint

`POST /api/books/:slug/upload` (in `books.routes.ts`):
- `multer({ limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: <ext in .md/.txt/.json/.csv>, storage: memoryStorage() }).single('file')`.
- Guards: `SLUG_RE`; resolve `bookDir` and require `book.json`; read body `dir` (book-root directory, e.g. `data`, `data/chapters`, `templates/genre`); sanitize the filename (reuse the existing `sandbox.sanitizeFilename` policy used by the documents upload; strip leading dots; cap length); compose `rel = "${dir}/${name}"`; `mapRunnerPath(bookDir, rel)` (→ confines to `data/`/`templates/`, else 400); `safePath(baseDir, filename)` (→ 403 on traversal).
- Write via the existing **`writeWithVersion(baseDir, filename, buffer.toString('utf-8'))`** — text-only allowlist makes the UTF-8 decode safe, and reusing `writeWithVersion` means an upload that overwrites an existing file **snapshots the prior content** (no silent data loss) and a new file just writes. Returns `{ ok: true, path: rel }`.

This adds a *write* affordance to the existing `data/`/`templates/` surface, reusing the same confinement + versioning the GET/PUT path-file endpoints already use.

## Error handling

- Unknown book / missing `book.json` → 404; bad slug → 400; `dir` outside `data/`/`templates/` → 400; traversal → 403; wrong extension → multer rejects (400 with a clear message); too large → 413.
- Frontend: failed reads/writes/uploads surface an inline error; a slow read for a previously-selected file must not overwrite a newer selection (guard with a "latest requested path" ref, as the current screen already does).

## Testing

- **Backend (TDD):** unit-test the upload route's path confinement + extension/versioning behavior at the handler-logic level where practical; extend an existing **smoke** (`tests/`) to upload a `.md` into a book `data/` dir and assert it then appears in `runner-files` and reads back via `GET …/file?path=` (per the goal: extend existing smokes rather than add new test files).
- **Frontend:** unit-test `buildTree` (the pure tree builder). The rest is verified by `tsc` + `build:frontend` + manual (no component-test harness).
- Full `tsc` (gateway + shared + studio) and `npm run test:unit` stay green.

## Files touched (anticipated)

- `gateway/src/api/routes/books.routes.ts` — new `POST /api/books/:slug/upload`.
- `frontend/studio/src/routes/Files.tsx` — rewritten orchestrator.
- `frontend/studio/src/routes/Files.module.css` — explorer styles (tree/editor panes).
- `frontend/studio/src/components/files/FileTree.tsx`, `FileViewer.tsx` — new components.
- `frontend/studio/src/lib/filesExplorerApi.ts` + `buildTree` (+ its unit test under `tests/unit/`).
- An existing smoke under `tests/` extended for the book-dir upload round-trip.

## Open questions

None — scope and decisions confirmed (data/+templates/ tree; Documents kept as a root; new text-only upload endpoint).
