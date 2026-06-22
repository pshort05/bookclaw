# World Repository Phase 4 — World-Aware Authoring Editor

> **For agentic workers:** This plan conforms to the shared contract in `docs/superpowers/plans/2026-06-21-world-repository-00-index-and-contract.md`. Use the exact type names, signatures, file paths, and storage layout defined there. If you need a name not defined in the contract, that is a contract gap — stop and reconcile, do not invent a divergent name. This plan depends on **Phase 1** (`WorldService`, `LibraryWorld`, `WorldDocCatalogRow`, `listDocuments`, `createDocument`/`updateDocument`, `world-types.ts`) and **Phase 2** (the `luminarch-adept` editor asset + `shattered-cradle` world for realistic testing).

**Spec:** `docs/superpowers/specs/2026-06-21-world-repository-design.md` §6 "Section 3 — Authoring assistant" (APPROVED).

## Goal

Make an editor session **world-aware**: when the channel's active editor is some world's `authoringEditor` (e.g. `luminarch-adept`), prime that editor's effective system prompt with the world's authoring context — `formatDirective`, `documentTypes`, `clearanceLevels`, `domains`, and the document catalog (title/type/summary/tags from `WorldService.listDocuments`) — so it drafts in the world's narrative-only, classification-headered format and stays continuity-aware. Then let the editor's proposed document write back into the world's `documents/` overlay via `WorldService.createDocument` (classification auto-assigned), where the owner reviewing the draft and clicking save **is** the approval gate.

## Architecture

This phase reuses the existing editor system and `WorldService` end to end. The only genuinely new code is:

1. A **pure composer** (`composeWorldAuthoringContext`) that turns a `LibraryWorld` + its `WorldDocCatalogRow[]` into one priming string.
2. A **new optional `worldContext` field** on `composeEditorPrompt`'s `ctx`, injected as a `# World authoring context` section placed after the manuscript block and before the memory block (mirrors the existing field handling exactly).
3. **Threading** in `index.ts`: when the channel's active editor name equals some world's `authoringEditor`, resolve that world's config + catalog, build the context string, and pass it as `worldContext` into `buildSystemPrompt`.
4. A **write-back helper** (`POST /api/worlds/:name/documents` already exists from Phase 1) plus a thin authoring helper that maps an editor's proposed-document message into a `WorldService.createDocument` call. The owner-initiated save IS the approval — no new gate.

