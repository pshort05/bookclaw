# Asset Studio Code-Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply fixes A–J from the Asset Studio code review: one stored-XSS patch (A), one TDD security check (B), five correctness/UX fixes (C/D/E/F/I), one type fix (J), and two shared-helper cleanups (G/H).

**Architecture:** Fixes are independent of each other except G (shared helper) which must land before the three components that consume it. All gateway fixes (B, E, F) are pure TypeScript. All frontend fixes target `frontend/studio/src/`. No new files except `sourceBadge.ts` (Fix G). No commits — maintainer runs `./push.sh`.

**Tech Stack:** TypeScript/React (frontend), Node.js/TypeScript (gateway), DOMPurify (new dep, Fix A), Node test runner (Fix B TDD), Vite (build gate).

---

## Files to be modified

| File | Fix(es) |
|------|---------|
| `frontend/studio/package.json` | A — add dompurify + @types/dompurify |
| `frontend/studio/src/components/asset/ProseEditor.tsx` | A, G |
| `frontend/studio/src/components/asset/EntryList.tsx` | C, G, J |
| `frontend/studio/src/components/asset/PipelineEditor.tsx` | D, F(frontend), G |
| `frontend/studio/src/components/asset/RepullPanel.tsx` | I |
| `frontend/studio/src/lib/assetApi.ts` | G(helper), H |
| `frontend/studio/src/routes/AssetStudio.tsx` | J (type on handleSelect) |
| `frontend/studio/src/lib/sourceBadge.ts` | G — new file |
| `gateway/src/services/book-transfer.ts` | B |
| `gateway/src/api/routes/books.routes.ts` | E |
| `gateway/src/services/library.ts` | F(gateway) |
| `tests/unit/book-transfer.test.ts` | B — new test case |

---

## Task 1: Fix A — add DOMPurify and sanitize markdown preview in ProseEditor

**Files:**
- Modify: `frontend/studio/package.json`
- Modify: `frontend/studio/src/components/asset/ProseEditor.tsx`

- [ ] **Step 1: Add DOMPurify deps to package.json**

In `frontend/studio/package.json`, add to `devDependencies` (they are build-time only, per the existing comment):
```json
"dompurify": "^3.1.0",
"@types/dompurify": "^3.0.5",
```

The full `devDependencies` block becomes:
```json
"devDependencies": {
    "@bookclaw/shared": "*",
    "dompurify": "^3.1.0",
    "@types/dompurify": "^3.0.5",
    "marked": "^12.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
```

- [ ] **Step 2: Install the new deps**

Run from repo root (workspace package.json drives the workspaces):
```bash
cd /home/paul/data/dev/bookclaw && npm install -w frontend/studio
```

Expected: lock file updated, `dompurify` and `@types/dompurify` appear under `node_modules`.

- [ ] **Step 3: Update ProseEditor — import DOMPurify and sanitize `preview`**

In `frontend/studio/src/components/asset/ProseEditor.tsx`:

Replace the import block at the top:
```ts
import { useEffect, useState, useRef } from 'react';
import { marked } from 'marked';
```
with:
```ts
import { useEffect, useState, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
```

Replace the `preview` line (currently line 50):
```ts
  const preview = selectedFile ? (marked.parse(currentContent) as string) : '';
```
with:
```ts
  const preview = selectedFile ? DOMPurify.sanitize(marked.parse(currentContent) as string) : '';
```

Replace the misleading comment (currently line 204):
```ts
              {/* Content is author-owned, same-origin workspace markdown — not third-party user input. */}
```
with:
```ts
              {/* Book-scope content can be imported from untrusted .zip archives — sanitize before render. */}
```

Both `dangerouslySetInnerHTML={{ __html: preview }}` sites (read-only branch, line 169; edit-mode preview, line 205) already use `preview`, so both are covered by the single sanitized assignment.

- [ ] **Step 4: Verify type-check is clean**

