# Files Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rewrite the studio Files screen into a book-centric file explorer (book selector → directory tree → view/edit pane) and add one backend endpoint to upload a text file into a selected book directory.

**Architecture:** The tree is built on the frontend from the existing recursive `GET /api/books/:slug/runner-files` list plus the workspace `GET /api/documents` list; read/edit use the existing path-file endpoints; one new `POST /api/books/:slug/upload` writes into `data/`/`templates/` reusing `mapRunnerPath` + `writeWithVersion`.

**Tech Stack:** TypeScript (NodeNext, `.js` specifiers), Express + multer, React (Vite studio), `node:test`.

## Global Constraints

- Node 22+, `.js` import specifiers in `.ts` (NodeNext).
- No per-step `git commit` — repo uses a `commit_message` + `./push.sh` flow; "Commit" steps are replaced by **verify gates** (run the test / `tsc`). Do not `git commit`.
- Browse/edit confined to `data/` + `templates/` (book.json/.baseline hidden). Upload text only: `.md/.txt/.json/.csv`, ≤10MB.
- Path confinement via the existing `mapRunnerPath` + `safePath`; never write a raw user path.
- Documents (workspace) are view/download/delete only — no document-edit endpoint exists.

---

### Task 1: Backend — upload-target resolver + `POST /api/books/:slug/upload`

**Files:**
- Modify: `gateway/src/services/runner-files.ts` (add `UPLOAD_EXTS`, `isUploadableName`, `resolveBookUpload`)
- Modify: `gateway/src/api/routes/books.routes.ts` (add `import multer from 'multer'` + the route)
- Test: `tests/unit/runner-files-upload.test.ts` (new)

**Interfaces:**
- Produces: `isUploadableName(name: string): boolean`; `resolveBookUpload(bookDir: string, dir: string, name: string): { baseDir: string; filename: string } | null` — composes `"${dir}/${name}"`, confines via `mapRunnerPath`, returns null when outside `data/`/`templates/` or on traversal. Route: `POST /api/books/:slug/upload` multipart field `file` + body `dir`, returns `{ ok: true, path }`.

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/runner-files-upload.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUploadableName, resolveBookUpload } from '../../gateway/src/services/runner-files.js';

test('isUploadableName allows text kinds only', () => {
  for (const ok of ['a.md', 'a.txt', 'a.json', 'a.csv', 'A.MD']) assert.equal(isUploadableName(ok), true, ok);
  for (const no of ['a.docx', 'a.png', 'a', 'a.exe']) assert.equal(isUploadableName(no), false, no);
});

test('resolveBookUpload confines to data/ and templates/', () => {
  const book = '/books/x';
  assert.deepEqual(resolveBookUpload(book, 'data', 'ch1.md'), { baseDir: '/books/x/data', filename: 'ch1.md' });
  assert.deepEqual(resolveBookUpload(book, 'templates/genre', 'g.md'), { baseDir: '/books/x/templates', filename: 'genre/g.md' });
  assert.deepEqual(resolveBookUpload(book, 'data/', 'ch1.md'), { baseDir: '/books/x/data', filename: 'ch1.md' }); // trailing slash tolerated
  assert.equal(resolveBookUpload(book, 'config', 'x.md'), null);   // not data/templates
  assert.equal(resolveBookUpload(book, 'data/../..', 'x.md'), null); // traversal blocked
  assert.equal(resolveBookUpload(book, 'data', '../escape.md'), null); // traversal via name
});
```

- [ ] **Step 2: Run — expect FAIL** (`isUploadableName`/`resolveBookUpload` not exported)

Run: `node --import tsx --test tests/unit/runner-files-upload.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Add the helpers to `runner-files.ts`**

Append to `gateway/src/services/runner-files.ts` (it already exports `mapRunnerPath`):