No parallel editor system, no new `ActiveEditor` state, no `ConfirmationGateService` involvement (write into the user's own world overlay is internal and reversible; the owner reviewing the draft is the gate).

## Tech Stack

- Node 22+, TypeScript via `tsx` (no dev compile). Type-check with `npx tsc --noEmit`.
- Express + Socket.IO gateway (`gateway/src/index.ts`), editor prompt composer (`gateway/src/services/editor-prompt.ts`), `WorldService` (`gateway/src/services/world.ts`, Phase 1).
- Tests: `node --import tsx --test tests/unit/*.test.ts` (`npm run test:unit`).

## Global Constraints (apply to every task in every plan)

- **Node 22+**; TypeScript runs through `tsx` (no compile step in dev). Type-check with `npx tsc --noEmit`.
- **Imports use `.js` extensions** even from `.ts` source (NodeNext). Match this in every new file.
- **No new runtime dependency** for parsing. Frontmatter is hand-parsed in-repo (see `gateway/src/skills/loader.ts:182`); the world-doc parser follows that line-based idiom, extended for inline `tags: [a, b]` arrays. Do not add `js-yaml`/`gray-matter`.
- **Fail-soft init/runtime.** Services log `  ✓ … / ⚠ … / ℹ …` and degrade rather than crash (matches `index.ts` and `BookService`). A bad `world.json` or bad document frontmatter loads as "needs attention", never throws at boot.
- **`schemaVersion` gating.** `world.json` and each document carry a `schemaVersion`; `WORLD_SCHEMA_VERSION = 1`. Too-new → read-only/quarantine, mirroring `classifyVersion` in `book-types.ts`. Additive optional fields on `book.json` do **not** bump its schema.
- **Commit workflow.** This repo uses a `commit_message` + `./push.sh` workflow — the maintainer commits; **do not run `git commit` / `git push`**. Each task ends at a verified, type-checking state (tests green + `npx tsc --noEmit` clean). At milestone end, write the one-line-summary-plus-dashes `commit_message` per `CLAUDE.md`. (This overrides the writing-plans skill's literal `git commit` step, per user-instruction priority.)
- **Surgical changes.** Touch only what the task requires; match existing style.
- **Docs are professional Markdown, no emojis/icons.**
- **Tests are committed and re-runnable.** Unit tests: `tests/unit/*.test.ts` via `node --import tsx --test` (`npm run test:unit`). Smoke tests: `tests/*.sh` (mirror `tests/board-grouping-smoke.sh`). Both runner styles already exist; the CLAUDE.md "no unit-test suite" line is stale.

## File Structure

```
gateway/src/services/
  world-authoring.ts          # NEW — pure composer composeWorldAuthoringContext(world, catalog)
                              #        + proposed-document → createDocument input mapper
  world.ts                    # Phase 1 — WorldService (consumed, not modified here)
  world-types.ts              # Phase 1 — LibraryWorld, WorldDocCatalogRow, WorldDocMeta (consumed)
  editor-prompt.ts            # EDIT — add optional ctx.worldContext, inject # World authoring context section
gateway/src/
  index.ts                    # EDIT — thread world context into buildSystemPrompt for the authoring editor
gateway/src/api/routes/
  worlds.routes.ts            # Phase 1 — POST /api/worlds/:name/documents already exists (write-back path)
tests/unit/
  world-authoring.test.ts     # NEW — composer output + proposed-doc → createDocument mapping
  editor-prompt.test.ts       # EDIT — add worldContext injection/placement cases
```

---

### Task 1: `worldContext` field on `composeEditorPrompt`

Add an optional `worldContext` string to the editor-prompt composer, injected as a `# World authoring context` section. Placement: after the `# Active book context` manuscript block, before the `# Recent conversation context` memory block — so world canon/format framing precedes transient memory, mirroring how the manuscript block precedes memory today.

**Files**
- `gateway/src/services/editor-prompt.ts` (EDIT)
- `tests/unit/editor-prompt.test.ts` (EDIT)

**Interfaces**

Consumes: nothing new (a plain string built by Task 2's composer).

Produces (modified signature — additive optional field, existing callers unaffected):
```ts
export function composeEditorPrompt(
  editorPrompt: string,
  ctx: { memories?: string; heartbeat?: string; manuscript?: string; worldContext?: string },
  mode?: EditorMode,
): string;
```

**TDD steps**

- [ ] Add a failing test to `tests/unit/editor-prompt.test.ts`: `composeWorldContext injects the # World authoring context section` — `composeEditorPrompt('You are Jorin.', { worldContext: 'FORMAT: narrative only' })` includes `# World authoring context` and `FORMAT: narrative only`; an absent/blank `worldContext` adds nothing.
- [ ] Add a failing placement test: with `{ manuscript: 'BOOK', worldContext: 'WORLD', memories: 'MEM' }`, assert `indexOf('# Active book context') < indexOf('# World authoring context') < indexOf('# Recent conversation context')`.
- [ ] Run `npm run test:unit -- ` (or `node --import tsx --test tests/unit/editor-prompt.test.ts`) → **FAIL** (`worldContext` not handled; section missing).
- [ ] Implement in `gateway/src/services/editor-prompt.ts`. Extend the `ctx` type and add the injection block between the manuscript block and the memory block:

```ts
export function composeEditorPrompt(
  editorPrompt: string,
  ctx: { memories?: string; heartbeat?: string; manuscript?: string; worldContext?: string },
  mode: EditorMode = 'brainstorm',
): string {
  let p = editorPrompt.trim();
  p += `\n\n${MODE_DIRECTIVE[mode] ?? MODE_DIRECTIVE.brainstorm}`;
  if (ctx.manuscript && ctx.manuscript.trim()) {
    p += `\n\n# Active book context\n${ctx.manuscript.trim()}`;
  }
  if (ctx.worldContext && ctx.worldContext.trim()) {
    p += `\n\n# World authoring context\n${ctx.worldContext.trim()}`;
  }
  if (ctx.memories && ctx.memories.trim()) {
    p += `\n\n# Recent conversation context\n${ctx.memories.trim()}`;
  }
  if (ctx.heartbeat && ctx.heartbeat.trim()) {
    p += `\n\n${ctx.heartbeat.trim()}`;
  }
  return p;
}
```

Also update the function's leading docblock comment so the field list stays accurate (one line: the world authoring context block follows the active-book block).

- [ ] Run the editor-prompt tests → **PASS**.
- [ ] `npx tsc --noEmit` → clean.

---

### Task 2: `composeWorldAuthoringContext` — the pure composer

A pure function that turns a `LibraryWorld` config + its document catalog into the priming string injected as `worldContext`. It must surface the `formatDirective`, the `documentTypes` (id + label + note), the `clearanceLevels`, the `domains`, and a catalog list (title / type / summary / tags per doc). Pure and deterministic — no I/O, no AI — so it is unit-testable directly.

**Files**
- `gateway/src/services/world-authoring.ts` (NEW)
- `tests/unit/world-authoring.test.ts` (NEW)

**Interfaces**

Consumes (from `world-types.ts`, Phase 1):
```ts
import type { LibraryWorld, WorldDocCatalogRow } from './world-types.js';
```

Produces:
```ts
export function composeWorldAuthoringContext(
  world: LibraryWorld,
  catalog: WorldDocCatalogRow[],
): string;
// Deterministic priming string: format directive + document-type vocabulary +
// clearance levels + domains + classification scheme + a lightweight catalog
// (title/type/summary/tags, no bodies). Empty catalog → still emits the config
// sections plus an explicit "no documents yet" catalog line.
```

**TDD steps**

- [ ] Create a failing test `tests/unit/world-authoring.test.ts`. Build a fixture `LibraryWorld` (the Shattered-Cradle shape: `formatDirective: 'Narrative prose only, never bullet lists.'`, `documentTypes: [{ id: 'field-guide', label: 'Field Guide', note: 'practical' }]`, `clearanceLevels: ['General Access', 'Cloister-Only']`, `domains: ['GEO', 'SHD']`, `classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}'`) and a one-row catalog (`title: 'The Geography of the Shattered Cradle'`, `type: 'field-guide'`, `summary: "A traveler's guide…"`, `tags: ['geography', 'travel']`, `classification: 'FG-GEO-0141'`). Assert the output `includes` each of: the `formatDirective` text, the document-type label `Field Guide`, a clearance level `Cloister-Only`, a domain `SHD`, the catalog title `The Geography of the Shattered Cradle`, and a tag `geography`.
- [ ] Add a failing empty-catalog test: `composeWorldAuthoringContext(world, [])` still includes the `formatDirective` and the document-type label, and includes a literal "no documents" marker line (so the editor knows the repository is empty rather than that the catalog was omitted).
- [ ] Run `node --import tsx --test tests/unit/world-authoring.test.ts` → **FAIL** (module does not exist).
- [ ] Implement `gateway/src/services/world-authoring.ts`:

```ts
/**
 * world-authoring — make an editor session world-aware. Two pure helpers:
 *
 *  - composeWorldAuthoringContext: turns a world's config (format directive +
 *    type/clearance/domain taxonomy + classification scheme) and its document
 *    catalog (title/type/summary/tags — no bodies) into one priming string,
 *    injected into the authoring editor's prompt as the `worldContext` section
 *    (see composeEditorPrompt). Deterministic; no I/O, no AI.
 *
 *  - proposedDocToCreateInput: maps a reviewed proposed-document payload into the
 *    shape WorldService.createDocument expects, leaving `classification` unset so
 *    the service auto-assigns the next free serial.
 */
import type { LibraryWorld, WorldDocCatalogRow, WorldDocMeta } from './world-types.js';

export function composeWorldAuthoringContext(
  world: LibraryWorld,
  catalog: WorldDocCatalogRow[],
): string {
  const lines: string[] = [];
  const label = world.label ?? world.name;
  lines.push(`You are authoring documents for the world **${label}**. Follow this world's format and taxonomy exactly.`);

  lines.push('');
  lines.push('## Format directive');
  lines.push(world.formatDirective.trim());

  lines.push('');
  lines.push('## Document types (the `type` field must be one of these ids)');
  for (const t of world.documentTypes) {
    lines.push(`- ${t.id} — ${t.label}${t.note ? ` (${t.note})` : ''}`);
  }

  lines.push('');
  lines.push(`## Clearance levels: ${world.clearanceLevels.join(', ')}`);
  lines.push(`## Domains: ${world.domains.join(', ')}`);
  lines.push(`## Classification scheme: ${world.classificationScheme} (serial auto-assigned on save — do not invent the number)`);

  lines.push('');
  lines.push('## Existing documents (catalog — search these for continuity before drafting)');
  if (catalog.length === 0) {
    lines.push('(no documents yet — this is a new repository)');
  } else {
    for (const d of catalog) {
      const tags = d.tags.length ? ` [${d.tags.join(', ')}]` : '';
      lines.push(`- ${d.classification} · ${d.type} · ${d.title} — ${d.summary}${tags}`);
    }
  }

  return lines.join('\n');
}

