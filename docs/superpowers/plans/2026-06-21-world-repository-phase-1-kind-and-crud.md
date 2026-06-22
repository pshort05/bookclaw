# World Repository Phase 1 — `world` Kind + Document CRUD Implementation Plan

> **For agentic workers:** Execute this plan task-by-task via `superpowers:subagent-driven-development` (or `superpowers:executing-plans`). Every type name, signature, file path, and storage path is pinned by the shared contract `docs/superpowers/plans/2026-06-21-world-repository-00-index-and-contract.md`. If you need a name not defined there, that is a contract gap — stop and reconcile, do not invent a divergent name. Each task ends at a verified state (its tests green + `npx tsc --noEmit` clean).

**Goal.** Add a `world` library kind with its `world.json` config parser, a markdown-document frontmatter parser/serializer, classification-code auto-assignment, a `WorldService` for documents CRUD, and a `worlds.routes.ts` document API — so an operator can create a world config and add/read/update/delete its documents with serials auto-classified.

**Architecture.** `world` registers as a new file-backed library kind whose entry is a `world.json` config (parsed into `LibraryEntryFull.world`) plus a `documents/` subdir owned entirely by `WorldService`, layered over the same built-in (`library/worlds/`) + workspace overlay (`workspace/library/worlds/`) model as every other kind. The config parser mirrors `parsePipelineJson`/`parseEditor`; the document parser is a hand-rolled frontmatter reader extended for inline `tags: [a, b]` arrays following `skills/loader.ts:182`. `WorldService` reads config through `LibraryService` and writes documents directly to the workspace overlay; `worlds.routes.ts` exposes the documents endpoints through `gateway.getServices().world`.

**Tech Stack.** Node 22+, TypeScript via `tsx` (no dev compile), Express, `node:test` + `node:assert/strict` unit tests run by `node --import tsx --test`. No new runtime dependency.

## Global Constraints

(Copied verbatim from the shared contract — apply to every task.)