```bash
cd /home/paul/data/dev/bookclaw && npx tsc --noEmit
```
Expected: no errors.

---

## Task 2: Fix B — TDD: flag HTML/XSS payloads on import (book-transfer)

**Files:**
- Modify: `tests/unit/book-transfer.test.ts` (new test case first — RED)
- Modify: `gateway/src/services/book-transfer.ts` (implementation — GREEN)

- [ ] **Step 1: Write the failing test (RED)**

Append this test to `tests/unit/book-transfer.test.ts` (after the last existing `test(...)` block):

```ts
test('validateAndStage flags HTML/XSS payloads in template .md files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-xfer-'));
  try {
    const { xfer } = await setup(root);
    // Each payload should produce a finding (not auto-finalize).
    const payloads = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '<iframe src="javascript:alert(1)">',
    ];
    for (const payload of payloads) {
      const entries: Record<string, string> = {
        'book.json': validBookJson(),
        'templates/author/SOUL.md': payload,
      };
      const r = xfer.validateAndStage(makeZip(entries));
      assert.equal(r.structuralError, undefined, `no structural error for payload: ${payload}`);
      assert.ok(
        r.findings.some(f => f.path === 'templates/author/SOUL.md'),
        `expected a finding for payload: ${payload}`,
      );
      xfer.purgeStaging(r.stagingId);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run the test to confirm RED**

```bash
cd /home/paul/data/dev/bookclaw && node --import tsx --test tests/unit/book-transfer.test.ts 2>&1 | tail -20
```

Expected: the new test FAILS with something like `expected a finding for payload: <script>alert(1)</script>`.

- [ ] **Step 3: Implement the HTML/XSS detection in BookTransferService.scan()**

In `gateway/src/services/book-transfer.ts`, the `scan()` method currently calls `this.injection.scan(text)`. After that call, add an additional check for raw HTML/event-handler payloads.

Replace the `scan()` method body:

```ts
  scan(baseDir: string): ImportFinding[] {
    const findings: ImportFinding[] = [];
    for (const rel of this.scannableFiles(baseDir)) {
      let text = '';
      try { text = readFileSync(join(baseDir, rel), 'utf-8'); } catch { continue; }
      const r = this.injection.scan(text);
      if (r.detected) findings.push({ path: rel, type: r.type || 'unknown', confidence: r.confidence || 0, pattern: r.pattern || '' });
    }
    return findings;
  }
```

with:

```ts
  // Detects raw HTML/script payloads that the prompt-injection detector doesn't cover.
  // These could execute in the studio origin (which holds the auth token) via the
  // markdown preview's dangerouslySetInnerHTML, even after DOMPurify — defense-in-depth.
  private static HTML_RE = /<\s*(script|iframe|object|embed|svg)\b/i;
  private static EVENT_RE = /\son\w+\s*=/i;

  scan(baseDir: string): ImportFinding[] {
    const findings: ImportFinding[] = [];
    for (const rel of this.scannableFiles(baseDir)) {
      let text = '';
      try { text = readFileSync(join(baseDir, rel), 'utf-8'); } catch { continue; }
      const r = this.injection.scan(text);
      if (r.detected) {
        findings.push({ path: rel, type: r.type || 'unknown', confidence: r.confidence || 0, pattern: r.pattern || '' });
        continue; // already flagged — no need for the HTML check
      }
      if (BookTransferService.HTML_RE.test(text) || BookTransferService.EVENT_RE.test(text)) {
        findings.push({ path: rel, type: 'html_payload', confidence: 0.9, pattern: 'html/event-handler tag' });
      }
    }
    return findings;
  }
