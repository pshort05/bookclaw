# World Repository Phase 6 — Asset Studio browser + book panels (UI)

> **For agentic workers:** This is one of six World Repository plans. It **must** use the exact type names, signatures, file paths, and API routes from the shared contract `docs/superpowers/plans/2026-06-21-world-repository-00-index-and-contract.md`. Do not invent divergent names. This phase adds **no backend logic** — only frontend React components and the shared TS types that mirror the backend contract. It DEPENDS on the APIs delivered by Phases 1, 3, and 5 (documents CRUD, `propose`, `world/docs`, `world/appendix`, library `world` config).

**Spec:** `docs/superpowers/specs/2026-06-21-world-repository-design.md` — §8 "Section 5 — … UI" is the scope of this plan.
**Contract:** `docs/superpowers/plans/2026-06-21-world-repository-00-index-and-contract.md`.

---

## Goal

Deliver the v6 React studio UI for the World Repository:

1. **Asset Studio `world` kind** → a **repository browser**: a new `world` entry in `KindRail`, a world picker, documents grouped by type/domain with **classification + clearance badges**, search/filter, document **create/edit**, and a **`world.json` config editor**.
2. **Book / New-Book panels**:
   - a **World picker** (mirrors the genre picker) on New Book and as a per-book ref control,
   - a **"Build bible from world" curate panel** (calls `propose`, shows AI-ranked docs + reasons, check/uncheck, save curated set),
   - an **Appendix panel** (pick eligible docs, order them, save).

Each renders against the existing API; this plan creates **no** new endpoints.

## Architecture

The studio (`frontend/studio/`) is a React 18 + Vite SPA, an npm workspace, with shared code in `frontend/shared/` (`@bookclaw/shared`). The Asset Studio page (`frontend/studio/src/routes/AssetStudio.tsx`) is a three-pane layout: `KindRail` (left, kind selector) → `EntryList` (middle, entries for the selected kind/scope) → a per-kind editor on the right (`ProseEditor` / `PipelineEditor` / `EditorEditor` / etc.), chosen by switching on `kind`.

The `world` kind is **unlike every other kind**: its library entry is a config file (`world.json`) **plus** a `documents/` subdir owned by `WorldService` (contract §"Library wiring"). The existing `EntryList`/editor flow handles config-only kinds. For documents we add a **dedicated browser editor pane** (`WorldEditor`) that — when a world is selected — renders the repository browser (documents grouped, badged, searchable, CRUD) and a tab to edit `world.json`. The middle `EntryList` keeps listing **worlds** (one entry per world); selecting a world opens `WorldEditor`.

The world repository documents are fetched via the dedicated `/api/worlds/*` routes (not the generic library API), so a new client module `worldApi.ts` wraps those calls. Book panels (`WorldPicker`, `BuildBiblePanel`, `AppendixPanel`) call the book-scoped `/api/books/:slug/world/*` routes.

## Tech Stack

- **React 18** (`react`, `react-dom`), **Vite 5**, **react-router-dom 6** — all already in `frontend/studio/package.json` (build-time devDependencies; Vite bundles them into the served `dist/`).
- **TypeScript 5.5**, type-checked by the studio's own `tsc -b` (run as part of `vite build`).
- Shared types + the `api()` fetch helper come from `@bookclaw/shared` (`frontend/shared/src`).
- **CSS Modules** — reuse `frontend/studio/src/routes/AssetStudio.module.css` (the existing studio class set: `.entries`, `.entry`, `.edhead`, `.descfield`, `.fl`, `.pill`, `.gsearch`, `.ghead`, `.glabel`, `.gcount`, `.src`, badge classes `.builtin/.yours/.book`, etc.). Add a small new module only for the world-specific badge/grid styling that has no existing analog.

**No new runtime/dev dependency.** Do not add a component-test framework, a state library, or a markdown/yaml lib beyond what the studio already bundles.

## Global Constraints (apply to every task)

*(Verbatim from the shared contract — these govern every task below.)*

