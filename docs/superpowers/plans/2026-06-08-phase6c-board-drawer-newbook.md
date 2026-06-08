# Phase 6c — Book Board + detail drawer + New-Book entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the minimal 6a board into the real studio surface: cards show an author/voice/genre byline + phase, status filters, a clickable **detail drawer** (assets + a phase timeline + "set as active"), and a ghost **New Book** card routing to a minimal-but-functional create form. Removes the "every click is dead" feel for the default UI.

**Architecture:** Mostly front-end on `frontend/{shared,studio}`, plus one small, TDD'd backend addition — the byline (`author`/`voice`/`genre` names) on the `GET /api/books` summary so cards don't N+1-fetch. The drawer reads `GET /api/books/:slug` (full manifest) inline. New-Book reads `GET /api/library/:kind` and `POST /api/books`. The full concept New-Book *picker* (option cards, live summary, sections/skills multi-select) stays **6g**; per-asset descriptions + canonical tooltips stay **6e** (no endpoint yet).

**Tech Stack:** Node/TS backend (`node --test` TDD for the summary change); React 18 + Vite + React Router 6 + Zustand front-end; `@bookclaw/shared`.

**Spec:** `docs/superpowers/specs/2026-06-07-phase6-frontend-rewrite-design.md` (6c is task-outlined in `docs/superpowers/plans/2026-06-07-phase6-frontend-rewrite.md`). Run **after** the 6b plan.

---

## Conventions (read once)

