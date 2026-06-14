# File Explorer — design (2026-06-13)

## Purpose

A studio UI to browse stored files: uploaded manuscripts under
`workspace/documents/` and a book's generated outputs under its `data/` dir.
Per file: **list, preview, download** — plus **delete** for documents. Today the
studio has no way to see these files (only the API/smoke tests touch them).

## Scope (decided)

- **Two sources, one route** (`/files`, "Files" in the Rail), tabbed:
  - **Documents** — `workspace/documents/`: list / preview / download / delete.
  - **Book outputs** — a book picker → that book's `data/` files: list / preview /
    download. **Read-only** (no per-file delete; whole-book deletion is the
    separate Delete-books feature).
- **Preview:** `.md` rendered (sanitized), `.txt`/`.extracted.txt` shown as text;
  binary (`.docx`/`.epub`) → "binary — download only".
- YAGNI: no rename, no move, no folder tree, no per-book-output delete.

## Backend (minimal — two read endpoints + a pure helper)

Listing already exists (`GET /api/documents`, `GET /api/books/:slug/files`); delete
exists for documents (`DELETE /api/documents/:filename`). Missing = reading a
file's content, which preview + download need. Add:

- **`gateway/src/services/file-preview.ts`** (pure, unit-tested): `contentTypeFor(name)`
  and `isPreviewableText(name)` — extension → MIME + whether the frontend can render
  it as text.
- **`GET /api/documents/:filename`** — serve the document. Default inline with the
  detected content-type (frontend `fetch().text()` for preview); `?download=1` →
  `Content-Disposition: attachment`. `safePath` guard under `workspace/documents`.
- **`GET /api/books/:slug/files/:filename`** — same, under `BookService.dataDirOf(slug)`.
  `SLUG_RE` + `safePath` guards.

Both behind the existing bearer-auth/IP perimeter; native download links use the
`?token=` query fallback (`authToken()`/`apiBase()` from shared, as `EntryList` does).

## Frontend

- **`frontend/studio/src/routes/Files.tsx`** (+ `.module.css`); route in `main.tsx`;
  NavLink in `Rail.tsx`.
- Documents tab: `GET /api/documents` → rows (filename, size, words, uploaded);
  click → preview (fetch content as text; `.md` via `DOMPurify.sanitize(marked.parse(...))`,
  never raw); Download (native `<a>` with `?download=1&token=`); Delete (with confirm,
  then refresh).
- Book outputs tab: book picker (`GET /api/books`) → `GET /api/books/:slug/files` →
  rows → preview / download. No delete.

## Testing / verification

- Unit (TDD): `file-preview.ts` (`tests/unit/file-preview.test.ts`).
- Integration: a new **Tier F** in `tests/extended-feature-smoke.sh` — upload a doc →
  list → GET content (preview) → `?download=1` → delete; plus a book's files list +
  GET one file's content.
- Frontend: `npm run build:frontend` (tsc + Vite) + manual click-through on deploy.