- **Node 22+**; TypeScript runs through `tsx` (no compile step in dev). Type-check with `npx tsc --noEmit`.
- **Imports use `.js` extensions** even from `.ts` source (NodeNext). Match this in every new file.
- **No new runtime dependency** for parsing. Frontmatter is hand-parsed in-repo (see `gateway/src/skills/loader.ts:182`); the world-doc parser follows that line-based idiom, extended for inline `tags: [a, b]` arrays. Do not add `js-yaml`/`gray-matter`.
- **Fail-soft init/runtime.** Services log `  ✓ … / ⚠ … / ℹ …` and degrade rather than crash (matches `index.ts` and `BookService`). A bad `world.json` or bad document frontmatter loads as "needs attention", never throws at boot.
- **`schemaVersion` gating.** `world.json` and each document carry a `schemaVersion`; `WORLD_SCHEMA_VERSION = 1`. Too-new → read-only/quarantine, mirroring `classifyVersion` in `book-types.ts`. Additive optional fields on `book.json` do **not** bump its schema.
- **Commit workflow.** This repo uses a `commit_message` + `./push.sh` workflow — the maintainer commits; **do not run `git commit` / `git push`**. Each task ends at a verified, type-checking state (tests green + `npx tsc --noEmit` clean). At milestone end, write the one-line-summary-plus-dashes `commit_message` per `CLAUDE.md`. (This overrides the writing-plans skill's literal `git commit` step, per user-instruction priority.)
- **Surgical changes.** Touch only what the task requires; match existing style.
- **Docs are professional Markdown, no emojis/icons.**
- **Tests are committed and re-runnable.** Unit tests: `tests/unit/*.test.ts` via `node --import tsx --test` (`npm run test:unit`). Smoke tests: `tests/*.sh`. The CLAUDE.md "no unit-test suite" line is stale.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `gateway/src/services/world-types.ts` | Create | `WORLD_SCHEMA_VERSION`, `WorldDocumentType`, `LibraryWorld`, `WorldDocMeta`, `WorldDocument`, `WorldDocCatalogRow`. |
| `gateway/src/services/library-types.ts` | Modify | Add `'world'` to `LIBRARY_KINDS`. |
| `frontend/shared/src/types.ts` | Modify | Add `'world'` to the frontend `LibraryKind` union. |
| `gateway/src/services/library.ts` | Modify | Add `world: 'worlds'` to `FILE_KINDS`/`DIR_LAYOUT`; `world?: LibraryWorld` on `LibraryEntryFull`; parse `world.json` in `loadKind` + overlay path. |
| `gateway/src/services/world-parse.ts` | Create | `parseWorldJson`, `parseWorldDoc`, `serializeWorldDoc`, `nextClassification`. |
| `gateway/src/services/world.ts` | Create | `WorldService` — config + documents CRUD + auto-classify, reading config via `LibraryService`, writing docs to the workspace overlay. |
| `gateway/src/api/routes/worlds.routes.ts` | Create | `mountWorlds` — the documents REST endpoints. |
| `gateway/src/api/routes.ts` | Modify | Import + call `mountWorlds(app, gateway, baseDir)`. |
| `gateway/src/index.ts` | Modify | Declare `public world?: WorldService;` and expose it in `getServices()`. |
| `gateway/src/init/phase-05-research-skills.ts` | Modify | Instantiate `WorldService` after the library loads. |
| `tests/unit/world-types.test.ts` | Create | Assert `'world'` is registered in `LIBRARY_KINDS`. |
| `tests/unit/world-parse.test.ts` | Create | Unit-test all four parser functions. |
| `tests/unit/world-service.test.ts` | Create | Unit-test `WorldService` CRUD + auto-classify against a temp library dir. |
| `tests/world-crud-smoke.sh` | Create | Boot-and-assert the world documents API end-to-end. |

---

### Task 1: Register the `world` kind + shared types

**Files**
- Create `gateway/src/services/world-types.ts`
- Modify `gateway/src/services/library-types.ts:8` (`LIBRARY_KINDS`)
- Modify `frontend/shared/src/types.ts:153` (frontend `LibraryKind`)
- Modify `gateway/src/services/library.ts:34` (`LibraryEntryFull`), `:52` (`FILE_KINDS`), `:56` (`DIR_LAYOUT`), `:111` (`overlayPath`), and `loadKind` (~`:262`)
- Create `tests/unit/world-types.test.ts`

**Interfaces**
- Produces: the shared types from the contract (`WORLD_SCHEMA_VERSION`, `WorldDocumentType`, `LibraryWorld`, `WorldDocMeta`, `WorldDocument`, `WorldDocCatalogRow`).
- Produces: `LibraryKind` now includes `'world'` (backend + frontend); `LibraryEntryFull` gains `world?: LibraryWorld`.

- [ ] **Step 1: Write the failing kind-registration test.**
  Create `tests/unit/world-types.test.ts`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { LIBRARY_KINDS } from '../../gateway/src/services/library-types.js';
  import { WORLD_SCHEMA_VERSION } from '../../gateway/src/services/world-types.js';

  test("'world' is a registered library kind", () => {
    assert.ok(LIBRARY_KINDS.includes('world' as never), "LIBRARY_KINDS must include 'world'");
  });

  test('WORLD_SCHEMA_VERSION is 1', () => {
    assert.equal(WORLD_SCHEMA_VERSION, 1);
  });
  ```

- [ ] **Step 2: Run it, expect FAIL.**
  Command: `node --import tsx --test tests/unit/world-types.test.ts`
  Expected: failure resolving the import — `Cannot find module '.../gateway/src/services/world-types.js'` (the file does not exist yet).

- [ ] **Step 3: Create `gateway/src/services/world-types.ts`.**
  ```ts
  /**
   * Shared types for the World Repository library kind (World Repository Phase 1).
   * Kept separate from world.ts / world-parse.ts so the parser, the service, and
   * the library overlay can all import them without an import cycle.
   */

  export const WORLD_SCHEMA_VERSION = 1;

  export interface WorldDocumentType {
    id: string;        // e.g. "field-guide" — referenced by document.type
    label: string;     // e.g. "Field Guide"
    note?: string;     // e.g. "practical"
  }

  /** Per-world config, parsed from worlds/<name>/world.json. */
  export interface LibraryWorld {
    schemaVersion: number;
    name: string;                 // dir name; matches ENTRY_NAME_RE
    label?: string;
    description?: string;
    documentTypes: WorldDocumentType[];
    domains: string[];            // e.g. ["GEO","MAG",...]
    clearanceLevels: string[];    // e.g. ["General Access","Restricted","Cloister-Only"]
    classificationScheme: string; // e.g. "{TYPE}-{DOMAIN}-{NNNN}"
    formatDirective: string;      // narrative-only authoring directive
    authoringEditor?: string;     // library editor name (Phase 4)
    stripCodesInAppendix?: boolean; // Phase 5 render setting; default true
  }

  /** Universal base fields parsed from a document's YAML frontmatter. */
  export interface WorldDocMeta {
    title: string;
    type: string;            // must be one of LibraryWorld.documentTypes[].id
    classification: string;  // e.g. "FG-GEO-0141"
    clearance: string;       // should be one of LibraryWorld.clearanceLevels
    domain: string;          // should be one of LibraryWorld.domains
    attribution?: string;
    tags: string[];
    summary: string;
    appendixEligible?: boolean;
  }

  /** A full document = frontmatter + narrative body, plus its file-stem id. */
  export interface WorldDocument {
    docId: string;   // filename stem under documents/, e.g. "fg-geo-0141-geography-…"
    meta: WorldDocMeta;
    body: string;    // markdown after the closing frontmatter fence
  }

  /** Catalog row used by relevance-pull and the UI (no body — cheap). */
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
    needsAttention?: boolean; // set when frontmatter failed to parse cleanly
  }
  ```

- [ ] **Step 4: Register `'world'` in `LIBRARY_KINDS`** (`gateway/src/services/library-types.ts:8`).
  ```ts
  export const LIBRARY_KINDS = ['author', 'voice', 'genre', 'pipeline', 'sequence', 'editor', 'prompt', 'section', 'skill', 'world'] as const;
  ```

- [ ] **Step 5: Register `'world'` in the frontend `LibraryKind`** (`frontend/shared/src/types.ts:153`).
  ```ts
  export type LibraryKind = 'author' | 'voice' | 'genre' | 'pipeline' | 'section' | 'skill' | 'sequence' | 'editor' | 'prompt' | 'world';
  ```

- [ ] **Step 6: Wire `world` into `library.ts`.**
  6a. Add the import at the top of `gateway/src/services/library.ts` (next to the other `library-types` imports, line ~17):
  ```ts
  import type { LibraryWorld } from './world-types.js';
  import { parseWorldJson } from './world-parse.js';
  ```
  > Note: `parseWorldJson` is created in Task 2. Add the import now; the type-check at the end of this task will still pass because Task 2's file is created before any task is considered "verified". If executing strictly task-isolated, create `gateway/src/services/world-parse.ts` with the `parseWorldJson` stub from Task 2 Step 3 first, then complete Task 2's tests.

  6b. Add `world?: LibraryWorld;` to `LibraryEntryFull` (after the `prompt?` field, `library.ts:40`):
  ```ts
    prompt?: LibraryPrompt;         // prompt: parsed JSON
    world?: LibraryWorld;           // world: parsed world.json (documents/ owned by WorldService)
  ```

  6c. Add `'world'` to `FILE_KINDS` (`library.ts:52`):
  ```ts
  const FILE_KINDS = ['author', 'voice', 'genre', 'pipeline', 'sequence', 'editor', 'prompt', 'section', 'world'] as const;
  ```

  6d. Add `world: 'worlds'` to `DIR_LAYOUT` (`library.ts:56`):
  ```ts
  const DIR_LAYOUT: Record<FileKind, string> = {
    author: 'authors',
    voice: 'voices',
    genre: 'genres',
    pipeline: 'pipelines',
    sequence: 'sequences',
    editor: 'editors',
    prompt: 'prompts',
    section: 'sections',
    world: 'worlds',
  };
  ```

  6e. In `overlayPath` (`library.ts:108`), a world entry is a directory (like author/voice/genre — its `world.json` + `documents/` live inside `worlds/<name>/`). The existing final `return join(dir, name);` already handles directory kinds, so add `world` is **not** a single-file kind — leave the `pipeline|sequence|editor|prompt` branch and the `section` branch untouched; `world` falls through to the directory return. No edit needed here beyond confirming `world` is not added to the single-file branches.

  6f. In `loadKind` (`library.ts:262`), add a `world` branch **before** the final `else` (author/voice/genre directory branch), since a world is a directory but loads only its `world.json`:
  ```ts
  } else if (kind === 'world') {
    // A world entry is a directory: load only world.json into `world`.
    // `documents/` is owned by WorldService, not the library overlay.
    if (!item.isDirectory()) continue;
    const cfgPath = join(dir, item.name, 'world.json');
    if (!existsSync(cfgPath)) continue;
    const raw = await readFile(cfgPath, 'utf-8');
    const world = parseWorldJson(raw);
    out.set(item.name, { kind, name: item.name, source, description: world.description, world });
  } else {
  ```
  > The surrounding `try { … } catch (err) { console.error('  ⚠ Library: failed to load …') }` already wraps each item, so a bad `world.json` is logged and skipped (fail-soft), satisfying the "needs attention, never throws at boot" constraint.

- [ ] **Step 7: Run the kind-registration test, expect PASS.**
  Command: `node --import tsx --test tests/unit/world-types.test.ts`
  Expected: `# pass 2  # fail 0`.

- [ ] **Step 8: Type-check, expect clean.**
  Command: `npx tsc --noEmit`
  Expected: no errors. (Requires `world-parse.ts` with at least the `parseWorldJson` stub to exist — completed at the latest by Task 2 Step 3.) End at a verified state.

---

### Task 2: `parseWorldJson` in `world-parse.ts`

**Files**
- Create `gateway/src/services/world-parse.ts`
- Create (start) `tests/unit/world-parse.test.ts`

**Interfaces**
- Produces: `export function parseWorldJson(raw: string): LibraryWorld;` — throws on invalid, mirroring `parsePipelineJson` (`book-types.ts:92`).

- [ ] **Step 1: Write the failing test.**
  Create `tests/unit/world-parse.test.ts`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { parseWorldJson } from '../../gateway/src/services/world-parse.js';

  const VALID = JSON.stringify({
    schemaVersion: 1,
    name: 'shattered-cradle',
    label: 'The Shattered Cradle',
    description: 'Earth, three million years on.',
    documentTypes: [{ id: 'field-guide', label: 'Field Guide', note: 'practical' }],
    domains: ['GEO', 'MAG'],
    clearanceLevels: ['General Access', 'Restricted'],
    classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}',
    formatDirective: 'Narrative prose only.',
    authoringEditor: 'luminarch-adept',
  });

  test('parseWorldJson accepts a valid config', () => {
    const w = parseWorldJson(VALID);
    assert.equal(w.name, 'shattered-cradle');
    assert.equal(w.schemaVersion, 1);
    assert.equal(w.documentTypes[0].id, 'field-guide');
    assert.deepEqual(w.domains, ['GEO', 'MAG']);
    assert.equal(w.classificationScheme, '{TYPE}-{DOMAIN}-{NNNN}');
    assert.equal(w.authoringEditor, 'luminarch-adept');
  });

  test('parseWorldJson throws on invalid JSON', () => {
    assert.throws(() => parseWorldJson('{ not json'), /valid JSON/);
  });

  test('parseWorldJson throws when documentTypes is missing', () => {
    const bad = JSON.stringify({ schemaVersion: 1, name: 'x', domains: ['GEO'], clearanceLevels: ['a'], classificationScheme: 's', formatDirective: 'd' });
    assert.throws(() => parseWorldJson(bad), /documentTypes/);
  });

  test('parseWorldJson throws when a documentType lacks id/label', () => {
    const bad = JSON.stringify({ schemaVersion: 1, name: 'x', documentTypes: [{ label: 'No id' }], domains: ['GEO'], clearanceLevels: ['a'], classificationScheme: 's', formatDirective: 'd' });
    assert.throws(() => parseWorldJson(bad), /documentType/);
  });

  test('parseWorldJson throws when schemaVersion is non-numeric', () => {
    const bad = JSON.stringify({ schemaVersion: 'one', name: 'x', documentTypes: [{ id: 'a', label: 'A' }], domains: ['GEO'], clearanceLevels: ['a'], classificationScheme: 's', formatDirective: 'd' });
    assert.throws(() => parseWorldJson(bad), /schemaVersion/);
  });
  ```

- [ ] **Step 2: Run it, expect FAIL.**
  Command: `node --import tsx --test tests/unit/world-parse.test.ts`
  Expected: `Cannot find module '.../gateway/src/services/world-parse.js'`.

- [ ] **Step 3: Create `gateway/src/services/world-parse.ts` with `parseWorldJson`.**
  ```ts
  /**
   * Parsers for the World Repository (World Repository Phase 1):
   *   - parseWorldJson    — validates a world.json config (like parsePipelineJson)
   *   - parseWorldDoc     — hand-parses document YAML frontmatter (no yaml dep)
   *   - serializeWorldDoc — round-trips parseWorldDoc
   *   - nextClassification — next free serial for a {TYPE}-{DOMAIN}-{NNNN} scheme
   */
  import type { LibraryWorld, WorldDocumentType, WorldDocMeta } from './world-types.js';

  /** Validate + shape-check a world.json string. Throws on invalid. */
  export function parseWorldJson(raw: string): LibraryWorld {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('world.json must be valid JSON'); }
    const o = (parsed ?? {}) as Record<string, unknown>;

    if (typeof o.schemaVersion !== 'number') throw new Error('world.json: schemaVersion must be a number');
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) throw new Error('world.json: name is required');

    if (!Array.isArray(o.documentTypes) || o.documentTypes.length === 0) {
      throw new Error('world.json: documentTypes must be a non-empty array');
    }
    const documentTypes: WorldDocumentType[] = o.documentTypes.map((dt, i) => {
      const t = (dt ?? {}) as Record<string, unknown>;
      const id = typeof t.id === 'string' ? t.id.trim() : '';
      const label = typeof t.label === 'string' ? t.label.trim() : '';
      if (!id || !label) throw new Error(`world.json: documentType[${i}] requires id and label`);
      const out: WorldDocumentType = { id, label };
      if (typeof t.note === 'string' && t.note.trim()) out.note = t.note.trim();
      return out;
    });

    const domains = Array.isArray(o.domains) ? o.domains.filter((d): d is string => typeof d === 'string') : [];
    if (domains.length === 0) throw new Error('world.json: domains must be a non-empty array');
    const clearanceLevels = Array.isArray(o.clearanceLevels) ? o.clearanceLevels.filter((c): c is string => typeof c === 'string') : [];
    if (clearanceLevels.length === 0) throw new Error('world.json: clearanceLevels must be a non-empty array');

    const classificationScheme = typeof o.classificationScheme === 'string' ? o.classificationScheme.trim() : '';
    if (!classificationScheme) throw new Error('world.json: classificationScheme is required');
    const formatDirective = typeof o.formatDirective === 'string' ? o.formatDirective.trim() : '';
    if (!formatDirective) throw new Error('world.json: formatDirective is required');

    const world: LibraryWorld = {
      schemaVersion: o.schemaVersion,
      name,
      documentTypes,
      domains,
      clearanceLevels,
      classificationScheme,
      formatDirective,
    };
    if (typeof o.label === 'string') world.label = o.label;
    if (typeof o.description === 'string') world.description = o.description;
    if (typeof o.authoringEditor === 'string' && o.authoringEditor.trim()) world.authoringEditor = o.authoringEditor.trim();
    if (typeof o.stripCodesInAppendix === 'boolean') world.stripCodesInAppendix = o.stripCodesInAppendix;
    return world;
  }

  // parseWorldDoc / serializeWorldDoc / nextClassification land in Task 3 / Task 4.
  void (null as unknown as WorldDocMeta); // placeholder reference removed in Task 3
  ```
  > The trailing `void` line only exists to keep the unused `WorldDocMeta` import legal until Task 3 uses it; **delete it in Task 3 Step 3** when `parseWorldDoc` references `WorldDocMeta`.

- [ ] **Step 4: Run the test, expect PASS.**
  Command: `node --import tsx --test tests/unit/world-parse.test.ts`
  Expected: `# pass 5  # fail 0`.