```ts
/** Text file kinds accepted by the per-directory upload (book file explorer). */
export const UPLOAD_EXTS = ['.md', '.txt', '.json', '.csv'] as const;

export function isUploadableName(name: string): boolean {
  const ext = '.' + (name.split('.').pop() || '').toLowerCase();
  return (UPLOAD_EXTS as readonly string[]).includes(ext);
}

/**
 * Resolve a per-directory upload target to a confined { baseDir, filename } under
 * the book's data/ or templates/ subtree, or null if it escapes. `dir` is a
 * book-root directory (e.g. "data", "data/chapters", "templates/genre"); `name`
 * is the (already sanitized) filename.
 */
export function resolveBookUpload(bookDir: string, dir: string, name: string): { baseDir: string; filename: string } | null {
  const cleanDir = (dir || '').replace(/\/+$/, '');
  return mapRunnerPath(bookDir, `${cleanDir}/${name}`);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --import tsx --test tests/unit/runner-files-upload.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the route to `books.routes.ts`**

Add the import at the top (alongside the others):

```ts
import multer from 'multer';
import { mapRunnerPath, isUploadableName, resolveBookUpload } from '../../services/runner-files.js';
```
(Replace the existing `import { mapRunnerPath } from '../../services/runner-files.js';` line with the combined import.)

Add the route inside `mountBooks` (next to the other `/api/books/:slug/file` routes, after the `runner-files` GET):

```ts
  // Upload a text file into a book directory under data/ or templates/ (file explorer).
  // Confined by mapRunnerPath + safePath; overwrites snapshot the prior content via
  // writeWithVersion. Text-only allowlist (.md/.txt/.json/.csv), 10MB cap.
  app.post('/api/books/:slug/upload', multer({
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, isUploadableName(file.originalname || '')),
    storage: multer.memoryStorage(),
  }).single('file'), async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const bookDir = services.books.bookDir(slug);
    if (!bookDir || !existsSync(join(bookDir, 'book.json'))) return res.status(404).json({ error: 'Book not found' });
    const file = (req as unknown as { file?: { originalname: string; buffer: Buffer } }).file;
    if (!file?.buffer) return res.status(400).json({ error: 'a text file upload (field "file", .md/.txt/.json/.csv) is required' });
    const dir = String(req.body?.dir ?? '');
    const name = gateway.sandbox.sanitizeFilename(file.originalname || 'upload').replace(/^\.+/, '').slice(0, 200) || 'upload';
    if (!isUploadableName(name)) return res.status(400).json({ error: 'unsupported file type (use .md/.txt/.json/.csv)' });
    const mapped = resolveBookUpload(bookDir, dir, name);
    if (!mapped) return res.status(400).json({ error: 'dir must be under data/ or templates/' });
    if (!safePath(mapped.baseDir, mapped.filename)) return res.status(403).json({ error: 'Path traversal blocked' });
    try {
      await writeWithVersion(mapped.baseDir, mapped.filename, file.buffer.toString('utf-8'));
      res.json({ ok: true, path: `${dir.replace(/\/+$/, '')}/${name}` });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });
```

- [ ] **Step 6: Verify gate** — `npx tsc --noEmit` exit 0; the unit test still PASS.

---

### Task 2: Frontend — `buildTree` (pure) + `filesExplorerApi` wrappers

**Files:**
- Create: `frontend/studio/src/lib/filesExplorerApi.ts`
- Test: `tests/unit/build-tree.test.ts` (new) — imports the pure builder

**Interfaces:**
- Produces: `TreeNode` (below); `buildTree(files: { path: string }[], documents: { filename: string; size?: number }[]): TreeNode[]`; api wrappers `listBookFiles`, `readBookFile`, `writeBookFile`, `uploadToBookDir`, `listDocuments`, `readDocumentText`, `deleteDocument`, `uploadDocument`.

- [ ] **Step 1: Write the failing `buildTree` test**

Create `tests/unit/build-tree.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../../frontend/studio/src/lib/filesExplorerApi.js';