```

- [ ] **Step 4: Run the test to confirm GREEN**

```bash
cd /home/paul/data/dev/bookclaw && node --import tsx --test tests/unit/book-transfer.test.ts 2>&1 | tail -20
```

Expected: all tests PASS, including the new XSS test.

- [ ] **Step 5: Run all unit tests to confirm no regressions**

```bash
cd /home/paul/data/dev/bookclaw && node --import tsx --test tests/unit/*.test.ts 2>&1 | tail -30
```

Expected: all tests pass.

---

## Task 3: Fix C — EntryList stale-fetch cancellation

**Files:**
- Modify: `frontend/studio/src/components/asset/EntryList.tsx`

- [ ] **Step 1: Add cancellation flag to the load effect**

The `useEffect` on line 75 calls `load()` (the `useCallback`). The `useCallback` at lines 66–73 captures `scope` and `kind` but has no cancellation. Replace the `useCallback` block and its effect with a version that guards stale responses.

Replace:
```ts
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listEntries(scope, kind)
      .then(setEntries)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [scope, kind]);

  useEffect(() => { load(); }, [load]);
```

with:
```ts
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listEntries(scope, kind)
      .then(setEntries)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [scope, kind]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listEntries(scope, kind)
      .then((result) => { if (!cancelled) setEntries(result); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, kind]);
```

Note: keep the `load` callback for the `handleAdd`/`handleDelete` inline refresh calls (those are triggered by user action, not a racing effect).

- [ ] **Step 2: Type-check**

```bash
cd /home/paul/data/dev/bookclaw && npx tsc --noEmit
```

Expected: clean.

---

## Task 4: Fix D — PipelineEditor error state on unresolvable pipeline

**Files:**
- Modify: `frontend/studio/src/components/asset/PipelineEditor.tsx`

- [ ] **Step 1: Add error state and set it when pipeline cannot be derived**

In `PipelineEditor.tsx`, the `useEffect` loads the entry and calls `setPipeline(pl)`. When `pl` is still null after the load, the component renders "Loading…" forever. Add an `error` state and set it in this case.

The state declarations block (currently lines 22–30) should be extended — add `error` state if it is not already present. Looking at the current code, `error` IS already present at line 29. However, it is only set in the `.catch()`. Add a post-resolve check.

Replace the `.then()` callback inside the `useEffect` (currently lines 35–45):
```ts
      .then((entry) => {
        let pl: LibraryPipeline | null = null;
        if (entry.pipeline) {
          pl = entry.pipeline;
        } else if (typeof entry.content === 'string' && entry.content.trim()) {
          try { pl = JSON.parse(entry.content); } catch { /* handled below */ }
        }
        setPipeline(pl);
        setDescription(entry.description ?? pl?.description ?? '');
        setSource(entry.source ?? '');
      })
```
with:
```ts
      .then((entry) => {
        let pl: LibraryPipeline | null = null;
        if (entry.pipeline) {
          pl = entry.pipeline;
        } else if (typeof entry.content === 'string' && entry.content.trim()) {
          try { pl = JSON.parse(entry.content); } catch { /* handled below */ }
        }
        if (!pl) {
          setError('Could not load this pipeline (invalid or empty JSON).');
          return;
        }
        setPipeline(pl);
        setDescription(entry.description ?? pl?.description ?? '');
        setSource(entry.source ?? '');
      })
```

The render guard at line 117–118:
```ts
  if (error) return <div style={{ color: 'var(--alert)', fontSize: 13 }}>{error}</div>;
  if (!pipeline) return <div style={{ color: 'var(--faint)', fontSize: 13 }}>Loading…</div>;
```

This guard already covers both cases correctly: `error` renders the error, `!pipeline` (only reached when loading is still in flight) renders "Loading…". No change needed here.

- [ ] **Step 2: Type-check**

```bash
cd /home/paul/data/dev/bookclaw && npx tsc --noEmit
```

Expected: clean.

---

## Task 5: Fix E — SLUG_RE guard on PUT template :name

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts`

- [ ] **Step 1: Add the missing SLUG_RE guard to the PUT handler**

