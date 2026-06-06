# Book-Container Phase 1 — Library (read side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a read-only template **library** (`LibraryService` + built-in `library/` dir + read API) that enumerates and serves all book components — authors, genres, pipelines, sections, skills — from a built-in layer plus a user overlay, mirroring the existing `SkillLoader` pattern.

**Architecture:** A new `LibraryService` clones the `SkillLoader` built-in + workspace-overlay model across five template *kinds*. Built-in templates ship in a repo `library/` dir baked into the image; the user overlay lives at `workspace/library/`. The six static `PROJECT_TEMPLATES` are serialized to JSON via a pure exporter (with a drift-guard test); the dynamic `novel-pipeline` ships as a hand-authored descriptor marked `dynamic`. Per the owner's two scope decisions (2026-06-06): (a) **all** pipelines are extracted so they are selectable by a future "New Book" page, and (b) the global skills overlay is **folded into the library** — the user skill overlay relocates from `workspace/skills/` to `workspace/library/skills/` with a one-time boot migration. The library is **read-only** in Phase 1; the editor write-path re-point is Phase 4.

**Tech Stack:** TypeScript (NodeNext, `.js` import extensions), Express, `node --test` via `tsx`, esbuild (dashboard — untouched here), Docker multi-stage build.

**Source of truth for design:** `docs/BOOK-CONTAINER-ARCHITECTURE.md` (Phase 1 bullet + "Three resolution layers" + "Target data model"). This plan implements that Phase 1 bullet with the two owner decisions above.

---

## Scope and decisions

**In scope (Phase 1 — read side):**
- Built-in `library/` dir (authors, genres, pipelines, sections; skills stay baked at repo `skills/` "alongside" per the design doc).
- `LibraryService`: built-in + `workspace/library/` overlay, override-by-name, `source` tagging, `reload()`, `list()`/`get()` over five kinds.
- Pipeline-as-data: pure exporter serializing the 6 static templates → committed JSON, with a drift-guard test; `novel-pipeline.json` hand-authored descriptor (`dynamic: true`).
- Skills fold: relocate the user skill overlay to `workspace/library/skills/` + one-time boot migration; re-point `SkillLoader` and the authoring editor; `LibraryService` exposes skills as a kind by delegating to `SkillLoader`.
- Read API: `GET /api/library`, `GET /api/library/:kind`, `GET /api/library/:kind/:name`.
- Dockerfile: bake the `library/` dir.
- Tests: unit (overlay/override/reload/pipeline-parse + pipeline drift guard + migration), API (curl contract).

**Explicitly deferred (NOT this phase):**
- Book entity, `book.json`, snapshot-on-create, version gate → **Phase 2**.
- The **"New Book" page** with per-component selection (owner asked for this) → **Phase 2** (book creation UI). Tracked in Task 7.
- Per-book `SoulService`/`ProjectEngine` wiring; making the engine read `pipeline.json` and deleting the TS constants → **Phase 3** (this is also when full dynamic `novel-pipeline` data-expansion is designed).
- Editor write-path re-point (library vs book-copy edit scopes) + re-pull → **Phase 4**.
- Any dashboard UI for the library (read API only here).

**Known transient (acceptable, guarded):** until Phase 3, the 6 pipelines exist twice — as `PROJECT_TEMPLATES` (the live source the engine reads) and as committed `library/pipelines/*.json`. The exporter + drift-guard test (Task 1) keeps them identical; Phase 3 deletes the constants and makes the JSON canonical.

---

## File structure

**Create:**
- `gateway/src/services/library-types.ts` — shared `LibraryPipeline`/`LibraryPipelineStep` types + kind constants (separate module to avoid a `projects.ts` ⇄ `library.ts` import cycle).
- `gateway/src/services/library.ts` — `LibraryService`.
- `gateway/src/api/routes/library.routes.ts` — read API mounter.
- `scripts/gen-library-pipelines.ts` — regenerates `library/pipelines/*.json` from the exporter (repeatable; used again in Phase 3).
- `library/pipelines/{book-planning,book-bible,book-production,deep-revision,format-export,book-launch}.json` — generated, committed.
- `library/pipelines/novel-pipeline.json` — hand-authored descriptor (`dynamic: true`).
- `library/authors/default/{SOUL,STYLE-GUIDE,VOICE-PROFILE,PERSONALITY}.md` — minimal generic seed author.
- `library/genres/romantasy/{tropes,beats,reader-expectations,comps}.md` — one minimal seed genre.
- `library/sections/{front-matter,back-matter}.md` — two minimal seed sections.
- `tests/unit/library.test.ts` — overlay/override/reload/get tests.
- `tests/unit/library-pipelines.test.ts` — pipeline export drift guard.
- `tests/unit/skills-migration.test.ts` — boot-migration of the old skill overlay path.

**Modify:**
- `gateway/src/services/projects.ts` — add the exported `exportBuiltinPipelines()` (no behavior change to the engine).
- `gateway/src/init/phase-05-research-skills.ts` — re-point `SkillLoader` workspace overlay; run the one-time skill-overlay migration; construct `LibraryService`.
- `gateway/src/index.ts` — add `public library!: LibraryService` field + `getServices()` entry.
- `gateway/src/api/routes/authoring.routes.ts` — `wsSkillsDir` → `workspace/library/skills`.
- `gateway/src/api/routes.ts` — import + call `mountLibrary`.
- `docker/Dockerfile` — `COPY library ./library` (runtime stage).
- `tests/api/api-test.sh` — add library endpoint assertions.
- `docs/BOOK-CONTAINER-ARCHITECTURE.md` — mark Phase 1 done (on completion) + add the "New Book page" note to Phase 2.
- `docs/TODO.md` — add the "New Book page (component selection)" sub-item under the multi-author umbrella; on completion move the Phase 1 entry to `COMPLETED.md`.
- `CLAUDE.md` — "Stateful directories": add `workspace/library/` and note the skill overlay path move.