test('buildTree nests book paths and adds a Documents root', () => {
  const tree = buildTree(
    [{ path: 'data/manuscript.md' }, { path: 'templates/genre/world.md' }, { path: 'templates/author/SOUL.md' }],
    [{ filename: 'notes.txt' }],
  );
  // Documents root first, then data/, templates/ (dirs sorted, files within)
  const names = tree.map((n) => n.name);
  assert.deepEqual(names, ['Documents', 'data', 'templates']);
  const templates = tree.find((n) => n.name === 'templates')!;
  assert.deepEqual(templates.children!.map((c) => c.name).sort(), ['author', 'genre']);
  const genre = templates.children!.find((c) => c.name === 'genre')!;
  assert.equal(genre.children![0].path, 'templates/genre/world.md');
  assert.equal(genre.children![0].kind, 'file');
  const docs = tree.find((n) => n.name === 'Documents')!;
  assert.equal(docs.source, 'documents');
  assert.equal(docs.children![0].path, 'notes.txt');
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --import tsx --test tests/unit/build-tree.test.ts`
Expected: FAIL — module/exports missing.

- [ ] **Step 3: Implement `filesExplorerApi.ts`**

Create `frontend/studio/src/lib/filesExplorerApi.ts`:

```ts
import { api, apiBase, authToken } from '@bookclaw/shared';

export interface TreeNode {
  name: string;
  path: string;                 // book-root path (book) or filename (documents)
  source: 'book' | 'documents';
  kind: 'dir' | 'file';
  bytes?: number;
  children?: TreeNode[];
}

/** Build a sorted tree from the flat runner-files list + the workspace documents list. */
export function buildTree(files: { path: string; bytes?: number }[], documents: { filename: string; size?: number }[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirByPath = new Map<string, TreeNode>();
  const ensureDir = (segs: string[], source: 'book' | 'documents'): TreeNode => {
    let parentChildren = roots;
    let acc = '';
    let node: TreeNode | undefined;
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      node = dirByPath.get(acc);
      if (!node) {
        node = { name: seg, path: acc, source, kind: 'dir', children: [] };
        dirByPath.set(acc, node);
        parentChildren.push(node);
      }
      parentChildren = node.children!;
    }
    return node!;
  };
  // Documents synthetic root
  const docsRoot: TreeNode = { name: 'Documents', path: 'Documents', source: 'documents', kind: 'dir', children: [] };
  dirByPath.set('Documents', docsRoot);
  roots.push(docsRoot);
  for (const d of documents) docsRoot.children!.push({ name: d.filename, path: d.filename, source: 'documents', kind: 'file', bytes: d.size });
  // Book files
  for (const f of files) {
    const segs = f.path.split('/');
    const fileName = segs.pop()!;
    const parent = segs.length ? ensureDir(segs, 'book') : null;
    const fileNode: TreeNode = { name: fileName, path: f.path, source: 'book', kind: 'file', bytes: f.bytes };
    (parent ? parent.children! : roots).push(fileNode);
  }
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
    for (const n of nodes) if (n.children) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

const TEXT_RE = /\.(md|markdown|txt|text|log|csv|json)$/i;
export const isTextName = (name: string) => TEXT_RE.test(name);

async function fetchText(path: string): Promise<string> {
  const t = authToken();
  const res = await fetch(apiBase() + path, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

export const listBookFiles = (slug: string) =>
  api<{ files: { path: string; group: string; bytes: number; modified: string }[] }>(`/api/books/${encodeURIComponent(slug)}/runner-files`);
export const readBookFile = (slug: string, path: string) =>
  fetchText(`/api/books/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}`);
export const writeBookFile = (slug: string, path: string, content: string) =>
  api(`/api/books/${encodeURIComponent(slug)}/file`, { method: 'PUT', body: JSON.stringify({ path, content }) });
export const bookFileUrl = (slug: string, path: string, download = false) => {
  const t = authToken();
  const u = `${apiBase()}/api/books/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(path)}${download ? '&download=1' : ''}`;
  return t ? `${u}&token=${encodeURIComponent(t)}` : u;
};
export const listDocuments = () => api<{ documents: { filename: string; size: number; wordCount?: number }[] }>('/api/documents');
export const readDocumentText = (name: string) => fetchText(`/api/documents/${encodeURIComponent(name)}`);
export const documentUrl = (name: string, download = false) => {
  const t = authToken();
  const u = `${apiBase()}/api/documents/${encodeURIComponent(name)}${download ? '?download=1' : ''}`;
  return t ? `${u}${download ? '&' : '?'}token=${encodeURIComponent(t)}` : u;
};
export const deleteDocument = (name: string) => api(`/api/documents/${encodeURIComponent(name)}`, { method: 'DELETE' });

export async function uploadToBookDir(slug: string, dir: string, file: File): Promise<void> {
  const fd = new FormData(); fd.append('dir', dir); fd.append('file', file);
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/books/${encodeURIComponent(slug)}/upload`, { method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, body: fd });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || String(res.status));
}
export async function uploadDocument(file: File): Promise<void> {
  const fd = new FormData(); fd.append('file', file);
  const t = authToken();
  const res = await fetch(`${apiBase()}/api/documents/upload`, { method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, body: fd });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || String(res.status));
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --import tsx --test tests/unit/build-tree.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify gate** — `( cd frontend/studio && npx tsc --noEmit )` exit 0.

---

### Task 3: Frontend — `FileTree` + `FileViewer` components

**Files:**
- Create: `frontend/studio/src/components/files/FileTree.tsx`
- Create: `frontend/studio/src/components/files/FileViewer.tsx`

**Interfaces:**
- Consumes: `TreeNode`, the api wrappers, `isTextName` (Task 2).
- Produces:
  - `FileTree({ nodes, selectedPath, onSelectFile, onSelectDir }): JSX` — renders the recursive tree; folders toggle open/closed and call `onSelectDir(node)`; files call `onSelectFile(node)`.
  - `FileViewer({ slug, node, onSaved }): JSX` — fetches + shows the selected node; text book-files editable with Save (`writeBookFile`); documents text read-only; markdown render/raw toggle; binary → download link.

- [ ] **Step 1: Implement `FileTree.tsx`** — a recursive component with local open-state per dir (or open-set in parent). Folder rows show a chevron + folder icon + name; file rows a file icon + name, highlighted when `node.path === selectedPath`. Clicking a folder toggles open and calls `onSelectDir(node)`; clicking a file calls `onSelectFile(node)`. Use simple inline styles or `Files.module.css` classes (Task 4).

- [ ] **Step 2: Implement `FileViewer.tsx`** — on `node` change, if `isTextName(node.name)` fetch text (`readBookFile`/`readDocumentText`) into editor state (guard against stale responses with a "latest path" ref); render a `<textarea>` (editable only when `node.source === 'book'`), a markdown render/raw toggle for `.md`, a Save button (book text only) calling `writeBookFile` then `onSaved()`, and a Download link (`bookFileUrl`/`documentUrl`). For non-text, show "binary file — download only" + the download link. Documents show a small "read-only (workspace document)" note.

- [ ] **Step 3: Verify gate** — `( cd frontend/studio && npx tsc --noEmit )` exit 0 (components compile once consumed in Task 4; if tsc flags unused, proceed — they're wired in Task 4).

---

### Task 4: Frontend — rewrite the `Files` route + styles

**Files:**
- Modify: `frontend/studio/src/routes/Files.tsx` (full rewrite)
- Modify: `frontend/studio/src/routes/Files.module.css` (explorer layout)

**Interfaces:** Consumes Tasks 2–3.

- [ ] **Step 1: Rewrite `Files.tsx`** — orchestrator:
  - `useBooks()` + `useStore(s => s.loadBooks)` + `useActiveBook()`; `const [slug, setSlug] = useState('')` defaulted to the active book once books load (same pattern as `StructureLength.tsx`).
  - State: `tree: TreeNode[]`, `selected: TreeNode | null`, `currentDir: string` (default `'data'`), `err`.
  - `refresh()` — `Promise.all([listBookFiles(slug), listDocuments()])` → `buildTree(files, documents)` → `setTree`.
  - Top bar: **Book** `<select>` (defaults active) + an **Upload** button (hidden file input). Upload sends to `currentDir`: if `currentDir === 'Documents'` → `uploadDocument(file)`, else `uploadToBookDir(slug, currentDir, file)`; then `refresh()`.
  - Two-pane body: `<FileTree nodes={tree} selectedPath={selected?.path} onSelectDir={(n) => setCurrentDir(n.path)} onSelectFile={setSelected} />` and `<FileViewer slug={slug} node={selected} onSaved={refresh} />`.
  - Show the `currentDir` (upload target) near the Upload button so it's obvious where an upload lands.

- [ ] **Step 2: Update `Files.module.css`** — a `.bar` (top), a CSS grid body `grid-template-columns: 280px 1fr` with the tree pane scrollable and the viewer pane filling; tree row/indent styles; reuse existing tokens (`--panel`, `--line`, `--text`, `--ember`).

- [ ] **Step 3: Verify gate** — `( cd frontend/studio && npx tsc --noEmit )` exit 0; `npm run build:frontend` exit 0; manual: load `/files`, switch book, browse a folder, open + edit + save a `data/` `.md`, upload a `.md` into the selected dir.

---

### Task 5: Smoke coverage + full verification

**Files:**
- Modify: `tests/prompt-runner-smoke.sh` (it already provisions a book and exercises `/api/books/:slug/file?path=` — add the upload round-trip)

- [ ] **Step 1: Extend the smoke** — after the smoke has a book `$SLUG`, upload a small markdown file into `data/` and assert it round-trips:

```bash
# Files explorer: upload a text file into the book's data/ dir, then read it back.
TMP=$(mktemp --suffix=.md); printf '# Smoke Upload\n\nhello\n' > "$TMP"
UCODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -H "Authorization: Bearer $TOKEN" \
  -F "dir=data" -F "file=@$TMP;type=text/markdown" "$BASE_URL/api/books/$SLUG/upload")
rm -f "$TMP"
[ "$UCODE" = "200" ] && pass "book-dir upload accepted" || fail "book-dir upload" "code=$UCODE"
# It appears in runner-files and reads back
req GET "/api/books/$SLUG/runner-files" | grep -q "data/$(basename "$TMP")" >/dev/null 2>&1 || true
RB=$(req GET "/api/books/$SLUG/file?path=data/smoke-upload.md" 2>/dev/null)   # adjust to the sanitized name
```
(Adapt the asserted filename to the sanitized upload name; assert the read-back body contains `Smoke Upload`. Match the smoke's existing `pass`/`fail`/`req`/`code` helpers.)

- [ ] **Step 2: Full verification**

Run:
```bash
npx tsc --noEmit                                  # gateway
( cd frontend/shared && npx tsc --noEmit )
( cd frontend/studio && npx tsc --noEmit )
node --import tsx --test tests/unit/*.test.ts     # full unit suite (+ the 2 new files)
npm run build:frontend
bash -n tests/prompt-runner-smoke.sh              # smoke syntax
```
Expected: all exit 0; unit suite 0 fail.

---

## Self-Review

**Spec coverage:** book selector → Task 4; directory tree → Tasks 2 (buildTree) + 3 (FileTree); view/edit pane → Task 3 (FileViewer) on existing read/PUT; upload-into-current-dir → Task 1 (endpoint) + Task 4 (wiring); Documents kept as a root → buildTree (Task 2) + read-only viewer (Task 3); confinement/versioning → Task 1; testing → buildTree + resolver unit tests + extended smoke (Task 5).

**Placeholder scan:** none — backend route, helpers, buildTree, and api wrappers are full code; components are specified by interface + behavior for inline implementation.

**Type consistency:** `TreeNode`/`buildTree`/api-wrapper names match across Tasks 2–4; `resolveBookUpload`/`isUploadableName` match between Task 1's helper, route, and test.

## Notes / known limitations

- No React component-test harness → `FileTree`/`FileViewer` verified by `tsc` + build + manual; the pure `buildTree` and `resolveBookUpload`/`isUploadableName` carry the unit coverage.
- Out of scope (filed if wanted later): book-file delete, folder create/rename, binary upload, version-restore UI in the viewer.