The GET handler at line 131 has:
```ts
    if (name !== undefined && !SLUG_RE.test(name)) return res.status(400).json({ error: 'invalid name' });
```

The PUT handler (lines 140–155) has the `NO_NAME_KINDS` check but lacks the `SLUG_RE` guard. Add it after the `NO_NAME_KINDS` check.

Replace this block inside the PUT handler:
```ts
    if (!TEMPLATE_KINDS.includes(kind)) return res.status(400).json({ error: `invalid kind: ${kind}` });
    if (name !== undefined && NO_NAME_KINDS.has(kind)) return res.status(400).json({ error: `${kind} takes no name` });
    try {
```
with:
```ts
    if (!TEMPLATE_KINDS.includes(kind)) return res.status(400).json({ error: `invalid kind: ${kind}` });
    if (name !== undefined && NO_NAME_KINDS.has(kind)) return res.status(400).json({ error: `${kind} takes no name` });
    if (name !== undefined && !SLUG_RE.test(name)) return res.status(400).json({ error: 'invalid name' });
    try {
```

- [ ] **Step 2: Type-check**

```bash
cd /home/paul/data/dev/bookclaw && npx tsc --noEmit
```

Expected: clean.

---

## Task 6: Fix F — library writeEntry guard + PipelineEditor description sidecar

**Files:**
- Modify: `gateway/src/services/library.ts`
- Modify: `frontend/studio/src/components/asset/PipelineEditor.tsx`

- [ ] **Step 1: Guard empty-entry creation in library.ts writeEntry**

Currently in `writeEntry`, for author/voice/genre kinds, the description-only path at lines 160–172 materializes files from `this.get(kind, name)?.files ?? {}`. If `currentFiles` is empty (entry exists nowhere), it just writes a `meta.json` with no `.md` files. Add a guard.

Replace the section from `} else if (typeof body.description === 'string') {` through the closing brace of that block:

```ts
    } else if (typeof body.description === 'string') {
      // Description-only write: materialize the currently-resolved .md files into
      // the overlay dir before writing the sidecar. Without this, the overlay would
      // contain only meta.json with no .md files, silently shadowing the builtin's
      // real content and leaving the entry with files: {}.
      const currentFiles = this.get(kind, name)?.files ?? {};
      if (Object.keys(currentFiles).length > 0) {
        await mkdir(target, { recursive: true });
        for (const [fname, content] of Object.entries(currentFiles)) {
          await writeFile(join(target, fname), content, 'utf-8');
        }
      }
    }
```

with:

```ts
    } else if (typeof body.description === 'string') {
      // Description-only write: materialize the currently-resolved .md files into
      // the overlay dir before writing the sidecar. Without this, the overlay would
      // contain only meta.json with no .md files, silently shadowing the builtin's
      // real content and leaving the entry with files: {}.
      const currentFiles = this.get(kind, name)?.files ?? {};
      if (Object.keys(currentFiles).length === 0) {
        // Entry doesn't exist anywhere — a description-only create would produce
        // an empty overlay with no content files. Reject it.
        throw new Error(`invalid: ${kind} requires at least one .md file`);
      }
      await mkdir(target, { recursive: true });
      for (const [fname, content] of Object.entries(currentFiles)) {
        await writeFile(join(target, fname), content, 'utf-8');
      }
    }
```

- [ ] **Step 2: Scope description sidecar to author/voice/genre/section only (not pipeline)**

The `writeEntry` method currently writes a `meta.json` sidecar for pipeline when `description` is passed — because the final `if (typeof body.description === 'string')` block at lines 173–177 is reached after the `pipeline` early return. Wait — looking carefully at the code: for `pipeline`, the function returns early at line 118 (`return;`). So the final sidecar write at lines 173–177 is only reached for author/voice/genre (section also returns early at line 128). The sidecar write is already safe. No change needed here — skip the pipeline-scoping sub-step.

