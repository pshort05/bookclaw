# Visual Drag-and-Drop Pipeline Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Asset Studio's form-style pipeline editor into a visual drag-and-drop builder (palette + drag-reorder + drag into/out of groups), plus drag-reorder on SequenceEditor.

**Architecture:** A keyed node model (`lib/pipelineEdits.ts`) holds the pipeline steps as `Node[]` (plain steps and groups with members, each with a stable key); all drag gestures resolve to pure transforms on that model, and Save serializes back to the exact JSON shapes the gateway already expands. dnd-kit provides the drag mechanics; generic wrappers live in `components/asset/dnd/`, palette content in `StepPalette.tsx` + `lib/stepPresets.ts`.

**Tech Stack:** React 18, TypeScript, Vite, `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (new, studio workspace only), `node:test` via tsx.

**Spec:** `docs/superpowers/specs/2026-07-06-visual-pipeline-builder-design.md`

## Global Constraints

- **No gateway changes, no new API endpoints.** Frontend workspace `frontend/studio` only (plus `tests/unit/`).
- **No git commits by the implementer.** This repo's workflow: the maintainer commits via `./push.sh` using the repo-root `commit_message` file. Tasks end at verification; the final task writes `commit_message`.
- **Imports use `.js` extensions** (NodeNext) even from `.ts`/`.tsx` sources.
- Pure logic files in `frontend/studio/src/lib/` must not import React, dnd-kit, or anything with runtime side effects — only `import type` from `@bookclaw/shared` — so they run under `node --import tsx --test`.
- Preset `taskType` values must be keys of `TASK_TIERS` in `gateway/src/ai/router.ts` (`general`, `research`, `creative_writing`, `revision`, `style_analysis`, `marketing`, `outline`, `book_bible`, `consistency`, `final_edit`).
- Nested groups are invalid: a group (or palette block) must never land inside a group. Transforms return the input unchanged for invalid moves.
- Dynamic pipelines (`pipeline.dynamic`) stay read-only — no palette, no drag (the existing early-return already handles this).
- Match existing style: CSS in `AssetStudio.module.css` (terse single-line rules), inline `style={{...}}` objects for one-offs, `styles.xxx` class references.
- Unit test command: `node --import tsx --test tests/unit/<file>.test.ts`. Studio build: `npm run -w frontend/studio build` (runs `tsc -b` then Vite). Full suite: `npm run test:unit`.

---

### Task 1: Node model in `lib/pipelineEdits.ts` (fromSteps / toSteps / lookups)

**Files:**
- Create: `frontend/studio/src/lib/pipelineEdits.ts`
- Test: `tests/unit/pipeline-edits.test.ts`

**Interfaces:**
- Consumes: `EditorStep`, `isExpand`, `isParallel` from `frontend/studio/src/lib/pipelineSteps.js`; `LibraryPipelineStep` from `@bookclaw/shared` (type-only).
- Produces (used by Tasks 2, 5, 6):
  - `type GroupKind = 'expand' | 'parallel'`
  - `interface StepNode { key: string; kind: 'step'; step: LibraryPipelineStep }`
  - `interface GroupNode { key: string; kind: GroupKind; members: StepNode[] }`
  - `type Node = StepNode | GroupNode`
  - `isGroupNode(n: Node): n is GroupNode`
  - `fromSteps(steps: EditorStep[], mkKey: () => string): Node[]`
  - `toSteps(nodes: Node[]): EditorStep[]`
  - `findByKey(nodes: Node[], key: string): Node | undefined`
  - `containerOf(nodes: Node[], key: string): string | undefined | null` — `undefined` = top level, group key = member, `null` = not found
  - `indexIn(nodes: Node[], containerKey: string | undefined, key: string): number`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/pipeline-edits.test.ts`:

```ts
/**
 * Pure-transform tests for the visual pipeline builder's node model
 * (frontend/studio/src/lib/pipelineEdits.ts). Every drag gesture in the studio
 * resolves to one of these functions, so this file is the behavioral contract:
 * round-trip fidelity to the gateway's pipeline JSON shapes, and rejection of
 * invalid moves (groups inside groups).
 * Run: node --import tsx --test tests/unit/pipeline-edits.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromSteps, toSteps, findByKey, containerOf, indexIn, isGroupNode,
} from '../../frontend/studio/src/lib/pipelineEdits.js';
import type { EditorStep } from '../../frontend/studio/src/lib/pipelineSteps.js';

const mkCounter = () => { let i = 0; return () => `k${i++}`; };
const step = (label: string) => ({ label, taskType: 'general', promptTemplate: '' });

const SAMPLE: EditorStep[] = [
  step('a'),
  { parallel: [step('p1'), step('p2')] },
  { expand: 'chapters', steps: [step('c1')] },
  step('z'),
];

test('fromSteps/toSteps round-trips all three shapes', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  assert.equal(nodes.length, 4);
  assert.deepEqual(nodes.map((n) => n.kind), ['step', 'parallel', 'expand', 'step']);
  assert.deepEqual(toSteps(nodes), SAMPLE);
});

test('fromSteps assigns unique keys to every node and member', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const keys = nodes.flatMap((n) => [n.key, ...(isGroupNode(n) ? n.members.map((m) => m.key) : [])]);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, 7); // 4 top-level + 3 members
});

test('findByKey resolves top-level nodes and group members', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  const m0 = par.members[0];
  assert.equal(findByKey(nodes, nodes[0].key), nodes[0]);
  assert.equal(findByKey(nodes, m0.key), m0);
  assert.equal(findByKey(nodes, 'nope'), undefined);
});

test('containerOf: top level = undefined, member = group key, missing = null', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  assert.equal(containerOf(nodes, nodes[0].key), undefined);
  assert.equal(containerOf(nodes, par.members[1].key), par.key);
  assert.equal(containerOf(nodes, 'nope'), null);
});

test('indexIn finds position within a container', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  assert.equal(indexIn(nodes, undefined, nodes[3].key), 3);
  assert.equal(indexIn(nodes, par.key, par.members[1].key), 1);
  assert.equal(indexIn(nodes, undefined, 'nope'), -1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/unit/pipeline-edits.test.ts`
Expected: FAIL — `Cannot find module '.../frontend/studio/src/lib/pipelineEdits.js'`

- [ ] **Step 3: Write the implementation**

Create `frontend/studio/src/lib/pipelineEdits.ts`:

```ts
// Keyed node model + pure transforms for the visual pipeline builder.
// Only type-only imports here so everything runs under node:test (see
// fileTree.ts / pipelineSteps.ts for the pattern). The editor holds Node[]
// as its working state; toSteps() serializes back to the exact JSON shapes
// the gateway's pipeline-expand.ts consumes.
import type { LibraryPipelineStep } from '@bookclaw/shared';
import { isExpand, isParallel, type EditorStep } from './pipelineSteps.js';

export type GroupKind = 'expand' | 'parallel';
export interface StepNode { key: string; kind: 'step'; step: LibraryPipelineStep }
export interface GroupNode { key: string; kind: GroupKind; members: StepNode[] }
export type Node = StepNode | GroupNode;

export const isGroupNode = (n: Node): n is GroupNode => n.kind !== 'step';

export function fromSteps(steps: EditorStep[], mkKey: () => string): Node[] {
  return (steps ?? []).map((e): Node => {
    const wrap = (s: LibraryPipelineStep): StepNode => ({ key: mkKey(), kind: 'step', step: s });
    if (isExpand(e)) return { key: mkKey(), kind: 'expand', members: e.steps.map(wrap) };
    if (isParallel(e)) return { key: mkKey(), kind: 'parallel', members: e.parallel.map(wrap) };
    return wrap(e as LibraryPipelineStep);
  });
}

export function toSteps(nodes: Node[]): EditorStep[] {
  return nodes.map((n): EditorStep => {
    if (n.kind === 'step') return n.step;
    const steps = n.members.map((m) => m.step);
    return n.kind === 'expand' ? { expand: 'chapters', steps } : { parallel: steps };
  });
}

export function findByKey(nodes: Node[], key: string): Node | undefined {
  for (const n of nodes) {
    if (n.key === key) return n;
    if (isGroupNode(n)) {
      const m = n.members.find((m) => m.key === key);
      if (m) return m;
    }
  }
  return undefined;
}

/** Container of `key`: undefined = top level, group key = member, null = not found. */
export function containerOf(nodes: Node[], key: string): string | undefined | null {
  for (const n of nodes) {
    if (n.key === key) return undefined;
    if (isGroupNode(n) && n.members.some((m) => m.key === key)) return n.key;
  }
  return null;
}

/** Index of `key` within a container's children (-1 if absent). */
export function indexIn(nodes: Node[], containerKey: string | undefined, key: string): number {
  if (containerKey === undefined) return nodes.findIndex((n) => n.key === key);
  const g = nodes.find((n) => n.key === containerKey);
  return g && isGroupNode(g) ? g.members.findIndex((m) => m.key === key) : -1;
}
```

Note: `fromSteps`/`toSteps` preserve unknown extra keys on plain steps (kept by object reference) but not on group wrappers — the schema defines no other group keys, and no built-in pipeline has any.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/pipeline-edits.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Type-check**

Run: `npm run -w frontend/studio build`
Expected: clean build (the file compiles; nothing imports it yet)

---

### Task 2: Transforms in `lib/pipelineEdits.ts` (reorder / insert / remove / regroup / patch)

**Files:**
- Modify: `frontend/studio/src/lib/pipelineEdits.ts` (append)
- Test: `tests/unit/pipeline-edits.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's model.
- Produces (used by Tasks 5, 6):
  - `reorder(nodes: Node[], containerKey: string | undefined, from: number, to: number): Node[]`
  - `insertTop(nodes: Node[], index: number, node: Node): Node[]`
  - `insertMember(nodes: Node[], groupKey: string, index: number, member: StepNode): Node[]`
  - `removeByKey(nodes: Node[], key: string): Node[]`
  - `moveIntoGroup(nodes: Node[], stepKey: string, groupKey: string, index?: number): Node[]`
  - `extractFromGroup(nodes: Node[], memberKey: string, topIndex: number): Node[]`
  - `patchStep(nodes: Node[], key: string, patch: Partial<LibraryPipelineStep>): Node[]`

All transforms are pure (return new arrays; never mutate) and return the input array unchanged for invalid operations.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/pipeline-edits.test.ts` (extend the import list with `reorder, insertTop, insertMember, removeByKey, moveIntoGroup, extractFromGroup, patchStep`):

```ts
test('reorder moves within the top level (arrayMove semantics)', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const out = reorder(nodes, undefined, 0, 2);
  assert.deepEqual(out.map((n) => n.key), [nodes[1].key, nodes[2].key, nodes[0].key, nodes[3].key]);
  assert.equal(reorder(nodes, undefined, 0, 0), nodes); // no-op returns input
  assert.equal(reorder(nodes, undefined, 0, 99), nodes); // out of range
});

test('reorder moves within a group', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  const out = reorder(nodes, par.key, 0, 1);
  const outPar = out[1];
  assert.ok(isGroupNode(outPar));
  assert.deepEqual(outPar.members.map((m) => m.step.label), ['p2', 'p1']);
  assert.deepEqual((nodes[1] as typeof par).members.map((m) => m.step.label), ['p1', 'p2']); // input untouched
});

test('insertTop clamps the index; insertMember targets one group', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const extra = { key: 'new1', kind: 'step' as const, step: step('new') };
  assert.equal(insertTop(nodes, 99, extra).at(-1), extra);
  assert.equal(insertTop(nodes, -5, extra)[0], extra);
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  const out = insertMember(nodes, par.key, 1, extra);
  const outPar = out[1];
  assert.ok(isGroupNode(outPar));
  assert.deepEqual(outPar.members.map((m) => m.step.label), ['p1', 'new', 'p2']);
});

test('removeByKey removes at either level', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  assert.equal(removeByKey(nodes, nodes[0].key).length, 3);
  const out = removeByKey(nodes, par.members[0].key);
  const outPar = out[1];
  assert.ok(isGroupNode(outPar));
  assert.deepEqual(outPar.members.map((m) => m.step.label), ['p2']);
});

test('moveIntoGroup moves a top-level step in (default: append) and rejects groups', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  const exp = nodes[2];
  assert.ok(isGroupNode(par) && isGroupNode(exp));
  const out = moveIntoGroup(nodes, nodes[0].key, par.key);
  assert.equal(out.length, 3); // 'a' left the top level
  const outPar = out.find((n) => n.key === par.key);
  assert.ok(outPar && isGroupNode(outPar));
  assert.deepEqual(outPar.members.map((m) => m.step.label), ['p1', 'p2', 'a']);
  // a group can never become a member
  assert.equal(moveIntoGroup(nodes, exp.key, par.key), nodes);
});

test('moveIntoGroup also moves a member between groups at an index', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  const exp = nodes[2];
  assert.ok(isGroupNode(par) && isGroupNode(exp));
  const out = moveIntoGroup(nodes, par.members[0].key, exp.key, 0);
  const outPar = out.find((n) => n.key === par.key);
  const outExp = out.find((n) => n.key === exp.key);
  assert.ok(outPar && isGroupNode(outPar) && outExp && isGroupNode(outExp));
  assert.deepEqual(outPar.members.map((m) => m.step.label), ['p2']);
  assert.deepEqual(outExp.members.map((m) => m.step.label), ['p1', 'c1']);
});

test('extractFromGroup pulls a member to the top level; emptied groups survive', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const exp = nodes[2];
  assert.ok(isGroupNode(exp));
  const out = extractFromGroup(nodes, exp.members[0].key, 0);
  assert.equal(out.length, 5);
  assert.equal((out[0] as { step: { label: string } }).step.label, 'c1');
  const outExp = out.find((n) => n.key === exp.key);
  assert.ok(outExp && isGroupNode(outExp));
  assert.equal(outExp.members.length, 0);
  // an emptied group still serializes (gateway skips empty groups at expand time)
  assert.deepEqual(toSteps(out)[3], { expand: 'chapters', steps: [] });
  // extracting a top-level node is a no-op
  assert.equal(extractFromGroup(nodes, nodes[0].key, 0), nodes);
});

test('patchStep patches at either level without mutating', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  const out = patchStep(nodes, par.members[0].key, { label: 'renamed' });
  const outPar = out[1];
  assert.ok(isGroupNode(outPar));
  assert.equal(outPar.members[0].step.label, 'renamed');
  assert.equal(par.members[0].step.label, 'p1');
  const out2 = patchStep(nodes, nodes[0].key, { taskType: 'revision' });
  assert.equal((out2[0] as { step: { taskType: string } }).step.taskType, 'revision');
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --import tsx --test tests/unit/pipeline-edits.test.ts`
Expected: FAIL — `reorder` (etc.) has no exported member