- [ ] **Step 5: Type-check, expect clean.**
  Command: `npx tsc --noEmit`
  Expected: no errors. End at a verified state.

---

### Task 3: `parseWorldDoc` + `serializeWorldDoc`

**Files**
- Modify `gateway/src/services/world-parse.ts`
- Modify `tests/unit/world-parse.test.ts` (append cases)

**Interfaces**
- Produces: `export function parseWorldDoc(raw: string): { meta: WorldDocMeta; body: string };` — throws on missing frontmatter / required fields.
- Produces: `export function serializeWorldDoc(meta: WorldDocMeta, body: string): string;` — round-trips `parseWorldDoc`.
- Frontmatter parsing follows `skills/loader.ts:182` (hand-rolled `/^---\n([\s\S]*?)\n---/`), extended for inline `tags: [a, b]`.

- [ ] **Step 1: Append failing tests to `tests/unit/world-parse.test.ts`.**
  ```ts
  import { parseWorldDoc, serializeWorldDoc } from '../../gateway/src/services/world-parse.js';

  const DOC = [
    '---',
    'title: The Geography of the Shattered Cradle',
    'type: field-guide',
    'classification: FG-GEO-0141',
    'clearance: General Access',
    'domain: GEO',
    'attribution: Compiled by Talen Windwalker',
    'tags: [geography, supercontinent, travel]',
    'summary: A traveler\'s guide to the transformed world.',
    'appendixEligible: true',
    '---',
    '',
    '### FIELD GUIDE',
    'Narrative prose body.',
    '',
  ].join('\n');

  test('parseWorldDoc reads scalar fields and an inline tags array', () => {
    const { meta, body } = parseWorldDoc(DOC);
    assert.equal(meta.title, 'The Geography of the Shattered Cradle');
    assert.equal(meta.type, 'field-guide');
    assert.equal(meta.classification, 'FG-GEO-0141');
    assert.equal(meta.clearance, 'General Access');
    assert.equal(meta.domain, 'GEO');
    assert.equal(meta.attribution, 'Compiled by Talen Windwalker');
    assert.deepEqual(meta.tags, ['geography', 'supercontinent', 'travel']);
    assert.equal(meta.summary, "A traveler's guide to the transformed world.");
    assert.equal(meta.appendixEligible, true);
    assert.equal(body, '### FIELD GUIDE\nNarrative prose body.');
  });

  test('parseWorldDoc throws on missing frontmatter', () => {
    assert.throws(() => parseWorldDoc('no fence here\nbody'), /frontmatter/);
  });

  test('parseWorldDoc throws when a required field is missing', () => {
    const bad = ['---', 'type: field-guide', 'domain: GEO', '---', 'body'].join('\n');
    assert.throws(() => parseWorldDoc(bad), /title/);
  });

  test('serializeWorldDoc round-trips parseWorldDoc', () => {
    const { meta, body } = parseWorldDoc(DOC);
    const reparsed = parseWorldDoc(serializeWorldDoc(meta, body));
    assert.deepEqual(reparsed.meta, meta);
    assert.equal(reparsed.body, body);
  });

  test('serializeWorldDoc omits empty optional fields and round-trips minimal docs', () => {
    const meta = { title: 'T', type: 'codex', classification: 'CN-MAG-0001', clearance: 'Restricted', domain: 'MAG', tags: [], summary: 'S' };
    const out = serializeWorldDoc(meta, 'Body.');
    assert.ok(!out.includes('attribution:'), 'no attribution line when omitted');
    assert.ok(!out.includes('appendixEligible:'), 'no appendixEligible line when omitted');
    const reparsed = parseWorldDoc(out);
    assert.deepEqual(reparsed.meta, meta);
    assert.equal(reparsed.body, 'Body.');
  });
  ```

