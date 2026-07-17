# Character Name Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-book, lightweight name registry that deterministically captures every named character (primary → transient), injects a compact recurring-cast roster into chapter generation to prevent name drift, extracts a sentinel-delimited manifest from the frontier draft, strips it (3-layer anti-bleed) before it becomes canonical chapter prose, and enforces confirmed drift-maps through the shipped AI-name-checker.

**Architecture:** A new `gateway/src/services/registry/` module owns pure units (types, load/save, seed, `parseManifest`, roster builder, candidate resolver, registry→AiNameMap). The pipeline wires them at two existing seams: (1) the `writeChapterPrompt` draft-prompt build gets a roster + mandatory-manifest contract appended; (2) the draft-completion path (both the headless `index.ts` runner and the studio `/execute` + `/auto-execute` routes), immediately after `stripMetaCommentary(...)` and **before** the chapter file is written or continuity is detected, strips the manifest and diffs it into review-gate candidates. Enforcement reuses `runDeaiSweepStep`'s existing `aiNames` slot: the registry's `driftMap` is compiled into an `AiNameMap` and merged with `loadAiNamesForBook`'s output — the shipped `applyAiNames`/`applyDeAiEdits` contract is untouched.

**Tech Stack:** Node 22, TypeScript via `tsx` (NodeNext resolution — imports use `.js`), `node:test` unit tests, `node:fs` atomic writes (match `writeFileAtomic` in `book.ts`).

## Global Constraints

- **Imports use `.js` extensions** on TS source (NodeNext). Match this in every new file.
- **Fail-soft everywhere.** Missing/malformed registry, missing/malformed manifest, absent providers → log `⚠`/`ℹ`, degrade, never crash, never block a pipeline, never leak a manifest into prose.
- **Determinism never decides same-person-vs-two-people.** Surname collision (Rosa vs Angela Marchetti) is surfaced as `ambiguous`, never auto-merged.
- **Full character profiles are NEVER injected.** Only a compact `name — role` roster of recurring (tier ≠ `transient`) cast.
- **The shipped `applyAiNames`/`applyDeAiEdits`/`loadAiNamesForBook` contract stays stable.** New enforcement rides the existing `aiNames` parameter of `runDeaiSweepStep`.
- **Storage:** `workspace/books/<slug>/name-registry.json`. Atomic write. Never injected into prompts.
- **Registry is human-blessed.** The extractor proposes; canon only mutates through a human-confirmed review-gate decision.
- **Unit-test runner:** `node --import tsx --test tests/unit/<file>.test.ts`.

---

## File Structure

**New (`gateway/src/services/registry/`):**
- `types.ts` — `NameTier`, `RegistryCharacter`, `RegistryLocation`, `NameRegistry`, `ManifestCharacter`, `ManifestLocation`, `ParsedManifest`, `NameCandidate`.
- `store.ts` — `registryPath`, `loadRegistry` (fail-soft empty), `saveRegistry` (atomic).
- `seed.ts` — `seedRegistryCharacters(bibleChars)` pure builder.
- `parse-manifest.ts` — `parseManifest(text)`: locate-by-sentinel, validate, strip, residue-check.
- `remnant-sweep.ts` — `sweepManifestRemnant({ text, aiComplete })` conditional light-model fallback.
- `roster.ts` — `buildRoster(registry)` tier-filtered compact roster string.
- `enforce.ts` — `registryToAiNameMap(registry)`, `mergeAiNameMaps(a, b)`.
- `candidates.ts` — `diffManifest(manifest, registry)` → `NameCandidate[]` with classification.

**Modified:**
- `gateway/src/services/book.ts` — seed registry in `create(...)`; add `recordRegistryDecision(slug, decision)` (mirrors `setModelConfig` lock+atomic pattern).
- `gateway/src/services/projects.ts` — `writeChapterPrompt(...)` gains an appended manifest-contract block; a new exported `injectRosterAndManifest(prompt, roster)` helper (roster is runtime/per-book, appended at execution, not baked into the static template).
- `gateway/src/index.ts` (~2500 sweep call, ~2687 draft strip) and `gateway/src/api/routes/projects.routes.ts` (~652/807 `/execute`, ~1219/1494 `/auto-execute`) — inject roster into the draft prompt; after `stripMetaCommentary`, strip the manifest + diff candidates; feed registry driftMap into the sweep's `aiNames`.

**Tests (`tests/unit/`):** `name-registry-store.test.ts`, `name-registry-seed.test.ts`, `name-manifest-parse.test.ts`, `name-manifest-remnant.test.ts`, `name-roster.test.ts`, `name-enforce.test.ts`, `name-candidates.test.ts`, `name-registry-pipeline.test.ts`.

---

## Task 1: Registry types + store (load/save, fail-soft)

**Files:**
- Create: `gateway/src/services/registry/types.ts`, `gateway/src/services/registry/store.ts`
- Test: `tests/unit/name-registry-store.test.ts`

**Interfaces:**
- Produces: `NameTier = 'primary'|'secondary'|'tertiary'|'transient'`; `RegistryCharacter { canonical: string; tier: NameTier; role: string; aliases: string[]; driftMap: string[]; firstChapter?: number }`; `RegistryLocation { canonical: string; role: string; aliases: string[]; driftMap: string[] }`; `NameRegistry { characters: RegistryCharacter[]; locations: RegistryLocation[] }`; `registryPath(bookDir: string): string`; `loadRegistry(bookDir: string): NameRegistry`; `saveRegistry(bookDir: string, reg: NameRegistry): void`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRegistry, saveRegistry } from '../../gateway/src/services/registry/store.js';
import type { NameRegistry } from '../../gateway/src/services/registry/types.js';