- [ ] **Step 3: Write the implementation**

Append to `frontend/studio/src/lib/pipelineEdits.ts`:

```ts
function arrayMove<T>(xs: T[], from: number, to: number): T[] {
  if (from < 0 || from >= xs.length || to < 0 || to >= xs.length || from === to) return xs;
  const next = [...xs];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Reorder within one container (top level when containerKey is undefined). */
export function reorder(nodes: Node[], containerKey: string | undefined, from: number, to: number): Node[] {
  if (containerKey === undefined) return arrayMove(nodes, from, to);
  let changed = false;
  const out = nodes.map((n) => {
    if (n.key !== containerKey || !isGroupNode(n)) return n;
    const members = arrayMove(n.members, from, to);
    if (members === n.members) return n;
    changed = true;
    return { ...n, members };
  });
  return changed ? out : nodes;
}

export function insertTop(nodes: Node[], index: number, node: Node): Node[] {
  const i = Math.max(0, Math.min(index, nodes.length));
  return [...nodes.slice(0, i), node, ...nodes.slice(i)];
}

export function insertMember(nodes: Node[], groupKey: string, index: number, member: StepNode): Node[] {
  return nodes.map((n) => {
    if (n.key !== groupKey || !isGroupNode(n)) return n;
    const i = Math.max(0, Math.min(index, n.members.length));
    return { ...n, members: [...n.members.slice(0, i), member, ...n.members.slice(i)] };
  });
}

export function removeByKey(nodes: Node[], key: string): Node[] {
  return nodes
    .filter((n) => n.key !== key)
    .map((n) => isGroupNode(n) && n.members.some((m) => m.key === key)
      ? { ...n, members: n.members.filter((m) => m.key !== key) }
      : n);
}

/** Move a plain step (from the top level or another group) into a group. Rejects group nodes. */
export function moveIntoGroup(nodes: Node[], stepKey: string, groupKey: string, index?: number): Node[] {
  const node = findByKey(nodes, stepKey);
  const group = nodes.find((n) => n.key === groupKey);
  if (!node || node.kind !== 'step' || !group || !isGroupNode(group)) return nodes;
  const without = removeByKey(nodes, stepKey);
  const g = without.find((n) => n.key === groupKey);
  if (!g || !isGroupNode(g)) return nodes;
  return insertMember(without, groupKey, index ?? g.members.length, node);
}

/** Pull a group member out to the top level at topIndex. No-op for non-members. */
export function extractFromGroup(nodes: Node[], memberKey: string, topIndex: number): Node[] {
  const node = findByKey(nodes, memberKey);
  const container = containerOf(nodes, memberKey);
  if (!node || node.kind !== 'step' || typeof container !== 'string') return nodes;
  return insertTop(removeByKey(nodes, memberKey), topIndex, node);
}

/** Patch the LibraryPipelineStep of a plain step or group member. */
export function patchStep(nodes: Node[], key: string, patch: Partial<LibraryPipelineStep>): Node[] {
  return nodes.map((n) => {
    if (n.kind === 'step') return n.key === key ? { ...n, step: { ...n.step, ...patch } } : n;
    if (!n.members.some((m) => m.key === key)) return n;
    return { ...n, members: n.members.map((m) => m.key === key ? { ...m, step: { ...m.step, ...patch } } : m) };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/pipeline-edits.test.ts`
Expected: PASS (13 tests)

---

### Task 3: Preset catalog `lib/stepPresets.ts` + palette factories

**Files:**
- Create: `frontend/studio/src/lib/stepPresets.ts`
- Test: `tests/unit/step-presets.test.ts`