- [ ] **Step 2: Run, expect FAIL.**
  Command: `node --import tsx --test tests/unit/world-parse.test.ts`
  Expected: import error — `parseWorldDoc`/`serializeWorldDoc` are not exported from `world-parse.js`.

- [ ] **Step 3: Implement the document parser/serializer in `world-parse.ts`.**
  Replace the placeholder `void (null …)` line with the two functions:
  ```ts
  const REQUIRED_FIELDS: ReadonlyArray<keyof WorldDocMeta> = ['title', 'type', 'classification', 'clearance', 'domain', 'summary'];

  /** Parse one inline array literal: `[a, b, c]` → ['a','b','c']. Empty → []. */
  function parseInlineArray(value: string): string[] {
    const inner = value.replace(/^\[/, '').replace(/\]$/, '').trim();
    if (!inner) return [];
    return inner.split(',').map((s) => s.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
  }

  /** Strip a surrounding pair of quotes from a scalar value. */
  function unquote(value: string): string {
    return value.replace(/^["']|["']$/g, '');
  }

  /**
   * Hand-parse a world document: `---` frontmatter fence + narrative body.
   * Mirrors skills/loader.ts:182, extended for inline `tags: [a, b]` arrays.
   * Throws on a missing fence or a missing required field.
   */
  export function parseWorldDoc(raw: string): { meta: WorldDocMeta; body: string } {
    const fence = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!fence) throw new Error('world document: missing YAML frontmatter fence');

    const fields: Record<string, string> = {};
    let tags: string[] = [];
    for (const line of fence[1].split('\n')) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s?(.*)$/);
      if (!m) continue;
      const key = m[1];
      const value = m[2].trim();
      if (key === 'tags') { tags = parseInlineArray(value); continue; }
      fields[key] = unquote(value);
    }

    for (const f of REQUIRED_FIELDS) {
      if (!fields[f]) throw new Error(`world document: required field '${f}' is missing`);
    }

    const meta: WorldDocMeta = {
      title: fields.title,
      type: fields.type,
      classification: fields.classification,
      clearance: fields.clearance,
      domain: fields.domain,
      tags,
      summary: fields.summary,
    };
    if (fields.attribution) meta.attribution = fields.attribution;
    if (fields.appendixEligible !== undefined) meta.appendixEligible = fields.appendixEligible === 'true';

    const body = raw.slice(fence[0].length).replace(/^\n+/, '').replace(/\s+$/, '');
    return { meta, body };
  }

  /** Serialize a document back to frontmatter + body; round-trips parseWorldDoc. */
  export function serializeWorldDoc(meta: WorldDocMeta, body: string): string {
    const lines: string[] = ['---'];
    lines.push(`title: ${meta.title}`);
    lines.push(`type: ${meta.type}`);
    lines.push(`classification: ${meta.classification}`);
    lines.push(`clearance: ${meta.clearance}`);
    lines.push(`domain: ${meta.domain}`);
    if (meta.attribution) lines.push(`attribution: ${meta.attribution}`);
    lines.push(`tags: [${meta.tags.join(', ')}]`);
    lines.push(`summary: ${meta.summary}`);
    if (meta.appendixEligible !== undefined) lines.push(`appendixEligible: ${meta.appendixEligible}`);
    lines.push('---', '', body.replace(/\s+$/, ''), '');
    return lines.join('\n');
  }
  ```
  > Also remove the now-stale comment `// parseWorldDoc / serializeWorldDoc / nextClassification land in Task 3 / Task 4.` line and the trailing `void (...)` placeholder from Task 2.

  > **Round-trip note:** `parseWorldDoc` strips a leading-empty line and trailing whitespace from the body; `serializeWorldDoc` emits exactly one blank line between the fence and the body and a single trailing newline. The minimal-doc test confirms a doc with `tags: []` and no optional fields round-trips, and that `summary`/`tags` are present even when empty (`tags: []`).

- [ ] **Step 4: Run, expect PASS.**
  Command: `node --import tsx --test tests/unit/world-parse.test.ts`
  Expected: all parse tests pass (`# pass 10  # fail 0` — 5 from Task 2 + 5 here).

- [ ] **Step 5: Type-check, expect clean.**
  Command: `npx tsc --noEmit`
  Expected: no errors. End at a verified state.

---

### Task 4: `nextClassification`

**Files**
- Modify `gateway/src/services/world-parse.ts`
- Modify `tests/unit/world-parse.test.ts` (append cases)

**Interfaces**
- Produces: `export function nextClassification(scheme: string, type: string, domain: string, existing: string[]): string;` — fills `{TYPE}-{DOMAIN}-{NNNN}` with the next free 4-digit serial for that TYPE-DOMAIN pair, 0-padded to 4. TYPE = the documentType id, upper-cased, hyphens removed, abbreviated to the first letter of each hyphen-segment (so `field-guide` → `FG`, `codex` → `CO`); DOMAIN is upper-cased verbatim.

> **TYPE derivation (pinned).** The existing Luminarch codes (`FG-GEO-0141`, `CN-…`) use a 2-letter abbreviation. The deterministic rule that reproduces `field-guide → FG`: take the first character of each hyphen-separated segment of the documentType id, upper-cased; if the id has a single segment, take its first two characters upper-cased (so `codex → CO`, `tomb → TO`, `observations → OB`). This is the only place the abbreviation is computed.

