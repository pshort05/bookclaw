# Romance Guided Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Guided wizard (Romance Workflow sub-project 2) — a deterministic, single-page studio form at route `/guided` that collects the shared seed contract (`heat`, `storyArc`, `characters`, `setting`, `chapterCount`, `wordsPerChapter`, `councilSelection`) and creates a book directly on `romance-sweet-full`/`romance-spicy-full`. No AI call, no review gate — it is "NewBook-lite" for romance seeds.

**Architecture:** One pure, CSS-free TypeScript module (`frontend/studio/src/lib/guidedSeeds.ts`) owns the two testable behaviors — heat→pipeline selection and `/api/books` payload assembly/gating — so they can be unit-tested directly with `node --import tsx --test` (the route file itself cannot be: it imports a `.module.css`, which fails under a bare Node import, so every other studio route test in this repo is a build-then-grep bundle test instead; this module sidesteps that by carrying zero CSS/React imports). A new route component, `Guided.tsx`, renders the form: title/author/voice/genre selects seeded from `/api/library/*` (mirrors `PremiseIntake.tsx`'s fetch pattern, default to `entries[0]`), a heat toggle, three seed textareas, a council-selection toggle, and the existing `FormatPicker` component verbatim (the validated structure+form+chapterCount+wordsPerChapter path — reusing it is what keeps `chapterCount`/`wordsPerChapter` out of the bare-field 400 path). On submit it POSTs straight to the existing `POST /api/books` — no new backend or MCP surface, since every field Guided sends (`storyArc`, `characters`, `setting`, `councilSelection`, `structure`, `form`, `chapterCount`, `wordsPerChapter`, `pipelineSequence`) is already accepted there and already MCP-lockstepped. Finally the `NewHub` "Guided" card flips from `soon: true` to `to: '/guided'`.

**Tech Stack:** Node 22 + TypeScript (`--import tsx`, NodeNext `.js` imports), React 18 + react-router-dom in `frontend/studio/`, CSS Modules, the shared `@bookclaw/shared` `api`/`useStore`. Unit tests: `node --import tsx --test tests/unit/*.test.ts`. Studio build: `npm run build:frontend` (Vite; dist is gitignored).

## Global Constraints

- **Imports use `.js` extensions** even in `.ts`/`.tsx` source (NodeNext). Match existing files.
- **No backend or MCP changes.** Every `/api/books` field Guided sends is already accepted (`gateway/src/api/routes/books.routes.ts`) and already in the MCP `create_book` tool (`mcp/src/tools/books.ts`). Do not touch either.
- **`chapterCount`/`wordsPerChapter` reach `/api/books` ONLY inside a fully-specified format block** (`structure` + `form` + `chapterCount` + `wordsPerChapter` together) — `buildBookFormat` (`gateway/src/services/format-input.ts`) 400s on a partial block or bare fields. Reuse `FormatPicker`'s client-side `formatFit` mirror to gate the Create button before submit, exactly as `NewBook.tsx` does.
- **Seed field is `setting`, never `world`** (romance is grounded in the real world — place/sensory texture, distinct from the World Repository `world` bind).
- **The shared seed contract has no `blueprint` field.** `blueprint` is a Foundation extension specific to the premise-intake flow (`docs/superpowers/specs/2026-07-08-romance-workflow-design.md` decision 6 lists `{ heat, storyArc, characters, setting, chapterCount, wordsPerChapter, councilSelection }` only). Guided must not send it.
- **`heat` is never sent as its own `/api/books` field.** It only selects which pipeline id (`romance-sweet-full` / `romance-spicy-full`) goes into `pipelineSequence` — the manifest's `seeds` block has no `heat` key (`gateway/src/services/book.ts:55`). Matches how `PremiseIntake.tsx` already does this.
- **`councilSelection` is persisted but inert** until the Council sub-project (3). Collect it as a toggle: `'auto'` = "Auto-select the best base story", `'propose'` = "Propose top ideas for me to pick".
- **CSS Modules are one-per-route in this codebase** (every `routes/*.tsx` imports exactly one same-named `*.module.css`; no cross-route CSS imports exist today). `FormatPicker.tsx` is the one existing exception (it imports `NewBook.module.css` directly, regardless of the embedding page) — leave that as-is; Guided gets its own `Guided.module.css`.
- **No `git commit`/`git push` by Claude.** Per repo workflow, "Commit" steps below stage a local commit for subagent-driven review; the maintainer runs `./push.sh`.

**Reference spec:** `docs/superpowers/specs/2026-07-08-romance-workflow-design.md` (decision 2 entry taxonomy, decision 6 seed contract, sub-project table + build order Foundation → Guided → Council → Adaptive).

---

### Task 1: `guidedSeeds.ts` — pure heat/payload/gating logic

The only genuinely unit-testable logic in this feature: which pipeline a heat maps to, when Create is allowed, and the exact `/api/books` body. Deliberately zero React/CSS imports so it is directly `node --import tsx --test`-importable (unlike every `.tsx` route, which fails under Node with `Unknown file extension ".css"` — verified against `FormatPicker.tsx` during planning).

**Files:**
- Create: `frontend/studio/src/lib/guidedSeeds.ts`
- Test: `tests/unit/guided-seeds.test.ts`

**Interfaces:**
- Produces (consumed by Task 2):

```ts
export type Heat = 'sweet' | 'spicy';
export type CouncilSelection = 'auto' | 'propose';

export interface GuidedSeeds {
  storyArc: string;
  characters: string;
  setting: string;
  heat: Heat;
  councilSelection: CouncilSelection;
}

export const EMPTY_GUIDED_SEEDS: GuidedSeeds;

export interface GuidedFormat {
  structure: string;
  customStructure?: unknown;
  form: string;
  chapterCount: number;
  wordsPerChapter: number;
}

export function pipelineForHeat(heat: Heat): string;
export function guidedCanCreate(input: { title: string; author: string; voice: string; formatOk: boolean; formatActive: boolean }): boolean;
export function buildGuidedCreatePayload(input: { title: string; author: string; voice: string; genre: string; seeds: GuidedSeeds; format: GuidedFormat }): Record<string, unknown>;
```

- [ ] **Step 1: Write the failing test**

`tests/unit/guided-seeds.test.ts`:

```ts
/**
 * Pure logic for the Guided wizard (frontend/studio/src/lib/guidedSeeds.ts):
 * heat->pipeline selection, the Create gate, and the /api/books payload shape.
 * Run: node --import tsx --test tests/unit/guided-seeds.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pipelineForHeat, guidedCanCreate, buildGuidedCreatePayload, EMPTY_GUIDED_SEEDS,
} from '../../frontend/studio/src/lib/guidedSeeds.js';

test('pipelineForHeat selects the sweet/spicy full pipeline', () => {
  assert.equal(pipelineForHeat('sweet'), 'romance-sweet-full');
  assert.equal(pipelineForHeat('spicy'), 'romance-spicy-full');
});

test('guidedCanCreate requires title, author, voice, and a fully-fit format', () => {
  const base = { title: 'T', author: 'a', voice: 'v', formatOk: true, formatActive: true };
  assert.equal(guidedCanCreate(base), true);
  assert.equal(guidedCanCreate({ ...base, title: '  ' }), false);
  assert.equal(guidedCanCreate({ ...base, author: '' }), false);
  assert.equal(guidedCanCreate({ ...base, voice: '' }), false);
  assert.equal(guidedCanCreate({ ...base, formatActive: false }), false);
  assert.equal(guidedCanCreate({ ...base, formatOk: false }), false);
});

test('buildGuidedCreatePayload assembles the /api/books body for a sweet book', () => {
  const payload = buildGuidedCreatePayload({
    title: ' My Book ', author: 'default', voice: 'default', genre: 'romance',
    seeds: { ...EMPTY_GUIDED_SEEDS, storyArc: 'ARC', characters: 'CHARS', setting: 'SET', heat: 'sweet', councilSelection: 'propose' },
    format: { structure: 'three-act', form: 'novel', chapterCount: 30, wordsPerChapter: 2500 },
  });
  assert.deepEqual(payload, {
    title: 'My Book', author: 'default', voice: 'default', genre: 'romance',
    pipelineSequence: ['romance-sweet-full'],
    storyArc: 'ARC', characters: 'CHARS', setting: 'SET', councilSelection: 'propose',
    structure: 'three-act', form: 'novel', chapterCount: 30, wordsPerChapter: 2500,
  });
});

test('buildGuidedCreatePayload selects the spicy pipeline, nulls an empty genre, and includes customStructure when present', () => {
  const payload = buildGuidedCreatePayload({
    title: 'X', author: 'a', voice: 'v', genre: '',
    seeds: { ...EMPTY_GUIDED_SEEDS, heat: 'spicy' },
    format: { structure: 'custom', customStructure: { id: 'custom', beats: [] }, form: 'novella', chapterCount: 12, wordsPerChapter: 3000 },
  });
  assert.deepEqual(payload.pipelineSequence, ['romance-spicy-full']);
  assert.equal(payload.genre, null);
  assert.deepEqual(payload.customStructure, { id: 'custom', beats: [] });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/guided-seeds.test.ts`
Expected: FAIL — module `guidedSeeds.js` not found.

- [ ] **Step 3: Implement `guidedSeeds.ts`**

`frontend/studio/src/lib/guidedSeeds.ts`:

```ts
export type Heat = 'sweet' | 'spicy';
export type CouncilSelection = 'auto' | 'propose';

export interface GuidedSeeds {
  storyArc: string;
  characters: string;
  setting: string;
  heat: Heat;
  councilSelection: CouncilSelection;
}

export const EMPTY_GUIDED_SEEDS: GuidedSeeds = {
  storyArc: '', characters: '', setting: '', heat: 'sweet', councilSelection: 'auto',
};

export interface GuidedFormat {
  structure: string;
  customStructure?: unknown;
  form: string;
  chapterCount: number;
  wordsPerChapter: number;
}

/** Heat selects the pipeline id — the manifest's seeds block carries no `heat`
 *  key (gateway/src/services/book.ts:55); this is the only place heat is used. */
export function pipelineForHeat(heat: Heat): string {
  return heat === 'spicy' ? 'romance-spicy-full' : 'romance-sweet-full';
}

/** Gate: title/author/voice set, plus a fully-specified, in-band format.
 *  chapterCount/wordsPerChapter only reach /api/books inside a validated
 *  format block (gateway/src/services/format-input.ts buildBookFormat) — a
 *  bare or partial block 400s, so Create must stay disabled until the format
 *  is both `active` (something was touched) and `ok` (fits the form's band). */
export function guidedCanCreate(input: { title: string; author: string; voice: string; formatOk: boolean; formatActive: boolean }): boolean {
  return !!(input.title.trim() && input.author && input.voice && input.formatActive && input.formatOk);
}

/** Assembles the POST /api/books body. Mirrors NewBook.tsx's create() literal
 *  for the format block; no `blueprint` (not part of the shared seed contract)
 *  and no top-level `heat` (see pipelineForHeat). */
export function buildGuidedCreatePayload(input: {
  title: string; author: string; voice: string; genre: string;
  seeds: GuidedSeeds; format: GuidedFormat;
}): Record<string, unknown> {
  const { title, author, voice, genre, seeds, format } = input;
  return {
    title: title.trim(),
    author,
    voice,
    genre: genre || null,
    pipelineSequence: [pipelineForHeat(seeds.heat)],
    storyArc: seeds.storyArc,
    characters: seeds.characters,
    setting: seeds.setting,
    councilSelection: seeds.councilSelection,
    structure: format.structure,
    ...(format.customStructure ? { customStructure: format.customStructure } : {}),
    form: format.form,
    chapterCount: format.chapterCount,
    wordsPerChapter: format.wordsPerChapter,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/guided-seeds.test.ts`
Expected: PASS (4 tests). Then `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/studio/src/lib/guidedSeeds.ts tests/unit/guided-seeds.test.ts
git commit -m "feat(romance): Guided wizard — pure heat/payload/gating logic"
```

---

### Task 2: `Guided.tsx` — the wizard screen

The single-page form: identity (title/author/voice/genre), heat toggle, three seed textareas, council-selection toggle, `FormatPicker`, and a Create button gated by `guidedCanCreate`. Registered at route `/guided`.

**Files:**
- Create: `frontend/studio/src/routes/Guided.tsx`
- Create: `frontend/studio/src/routes/Guided.module.css`
- Modify: `frontend/studio/src/main.tsx` (import + `<Route path="guided" .../>`)
- Test: `tests/unit/guided-bundle.test.ts`

**Interfaces:**
- Consumes: `guidedSeeds.ts` exports (Task 1); `FormatPicker`/`EMPTY_FORMAT`/`formatFit`/`parseCustomStructure`/`FormatValue`/`StructureOpt`/`FormOpt` from `frontend/studio/src/components/newbook/FormatPicker.tsx` (unmodified); `api`, `useStore`, `LibraryEntry`, `BookManifest` from `@bookclaw/shared`; `GET /api/library/author|voice|genre`, `GET /api/structures`, `GET /api/forms`; `POST /api/books`.
- Produces: rendered route `/guided`; component export `Guided`.

- [ ] **Step 1: Write the failing bundle test**

`tests/unit/guided-bundle.test.ts` (modeled on `tests/unit/premise-intake-bundle.test.ts`):

```ts
/**
 * Bundle smoke test for the Guided wizard screen
 * (frontend/studio/src/routes/Guided.tsx). Mirrors
 * tests/unit/premise-intake-bundle.test.ts: the Vite dist is gitignored, so
 * this builds it on demand (first run / fresh checkout), then reads every
 * hashed JS asset and asserts markers unique to the Guided screen ship.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const repo = process.cwd();
const assetsDir = join(repo, 'frontend/studio/dist/assets');

test('studio bundle carries the Guided wizard screen', { timeout: 180000 }, () => {
  if (!existsSync(assetsDir)) {
    try {
      execSync('npm run -w frontend/studio build', { cwd: repo, stdio: 'pipe' });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      if (e.stdout) process.stderr.write(e.stdout);
      if (e.stderr) process.stderr.write(e.stderr);
      throw err;
    }
  }
  const js = readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assetsDir, f), 'utf-8'))
    .join('\n');

  // These three strings are unique to Guided.tsx — PremiseIntake.tsx has no
  // council-selection UI and no chef/critic placeholder copy.
  assert.ok(js.includes('Auto-select the best base story'), 'council-selection auto label must ship in the bundle');
  assert.ok(js.includes('Propose top ideas for me to pick'), 'council-selection propose label must ship in the bundle');
  assert.ok(js.includes('the critic who once panned her restaurant'), 'story-arc placeholder copy must ship in the bundle');
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
rm -rf frontend/studio/dist
node --import tsx --test tests/unit/guided-bundle.test.ts
```
Expected: the on-demand build succeeds (other routes compile fine) but all three assertions FAIL — the marker strings don't exist yet.

- [ ] **Step 3: Implement `Guided.module.css`**

`frontend/studio/src/routes/Guided.module.css` (trimmed from `PremiseIntake.module.css` — single-column layout to match; `FormatPicker` brings its own styling from `NewBook.module.css` regardless of the embedding page, so no overlap):

```css
/* Guided route — deterministic romance seed-collection form. Layout mirrors
   PremiseIntake.module.css (single column, no sidebar). */
.body {
  flex: 1;
  overflow-y: auto;
  padding: 30px 26px 60px;
}
.wrap {
  max-width: 820px;
  margin: 0 auto;
}

/* hero */
.hero { margin-bottom: 26px; }
.hero h1 {
  font-family: 'Fraunces', serif;
  font-optical-sizing: auto;
  font-weight: 340;
  font-size: 38px;
  letter-spacing: -.025em;
  margin: 0;
}
.hero h1 em { font-style: italic; color: var(--ember); }
.hero p {
  color: var(--dim);
  margin: 8px 0 0;
  max-width: 60ch;
  line-height: 1.5;
}

/* field blocks */
.idblock { margin-bottom: 22px; flex: 1; min-width: 0; }
.row { display: flex; gap: 18px; align-items: flex-start; }
.fl {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: .12em;
  text-transform: uppercase;
  color: var(--faint);
  margin-bottom: 9px;
}
.hint {
  font-size: 11.5px;
  color: var(--faint);
  line-height: 1.5;
  margin: -4px 0 10px;
}
.tin, .area {
  width: 100%;
  background: var(--panel);
  border: 1px solid var(--line-2);
  border-radius: 12px;
  padding: 13px 16px;
  color: var(--text);
  font-family: 'Fraunces', serif;
  font-size: 16px;
  outline: none;
  transition: .18s;
}
.area {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  line-height: 1.55;
  resize: vertical;
}
.tin::placeholder, .area::placeholder { color: var(--faint); font-style: italic; }
.tin:focus, .area:focus {
  border-color: rgba(240,145,58,.45);
  box-shadow: 0 0 0 3px rgba(240,145,58,.08);
}

/* heat / council toggles */
.toggle { display: flex; gap: 8px; flex-wrap: wrap; }
.togBtn, .togSel {
  flex: 1;
  min-width: 160px;
  border-radius: 10px;
  padding: 12px;
  cursor: pointer;
  font-family: 'Hanken Grotesk', sans-serif;
  font-weight: 600;
  font-size: 13px;
  border: 1px solid var(--line-2);
  background: var(--panel);
  color: var(--dim);
  transition: .16s;
}
.togSel {
  border-color: rgba(240,145,58,.45);
  background: linear-gradient(180deg,rgba(240,145,58,.1),var(--panel));
  color: var(--text);
}

/* primary action */
.primary {
  width: 100%;
  cursor: pointer;
  font-family: 'Hanken Grotesk', sans-serif;
  font-weight: 600;
  font-size: 14.5px;
  color: #1a0f08;
  background: linear-gradient(180deg,#f7b15a,#ec8a34);
  border: 1px solid #c9762a;
  border-radius: 12px;
  padding: 14px;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.5), 0 2px 0 #9c5a1e, 0 6px 16px -6px var(--glow);
  transition: .1s;
}
.primary:active { transform: translateY(2px); box-shadow: 0 0 0 #9c5a1e; }
.primary:disabled {
  opacity: .5;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

.err {
  color: var(--alert);
  font-size: 13px;
  margin: 0 0 14px;
}

@media (max-width: 720px) {
  .row { flex-direction: column; gap: 0; }
}
```

- [ ] **Step 4: Implement `Guided.tsx`**

`frontend/studio/src/routes/Guided.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useStore, type LibraryEntry, type BookManifest } from '@bookclaw/shared';
import { FormatPicker, EMPTY_FORMAT, formatFit, parseCustomStructure, type FormatValue, type StructureOpt, type FormOpt } from '../components/newbook/FormatPicker.js';
import { guidedCanCreate, buildGuidedCreatePayload, EMPTY_GUIDED_SEEDS, type GuidedSeeds } from '../lib/guidedSeeds.js';
import styles from './Guided.module.css';

export function Guided() {
  const navigate = useNavigate();
  const loadBooks = useStore((s) => s.loadBooks);

  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState<LibraryEntry[]>([]);
  const [voices, setVoices] = useState<LibraryEntry[]>([]);
  const [genres, setGenres] = useState<LibraryEntry[]>([]);
  const [author, setAuthor] = useState('');
  const [voice, setVoice] = useState('');
  const [genre, setGenre] = useState('');

  const [seeds, setSeeds] = useState<GuidedSeeds>(EMPTY_GUIDED_SEEDS);
  const [structuresOpts, setStructuresOpts] = useState<StructureOpt[]>([]);
  const [formsOpts, setFormsOpts] = useState<FormOpt[]>([]);
  const [format, setFormat] = useState<FormatValue>(EMPTY_FORMAT);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = (kind: string) =>
      api<{ entries: LibraryEntry[] }>(`/api/library/${kind}`).then((r) => r.entries ?? []).catch(() => []);
    load('author').then((e) => { setAuthors(e); setAuthor((a) => a || (e[0]?.name ?? '')); });
    load('voice').then((e) => { setVoices(e); setVoice((v) => v || (e[0]?.name ?? '')); });
    load('genre').then((e) => {
      setGenres(e);
      setGenre((g) => g || (e.find((x) => x.name === 'romance')?.name ?? ''));
    });
    api<{ structures: StructureOpt[] }>('/api/structures').then((r) => setStructuresOpts(r.structures ?? [])).catch(() => {});
    api<{ forms: FormOpt[] }>('/api/forms').then((r) => setFormsOpts(r.forms ?? [])).catch(() => {});
  }, []);

  const editSeed = <K extends keyof GuidedSeeds>(key: K, value: GuidedSeeds[K]) =>
    setSeeds((s) => ({ ...s, [key]: value }));

  const fit = formatFit(format, formsOpts);
  const canCreate = guidedCanCreate({ title, author, voice, formatOk: fit.ok, formatActive: fit.active }) && !creating;

  const create = async () => {
    setCreating(true); setError(null);
    try {
      const payload = buildGuidedCreatePayload({
        title, author, voice, genre, seeds,
        format: {
          structure: format.structure,
          ...(format.structure === 'custom' ? { customStructure: parseCustomStructure(format.customStructureText) } : {}),
          form: format.form,
          chapterCount: format.chapterCount,
          wordsPerChapter: format.wordsPerChapter,
        },
      });
      await api<{ book: BookManifest }>('/api/books', { method: 'POST', body: JSON.stringify(payload) });
      await loadBooks();
      navigate('/');
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.body}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <h1>Guided <em>romance</em> wizard</h1>
          <p>Fill in the shared seed contract — arc, characters, setting, heat and format — and BookClaw develops it into a full romance novel. No AI is called until you start the book.</p>
        </div>

        <div className={styles.idblock}>
          <div className={styles.fl}>Title</div>
          <input className={styles.tin} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name your book" />
        </div>
        <div className={styles.row}>
          <div className={styles.idblock}>
            <div className={styles.fl}>Author</div>
            <select className={styles.tin} value={author} onChange={(e) => setAuthor(e.target.value)}>
              {authors.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div className={styles.idblock}>
            <div className={styles.fl}>Voice</div>
            <select className={styles.tin} value={voice} onChange={(e) => setVoice(e.target.value)}>
              {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </div>
          <div className={styles.idblock}>
            <div className={styles.fl}>Genre</div>
            <select className={styles.tin} value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">— none —</option>
              {genres.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
            </select>
          </div>
        </div>

        <div className={styles.idblock}>
          <div className={styles.fl}>Heat</div>
          <div className={styles.toggle}>
            <button type="button" className={seeds.heat === 'sweet' ? styles.togSel : styles.togBtn}
              onClick={() => editSeed('heat', 'sweet')}>Sweet</button>
            <button type="button" className={seeds.heat === 'spicy' ? styles.togSel : styles.togBtn}
              onClick={() => editSeed('heat', 'spicy')}>Spicy</button>
          </div>
        </div>

        <div className={styles.idblock}>
          <div className={styles.fl}>Story arc</div>
          <textarea className={styles.area} rows={5} value={seeds.storyArc}
            onChange={(e) => editSeed('storyArc', e.target.value)}
            placeholder="A second-chance romance between a chef and the critic who once panned her restaurant." />
        </div>
        <div className={styles.idblock}>
          <div className={styles.fl}>Characters</div>
          <textarea className={styles.area} rows={6} value={seeds.characters}
            onChange={(e) => editSeed('characters', e.target.value)}
            placeholder="Names, ages, jobs, wounds, supporting cast." />
        </div>
        <div className={styles.idblock}>
          <div className={styles.fl}>Setting</div>
          <textarea className={styles.area} rows={6} value={seeds.setting}
            onChange={(e) => editSeed('setting', e.target.value)}
            placeholder="Place, season, sensory texture — real-world locations and businesses." />
        </div>

        <div className={styles.idblock}>
          <div className={styles.fl}>Council selection</div>
          <div className={styles.toggle}>
            <button type="button" className={seeds.councilSelection === 'auto' ? styles.togSel : styles.togBtn}
              onClick={() => editSeed('councilSelection', 'auto')}>Auto-select the best base story</button>
            <button type="button" className={seeds.councilSelection === 'propose' ? styles.togSel : styles.togBtn}
              onClick={() => editSeed('councilSelection', 'propose')}>Propose top ideas for me to pick</button>
          </div>
        </div>

        <FormatPicker structures={structuresOpts} forms={formsOpts} value={format} onChange={setFormat} />

        {error && <p className={styles.err}>Couldn't create — {error}</p>}
        <button className={styles.primary} onClick={create} disabled={!canCreate}>
          {creating ? 'Starting…' : 'Start Book'}
        </button>
        {!canCreate && !creating && (
          <p className={styles.hint}>Set a title, author, and voice, and pick a structure/form/chapter-count/words-per-chapter that fits, to start.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Register the route**

In `frontend/studio/src/main.tsx`: add the import next to `PremiseIntake`, and the route next to `premise`:

```ts
import { Guided } from './routes/Guided.js';
```

```tsx
          <Route path="guided" element={<Guided />} />
```

(Placed after the existing `<Route path="premise" element={<PremiseIntake />} />` line.)

- [ ] **Step 6: Run test to verify it passes**

```bash
npm run build:frontend
node --import tsx --test tests/unit/guided-bundle.test.ts
```
Expected: build succeeds; all three assertions PASS. Then `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/studio/src/routes/Guided.tsx frontend/studio/src/routes/Guided.module.css frontend/studio/src/main.tsx tests/unit/guided-bundle.test.ts
git commit -m "feat(studio): Guided wizard screen — deterministic romance seed form at /guided"
```

---

### Task 3: Wire the NewHub "Guided" card live + full verification

Flips the hub entry from disabled to live, then runs the complete verification sweep for this frontend-mostly feature.

**Files:**
- Modify: `frontend/studio/src/routes/NewHub.tsx`

**Interfaces:**
- Consumes: route `/guided` (Task 2).

- [ ] **Step 1: Flip the card**

In `frontend/studio/src/routes/NewHub.tsx`, in the `ADVANCED` array, change the Guided entry:

```ts
  { icon: '🧭', title: 'Guided', tag: 'A step-by-step form that collects the romance seeds (arc, characters, setting, heat) and builds the book.', to: '/guided' },
```

(Was `soon: true`; now `to: '/guided'`, matching the "From a premise file" entry's shape immediately above it. Tag text is unchanged — already accurate.)

- [ ] **Step 2: Full verification sweep**

```bash
npx tsc --noEmit
npm run build:frontend
node --import tsx --test tests/unit/guided-seeds.test.ts tests/unit/guided-bundle.test.ts tests/unit/studio-build.test.ts tests/unit/premise-intake-bundle.test.ts
```
Expected: `tsc` clean; build succeeds; all four test files PASS (the last two confirm the pre-existing studio build and premise-intake screen are unaffected).

- [ ] **Step 3: Manual verification (record result)**

Start the gateway (`npm run dev`), open the studio, New ▸ Advanced ▸ Guided. Confirm: the card is no longer "Coming soon" and navigates to `/guided`; author/voice default to the first library entry; Create stays disabled until title/author/voice are set and a structure+form+chapterCount+wordsPerChapter combination fits its word band; submitting creates a book whose `book.json` has `pipelineSequence: ['romance-sweet-full']` (or `-spicy-`) and a `seeds` block with `storyArc`/`characters`/`setting`/`councilSelection` populated.

- [ ] **Step 4: Commit**

```bash
git add frontend/studio/src/routes/NewHub.tsx
git commit -m "feat(studio): wire the Guided wizard live on the New hub"
```

---

### Task 4: Feature tracking

Move the "Sub-project 2 — Guided wizard" bullet from `docs/TODO.md` to `docs/COMPLETED.md`, per the repo's feature-tracking rule.

**Files:**
- Modify: `docs/TODO.md` (remove the Sub-project 2 bullet)
- Modify: `docs/COMPLETED.md` (add it, dated, under a new entry)

- [ ] **Step 1: Remove from TODO.md**

Delete this bullet from `docs/TODO.md` (currently under "## Romance Workflow — Foundation (sub-project 1) complete (2026-07-08)"):

```
- [ ] **Sub-project 2 — Guided wizard.** Deterministic seed-collection form (studio UI) that gathers the shared seed contract and creates a book on `romance-{sweet,spicy}-full`. Proves the seed contract end-to-end with the least machinery. Depends on Foundation (contract). **Hub card exists as "Coming soon" — wire it live when built.**
```

- [ ] **Step 2: Add to COMPLETED.md**

Add a new dated entry to `docs/COMPLETED.md` (immediately above or below the existing "Romance Workflow — Foundation (sub-project 1) complete" entry, matching its style):

```
## Romance Workflow — Guided wizard (sub-project 2) complete (2026-07-10)

Second slice of the Romance Workflow: a deterministic single-page studio form at `/guided` (`frontend/studio/src/routes/Guided.tsx`) that collects the shared seed contract — title/author/voice/genre, a sweet/spicy heat toggle, story-arc/characters/setting textareas, an auto/propose council-selection toggle, and the existing `FormatPicker` (structure+form+chapterCount+wordsPerChapter, the validated path) — then POSTs straight to the existing `POST /api/books` on `romance-sweet-full`/`romance-spicy-full`. No AI call, no new backend or MCP surface: every field it sends was already accepted and MCP-lockstepped by the Foundation sub-project. Pure heat/payload/gating logic lives in `frontend/studio/src/lib/guidedSeeds.ts` (`pipelineForHeat`, `guidedCanCreate`, `buildGuidedCreatePayload`), unit-tested directly (`tests/unit/guided-seeds.test.ts`) since it carries no CSS/React imports; the screen itself is covered by a build-then-grep bundle test (`tests/unit/guided-bundle.test.ts`), matching the pattern set by the premise-intake screen. The New hub's "Guided" card (`frontend/studio/src/routes/NewHub.tsx`) now routes live instead of showing "Coming soon". Spec: `docs/superpowers/specs/2026-07-08-romance-workflow-design.md`; plan: `docs/superpowers/plans/2026-07-10-romance-guided.md`. Remaining sub-projects (Council, Adaptive) tracked in TODO.md.
```

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md docs/COMPLETED.md
git commit -m "docs(romance): move Guided wizard (sub-project 2) to COMPLETED"
```

---

## Self-Review (completed against the spec)

- **Spec coverage:** Entry taxonomy (New ▸ Advanced ▸ Guided) → Task 3. Shared seed contract (`heat`, `storyArc`, `characters`, `setting`, `chapterCount`, `wordsPerChapter`, `councilSelection`) → Tasks 1-2 (no `blueprint`, no top-level `heat`, per Global Constraints). `councilSelection` collected but inert → Task 2 toggle, unchanged backend. Create-surface reuse (existing `POST /api/books`, no new fields) → Task 1's `buildGuidedCreatePayload` + Global Constraints note. FormatPicker validated path for chapter count → Task 2 Step 4 + `guidedCanCreate`'s `formatOk`/`formatActive` gate. Hub wiring → Task 3. Feature tracking → Task 4.
- **Placeholder scan:** none — every code/test step carries concrete, complete content (full component, full CSS, full test files).
- **Type consistency:** `Heat`/`CouncilSelection`/`GuidedSeeds`/`EMPTY_GUIDED_SEEDS`/`GuidedFormat`/`pipelineForHeat`/`guidedCanCreate`/`buildGuidedCreatePayload` are defined once in Task 1 and consumed unchanged in Task 2 (`Guided.tsx` imports exactly these names); `FormatValue`/`StructureOpt`/`FormOpt`/`EMPTY_FORMAT`/`formatFit`/`parseCustomStructure` are consumed unchanged from the existing `FormatPicker.tsx` (no redefinition). Route path `/guided` matches between Task 2's registration and Task 3's hub card `to`.
- **Open items deferred to implementation:** exact `id` values for `structure`/`form` in manual testing (Task 3 Step 3) depend on whatever `/api/structures` and `/api/forms` return at runtime — not hardcoded anywhere in this plan, so no risk of drift.