- [ ] **Step 3: Fix PipelineEditor.handleSave — don't send `description` at top level**

In `frontend/studio/src/components/asset/PipelineEditor.tsx`, the `handleSave` function currently sends:
```ts
      await writeEntry(scope, kind, name, { content: serialized, description });
```

The description is already embedded in `serialized` (via `JSON.stringify({ ...pipeline, description }, null, 2)`). Sending it at the top level causes two-source divergence and triggers the library's sidecar path for pipelines (though currently safe due to early return, it's misleading). Send only `{ content }`:

Replace:
```ts
      await writeEntry(scope, kind, name, { content: serialized, description });
```
with:
```ts
      await writeEntry(scope, kind, name, { content: serialized });
```

- [ ] **Step 4: Type-check**

```bash
cd /home/paul/data/dev/bookclaw && npx tsc --noEmit
```

Expected: clean.

---

## Task 7: Fix G — shared sourceBadge helper

**Files:**
- Create: `frontend/studio/src/lib/sourceBadge.ts`
- Modify: `frontend/studio/src/components/asset/EntryList.tsx`
- Modify: `frontend/studio/src/components/asset/ProseEditor.tsx`
- Modify: `frontend/studio/src/components/asset/PipelineEditor.tsx`

- [ ] **Step 1: Create the sourceBadge helper**

Create `frontend/studio/src/lib/sourceBadge.ts`:

```ts
import type { Scope } from './assetApi.js';

export function sourceBadge(scope: Scope, source?: string): { cls: 'builtin' | 'yours' | 'book'; label: string } {
  if (scope === 'book') return { cls: 'book', label: 'book copy' };
  if (source === 'workspace') return { cls: 'yours', label: 'yours' };
  return { cls: 'builtin', label: 'built-in' };
}
```

- [ ] **Step 2: Update ProseEditor to use sourceBadge**

In `frontend/studio/src/components/asset/ProseEditor.tsx`:

Add import after the existing imports:
```ts
import { sourceBadge } from '../../lib/sourceBadge.js';
```

Replace the badge computation (currently lines 101–102):
```ts
  const srcBadgeClass = scope === 'book' ? styles.book : source === 'builtin' ? styles.builtin : styles.yours;
  const srcLabel = scope === 'book' ? 'book copy' : source === 'builtin' ? 'library · built-in' : 'library · yours';
```
with:
```ts
  const { cls: srcBadgeCls, label: srcLabel } = sourceBadge(scope, source);
  const srcBadgeClass = styles[srcBadgeCls];
```

Update the JSX that uses these variables — the span already uses `srcBadgeClass` and `srcLabel`, so no JSX change needed beyond the rename. Verify the JSX line reads:
```tsx
            <span className={`${styles.src} ${srcBadgeClass}`}>{srcLabel}</span>
```
(It already does. No change to JSX.)

- [ ] **Step 3: Update PipelineEditor to use sourceBadge**

In `frontend/studio/src/components/asset/PipelineEditor.tsx`:

Add import after the existing imports:
```ts
import { sourceBadge } from '../../lib/sourceBadge.js';
```

Replace the badge computation (currently lines 121–122):
```ts
  const srcBadgeClass = scope === 'book' ? styles.book : source === 'builtin' ? styles.builtin : styles.yours;
  const srcLabel = scope === 'book' ? 'book copy' : source === 'builtin' ? 'library · built-in' : 'library · yours';
```
with:
```ts
  const { cls: srcBadgeCls, label: srcLabel } = sourceBadge(scope, source);
  const srcBadgeClass = styles[srcBadgeCls];
```

Verify the JSX span already uses `srcBadgeClass` and `srcLabel`. It does (line 130). No JSX change.

- [ ] **Step 4: Update EntryList to use sourceBadge, remove the two local functions**

In `frontend/studio/src/components/asset/EntryList.tsx`:

Add import after the existing imports:
```ts
import { sourceBadge } from '../../lib/sourceBadge.js';
```

Remove the two local helper functions (lines 46–57):
```ts
function srcLabel(src: string, scope: Scope): string {
  if (scope === 'book') return 'book';
  if (src === 'builtin') return 'built-in';
  return src; // 'workspace' → 'workspace'; 'synthetic' → 'synthetic'
}

function srcClass(src: string, scope: Scope): string {
  if (scope === 'book') return styles.book;
  if (src === 'builtin') return styles.builtin;
  if (src === 'workspace') return styles.yours;
  return '';
}
```

In the JSX where the badge is rendered (currently lines 141–143):
```tsx
              <span className={`${styles.src} ${srcClass(e.source, scope)}`}>{srcLabel(e.source, scope)}</span>
```
Replace with:
```tsx
              {(() => { const b = sourceBadge(scope, e.source); return <span className={`${styles.src} ${styles[b.cls]}`}>{b.label}</span>; })()}
```

Or more readably, compute it above the JSX. Since this is inside `.map()` with `e` in scope, an inline IIFE keeps it local. The IIFE form is correct — the `styles[b.cls]` lookup works because `cls` is `'builtin'|'yours'|'book'` and those CSS module keys exist.

- [ ] **Step 5: Type-check**

```bash
cd /home/paul/data/dev/bookclaw && npx tsc --noEmit
```

Expected: clean.

---

## Task 8: Fix H — don't request book-scope skills

**Files:**
- Modify: `frontend/studio/src/lib/assetApi.ts`

- [ ] **Step 1: Short-circuit book-scope skill list calls**

In `assetApi.ts`, the `listEntries` function handles `scope === 'book'` and for kinds other than `section`, calls the templates endpoint. For `skill`, that endpoint 400s with "skill requires a name". Add an early return.

Replace the book-scope section (currently lines 10–17):
```ts
  // book scope: sections list comes from the templates endpoint; others are single wired assets
  if (kind === 'section') {
    const r = await api<{ entries?: string[] }>(`/api/books/active/templates/section`);
    return (r.entries ?? []).map((name) => ({ kind, name, source: 'workspace' as const }));
  }
  // author/voice/genre/pipeline/skill: one wired entry named by the book's snapshot
  const t = await api<{ wired: boolean; description?: string }>(`/api/books/active/templates/${kind}`).catch(() => null);
  return t && t.wired ? [{ kind, name: kind, source: 'workspace', description: t.description }] : [];
```
with:
```ts
  // book scope: sections list comes from the templates endpoint; others are single wired assets
  if (kind === 'section') {
    const r = await api<{ entries?: string[] }>(`/api/books/active/templates/section`);
    return (r.entries ?? []).map((name) => ({ kind, name, source: 'workspace' as const }));
  }
  // Book-scope skill editing is not supported in this UI; the endpoint 400s on list
  // (skill requires a name). Return empty without a server round-trip.
  if (kind === 'skill') return [];
  // author/voice/genre/pipeline: one wired entry named by the book's snapshot
  const t = await api<{ wired: boolean; description?: string }>(`/api/books/active/templates/${kind}`).catch(() => null);
  return t && t.wired ? [{ kind, name: kind, source: 'workspace', description: t.description }] : [];
```

- [ ] **Step 2: Type-check**

```bash
cd /home/paul/data/dev/bookclaw && npx tsc --noEmit
```

Expected: clean.

---

## Task 9: Fix I — RepullPanel immediate refresh after repull

**Files:**
- Modify: `frontend/studio/src/components/asset/RepullPanel.tsx`

- [ ] **Step 1: Replace setTimeout(onDone, 800) with immediate load**

In `RepullPanel.tsx`, the `AssetRow.execute()` function (lines 38–53) uses:
```ts
        setMsg('Done');
        onRefreshEditor();
        setTimeout(onDone, 800);
```