- [ ] **Step 1: Append failing tests to `tests/unit/world-parse.test.ts`.**
  ```ts
  import { nextClassification } from '../../gateway/src/services/world-parse.js';

  test('nextClassification picks the next free serial', () => {
    const code = nextClassification('{TYPE}-{DOMAIN}-{NNNN}', 'field-guide', 'GEO', ['FG-GEO-0141']);
    assert.equal(code, 'FG-GEO-0142');
  });

  test('nextClassification starts at 0001 when none exist', () => {
    assert.equal(nextClassification('{TYPE}-{DOMAIN}-{NNNN}', 'codex', 'MAG', []), 'CO-MAG-0001');
  });

  test('nextClassification fills the lowest free serial, skipping used ones', () => {
    const existing = ['FG-GEO-0001', 'FG-GEO-0003'];
    assert.equal(nextClassification('{TYPE}-{DOMAIN}-{NNNN}', 'field-guide', 'GEO', existing), 'FG-GEO-0002');
  });

  test('nextClassification ignores serials of a different TYPE-DOMAIN pair', () => {
    const existing = ['CO-MAG-0001', 'FG-GEO-0001'];
    assert.equal(nextClassification('{TYPE}-{DOMAIN}-{NNNN}', 'field-guide', 'GEO', existing), 'FG-GEO-0002');
  });

  test('nextClassification zero-pads to 4 digits', () => {
    assert.equal(nextClassification('{TYPE}-{DOMAIN}-{NNNN}', 'codex', 'MAG', ['CO-MAG-0009']), 'CO-MAG-0010');
  });
  ```

- [ ] **Step 2: Run, expect FAIL.**
  Command: `node --import tsx --test tests/unit/world-parse.test.ts`
  Expected: import error — `nextClassification` is not exported.

- [ ] **Step 3: Implement `nextClassification` in `world-parse.ts`.**
  ```ts
  /** Derive the classification TYPE abbreviation from a documentType id. */
  function typeAbbrev(type: string): string {
    const segments = type.split('-').filter(Boolean);
    if (segments.length > 1) return segments.map((s) => s[0]).join('').toUpperCase();
    return (segments[0] ?? '').slice(0, 2).toUpperCase();
  }

  /**
   * Fill {TYPE}-{DOMAIN}-{NNNN} with the next free 4-digit serial for that
   * TYPE-DOMAIN pair. Scans `existing` for codes already using this prefix and
   * returns the lowest unused serial, 0-padded to 4.
   */
  export function nextClassification(scheme: string, type: string, domain: string, existing: string[]): string {
    const TYPE = typeAbbrev(type);
    const DOMAIN = domain.toUpperCase();
    const prefix = `${TYPE}-${DOMAIN}-`;
    const used = new Set<number>();
    for (const code of existing) {
      if (!code.startsWith(prefix)) continue;
      const serial = Number(code.slice(prefix.length));
      if (Number.isInteger(serial) && serial > 0) used.add(serial);
    }
    let n = 1;
    while (used.has(n)) n++;
    const NNNN = String(n).padStart(4, '0');
    return scheme.replace('{TYPE}', TYPE).replace('{DOMAIN}', DOMAIN).replace('{NNNN}', NNNN);
  }
  ```

- [ ] **Step 4: Run, expect PASS.**
  Command: `node --import tsx --test tests/unit/world-parse.test.ts`
  Expected: all parse tests pass (`# pass 15  # fail 0`).

- [ ] **Step 5: Type-check, expect clean.**
  Command: `npx tsc --noEmit`
  Expected: no errors. End at a verified state.

---

### Task 5: `WorldService` (config + documents CRUD + auto-classify)

**Files**
- Create `gateway/src/services/world.ts`
- Create `tests/unit/world-service.test.ts`

**Interfaces**
- Consumes: `LibraryService` (`get('world', name)` → `LibraryEntryFull.world`; `overlayExists`), the `world-parse.ts` functions, the `world-types.ts` types, and `ENTRY_NAME_RE` from `library.ts`.
- Produces (per the contract):
  ```ts
  class WorldService {
    constructor(library: LibraryService, workspaceLibraryDir: string);
    list(): Array<{ name: string; label?: string; description?: string; source: LibrarySource }>;
    getConfig(name: string): LibraryWorld | undefined;
    listDocuments(name: string): WorldDocCatalogRow[];
    getDocument(name: string, docId: string): WorldDocument | undefined;
    createDocument(name: string, input: { meta: Omit<WorldDocMeta,'classification'> & { classification?: string }; body: string }): WorldDocument;
    updateDocument(name: string, docId: string, input: { meta: WorldDocMeta; body: string }): WorldDocument;
    deleteDocument(name: string, docId: string): boolean;
  }
  ```
  > The contract signature reads `constructor(library: LibraryService)`. The overlay write path needs the workspace `worlds/` directory; pass it explicitly as a second constructor argument (`workspaceLibraryDir`, the same `join(ROOT_DIR, 'workspace', 'library')` already given to `LibraryService`). This is an additive constructor param, not a contract divergence on a method signature. Documents are read from the overlay first, then the built-in `documents/` dir via the resolved entry's source path is **not** needed for Phase 1 — Phase 1 owns documents in the workspace overlay only; built-in document seeding is the Phase 2 migrator's job.