---

### Task 1: Pipeline-as-data — types, exporter, generated JSON, drift guard

**Files:**
- Create: `gateway/src/services/library-types.ts`
- Modify: `gateway/src/services/projects.ts` (add exporter near the other exports)
- Create: `scripts/gen-library-pipelines.ts`
- Create: `library/pipelines/*.json` (generated + one hand-authored)
- Test: `tests/unit/library-pipelines.test.ts`

- [ ] **Step 1: Create the shared types module**

`gateway/src/services/library-types.ts`:

```ts
/**
 * Shared types for the template library (book-container Phase 1). Kept separate
 * from both projects.ts and library.ts so the pipeline exporter in projects.ts
 * and the LibraryService can both import these without an import cycle.
 */

/** Library template kinds. `skill` is served via SkillLoader delegation. */
export const LIBRARY_KINDS = ['author', 'genre', 'pipeline', 'section', 'skill'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** Where a library entry came from. Mirrors SkillSource. */
export type LibrarySource = 'builtin' | 'workspace' | 'synthetic';

/** A single step in a data-driven pipeline (mirrors the static template step). */
export interface LibraryPipelineStep {
  label: string;
  skill?: string;
  toolSuggestion?: string;
  taskType: string;
  promptTemplate: string;
  phase?: string;
  wordCountTarget?: number;
  chapterNumber?: number;
}

/** A pipeline expressed as data (the eventual book `templates/pipeline.json`). */
export interface LibraryPipeline {
  schemaVersion: number;   // gate for the pipeline artifact (see arch doc)
  name: string;            // e.g. 'book-planning'
  label: string;
  description: string;
  dynamic?: boolean;       // true = steps are generated at create-time (novel-pipeline)
  steps: LibraryPipelineStep[];
}

export const PIPELINE_SCHEMA_VERSION = 1;
```

- [ ] **Step 2: Write the failing drift-guard test**

`tests/unit/library-pipelines.test.ts`:

```ts
/**
 * Drift guard: the committed built-in pipeline JSON must stay byte-identical to
 * what the exporter produces from the live PROJECT_TEMPLATES constants. Until
 * Phase 3 (when the engine reads the JSON and the constants are deleted) the two
 * representations coexist; this test fails if they drift. Regenerate with:
 *   node --import tsx scripts/gen-library-pipelines.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { exportBuiltinPipelines } from '../../gateway/src/services/projects.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('committed built-in pipeline JSON matches the exporter output', () => {
  for (const pipeline of exportBuiltinPipelines()) {
    const file = join(ROOT, 'library', 'pipelines', `${pipeline.name}.json`);
    const onDisk = JSON.parse(readFileSync(file, 'utf-8'));
    assert.deepEqual(onDisk, pipeline, `${pipeline.name}.json drifted from PROJECT_TEMPLATES — regenerate it`);
  }
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:unit 2>&1 | grep -A2 library-pipelines`
Expected: FAIL — `exportBuiltinPipelines` is not exported yet (import error).

- [ ] **Step 4: Add the exporter to `projects.ts`**

In `gateway/src/services/projects.ts`, add an import at the top (near the other imports) and the exported function immediately after the `PROJECT_TEMPLATES` constant block (after the closing `];` of `PROJECT_TEMPLATES`, around line ~1230):

```ts
// near the top, with the other imports:
import type { LibraryPipeline } from './library-types.js';
import { PIPELINE_SCHEMA_VERSION } from './library-types.js';

// ...immediately after the `PROJECT_TEMPLATES` array literal:

/**
 * Serialize the six built-in static project templates to the data-driven
 * pipeline shape (book-container Phase 1). The engine still reads
 * PROJECT_TEMPLATES directly today; Phase 3 flips that and deletes the constant.
 * `novel-pipeline` is generated dynamically (computed beat boundaries + one step
 * per chapter), so it is NOT exported here — it ships as a hand-authored
 * descriptor (`library/pipelines/novel-pipeline.json`, `dynamic: true`).
 */
export function exportBuiltinPipelines(): LibraryPipeline[] {
  return PROJECT_TEMPLATES.map((t) => ({
    schemaVersion: PIPELINE_SCHEMA_VERSION,
    name: t.type,
    label: t.label,
    description: t.description,
    steps: t.steps.map((s) => ({
      label: s.label,
      ...(s.skill ? { skill: s.skill } : {}),
      ...(s.toolSuggestion ? { toolSuggestion: s.toolSuggestion } : {}),
      taskType: s.taskType,
      promptTemplate: s.promptTemplate,
      ...(s.phase ? { phase: s.phase } : {}),
      ...(s.wordCountTarget ? { wordCountTarget: s.wordCountTarget } : {}),
      ...(s.chapterNumber ? { chapterNumber: s.chapterNumber } : {}),
    })),
  }));
}
```

- [ ] **Step 5: Write the generator script**

`scripts/gen-library-pipelines.ts`:

```ts
/**
 * Regenerate library/pipelines/*.json from the live PROJECT_TEMPLATES exporter.
 * Run: node --import tsx scripts/gen-library-pipelines.ts
 * The output is committed; tests/unit/library-pipelines.test.ts guards drift.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exportBuiltinPipelines } from '../gateway/src/services/projects.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'library', 'pipelines');
mkdirSync(outDir, { recursive: true });

for (const pipeline of exportBuiltinPipelines()) {
  const file = join(outDir, `${pipeline.name}.json`);
  writeFileSync(file, JSON.stringify(pipeline, null, 2) + '\n', 'utf-8');
  console.log(`wrote ${file} (${pipeline.steps.length} steps)`);
}
```

- [ ] **Step 6: Generate the six JSON files**

Run: `node --import tsx scripts/gen-library-pipelines.ts`
Expected: prints `wrote .../book-planning.json (6 steps)` and five more.

- [ ] **Step 7: Hand-author the dynamic novel-pipeline descriptor**

`library/pipelines/novel-pipeline.json` — a descriptor so the pipeline is listable/selectable; full data-expansion of its per-chapter steps is Phase 3. `steps: []` + `dynamic: true` documents that the engine still generates the steps:

```json
{
  "schemaVersion": 1,
  "name": "novel-pipeline",
  "label": "Full Novel Pipeline",
  "description": "End-to-end novel: premise, bible, outline, one step per chapter, revision, assembly. Chapters are generated from config at create-time.",
  "dynamic": true,
  "steps": []
}
```

- [ ] **Step 8: Run the drift-guard test to verify it passes**

Run: `npm run test:unit 2>&1 | grep -A2 library-pipelines`
Expected: PASS.

- [ ] **Step 9: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (no output).

- [ ] **Step 10: Commit**

```bash
git add gateway/src/services/library-types.ts gateway/src/services/projects.ts \
  scripts/gen-library-pipelines.ts library/pipelines tests/unit/library-pipelines.test.ts
git commit -F - <<'EOF'
feat(library): pipeline-as-data exporter + built-in pipeline JSON (Phase 1)

- library-types.ts: LibraryPipeline/Step + kinds + schemaVersion
- projects.ts: exportBuiltinPipelines() serializes the 6 static templates (engine still reads constants; Phase 3 flips it)
- library/pipelines/*.json generated + committed; novel-pipeline.json descriptor (dynamic)
- drift-guard unit test keeps JSON == constants until Phase 3
EOF
```

---

### Task 2: Seed built-in author / genre / section content

**Files:**
- Create: `library/authors/default/{SOUL,STYLE-GUIDE,VOICE-PROFILE,PERSONALITY}.md`
- Create: `library/genres/romantasy/{tropes,beats,reader-expectations,comps}.md`
- Create: `library/sections/{front-matter,back-matter}.md`

> Minimal but real seeds — enough to exercise every kind in `LibraryService` and the API. Genre/section *content* depth is explicitly content work, out of scope (arch doc "Out of scope"). The user adds more via the editor in Phase 4.

- [ ] **Step 1: Create the default author seed (4 files)**

`library/authors/default/SOUL.md`:

```markdown
# Author Soul — Default

You are a versatile, professional novelist. You write with clarity, momentum, and
emotional honesty. You serve the story and the reader above all. This is a neutral
starting identity — clone it in the library and shape it into a specific pen name.
```

`library/authors/default/STYLE-GUIDE.md`:

```markdown
# Style Guide — Default

- Prose: clear, active, concrete. Vary sentence length for rhythm.
- Show through action and sensory detail; tell only to compress time.
- Dialogue carries subtext; trim filler ("just", "very", "suddenly").
- Tense and POV: consistent within a scene.
```

`library/authors/default/VOICE-PROFILE.md`:

```markdown
# Voice Profile — Default

A confident, readable narrative voice with controlled interiority. Neither ornate
nor flat. Adaptable to genre — the genre profile sharpens it.
```

`library/authors/default/PERSONALITY.md`:

```markdown
# Personality — Default

Disciplined and reader-focused. Finishes scenes. Resists throat-clearing and
over-explaining. Treats every chapter as something a reader chose to spend time on.
```

- [ ] **Step 2: Create the romantasy genre seed (4 files)**

`library/genres/romantasy/tropes.md`:

```markdown
# Romantasy — Tropes

Fated mates / bonds, enemies-to-lovers, forbidden power, court intrigue, a
morally grey love interest, a chosen-one with a cost, slow-burn with high tension.
```

`library/genres/romantasy/beats.md`:

```markdown
# Romantasy — Beats

- Ordinary world with a magical fracture
- Meet the love interest under conflict
- Bargain / bond that ties protagonist to the world's stakes
- Midpoint intimacy + a betrayal or revelation
- Black moment: love and power in direct conflict
- Climax: the cost is paid; the bond is chosen freely
```

`library/genres/romantasy/reader-expectations.md`:

```markdown
# Romantasy — Reader Expectations

A satisfying romantic arc (HEA/HFN) AND a resolved fantasy stakes line. Heat level
set early and kept consistent. Worldbuilding that serves the romance, not the reverse.
```

`library/genres/romantasy/comps.md`:

```markdown
# Romantasy — Comparable Titles

Pointers only (placeholders): position against current bestselling romantasy. Fill
with live comps during book planning's market-analysis step.
```

- [ ] **Step 3: Create the two section seeds**

`library/sections/front-matter.md`:

```markdown
# Front Matter

- Title page
- Copyright page
- Dedication (optional)
- Also-by / series list (optional)
```

`library/sections/back-matter.md`:

```markdown
# Back Matter

- Acknowledgements
- About the author
- Newsletter / call-to-action
- Also-by list
```

- [ ] **Step 4: Verify the tree**