The `onDone` is the `load` function from the outer `RepullPanel` component (passed as `onDone={load}`). Replace the 800ms delay with an immediate call:

Replace:
```ts
        setMsg('Done');
        onRefreshEditor();
        setTimeout(onDone, 800);
```
with:
```ts
        onRefreshEditor();
        onDone();
```

The "Done" flash message is removed — the panel either disappears (all resolved) or updates with the remaining items immediately. This is cleaner UX.

- [ ] **Step 2: Type-check**

```bash
cd /home/paul/data/dev/bookclaw && npx tsc --noEmit
```

Expected: clean.

---

## Task 10: Fix J — onSelect(null) after delete + widen prop type

**Files:**
- Modify: `frontend/studio/src/components/asset/EntryList.tsx`
- Modify: `frontend/studio/src/routes/AssetStudio.tsx`

- [ ] **Step 1: Widen onSelect prop in EntryList**

The `Props` interface (line 39–44) currently has:
```ts
  onSelect: (name: string) => void;
```
Change to:
```ts
  onSelect: (name: string | null) => void;
```

- [ ] **Step 2: Fix the handleDelete call**

In `handleDelete` (line 103):
```ts
      if (selectedName === entry.name) onSelect('');
```
Change to:
```ts
      if (selectedName === entry.name) onSelect(null);
```

- [ ] **Step 3: Widen handleSelect in AssetStudio**

In `frontend/studio/src/routes/AssetStudio.tsx`, `handleSelect` (line 36):
```ts
  function handleSelect(name: string) {
    setSelectedName(name);
    setEditorKey((n) => n + 1);
  }
```
Change to:
```ts
  function handleSelect(name: string | null) {
    setSelectedName(name);
    setEditorKey((n) => n + 1);
  }
```

(`selectedName` is already `string | null` at line 18, so `setSelectedName(name)` already accepts null. This change is purely the function signature.)

- [ ] **Step 4: Type-check**

```bash
cd /home/paul/data/dev/bookclaw && npx tsc --noEmit
```

Expected: clean.

---

## Task 11: Run all gates

- [ ] **Step 1: Run unit tests**

```bash
cd /home/paul/data/dev/bookclaw && node --import tsx --test tests/unit/*.test.ts 2>&1 | tail -40
```

Expected: all tests pass (including the new book-transfer XSS test from Fix B).

- [ ] **Step 2: Run type-check**

```bash
cd /home/paul/data/dev/bookclaw && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Run studio build**

```bash
cd /home/paul/data/dev/bookclaw && npm run -w frontend/studio build
```

Expected: build succeeds, no errors.

---

## Self-Review: Spec Coverage Check

| Fix | Task covering it | Notes |
|-----|-----------------|-------|
| A — DOMPurify XSS | Task 1 | Both render sites covered via shared `preview` var |
| B — HTML/XSS TDD | Task 2 | RED→GREEN, all 4 payload patterns, purgeStaging called |
| C — EntryList cancellation | Task 3 | `cancelled` flag guards setEntries + setError + setLoading |
| D — PipelineEditor error state | Task 4 | null pipeline after load → setError, not stuck on Loading |
| E — SLUG_RE on PUT | Task 5 | Mirrors GET exactly |
| F(gateway) — empty-entry guard | Task 6 step 1 | Throws `invalid:` prefix on nonexistent entry + no files |
| F(frontend) — no description in PUT | Task 6 step 3 | Sends `{ content }` only |
| F note — pipeline sidecar scoping | Task 6 step 2 | Verified pipeline returns early — no sidecar path reached |
| G — shared badge helper | Task 7 | New file, three consumers updated, local dupes removed |
| H — no book-scope skill fetch | Task 8 | Early return before API call |
| I — RepullPanel immediate refresh | Task 9 | setTimeout removed, immediate onDone() |
| J — onSelect(null) | Task 10 | Prop type widened in EntryList + AssetStudio |