**Interfaces:**
- Consumes: `Node`, `StepNode`, `GroupKind` from `./pipelineEdits.js` (Task 1).
- Produces (used by Task 6):
  - `interface StepPreset { key: string; label: string; taskType: string; phase?: string; promptTemplate: string }`
  - `const STEP_PRESETS: StepPreset[]`
  - `type PaletteItem = { type: 'preset'; key: string } | { type: 'skill'; name: string } | { type: 'block'; kind: GroupKind }`
  - `paletteId(item: PaletteItem): string` — stable DnD id, `pal:` prefixed
  - `parsePaletteId(id: string): PaletteItem | null`
  - `nodeFromPalette(item: PaletteItem, mkKey: () => string): Node | null`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/step-presets.test.ts`:

```ts
/**
 * Guards for the visual pipeline builder's palette catalog
 * (frontend/studio/src/lib/stepPresets.ts): every preset taskType must be a
 * real TASK_TIERS key in the gateway AI router (so a router rename cannot
 * silently orphan a preset), and the palette-id codec + node factory must
 * round-trip every item kind.
 * Run: node --import tsx --test tests/unit/step-presets.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STEP_PRESETS, paletteId, parsePaletteId, nodeFromPalette, type PaletteItem,
} from '../../frontend/studio/src/lib/stepPresets.js';
import { isGroupNode } from '../../frontend/studio/src/lib/pipelineEdits.js';

test('every preset taskType is a TASK_TIERS key in the gateway router', () => {
  const src = readFileSync(join(process.cwd(), 'gateway/src/ai/router.ts'), 'utf-8');
  const block = src.match(/const TASK_TIERS[^=]*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(block, 'TASK_TIERS block found in router.ts');
  const keys = [...block![1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 10, `parsed TASK_TIERS keys (${keys.length})`);
  for (const p of STEP_PRESETS) {
    assert.ok(keys.includes(p.taskType), `preset "${p.key}" taskType "${p.taskType}" is canonical`);
  }
});

test('presets have unique keys and non-empty labels', () => {
  assert.equal(new Set(STEP_PRESETS.map((p) => p.key)).size, STEP_PRESETS.length);
  for (const p of STEP_PRESETS) assert.ok(p.label.trim());
});

test('paletteId/parsePaletteId round-trip every item kind', () => {
  const items: PaletteItem[] = [
    { type: 'preset', key: STEP_PRESETS[0].key },
    { type: 'skill', name: 'romance-humanize' },
    { type: 'block', kind: 'parallel' },
    { type: 'block', kind: 'expand' },
  ];
  for (const item of items) assert.deepEqual(parsePaletteId(paletteId(item)), item);
  assert.equal(parsePaletteId('step-7'), null);
  assert.equal(parsePaletteId('pal:block:bogus'), null);
});

test('nodeFromPalette builds the right node per item kind', () => {
  let i = 0;
  const mk = () => `n${i++}`;
  const preset = nodeFromPalette({ type: 'preset', key: STEP_PRESETS[0].key }, mk);
  assert.ok(preset && preset.kind === 'step');
  assert.equal(preset.step.taskType, STEP_PRESETS[0].taskType);
  const skill = nodeFromPalette({ type: 'skill', name: 'my-skill' }, mk);
  assert.ok(skill && skill.kind === 'step');
  assert.equal(skill.step.skill, 'my-skill');
  assert.equal(skill.step.label, 'my-skill');
  const block = nodeFromPalette({ type: 'block', kind: 'parallel' }, mk);
  assert.ok(block && isGroupNode(block));
  assert.equal(block.members.length, 0);
  assert.equal(nodeFromPalette({ type: 'preset', key: 'no-such' }, mk), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/unit/step-presets.test.ts`
Expected: FAIL — `Cannot find module '.../stepPresets.js'`

- [ ] **Step 3: Write the implementation**

Create `frontend/studio/src/lib/stepPresets.ts`:

```ts
// Palette catalog for the visual pipeline builder. Presets land with a real
// gateway taskType (TASK_TIERS key — guarded by tests/unit/step-presets.test.ts)
// so a non-technical author never types a task-type string. Pure data +
// factories; no React/dnd imports so it runs under node:test.
import type { GroupKind, Node, StepNode } from './pipelineEdits.js';

export interface StepPreset {
  key: string; label: string; taskType: string; phase?: string; promptTemplate: string;
}

export const STEP_PRESETS: StepPreset[] = [
  {
    key: 'outline', label: 'Chapter outline', taskType: 'outline', phase: 'outline',
    promptTemplate: 'Create a detailed chapter-by-chapter outline for "{{title}}" ({{chapterCount}} chapters). For each chapter: title, POV, key beats, and how it advances the plot.',
  },
  {
    key: 'book-bible', label: 'Book bible', taskType: 'book_bible', phase: 'worldbuilding',
    promptTemplate: 'Build the book bible for "{{title}}": world rules, settings, factions, and a character bible with profiles, motivations, relationships, and arcs.',
  },
  {
    key: 'draft-chapter', label: 'Draft chapter', taskType: 'creative_writing', phase: 'draft',
    promptTemplate: 'Write chapter {{n}} of "{{title}}" (about {{wordsPerChapter}} words). Follow the chapter outline and stay true to the character bible and world bible in your context.',
  },
  {
    key: 'critique', label: 'Critique pass', taskType: 'revision', phase: 'critique',
    promptTemplate: "Critique the previous step's output: strengths, weaknesses, and specific, actionable improvements. Do not rewrite — list the changes to make.",
  },
  {
    key: 'rewrite', label: 'Rewrite pass', taskType: 'revision', phase: 'rewrite',
    promptTemplate: 'Rewrite the draft applying the critique from the previous step. Preserve plot, characters, and voice; output the complete revised text.',
  },
  {
    key: 'consistency', label: 'Consistency check', taskType: 'consistency', phase: 'critique',
    promptTemplate: 'Check the previous output against the book bible and outline for contradictions (names, timeline, world rules, character knowledge). Report each issue with its location.',
  },
  {
    key: 'final-edit', label: 'Final edit', taskType: 'final_edit', phase: 'assembly',
    promptTemplate: 'Perform a final editorial polish: clarity, flow, word choice, and surface errors. Preserve meaning and voice; output the complete polished text.',
  },
  {
    key: 'marketing', label: 'Marketing copy', taskType: 'marketing', phase: 'assembly',
    promptTemplate: 'Write a back-cover blurb and a one-paragraph pitch for "{{title}}" based on the manuscript and outline in context.',
  },
  {
    key: 'blank', label: 'Blank step', taskType: 'general',
    promptTemplate: '',
  },
];

export type PaletteItem =
  | { type: 'preset'; key: string }
  | { type: 'skill'; name: string }
  | { type: 'block'; kind: GroupKind };

export function paletteId(item: PaletteItem): string {
  if (item.type === 'preset') return `pal:preset:${item.key}`;
  if (item.type === 'skill') return `pal:skill:${item.name}`;
  return `pal:block:${item.kind}`;
}

export function parsePaletteId(id: string): PaletteItem | null {
  if (!id.startsWith('pal:')) return null;
  const rest = id.slice(4);
  if (rest.startsWith('preset:')) return { type: 'preset', key: rest.slice(7) };
  if (rest.startsWith('skill:')) return { type: 'skill', name: rest.slice(6) };
  if (rest === 'block:parallel' || rest === 'block:expand') {
    return { type: 'block', kind: rest.slice(6) as GroupKind };
  }
  return null;
}

/** Build the Node a palette item drops into the flow. Returns null for unknown presets. */
export function nodeFromPalette(item: PaletteItem, mkKey: () => string): Node | null {
  if (item.type === 'block') return { key: mkKey(), kind: item.kind, members: [] };
  if (item.type === 'skill') {
    const step: StepNode = {
      key: mkKey(), kind: 'step',
      step: { label: item.name, taskType: 'creative_writing', promptTemplate: '', skill: item.name },
    };
    return step;
  }
  const p = STEP_PRESETS.find((x) => x.key === item.key);
  if (!p) return null;
  return {
    key: mkKey(), kind: 'step',
    step: {
      label: p.label, taskType: p.taskType, promptTemplate: p.promptTemplate,
      ...(p.phase ? { phase: p.phase } : {}),
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/step-presets.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Type-check**

Run: `npm run -w frontend/studio build`
Expected: clean build

---

### Task 4: Install dnd-kit + generic DnD primitives

**Files:**
- Modify: `frontend/studio/package.json` (via npm install)
- Create: `frontend/studio/src/components/asset/dnd/Sortable.tsx`

**Interfaces:**
- Consumes: dnd-kit packages.
- Produces (used by Tasks 6, 7):
  - `useDndSensors()` — pointer (6px activation distance) + keyboard sensors
  - `SortableRow({ id, children })` — one sortable row; provides handle context
  - `DragHandle({ title? })` — the ⠿ grip; must be rendered inside a `SortableRow`
  - `DndList({ ids, onMove, children })` — flat list with its own `DndContext` + `SortableContext`; `onMove(from, to)` fires with original-array indices

- [ ] **Step 1: Install the dependency (studio workspace, devDependencies like all studio deps)**

Run: `npm install -D -w frontend/studio @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
Expected: `frontend/studio/package.json` devDependencies gains the three packages; root `package-lock.json` updated. Verify with: `npm ls -w frontend/studio @dnd-kit/core`

- [ ] **Step 2: Create the primitives**

Create `frontend/studio/src/components/asset/dnd/Sortable.tsx`:

```tsx
// Generic dnd-kit wrappers for the Asset Studio. Nothing pipeline-specific:
// SequenceEditor uses DndList (flat list, own DndContext); PipelineEditor
// builds its own DndContext (palette + nested group containers) out of
// useDndSensors + SortableRow + DragHandle.
import { createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import {
  DndContext, PointerSensor, KeyboardSensor, useSensor, useSensors, closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface HandleBindings { attributes: Record<string, unknown>; listeners: Record<string, unknown> | undefined }
const HandleCtx = createContext<HandleBindings | null>(null);

export function useDndSensors() {
  return useSensors(
    // 6px activation distance so plain clicks (accordion toggle) never start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

/** One sortable row. Render a <DragHandle/> somewhere inside to grip it. */
export function SortableRow({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <HandleCtx.Provider value={{ attributes, listeners }}>{children}</HandleCtx.Provider>
    </div>
  );
}

export function DragHandle({ title = 'Drag to move' }: { title?: string }) {
  const ctx = useContext(HandleCtx);
  if (!ctx) return null;
  return (
    <button
      type="button"
      {...ctx.attributes}
      {...ctx.listeners}
      title={title}
      onClick={(e) => e.stopPropagation()}
      style={{ cursor: 'grab', background: 'transparent', border: 'none', color: 'var(--faint)', padding: '2px 6px', fontSize: 14, lineHeight: 1, touchAction: 'none', flex: 'none' }}
    >⠿</button>
  );
}

/** Flat sortable list with its own DndContext. onMove gets original-array indices. */
export function DndList({ ids, onMove, children }: {
  ids: string[];
  onMove: (from: number, to: number) => void;
  children: ReactNode;
}) {
  const sensors = useDndSensors();
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onMove(from, to);
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext>
    </DndContext>
  );
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run -w frontend/studio build`
Expected: clean build (nothing renders these yet; tree-shaken but type-checked by `tsc -b`)

---

### Task 5: Refactor PipelineEditor onto the node model (behavior-identical, no DnD yet)

**Files:**
- Modify: `frontend/studio/src/components/asset/PipelineEditor.tsx`

**Interfaces:**
- Consumes: everything from `lib/pipelineEdits.js` (Tasks 1–2). `StepFields`, save path, and rendering stay as-is.
- Produces: PipelineEditor state = `nodes: Node[]` + `openKeys: Set<string>`; all handlers key-addressed. Task 6 builds DnD on exactly this state shape.

This is a pure internal refactor: after it, the editor must look and behave exactly as before (accordion, ↑/↓/Remove, add step/sub-step, save). The `stepIds` parallel array, index-keyed `openSteps`, and all index-remapping logic disappear — keys live on the nodes.

- [ ] **Step 1: Replace state, load, and handlers**

In `PipelineEditor.tsx`:

Replace the imports of `pipelineSteps.js` and add `pipelineEdits.js`:

```tsx
import { isExpand, isParallel, type EditorStep } from '../../lib/pipelineSteps.js';
```
becomes
```tsx
import {
  fromSteps, toSteps, reorder, insertTop, insertMember, removeByKey, patchStep,
  isGroupNode, type Node, type StepNode,
} from '../../lib/pipelineEdits.js';
```

Replace the state block

```tsx
  const [pipeline, setPipeline] = useState<LibraryPipeline | null>(null);
  const [description, setDescription] = useState('');
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set());
  // Stable per-step React keys, parallel to pipeline.steps and remapped on every
  // structural edit — array index alone mis-associates focus/open-state on reorder.
  const [stepIds, setStepIds] = useState<string[]>([]);
  const nextId = useRef(0);
  const mkId = () => `step-${nextId.current++}`;
```
with
```tsx
  const [pipeline, setPipeline] = useState<LibraryPipeline | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [description, setDescription] = useState('');
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const nextId = useRef(0);
  const mkId = () => `step-${nextId.current++}`;
```

In the load effect, replace

```tsx
        setPipeline(pl);
        setStepIds(pl.steps.map(() => mkId()));
```
with
```tsx
        setPipeline(pl);
        setNodes(fromSteps(pl.steps, mkId));
        setOpenKeys(new Set());
```

Replace ALL of `setStep`, `setSubStep` (and its `patchGroup` helper), `addSubStep`, `removeSubStep`, `addStep`, `removeStep`, `moveStep`, `toggleStep` with key-addressed versions:

```tsx
  function patchNode(key: string, patch: Partial<LibraryPipelineStep>) {
    setNodes((ns) => patchStep(ns, key, patch));
    mark();
  }

  function addStep() {
    setNodes((ns) => insertTop(ns, ns.length, { key: mkId(), kind: 'step', step: BLANK_STEP() }));
    mark();
  }

  function addSubStep(groupKey: string) {
    setNodes((ns) => {
      const g = ns.find((n) => n.key === groupKey);
      const at = g && isGroupNode(g) ? g.members.length : 0;
      return insertMember(ns, groupKey, at, { key: mkId(), kind: 'step', step: BLANK_STEP() });
    });
    mark();
  }

  function removeNode(key: string) {
    setNodes((ns) => removeByKey(ns, key));
    setOpenKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });
    mark();
  }

  function moveTop(i: number, dir: -1 | 1) {
    setNodes((ns) => reorder(ns, undefined, i, i + dir));
    mark();
  }

  function toggleOpen(key: string) {
    setOpenKeys((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }
```

In `handleSave`, replace

```tsx
      const serialized = JSON.stringify({ ...pipeline, description }, null, 2);
```
with
```tsx
      const serialized = JSON.stringify({ ...pipeline, steps: toSteps(nodes), description }, null, 2);
```

- [ ] **Step 2: Rewrite the render loop over nodes**

Replace the header line `· Pipeline · {pipeline.steps.length} steps` with `· Pipeline · {nodes.length} steps`, and the `<div className={styles.steplbl}>… {pipeline.steps.length}` count with `{nodes.length}`.

Replace the whole `{(pipeline.steps as EditorStep[]).map((entry, i) => { … })}` block with:

```tsx
          {nodes.map((node, i) => {
            const isOpen = openKeys.has(node.key);
            const moveBtns = (
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button
                  onClick={() => moveTop(i, -1)}
                  disabled={i === 0}
                  title="Move up"
                  style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--dim)', cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.4 : 1 }}
                >↑</button>
                <button
                  onClick={() => moveTop(i, 1)}
                  disabled={i === nodes.length - 1}
                  title="Move down"
                  style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--dim)', cursor: i === nodes.length - 1 ? 'not-allowed' : 'pointer', opacity: i === nodes.length - 1 ? 0.4 : 1 }}
                >↓</button>
                <button
                  onClick={() => removeNode(node.key)}
                  title="Remove step"
                  style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--alert)', cursor: 'pointer', marginLeft: 'auto' }}
                >Remove</button>
              </div>
            );

            if (isGroupNode(node)) {
              const chapter = node.kind === 'expand';
              return (
                <div key={node.key} className={`${styles.step}${isOpen ? ' ' + styles.open : ''}`}>
                  <div className={styles.srow} onClick={() => toggleOpen(node.key)}>
                    <span className={styles.snum}>{i + 1}</span>
                    <span className={styles.sname}>{chapter ? 'Repeat per chapter' : 'Run in parallel'}</span>
                    <span className={styles.sctrl}>
                      <span className={styles.pill}>{chapter ? 'expand · chapters' : 'parallel'}</span>
                      <span className={`${styles.pill} ${styles.wc}`}>{node.members.length} sub-step{node.members.length === 1 ? '' : 's'}</span>
                    </span>
                    <svg className={styles.chev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  {isOpen && (
                    <div className={styles.sbody} style={{ borderLeft: '2px solid var(--line-2)', paddingLeft: 14 }}>
                      <p style={{ color: 'var(--faint)', fontSize: 12, margin: '0 0 14px' }}>
                        {chapter ? (
                          <>These sub-steps run once per chapter at generation time. Use <code>{'{{n}}'}</code> for the chapter number and <code>{'{{wordsPerChapter}}'}</code>, <code>{'{{title}}'}</code> in templates.</>
                        ) : (
                          <>These sub-steps run concurrently at generation time; the step after this group is the implicit join and sees every member's output in its context.</>
                        )}
                      </p>
                      {node.members.map((sub) => (
                        <div key={sub.key} className={styles.step} style={{ marginBottom: 12 }}>
                          <div className={styles.sbody}>
                            <StepFields step={sub.step} skills={skills} chapter={chapter} onPatch={(p) => patchNode(sub.key, p)} />
                            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                              <button
                                onClick={() => removeNode(sub.key)}
                                title="Remove sub-step"
                                style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--alert)', cursor: 'pointer', marginLeft: 'auto' }}
                              >Remove sub-step</button>
                            </div>
                          </div>
                        </div>
                      ))}
                      <button className={styles.addstep} onClick={() => addSubStep(node.key)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                        Add a sub-step
                      </button>
                      {moveBtns}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div key={node.key} className={`${styles.step}${isOpen ? ' ' + styles.open : ''}`}>
                <div className={styles.srow} onClick={() => toggleOpen(node.key)}>
                  <span className={styles.snum}>{i + 1}</span>
                  <span className={styles.sname}>{node.step.label}</span>
                  <span className={styles.sctrl}>
                    {node.step.taskType && <span className={styles.pill}>{node.step.taskType}</span>}
                    {node.step.skill && <span className={`${styles.pill} ${styles.skill}`}>{node.step.skill}</span>}
                    {node.step.wordCountTarget && <span className={`${styles.pill} ${styles.wc}`}>{String(node.step.wordCountTarget)} w</span>}
                  </span>
                  <svg className={styles.chev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                {isOpen && (
                  <div className={styles.sbody}>
                    <StepFields step={node.step} skills={skills} onPatch={(p) => patchNode(node.key, p)} />
                    {moveBtns}
                  </div>
                )}
              </div>
            );
          })}
```

Notes: the unused imports `LibraryPipelineStep` type stays (used by `patchNode`/`StepFields`); remove the now-unused `EditorStep`/`isExpand`/`isParallel` import if nothing else references it. `EditorStep` casts disappear entirely.

- [ ] **Step 3: Verify the build and existing tests**

Run: `npm run -w frontend/studio build`
Expected: clean build

Run: `node --import tsx --test tests/unit/pipeline-editor-steps.test.ts tests/unit/pipeline-edits.test.ts`
Expected: PASS (the renderability test reads library JSON + `pipelineSteps` guards — untouched)

- [ ] **Step 4: Manual behavior parity check**

Run: `npm start` and open `http://localhost:3847/library` → Pipelines → `msf-phase1-ideation`.
Expected: identical to before — 5 steps, groups titled "Run in parallel", accordion opens, ↑/↓/Remove work, editing a field marks dirty, Save persists (check with a reload). Stop the server after.

---

### Task 6: Drag-and-drop + palette in PipelineEditor

**Files:**
- Modify: `frontend/studio/src/routes/AssetStudio.module.css` (append)
- Create: `frontend/studio/src/components/asset/StepPalette.tsx`
- Modify: `frontend/studio/src/components/asset/PipelineEditor.tsx`

**Interfaces:**
- Consumes: Task 5's node-model editor; `SortableRow`, `DragHandle`, `useDndSensors` from `./dnd/Sortable.js`; `STEP_PRESETS`, `PaletteItem`, `paletteId`, `parsePaletteId`, `nodeFromPalette` from `../../lib/stepPresets.js`; transforms from `../../lib/pipelineEdits.js`.
- Produces: the working visual builder. `StepPalette({ skills, onAppend })` is exported for reuse but only PipelineEditor consumes it.

DnD id scheme (all string ids inside one `DndContext`):
- node keys (`step-N`) — sortable rows, top level and members
- `pal:…` — palette draggables (see `paletteId`)
- `gbody:<groupKey>` — droppable zone inside an open group body
- `flow` — droppable wrapper around the whole step column (palette drop with no row target = append)

Drop resolution runs in `onDragEnd` only (no live cross-container preview) — correct behavior, much simpler code; noted in the spec.

- [ ] **Step 1: Append builder CSS**

Append to `frontend/studio/src/routes/AssetStudio.module.css`:

```css

/* visual pipeline builder */
.builder{display:grid;grid-template-columns:224px 1fr;gap:18px;align-items:start}
.palette{position:sticky;top:0;border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:12px;max-height:72vh;overflow-y:auto}
.palsec{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin:14px 0 8px}
.palsec:first-child{margin-top:0}
.palcard{display:flex;align-items:center;gap:8px;border:1px solid var(--line-2);background:var(--panel-2);border-radius:9px;padding:8px 10px;margin-bottom:7px;font-size:12.5px;color:var(--dim);cursor:grab;transition:.15s;touch-action:none}
.palcard:hover{border-color:rgba(240,145,58,.45);color:var(--text)}
.palcard .grip{color:var(--faint);font-size:12px;flex:none}
.palcard .hint{margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:9px;color:var(--faint)}
.palfilter{width:100%;background:var(--bg);border:1px solid var(--line-2);border-radius:8px;padding:6px 9px;color:var(--text);font-family:'IBM Plex Mono',monospace;font-size:11px;outline:none;margin-bottom:8px}
.gdrop{border:1px dashed var(--line-2);border-radius:10px;padding:10px;text-align:center;color:var(--faint);font-size:12px;margin-top:8px;transition:.15s}
.gdrop.dropon{border-color:rgba(240,145,58,.6);color:var(--ember);background:rgba(240,145,58,.05)}
.subhead{display:flex;align-items:center;gap:8px;padding:10px 12px 0;font-size:12.5px;color:var(--dim)}
@media (max-width:1100px){.builder{grid-template-columns:1fr}.palette{position:static;max-height:none}}
```

- [ ] **Step 2: Create StepPalette**

Create `frontend/studio/src/components/asset/StepPalette.tsx`:

```tsx
// Drag source for the visual pipeline builder: step presets, the skills
// library, and structural group blocks. Cards drag into the flow (ids from
// paletteId) or click to append at the end.
import { useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { STEP_PRESETS, paletteId, type PaletteItem } from '../../lib/stepPresets.js';
import styles from '../../routes/AssetStudio.module.css';

function Card({ item, label, hint, onAppend }: {
  item: PaletteItem; label: string; hint?: string; onAppend: (item: PaletteItem) => void;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: paletteId(item) });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={styles.palcard}
      onClick={() => onAppend(item)}
      title="Drag into the pipeline, or click to add at the end"
    >
      <span className={styles.grip}>⠿</span>
      <span>{label}</span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}

export function StepPalette({ skills, onAppend }: {
  skills: string[];
  onAppend: (item: PaletteItem) => void;
}) {
  const [q, setQ] = useState('');
  const shown = skills.filter((s) => s.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className={styles.palette}>
      <div className={styles.palsec}>Blocks</div>
      <Card item={{ type: 'block', kind: 'parallel' }} label="Run in parallel" onAppend={onAppend} />
      <Card item={{ type: 'block', kind: 'expand' }} label="Repeat per chapter" onAppend={onAppend} />
      <div className={styles.palsec}>Step presets</div>
      {STEP_PRESETS.map((p) => (
        <Card key={p.key} item={{ type: 'preset', key: p.key }} label={p.label} hint={p.taskType} onAppend={onAppend} />
      ))}
      <div className={styles.palsec}>Skills</div>
      <input className={styles.palfilter} placeholder="filter skills…" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.map((s) => (
        <Card key={s} item={{ type: 'skill', name: s }} label={s} onAppend={onAppend} />
      ))}
      {shown.length === 0 && (
        <div style={{ color: 'var(--faint)', fontSize: 12 }}>
          {skills.length === 0 ? 'No skills available.' : 'No skills match.'}
        </div>
      )}
    </div>
  );
}
```

(The skills-API failure case falls out for free: `skills` stays `[]` — the existing fetch already `.catch(() => {})`s — and the section shows "No skills available.")

- [ ] **Step 3: Wire DnD into PipelineEditor**

In `PipelineEditor.tsx`, add these imports (the existing `react` import already has everything needed):

```tsx
import { DndContext, DragOverlay, closestCenter, useDroppable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableRow, DragHandle, useDndSensors } from './dnd/Sortable.js';
import { StepPalette } from './StepPalette.js';
import { parsePaletteId, nodeFromPalette, STEP_PRESETS, type PaletteItem } from '../../lib/stepPresets.js';
import {
  fromSteps, toSteps, reorder, insertTop, insertMember, removeByKey, patchStep,
  moveIntoGroup, extractFromGroup, containerOf, indexIn, findByKey,
  isGroupNode, type Node,
} from '../../lib/pipelineEdits.js';
```

Add drag state + sensors + handlers inside the component (after `mkId`):

```tsx
  const sensors = useDndSensors();
  const [dragLabel, setDragLabel] = useState<string | null>(null);

  function labelOf(id: string): string {
    const pal = parsePaletteId(id);
    if (pal) {
      if (pal.type === 'skill') return pal.name;
      if (pal.type === 'block') return pal.kind === 'parallel' ? 'Run in parallel' : 'Repeat per chapter';
      return STEP_PRESETS.find((p) => p.key === pal.key)?.label ?? pal.key;
    }
    const n = findByKey(nodes, id);
    if (!n) return '';
    return isGroupNode(n) ? (n.kind === 'parallel' ? 'Run in parallel' : 'Repeat per chapter') : n.step.label;
  }

  function onDragStart(e: DragStartEvent) {
    setDragLabel(labelOf(String(e.active.id)));
  }

  function appendFromPalette(item: PaletteItem) {
    const node = nodeFromPalette(item, mkId);
    if (!node) return;
    setNodes((ns) => insertTop(ns, ns.length, node));
    mark();
  }

  function onDragEnd(e: DragEndEvent) {
    setDragLabel(null);
    const { active, over } = e;
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a === o) return;

    // --- palette drops: create a node at the drop position ---
    const pal = parsePaletteId(a);
    if (pal) {
      const node = nodeFromPalette(pal, mkId);
      if (!node) return;
      if (o === 'flow') { setNodes((ns) => insertTop(ns, ns.length, node)); mark(); return; }
      if (o.startsWith('gbody:')) {
        if (isGroupNode(node)) return; // no groups inside groups
        const gk = o.slice(6);
        setNodes((ns) => {
          const g = ns.find((n) => n.key === gk);
          return g && isGroupNode(g) ? insertMember(ns, gk, g.members.length, node) : ns;
        });
        mark(); return;
      }
      const c = containerOf(nodes, o);
      if (c === null) return;
      if (c === undefined) { setNodes((ns) => insertTop(ns, indexIn(ns, undefined, o), node)); mark(); return; }
      if (isGroupNode(node)) return;
      setNodes((ns) => insertMember(ns, c, indexIn(ns, c, o), node));
      mark(); return;
    }

    // --- moving an existing node ---
    const ca = containerOf(nodes, a);
    if (ca === null) return;
    if (o === 'flow') {
      // dropped on the column background: members extract to the end; top-level = no-op
      if (typeof ca === 'string') { setNodes((ns) => extractFromGroup(ns, a, ns.length)); mark(); }
      return;
    }
    if (o.startsWith('gbody:')) {
      const gk = o.slice(6);
      if (ca === gk) return;
      setNodes((ns) => moveIntoGroup(ns, a, gk)); // rejects group nodes internally
      mark(); return;
    }
    const co = containerOf(nodes, o);
    if (co === null) return;
    if (ca === co) { setNodes((ns) => reorder(ns, ca, indexIn(ns, ca, a), indexIn(ns, ca, o))); mark(); return; }
    if (co === undefined) { setNodes((ns) => extractFromGroup(ns, a, indexIn(ns, undefined, o))); mark(); return; }
    setNodes((ns) => moveIntoGroup(ns, a, co, indexIn(ns, co, o))); // rejects group nodes internally
    mark();
  }
```

Add a small droppable component above the `PipelineEditor` function (file scope, next to `StepFields`):

```tsx
function GroupDropZone({ groupKey }: { groupKey: string }) {
  const { isOver, setNodeRef } = useDroppable({ id: `gbody:${groupKey}` });
  return (
    <div ref={setNodeRef} className={`${styles.gdrop}${isOver ? ' ' + styles.dropon : ''}`}>
      Drop a step here
    </div>
  );
}

function FlowColumn({ children }: { children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: 'flow' });
  return <div ref={setNodeRef}>{children}</div>;
}
```

(Use `import type { ReactNode } from 'react'` and `children: ReactNode` to match file style.)

- [ ] **Step 4: Wrap the render in DndContext + builder layout**

Replace the non-dynamic branch's outer `<div>` (the one holding the intro `<p>`, `.steplbl`, the rows, and the add button) with:

```tsx
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className={styles.builder}>
            <StepPalette skills={skills} onAppend={appendFromPalette} />
            <FlowColumn>
              <p style={{ color: 'var(--dim)', fontSize: 13, margin: '0 0 22px', maxWidth: '64ch' }}>
                An ordered set of steps that turn an idea into a finished book. Drag steps from the palette, drag rows to reorder or into a group — or edit any step's prompt, task type, or skill. No code.
              </p>
              <div className={styles.steplbl}>
                Steps <span className={styles.hr} />
                {nodes.length}
              </div>
              <SortableContext items={nodes.map((n) => n.key)} strategy={verticalListSortingStrategy}>
                {/* the exact nodes.map(...) block written in Task 5 Step 2, with the
                    Step 5 modifications below applied (SortableRow wrappers, DragHandle,
                    nested member SortableContext, GroupDropZone) */}
              </SortableContext>
              <button className={styles.addstep} onClick={addStep}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                Add a step
              </button>
            </FlowColumn>
          </div>
          <DragOverlay>
            {dragLabel !== null && (
              <div className={styles.palcard} style={{ cursor: 'grabbing', background: 'var(--panel)' }}>
                <span className={styles.grip}>⠿</span><span>{dragLabel}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
```

- [ ] **Step 5: Make rows sortable**

Inside the `nodes.map`, wrap each returned row (both the group card and the plain-step card from Task 5) in `<SortableRow id={node.key}>…</SortableRow>` (replacing the outer `key={node.key}` div's key with `key={node.key}` on `SortableRow`), and add `<DragHandle />` as the FIRST child of each `.srow` div (before `.snum`).

For group members, replace the member rendering inside the group body with a nested sortable context + a header bar per member:

```tsx
                      <SortableContext items={node.members.map((m) => m.key)} strategy={verticalListSortingStrategy}>
                        {node.members.map((sub) => {
                          const subOpen = openKeys.has(sub.key);
                          return (
                            <SortableRow key={sub.key} id={sub.key}>
                              <div className={styles.step} style={{ marginBottom: 12 }}>
                                <div className={styles.subhead} onClick={() => toggleOpen(sub.key)} style={{ cursor: 'pointer', paddingBottom: subOpen ? 0 : 10 }}>
                                  <DragHandle />
                                  <span style={{ fontFamily: 'Fraunces, serif', fontSize: 14.5 }}>{sub.step.label || 'Untitled step'}</span>
                                  <span className={styles.sctrl}>
                                    {sub.step.taskType && <span className={styles.pill}>{sub.step.taskType}</span>}
                                    {sub.step.skill && <span className={`${styles.pill} ${styles.skill}`}>{sub.step.skill}</span>}
                                  </span>
                                </div>
                                {subOpen && (
                                  <div className={styles.sbody}>
                                    <StepFields step={sub.step} skills={skills} chapter={chapter} onPatch={(p) => patchNode(sub.key, p)} />
                                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                                      <button
                                        onClick={() => removeNode(sub.key)}
                                        title="Remove sub-step"
                                        style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--alert)', cursor: 'pointer', marginLeft: 'auto' }}
                                      >Remove sub-step</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </SortableRow>
                          );
                        })}
                      </SortableContext>
                      <GroupDropZone groupKey={node.key} />
```

Note the behavior change (deliberate, spec-approved): group members are now collapsed header bars that expand on click, matching top-level rows — previously they rendered all fields always-open. `GroupDropZone` sits under the members and doubles as the empty-group target ("Drop a step here").

- [ ] **Step 6: Verify build + tests**

Run: `npm run -w frontend/studio build`
Expected: clean build

Run: `npm run test:unit`
Expected: all tests pass (nothing gateway-side changed; frontend build tests rebuild the dist)

- [ ] **Step 7: Manual drag verification (the feature's acceptance test)**

Run: `npm start`, open `http://localhost:3847/library` → Pipelines → `msf-phase1-ideation`, and verify each gesture:

1. Drag a top-level row by its handle to reorder — order changes, Save enables.
2. Open "Run in parallel" (step 2) — members show as header bars; drag a member to reorder within the group.
3. Drag a member onto the OTHER parallel group's "Drop a step here" zone — it moves groups.
4. Drag a member out onto a top-level row — it extracts to the top level at that position.
5. Drag "Run in parallel" block from the palette into the flow — a new empty group appears.
6. Drag a preset ("Critique pass") from the palette onto a row — a new step lands there with taskType `revision`.
7. Click a skill card in the palette — a skill step appends at the end.
8. Try dragging one group onto another group's drop zone — nothing happens (invalid).
9. Save, reload the page — the new arrangement persisted.
10. DON'T save one change and reload — it's gone (dirty model unchanged).

Also open a `pipeline` under a **book scope** and confirm the palette + drag work identically (same component path). Stop the server after.

---

### Task 7: SequenceEditor drag-reorder

**Files:**
- Modify: `frontend/studio/src/components/asset/SequenceEditor.tsx`

**Interfaces:**
- Consumes: `DndList`, `SortableRow`, `DragHandle` from `./dnd/Sortable.js` (Task 4).
- Produces: drag-reorder on the sequence's pipeline list. The ↑/↓/Remove buttons stay.

Sequences are flat string arrays that allow duplicates, so rows need stable ids independent of the pipeline name: an `rowIds` array managed alongside `pipelines`.

- [ ] **Step 1: Add row ids + reorder handler**

In `SequenceEditor.tsx`, extend the react import to `import { useEffect, useRef, useState } from 'react';` and add imports:

```tsx
import { DndList, SortableRow, DragHandle } from './dnd/Sortable.js';
```

Add state after the existing `useState` block:

```tsx
  const [rowIds, setRowIds] = useState<string[]>([]);
  const nextId = useRef(0);
  const mkId = () => `row-${nextId.current++}`;
```

In the load effect, after `setPipelines(...)`:

```tsx
        setRowIds(seq.pipelines.filter((p) => typeof p === 'string').map(() => mkId()));
```

Replace `move`, `remove`, `add` with id-aware versions:

```tsx
  function moveTo(from: number, to: number) {
    if (from < 0 || to < 0 || from === to) return;
    const shift = <T,>(xs: T[]): T[] => {
      const next = [...xs];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    };
    setPipelines(shift);
    setRowIds(shift);
    mark();
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= pipelines.length) return;
    moveTo(i, j);
  }

  function remove(i: number) {
    setPipelines((xs) => xs.filter((_, idx) => idx !== i));
    setRowIds((xs) => xs.filter((_, idx) => idx !== i));
    mark();
  }

  function add() {
    if (!addPick) return;
    setPipelines((xs) => [...xs, addPick]);
    setRowIds((xs) => [...xs, mkId()]);
    setAddPick('');
    mark();
  }
```

- [ ] **Step 2: Wrap the rows**

Replace the `{pipelines.map((p, i) => ( <div key={`${p}-${i}`} …> … </div> ))}` block: wrap the whole map in `<DndList ids={rowIds} onMove={moveTo}>…</DndList>`, change each row to `<SortableRow key={rowIds[i]} id={rowIds[i]}>` around the existing `.step` div, and add `<DragHandle />` as the first child of the `.srow` div (before `.snum`).

- [ ] **Step 3: Verify**

Run: `npm run -w frontend/studio build`
Expected: clean build

Manual: `npm start` → Library → Sequences → open any sequence (create one if none exists via the + button) → drag rows to reorder, Save, reload, order persisted. ↑/↓/Remove still work. Stop the server.

---

### Task 8: Full verification + docs + commit message

**Files:**
- Modify: `docs/TODO.md`, `docs/COMPLETED.md`, `commit_message`

- [ ] **Step 1: Full test suite**

Run: `npm run test:unit`
Expected: all pass (includes the new `pipeline-edits` + `step-presets` tests and the `studio-build` build-assert)

Run: `npx tsc --noEmit`
Expected: clean (gateway untouched, but confirms no cross-workspace type damage)

- [ ] **Step 2: End-to-end sanity on a real pipeline**

Run: `npm start`. In the studio, build a tiny pipeline from scratch using ONLY the palette: drag in "Chapter outline", a "Run in parallel" block, drag two "Critique pass" presets into the block, drag a "Final edit" after it. Save it as a new pipeline (create via the + button on the Pipelines kind, then arrange + save). Then verify the saved JSON shape:

Run: `cat workspace/library/pipelines/<name>.json` (or open the entry again and confirm the arrangement reloaded correctly — the entry API path depends on scope; the reload check is sufficient).
Expected: steps array = plain step, `{parallel:[…,…]}`, plain step — the exact gateway shapes.

- [ ] **Step 3: Move the TODO entry to COMPLETED**

In `docs/TODO.md`, delete the "**Visual drag-and-drop pipeline builder in the Asset Studio [owner ask 2026-07-06]**" bullet under "User experience & product features". In `docs/COMPLETED.md`, add under a `## 2026-07-XX` heading (today's date), preserving the original bullet text and prepending the completion date, with a short verification note (test counts, build green).

- [ ] **Step 4: Write the commit message**

Write `commit_message` at the repo root:

```
feat(studio): visual drag-and-drop pipeline builder

- pipeline steps are now a keyed node model (lib/pipelineEdits.ts) with pure drag transforms; save serializes to the same gateway JSON shapes
- step palette (lib/stepPresets.ts + StepPalette.tsx): task-type presets, skills library, and parallel/per-chapter group blocks — groups are now creatable from the UI
- drag to reorder, drag steps into/out of groups (dnd-kit; generic wrappers in components/asset/dnd/)
- SequenceEditor: drag-reorder for the pipeline list
- tests: pipeline-edits transforms, step-presets router-taskType guard
```

- [ ] **Step 5: Report**

Report to the maintainer: test counts, build status, and the manual-verification results from Task 6 Step 7 and Task 8 Step 2. The maintainer runs `./push.sh` (and touches `build_now` if a Mercury deploy is wanted).