Run: `find library -type f | sort`
Expected: the 7 pipeline JSONs (from Task 1) + 4 author + 4 genre + 2 section markdown files.

- [ ] **Step 5: Commit**

```bash
git add library/authors library/genres library/sections
git commit -m "feat(library): seed built-in author/genre/section templates (Phase 1)"
```

---

### Task 3: `LibraryService` (built-in + overlay, kinds, reload)

**Files:**
- Create: `gateway/src/services/library.ts`
- Test: `tests/unit/library.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/unit/library.test.ts`:

```ts
/**
 * Unit tests for LibraryService's built-in + workspace overlay, override-by-name,
 * source tagging, reload(), and get() across kinds (book-container Phase 1).
 * Mirrors tests/unit/skill-loader.test.ts. Builds throwaway library trees on disk;
 * skills are exercised via an injected fake (LibraryService delegates skills to
 * SkillLoader, which is covered by its own test).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

// Minimal stand-in for the parts of SkillLoader that LibraryService calls.
const fakeSkills = {
  getSkillCatalog: () => [{ name: 'write', description: 'w', category: 'author', triggers: ['write'], premium: false, source: 'builtin' }],
  getSkillByName: (n: string) => (n === 'write' ? { name: 'write', description: 'w', category: 'author', triggers: ['write'], permissions: [], content: '# write', source: 'builtin' } : undefined),
} as never;

test('LibraryService overlays workspace over built-in and tags source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-library-'));
  try {
    const builtin = join(root, 'library');
    const workspace = join(root, 'workspace', 'library');
    write(builtin, 'genres/romantasy/tropes.md', 'BUILTIN tropes');
    write(builtin, 'pipelines/book-planning.json', JSON.stringify({ schemaVersion: 1, name: 'book-planning', label: 'BP', description: 'd', steps: [] }));
    write(workspace, 'genres/romantasy/tropes.md', 'WORKSPACE tropes'); // overrides built-in by name
    write(workspace, 'genres/scifi/tropes.md', 'new genre');            // new

    const lib = new LibraryService(builtin, workspace, fakeSkills);
    await lib.loadAll();

    const genres = lib.list('genre');
    const romantasy = genres.find((g) => g.name === 'romantasy');
    assert.equal(romantasy?.source, 'workspace', 'workspace genre should win');
    assert.ok(genres.some((g) => g.name === 'scifi' && g.source === 'workspace'));

    const pipelines = lib.list('pipeline');
    assert.ok(pipelines.some((p) => p.name === 'book-planning' && p.source === 'builtin'));

    // get() returns content; genre files are bundled.
    const got = lib.get('genre', 'romantasy');
    assert.equal(got?.source, 'workspace');
    assert.ok(JSON.stringify(got?.files).includes('WORKSPACE tropes'));

    // Skills delegate to the injected SkillLoader.
    assert.ok(lib.list('skill').some((s) => s.name === 'write'));
    assert.ok(lib.get('skill', 'write')?.content?.includes('# write'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('LibraryService reload() re-reads disk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-library-'));
  try {
    const builtin = join(root, 'library');
    write(builtin, 'sections/front-matter.md', 'v1');
    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
    await lib.loadAll();
    assert.ok(lib.get('section', 'front-matter')?.content?.includes('v1'));

    write(builtin, 'sections/front-matter.md', 'v2-edited');
    await lib.reload();
    assert.ok(lib.get('section', 'front-matter')?.content?.includes('v2-edited'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit 2>&1 | grep -A2 'library\.test'`
Expected: FAIL — cannot find module `library.js`.

- [ ] **Step 3: Implement `LibraryService`**

`gateway/src/services/library.ts`:

```ts
/**
 * BookClaw Library Service (book-container Phase 1, read side).
 *
 * A template library mirroring the SkillLoader built-in + workspace-overlay
 * model, across five kinds: author, genre, pipeline, section, skill.
 *   - built-in:   shipped repo `library/` dir, baked into the image (read-only)
 *   - workspace:  `workspace/library/`, user-editable, overrides built-ins by name
 *   - skill:      delegated to SkillLoader (single frontmatter parser, no dup)
 *
 * Phase 1 is READ-ONLY. The editor write-path re-point is Phase 4; book snapshots
 * are Phase 2. Author/genre/section entries are directories of markdown files;
 * pipelines are single JSON files; skills come from SkillLoader's catalog.
 */
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { LibraryKind, LibrarySource, LibraryPipeline } from './library-types.js';

/** Lightweight catalog row for list(). */
export interface LibraryEntry {
  kind: LibraryKind;
  name: string;
  source: LibrarySource;
  description?: string; // pipelines + skills carry one
}

/** Full read for get(): a multi-file kind bundles its files; others carry content. */
export interface LibraryEntryFull extends LibraryEntry {
  files?: Record<string, string>; // author/genre: filename -> content
  content?: string;               // section (md) / skill (SKILL.md)
  pipeline?: LibraryPipeline;     // pipeline: parsed JSON
}

/** Minimal surface of SkillLoader that LibraryService consumes. */
interface SkillCatalogLike {
  getSkillCatalog(): Array<{ name: string; description: string; source: LibrarySource }>;
  getSkillByName(name: string): { content: string; description: string; source: LibrarySource } | undefined;
}

/** Directory-backed kinds (the file kinds); skill is handled via delegation. */
const DIR_LAYOUT: Record<'author' | 'genre' | 'pipeline' | 'section', string> = {
  author: 'authors',
  genre: 'genres',
  pipeline: 'pipelines',
  section: 'sections',
};

export class LibraryService {
  private builtinDir: string;
  private workspaceDir: string;
  private skills: SkillCatalogLike;
  // kind -> (name -> full entry). Skills are not cached here (always live from SkillLoader).
  private entries: Map<'author' | 'genre' | 'pipeline' | 'section', Map<string, LibraryEntryFull>> = new Map();

  constructor(builtinDir: string, workspaceDir: string, skills: SkillCatalogLike) {
    this.builtinDir = builtinDir;
    this.workspaceDir = workspaceDir;
    this.skills = skills;
  }

  async loadAll(): Promise<void> {
    this.entries.clear();
    for (const kind of ['author', 'genre', 'pipeline', 'section'] as const) {
      const byName = new Map<string, LibraryEntryFull>();
      // built-in first, then workspace overlay overrides by name.
      await this.loadKind(kind, join(this.builtinDir, DIR_LAYOUT[kind]), 'builtin', byName);
      await this.loadKind(kind, join(this.workspaceDir, DIR_LAYOUT[kind]), 'workspace', byName);
      this.entries.set(kind, byName);
    }
  }

  /** Re-read all file-backed kinds from disk (skills reload via SkillLoader.reload()). */
  async reload(): Promise<void> {
    await this.loadAll();
  }

  private async loadKind(
    kind: 'author' | 'genre' | 'pipeline' | 'section',
    dir: string,
    source: LibrarySource,
    out: Map<string, LibraryEntryFull>,
  ): Promise<void> {
    if (!existsSync(dir)) return;
    const items = await readdir(dir, { withFileTypes: true });
    for (const item of items) {
      try {
        if (kind === 'pipeline') {
          if (!item.isFile() || !item.name.endsWith('.json')) continue;
          const raw = await readFile(join(dir, item.name), 'utf-8');
          const pipeline = JSON.parse(raw) as LibraryPipeline;
          const name = item.name.replace(/\.json$/, '');
          out.set(name, { kind, name, source, description: pipeline.description, pipeline });
        } else if (kind === 'section') {
          if (!item.isFile() || !item.name.endsWith('.md')) continue;
          const content = await readFile(join(dir, item.name), 'utf-8');
          const name = item.name.replace(/\.md$/, '');
          out.set(name, { kind, name, source, content });
        } else {
          // author / genre: a directory of markdown files.
          if (!item.isDirectory()) continue;
          const sub = await readdir(join(dir, item.name), { withFileTypes: true });
          const files: Record<string, string> = {};
          for (const f of sub) {
            if (f.isFile() && f.name.endsWith('.md')) {
              files[f.name] = await readFile(join(dir, item.name, f.name), 'utf-8');
            }
          }
          out.set(item.name, { kind, name: item.name, source, files });
        }
      } catch (err) {
        console.error(`  ⚠ Library: failed to load ${kind}/${item.name}`, err);
      }
    }
  }

  /** Catalog rows for one kind, or all kinds when kind is omitted. */
  list(kind?: LibraryKind): LibraryEntry[] {
    if (kind === 'skill') return this.listSkills();
    if (kind) {
      if (kind === 'author' || kind === 'genre' || kind === 'pipeline' || kind === 'section') {
        return Array.from(this.entries.get(kind)?.values() ?? []).map(this.toRow);
      }
      return [];
    }
    const all: LibraryEntry[] = [];
    for (const k of ['author', 'genre', 'pipeline', 'section'] as const) {
      all.push(...Array.from(this.entries.get(k)?.values() ?? []).map(this.toRow));
    }
    all.push(...this.listSkills());
    return all;
  }

  /** Full read of one entry. */
  get(kind: LibraryKind, name: string): LibraryEntryFull | undefined {
    if (kind === 'skill') {
      const s = this.skills.getSkillByName(name);
      return s ? { kind: 'skill', name, source: s.source, description: s.description, content: s.content } : undefined;
    }
    if (kind === 'author' || kind === 'genre' || kind === 'pipeline' || kind === 'section') {
      return this.entries.get(kind)?.get(name);
    }
    return undefined;
  }

  getLoadedCount(): number {
    let n = 0;
    for (const byName of this.entries.values()) n += byName.size;
    return n + this.skills.getSkillCatalog().length;
  }

  private listSkills(): LibraryEntry[] {
    return this.skills.getSkillCatalog().map((s) => ({
      kind: 'skill' as const, name: s.name, source: s.source, description: s.description,
    }));
  }

  private toRow(e: LibraryEntryFull): LibraryEntry {
    return { kind: e.kind, name: e.name, source: e.source, description: e.description };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:unit 2>&1 | grep -A2 'library\.test'`