- **No git commits during execution** — build in the working tree; the maintainer pushes via `./push.sh` at the end (per `CLAUDE.md`/handoff; overrides the 6a plan's per-task-commit instruction). Each task ends with a verification + review checkpoint.
- **Backend = TDD** (the repo has `node --test`). **Front-end = no test runner** (verify via `npx tsc --noEmit` + `npm run -w frontend/studio build` + manual browser check; this is the project's established FE verification).
- **CSS source of truth:** `dashboard/concept/phase6-studio-shell.html` — port the Board (`.grid`, `.card`, `.ctop`, `.phase`, `.genre`, `.byline`, `.prog`/`.bar`, `.cfoot`, `.needs`, `.card.ghost`, `.plus`) and the drawer (`.drawer`, `.scrim`, `.dhead`, `.dclose`, `.dbody`, `.assets`, `.asset`, `.l`, `.v`, `.tline`, `.tstep`, `.nub`, `.ln`, `.tx`, `.dfoot`) rules **verbatim**; for New-Book use the input/`.fl`/`.tin` + `.create` rules from `dashboard/concept/new-book.html`. Tokens (`--ph-*`, `--ember`, `--ease`, `--r`) already in `tokens.css`.
- **Honest data:** the API exposes no per-book chapter progress / spend / "generating" state. Render phase + status + byline only; do **not** fabricate progress bars or per-book spend. A phase-position timeline (planning→launch) is honest and derived from `manifest.phase`.
- **Forward-compat rule:** components take the book via prop/route; no module-global active book outside the store seam.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `gateway/src/services/book-types.ts` | add `author?`/`voice?`/`genre?` to `BookSummary` | Modify |
| `gateway/src/services/book.ts` | populate the byline in `list()` from `m.pulledFrom` | Modify (lines 196–203) |
| `tests/unit/book.test.ts` | assert `list()` returns the byline | Modify |
| `frontend/shared/src/types.ts` | add `author?`/`voice?`/`genre?` to `BookSummary`; add `BookManifest`/`PulledRef` | Modify |
| `frontend/studio/src/routes/Board.tsx` | byline + filters + ghost card + open-drawer | Modify |
| `frontend/studio/src/routes/Board.module.css` | port card/byline/filters/ghost CSS | Modify |
| `frontend/studio/src/components/BookDrawer.tsx` | detail drawer (fetch `/api/books/:slug`) | Create |
| `frontend/studio/src/components/BookDrawer.module.css` | ported drawer CSS | Create |
| `frontend/studio/src/routes/NewBook.tsx` | minimal create form → `POST /api/books` | Create |
| `frontend/studio/src/routes/NewBook.module.css` | ported form CSS | Create |
| `frontend/studio/src/main.tsx` | add `/new-book` route | Modify |
| `frontend/studio/src/Rail.tsx` | Book Board count = real `books.length` | Modify |

---

### Task 1: Backend — byline on the books summary (TDD)

**Files:** Modify `gateway/src/services/book-types.ts`, `gateway/src/services/book.ts`; Test `tests/unit/book.test.ts`.

- [ ] **Step 1: Write the failing test.** In `tests/unit/book.test.ts`, extend the existing gate test's assertions (after line 97, inside the same `try`) — `good-book` was created with `author:'default', voice:'default', genre:null`:

```ts
    const good = list.find(b => b.slug === 'good-book');
    assert.equal(good?.author, 'default');
    assert.equal(good?.voice, 'default');
    assert.equal(good?.genre, null);
    // future-book.json has no pulledFrom — byline fields must be absent, not a crash:
    const future = list.find(b => b.slug === 'future-book');
    assert.equal(future?.author, undefined);
```

- [ ] **Step 2: Run it — verify it fails**

Run: `node --import tsx --test tests/unit/book.test.ts`
Expected: FAIL (`good?.author` is `undefined`, not `'default'`).

- [ ] **Step 3: Add the fields to `BookSummary`** in `gateway/src/services/book-types.ts` (after `createdAt`):

```ts
export interface BookSummary {
  slug: string;
  title: string;
  phase: string;
  schemaVersion: number;
  status: BookStatus;
  createdAt: string;
  // byline (book-container Phase 6c) — names only, from the manifest's pulledFrom snapshot
  author?: string;
  voice?: string;
  genre?: string | null;
}
```

- [ ] **Step 4: Populate them in `list()`** (`gateway/src/services/book.ts`, the `out.push({…})` block at ~196). Use optional chaining so a manifest missing `pulledFrom` (legacy/partial) doesn't throw:

```ts
        out.push({
          slug: m.slug || e.name,
          title: m.title || e.name,
          phase: m.phase || 'planning',
          schemaVersion: m.schemaVersion ?? 0,
          status: classifyVersion(m.schemaVersion ?? 0),
          createdAt: m.createdAt || '',
          author: m.pulledFrom?.author?.name,
          voice: m.pulledFrom?.voice?.name,
          genre: m.pulledFrom?.genre?.name ?? null,
        });
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `node --import tsx --test tests/unit/book.test.ts`
Expected: PASS.

- [ ] **Step 6: Full type-check + the books-related suite**

Run: `npx tsc --noEmit` → clean.
Run: `node --import tsx --test tests/unit/book*.test.ts` → all PASS (no regressions in active-book/transfer/repull/template).

- [ ] **Step 7: Review checkpoint** — byline is names-only, optional, and crash-safe on partial manifests.

---

### Task 2: Front-end contract — BookSummary byline + manifest types

**Files:** Modify `frontend/shared/src/types.ts`.

- [ ] **Step 1: Add the byline to `BookSummary`** (keep existing fields):

```ts
export interface BookSummary {
  slug: string;
  title: string;
  phase: string;
  schemaVersion: number;
  status: BookStatus;
  createdAt: string;
  author?: string;
  voice?: string;
  genre?: string | null;
}
```

- [ ] **Step 2: Add the manifest types the drawer reads** (append; mirrors `gateway/src/services/book-types.ts`):

```ts
/** Provenance for one snapshotted component (mirrors PulledRef). */
export interface PulledRef {
  name: string;
  source: 'builtin' | 'workspace' | 'synthetic';
  version?: number;
}

/** Full book.json manifest — returned by GET /api/books/:slug. */
export interface BookManifest {
  id: string;
  slug: string;
  title: string;
  schemaVersion: number;
  phase: string;
  createdAt: string;
  pulledFrom: {
    author: PulledRef;
    voice?: PulledRef;
    genre?: PulledRef | null;
    pipeline: PulledRef;
    sections: string[];
    skills?: string[];
  };
  history: Array<{ at: string; event: string; detail?: string }>;
}
```

- [ ] **Step 2b: Add a library entry type** (used by New-Book; mirrors `LibraryEntry`):

```ts
export type LibraryKind = 'author' | 'voice' | 'genre' | 'pipeline' | 'section' | 'skill';
export interface LibraryEntry {
  kind: LibraryKind;
  name: string;
  source: 'builtin' | 'workspace' | 'synthetic';
  description?: string;
}
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run -w frontend/studio build` → succeeds.

- [ ] **Step 4: Review checkpoint** — front-end `BookSummary` matches the server's new shape; new types are additive.

---

### Task 3: Book Board — byline, filters, ghost card, open-drawer

**Files:** Modify `frontend/studio/src/routes/Board.tsx`, `frontend/studio/src/routes/Board.module.css`.

- [ ] **Step 1: Port the additional CSS** into `Board.module.css` from `dashboard/concept/phase6-studio-shell.html` (Board view) — copy verbatim and namespace as module classes: `.hero`, `.filters`, `.chip` (+ `.chip.on`), `.ctop`, `.byline` (+ its `b`/`.v` divider), `.genre`, `.card.ghost`, `.plus`. Keep the existing `.scroll`/`.grid`/`.card`/`.phase`/`.meta`/`.slug`/`.flag`/`.empty`/`.h1` rules. (Skip `.prog`/`.bar`/`.needs`/`.spend` — no data for those this round.)

- [ ] **Step 2: Rewrite `Board.tsx`** to add byline, filters, the ghost card, and drawer opening:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useBooks } from '@bookclaw/shared';
import { BookDrawer } from '../components/BookDrawer.js';
import styles from './Board.module.css';

const PHASE_VAR: Record<string, string> = {
  planning: '--ph-plan', bible: '--ph-world', production: '--ph-prod',
  revision: '--ph-rev', format: '--ph-fmt', launch: '--ph-launch',
};

export function Board() {
  const books = useBooks();
  const loadBooks = useStore((s) => s.loadBooks);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('All');
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => { loadBooks().catch((e) => setError(String(e))); }, [loadBooks]);

  // Filters: All + "Needs you" (gate status != ok) + one chip per distinct phase present.
  const phases = useMemo(
    () => Array.from(new Set(books.map((b) => b.phase))),
    [books],
  );
  const chips = ['All', 'Needs you', ...phases];
  const shown = useMemo(() => {
    if (filter === 'All') return books;
    if (filter === 'Needs you') return books.filter((b) => b.status !== 'ok');
    return books.filter((b) => b.phase === filter);
  }, [books, filter]);

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Books, <em>in flight</em></h1>

      <div className={styles.filters}>
        {chips.map((c) => (
          <button key={c} className={c === filter ? `${styles.chip} ${styles.on}` : styles.chip} onClick={() => setFilter(c)}>
            {c}
          </button>
        ))}
      </div>

      {error ? (
        <p className={styles.empty}>Couldn’t load books — {error}</p>
      ) : (
        <div className={styles.grid}>
          {shown.map((b) => (
            <article key={b.slug} className={styles.card} onClick={() => setOpenSlug(b.slug)} role="button" tabIndex={0}>
              <span className={styles.phase} style={{ ['--ph' as string]: `var(${PHASE_VAR[b.phase] ?? '--ph-plan'})` }}>
                <i /> {b.phase}
              </span>
              <h3>{b.title}</h3>
              {b.genre && <div className={styles.genre}>{b.genre}</div>}
              <div className={styles.byline}>
                <b>{b.author ?? '—'}</b>
                {b.voice && <><span className={styles.v} /> {b.voice}</>}
              </div>
              <div className={styles.meta}>
                <span className={styles.slug}>{b.slug}</span>
                {b.status !== 'ok' && <span className={styles.flag}>{b.status}</span>}
              </div>
            </article>
          ))}

          {/* New Book ghost card → minimal create form (full picker = 6g) */}
          <article className={`${styles.card} ${styles.ghost}`} onClick={() => navigate('/new-book')} role="button" tabIndex={0}>
            <div className={styles.plus}>+</div>
            <h3>New book</h3>
            <small>Pull author, voice, genre &amp; pipeline from the library.</small>
          </article>
        </div>
      )}

      {openSlug && <BookDrawer slug={openSlug} onClose={() => setOpenSlug(null)} />}
    </div>
  );
}
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit` → clean (note: `BookDrawer` is created in Task 4; type-check fully only after Task 4 — until then a missing-module error on `BookDrawer.js` is expected. Build/verify at the end of Task 4.)

- [ ] **Step 4: Review checkpoint** — byline uses real summary fields; filters derived from data (no fabricated "generating/idle"); ghost card navigates.

---

### Task 4: Book detail drawer

**Files:** Create `frontend/studio/src/components/BookDrawer.tsx`, `frontend/studio/src/components/BookDrawer.module.css`.

- [ ] **Step 1: Port the drawer CSS** into `BookDrawer.module.css` from `dashboard/concept/phase6-studio-shell.html` (drawer): `.drawer` (+ `.drawer.on`), `.scrim` (+ `.scrim.on`), `.dhead`, `.dclose`, `.genre`, `.dbody`, `.assets`, `.asset`, `.l`, `.v` (+ `.v.it`), `.sec`, `.tline`, `.tstep` (+ `.tstep.done`, `.tstep.cur`), `.stem`, `.nub`, `.ln`, `.tx`, `.dfoot`. Keep declarations verbatim.

- [ ] **Step 2: Create `BookDrawer.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { api, useStore, type BookManifest, type BookStatus } from '@bookclaw/shared';
import { Button } from '@bookclaw/shared';
import styles from './BookDrawer.module.css';

const PHASES = ['planning', 'bible', 'production', 'revision', 'format', 'launch'] as const;

export function BookDrawer({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [data, setData] = useState<{ book: BookManifest; status: BookStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const activeSlug = useStore((s) => s.activeSlug);
  const loadBooks = useStore((s) => s.loadBooks);

  useEffect(() => {
    setData(null); setError(null);
    api<{ book: BookManifest; status: BookStatus }>(`/api/books/${encodeURIComponent(slug)}`)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [slug]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setActive = async () => {
    setActivating(true);
    try {
      await api('/api/books/active', { method: 'POST', body: JSON.stringify({ slug }) });
      await loadBooks();
    } finally { setActivating(false); }
  };

  const pf = data?.book.pulledFrom;
  const curIdx = data ? PHASES.indexOf(data.book.phase as typeof PHASES[number]) : -1;
  const isActive = activeSlug === slug;

  return (
    <>
      <div className={`${styles.scrim} ${styles.on}`} onClick={onClose} />
      <aside className={`${styles.drawer} ${styles.on}`} role="dialog" aria-label="Book detail">
        <div className={styles.dhead}>
          <button className={styles.dclose} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
          <h2>{data?.book.title ?? slug}</h2>
          {pf?.genre?.name && <div className={styles.genre}>{pf.genre.name}</div>}
        </div>

        <div className={styles.dbody}>
          {error ? (
            <p>Couldn’t load this book — {error}</p>
          ) : !data ? (
            <p>Loading…</p>
          ) : (
            <>
              {/* Assets (names only; per-asset descriptions + canonical tooltips = 6e) */}
              <div className={styles.assets}>
                <div className={styles.asset}><div className={styles.l}>Author</div><div className={styles.v}>{pf?.author?.name ?? '—'}</div></div>
                <div className={styles.asset}><div className={styles.l}>Voice</div><div className={`${styles.v} ${styles.it}`}>{pf?.voice?.name ?? '—'}</div></div>
                <div className={styles.asset}><div className={styles.l}>Genre</div><div className={`${styles.v} ${styles.it}`}>{pf?.genre?.name ?? '—'}</div></div>
                <div className={styles.asset}><div className={styles.l}>Pipeline</div><div className={styles.v}>{pf?.pipeline?.name ?? '—'}</div></div>
              </div>

              {/* Phase timeline — honest position derived from manifest.phase */}
              <div className={styles.sec}>Phase</div>
              <div className={styles.tline}>
                {PHASES.map((p, i) => {
                  const cls = i < curIdx ? styles.done : i === curIdx ? styles.cur : '';
                  return (
                    <div key={p} className={`${styles.tstep} ${cls}`}>
                      <div className={styles.stem}><div className={styles.nub} />{i < PHASES.length - 1 && <div className={styles.ln} />}</div>
                      <div className={styles.tx}>
                        <b>{p}</b>
                        <div className={styles.meta}>{i < curIdx ? 'done' : i === curIdx ? 'current' : 'upcoming'}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className={styles.dfoot}>
          <Button variant="secondary" onClick={setActive} disabled={!data || isActive || activating}>
            {isActive ? 'Active book' : activating ? 'Activating…' : 'Set as active'}
          </Button>
          <Button variant="primary" disabled title="Write workspace — sub-phase 6d">Open in Write</Button>
        </div>
      </aside>
    </>
  );
}
```

- [ ] **Step 2b:** confirm `@bookclaw/shared` exports `api` and `Button` (from 6a `index.ts`: `export * from './api.js'` and `./Button.js` — yes). The drawer imports `BookStatus`/`BookManifest` from the barrel (re-exported via `types.js`).

- [ ] **Step 3: Type-check + build** (Board + drawer now both exist)

Run: `npx tsc --noEmit` → clean.
Run: `npm run -w frontend/studio build` → succeeds.

- [ ] **Step 4: Review checkpoint** — drawer fetches the real manifest, "Set as active" calls `POST /api/books/active` + refreshes the store, Escape/scrim close, "Open in Write" is honestly disabled (6d).

---

### Task 5: Minimal New-Book create route

**Files:** Create `frontend/studio/src/routes/NewBook.tsx`, `frontend/studio/src/routes/NewBook.module.css`.

> Scope: a working create form (title + author/voice/genre/pipeline selects from the library) → `POST /api/books` → back to the board. The full concept picker (option cards, live summary, sections/skills multi-select) is **6g** — this is the functional bridge so the ghost card isn't a dead end.

- [ ] **Step 1: Port minimal form CSS** into `NewBook.module.css` from `dashboard/concept/new-book.html`: the `.wrap`/`.hero`/`.fl`/`.tin` (title input) and `.create` button rules, plus a simple `.field`/`select` style (if the concept lacks a bare `<select>` style, add a small rule: bordered, `var(--panel)` bg, `var(--text)`, radius `var(--r-s)`, padding `10px 12px`). Keep it close to the concept's typography.

- [ ] **Step 2: Create `NewBook.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useStore, Button, type LibraryEntry, type LibraryKind, type BookManifest } from '@bookclaw/shared';
import styles from './NewBook.module.css';

const KINDS: LibraryKind[] = ['author', 'voice', 'genre', 'pipeline'];

export function NewBook() {
  const navigate = useNavigate();
  const loadBooks = useStore((s) => s.loadBooks);
  const [opts, setOpts] = useState<Record<string, LibraryEntry[]>>({});
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<Record<LibraryKind, string>>({ author: '', voice: '', genre: '', pipeline: '' } as Record<LibraryKind, string>);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(KINDS.map((k) =>
      api<{ entries: LibraryEntry[] }>(`/api/library/${k}`).then((r) => [k, r.entries ?? []] as const),
    )).then((pairs) => {
      const map = Object.fromEntries(pairs) as Record<string, LibraryEntry[]>;
      setOpts(map);
      // Pre-select the first option for each required kind.
      setSel((s) => ({
        ...s,
        author: map.author?.[0]?.name ?? '',
        voice: map.voice?.[0]?.name ?? '',
        pipeline: map.pipeline?.[0]?.name ?? '',
      }));
    }).catch((e) => setError(String(e)));
  }, []);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const body = JSON.stringify({
        title: title.trim(),
        author: sel.author,
        voice: sel.voice,
        genre: sel.genre || null,
        pipeline: sel.pipeline,
        sections: [],
      });
      await api<{ success: boolean; book: BookManifest }>('/api/books', { method: 'POST', body });
      await loadBooks();
      navigate('/');
    } catch (e) {
      setError(String(e));
    } finally { setBusy(false); }
  };

  const canCreate = title.trim() && sel.author && sel.voice && sel.pipeline && !busy;

  const field = (k: LibraryKind, label: string, optional = false) => (
    <div className={styles.field} key={k}>
      <label className={styles.fl}>{label}{optional && <em> (optional)</em>}</label>
      <select value={sel[k]} onChange={(e) => setSel((s) => ({ ...s, [k]: e.target.value }))}>
        {optional && <option value="">— none —</option>}
        {(opts[k] ?? []).map((o) => (
          <option key={o.name} value={o.name}>{o.name}{o.source !== 'builtin' ? ' (yours)' : ''}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.hero}>
        <h1>New book</h1>
        <p>A copy of these library templates is frozen into the book at creation. The full picker arrives in a later update.</p>
      </div>

      <div className={styles.field}>
        <label className={styles.fl}>Title</label>
        <input className={styles.tin} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Dragon’s Heir" />
      </div>

      {field('author', 'Author')}
      {field('voice', 'Voice')}
      {field('genre', 'Genre', true)}
      {field('pipeline', 'Pipeline')}

      {error && <p className={styles.err}>Couldn’t create — {error}</p>}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => navigate('/')}>Cancel</Button>
        <Button variant="primary" onClick={create} disabled={!canCreate}>{busy ? 'Creating…' : 'Create book'}</Button>
      </div>
    </div>
  );
}
```

(Add small `.field`, `.actions`, `.err` rules to `NewBook.module.css` — `.err` can copy the Board `.empty`/error color.)

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run -w frontend/studio build` → succeeds.

- [ ] **Step 4: Review checkpoint** — create posts the exact `POST /api/books` body shape (`title/author/voice/genre/pipeline/sections`), genre is optional → `null`, and success refreshes the board.

---

### Task 6: Router + Rail wiring + full verification

**Files:** Modify `frontend/studio/src/main.tsx`, `frontend/studio/src/Rail.tsx`.

- [ ] **Step 1: Add the `/new-book` route** in `main.tsx`:

```tsx
import { NewBook } from './routes/NewBook.js';
```
```tsx
        <Route element={<App />}>
          <Route index element={<Board />} />
          <Route path="activity" element={<Activity />} />
          <Route path="new-book" element={<NewBook />} />
        </Route>
```
(If 6b isn't merged in this tree, omit the `activity` line; it's added by the 6b plan.)

- [ ] **Step 2: Real Book Board count in the Rail.** In `Rail.tsx`, replace the hard-coded `<span className={styles.count}>5</span>` next to "Book Board" with the live count:

```tsx
import { useBooks } from '@bookclaw/shared';
```
```tsx
  const books = useBooks();
```
```tsx
          Book Board <span className={styles.count}>{books.length}</span>
```
(Leave the static "Series 2" count — Series isn't built. Don't fabricate it elsewhere.)

- [ ] **Step 3: Build + type-check**

Run: `npm run build:frontend` → studio `dist` produced.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Backend + suite**

Run: `node --import tsx --test tests/unit/book*.test.ts` → PASS.
Run: `npm test` → unit + api + smoke green.

- [ ] **Step 5: Manual v6 check**

Run: `BOOKCLAW_AUTH_TOKEN=test npm start`
- Board: cards show **byline** (author · voice) + genre + phase; filter chips (All / Needs you / phases) work.
- Click a card → drawer slides in with assets + phase timeline; "Set as active" flips the active book (re-open another card; the previously active no longer offers it); Escape/scrim close.
- Click **New book** → form lists library authors/voices/genres/pipelines; create a book → returns to the board with the new card present; Rail "Book Board" count increments.
- No CSP errors; no dead `href="#"` for Board/New-Book.

- [ ] **Step 6: Review checkpoint** — every interactive element added this phase reaches a real endpoint; nothing fabricates absent data; legacy still reachable via `BOOKCLAW_UI=legacy`.

---

## Self-Review (6c)

- **Spec coverage:** delivers the full Board (byline, filters, ghost card), the detail drawer (assets + phase timeline + activate), and a working New-Book entry — the "most clickable surface." Deferred-by-design and labeled in-code: per-asset descriptions + canonical tooltips (**6e**, no endpoint), the rich New-Book picker with sections/skills + live summary (**6g**), Write workspace (**6d**, the drawer's primary button is honestly disabled), per-book progress/spend/"generating" (no endpoint — not fabricated).
- **Placeholder scan:** all logic shown literally; CSS "port verbatim" references the concrete concept files with exact class lists (6a precedent). The one backend change is TDD with the failing test shown first.
- **Type consistency:** `BookSummary` byline fields match between `book-types.ts` (Task 1) and `types.ts` (Task 2); `BookManifest`/`PulledRef`/`LibraryEntry`/`LibraryKind` defined in Task 2 are consumed unchanged by `BookDrawer.tsx` (Task 4) and `NewBook.tsx` (Task 5); `POST /api/books` body matches the server contract (`title/author/voice/genre/pipeline/sections`); `POST /api/books/active` body is `{ slug }`.
- **Honesty:** filters and timeline derive only from real fields (`phase`, `status`); no progress bars / spend / generating-state invented.