- **Node 22+**; TypeScript runs through `tsx` (no compile step in dev). Type-check with `npx tsc --noEmit`.
- **Imports use `.js` extensions** even from `.ts`/`.tsx` source (NodeNext). **The studio matches this** — every relative import in `frontend/studio/src` already carries a `.js` suffix (e.g. `import { KindRail } from '../components/asset/KindRail.js'`), and `@bookclaw/shared` is imported by package name. **Match the studio's existing style: add `.js` to every new relative import; import shared types/helpers from `@bookclaw/shared`.** (This is the same as the backend rule here because the studio is configured the same way — confirmed by reading the existing studio source.)
- **No new runtime dependency** for parsing. (N/A here — this phase parses nothing; the server returns parsed JSON.)
- **Fail-soft init/runtime.** Components degrade rather than crash: a failed fetch shows an inline error (`var(--alert)`), an empty list shows a hint, `needsAttention` docs render with a marker — never a thrown render. Mirror the existing `EntryList`/`PipelineEditor` try/catch + error-state pattern.
- **`schemaVersion` gating.** The server is authoritative; the UI surfaces `needsAttention` (parse failure) on a catalog row and treats a too-new/read-only world as non-editable when the server says so (disable Save, show the badge). The UI does not re-derive schema rules.
- **Commit workflow.** This repo uses a `commit_message` + `./push.sh` workflow — the maintainer commits; **do not run `git commit` / `git push`**. Each task ends at a verified, type-checking state. At milestone end, write the one-line-summary-plus-dashes `commit_message` per `CLAUDE.md`. (Overrides the writing-plans skill's literal `git commit` step.)
- **Surgical changes.** Touch only what the task requires; match existing style.
- **Docs are professional Markdown, no emojis/icons.**
- **Tests are committed and re-runnable.**

### Phase-6-specific verification gate (TDD override — read this)

**The studio has no component-test runner.** `frontend/studio/package.json` declares only build-time deps (`react`, `vite`, `typescript`, `@vitejs/plugin-react`); there is **no vitest/jest**, and the root `package.json` `test:unit` script runs `node --import tsx --test tests/unit/*.test.ts` (backend Node tests) plus `npm run build:frontend` as a build gate — it does **not** test React components. The repo's UI verification has always been "the bundle builds + type-checks".

Therefore, **for this phase the per-task verification gate is:**

```bash
npm run build:frontend     # runs studio `tsc -b && vite build` + chat build — must exit 0
npx tsc --noEmit           # backend/shared type-check (catches shared/src/types.ts breakage) — must exit 0
```

…**plus an explicit manual check** described per task (load `/`, open the relevant view, confirm the described behaviour). **Do not invent or add a component-test framework** — that would violate "no new dependency" and "surgical changes". The writing-plans skill's pure-TDD ("write a failing test first") is **overridden by repo reality** here: there is no runner to write a failing component test against. Where a piece of logic is pure and runner-independent (e.g. grouping/sorting a catalog into type→domain buckets), extract it into a plain function and note that it *could* later get a backend-style `tests/unit/*.test.ts`, but do **not** add one in this phase unless the contract's existing runner can import it without a DOM.

---

## File Structure

New and modified files (all under `frontend/`):

| File | New/Mod | Responsibility |
|---|---|---|
| `frontend/shared/src/types.ts` | **Mod** | Add `'world'` to `LibraryKind`; add `WorldDocumentType`, `LibraryWorld`, `WorldDocMeta`, `WorldDocument`, `WorldDocCatalogRow` interfaces, and `WorldProposal` (propose-response row) + `AppendixEntry`. Add `world?: LibraryWorld` to `LibraryEntryFull`; add `world?: PulledRef \| null`, `worldDocs?: string[]`, `appendix?: AppendixEntry[]` to `BookManifest`. (Mirror the backend `world-types.ts` contract exactly — do not redefine shapes differently.) |
| `frontend/studio/src/lib/worldApi.ts` | **New** | Typed wrappers over the dedicated `/api/worlds/*` and `/api/books/:slug/world/*` routes (list worlds, get config, list/get/create/update/delete documents, propose, save docs, save appendix). |
| `frontend/studio/src/lib/glossary.ts` | **Mod** | Add the `world` glossary entry (`canon: 'World'`, definition). `GLOSSARY` is keyed by `LibraryKind`, so adding `'world'` to the union forces this entry (type-checked). |
| `frontend/studio/src/components/asset/KindRail.tsx` | **Mod** | Add a `world` kind tile (icon + label "Worlds") to the `KINDS` array. |
| `frontend/studio/src/components/asset/EntryList.tsx` | **Mod** | Add `world` to `KIND_LABELS`; add `'world'` to `WRITABLE_KINDS` with a `STARTER_WORLD_JSON`; route the create-new for `world` through the library API (config only). |
| `frontend/studio/src/components/asset/WorldEditor.tsx` | **New** | The repository browser + `world.json` config editor for a selected world. Two tabs: **Documents** (grouped/badged/searchable list + create/edit/delete) and **Config** (`world.json` form). Owns the document-editor sub-view. |
| `frontend/studio/src/components/asset/WorldDocEditor.tsx` | **New** | Create/edit a single document: frontmatter fields (title, type, domain, clearance, attribution, tags, summary, appendixEligible) + body textarea. Classification shown read-only when auto-assigned. |
| `frontend/studio/src/lib/worldGroup.ts` | **New** | Pure helper: group/sort a `WorldDocCatalogRow[]` into `type → domain` buckets (extractable, runner-independent). |
| `frontend/studio/src/routes/AssetStudio.tsx` | **Mod** | When `kind === 'world'`, render `WorldEditor` instead of the prose/pipeline editors. |
| `frontend/studio/src/components/newbook/WorldPicker.tsx` | **New** | A World picker (mirrors `pickGenre`): single-select world for a New Book; optional. |
| `frontend/studio/src/routes/NewBook.tsx` | **Mod** | Wire `WorldPicker` into the New Book flow; include `world` in the create payload; inherit world from a chosen series. |
| `frontend/studio/src/components/book/BuildBiblePanel.tsx` | **New** | "Build bible from world": calls `propose`, lists ranked docs + reasons with checkboxes, saves the curated set via `world/docs`. |
| `frontend/studio/src/components/book/AppendixPanel.tsx` | **New** | Pick appendix-eligible docs + order them; saves via `world/appendix`. |
| `frontend/studio/src/components/BookDrawer.tsx` | **Mod** | Surface the book's World ref + entry points to the Build-bible and Appendix panels (open inline or via a small modal). |
| `frontend/studio/src/components/asset/World.module.css` | **New** | World-specific styles with no existing analog (clearance badge colours, doc-type group headers, classification chips). Reuse `AssetStudio.module.css` classes where they already fit. |

---

### Task 1: Shared TypeScript types for `world`

Add the world types to `@bookclaw/shared` so every component below is type-checked against the contract. **These mirror `gateway/src/services/world-types.ts` from Phase 1 — copy the shapes verbatim; do not diverge.**

**Files**
- `frontend/shared/src/types.ts` (modify)

**Interfaces produced** (consumed by Tasks 2–7): `LibraryKind` gains `'world'`; `WorldDocumentType`, `LibraryWorld`, `WorldDocMeta`, `WorldDocument`, `WorldDocCatalogRow`, `WorldProposal`, `AppendixEntry`; `LibraryEntryFull.world?`; `BookManifest.{world?, worldDocs?, appendix?}`.

- [ ] Extend the `LibraryKind` union (currently line 153) to add `'world'`:
  ```ts
  export type LibraryKind = 'author' | 'voice' | 'genre' | 'pipeline' | 'section' | 'skill' | 'sequence' | 'editor' | 'prompt' | 'world';
  ```
- [ ] Add the world interfaces (place them near `LibraryEditor`/`LibraryPrompt`, before `LibraryEntryFull`). Field-for-field from the contract's `world-types.ts`:
  ```ts
  export interface WorldDocumentType {
    id: string;        // e.g. "field-guide"
    label: string;     // e.g. "Field Guide"
    note?: string;     // e.g. "practical"
  }

  /** Per-world config, parsed from worlds/<name>/world.json (mirrors backend LibraryWorld). */
  export interface LibraryWorld {
    schemaVersion: number;
    name: string;
    label?: string;
    description?: string;
    documentTypes: WorldDocumentType[];
    domains: string[];
    clearanceLevels: string[];
    classificationScheme: string;
    formatDirective: string;
    authoringEditor?: string;
    stripCodesInAppendix?: boolean;
  }

  export interface WorldDocMeta {
    title: string;
    type: string;
    classification: string;
    clearance: string;
    domain: string;
    attribution?: string;
    tags: string[];
    summary: string;
    appendixEligible?: boolean;
  }

  export interface WorldDocument {
    docId: string;
    meta: WorldDocMeta;
    body: string;
  }

  export interface WorldDocCatalogRow {
    docId: string;
    title: string;
    type: string;
    domain: string;
    clearance: string;
    classification: string;
    summary: string;
    tags: string[];
    appendixEligible: boolean;
    needsAttention?: boolean;
  }

  /** A row from POST /api/books/:slug/world/propose (Phase 3). */
  export interface WorldProposal {
    docId: string;
    title: string;
    rank: number;
    reason: string;
  }

  /** One ordered appendix selection on a book (Phase 5). */
  export interface AppendixEntry {
    docId: string;
    title?: string;
    order: number;
  }
  ```
- [ ] Add `world?: LibraryWorld;` to `LibraryEntryFull` (alongside `editor?`, `prompt?`).
- [ ] Add the additive-optional book fields to `BookManifest`:
  ```ts
  // in pulledFrom: …existing…  world?: PulledRef | null;
  worldDocs?: string[];
  appendix?: AppendixEntry[];
  ```
  Add `world?: PulledRef | null;` inside the existing `pulledFrom` object literal (next to `genre?`), and `worldDocs`/`appendix` as top-level optional fields on `BookManifest`.
- [ ] **Verify:** `npx tsc --noEmit` clean (the union change forces `GLOSSARY` in Task 2 — do those together if tsc complains about an exhaustive `Record<LibraryKind, …>`). `npm run build:frontend` exits 0. **Manual:** none yet (types only).

---

### Task 2: World API client + glossary entry

A typed client for the dedicated world routes, and the glossary entry the lists/pickers display.

**Files**
- `frontend/studio/src/lib/worldApi.ts` (new)
- `frontend/studio/src/lib/glossary.ts` (modify)

**Interfaces consumed** (from the contract API table):
`GET /api/worlds`, `GET /api/worlds/:name`, `GET /api/worlds/:name/documents`, `GET/POST/PUT/DELETE /api/worlds/:name/documents[/:docId]`, `POST /api/books/:slug/world/propose`, `PUT /api/books/:slug/world/docs`, `PUT /api/books/:slug/world/appendix`. Config create/edit rides the existing library API (`/api/library/world`), already covered by `assetApi.ts`.

- [ ] Add the `world` glossary entry in `glossary.ts` (the `Record<LibraryKind, …>` is now non-exhaustive without it — tsc enforces):
  ```ts
  world: {
    canon: 'World',
    def: 'A reusable worldbuilding repository — the single source of truth for a setting. Books pull a relevant subset as their bible and select documents as reader-facing appendixes. Distinct from Genre (market) and Voice (style).',
  },
  ```
- [ ] Create `frontend/studio/src/lib/worldApi.ts`:
  ```ts
  import { api, type LibraryWorld, type WorldDocCatalogRow, type WorldDocument, type WorldDocMeta, type WorldProposal, type AppendixEntry } from '@bookclaw/shared';

  export interface WorldListRow { name: string; label?: string; description?: string; source: 'builtin' | 'workspace' | 'synthetic'; }

  export const listWorlds = () =>
    api<{ worlds: WorldListRow[] }>('/api/worlds').then((r) => r.worlds ?? []);

  export const getWorldConfig = (name: string) =>
    api<LibraryWorld>(`/api/worlds/${encodeURIComponent(name)}`);

  export const listWorldDocs = (name: string) =>
    api<{ documents: WorldDocCatalogRow[] }>(`/api/worlds/${encodeURIComponent(name)}/documents`).then((r) => r.documents ?? []);

  export const getWorldDoc = (name: string, docId: string) =>
    api<WorldDocument>(`/api/worlds/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`);

  // create: classification optional (server auto-assigns when omitted)
  export const createWorldDoc = (
    name: string,
    body: { meta: Omit<WorldDocMeta, 'classification'> & { classification?: string }; body: string },
  ) => api<WorldDocument>(`/api/worlds/${encodeURIComponent(name)}/documents`, { method: 'POST', body: JSON.stringify(body) });

  export const updateWorldDoc = (name: string, docId: string, body: { meta: WorldDocMeta; body: string }) =>
    api<WorldDocument>(`/api/worlds/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`, { method: 'PUT', body: JSON.stringify(body) });

  export const deleteWorldDoc = (name: string, docId: string) =>
    api(`/api/worlds/${encodeURIComponent(name)}/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });

  // book binding / pull / appendix
  export const proposeWorldDocs = (slug: string) =>
    api<{ proposals: WorldProposal[] }>(`/api/books/${encodeURIComponent(slug)}/world/propose`, { method: 'POST', body: '{}' }).then((r) => r.proposals ?? []);

  export const saveWorldDocs = (slug: string, docIds: string[]) =>
    api(`/api/books/${encodeURIComponent(slug)}/world/docs`, { method: 'PUT', body: JSON.stringify({ docIds }) });

  export const saveAppendix = (slug: string, appendix: AppendixEntry[]) =>
    api(`/api/books/${encodeURIComponent(slug)}/world/appendix`, { method: 'PUT', body: JSON.stringify({ appendix }) });
  ```
  > **Response-envelope note:** the contract names the routes but not the exact JSON envelope keys (`worlds`/`documents`/`proposals`). The wrappers above assume those keys. **When Phases 1/3 land, confirm the actual envelope and adjust these unwrap lines only** — do not change call sites. If a route returns the bare array/object, drop the `.then((r) => r.x)`.
- [ ] **Verify:** `npx tsc --noEmit` and `npm run build:frontend` exit 0. **Manual:** none (no UI wired yet); the module compiles against the Task 1 types.

---

### Task 3: World repository browser — list, group, badges, search

Render the selected world's documents grouped by type (then domain) with classification + clearance badges and a search box. This is the read view of `WorldEditor`'s Documents tab plus the grouping helper.

**Files**
- `frontend/studio/src/lib/worldGroup.ts` (new — pure grouping)
- `frontend/studio/src/components/asset/WorldEditor.tsx` (new — Documents tab read view; Config tab + CRUD come in Task 4)
- `frontend/studio/src/components/asset/World.module.css` (new — badge/group styles)
- `frontend/studio/src/components/asset/KindRail.tsx` (modify — add the Worlds tile)
- `frontend/studio/src/components/asset/EntryList.tsx` (modify — list worlds, label)
- `frontend/studio/src/routes/AssetStudio.tsx` (modify — route `world` kind to `WorldEditor`)

**Interfaces consumed:** `listWorlds`, `getWorldConfig`, `listWorldDocs` (Task 2). **Produced:** `groupDocs(rows, config)` → ordered `Array<{ type: WorldDocumentType; domains: Array<{ domain: string; rows: WorldDocCatalogRow[] }> }>`.

- [ ] `worldGroup.ts` — pure, DOM-free, testable later:
  ```ts
  import type { WorldDocCatalogRow, LibraryWorld, WorldDocumentType } from '@bookclaw/shared';

  export interface DocDomainBucket { domain: string; rows: WorldDocCatalogRow[]; }
  export interface DocTypeGroup { type: WorldDocumentType; domains: DocDomainBucket[]; count: number; }

  /** Group rows by config document-type order, then by config domain order.
   *  Unknown types/domains fall to a trailing "Other" bucket. Filtered by `q`
   *  (matches title, summary, tags, classification). */
  export function groupDocs(rows: WorldDocCatalogRow[], config: LibraryWorld, q = ''): DocTypeGroup[] {
    const query = q.trim().toLowerCase();
    const match = (r: WorldDocCatalogRow) =>
      !query || `${r.title} ${r.summary} ${r.tags.join(' ')} ${r.classification}`.toLowerCase().includes(query);
    const visible = rows.filter(match);
    const typeOrder = [...config.documentTypes, { id: '_other', label: 'Other' } as WorldDocumentType];
    const domainOrder = [...config.domains, '_other'];
    return typeOrder
      .map((type) => {
        const inType = visible.filter((r) => (type.id === '_other'
          ? !config.documentTypes.some((t) => t.id === r.type)
          : r.type === type.id));
        const domains = domainOrder
          .map((domain) => ({
            domain,
            rows: inType.filter((r) => (domain === '_other'
              ? !config.domains.includes(r.domain)
              : r.domain === domain)),
          }))
          .filter((b) => b.rows.length > 0);
        return { type, domains, count: inType.length };
      })
      .filter((g) => g.count > 0);
  }
  ```
- [ ] `KindRail.tsx` — append a tile to `KINDS`:
  ```tsx
  {
    id: 'world', label: 'Worlds',
    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9S9.5 5.5 12 3z"/></svg>,
  },
  ```
- [ ] `EntryList.tsx` — add `world: 'Worlds'` to `KIND_LABELS`, and `'world'` to `WRITABLE_KINDS`. Add a starter config + create branch in `handleAdd`:
  ```ts
  const STARTER_WORLD_JSON = JSON.stringify({
    schemaVersion: 1, name: 'new-world', label: 'New World', description: '',
    documentTypes: [], domains: [], clearanceLevels: [],
    classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}', formatDirective: '', stripCodesInAppendix: true,
  }, null, 2);
  // in handleAdd, before the generic else:
  } else if (kind === 'world') {
    await createLibraryEntry(kind, name, { content: STARTER_WORLD_JSON });
  }
  ```
  (Worlds list via the generic `/api/library/world` path already handled by `listEntries`.)
- [ ] `WorldEditor.tsx` — props `{ scope: Scope; name: string }` (book-scope worlds are snapshots; for v1 render read-only in book scope, editable in library scope — gate Save accordingly). Load config + catalog, render the **Documents** tab:
  ```tsx
  import { useEffect, useState } from 'react';
  import type { LibraryWorld, WorldDocCatalogRow } from '@bookclaw/shared';
  import type { Scope } from '../../lib/assetApi.js';
  import { getWorldConfig, listWorldDocs } from '../../lib/worldApi.js';
  import { groupDocs } from '../../lib/worldGroup.js';
  import asset from '../../routes/AssetStudio.module.css';
  import w from './World.module.css';

  export function WorldEditor({ name }: { scope: Scope; name: string }) {
    const [config, setConfig] = useState<LibraryWorld | null>(null);
    const [rows, setRows] = useState<WorldDocCatalogRow[]>([]);
    const [tab, setTab] = useState<'docs' | 'config'>('docs');
    const [q, setQ] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | 'new' | null>(null);

    const reload = () => {
      Promise.all([getWorldConfig(name), listWorldDocs(name)])
        .then(([c, d]) => { setConfig(c); setRows(d); })
        .catch((e) => setError(String(e)));
    };
    useEffect(() => { setError(null); setEditing(null); reload(); }, [name]);

    if (error) return <div style={{ color: 'var(--alert)', fontSize: 13 }}>{error}</div>;
    if (!config) return <div style={{ color: 'var(--faint)', fontSize: 13 }}>Loading…</div>;

    const groups = groupDocs(rows, config, q);

    return (
      <>
        <div className={asset.edhead}>
          <div>
            <h2>{config.label ?? name}</h2>
            <div className={asset.meta}>World · {rows.length} document{rows.length === 1 ? '' : 's'}</div>
          </div>
          <div className={asset.acts}>
            <button className={w.tab + (tab === 'docs' ? ' ' + w.on : '')} onClick={() => setTab('docs')}>Documents</button>
            <button className={w.tab + (tab === 'config' ? ' ' + w.on : '')} onClick={() => setTab('config')}>Config</button>
          </div>
        </div>

        {tab === 'docs' && (
          <>
            <div className={w.docbar}>
              <input className={asset.gsearch} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…" />
              <button className={asset.addnew} title="New document" onClick={() => setEditing('new')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              </button>
            </div>
            {groups.length === 0 && <p style={{ color: 'var(--faint)', fontSize: 13 }}>No documents{q ? ' match.' : ' yet.'}</p>}
            {groups.map((g) => (
              <div key={g.type.id} className={w.typegroup}>
                <div className={w.typehead}>{g.type.label}<span className={asset.gcount}>{g.count}</span></div>
                {g.domains.map((b) => (
                  <div key={b.domain} className={w.domainblock}>
                    <div className={w.domainlbl}>{b.domain === '_other' ? 'Other' : b.domain}</div>
                    {b.rows.map((r) => (
                      <div key={r.docId} className={w.docrow} onClick={() => setEditing(r.docId)}>
                        <div className={w.doctitle}>
                          {r.title}
                          {r.needsAttention && <span className={w.attn} title="Frontmatter needs attention">needs attention</span>}
                        </div>
                        <div className={w.docbadges}>
                          <span className={w.classchip}>{r.classification}</span>
                          <span className={`${w.clr} ${clrClass(r.clearance)}`}>{r.clearance}</span>
                          {r.appendixEligible && <span className={w.apx}>appendix</span>}
                        </div>
                        {r.summary && <div className={w.docsum}>{r.summary}</div>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
        {/* Config tab + WorldDocEditor wired in Task 4 */}
      </>
    );
  }

  // Map a clearance string to a badge tint by position in the (ordered) levels —
  // low index = open, high = restricted. Resolved against config in Task 4 refinement.
  function clrClass(_clearance: string): string { return w.clrGeneral; }
  ```
  (In Task 4, replace `clrClass` with a config-driven mapping over `config.clearanceLevels` index → `general/mid/restricted` tint; left as a stub here so Task 3 builds standalone.)
- [ ] `World.module.css` — add the new classes referenced above (`.tab`, `.on`, `.docbar`, `.typegroup`, `.typehead`, `.domainblock`, `.domainlbl`, `.docrow`, `.doctitle`, `.docbadges`, `.classchip`, `.clr`, `.clrGeneral`/`.clrMid`/`.clrRestricted`, `.apx`, `.attn`, `.docsum`). Use the existing token vars (`--bg`, `--panel`, `--line-2`, `--text`, `--dim`, `--faint`, `--alert`). Clearance tints: general = neutral, restricted = warm/alert-ish — keep subtle.
- [ ] `AssetStudio.tsx` — import `WorldEditor` and branch in the editor switch (the `selectedName ? (...)` block). Add **before** the `ProseEditor` fallback:
  ```tsx
  ) : kind === 'world' ? (
    <WorldEditor key={editorKey} scope={scope} name={selectedName} />
  ) : (
  ```
- [ ] **Verify:** `npm run build:frontend` + `npx tsc --noEmit` exit 0. **Manual:** load `/`, open Asset Studio, click **Worlds** in the kind rail; the entry list shows worlds (after Phase 2 seeds `shattered-cradle`, or after creating one). Select a world → the right pane shows documents **grouped by type, then domain**, each row carrying a **classification chip + clearance badge**; the search box filters; a `needsAttention` doc shows the marker. (Against the Neptune writing instance `http://192.168.1.28:3947`, the real Luminarch docs appear.)

---

### Task 4: Document create/edit + `world.json` config editor

Add the write paths: a single-document editor (frontmatter form + body) and the Config tab form for `world.json`. Wire both into `WorldEditor`.

**Files**
- `frontend/studio/src/components/asset/WorldDocEditor.tsx` (new)
- `frontend/studio/src/components/asset/WorldEditor.tsx` (modify — Config tab + open `WorldDocEditor`, real `clrClass`)
- `frontend/studio/src/components/asset/World.module.css` (modify — form styles if needed)

**Interfaces consumed:** `getWorldDoc`, `createWorldDoc`, `updateWorldDoc`, `deleteWorldDoc`, and the library config write (`writeEntry(scope, 'world', name, { content })` from `assetApi.ts`).

- [ ] `WorldDocEditor.tsx` — props `{ world: string; config: LibraryWorld; docId: string | 'new'; onDone: (changed: boolean) => void }`. On `'new'`, start blank meta (no `classification` — the server auto-assigns); on edit, `getWorldDoc` to prefill. Form fields:
  - **Title** (text), **Type** (select over `config.documentTypes`), **Domain** (select over `config.domains`), **Clearance** (select over `config.clearanceLevels`), **Attribution** (text, optional), **Tags** (comma-separated text → `string[]`), **Summary** (textarea), **Appendix-eligible** (checkbox), **Classification** (read-only text — shown only on edit, or "auto-assigned on save" on new), **Body** (large `Fraunces` textarea, like `PipelineEditor`'s prompt textarea).
  - Save: on new → `createWorldDoc(world, { meta: {…without classification}, body })`; on edit → `updateWorldDoc(world, docId, { meta: {…with classification}, body })`. Delete button (edit only, `confirm` via `useDialog`) → `deleteWorldDoc`. Call `onDone(true)` after a successful write so `WorldEditor` reloads the catalog.
  - Use the same input/textarea inline styles and `descfield`/`fl` classes as `EditorEditor`/`PipelineEditor` for visual consistency. Disable Save while saving; show `Saved` then clear (mirror the existing pattern). Fail-soft: a write error shows inline `var(--alert)` text, no throw.
  ```tsx
  // sketch of the meta assembly:
  const meta = {
    title: title.trim(), type, domain, clearance,
    attribution: attribution.trim() || undefined,
    tags: tagsRaw.split(',').map((t) => t.trim()).filter(Boolean),
    summary: summary.trim(),
    appendixEligible: apxEligible || undefined,
  };
  // new: createWorldDoc(world, { meta, body });  edit: updateWorldDoc(world, docId, { meta: { ...meta, classification }, body });
  ```
- [ ] `WorldEditor.tsx` — when `editing` is set, render `<WorldDocEditor world={name} config={config} docId={editing} onDone={(c) => { setEditing(null); if (c) reload(); }} />` instead of the list (a back-to-list affordance in the doc editor header). Implement the **Config** tab as a form over `LibraryWorld` (load via the library API for the editable raw, or reuse `config`): fields for `label`, `description`, `formatDirective` (large textarea), `classificationScheme`, `authoringEditor` (select over `/api/library/editor` names, like `PipelineEditor`'s skill select), `stripCodesInAppendix` (checkbox), and **list editors** for `documentTypes` (id/label/note rows, add/remove), `domains` (chip text-list), `clearanceLevels` (ordered text-list). Save serializes to `world.json` and writes via `writeEntry(scope, 'world', name, { content: JSON.stringify(next, null, 2) })`. Replace the `clrClass` stub with a config-driven index map:
  ```ts
  function clrClass(clearance: string, levels: string[]): string {
    const i = levels.indexOf(clearance);
    if (i < 0) return w.clrGeneral;
    if (i >= levels.length - 1) return w.clrRestricted;
    return i === 0 ? w.clrGeneral : w.clrMid;
  }
  ```
- [ ] Gate editing by scope: in `book` scope the world is a snapshot — render read-only (no New-document button, disabled Save) and show the `book copy` badge via `sourceBadge`. In `library` scope, full CRUD.
- [ ] **Verify:** `npm run build:frontend` + `npx tsc --noEmit` exit 0. **Manual:** in Asset Studio → Worlds → a library world: click **New document**, fill type/domain/clearance/summary/body, Save → the row appears with an **auto-assigned classification** (next free serial for that TYPE-DOMAIN). Edit a doc, change the body, Save → reload shows the change. Open **Config**, edit the `formatDirective` and add a domain, Save → reopen confirms persistence. In book scope the same world is read-only.

---

### Task 5: New-Book / book World picker

A World picker mirroring the genre picker on New Book, plus surfacing the ref on the book.

**Files**
- `frontend/studio/src/components/newbook/WorldPicker.tsx` (new)
- `frontend/studio/src/routes/NewBook.tsx` (modify)

**Interfaces consumed:** `listWorlds` (Task 2); New-Book create payload (`POST /api/books`) gains an optional `world` field; series inheritance reads `pulledFrom.world` off the series option.

- [ ] `WorldPicker.tsx` — a single-select, optional picker styled like `pickGenre`'s simple variant (no groups; worlds are few). Props `{ worlds: WorldListRow[]; value: string; onChange: (name: string) => void; locked?: boolean }`. Render an `OptionCard` grid (reuse `frontend/studio/src/components/newbook/OptionCard.tsx`) with `mode="single"`; clicking the selected one clears it (optional, like genre). Show the World glossary def header (`GLOSSARY.world`).
- [ ] `NewBook.tsx`:
  - Add `world: ''` to the `sel` initial record (the record is keyed by `LibraryKind`; `'world'` is now part of the union, so TS requires it).
  - Load worlds: add `'world'` to the `Promise.all` kinds list **or** call `listWorlds()` separately into a `worlds` state (worlds use the dedicated list route; `listWorlds()` is cleaner — use it). Render `<WorldPicker worlds={worlds} value={sel.world} onChange={(n) => pickSingle('world', n)} locked={!!seriesId} />` after `pickGenre()`.
  - Series inheritance: extend the `SeriesOpt.pulledFrom` type with `world?: { name: string } | null` and set `world: s.pulledFrom.world?.name ?? prev.world` in `chooseSeries`. Lock the picker when a series is chosen (same as author/voice/genre).
  - Include `world` in the create body: `...(sel.world ? { world: sel.world } : {})`.
  - Optionally surface the chosen world in `SnapshotSummary` (add a `world?` prop + a line) — keep it minimal; if `SnapshotSummary`'s prop surface is tight, a single extra optional prop is fine and matches the existing `pipeline?`/`skills` props.
- [ ] **Verify:** `npm run build:frontend` + `npx tsc --noEmit` exit 0. **Manual:** load `/newbook`; a **World** picker appears (optional); selecting a series that has a world locks the picker to the series' world; creating a book with a world selected succeeds (the manifest's `pulledFrom.world` is set — confirm via the Book drawer in Task 7 or `GET /api/books/:slug`).

---

### Task 6: "Build bible from world" curate panel

A panel that proposes relevant docs (AI-ranked, with reasons), lets the author curate, and saves the curated set.

**Files**
- `frontend/studio/src/components/book/BuildBiblePanel.tsx` (new)
- `frontend/studio/src/components/BookDrawer.tsx` (modify — entry point; full wiring in Task 7)

**Interfaces consumed:** `proposeWorldDocs(slug)`, `saveWorldDocs(slug, docIds)` (Task 2); reads the book's existing `worldDocs` (from `BookManifest`) to pre-check rows.

- [ ] `BuildBiblePanel.tsx` — props `{ slug: string; current?: string[]; onSaved?: (docIds: string[]) => void; onClose?: () => void }`. Behaviour:
  - On mount (or a "Propose" button click), call `proposeWorldDocs(slug)`. Show a loading state; on fail-soft fallback the server returns the full catalog with `reason: 'manual'` — render it the same way (no special-casing needed; just show whatever rows come back).
  - Render each proposal as a checkbox row: `[x] {title}  · rank N · {reason}`. Pre-check rows whose `docId` is in `current`. Allow check/uncheck. Keep a `Set<string>` of selected `docId`s.
  - **Save** → `saveWorldDocs(slug, [...selected])`; on success call `onSaved(selected)` (so the drawer/manifest refreshes) and show a confirmation. Disable Save while saving. Inline error on failure (`var(--alert)`), never a throw — never blocks.
  - A "Re-propose" affordance re-runs `proposeWorldDocs` (the AI may have new docs). Selections persist across a re-propose where the `docId` still appears.
  ```tsx
  // selection model
  const [proposals, setProposals] = useState<WorldProposal[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set(current ?? []));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // save: await saveWorldDocs(slug, [...sel]); onSaved?.([...sel]);
  ```
- [ ] Style with existing classes (`descfield`/`fl` for the header, a simple checkbox list; `pill` for the rank). Keep it self-contained so it can render inline in the drawer or in a small modal (`Dialog.tsx` exists — reuse if a modal is preferred; inline in the drawer is simplest).
- [ ] **Verify:** `npm run build:frontend` + `npx tsc --noEmit` exit 0. **Manual:** for a book bound to a world, open the panel → it lists AI-proposed docs with **reasons**, pre-checking the book's current `worldDocs`; check/uncheck and Save → re-opening shows the saved selection persisted (the server snapshots `templates/world/` per Phase 3). Force an AI failure (or run before keys configured) → the panel still lists the full catalog (manual reasons) and saving works.

---

### Task 7: Appendix panel + Book drawer wiring

Pick appendix-eligible docs and order them; save. Wire the World ref, Build-bible, and Appendix entry points into the Book drawer.

**Files**
- `frontend/studio/src/components/book/AppendixPanel.tsx` (new)
- `frontend/studio/src/components/BookDrawer.tsx` (modify)

**Interfaces consumed:** `listWorldDocs(worldName)` (eligible pool — filter `appendixEligible`), the book's `appendix` (`BookManifest.appendix`), `saveAppendix(slug, entries)` (Task 2). The world name comes from `BookManifest.pulledFrom.world?.name`.

- [ ] `AppendixPanel.tsx` — props `{ slug: string; worldName: string; current?: AppendixEntry[]; onSaved?: (entries: AppendixEntry[]) => void }`. Behaviour:
  - Load the world catalog, filter to `appendixEligible` rows = the candidate pool.
  - Show the candidate pool with checkboxes; checking adds an `AppendixEntry { docId, order }`. The **selected** set renders as an ordered list with up/down move buttons (mirror `NewBook`'s sequence reorder UI: `moveSeq`/`removeSeq` pattern) and an optional per-entry `title` override input. `order` is the array index at save time (re-numbered 0..n-1 on save).
  - **Save** → `saveAppendix(slug, entries.map((e, i) => ({ ...e, order: i })))`; `onSaved` refreshes the drawer. Inline error, fail-soft.
  ```tsx
  // ordered model: AppendixEntry[] in display order; renumber on save
  const [entries, setEntries] = useState<AppendixEntry[]>(current ?? []);
  const move = (i: number, d: -1 | 1) => setEntries((xs) => { const j = i + d; if (j < 0 || j >= xs.length) return xs; const n = [...xs]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const add = (docId: string) => setEntries((xs) => xs.some((e) => e.docId === docId) ? xs : [...xs, { docId, order: xs.length }]);
  ```
- [ ] `BookDrawer.tsx` — surface the World ref and the two panel entry points:
  - In the assets block, add a **World** row showing `pf?.world?.name ?? '—'` (next to Genre/Pipeline; `pf` is `data.book.pulledFrom`).
  - When `pf?.world?.name` exists, add two buttons in the drawer footer or a new section: **"Build bible from world"** and **"Edit appendix"**. Each opens its panel (inline expand within the drawer body, or via `Dialog`). On a panel's `onSaved`, re-fetch the book (`api<BookDetail>('/api/books/:slug')`) so the drawer reflects the new `worldDocs`/`appendix` counts. Hide both when the book has no world.
  - Keep the drawer's existing layout/style; the new buttons reuse the shared `Button` component already imported.
- [ ] **Verify:** `npm run build:frontend` + `npx tsc --noEmit` exit 0. **Manual:** open a book (with a world) in the Book drawer → a **World** row shows the bound world; **Build bible from world** opens Task 6's panel; **Edit appendix** opens the Appendix panel listing only `appendixEligible` docs, lets you check + reorder + set a title override, and Save persists (re-open confirms). A book with no world shows neither button.

---

## Self-Review

- **Conforms to the shared contract?** Yes. Types in Task 1 are copied field-for-field from `world-types.ts` (the contract's §"Shared types"); the API client in Task 2 calls only the contract's named routes (`/api/worlds/*`, `/api/books/:slug/world/{propose,docs,appendix}`, library `world` config). The one ambiguity — the JSON response **envelope keys** (`worlds`/`documents`/`proposals`) — is flagged in Task 2 with an instruction to confirm against the Phase 1/3 implementation and adjust only the unwrap lines. No new names invented beyond `WorldProposal`/`AppendixEntry`/`WorldListRow`, which are UI-side shapes for already-specified payloads (proposal rows, appendix entries, world-list rows) — if Phase 1/3 export equivalents, import theirs instead and drop the local duplicates.
- **Stack/patterns verified, not guessed?** Yes — read `AssetStudio.tsx`, `assetApi.ts`, `api.ts`, `KindRail.tsx`, `EntryList.tsx`, `PipelineEditor.tsx`, `EditorEditor.tsx`, `NewBook.tsx`, `BookDrawer.tsx`, `glossary.ts`, `sourceBadge.ts`, `types.ts`, and both `package.json`s. The studio uses React 18 + Vite + react-router, CSS Modules, `@bookclaw/shared` for the `api()` helper and types, and **`.js` extensions on relative imports** — the plan matches all of these. Auth-token injection is automatic via `api()` (`__BOOKCLAW_TOKEN__`); native-download `?token=` is not needed here (no file downloads in this phase).
- **TDD override justified?** Yes. Confirmed **no component-test runner** exists (no vitest/jest in `frontend/studio/package.json`; root `test:unit` runs backend `node --test` only). The phase gate is `npm run build:frontend` (studio `tsc -b && vite build`) + `npx tsc --noEmit` + an explicit manual check per task. The only pure logic (`groupDocs`) is extracted into `worldGroup.ts` so it *could* later get a backend-style unit test; no test framework is added in this phase (per "no new dependency").
- **Scope discipline?** Each task changes only the files it lists; book-scope worlds render read-only in v1 (snapshot semantics) rather than re-implementing the snapshot edit path. Deferred items from the contract (bible-brief digest, FTS indexing, whole-world zip) are **not** touched. No backend logic added.
- **Fail-soft everywhere?** Every fetch is wrapped; errors render inline (`var(--alert)`), empty states show hints, `needsAttention` rows render with a marker, propose-failure falls back to the full catalog (server-driven). No render throws.
- **Commit workflow honoured?** No literal `git commit`/`git push`; the plan ends each task at a build-green/type-clean state and defers committing to the maintainer's `commit_message` + `./push.sh`.
- **Smallest reasonable split?** Seven tasks: types → client → browser-read → CRUD/config → World picker → curate panel → appendix+drawer. Tasks 3 and 4 are deliberately split (read view standalone-buildable before write paths) so each lands green independently.