Expected: PASS (both tests).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/services/library.ts tests/unit/library.test.ts
git commit -m "feat(library): LibraryService — built-in + workspace overlay, 5 kinds, reload (Phase 1)"
```

---

### Task 4: Fold the skills overlay into the library (relocate + boot migration)

**Files:**
- Modify: `gateway/src/api/routes/authoring.routes.ts:20` (`wsSkillsDir`)
- Modify: `gateway/src/init/phase-05-research-skills.ts` (SkillLoader overlay path + migration call)
- Test: `tests/unit/skills-migration.test.ts`

> "Fold into library now" (owner decision). Minimal, correct interpretation: built-in skills **stay** at repo `skills/` (the design doc bakes the library "alongside the existing built-in `skills/`"; moving the whole tree would churn premium gitignore + Dockerfile + SKILLS.txt for no Phase-1 gain). Only the **user overlay** relocates: `workspace/skills/` → `workspace/library/skills/`, with a one-time boot migration so already-deployed edits survive.

- [ ] **Step 1: Write the failing migration test**

`tests/unit/skills-migration.test.ts`:

```ts
/**
 * Boot migration: the user skill overlay moved from workspace/skills/ to
 * workspace/library/skills/ when skills were folded into the library
 * (book-container Phase 1). migrateSkillOverlay() moves the old dir once,
 * fail-soft, and never clobbers an existing new dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateSkillOverlay } from '../../gateway/src/init/phase-05-research-skills.js';

test('migrateSkillOverlay moves the legacy overlay once', () => {
  const ws = mkdtempSync(join(tmpdir(), 'bookclaw-mig-'));
  try {
    const old = join(ws, 'skills', 'author', 'mine');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'SKILL.md'), '---\ndescription: x\ntriggers:\n  - x\n---\n# mine\n');

    migrateSkillOverlay(ws);

    assert.ok(!existsSync(join(ws, 'skills')), 'old overlay should be gone');
    const moved = join(ws, 'library', 'skills', 'author', 'mine', 'SKILL.md');
    assert.ok(existsSync(moved), 'overlay should be under library/skills now');
    assert.ok(readFileSync(moved, 'utf-8').includes('# mine'));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test('migrateSkillOverlay is a no-op when the new dir already exists', () => {
  const ws = mkdtempSync(join(tmpdir(), 'bookclaw-mig-'));
  try {
    mkdirSync(join(ws, 'skills', 'core', 'a'), { recursive: true });
    mkdirSync(join(ws, 'library', 'skills'), { recursive: true });
    migrateSkillOverlay(ws); // must not throw, must not overwrite
    assert.ok(existsSync(join(ws, 'skills')), 'old dir left untouched when new exists');
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit 2>&1 | grep -A2 skills-migration`
Expected: FAIL — `migrateSkillOverlay` not exported.

- [ ] **Step 3: Add `migrateSkillOverlay` + re-point the overlay in phase-05**

In `gateway/src/init/phase-05-research-skills.ts`, add imports and the helper, and change the `SkillLoader` construction:

```ts
// add to the imports at the top:
import { renameSync, existsSync as fsExistsSync } from 'fs';

/**
 * One-time migration: the user skill overlay moved from workspace/skills/ to
 * workspace/library/skills/ when skills were folded into the template library
 * (book-container Phase 1). Move the legacy dir once; never clobber the new one.
 * Fail-soft: a migration error must not block startup.
 */
export function migrateSkillOverlay(workspaceDir: string): void {
  const oldDir = join(workspaceDir, 'skills');
  const newDir = join(workspaceDir, 'library', 'skills');
  if (!fsExistsSync(oldDir) || fsExistsSync(newDir)) return;
  try {
    renameSync(oldDir, newDir);
    console.log('  ✓ Migrated skill overlay workspace/skills → workspace/library/skills');
  } catch (err) {
    console.warn(`  ⚠ Skill-overlay migration skipped: ${(err as Error)?.message || err}`);
  }
}
```

Then change the `SkillLoader` construction line (currently `loader.ts` overlay at `workspace/skills`):

```ts
// before:
//   gw.skills = new SkillLoader(join(ROOT_DIR, 'skills'), gw.permissions, join(ROOT_DIR, 'workspace', 'skills'));
// after:
  migrateSkillOverlay(join(ROOT_DIR, 'workspace'));
  gw.skills = new SkillLoader(join(ROOT_DIR, 'skills'), gw.permissions, join(ROOT_DIR, 'workspace', 'library', 'skills'));
  await gw.skills.loadAll();
```

- [ ] **Step 4: Re-point the authoring editor write path**

In `gateway/src/api/routes/authoring.routes.ts`, change line 20:

```ts
// before:
//   const wsSkillsDir = join(baseDir, 'workspace', 'skills');
// after:
  const wsSkillsDir = join(baseDir, 'workspace', 'library', 'skills');
```

- [ ] **Step 5: Run the migration test to verify it passes**

Run: `npm run test:unit 2>&1 | grep -A2 skills-migration`
Expected: PASS (both tests).

- [ ] **Step 6: Verify the auth/skill editor still works end-to-end**

Run: `npm run test:api && npm run test:smoke`
Expected: both green (the API suite exercises the gateway boot through phase-05, including the new overlay path; the smoke suite asserts auth + dashboard injection).

- [ ] **Step 7: Type-check and commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add gateway/src/init/phase-05-research-skills.ts gateway/src/api/routes/authoring.routes.ts \
  tests/unit/skills-migration.test.ts
git commit -m "feat(library): fold skill overlay into workspace/library/skills + one-time boot migration (Phase 1)"
```

---

### Task 5: Wire `LibraryService` into init + `getServices()`

**Files:**
- Modify: `gateway/src/init/phase-05-research-skills.ts` (construct `gw.library`)
- Modify: `gateway/src/index.ts` (field + getServices entry)

- [ ] **Step 1: Add the field declaration in `index.ts`**

Near the other service fields (e.g. just after `public skills!: SkillLoader;` at `index.ts:160`):

```ts
  public library!: LibraryService;
```

And add the import near the `SkillLoader` import (`index.ts:36`):

```ts
import { LibraryService } from './services/library.js';
```

- [ ] **Step 2: Add the `getServices()` entry**

In the `getServices()` return object (`index.ts:947`+), add after `skills: this.skills,`:

```ts
      library: this.library,
```

- [ ] **Step 3: Construct it in phase-05 (after SkillLoader is loaded)**

In `gateway/src/init/phase-05-research-skills.ts`, add the import and, immediately after the `gw.skills` load + log line (before Phase 6a), construct the library:

```ts
// import at top:
import { LibraryService } from '../services/library.js';

// after the `✓ Skills: …` console.log:
  gw.library = new LibraryService(
    join(ROOT_DIR, 'library'),
    join(ROOT_DIR, 'workspace', 'library'),
    gw.skills,
  );
  await gw.library.loadAll();
  console.log(`  ✓ Library: ${gw.library.getLoadedCount()} templates (authors/genres/pipelines/sections + skills)`);
```

- [ ] **Step 4: Boot the gateway to confirm the log line appears**

Run: `npm run test:smoke -v 2>&1 | grep -i 'Library:'`
Expected: a line like `✓ Library: N templates (authors/genres/pipelines/sections + skills)`.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add gateway/src/index.ts gateway/src/init/phase-05-research-skills.ts
git commit -m "feat(library): construct LibraryService in init + expose via getServices (Phase 1)"
```

---

### Task 6: Library read API + Dockerfile bake + API tests

**Files:**
- Create: `gateway/src/api/routes/library.routes.ts`
- Modify: `gateway/src/api/routes.ts` (import + mount)
- Modify: `docker/Dockerfile` (COPY library)
- Test: `tests/api/api-test.sh`

- [ ] **Step 1: Implement the read API mounter**

`gateway/src/api/routes/library.routes.ts`:

```ts
import { Application, Request, Response } from 'express';
import { LIBRARY_KINDS, type LibraryKind } from '../../services/library-types.js';

/**
 * Library read API (book-container Phase 1). Read-only: lists and serves the
 * resolved built-in + workspace-overlay templates. The write/edit path (editor
 * re-point, two edit scopes, re-pull) is Phase 4; book snapshots are Phase 2.
 * Sits behind the same bearer-auth + IP allowlist as the rest of /api/*.
 */
export function mountLibrary(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  function isKind(v: string): v is LibraryKind {
    return (LIBRARY_KINDS as readonly string[]).includes(v);
  }

  // All entries across kinds (or ?kind=genre to filter), catalog rows only.
  app.get('/api/library', (req: Request, res: Response) => {
    const kind = req.query.kind ? String(req.query.kind) : undefined;
    if (kind && !isKind(kind)) {
      return res.status(400).json({ error: `Unknown kind. One of: ${LIBRARY_KINDS.join(', ')}` });
    }
    res.json({ kinds: LIBRARY_KINDS, entries: services.library.list(kind as LibraryKind | undefined) });
  });

  // Entries of one kind.
  app.get('/api/library/:kind', (req: Request, res: Response) => {
    const kind = String(req.params.kind);
    if (!isKind(kind)) {
      return res.status(400).json({ error: `Unknown kind. One of: ${LIBRARY_KINDS.join(', ')}` });
    }
    res.json({ kind, entries: services.library.list(kind) });
  });

  // Full content of one entry.
  app.get('/api/library/:kind/:name', (req: Request, res: Response) => {
    const kind = String(req.params.kind);
    if (!isKind(kind)) {
      return res.status(400).json({ error: `Unknown kind. One of: ${LIBRARY_KINDS.join(', ')}` });
    }
    const entry = services.library.get(kind, String(req.params.name));
    if (!entry) return res.status(404).json({ error: 'Template not found' });
    res.json({ entry });
  });
}
```

> Path-traversal note: `get()` only matches names already loaded into the in-memory map (or SkillLoader's catalog) — it never resolves `:name` to a filesystem path — so no `safePath` guard is needed on these read routes. Add `safePath` in Phase 4 when the editor introduces writes.

- [ ] **Step 2: Mount it in `routes.ts`**

In `gateway/src/api/routes.ts`, add the import alongside the others (after the `mountAuthoring` import, line ~25):

```ts
import { mountLibrary } from './routes/library.routes.js';
```

and the call alongside the others (after `mountAuthoring(app, gateway, baseDir);`, line ~61):

```ts
  mountLibrary(app, gateway, baseDir);
```

- [ ] **Step 3: Bake the built-in library into the image**

In `docker/Dockerfile`, in the runtime stage where assets are copied (after `COPY skills ./skills`, line ~46):

```dockerfile
COPY library ./library
```

- [ ] **Step 4: Add API contract assertions**

Append to `tests/api/api-test.sh` (follow the file's existing `check`/`curl` helper style — read the top of the file first and reuse its assertion helper and `$TOKEN`/`$BASE` variables). Add checks:

```bash
# ── Library (book-container Phase 1, read side) ──
# GET /api/library lists kinds and includes a pipeline + a skill row
check "GET /api/library returns kinds" \
  "$(curl -s -H "$AUTH" "$BASE/api/library" | grep -c '"pipeline"')" "ge" 1
check "GET /api/library/pipeline lists book-planning" \
  "$(curl -s -H "$AUTH" "$BASE/api/library/pipeline" | grep -c 'book-planning')" "ge" 1
check "GET a pipeline returns its steps array" \
  "$(curl -s -H "$AUTH" "$BASE/api/library/pipeline/book-planning" | grep -c '"steps"')" "ge" 1
check "GET unknown kind -> 400" \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" "$BASE/api/library/nope")" "eq" 400
check "GET unknown pipeline name -> 404" \
  "$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" "$BASE/api/library/pipeline/no-such")" "eq" 404