/**
 * Map a reviewed proposed document into WorldService.createDocument's input.
 * `classification` is intentionally omitted so the service auto-assigns the next
 * free serial for the TYPE-DOMAIN pair (per the contract). The owner saving the
 * reviewed draft is the approval gate — no separate confirmation gate.
 */
export interface ProposedDocument {
  title: string;
  type: string;
  clearance: string;
  domain: string;
  attribution?: string;
  tags?: string[];
  summary: string;
  appendixEligible?: boolean;
  body: string;
}

export function proposedDocToCreateInput(
  proposed: ProposedDocument,
): { meta: Omit<WorldDocMeta, 'classification'>; body: string } {
  return {
    meta: {
      title: proposed.title,
      type: proposed.type,
      clearance: proposed.clearance,
      domain: proposed.domain,
      attribution: proposed.attribution,
      tags: proposed.tags ?? [],
      summary: proposed.summary,
      appendixEligible: proposed.appendixEligible,
    },
    body: proposed.body,
  };
}
```

- [ ] Run `node --import tsx --test tests/unit/world-authoring.test.ts` → **PASS**.
- [ ] `npx tsc --noEmit` → clean.

---

### Task 3: Thread world authoring context into the editor session

When the channel's active editor name equals some world's `authoringEditor`, resolve that world's config + catalog, build the context string via `composeWorldAuthoringContext`, and pass it as `worldContext` to `buildSystemPrompt`. This is the only `index.ts` change. It is fail-soft: any failure resolving the world simply omits the world context (the editor still runs with its persona prompt).

**Files**
- `gateway/src/index.ts` (EDIT — the editor-mode block around lines 620-708 and the `buildSystemPrompt` signature around lines 1032-1056)

**Interfaces**

Consumes:
- `this.editors?.getChannelEditor(channel)` → `ActiveEditor | null` (existing).
- `this.worlds` → `WorldService` (Phase 1 provides `public worlds!: WorldService` on the gateway, mirroring `public books!` / `public editors!` at `index.ts:193-194`). Methods used: `list()`, `getConfig(name)`, `listDocuments(name)` (contract signatures).
- `composeWorldAuthoringContext(world, catalog)` (Task 2).

Produces (modified `buildSystemPrompt` context — additive optional field):
```ts
public buildSystemPrompt(context: {
  /* …existing fields… */
  editorPrompt?: string;
  editorMode?: EditorMode;
  manuscript?: string;
  worldContext?: string;   // NEW — passed through to composeEditorPrompt
}): string;
```

**TDD steps**

- [ ] **Helper extraction (testable seam).** Add a small private method on the gateway that resolves the world context for an editor name, so the threading is unit-testable without booting the whole gateway. Add a failing test in `tests/unit/world-authoring.test.ts` for a pure resolver helper instead — extract the lookup logic into `world-authoring.ts` so it can be tested directly:

```ts
// world-authoring.ts — add:
export function worldForAuthoringEditor(
  editorName: string,
  worlds: Array<{ name: string }>,
  getConfig: (name: string) => LibraryWorld | undefined,
): LibraryWorld | undefined {
  for (const w of worlds) {
    const cfg = getConfig(w.name);
    if (cfg?.authoringEditor === editorName) return cfg;
  }
  return undefined;
}
```

Failing test: given `worlds = [{ name: 'shattered-cradle' }]` and a `getConfig` returning a `LibraryWorld` with `authoringEditor: 'luminarch-adept'`, `worldForAuthoringEditor('luminarch-adept', …)` returns that config; `worldForAuthoringEditor('some-other-editor', …)` returns `undefined`.

- [ ] Run `node --import tsx --test tests/unit/world-authoring.test.ts` → **FAIL** (`worldForAuthoringEditor` not exported).
- [ ] Implement `worldForAuthoringEditor` in `gateway/src/services/world-authoring.ts` (signature above). Run the test → **PASS**.
- [ ] **Thread it in `index.ts`.** In the editor-mode block (after `const editorCfg = activeEditor ? this.editors!.get(activeEditor.editor) : null;` at line 626), build the world context. Fail-soft, only when an editor is active:

```ts
// World-aware authoring: if the active editor is some world's authoringEditor,
// prime the prompt with that world's format/taxonomy + document catalog so the
// editor drafts in-format and stays continuity-aware. Fail-soft: any miss just
// omits the world context — it never blocks the reply.
let editorWorldContext: string | undefined;
if (activeEditor && this.worlds) {
  try {
    const cfg = worldForAuthoringEditor(
      activeEditor.editor,
      this.worlds.list(),
      (name) => this.worlds!.getConfig(name),
    );
    if (cfg) {
      editorWorldContext = composeWorldAuthoringContext(cfg, this.worlds.listDocuments(cfg.name));
    }
  } catch { /* best-effort: omit world context on any failure */ }
}
```

Then pass it through in the `buildSystemPrompt({ … })` call (line 697-708), inside the existing `editorCfg ? { … } : {}` spread so it only attaches in editor mode:

```ts
...(editorCfg ? { editorPrompt: editorCfg.systemPrompt, editorMode: activeEditor!.mode, manuscript: editorManuscript, worldContext: editorWorldContext } : {}),
```

- [ ] **Accept it in `buildSystemPrompt`.** Add `worldContext?: string;` to the `context` parameter type (after `manuscript?: string;`, line 1044) and forward it in the editor-mode early return (line 1050-1056):

```ts
if (context.editorPrompt) {
  return composeEditorPrompt(context.editorPrompt, {
    memories: context.memories,
    heartbeat: context.heartbeatContext,
    manuscript: context.manuscript,
    worldContext: context.worldContext,
  }, context.editorMode);
}
```

- [ ] Add the imports at the top of `index.ts` alongside the existing editor-prompt import: `import { composeWorldAuthoringContext, worldForAuthoringEditor } from './services/world-authoring.js';` (verify the `composeEditorPrompt` import line and add adjacent — match the existing import grouping/style).
- [ ] Run `npm run test:unit` (full suite) → **PASS** (no existing editor test regresses; `worldContext` is additive-optional).
- [ ] `npx tsc --noEmit` → clean.

> **Note on the greeting path.** `generateEditorGreeting` (`index.ts:999-1030`) also calls `composeEditorPrompt` but passes only `{ heartbeat }`. Threading world context into the greeting is **optional and out of scope** for the deliverable (the greeting is a 2-4 sentence in-character hello, not a drafting turn). Leave it untouched — do not gold-plate. If desired later, the same `worldForAuthoringEditor` + `composeWorldAuthoringContext` two-liner applies.

---

### Task 4: Write-back — proposed document → `createDocument`

On approval, the editor's proposed document saves into the world's `documents/` overlay. The write path is `POST /api/worlds/:name/documents` — which **Phase 1 already created** and which auto-classifies when `classification` is omitted. The owner reviewing the draft and issuing the save IS the approval gate; this phase adds no new gate and does not touch `ConfirmationGateService`. The only new code here is wiring the proposed-document payload (built by the UI/caller from the editor's reply) through `proposedDocToCreateInput` (Task 2) into `WorldService.createDocument`, exercised by a unit test against a temp world.

**Files**
- `tests/unit/world-authoring.test.ts` (EDIT — add the write-back round-trip test)
- No production-code change beyond Task 2's `proposedDocToCreateInput`; the route and `WorldService.createDocument` already exist (Phase 1).

**Interfaces**

Consumes (Phase 1 contract):
```ts
WorldService.createDocument(
  name: string,
  input: { meta: Omit<WorldDocMeta,'classification'> & { classification?: string }; body: string },
): WorldDocument;   // auto-classifies when classification omitted
```

Produces: nothing new — this task verifies the composition (`proposedDocToCreateInput` → `createDocument`) end-to-end.

**TDD steps**

- [ ] Add a failing write-back test in `tests/unit/world-authoring.test.ts`. Pattern after `tests/unit/book.test.ts` / `book-worldbuilding.test.ts` for temp-dir setup (`mkdtemp` under `os.tmpdir()`, seed a minimal world via the library overlay, instantiate `WorldService`). Steps:
  1. Create a temp library overlay with a `shattered-cradle` world: `world.json` (one `documentTypes` entry `field-guide`, `domains: ['GEO']`, `classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}'`, `clearanceLevels`, `formatDirective`) and an empty `documents/` dir.
  2. Build a `ProposedDocument` (title/type `field-guide`/clearance/domain `GEO`/summary/body, no classification).
  3. `const created = world.createDocument('shattered-cradle', proposedDocToCreateInput(proposed));`
  4. Assert `created.meta.classification` matches `/^FG-GEO-\d{4}$/` (auto-assigned — exact prefix per Phase 1's TYPE derivation; assert the shape, not a hardcoded serial) and `created.meta.title` / `created.body` round-trip the proposed payload.
  5. Assert `world.listDocuments('shattered-cradle')` now contains a catalog row for the created doc (write actually landed in the overlay).
- [ ] Run `node --import tsx --test tests/unit/world-authoring.test.ts` → **FAIL** (until Task 2's `proposedDocToCreateInput` exists and is imported; if Task 2 is already green, this fails only on the assertions until the test fixture is correct).
- [ ] With `proposedDocToCreateInput` (Task 2) in place and `WorldService` from Phase 1, run the test → **PASS**.
- [ ] `npx tsc --noEmit` → clean.

> **API note.** No new route. `worlds.routes.ts` `POST /api/worlds/:name/documents` (Phase 1) is the write-back endpoint. If the caller posts the proposed-document fields directly as the document `meta` + `body`, the route already auto-classifies; `proposedDocToCreateInput` is the shaping seam for any server-side caller (e.g. a future editor-message parser) that wants to reuse the mapping. Do not add a second create route.

---

## Self-Review

- **Scope matches the deliverable.** The plan delivers exactly Phase 4: world-aware editor session (format/taxonomy + catalog priming) and write-back into the world overlay with auto-classification. Nothing from Phases 1/2/3/5/6 is re-implemented.
- **Contract conformance.** Uses the contract's exact names: `LibraryWorld`, `WorldDocCatalogRow`, `WorldDocMeta`, `WorldDocument`, `WorldService.list/getConfig/listDocuments/createDocument`, `authoringEditor`, `formatDirective`, `documentTypes`, `clearanceLevels`, `domains`, `classificationScheme`, and the `POST /api/worlds/:name/documents` write path. The only new symbols (`composeWorldAuthoringContext`, `proposedDocToCreateInput`, `worldForAuthoringEditor`, `worldContext`) are net-new for this phase — not redefinitions of contract names, so they are not contract gaps.
- **Surgical.** `editor-prompt.ts` gains one optional field + one injection block (mirrors the existing manuscript block); `index.ts` gains one fail-soft resolution block in the editor path, one passthrough field, and two imports; `world-authoring.ts` is the one new file. No refactors of adjacent code. The greeting path is explicitly left alone with a rationale (no gold-plating).
- **No over-engineered gate.** Per the spec and the task brief, write into the user's own world overlay is internal/reversible — the owner-initiated save is the gate. `ConfirmationGateService` is correctly NOT used; no new gate is invented.
- **TDD throughout.** Every task is failing-test → FAIL → real implementation (full code shown, no placeholders) → PASS → `npx tsc --noEmit`. Required tests are all present: composer-output-contains-everything (formatDirective/documentTypes/clearanceLevels/domains/catalog), `composeEditorPrompt` injects `worldContext` in the right place, and write-back (proposed doc → `createDocument` with auto-classification) against a temp world.
- **Constraints honored.** `.js` imports, no new runtime dependency, fail-soft world resolution (try/catch omits context, never throws), additive-optional fields (no schema bump, existing callers unaffected). `commit_message` + `push.sh` workflow — no literal `git commit`/`git push`.
- **Dependency boundary is explicit.** Phase 1 (`WorldService`, `world-types.ts`, the documents route) and Phase 2 (`luminarch-adept` + `shattered-cradle`) are named as prerequisites; this plan consumes their contract signatures and does not modify Phase 1 production code beyond reading it.
- **Open assumption (flagged, not silently resolved):** the gateway field for the world service is taken as `public worlds!: WorldService` to mirror `public books!` / `public editors!` (`index.ts:193-194`). If Phase 1 names it differently (e.g. `worldService`), Task 3's `this.worlds` references must be renamed to match — a one-token change, not a design change. Confirm against the Phase 1 plan before executing Task 3.