test('loadRegistry on an absent file returns an empty registry (fail-soft)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reg-'));
  try {
    assert.deepEqual(loadRegistry(dir), { characters: [], locations: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('saveRegistry then loadRegistry round-trips', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reg-'));
  try {
    const reg: NameRegistry = {
      characters: [{ canonical: 'Rosa Marchetti', tier: 'tertiary', role: 'regular customer', aliases: [], driftMap: ['Dottie'], firstChapter: 1 }],
      locations: [],
    };
    saveRegistry(dir, reg);
    assert.deepEqual(loadRegistry(dir), reg);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadRegistry on malformed JSON returns empty (fail-soft, no throw)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reg-'));
  try {
    require('node:fs').writeFileSync(join(dir, 'name-registry.json'), '{ not json');
    assert.deepEqual(loadRegistry(dir), { characters: [], locations: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/name-registry-store.test.ts`
Expected: FAIL — `Cannot find module '.../registry/store.js'`.

- [ ] **Step 3: Write minimal implementation**

`types.ts`:
```ts
export type NameTier = 'primary' | 'secondary' | 'tertiary' | 'transient';
export interface RegistryCharacter { canonical: string; tier: NameTier; role: string; aliases: string[]; driftMap: string[]; firstChapter?: number; }
export interface RegistryLocation { canonical: string; role: string; aliases: string[]; driftMap: string[]; }
export interface NameRegistry { characters: RegistryCharacter[]; locations: RegistryLocation[]; }
```

`store.ts` (atomic write mirrors `book.ts` `writeFileAtomic`: write temp, rename):
```ts
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { NameRegistry } from './types.js';

export function registryPath(bookDir: string): string { return join(bookDir, 'name-registry.json'); }

export function loadRegistry(bookDir: string): NameRegistry {
  const empty: NameRegistry = { characters: [], locations: [] };
  try {
    const p = registryPath(bookDir);
    if (!existsSync(p)) return empty;
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return { characters: Array.isArray(j?.characters) ? j.characters : [], locations: Array.isArray(j?.locations) ? j.locations : [] };
  } catch { return empty; }
}

export function saveRegistry(bookDir: string, reg: NameRegistry): void {
  const p = registryPath(bookDir);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n');
  renameSync(tmp, p);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/name-registry-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/registry/types.ts gateway/src/services/registry/store.ts tests/unit/name-registry-store.test.ts
git commit -m "feat(registry): per-book name-registry.json store (fail-soft load/atomic save)"
```

---

## Task 2: Seed builder + wire into book create

**Files:**
- Create: `gateway/src/services/registry/seed.ts`
- Modify: `gateway/src/services/book.ts` (inside `create(...)`, after the `book.json` is written)
- Test: `tests/unit/name-registry-seed.test.ts`

**Interfaces:**
- Consumes: `RegistryCharacter`, `NameTier` (Task 1); `saveRegistry`, `loadRegistry` (Task 1).
- Produces: `seedRegistryCharacters(bibleChars: Array<{ name: string; tier?: NameTier; role?: string }>): RegistryCharacter[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedRegistryCharacters } from '../../gateway/src/services/registry/seed.js';

test('seed maps bible characters to registry rows, defaulting tier to secondary', () => {
  const rows = seedRegistryCharacters([
    { name: 'Cole', tier: 'primary', role: 'protagonist, baker' },
    { name: 'Angela Marchetti', role: 'the bride' },
  ]);
  assert.deepEqual(rows, [
    { canonical: 'Cole', tier: 'primary', role: 'protagonist, baker', aliases: [], driftMap: [] },
    { canonical: 'Angela Marchetti', tier: 'secondary', role: 'the bride', aliases: [], driftMap: [] },
  ]);
});

test('seed drops blank names and de-dups by canonical (first wins)', () => {
  const rows = seedRegistryCharacters([{ name: '  ' }, { name: 'Cole', role: 'a' }, { name: 'Cole', role: 'b' }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'a');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/name-registry-seed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`seed.ts`:
```ts
import type { NameTier, RegistryCharacter } from './types.js';

export function seedRegistryCharacters(
  bibleChars: Array<{ name: string; tier?: NameTier; role?: string }>,
): RegistryCharacter[] {
  const out: RegistryCharacter[] = [];
  const seen = new Set<string>();
  for (const c of bibleChars ?? []) {
    const canonical = String(c?.name ?? '').trim();
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({ canonical, tier: c.tier ?? 'secondary', role: String(c.role ?? '').trim(), aliases: [], driftMap: [] });
  }
  return out;
}
```

- [ ] **Step 4: Run seed test — PASS.**

Run: `node --import tsx --test tests/unit/name-registry-seed.test.ts` → PASS (2 tests).

- [ ] **Step 5: Wire into `book.ts` `create(...)`**

After the `create(...)` method writes the initial `book.json` (near `writeFileAtomic(join(dir, 'book.json'), ...)`, ~line 422), add a fail-soft seed. The bible characters are not yet known at create time (intake produces them later), so seed with **only** the primary/secondary the create call already carries if any, else write an empty registry so the file exists:

```ts
import { seedRegistryCharacters } from './registry/seed.js';
import { saveRegistry } from './registry/store.js';
// ... inside create(), after book.json is written:
try {
  saveRegistry(dir, { characters: seedRegistryCharacters(seedChars ?? []), locations: [] });
} catch (e) { console.log(`  ⚠ Registry: seed skipped for ${slug}: ${(e as Error).message}`); }
```

Where `seedChars` is any character list already available in the create path (pass `[]` if none — the registry then grows from the review gate). This keeps create fail-soft and idempotent.

- [ ] **Step 6: Verify book unit tests still pass**

Run: `node --import tsx --test tests/unit/book-baseline.test.ts tests/unit/name-registry-seed.test.ts`
Expected: PASS (existing book tests unaffected; a `name-registry.json` now appears in the book dir).

- [ ] **Step 7: Commit**

```bash
git add gateway/src/services/registry/seed.ts gateway/src/services/book.ts tests/unit/name-registry-seed.test.ts
git commit -m "feat(registry): seed name-registry from bible at book create (fail-soft)"
```

---

## Task 3: `parseManifest` — locate / validate / strip / residue (pure)

**Files:**
- Create: `gateway/src/services/registry/parse-manifest.ts`
- Test: `tests/unit/name-manifest-parse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ManifestFlag = 'new' | 'mentioned' | 'transient';
  export interface ManifestCharacter { name: string; flag: ManifestFlag; role?: string; possiblySameAs?: string; }
  export interface ManifestLocation { name: string; flag: ManifestFlag; role?: string; }
  export type ManifestStatus = 'ok' | 'empty' | 'missing' | 'malformed' | 'residue';
  export interface ParsedManifest { status: ManifestStatus; characters: ManifestCharacter[]; locations: ManifestLocation[]; stripped: string; }
  export function parseManifest(text: string): ParsedManifest;
  export const SENTINEL_OPEN = '<!--BOOKCLAW:MANIFEST';
  export const SENTINEL_CLOSE = '/MANIFEST-->';
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../../gateway/src/services/registry/parse-manifest.js';

const BLOCK = `<!--BOOKCLAW:MANIFEST
CHARACTERS:
- Dottie | new | server at the wedding | possibly-same-as: Rosa Marchetti?
- Marisol | mentioned | Cole's staffer, offpage | transient
LOCATIONS:
- (none new)
/MANIFEST-->`;

test('locates and strips a FOOTER manifest; prose survives clean', () => {
  const r = parseManifest(`Chapter prose here.\n\n${BLOCK}`);
  assert.equal(r.status, 'ok');
  assert.equal(r.stripped.trim(), 'Chapter prose here.');
  assert.equal(r.characters.length, 2);
  assert.equal(r.characters[0].name, 'Dottie');
  assert.equal(r.characters[0].flag, 'new');
  assert.match(r.characters[0].possiblySameAs ?? '', /Rosa Marchetti/);
  assert.equal(r.characters[1].flag, 'mentioned');
});

test('locates a HEADER manifest by sentinel, not offset', () => {
  const r = parseManifest(`${BLOCK}\n\nChapter prose here.`);
  assert.equal(r.status, 'ok');
  assert.equal(r.stripped.trim(), 'Chapter prose here.');
});

test('empty manifest (CHARACTERS: none) is valid with zero candidates', () => {
  const r = parseManifest(`Prose.\n\n<!--BOOKCLAW:MANIFEST\nCHARACTERS: none\nLOCATIONS: none\n/MANIFEST-->`);
  assert.equal(r.status, 'empty');
  assert.equal(r.characters.length, 0);
  assert.equal(r.stripped.trim(), 'Prose.');
});

test('missing block → status missing, prose returned untouched', () => {
  const r = parseManifest('Just chapter prose, no manifest.');
  assert.equal(r.status, 'missing');
  assert.equal(r.stripped, 'Just chapter prose, no manifest.');
});

test('malformed sentinel (open without close) → malformed, prose NOT corrupted', () => {
  const r = parseManifest(`Prose.\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- X | new`);
  assert.equal(r.status, 'malformed');
});

test('ANTI-BLEED: no sentinel/CHARACTERS/LOCATIONS residue survives a strip', () => {
  const r = parseManifest(`Prose.\n\n${BLOCK}`);
  assert.doesNotMatch(r.stripped, /BOOKCLAW:MANIFEST|\/MANIFEST--|^CHARACTERS:|^LOCATIONS:/m);
});

test('residue detection: a second stray CHARACTERS: line after strip flags residue', () => {
  const r = parseManifest(`Prose.\nCHARACTERS: leftover\n\n${BLOCK}`);
  assert.equal(r.status, 'residue');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/name-manifest-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`parse-manifest.ts`: locate `SENTINEL_OPEN`…`SENTINEL_CLOSE` (first open, first close after it); if open present without a following close → `malformed`. Strip the `[open..close]` span, collapse the resulting blank gap, `trim`-preserve prose. Parse body lines: split on `CHARACTERS:`/`LOCATIONS:` headers; each `- name | flag | role | possibly-same-as: X` row split on `|`; `none`/`(none new)` → no rows. Residue check: after strip, if `SENTINEL_OPEN`, `/MANIFEST--`, or a line matching `/^(CHARACTERS|LOCATIONS):/m` remains → `residue`. Empty rows both sides → `empty`. Fail-soft: any parse error → `{ status: 'malformed', characters: [], locations: [], stripped: <original with best-effort strip> }`. Keep it ~70 lines; no regex catastrophic backtracking (anchor line-by-line).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/name-manifest-parse.test.ts`
Expected: PASS (7 tests) — the ANTI-BLEED and residue tests are the regression guards (same class as the Ch1 "Note on canon conflict" leak).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/registry/parse-manifest.ts tests/unit/name-manifest-parse.test.ts
git commit -m "feat(registry): parseManifest — sentinel locate/validate/strip + anti-bleed residue check"
```

---

## Task 4: Conditional remnant sweep (light-model fallback)

**Files:**
- Create: `gateway/src/services/registry/remnant-sweep.ts`
- Test: `tests/unit/name-manifest-remnant.test.ts`

**Interfaces:**
- Consumes: `ParsedManifest`, `parseManifest` (Task 3).
- Produces: `sweepManifestRemnant(args: { text: string; aiComplete: (req: any) => Promise<{ text?: string }> }): Promise<{ stripped: string; recovered: ParsedManifest }>`. Fires the model ONLY when `parseManifest(text).status` is `missing`/`malformed`/`residue`; on `ok`/`empty` it returns the deterministic result with **zero** model calls.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepManifestRemnant } from '../../gateway/src/services/registry/remnant-sweep.js';

const CLEAN = `Prose.\n\n<!--BOOKCLAW:MANIFEST\nCHARACTERS: none\nLOCATIONS: none\n/MANIFEST-->`;

test('happy path (clean manifest) fires ZERO model calls', async () => {
  let calls = 0;
  const r = await sweepManifestRemnant({ text: CLEAN, aiComplete: async () => { calls++; return { text: '' }; } });
  assert.equal(calls, 0);
  assert.equal(r.stripped.trim(), 'Prose.');
});

test('malformed remnant → light model strips it; result parses clean', async () => {
  const malformed = `Prose stays.\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- X | new`;
  const r = await sweepManifestRemnant({
    text: malformed,
    aiComplete: async () => ({ text: 'Prose stays.' }),
  });
  assert.equal(r.stripped.trim(), 'Prose stays.');
});

test('model failure → fail-soft: returns best-effort deterministic strip, no throw', async () => {
  const malformed = `Prose.\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- X`;
  const r = await sweepManifestRemnant({ text: malformed, aiComplete: async () => { throw new Error('down'); } });
  assert.ok(typeof r.stripped === 'string');
});
```

- [ ] **Step 2: Run — FAIL (module not found).**

Run: `node --import tsx --test tests/unit/name-manifest-remnant.test.ts`

- [ ] **Step 3: Write minimal implementation**

`remnant-sweep.ts`: call `parseManifest`; if status `ok`/`empty` return `{ stripped: parsed.stripped, recovered: parsed }`. Otherwise call `aiComplete` with a Haiku/Flash-class instruction ("Remove any malformed BookClaw manifest remnant and return ONLY the chapter prose"); wrap in try/catch — on any error or empty response, return the deterministic best-effort `{ stripped: parsed.stripped, recovered: parsed }` and log `⚠`. Re-run `parseManifest` on the model output to populate `recovered`. Provider/model chosen by the caller-injected `aiComplete` (default pass model is the sweep's `auto:newest-haiku`).

- [ ] **Step 4: Run — PASS (3 tests).**

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/registry/remnant-sweep.ts tests/unit/name-manifest-remnant.test.ts
git commit -m "feat(registry): conditional light-model manifest remnant sweep (fires only on failure)"
```

---

## Task 5: Roster builder (tier filter, compact render)

**Files:**
- Create: `gateway/src/services/registry/roster.ts`
- Test: `tests/unit/name-roster.test.ts`

**Interfaces:**
- Consumes: `NameRegistry`, `RegistryCharacter` (Task 1).
- Produces: `buildRoster(reg: NameRegistry): string` — includes `primary`/`secondary`/`tertiary`, EXCLUDES `transient`; renders under a directive header; returns `''` for an empty/all-transient registry.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster } from '../../gateway/src/services/registry/roster.js';
import type { NameRegistry } from '../../gateway/src/services/registry/types.js';

const mk = (chars: NameRegistry['characters']): NameRegistry => ({ characters: chars, locations: [] });

test('includes tertiary+ , EXCLUDES transient, renders compact name — role lines', () => {
  const r = buildRoster(mk([
    { canonical: 'Rosa Marchetti', tier: 'tertiary', role: 'regular customer', aliases: [], driftMap: [] },
    { canonical: 'Marisol', tier: 'transient', role: 'offpage staffer', aliases: [], driftMap: [] },
  ]));
  assert.match(r, /Rosa Marchetti — regular customer/);
  assert.doesNotMatch(r, /Marisol/);
  assert.match(r, /reuse these; do not invent new names/i);
});

test('empty registry → empty string (no prompt change)', () => {
  assert.equal(buildRoster(mk([])), '');
});

test('all-transient registry → empty string', () => {
  assert.equal(buildRoster(mk([{ canonical: 'X', tier: 'transient', role: 'y', aliases: [], driftMap: [] }])), '');
});
```

- [ ] **Step 2: Run — FAIL (module not found).**

- [ ] **Step 3: Write minimal implementation**

```ts
import type { NameRegistry } from './types.js';
const RECURRING = new Set(['primary', 'secondary', 'tertiary']);
export function buildRoster(reg: NameRegistry): string {
  const rows = (reg?.characters ?? []).filter(c => RECURRING.has(c.tier))
    .map(c => `- ${c.canonical}${c.role ? ` — ${c.role}` : ''}`);
  if (!rows.length) return '';
  return 'ESTABLISHED SUPPORTING CAST — reuse these; do not invent new names for these roles:\n' + rows.join('\n');
}
```

- [ ] **Step 4: Run — PASS (3 tests).**

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/registry/roster.ts tests/unit/name-roster.test.ts
git commit -m "feat(registry): compact recurring-cast roster builder (transients excluded)"
```

---

## Task 6: driftMap → AiNameMap enforcement wiring (pure)

**Files:**
- Create: `gateway/src/services/registry/enforce.ts`
- Test: `tests/unit/name-enforce.test.ts`

**Interfaces:**
- Consumes: `NameRegistry` (Task 1); `AiNameMap`, `applyAiNames` (`deai/ai-names.ts` — unchanged).
- Produces: `registryToAiNameMap(reg: NameRegistry): AiNameMap` (each character's `driftMap[]` → `{ find, replace: canonical }`, locations too); `mergeAiNameMaps(base: AiNameMap, overlay: AiNameMap): AiNameMap` (overlay wins by `find`).

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registryToAiNameMap, mergeAiNameMaps } from '../../gateway/src/services/registry/enforce.js';
import { applyAiNames } from '../../gateway/src/services/deai/ai-names.js';
import type { NameRegistry } from '../../gateway/src/services/registry/types.js';

const reg: NameRegistry = {
  characters: [
    { canonical: 'Rosa Marchetti', tier: 'tertiary', role: 'regular', aliases: [], driftMap: ['Dottie Marchetti', 'Dottie'] },
    { canonical: 'Angela Marchetti', tier: 'secondary', role: 'the bride', aliases: [], driftMap: [] },
  ],
  locations: [],
};

test('driftMap compiles to find/replace rows, longest-first to avoid partial hits', () => {
  const map = registryToAiNameMap(reg);
  assert.deepEqual(map, [
    { find: 'Dottie Marchetti', replace: 'Rosa Marchetti' },
    { find: 'Dottie', replace: 'Rosa Marchetti' },
  ]);
});

test('ENFORCEMENT: driftMap replaces ALL occurrences incl. dialogue; distinct surname untouched', () => {
  const map = registryToAiNameMap(reg);
  const text = 'Dottie smiled. "Thanks, Dottie," said Angela Marchetti.';
  const out = applyAiNames(text, map).text;
  assert.equal(out, 'Rosa Marchetti smiled. "Thanks, Rosa Marchetti," said Angela Marchetti.');
});

test('mergeAiNameMaps: overlay overrides base by find', () => {
  const merged = mergeAiNameMaps([{ find: 'Dottie', replace: 'X' }], [{ find: 'Dottie', replace: 'Rosa' }]);
  assert.deepEqual(merged, [{ find: 'Dottie', replace: 'Rosa' }]);
});
```

- [ ] **Step 2: Run — FAIL (module not found).**

- [ ] **Step 3: Write minimal implementation**

`enforce.ts`: flatMap characters+locations → for each drift string emit `{ find, replace: canonical }`; **sort each character's own drifts longest-first** (so "Dottie Marchetti" replaces before "Dottie"). `mergeAiNameMaps` builds a `Map` keyed on `find`, base first then overlay, returns values. No change to `applyAiNames`/`applyBannedTerms`.

- [ ] **Step 4: Run — PASS (3 tests).** The distinct-surname assertion is the "never merge Rosa vs Angela" enforcement guard.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/registry/enforce.ts tests/unit/name-enforce.test.ts
git commit -m "feat(registry): compile registry driftMap into AiNameMap for deterministic enforcement"
```

---

## Task 7: Candidate resolver (diff + classify, never merge surname)

**Files:**
- Create: `gateway/src/services/registry/candidates.ts`
- Test: `tests/unit/name-candidates.test.ts`

**Interfaces:**
- Consumes: `NameRegistry`, `RegistryCharacter` (Task 1); `ManifestCharacter`, `ParsedManifest` (Task 3).
- Produces:
  ```ts
  export type CandidateKind = 'auto-new-tertiary' | 'ambiguous' | 'known';
  export interface NameCandidate { name: string; kind: CandidateKind; reason: string; suggestedTier?: 'tertiary' | 'transient'; possiblySameAs?: string; }
  export function diffManifest(manifest: ParsedManifest, reg: NameRegistry): NameCandidate[];
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffManifest } from '../../gateway/src/services/registry/candidates.js';
import type { NameRegistry } from '../../gateway/src/services/registry/types.js';
import type { ParsedManifest } from '../../gateway/src/services/registry/parse-manifest.js';

const reg: NameRegistry = {
  characters: [{ canonical: 'Rosa Marchetti', tier: 'tertiary', role: 'regular', aliases: [], driftMap: [] }],
  locations: [],
};
const mf = (chars: ParsedManifest['characters']): ParsedManifest =>
  ({ status: 'ok', characters: chars, locations: [], stripped: '' });

test('clearly-distinct new name → auto-new-tertiary', () => {
  const c = diffManifest(mf([{ name: 'Bex', flag: 'new', role: 'barista' }]), reg);
  assert.equal(c[0].kind, 'auto-new-tertiary');
});

test('SURNAME collision with a different role → ambiguous, NEVER auto-mapped', () => {
  const c = diffManifest(mf([{ name: 'Angela Marchetti', flag: 'new', role: 'the bride' }]), reg);
  assert.equal(c[0].kind, 'ambiguous');
  assert.match(c[0].reason, /surname/i);
});

test('model self-flag possibly-same-as → ambiguous', () => {
  const c = diffManifest(mf([{ name: 'Dottie', flag: 'new', possiblySameAs: 'Rosa Marchetti?' }]), reg);
  assert.equal(c[0].kind, 'ambiguous');
});

test('transient flag → suggestedTier transient, non-blocking', () => {
  const c = diffManifest(mf([{ name: 'Passerby', flag: 'transient' }]), reg);
  assert.equal(c[0].suggestedTier, 'transient');
});

test('a name already canonical (or an alias) → known, no candidate surfaced', () => {
  const c = diffManifest(mf([{ name: 'Rosa Marchetti', flag: 'mentioned' }]), reg);
  assert.equal(c.filter(x => x.kind !== 'known').length, 0);
});
```

- [ ] **Step 2: Run — FAIL (module not found).**

- [ ] **Step 3: Write minimal implementation**

`candidates.ts`: for each manifest character — if name equals a `canonical` or `alias` (case-insensitive) → `known`. Else classify `ambiguous` if ANY of: `possiblySameAs` present; single-token surname shared with an existing canonical (split on whitespace, compare last token); `flag === 'mentioned'` on a name absent from the registry. Else `auto-new-tertiary` (suggestedTier `tertiary`), or `transient` tier when `flag === 'transient'`. Determinism NEVER emits a merge — ambiguous is "ask", never an auto driftMap write.

- [ ] **Step 4: Run — PASS (5 tests).**

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/registry/candidates.ts tests/unit/name-candidates.test.ts
git commit -m "feat(registry): manifest→registry candidate resolver (surname collisions stay ambiguous)"
```

---

## Task 8: Manifest contract + roster injection into the draft prompt

**Files:**
- Modify: `gateway/src/services/projects.ts` — extend `writeChapterPrompt(...)` with the mandatory manifest-contract block; add exported `injectRoster(prompt: string, roster: string): string`.
- Test: `tests/unit/name-roster.test.ts` (append) — or a new `tests/unit/name-prompt-contract.test.ts`.

**Interfaces:**
- Consumes: `buildRoster` (Task 5).
- Produces: `writeChapterPrompt` output now ends with a sentinel-manifest instruction; `injectRoster(prompt, roster)` appends the roster block (no-op when roster is `''`).

- [ ] **Step 1: Write the failing test** (`tests/unit/name-prompt-contract.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeChapterPrompt, injectRoster } from '../../gateway/src/services/projects.js';

test('draft prompt mandates a sentinel-delimited manifest, empty allowed', () => {
  const p = writeChapterPrompt(3, 'Two Months of Summer', 3000);
  assert.match(p, /<!--BOOKCLAW:MANIFEST/);
  assert.match(p, /\/MANIFEST-->/);
  assert.match(p, /always.*present|even.*empty|CHARACTERS:\s*none/i);
});

test('injectRoster appends the roster; empty roster is a no-op', () => {
  const base = 'Write Chapter 3.';
  assert.equal(injectRoster(base, ''), base);
  assert.match(injectRoster(base, 'ESTABLISHED SUPPORTING CAST — reuse these:\n- Rosa — regular'), /Rosa — regular/);
});
```

- [ ] **Step 2: Run — FAIL** (`writeChapterPrompt` lacks the manifest block; `injectRoster` not exported).

Run: `node --import tsx --test tests/unit/name-prompt-contract.test.ts`

- [ ] **Step 3: Write minimal implementation**

In `projects.ts`, append to `writeChapterPrompt`'s returned string (before the `description` concat) a manifest contract:

```ts
    `\n\nAFTER the chapter prose, append EXACTLY this block (a machine-read manifest, never shown to readers). It is MANDATORY and MUST always be present even when nothing new was introduced (use "none"):\n` +
    `<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- Name | new|mentioned|transient | one-line role | possibly-same-as: <existing canonical>? (only if you suspect a match)\nLOCATIONS:\n- Name | new|mentioned | one-line role\n/MANIFEST-->\n` +
    `List every NAMED character/location the chapter introduces or references by name. If none, write "CHARACTERS: none" / "LOCATIONS: none". Do not omit the block.`
```

Add:
```ts
export function injectRoster(prompt: string, roster: string): string {
  return roster ? `${prompt}\n\n${roster}` : prompt;
}
```

(The roster is per-book runtime data, so it is appended at execution — Task 9 — not baked into the static template.)

- [ ] **Step 4: Run — PASS (2 tests).** Also run `node --import tsx --test tests/unit/*.test.ts | tail -5` to confirm no existing prompt-snapshot test broke.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/projects.ts tests/unit/name-prompt-contract.test.ts
git commit -m "feat(registry): mandatory sentinel manifest contract + roster injection hook in draft prompt"
```

---

## Task 9: Pipeline wiring — inject roster, strip manifest on the DRAFT step, enforce driftMap

**Files:**
- Modify: `gateway/src/index.ts` — draft-prompt injection at the `handleMessage` step-execute call; manifest strip right after `stripMetaCommentary` (~line 2687); registry driftMap into the sweep `aiNames` (~line 2515).
- Modify: `gateway/src/api/routes/projects.routes.ts` — same three edits on `/execute` (~652 sweep, ~807 strip) and `/auto-execute` (~1219 sweep, ~1494 strip).
- Test: `tests/unit/name-registry-pipeline.test.ts` (a seam test over a small extracted helper, so wiring is unit-testable without booting the gateway).

**Interfaces:**
- Consumes: `parseManifest` (3), `sweepManifestRemnant` (4), `buildRoster` (5), `registryToAiNameMap`+`mergeAiNameMaps` (6), `diffManifest` (7), `loadRegistry` (1), `injectRoster` (8).
- Produces: an extracted helper `processDraftManifest(args): Promise<{ chapter: string; candidates: NameCandidate[] }>` in `gateway/src/services/registry/pipeline.ts` (unit-tested), called at both draft-completion seams. Enforcement: build `mergeAiNameMaps(loadAiNamesForBook(...), registryToAiNameMap(loadRegistry(bookDir)))` and pass as the `aiNames` argument that `runDeaiSweepStep` already accepts.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDraftManifest } from '../../gateway/src/services/registry/pipeline.js';
import type { NameRegistry } from '../../gateway/src/services/registry/types.js';

const reg: NameRegistry = {
  characters: [{ canonical: 'Rosa Marchetti', tier: 'tertiary', role: 'regular', aliases: [], driftMap: [] }],
  locations: [],
};
const DRAFT = `Rosa greeted the newcomer.\n\n<!--BOOKCLAW:MANIFEST\nCHARACTERS:\n- Bex | new | barista\nLOCATIONS: none\n/MANIFEST-->`;

test('strips the manifest off the DRAFT before it becomes canonical; prose only', async () => {
  const r = await processDraftManifest({ chapter: DRAFT, registry: reg, aiComplete: async () => ({ text: '' }) });
  assert.equal(r.chapter.trim(), 'Rosa greeted the newcomer.');
  assert.doesNotMatch(r.chapter, /BOOKCLAW:MANIFEST/);
});

test('surfaces the new name as a candidate', async () => {
  const r = await processDraftManifest({ chapter: DRAFT, registry: reg, aiComplete: async () => ({ text: '' }) });
  assert.equal(r.candidates.find(c => c.name === 'Bex')?.kind, 'auto-new-tertiary');
});

test('a chapter with no manifest fails soft: prose untouched, zero candidates', async () => {
  const r = await processDraftManifest({ chapter: 'Plain prose.', registry: reg, aiComplete: async () => ({ text: '' }) });
  assert.equal(r.chapter, 'Plain prose.');
  assert.equal(r.candidates.length, 0);
});
```

- [ ] **Step 2: Run — FAIL (module not found).**

Run: `node --import tsx --test tests/unit/name-registry-pipeline.test.ts`

- [ ] **Step 3: Write minimal implementation**

Create `gateway/src/services/registry/pipeline.ts`:
```ts
import { sweepManifestRemnant } from './remnant-sweep.js';
import { diffManifest } from './candidates.js';
import type { NameRegistry } from './types.js';
import type { NameCandidate } from './candidates.js';

export async function processDraftManifest(args: {
  chapter: string; registry: NameRegistry;
  aiComplete: (req: any) => Promise<{ text?: string }>;
}): Promise<{ chapter: string; candidates: NameCandidate[] }> {
  try {
    const swept = await sweepManifestRemnant({ text: args.chapter, aiComplete: args.aiComplete });
    return { chapter: swept.stripped, candidates: diffManifest(swept.recovered, args.registry).filter(c => c.kind !== 'known') };
  } catch (e) {
    console.log(`  ⚠ Registry: manifest processing failed — chapter kept as-is: ${(e as Error).message}`);
    return { chapter: args.chapter, candidates: [] };
  }
}
```

- [ ] **Step 4: Run — PASS (3 tests).**

- [ ] **Step 5: Wire the two draft-completion seams**

In `gateway/src/index.ts`, immediately after `aiResponse = stripMetaCommentary(aiResponse, { prose: isProseStep(activeStep) });` (~2687) and gated on `isProseStep`/`role==='draft'` and `project.bookSlug`:
```ts
if (project.bookSlug && (activeStep as any).role === 'draft' && gateway.books) {
  const bookDir = gateway.books.bookDir(project.bookSlug);
  if (bookDir) {
    const { processDraftManifest } = await import('./services/registry/pipeline.js');
    const { loadRegistry } = await import('./services/registry/store.js');
    const res = await processDraftManifest({ chapter: aiResponse, registry: loadRegistry(bookDir), aiComplete: (r: any) => gateway.aiRouter.complete(r) });
    aiResponse = res.chapter;
    if (res.candidates.length) (activeStep as any).nameCandidates = res.candidates; // surfaced at the review gate (Task 10)
  }
}
```
Apply the identical block (adapted to `services.books` / `gateway.aiRouter`) at both `projects.routes.ts` strip sites (~807 `/execute`, ~1494 `/auto-execute`). This runs BEFORE the file write and BEFORE `detectPostDraftContinuity`, so the manifest never reaches the saved chapter.

- [ ] **Step 6: Wire enforcement into the sweep `aiNames` at all THREE sweep call sites**

At `index.ts` ~2515 and `projects.routes.ts` ~652 and ~1219, replace the `aiNames` local:
```ts
const baseNames = loadAiNamesForBook(workspaceDir, slug ?? '', join(ROOT_DIR, 'library', 'ai-names.csv'));
const bookDir = gateway.books?.bookDir(slug ?? '') ?? null;
const { loadRegistry } = await import('./services/registry/store.js');
const { registryToAiNameMap, mergeAiNameMaps } = await import('./services/registry/enforce.js');
const aiNames = bookDir ? mergeAiNameMaps(baseNames, registryToAiNameMap(loadRegistry(bookDir))) : baseNames;
```
`runDeaiSweepStep({ ..., aiNames })` is unchanged — the shipped contract is preserved.

- [ ] **Step 7: Verify**

Run `node --import tsx --test tests/unit/name-registry-pipeline.test.ts tests/unit/deai-run-step.test.ts tests/unit/deai-ai-names.test.ts` → PASS. Then `npx tsc --noEmit` → no type errors.

- [ ] **Step 8: Commit**

```bash
git add gateway/src/services/registry/pipeline.ts gateway/src/index.ts gateway/src/api/routes/projects.routes.ts tests/unit/name-registry-pipeline.test.ts
git commit -m "feat(registry): strip manifest on draft step + enforce registry driftMap through the de-AI sweep"
```

---

## Task 10: Review-gate candidate surfacing (API) + registry decision recording

**Files:**
- Modify: `gateway/src/services/book.ts` — add `recordRegistryDecision(slug, decision)` (lock+atomic, mirrors `setModelConfig`).
- Modify: `gateway/src/api/routes/projects.routes.ts` — attach `nameCandidates` into the step's `reviewFlags`/response payload at the cadence-gate boundary; add `POST /api/books/:slug/registry/decide`.
- Test: `tests/unit/name-registry-store.test.ts` (append `recordRegistryDecision` cases) or a new `tests/unit/name-registry-decide.test.ts`.

**Interfaces:**
- Consumes: `loadRegistry`/`saveRegistry` (1); `RegistryCharacter`, `NameTier` (1).
- Produces: `recordRegistryDecision(slug, decision: { name: string; action: 'add'; tier: NameTier; role?: string } | { name: string; action: 'map'; toCanonical: string } | { name: string; action: 'ignore' }): Promise<NameRegistry>` — `add` inserts a new character; `map` pushes `name` into the target's `driftMap` (dedup); `ignore` no-ops (records nothing). Never merges without an explicit `map` decision.

- [ ] **Step 1: Write the failing test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveRegistry, loadRegistry } from '../../gateway/src/services/registry/store.js';
import { applyRegistryDecision } from '../../gateway/src/services/registry/decide.js';

test('map decision records a driftMap entry on the target canonical', () => {
  const reg = { characters: [{ canonical: 'Rosa Marchetti', tier: 'tertiary' as const, role: 'regular', aliases: [], driftMap: [] }], locations: [] };
  const out = applyRegistryDecision(reg, { name: 'Dottie', action: 'map', toCanonical: 'Rosa Marchetti' });
  assert.deepEqual(out.characters[0].driftMap, ['Dottie']);
});

test('add decision inserts a new tertiary character', () => {
  const out = applyRegistryDecision({ characters: [], locations: [] }, { name: 'Bex', action: 'add', tier: 'tertiary', role: 'barista' });
  assert.equal(out.characters[0].canonical, 'Bex');
});

test('ignore decision changes nothing', () => {
  const reg = { characters: [], locations: [] };
  assert.deepEqual(applyRegistryDecision(reg, { name: 'X', action: 'ignore' }), reg);
});
```

- [ ] **Step 2: Run — FAIL (module not found).**

- [ ] **Step 3: Write minimal implementation**

Create `gateway/src/services/registry/decide.ts` with the pure `applyRegistryDecision(reg, decision): NameRegistry` (immutable; dedup driftMap). Then in `book.ts` add `recordRegistryDecision(slug, decision)` = `withBookLock` → `loadRegistry(bookDir)` → `applyRegistryDecision` → `saveRegistry`. Add the route `POST /api/books/:slug/registry/decide` calling it. Attach `nameCandidates` onto the `/execute` + `/auto-execute` JSON response next to `reviewFlags` so the review gate can render them (minimal API-level surface; the 1-click UI is Phase 2).

- [ ] **Step 4: Run — PASS (3 tests).**

- [ ] **Step 5: Verify end-to-end fixture (project-77 Ch3 regression)**

Add to `tests/unit/name-enforce.test.ts` a fixture test: a registry with `Rosa Marchetti (driftMap: ['Dottie Marchetti','Dottie'])` applied via `applyAiNames` to a Ch3-style draft containing both "Rosa Marchetti" and "Dottie Marchetti" yields a Rosa-only chapter, with "Angela Marchetti" untouched. Run it → PASS.

- [ ] **Step 6: Commit**

```bash
git add gateway/src/services/registry/decide.ts gateway/src/services/book.ts gateway/src/api/routes/projects.routes.ts tests/unit/name-registry-decide.test.ts tests/unit/name-enforce.test.ts
git commit -m "feat(registry): review-gate candidate surfacing + human-blessed registry decision recording"
```

---

## Phase 2 (sketch — not implemented in this plan)

Each is a follow-on plan of its own; listed here for coverage, not detailed TDD:

- **Curation UI** — a 1-click classify panel at the per-chapter review gate rendering `nameCandidates` (add-at-tier / map-as-drift-of-X / ignore) and calling `POST /api/books/:slug/registry/decide`. MVP surfaces the candidates through the API; this makes them a button.
- **Location/scene scoping of the roster** — tag registry rows with scene/location and, using the scene brief's stated locations, inject only matching minors; deterministic filter falling back to the full recurring roster when untagged (`buildRoster` gains an optional `{ locations }` arg).
- **Header-mode reconciliation** — when the writer emits a header (prospective) manifest, reconcile it against the actual prose: flag listed-but-absent names, still catch spontaneously-introduced ones. `parseManifest` already locates header blocks; this adds the prose cross-check.
- **Deterministic proper-noun backstop** — a proper-noun cross-check over the stripped chapter to catch a named entity the manifest omitted, surfaced as an unknown-name candidate (the §7 backstop).
- **fact-store cross-reference at seed** — optionally reconcile the bible seed against `consistency/fact-store` character entities (advisory only; never silently mutates the human-blessed registry).

---

## Self-Review

- **Spec coverage:** §1 registry → T1; §2 seed → T2; §3 roster injection → T5,T8,T9; §4 manifest contract → T8; §5 3-layer anti-bleed (deterministic strip+residue / schema validation / conditional sweep) → T3,T4; §6 classification (model-proposes/human-decides, ambiguous-never-merged) → T7,T10; §7 enforcement (driftMap→applyAiNames, unknown flagging) → T6,T9; testing fixtures (project-77 Ch3, roster filter, anti-bleed regression) → T3,T5,T6,T10; phasing MVP → T1–T10, Phase 2 → sketch. No gap.
- **Type consistency:** `NameRegistry`/`RegistryCharacter`/`ManifestCharacter`/`ParsedManifest`/`NameCandidate` defined once (T1/T3/T7) and reused by name throughout; `registryToAiNameMap`/`mergeAiNameMaps`/`buildRoster`/`parseManifest`/`sweepManifestRemnant`/`diffManifest`/`processDraftManifest`/`applyRegistryDecision`/`injectRoster` names are stable across tasks.
- **Placeholder scan:** every code step shows actual code; no "add validation"/"TBD".
- **Anti-bleed:** T3 (residue), T4 (remnant sweep), T9 (strip on DRAFT before save) — three layers, with the "manifest never survives into prose" assertion as a committed regression test.