```

(Adapt the helper invocation to the actual `check`/assertion function in `tests/api/api-test.sh` — match its exact signature; the comparisons needed are "contains/count ≥ 1" and "status == 400/404".)

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: green — unit (now includes library + pipeline-drift + migration), api (now includes library), smoke.

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add gateway/src/api/routes/library.routes.ts gateway/src/api/routes.ts docker/Dockerfile tests/api/api-test.sh
git commit -m "feat(library): read API (GET /api/library[/:kind[/:name]]) + bake library/ into image (Phase 1)"
```

---

### Task 7: Docs + tracking + Mercury deploy

**Files:**
- Modify: `CLAUDE.md` (Stateful directories)
- Modify: `docs/BOOK-CONTAINER-ARCHITECTURE.md` (Phase 1 status + New-Book note on Phase 2)
- Modify: `docs/TODO.md` + `docs/COMPLETED.md`

- [ ] **Step 1: Update `CLAUDE.md` stateful-directories list**

In the "Stateful directories" section, add a bullet for the library and note the skill-overlay move:

```markdown
- `workspace/library/` — user template overlay (authors/genres/pipelines/sections/skills) that overrides the built-in `library/` by name; read by `LibraryService`. The user **skills** overlay moved here from `workspace/skills/` (book-container Phase 1; one-time boot migration in `init/phase-05`).
```

And in "Skills + Projects", update the skills overlay path reference (`workspace/skills/` → `workspace/library/skills/`).

- [ ] **Step 2: Update the architecture doc**

In `docs/BOOK-CONTAINER-ARCHITECTURE.md`:
- Mark the **Phase 1** bullet as implemented (mirror the Phase 0 "*(Implemented + deployed …)*" style with today's date once deployed).
- Resolve "collides with" item #3 ("decide during Phase 1"): record the decision — built-in skills stay at `skills/`; the user overlay folded into `workspace/library/skills/`.
- Under **Phase 2**, add: "**New Book page** — a creation UI that lists library components (per kind) and lets the author select which to pull into the new book; default = pull all. (Owner ask, 2026-06-06.)"

- [ ] **Step 3: Track the New-Book page in TODO and close Phase 1**

In `docs/TODO.md`, under the multi-author umbrella item, add a sub-bullet:

```markdown
  - **New Book page (component selection).** A book-creation UI listing library components per kind (author/genre/pipeline/sections/skills) with per-component include toggles; default pulls all. Lands with the Phase 2 book entity + snapshot-on-create. (Owner ask 2026-06-06.)
```

Then move the Phase 1 work into `docs/COMPLETED.md` with today's date (`2026-06-06`), preserving the original bullet text and summarizing what shipped (per the project's COMPLETED.md convention).

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md docs/BOOK-CONTAINER-ARCHITECTURE.md docs/TODO.md docs/COMPLETED.md
git commit -m "docs: book-container Phase 1 (library read side) — status, decisions, New-Book Phase 2 note"
```

- [ ] **Step 5: Deploy to Mercury and verify**

Per the project's deploy automation (sentinel trigger): from the repo on the NFS-exported tree:

```bash
touch build_now
```

Then poll (≈1 min): `ssh mercury cat /home/paul/.../.build-logs/last-build.status` → expect `result=PASS`. Verify the new endpoint live (auth required):

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://192.168.1.32:3847/api/library/pipeline | grep -c book-planning   # ≥1
```

Expected: container `Up (healthy)`, `/api/library` reachable with a bearer token (401 without), library entries present.

---

## Self-review

**1. Spec coverage** (against the Phase 1 bullet + owner decisions):
- "Built-in library dir" → Tasks 1–2 (`library/` baked in Task 6). ✓
- "`LibraryService` with built-in + user overlay and `reload()`" → Task 3. ✓
- "Define template kinds (author, genre, pipeline, section)" → `LIBRARY_KINDS` in Task 1; skill added per owner decision (Task 4). ✓
- "API to list/read library templates" → Task 6. ✓
- "Verify: unit test override-by-name; API lists templates" → Task 3 test (override-by-name) + Task 6 API checks. ✓
- Owner decision (a) all pipelines selectable → all 6 exported + novel-pipeline descriptor (Task 1). ✓
- Owner decision (b) fold skills overlay → Task 4. ✓
- "collides with" #3 resolved (decision recorded) → Task 7 Step 2. ✓
- "collides with" #5 (safePath on new roots) → not needed for read-only name-keyed lookups; noted as Phase 4 work (Task 6 Step 1 note). ✓

**2. Placeholder scan:** the Task 6 Step 4 API test deliberately says "adapt to the actual `check` helper" because the helper's exact signature must be read from the file at execution time — this is an integration instruction, not a code placeholder. Every code file (library-types, library, library.routes, exporter, generator, all tests, the migration helper) is complete. ✓

**3. Type consistency:** `LibraryEntry`/`LibraryEntryFull`/`LibrarySource`/`LibraryKind`/`LibraryPipeline` names are used identically across `library-types.ts`, `library.ts`, `library.routes.ts`, and the tests. `LibraryService` constructor `(builtinDir, workspaceDir, skills)` matches all three call sites (init Task 5, both unit tests Task 3). `exportBuiltinPipelines()` signature matches its test (Task 1) and generator (Task 1). `migrateSkillOverlay(workspaceDir)` matches its test (Task 4) and caller (Task 4). ✓

**Risk notes for the executor:**
- The 6 pipelines exist twice until Phase 3 — the drift-guard test is the safety net; if you edit a template prompt in `projects.ts`, re-run `node --import tsx scripts/gen-library-pipelines.ts` and commit the regenerated JSON.
- Task 4 touches a feature accepted only yesterday (the authoring editor). Keep the migration fail-soft and confirm `npm run test:api` (which boots through phase-05) stays green before committing.