- [ ] **Step 1: Write the failing CRUD test.**
  Create `tests/unit/world-service.test.ts`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { LibraryService } from '../../gateway/src/services/library.js';
  import { WorldService } from '../../gateway/src/services/world.js';

  const fakeSkills = {
    getSkillCatalog: () => [] as Array<{ name: string; description: string; source: 'builtin' }>,
    getSkillByName: () => undefined,
  };

  const WORLD_JSON = JSON.stringify({
    schemaVersion: 1,
    name: 'shattered-cradle',
    label: 'The Shattered Cradle',
    description: 'A test world.',
    documentTypes: [{ id: 'field-guide', label: 'Field Guide' }, { id: 'codex', label: 'Codex' }],
    domains: ['GEO', 'MAG'],
    clearanceLevels: ['General Access', 'Restricted'],
    classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}',
    formatDirective: 'Narrative prose only.',
  });

  async function setup(root: string) {
    const builtin = join(root, 'library');
    const workspace = join(root, 'workspace', 'library');
    // Seed a built-in world config so getConfig/list resolve through the library.
    mkdirSync(join(builtin, 'worlds', 'shattered-cradle'), { recursive: true });
    writeFileSync(join(builtin, 'worlds', 'shattered-cradle', 'world.json'), WORLD_JSON, 'utf-8');
    const lib = new LibraryService(builtin, workspace, fakeSkills);
    await lib.loadAll();
    const world = new WorldService(lib, workspace);
    return { lib, world, workspace };
  }

  test('list / getConfig resolve a world through the library', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-world-'));
    try {
      const { world } = await setup(root);
      const rows = world.list();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].name, 'shattered-cradle');
      assert.equal(rows[0].label, 'The Shattered Cradle');
      const cfg = world.getConfig('shattered-cradle');
      assert.equal(cfg?.domains.length, 2);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('createDocument auto-classifies, then read/update/delete round-trip', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-world-'));
    try {
      const { world, workspace } = await setup(root);
      const created = world.createDocument('shattered-cradle', {
        meta: { title: 'Geography', type: 'field-guide', clearance: 'General Access', domain: 'GEO', tags: ['geo'], summary: 'A guide.' },
        body: 'Body one.',
      });
      assert.equal(created.meta.classification, 'FG-GEO-0001');
      assert.ok(existsSync(join(workspace, 'worlds', 'shattered-cradle', 'documents', `${created.docId}.md`)));

      const second = world.createDocument('shattered-cradle', {
        meta: { title: 'More Geography', type: 'field-guide', clearance: 'General Access', domain: 'GEO', tags: [], summary: 'Another.' },
        body: 'Body two.',
      });
      assert.equal(second.meta.classification, 'FG-GEO-0002');

      const catalog = world.listDocuments('shattered-cradle');
      assert.equal(catalog.length, 2);
      assert.ok(catalog.every((r) => !r.body));

      const got = world.getDocument('shattered-cradle', created.docId);
      assert.equal(got?.body, 'Body one.');
      assert.equal(got?.meta.title, 'Geography');

      const updated = world.updateDocument('shattered-cradle', created.docId, {
        meta: { ...created.meta, summary: 'Revised.' },
        body: 'Body one revised.',
      });
      assert.equal(updated.meta.summary, 'Revised.');
      assert.equal(world.getDocument('shattered-cradle', created.docId)?.body, 'Body one revised.');

      assert.equal(world.deleteDocument('shattered-cradle', created.docId), true);
      assert.equal(world.getDocument('shattered-cradle', created.docId), undefined);
      assert.equal(world.listDocuments('shattered-cradle').length, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('createDocument honors an explicit classification', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-world-'));
    try {
      const { world } = await setup(root);
      const doc = world.createDocument('shattered-cradle', {
        meta: { title: 'Pinned', type: 'codex', classification: 'CO-MAG-0099', clearance: 'Restricted', domain: 'MAG', tags: [], summary: 'Pinned code.' },
        body: 'B.',
      });
      assert.equal(doc.meta.classification, 'CO-MAG-0099');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('a bad document file surfaces as needsAttention, never throws', async () => {
    const root = mkdtempSync(join(tmpdir(), 'bookclaw-world-'));
    try {
      const { world, workspace } = await setup(root);
      const docsDir = join(workspace, 'worlds', 'shattered-cradle', 'documents');
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(join(docsDir, 'broken.md'), 'no frontmatter at all', 'utf-8');
      const catalog = world.listDocuments('shattered-cradle');
      const broken = catalog.find((r) => r.docId === 'broken');
      assert.ok(broken?.needsAttention, 'broken doc flagged needsAttention');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  ```

- [ ] **Step 2: Run, expect FAIL.**
  Command: `node --import tsx --test tests/unit/world-service.test.ts`
  Expected: `Cannot find module '.../gateway/src/services/world.js'`.

- [ ] **Step 3: Create `gateway/src/services/world.ts`.**
  ```ts
  /**
   * WorldService (World Repository Phase 1): config read-through + documents CRUD.
   *
   * World config (world.json) is resolved through LibraryService (built-in +
   * workspace overlay). Documents live in the workspace overlay only —
   * workspace/library/worlds/<name>/documents/<docId>.md — and are owned here
   * (the library overlay deliberately does not load them). Fail-soft: a bad
   * document file surfaces as `needsAttention` in the catalog and never throws.
   */
  import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
  import { join } from 'path';
  import type { LibraryService } from './library.js';
  import { ENTRY_NAME_RE } from './library.js';
  import type { LibrarySource } from './library-types.js';
  import type { LibraryWorld, WorldDocMeta, WorldDocument, WorldDocCatalogRow } from './world-types.js';
  import { parseWorldDoc, serializeWorldDoc, nextClassification } from './world-parse.js';

  /** Derive a filesystem-safe docId stem from a classification + title. */
  function deriveDocId(classification: string, title: string): string {
    const slug = `${classification}-${title}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '');
    return slug || classification.toLowerCase();
  }

  export class WorldService {
    constructor(private library: LibraryService, private workspaceLibraryDir: string) {}

    /** Absolute documents/ dir for a world's workspace overlay, or null if name invalid. */
    private documentsDir(name: string): string | null {
      if (!ENTRY_NAME_RE.test(name)) return null;
      return join(this.workspaceLibraryDir, 'worlds', name, 'documents');
    }

    private docPath(name: string, docId: string): string | null {
      const dir = this.documentsDir(name);
      if (!dir || !ENTRY_NAME_RE.test(docId)) return null;
      return join(dir, `${docId}.md`);
    }

    list(): Array<{ name: string; label?: string; description?: string; source: LibrarySource }> {
      return this.library.list('world').map((row) => {
        const cfg = this.library.get('world', row.name)?.world;
        return { name: row.name, label: cfg?.label, description: row.description, source: row.source };
      });
    }

    getConfig(name: string): LibraryWorld | undefined {
      return this.library.get('world', name)?.world;
    }

    /** All docId stems present in the workspace overlay for a world. */
    private docIds(name: string): string[] {
      const dir = this.documentsDir(name);
      if (!dir || !existsSync(dir)) return [];
      return readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name.replace(/\.md$/, ''));
    }

    listDocuments(name: string): WorldDocCatalogRow[] {
      const dir = this.documentsDir(name);
      if (!dir || !existsSync(dir)) return [];
      const rows: WorldDocCatalogRow[] = [];
      for (const docId of this.docIds(name)) {
        try {
          const raw = readFileSync(join(dir, `${docId}.md`), 'utf-8');
          const { meta } = parseWorldDoc(raw);
          rows.push({
            docId, title: meta.title, type: meta.type, domain: meta.domain,
            clearance: meta.clearance, classification: meta.classification,
            summary: meta.summary, tags: meta.tags, appendixEligible: meta.appendixEligible === true,
          });
        } catch {
          rows.push({
            docId, title: docId, type: '', domain: '', clearance: '', classification: '',
            summary: '', tags: [], appendixEligible: false, needsAttention: true,
          });
        }
      }
      return rows;
    }

    getDocument(name: string, docId: string): WorldDocument | undefined {
      const p = this.docPath(name, docId);
      if (!p || !existsSync(p)) return undefined;
      try {
        const { meta, body } = parseWorldDoc(readFileSync(p, 'utf-8'));
        return { docId, meta, body };
      } catch { return undefined; }
    }

    createDocument(
      name: string,
      input: { meta: Omit<WorldDocMeta, 'classification'> & { classification?: string }; body: string },
    ): WorldDocument {
      const cfg = this.getConfig(name);
      if (!cfg) throw new Error(`world not found: ${name}`);
      const dir = this.documentsDir(name);
      if (!dir) throw new Error(`invalid world name: ${name}`);

      const existingCodes = this.listDocuments(name).map((r) => r.classification).filter(Boolean);
      const classification = input.meta.classification?.trim()
        || nextClassification(cfg.classificationScheme, input.meta.type, input.meta.domain, existingCodes);

      const meta: WorldDocMeta = { ...input.meta, classification };
      const docId = deriveDocId(classification, meta.title);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${docId}.md`), serializeWorldDoc(meta, input.body), 'utf-8');
      return { docId, meta, body: input.body.replace(/\s+$/, '') };
    }

    updateDocument(name: string, docId: string, input: { meta: WorldDocMeta; body: string }): WorldDocument {
      const p = this.docPath(name, docId);
      if (!p || !existsSync(p)) throw new Error(`document not found: ${name}/${docId}`);
      writeFileSync(p, serializeWorldDoc(input.meta, input.body), 'utf-8');
      return { docId, meta: input.meta, body: input.body.replace(/\s+$/, '') };
    }

    deleteDocument(name: string, docId: string): boolean {
      const p = this.docPath(name, docId);
      if (!p || !existsSync(p)) return false;
      rmSync(p);
      return true;
    }
  }
  ```

- [ ] **Step 4: Run, expect PASS.**
  Command: `node --import tsx --test tests/unit/world-service.test.ts`
  Expected: `# pass 4  # fail 0`.

- [ ] **Step 5: Type-check, expect clean.**
  Command: `npx tsc --noEmit`
  Expected: no errors. End at a verified state.

---

### Task 6: `worlds.routes.ts` + wiring + smoke

**Files**
- Create `gateway/src/api/routes/worlds.routes.ts`
- Modify `gateway/src/api/routes.ts:23` (import) and `:61` area (call `mountWorlds`)
- Modify `gateway/src/index.ts:192` area (declare `public world?: WorldService;`), `:90` area (import), and `getServices()` (`:1288` area) to expose `world`
- Modify `gateway/src/init/phase-05-research-skills.ts:76` area (instantiate `WorldService`)
- Create `tests/world-crud-smoke.sh`

**Interfaces**
- Consumes: `gateway.getServices().world` (`WorldService`).
- Produces these routes (per the contract; Phase-3/5 book routes are out of scope here):
  ```
  GET    /api/worlds
  GET    /api/worlds/:name
  GET    /api/worlds/:name/documents
  GET    /api/worlds/:name/documents/:docId
  POST   /api/worlds/:name/documents
  PUT    /api/worlds/:name/documents/:docId
  DELETE /api/worlds/:name/documents/:docId
  ```

- [ ] **Step 1: Write the failing smoke test.**
  Create `tests/world-crud-smoke.sh` (mirror the loopback-only, env-token, leave-no-process posture of `tests/smoke-test.sh`):
  ```bash
  #!/usr/bin/env bash
  # World Repository Phase 1 smoke: boot the gateway, seed a world overlay, then
  # exercise the documents API (create + auto-classify, list, get, update, delete).
  # Hermetic: loopback bind, env-supplied token, temp workspace, no stray process.
  set -euo pipefail

  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  TOKEN="smoke-world-$$"
  PORT=3849
  WS="$(mktemp -d)"
  BASE="http://127.0.0.1:${PORT}"
  AUTH=(-H "Authorization: Bearer ${TOKEN}")

  cleanup() { [[ -n "${SERVER_PID:-}" ]] && kill "${SERVER_PID}" 2>/dev/null || true; rm -rf "${WS}"; }
  trap cleanup EXIT

  # Seed a workspace world overlay (config + empty documents dir) BEFORE boot.
  mkdir -p "${WS}/library/worlds/test-world/documents"
  cat > "${WS}/library/worlds/test-world/world.json" <<'JSON'
  {
    "schemaVersion": 1,
    "name": "test-world",
    "label": "Test World",
    "description": "Smoke world.",
    "documentTypes": [{ "id": "field-guide", "label": "Field Guide" }],
    "domains": ["GEO"],
    "clearanceLevels": ["General Access"],
    "classificationScheme": "{TYPE}-{DOMAIN}-{NNNN}",
    "formatDirective": "Narrative prose only."
  }
  JSON

  BOOKCLAW_AUTH_TOKEN="${TOKEN}" BOOKCLAW_BIND=127.0.0.1 PORT="${PORT}" \
    BOOKCLAW_WORKSPACE_PATH="${WS}" \
    node --import tsx "${ROOT}/gateway/src/index.ts" > "${WS}/server.log" 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 1 60); do
    curl -fsS "${AUTH[@]}" "${BASE}/api/status" >/dev/null 2>&1 && break
    sleep 1
  done

  fail() { echo "FAIL: $1"; [[ "${1:-}" == *log* ]] || sed -n '1,80p' "${WS}/server.log"; exit 1; }

  # 1) the seeded world lists
  curl -fsS "${AUTH[@]}" "${BASE}/api/worlds" | grep -q '"test-world"' || fail "world not listed"

  # 2) create a document → auto-classify FG-GEO-0001
  CREATED="$(curl -fsS "${AUTH[@]}" -H 'Content-Type: application/json' -X POST \
    "${BASE}/api/worlds/test-world/documents" \
    -d '{"meta":{"title":"Geography","type":"field-guide","clearance":"General Access","domain":"GEO","tags":["geo"],"summary":"A guide."},"body":"Body."}')"
  echo "${CREATED}" | grep -q '"classification":"FG-GEO-0001"' || fail "auto-classify FG-GEO-0001 (got: ${CREATED})"
  DOC_ID="$(echo "${CREATED}" | sed -n 's/.*"docId":"\([^"]*\)".*/\1/p')"
  [[ -n "${DOC_ID}" ]] || fail "no docId returned"

  # 3) catalog shows it (no body)
  curl -fsS "${AUTH[@]}" "${BASE}/api/worlds/test-world/documents" | grep -q '"FG-GEO-0001"' || fail "catalog missing the doc"

  # 4) full read returns the body
  curl -fsS "${AUTH[@]}" "${BASE}/api/worlds/test-world/documents/${DOC_ID}" | grep -q '"body":"Body."' || fail "full read body wrong"

  # 5) update
  curl -fsS "${AUTH[@]}" -H 'Content-Type: application/json' -X PUT \
    "${BASE}/api/worlds/test-world/documents/${DOC_ID}" \
    -d '{"meta":{"title":"Geography","type":"field-guide","classification":"FG-GEO-0001","clearance":"General Access","domain":"GEO","tags":["geo"],"summary":"Revised."},"body":"Body two."}' \
    | grep -q '"summary":"Revised."' || fail "update did not persist"

  # 6) delete
  curl -fsS "${AUTH[@]}" -X DELETE "${BASE}/api/worlds/test-world/documents/${DOC_ID}" | grep -q '"deleted":true' || fail "delete failed"
  curl -fsS "${AUTH[@]}" "${BASE}/api/worlds/test-world/documents" | grep -q '"FG-GEO-0001"' && fail "doc still present after delete" || true

  echo "PASS: world documents CRUD smoke (6 checks)"
  ```
  Make it executable: `chmod +x tests/world-crud-smoke.sh`.

- [ ] **Step 2: Run, expect FAIL.**
  Command: `bash tests/world-crud-smoke.sh`
  Expected: `FAIL: world not listed` (the `/api/worlds` route does not exist yet, so the grep finds nothing).

- [ ] **Step 3: Create `gateway/src/api/routes/worlds.routes.ts`.**
  ```ts
  import { Application, Request, Response } from 'express';

  /**
   * World Repository documents API (World Repository Phase 1). World CONFIG
   * create/edit rides the existing library API; these routes own the documents
   * (catalog/read/create+auto-classify/update/delete). Behind the same bearer
   * auth + IP allowlist as the rest of /api/*.
   */
  export function mountWorlds(app: Application, gateway: any, _baseDir: string): void {
    const services = gateway.getServices();

    app.get('/api/worlds', (_req: Request, res: Response) => {
      const world = services.world;
      res.json({ worlds: world ? world.list() : [] });
    });

    app.get('/api/worlds/:name', (req: Request, res: Response) => {
      const world = services.world;
      if (!world) return res.status(503).json({ error: 'World service not initialized' });
      const cfg = world.getConfig(req.params.name);
      if (!cfg) return res.status(404).json({ error: 'World not found' });
      res.json({ world: cfg });
    });

    app.get('/api/worlds/:name/documents', (req: Request, res: Response) => {
      const world = services.world;
      if (!world) return res.status(503).json({ error: 'World service not initialized' });
      if (!world.getConfig(req.params.name)) return res.status(404).json({ error: 'World not found' });
      res.json({ documents: world.listDocuments(req.params.name) });
    });

    app.get('/api/worlds/:name/documents/:docId', (req: Request, res: Response) => {
      const world = services.world;
      if (!world) return res.status(503).json({ error: 'World service not initialized' });
      const doc = world.getDocument(req.params.name, req.params.docId);
      if (!doc) return res.status(404).json({ error: 'Document not found' });
      res.json(doc);
    });

    app.post('/api/worlds/:name/documents', (req: Request, res: Response) => {
      const world = services.world;
      if (!world) return res.status(503).json({ error: 'World service not initialized' });
      const meta = req.body?.meta;
      const body = req.body?.body;
      if (!meta || typeof meta !== 'object' || typeof body !== 'string') {
        return res.status(400).json({ error: 'meta (object) and body (string) are required' });
      }
      try {
        const doc = world.createDocument(req.params.name, { meta, body });
        res.json(doc);
      } catch (err) {
        res.status(400).json({ error: (err as Error)?.message || 'create failed' });
      }
    });

    app.put('/api/worlds/:name/documents/:docId', (req: Request, res: Response) => {
      const world = services.world;
      if (!world) return res.status(503).json({ error: 'World service not initialized' });
      const meta = req.body?.meta;
      const body = req.body?.body;
      if (!meta || typeof meta !== 'object' || typeof meta.classification !== 'string' || typeof body !== 'string') {
        return res.status(400).json({ error: 'meta (with classification) and body (string) are required' });
      }
      try {
        const doc = world.updateDocument(req.params.name, req.params.docId, { meta, body });
        res.json(doc);
      } catch (err) {
        res.status(404).json({ error: (err as Error)?.message || 'update failed' });
      }
    });

    app.delete('/api/worlds/:name/documents/:docId', (req: Request, res: Response) => {
      const world = services.world;
      if (!world) return res.status(503).json({ error: 'World service not initialized' });
      const ok = world.deleteDocument(req.params.name, req.params.docId);
      res.json({ deleted: ok });
    });
  }
  ```

- [ ] **Step 4: Register the mounter in `routes.ts`.**
  4a. Add the import next to `mountSeries` (`gateway/src/api/routes.ts:23`):
  ```ts
  import { mountWorlds } from './routes/worlds.routes.js';
  ```
  4b. Add the call next to `mountSeries(app, gateway, baseDir);` (`routes.ts:61`):
  ```ts
    mountSeries(app, gateway, baseDir);
    mountWorlds(app, gateway, baseDir);
  ```

- [ ] **Step 5: Declare + expose the service in `index.ts`.**
  5a. Add the import (next to the other service imports, e.g. after the `LibraryService` import at `index.ts:37`):
  ```ts
  import { WorldService } from './services/world.js';
  ```
  5b. Declare the field next to `public library!: LibraryService;` (`index.ts:192`):
  ```ts
    public world?: WorldService;
  ```
  5c. Expose it in `getServices()` next to `library: this.library,` (`index.ts:1244`):
  ```ts
      library: this.library,
      world: this.world,
  ```

- [ ] **Step 6: Instantiate `WorldService` in phase-05.**
  In `gateway/src/init/phase-05-research-skills.ts`, after the library `loadAll()` block (`:76`) and before the `BookService` construction (`:78`), add:
  ```ts
  gw.world = new WorldService(gw.library, join(ROOT_DIR, 'workspace', 'library'));
  console.log(`  ✓ World repository: ${gw.world.list().length} world(s)`);
  ```
  Add the import at the top of the file next to the other service imports:
  ```ts
  import { WorldService } from '../services/world.js';
  ```

- [ ] **Step 7: Run the smoke, expect PASS.**
  Command: `bash tests/world-crud-smoke.sh`
  Expected final line: `PASS: world documents CRUD smoke (6 checks)`.

- [ ] **Step 8: Run the full unit suite + type-check, expect clean.**
  Commands:
  ```
  node --import tsx --test tests/unit/world-types.test.ts tests/unit/world-parse.test.ts tests/unit/world-service.test.ts
  npx tsc --noEmit
  ```
  Expected: all world unit tests pass; `tsc` reports no errors. End at a verified state.

---

## Milestone close

At the end of Task 6, write `commit_message` in the repo root (do **not** run `git commit`/`git push`):

```
feat(world): world library kind + documents CRUD (World Repository Phase 1)

- add `world` kind to LIBRARY_KINDS (backend + frontend) and library FILE_KINDS/DIR_LAYOUT (worlds/)
- world-types.ts shared contract types; WORLD_SCHEMA_VERSION=1
- world-parse.ts: parseWorldJson / parseWorldDoc / serializeWorldDoc / nextClassification
- WorldService: config read-through + documents CRUD with serial auto-classification
- worlds.routes.ts documents API, mounted in routes.ts; service wired in index.ts + phase-05
- unit tests (parse, service) + tests/world-crud-smoke.sh
```

Then move the World Repository Phase 1 item from `docs/TODO.md` to `docs/COMPLETED.md` with a `2026-06-21` completion date (per the project feature-tracking workflow).

---

## Self-Review

**Spec coverage (Section 1 + Section 5 API parts).**
- Section 1 data model — `world.json` config (`parseWorldJson`, Task 2) and per-document frontmatter (`parseWorldDoc`/`serializeWorldDoc`, Task 3) both implemented; `summary`+`tags` carried in `WorldDocMeta`/catalog for cheap relevance-pull later. Covered.
- Section 1 "new code" list — `world` kind registration (Task 1), `world.json` parsing like `pipeline.json` (Task 2), document frontmatter parsing (Task 3). All three covered.
- Section 5 API — documents `GET`(catalog)/`GET`(full)/`POST`(create+auto-classify)/`PUT`/`DELETE` (Task 6), plus `GET /api/worlds` and `GET /api/worlds/:name`. Covered. World *config* create/edit deliberately rides the existing library API (contract line 170) and is **out of this phase's scope**; book binding/pull/appendix routes are Phase 3/5 and excluded here.
- Section 5 error handling — bad frontmatter → `needsAttention` catalog row, never throws (WorldService `listDocuments` catch + the `world-service.test.ts` "needsAttention" case); bad `world.json` is logged + skipped by `loadKind`'s per-item try/catch (Task 1 Step 6f). `schemaVersion` field present on config + documents (`WORLD_SCHEMA_VERSION=1`); the too-new gate that mirrors `classifyVersion` is consumed by Phase 3's snapshot/re-pull, so Phase 1 only carries the field — no gate behavior is asserted here, matching the contract's Phase split.
- Section 5 testing — unit tests for the frontmatter parser (valid/invalid), the `world.json` parser, and classification next-serial; the leave-in-place smoke seeds a tiny world and runs create/list/get/update/delete. Covered. Relevance-pull and appendix-render tests are Phase 3/5.

**Placeholder scan.** No "TBD", "similar to Task N", "add error handling", or "write tests for the above" remains. Every code step shows complete code; every test step shows the full test plus the exact run command and expected output. The only intentional cross-task carry is `world-parse.ts`'s `parseWorldJson` stub being imported by `library.ts` in Task 1 (called out explicitly in Task 1 Step 6 with a build-order note) and the Task 2 `void` placeholder line that Task 3 Step 3 deletes.

**Type consistency.** All types come from `world-types.ts` exactly as pinned in the contract (`WORLD_SCHEMA_VERSION`, `WorldDocumentType`, `LibraryWorld`, `WorldDocMeta`, `WorldDocument`, `WorldDocCatalogRow`). Parser signatures match the contract verbatim. The single additive deviation is the `WorldService` constructor's second `workspaceLibraryDir: string` argument (the contract shows `constructor(library: LibraryService)`); it is additive, required for the overlay write path, does not change any method signature, and is flagged in Task 5's Interfaces block as a deliberate, non-divergent extension to reconcile against the contract on review. `.js` import extensions are used in every snippet. `LibraryKind` is updated in both the backend (`library-types.ts`) and the frontend mirror (`frontend/shared/src/types.ts`).
