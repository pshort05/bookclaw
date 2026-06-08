# Phase 6g — Full New-Book picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace 6c's minimal New-Book form with the owner-approved rich picker (`dashboard/concept/new-book.html`): option cards per asset kind (showing each entry's 6e description + source badge), single-select for author/voice/genre/pipeline + multi-select for sections, a live snapshot **summary** panel with a cover preview, and a read-only display of the **skills the chosen pipeline brings** — all posting to `POST /api/books`.

**Architecture:** A front-end-only rewrite of the `/new-book` route on the studio. Reads `GET /api/library/:kind` (entries carry `description` from 6e) for author/voice/genre/pipeline/section; when a pipeline is picked, fetches its detail (`GET /api/library/pipeline/:name`) to list the skills its steps reference (read-only — `pulledFrom.skills` is derived from the pipeline, not user-selected). Creates via `POST /api/books { title, author, voice, genre?, pipeline, sections[] }`. Honest to the backend: **no `skills` selector, no `series` field** (neither is a create input).

**Tech Stack:** React 18 + Vite + Router + `@bookclaw/shared` (+ the `sourceBadge` helper from 6f). No new deps.

**Spec:** concept `dashboard/concept/new-book.html` (CSS/markup source of truth); `docs/GLOSSARY.md` (canonical defs, reuse the map from 6f's `EntryList`); 6g outline in `docs/superpowers/plans/2026-06-07-phase6-frontend-rewrite.md`.

---

## Conventions (read once)

- **No git commits during execution** — working tree only; maintainer pushes via `./push.sh`. Review checkpoint per task. On `main` (intended).
- **Front-end only; no test runner** → verify via `npx tsc --noEmit` + `npm run -w frontend/studio build` + manual. (No backend change → backend unit suite stays at 120/120.)
- **Surgical; match existing style.** Port CSS **verbatim** from `dashboard/concept/new-book.html` (classes listed below). Reuse the existing `sourceBadge` (from 6f `lib/sourceBadge.ts`) and the GLOSSARY canon map (extract it from `EntryList.tsx` into a shared `lib/glossary.ts` so both consume one copy — see Task 1).
- **Backend honesty (do not fabricate):** the create payload is exactly `{ title, author, voice, genre|null, pipeline, sections[] }`. Skills are derived from the pipeline (shown read-only); there is no series field. Do not add selectors for fields the API ignores.
- **Replaces** the 6c minimal `NewBook.tsx` (same `/new-book` route). Keep the route path + the Board ghost-card navigation working.

---

## Backend contracts (confirmed; use exactly)

- `GET /api/library/:kind` → `{ kind, entries: [{ kind, name, source, description? }] }` for kind ∈ author|voice|genre|pipeline|section. (Descriptions present from 6e where set.)
- `GET /api/library/pipeline/:name` → `{ entry: { …, pipeline: { steps: [{ skill? , label, … }], … } } }` — used to list the skills the pipeline references (dedup the non-empty `step.skill` values).
- `POST /api/books` body `{ title: string, author: string (req), voice: string (req), genre: string|null, pipeline: string (req), sections: string[] }` → `{ success: true, book: BookManifest }` (400 with `{error}` if a required field is missing).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/studio/src/lib/glossary.ts` | shared canonical kind defs (extracted from EntryList) | Create |
| `frontend/studio/src/components/asset/EntryList.tsx` | consume shared glossary map | Modify |
| `frontend/studio/src/routes/NewBook.tsx` | full picker (rewrite of 6c minimal form) | Modify (rewrite) |
| `frontend/studio/src/routes/NewBook.module.css` | ported concept CSS (rewrite) | Modify (rewrite) |
| `frontend/studio/src/components/newbook/OptionCard.tsx` | one selectable asset card (radio/toggle + name + src + desc) | Create |
| `frontend/studio/src/components/newbook/SnapshotSummary.tsx` | live summary panel + cover + create button | Create |

---

### Task 1: Shared glossary map

**Files:** Create `frontend/studio/src/lib/glossary.ts`; Modify `frontend/studio/src/components/asset/EntryList.tsx`.

- [ ] **Step 1: Extract** the canonical-definition map currently embedded in `EntryList.tsx` (the `KIND_DEFS`/canon strings from `docs/GLOSSARY.md`) into `frontend/studio/src/lib/glossary.ts`:
```ts
import type { LibraryKind } from '@bookclaw/shared';
/** Canonical term + one-line definition per kind (verbatim from docs/GLOSSARY.md). */
export const GLOSSARY: Record<LibraryKind, { canon: string; def: string }> = {
  author:   { canon: 'Author',   def: '<verbatim author def>' },
  voice:    { canon: 'Voice',    def: '<verbatim voice def>' },
  genre:    { canon: 'Genre',    def: '<verbatim genre def>' },
  pipeline: { canon: 'Pipeline', def: '<verbatim pipeline def>' },
  section:  { canon: 'Section',  def: '<verbatim section def>' },
  skill:    { canon: 'Skill',    def: '<verbatim skill def>' },
};
```
(Copy the exact strings already used in `EntryList.tsx` so nothing changes visually.)

- [ ] **Step 2: Re-point `EntryList.tsx`** to import `GLOSSARY` from `../../lib/glossary.js` instead of its local copy. Delete the local copy.

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean; `npm run -w frontend/studio build` succeeds; the Asset Studio entry-list defs render unchanged.

- [ ] **Step 4: Review checkpoint** — single source for the canon map; no behavioural change.

---

### Task 2: OptionCard component

**Files:** Create `frontend/studio/src/components/newbook/OptionCard.tsx`.

- [ ] **Step 1: Port the card markup/CSS.** From `dashboard/concept/new-book.html`, the `.optcard` (+ `.sel`), the single-select radio `.rad` (with the checkmark svg) and the multi-select toggle `.tog`, the `.body2` block (`.nm` name + the `.src` badge + `.dsc` description + optional `.mm` meta). Put the CSS in `NewBook.module.css` (Task 4); the component references those classes.

```tsx
import type { LibraryEntry } from '@bookclaw/shared';
import { sourceBadge } from '../../lib/sourceBadge.js';
import styles from '../../routes/NewBook.module.css';

export function OptionCard({ entry, mode, selected, onToggle, meta }: {
  entry: LibraryEntry; mode: 'single' | 'multi'; selected: boolean; onToggle: () => void; meta?: string;
}) {
  const badge = sourceBadge('library', entry.source);
  return (
    <button type="button" className={selected ? `${styles.optcard} ${styles.sel}` : styles.optcard} onClick={onToggle} aria-pressed={selected}>
      {mode === 'single'
        ? <span className={styles.rad}>{selected && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M5 13l4 4L19 7"/></svg>}</span>
        : <span className={`${styles.tog} ${selected ? styles.togOn : ''}`} />}
      <span className={styles.body2}>
        <span className={styles.nm}>{entry.name} <span className={`${styles.src} ${styles[badge.cls]}`}>{badge.label}</span></span>
        {entry.description && <span className={styles.dsc}>{entry.description}</span>}
        {meta && <span className={styles.mm}>{meta}</span>}
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Verify** — `tsc` clean (will fully compile once NewBook + CSS land in Tasks 3–4).

- [ ] **Step 3: Review checkpoint** — single vs multi visual differs (radio vs toggle); selected state styled; uses shared `sourceBadge`.

---

### Task 3: SnapshotSummary component

**Files:** Create `frontend/studio/src/components/newbook/SnapshotSummary.tsx`.

- [ ] **Step 1: Port the summary CSS/markup** from the concept `.summary`/`.scard` (`.cover` + `.ct`/`.cs`, `.slabel`, `.srow`, `.snote`, `.create`). The summary shows the live selection + a create button.

```tsx
import { Button } from '@bookclaw/shared';
import styles from '../../routes/NewBook.module.css';

export function SnapshotSummary({ title, author, voice, genre, pipeline, sectionCount, skills, canCreate, busy, onCreate }: {
  title: string; author?: string; voice?: string; genre?: string | null; pipeline?: string;
  sectionCount: number; skills: string[]; canCreate: boolean; busy: boolean; onCreate: () => void;
}) {
  return (
    <aside className={styles.summary}>
      <div className={styles.scard}>
        <div className={styles.cover}>
          <div className={styles.ct}>{title || 'Untitled'}</div>
          <div className={styles.cs}>{genre || '—'}</div>
        </div>
        <div className={styles.slabel}>This book will contain</div>
        <div className={styles.srow}><span>Author</span><b>{author || '—'}</b></div>
        <div className={styles.srow}><span>Voice</span><b>{voice || '—'}</b></div>
        <div className={styles.srow}><span>Genre</span><b>{genre || '—'}</b></div>
        <div className={styles.srow}><span>Pipeline</span><b>{pipeline || '—'}</b></div>
        <div className={styles.srow}><span>Sections</span><b>{sectionCount}</b></div>
        <div className={styles.srow}><span>Skills</span><b>{skills.length ? `${skills.length} (from pipeline)` : '—'}</b></div>
        {skills.length > 0 && <div className={styles.snote}>Skills come with the pipeline: {skills.join(', ')}.</div>}
        <div className={styles.snote}>A copy of these templates is frozen into the book at creation; edit them per-book in the Asset Studio.</div>
        <Button variant="primary" onClick={onCreate} disabled={!canCreate}>{busy ? 'Creating…' : 'Create book'}</Button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Review checkpoint** — summary reflects live state; skills shown read-only as pipeline-derived; create disabled until valid.

---

### Task 4: NewBook route rewrite (picker) + CSS

**Files:** Modify `frontend/studio/src/routes/NewBook.tsx` (rewrite), `frontend/studio/src/routes/NewBook.module.css` (rewrite).

- [ ] **Step 1: Port CSS.** Rewrite `NewBook.module.css` from `dashboard/concept/new-book.html`: `.shell`/`.top`/`.back`/`.body`/`.wrap` (grid 1fr 332px), `.hero`, `.idblock`/`.idrow`/`.fl`/`.tin` (title input — keep title only; **drop the series input**), `.pick`/`.ph`/`.canon`/`.pickone`/`.def`, `.multihead`/`.lite`, `.grid2`, `.optcard`/`.sel`/`.rad`/`.tog`(+`.togOn`)/`.body2`/`.nm`/`.dsc`/`.mm`, `.src`(+`.builtin`/`.yours`/`.book`), `.summary`/`.scard`/`.cover`/`.ct`/`.cs`/`.slabel`/`.srow`/`.snote`/`.create`. Verbatim declarations.

- [ ] **Step 2: Rewrite `NewBook.tsx`** as the picker:

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useStore, type LibraryEntry, type LibraryKind, type LibraryEntryFull, type BookManifest } from '@bookclaw/shared';
import { GLOSSARY } from '../lib/glossary.js';
import { OptionCard } from '../components/newbook/OptionCard.js';
import { SnapshotSummary } from '../components/newbook/SnapshotSummary.js';
import styles from './NewBook.module.css';

const SINGLE: LibraryKind[] = ['author', 'voice', 'genre', 'pipeline'];

export function NewBook() {
  const navigate = useNavigate();
  const loadBooks = useStore((s) => s.loadBooks);
  const [opts, setOpts] = useState<Partial<Record<LibraryKind, LibraryEntry[]>>>({});
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<Record<LibraryKind, string>>({ author: '', voice: '', genre: '', pipeline: '', section: '', skill: '' } as Record<LibraryKind, string>);
  const [sections, setSections] = useState<string[]>([]);
  const [pipelineSkills, setPipelineSkills] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all((['author', 'voice', 'genre', 'pipeline', 'section'] as LibraryKind[]).map((k) =>
      api<{ entries: LibraryEntry[] }>(`/api/library/${k}`).then((r) => [k, r.entries ?? []] as const).catch(() => [k, []] as const),
    )).then((pairs) => {
      const map = Object.fromEntries(pairs) as Partial<Record<LibraryKind, LibraryEntry[]>>;
      setOpts(map);
      setSel((s) => ({ ...s, author: map.author?.[0]?.name ?? '', voice: map.voice?.[0]?.name ?? '', pipeline: map.pipeline?.[0]?.name ?? '' }));
    }).catch((e) => setError(String(e)));
  }, []);

  // When the pipeline changes, fetch the skills it references (read-only, derived).
  useEffect(() => {
    if (!sel.pipeline) { setPipelineSkills([]); return; }
    let cancelled = false;
    api<{ entry: LibraryEntryFull }>(`/api/library/pipeline/${encodeURIComponent(sel.pipeline)}`)
      .then((r) => { if (!cancelled) setPipelineSkills([...new Set((r.entry.pipeline?.steps ?? []).map((st) => st.skill).filter((x): x is string => !!x))]); })
      .catch(() => { if (!cancelled) setPipelineSkills([]); });
    return () => { cancelled = true; };
  }, [sel.pipeline]);

  const pickSingle = (kind: LibraryKind, name: string) => setSel((s) => ({ ...s, [kind]: s[kind] === name && kind === 'genre' ? '' : name })); // genre is deselectable (optional)
  const toggleSection = (name: string) => setSections((xs) => xs.includes(name) ? xs.filter((n) => n !== name) : [...xs, name]);

  const canCreate = !!(title.trim() && sel.author && sel.voice && sel.pipeline) && !busy;

  const create = async () => {
    setBusy(true); setError(null);
    try {
      await api<{ book: BookManifest }>('/api/books', { method: 'POST', body: JSON.stringify({
        title: title.trim(), author: sel.author, voice: sel.voice, genre: sel.genre || null, pipeline: sel.pipeline, sections,
      }) });
      await loadBooks();
      navigate('/');
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const pick = (kind: LibraryKind) => {
    const g = GLOSSARY[kind];
    const entries = opts[kind] ?? [];
    return (
      <section className={styles.pick} key={kind}>
        <div className={styles.ph}>
          <h3>{g.canon}{kind === 'genre' && <span className={styles.pickone}> · optional</span>}{kind === 'section' && <span className={styles.pickone}> · choose any</span>}</h3>
          <span className={styles.canon}>term · {g.canon}</span>
        </div>
        <div className={styles.def}>{g.def}</div>
        <div className={styles.grid2}>
          {entries.map((e) => (
            <OptionCard
              key={e.name}
              entry={e}
              mode={kind === 'section' ? 'multi' : 'single'}
              selected={kind === 'section' ? sections.includes(e.name) : sel[kind] === e.name}
              onToggle={() => kind === 'section' ? toggleSection(e.name) : pickSingle(kind, e.name)}
            />
          ))}
          {entries.length === 0 && <p className={styles.def}>None in the library yet.</p>}
        </div>
      </section>
    );
  };

  return (
    <div className={styles.body}>
      <div className={styles.wrap}>
        <div>
          <div className={styles.hero}><h1>New book</h1><p>Pull templates from the library; a frozen copy is snapshotted into the book.</p></div>
          <div className={styles.idblock}>
            <div className={styles.fl}>Title</div>
            <input className={styles.tin} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Dragon’s Heir" />
          </div>
          {pick('author')}
          {pick('voice')}
          {pick('genre')}
          {pick('pipeline')}
          {pick('section')}
          {error && <p className={styles.def} style={{ color: 'var(--alert)' }}>Couldn’t create — {error}</p>}
        </div>
        <SnapshotSummary
          title={title} author={sel.author} voice={sel.voice} genre={sel.genre || null} pipeline={sel.pipeline}
          sectionCount={sections.length} skills={pipelineSkills} canCreate={canCreate} busy={busy} onCreate={create}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean; `npm run -w frontend/studio build` succeeds.

- [ ] **Step 4: Review checkpoint** — required fields (title/author/voice/pipeline) gate create; genre optional + deselectable; sections multi; skills read-only derived from the pipeline; payload matches the API exactly (no skills/series sent).

---

### Task 5: Verification

- [ ] **Step 1: Build + type-check** — `npm run build:frontend`; `npx tsc --noEmit` clean.
- [ ] **Step 2: Backend suite unaffected** — `node --import tsx --test tests/unit/*.test.ts` → still 120/120 (no backend change).
- [ ] **Step 3: Manual** — `BOOKCLAW_AUTH_TOKEN=test npm start`:
  - Board → "New book" ghost card → the picker. Option cards list library authors/voices/genres/pipelines/sections with descriptions + source badges.
  - Pick an author/voice/pipeline (radios), optionally a genre (deselectable), toggle some sections. The summary updates live; choosing a pipeline lists its skills read-only.
  - Create → returns to the Board with the new book card; Rail count increments. Create is disabled until title+author+voice+pipeline are set.
  - No CSP errors.
- [ ] **Step 4: Review checkpoint** — parity with the concept (minus the unsupported series/skills selectors, intentionally omitted); ghost-card → picker → create round-trips.

---

## Self-Review (6g)

- **Spec coverage:** the full picker — option cards with descriptions (6e) + source badges (6f helper), single/multi select, live summary + cover, create → `POST /api/books`. Replaces 6c's minimal form. **Intentionally omitted (backend doesn't support):** the concept's series input and skills multi-select — skills are shown read-only as pipeline-derived (honest to `pulledFrom.skills`).
- **Placeholder scan:** all logic literal; CSS ports reference `new-book.html` with named classes; the GLOSSARY map is extracted to one shared source.
- **Type consistency:** `LibraryEntry`/`LibraryEntryFull`/`LibraryKind` consumed consistently; the create body matches the confirmed `{title, author, voice, genre|null, pipeline, sections[]}` contract; `OptionCard`/`SnapshotSummary` props match their call sites.
- **Honesty:** no selector for fields the API ignores; genre optional path sends `null`; required-field gating matches the server's 400s.
