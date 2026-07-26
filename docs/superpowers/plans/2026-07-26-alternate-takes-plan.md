# Alternate Takes (Verbalized Sampling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At creative-decision points, generate k distinct candidate "takes" (with typicality probabilities) on the production model, pause for a human pick, complete the step with the chosen take, and log the choice — countering AI mode-collapse. Writer-facing name: **Alternate Takes**.

**Architecture:** A pure VS module wraps the existing AI-complete function. A per-step `vs` opt-in flag (role-allowlisted) turns any decision step into a **Takes gate**, modeled exactly on the existing LLM-Council gate (`council-gate.ts`): the gate generates candidates, stores them on a `project.takes` selection marker, and parks; a `POST /takes/select` resolves it by completing the step with the chosen candidate and appending a selection-log record. Two decision points — a new **Scene Takes** step above `scene_brief` and a **Draft Opening** step above the draft continuation — are injected per-book via an opt-in manifest flag (pipelines untouched; existing books unaffected).

**Tech Stack:** Node 22 + TypeScript via `tsx`, `node:test`, Express. Imports use `.js` extensions on `.ts` (NodeNext). React (Vite studio).

## Global Constraints

- **Node 22+**, TS via `--import tsx`; never `ts-node`. **`.js` import extensions** on `.ts`.
- **No git commits per task.** Repo uses the `commit_message` + `./push.sh` flow. Each task ends with a **Checkpoint** (its test file green), not `git commit`. One `commit_message` in the last task.
- **Fast unit iteration:** `node --import tsx --test tests/unit/<file>.test.ts` (skips the frontend build that `npm run test:unit` prepends). Full `npm run test:unit` once at the end.
- **Naming:** writer-facing = **Alternate Takes**; candidates = **takes**; picker = **Takes picker**; decision point A = **Scene Takes**. Internal identifiers keep the VS anchor: module `verbalized-sampling.ts`, marker/endpoint use `takes`, per-step config key `vs`, new role `approach`.
- **Gating rule (enforced in code, not convention):** VS attaches ONLY to roles in the allowlist `{ approach, draft, scene_brief }`. A `vs` block on any other role is refused with a loud log.
- **Fail-open:** VS is an enhancement, never a dependency. Any VS failure degrades to a single direct completion, flagged `degraded`, and does NOT gate.
- **Never auto-select:** a non-degraded VS step ALWAYS parks for a human pick (mirrors the council `propose` mode). Autonomy = don't enable the flag.
- **Model routing is free:** VS runs through the step's already-resolved routing (`stepRouting`) so candidates are generated on the production model.

---

### Task 1: Core VS module — compose, parse, fail-open

**Files:**
- Create: `gateway/src/sampling/verbalized-sampling.ts`
- Test: `tests/unit/verbalized-sampling.test.ts`

**Interfaces:**
- Consumes: a `VsComplete` function shaped like `AICompleteFunc` (`gateway/src/services/projects.ts:38`) but only `text` is read.
- Produces:
  ```ts
  export interface VsConfig { k: number; probabilityThreshold: number; variant: 'standard' | 'cot' | 'multi'; }
  export interface VsCandidate { index: number; text: string; }
  export interface VsResult { candidates: VsCandidate[]; degraded: boolean; variant: VsConfig['variant']; k: number; }
  export interface VsRouting { provider: string; model?: string; temperature?: number; }
  export type VsComplete = (req: { provider: string; system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number; temperature?: number; model?: string }) => Promise<{ text: string }>;
  export const VS_DEFAULTS: VsConfig; // { k: 5, probabilityThreshold: 0.10, variant: 'cot' }
  export function composeVsPrompt(basePrompt: string, config: VsConfig): string;
  export function parseTakes(raw: string, k: number): VsCandidate[] | null; // null = malformed (wrong count / missing probs)
  export function runVerbalizedSampling(args: { basePrompt: string; systemPrompt: string; routing: VsRouting; config: VsConfig; complete: VsComplete; maxTokens?: number }): Promise<VsResult>;
  ```

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/verbalized-sampling.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeVsPrompt, parseTakes, runVerbalizedSampling, VS_DEFAULTS } from '../../gateway/src/sampling/verbalized-sampling.js';

test('composeVsPrompt appends the VS envelope AFTER the base prompt (envelope last)', () => {
  const out = composeVsPrompt('CRAFT INSTRUCTIONS HERE', { ...VS_DEFAULTS, k: 3 });
  assert.ok(out.startsWith('CRAFT INSTRUCTIONS HERE'), 'base prompt preserved and first');
  assert.ok(out.indexOf('CRAFT INSTRUCTIONS HERE') < out.indexOf('<take'), 'envelope comes after the craft content');
  assert.match(out, /exactly 3/i);
});

test('parseTakes extracts k blocks with probabilities', () => {
  const raw = `<take p="0.06">Approach one.</take>\n<take p="0.08">Approach two.</take>`;
  const c = parseTakes(raw, 2);
  assert.equal(c?.length, 2);
  assert.equal(c?.[0].index, 0);
  assert.equal(c?.[0].text, 'Approach one.');
});

test('parseTakes tolerates near-XML (unquoted probability)', () => {
  const raw = `blah\n<take p=0.06>One.</take> <take p=0.08>Two.</take>\ntrailing`;
  assert.equal(parseTakes(raw, 2)?.length, 2);
});

test('parseTakes returns null when the block count is wrong', () => {
  assert.equal(parseTakes(`<take p="0.06">only one</take>`, 3), null);
});

test('parseTakes returns null when a probability is missing', () => {
  assert.equal(parseTakes(`<take>no prob</take><take p="0.05">ok</take>`, 2), null);
});

test('runVerbalizedSampling returns k candidates and discards probabilities', async () => {
  const complete = async () => ({ text: `<take p="0.06">A.</take><take p="0.07">B.</take><take p="0.09">C.</take>` });
  const r = await runVerbalizedSampling({ basePrompt: 'x', systemPrompt: 'sys', routing: { provider: 'openrouter', model: 'm' }, config: { ...VS_DEFAULTS, k: 3 }, complete });
  assert.equal(r.degraded, false);
  assert.equal(r.candidates.length, 3);
  assert.ok(!('probability' in (r.candidates[0] as any)), 'probabilities discarded');
});

test('runVerbalizedSampling fails open: malformed twice → single degraded direct output', async () => {
  let calls = 0;
  const complete = async (req: any) => { calls++; return { text: calls <= 2 ? 'garbage no blocks' : 'DIRECT PROSE' }; };
  const r = await runVerbalizedSampling({ basePrompt: 'x', systemPrompt: 'sys', routing: { provider: 'openrouter' }, config: { ...VS_DEFAULTS, k: 3 }, complete });
  assert.equal(calls, 3, 'one VS attempt + one retry + one direct fallback');
  assert.equal(r.degraded, true);
  assert.equal(r.candidates.length, 1);
  assert.equal(r.candidates[0].text, 'DIRECT PROSE');
});

test('runVerbalizedSampling passes the resolved routing through to complete', async () => {
  let seen: any = null;
  const complete = async (req: any) => { seen = req; return { text: `<take p="0.06">A.</take><take p="0.07">B.</take>` }; };
  await runVerbalizedSampling({ basePrompt: 'x', systemPrompt: 'sys', routing: { provider: 'claude', model: 'anthropic/claude-sonnet-5', temperature: 0.9 }, config: { ...VS_DEFAULTS, k: 2 }, complete });
  assert.equal(seen.provider, 'claude');
  assert.equal(seen.model, 'anthropic/claude-sonnet-5');
  assert.equal(seen.temperature, 0.9);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/unit/verbalized-sampling.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `gateway/src/sampling/verbalized-sampling.ts`:
```ts
/**
 * Verbalized Sampling — the engine behind the writer-facing "Alternate Takes".
 * Provider-agnostic: wraps whatever AI-complete function it's handed, composes a
 * VS envelope onto the caller's craft prompt (envelope LAST so it defines only the
 * output format, never overwriting craft), parses k candidate "takes", and fails
 * OPEN to a single direct completion. Owns no pipeline state. See
 * docs/superpowers/specs/2026-07-26-verbalized-sampling-design.md.
 */
export interface VsConfig { k: number; probabilityThreshold: number; variant: 'standard' | 'cot' | 'multi'; }
export interface VsCandidate { index: number; text: string; }
export interface VsResult { candidates: VsCandidate[]; degraded: boolean; variant: VsConfig['variant']; k: number; }
export interface VsRouting { provider: string; model?: string; temperature?: number; }
export type VsComplete = (req: { provider: string; system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number; temperature?: number; model?: string }) => Promise<{ text: string }>;

export const VS_DEFAULTS: VsConfig = { k: 5, probabilityThreshold: 0.10, variant: 'cot' };

export function composeVsPrompt(basePrompt: string, config: VsConfig): string {
  const cot = config.variant === 'cot'
    ? 'First think briefly about what the most obvious/typical response would be, then deliberately spread AWAY from it. '
    : '';
  const envelope =
    `\n\n---\nRESPONSE FORMAT (Alternate Takes): ${cot}Give exactly ${config.k} DISTINCT candidates, each genuinely different in direction, not surface rewordings. ` +
    `Bias toward lower-probability (less typical) responses — each candidate's estimated probability should be under ${config.probabilityThreshold}. ` +
    `Output ONLY the ${config.k} blocks, nothing before or after, each on its own line:\n` +
    `<take p="0.07">the candidate</take>`;
  return `${basePrompt}${envelope}`;
}

const TAKE_RE = /<take\s+p\s*=\s*"?([0-9]*\.?[0-9]+)"?\s*>([\s\S]*?)<\/take>/gi;

export function parseTakes(raw: string, k: number): VsCandidate[] | null {
  const out: VsCandidate[] = [];
  let m: RegExpExecArray | null;
  TAKE_RE.lastIndex = 0;
  while ((m = TAKE_RE.exec(raw)) !== null) {
    const prob = Number(m[1]);
    const text = m[2].trim();
    if (!Number.isFinite(prob) || !text) return null; // probability required + non-empty
    out.push({ index: out.length, text });
  }
  if (out.length !== k) return null;
  return out;
}

export async function runVerbalizedSampling(args: {
  basePrompt: string; systemPrompt: string; routing: VsRouting; config: VsConfig; complete: VsComplete; maxTokens?: number;
}): Promise<VsResult> {
  const { basePrompt, systemPrompt, routing, config, complete } = args;
  const maxTokens = args.maxTokens ?? Math.min(8192, 512 * config.k);
  const composed = composeVsPrompt(basePrompt, config);
  const call = (prompt: string, mt: number) => complete({
    provider: routing.provider, system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: mt, temperature: routing.temperature, model: routing.model,
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await call(composed, maxTokens);
      const parsed = parseTakes(res.text, config.k);
      if (parsed) return { candidates: parsed, degraded: false, variant: config.variant, k: config.k };
    } catch { /* fall through to retry / fallback */ }
  }
  // Fail open: one plain direct completion, flagged degraded, no candidates to pick.
  console.log('  ⚠ Alternate Takes: VS output unparseable after retry — degrading to a single direct completion');
  const direct = await call(basePrompt, maxTokens);
  return { candidates: [{ index: 0, text: direct.text }], degraded: true, variant: config.variant, k: config.k };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/unit/verbalized-sampling.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Checkpoint** — module test green.

---

### Task 2: `vs` step config + role allowlist + new `approach` role

**Files:**
- Modify: `gateway/src/services/casting/roles.ts` (add `'approach'` to `StepRole`/`STEP_ROLES`)
- Modify: `gateway/src/services/projects.ts` (`ProjectStep` gains `vs?`)
- Create: `gateway/src/sampling/vs-roles.ts` (allowlist + config coercion)
- Test: `tests/unit/vs-roles.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // vs-roles.ts
  export const VS_ROLES: ReadonlySet<StepRole>; // { approach, draft, scene_brief }
  export interface VsStepConfig { enabled: true; k?: number; threshold?: number; variant?: 'standard'|'cot'|'multi'; }
  export function isVsEnabled(step: { role?: StepRole; vs?: VsStepConfig }): boolean; // enabled AND role in allowlist (else loud-log false)
  export function resolveVsConfig(step: { vs?: VsStepConfig }): VsConfig; // fill from VS_DEFAULTS, clamp k to [2,8]
  ```
- `ProjectStep.vs?: VsStepConfig` (and pipeline step JSON may carry it).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/vs-roles.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVsEnabled, resolveVsConfig, VS_ROLES } from '../../gateway/src/sampling/vs-roles.js';

test('VS is enabled on an allowlisted role', () => {
  assert.equal(isVsEnabled({ role: 'approach', vs: { enabled: true } }), true);
  assert.equal(isVsEnabled({ role: 'draft', vs: { enabled: true } }), true);
});

test('VS is refused on a non-allowlisted role even with vs.enabled', () => {
  assert.equal(isVsEnabled({ role: 'continuity', vs: { enabled: true } }), false);
  assert.equal(isVsEnabled({ role: 'editorial', vs: { enabled: true } }), false);
});

test('no vs block → not enabled', () => {
  assert.equal(isVsEnabled({ role: 'draft' }), false);
});

test('resolveVsConfig fills defaults and clamps k', () => {
  assert.deepEqual(resolveVsConfig({ vs: { enabled: true } }), { k: 5, probabilityThreshold: 0.10, variant: 'cot' });
  assert.equal(resolveVsConfig({ vs: { enabled: true, k: 99 } }).k, 8);
  assert.equal(resolveVsConfig({ vs: { enabled: true, k: 1 } }).k, 2);
});

test('scene_brief is in the allowlist (future attach point)', () => {
  assert.ok(VS_ROLES.has('scene_brief'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/unit/vs-roles.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Add the `approach` role**

In `gateway/src/services/casting/roles.ts`, add `'approach'` to the `StepRole` union and to `STEP_ROLES` (place it right after `'scene_brief'`). Do NOT add it to `PROSE_ROLES` or `PROSE_OUTPUT_ROLES` (it is a short planning step, not prose).

- [ ] **Step 4: Create `vs-roles.ts`**

```ts
import type { StepRole } from '../services/casting/roles.js';
import { VS_DEFAULTS, type VsConfig } from './verbalized-sampling.js';

/** Roles VS may attach to. Enforced so VS can never land on a verifiable-answer pass. */
export const VS_ROLES: ReadonlySet<StepRole> = new Set<StepRole>(['approach', 'draft', 'scene_brief']);

export interface VsStepConfig { enabled: true; k?: number; threshold?: number; variant?: 'standard' | 'cot' | 'multi'; }

export function isVsEnabled(step: { role?: StepRole; vs?: VsStepConfig } | null | undefined): boolean {
  if (!step?.vs?.enabled) return false;
  if (!step.role || !VS_ROLES.has(step.role)) {
    console.log(`  ⚠ Alternate Takes: refused vs on role "${step.role ?? '(none)'}" — not an allowlisted decision role`);
    return false;
  }
  return true;
}

export function resolveVsConfig(step: { vs?: VsStepConfig }): VsConfig {
  const v = step.vs;
  const k = Math.max(2, Math.min(8, v?.k ?? VS_DEFAULTS.k));
  const probabilityThreshold = typeof v?.threshold === 'number' ? v.threshold : VS_DEFAULTS.probabilityThreshold;
  const variant = v?.variant ?? VS_DEFAULTS.variant;
  return { k, probabilityThreshold, variant };
}
```

- [ ] **Step 5: Add `vs?` to `ProjectStep`**

In `gateway/src/services/projects.ts`, `interface ProjectStep`, after `role?: StepRole;`:
```ts
  // Alternate Takes (Verbalized Sampling) opt-in for this decision step. When
  // enabled AND the role is allowlisted, the engine generates k candidate takes
  // and parks for a human pick instead of completing directly. See sampling/vs-roles.ts.
  vs?: { enabled: true; k?: number; threshold?: number; variant?: 'standard' | 'cot' | 'multi' };
```

- [ ] **Step 6: Run to verify it passes**

Run: `node --import tsx --test tests/unit/vs-roles.test.ts && npx tsc --noEmit`
Expected: PASS + no type errors.

- [ ] **Step 7: Checkpoint** — vs-roles test green, tsc clean.

---

### Task 3: `project.takes` marker + `applyTakeSelection` + `clearTakesSelection`

**Files:**
- Modify: `gateway/src/services/projects.ts` (`Project` interface + two methods, modeled on `selection`/`applyCouncilSelection` at :93 and :1164)
- Test: `tests/unit/takes-selection.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // On Project:
  takes?: { stepId: string; role: string; candidates: Array<{ index: number; text: string }>; config: { k: number; variant: string; threshold: number }; createdAt: string };
  // Methods:
  applyTakeSelection(projectId: string, index: number): boolean; // completes step with candidates[index].text; false if no marker / bad index
  clearTakesSelection(projectId: string): void;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/takes-selection.test.ts` — construct a `ProjectEngine`, inject a project with a `takes` marker + an active step, call `applyTakeSelection`, assert the step completes with the chosen candidate's text and the marker clears. Mirror the harness in `tests/unit/*council*`/existing engine tests (find one that news up `ProjectEngine` and pushes a project into its internal map, e.g. via a public test seam or by driving a tiny pipeline). Minimal assertions:
```ts
// after seeding project.takes = { stepId, candidates:[{index:0,text:'A'},{index:1,text:'B'}], ... } and the step active:
assert.equal(engine.applyTakeSelection(pid, 1), true);
const step = engine.getProject(pid).steps.find(s => s.id === stepId);
assert.equal(step.status, 'completed');
assert.equal(step.result, 'B');
assert.equal(engine.getProject(pid).takes, undefined);
// bad index:
assert.equal(engine.applyTakeSelection(pid2, 9), false);
```
(Read `tests/unit/*.test.ts` for the existing pattern that instantiates ProjectEngine and seeds a project; reuse it verbatim. If no seam exists, add a test-only `__seedProjectForTest(project)` method guarded by a comment, mirroring how council selection is tested.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/unit/takes-selection.test.ts`
Expected: FAIL — `applyTakeSelection` undefined.

- [ ] **Step 3: Add the marker + methods**

In `gateway/src/services/projects.ts`, in the `Project` interface after the `selection?` block (~:100):
```ts
  // Alternate Takes pause-resume gate: set when a vs-enabled step generated
  // candidate takes and the pipeline is parked awaiting a human pick; cleared by
  // applyTakeSelection (choice applied) or clearTakesSelection (abandoned).
  // Additive-optional, no schema bump — mirrors `selection` (council) above.
  takes?: { stepId: string; role: string; candidates: Array<{ index: number; text: string }>; config: { k: number; variant: string; threshold: number }; createdAt: string };
```
Add methods next to `applyCouncilSelection` (~:1164), mirroring it:
```ts
  /** Alternate Takes resume: complete the gated step with the chosen take. */
  applyTakeSelection(projectId: string, index: number): boolean {
    const project = this.projects.get(projectId);
    if (!project?.takes) return false;
    const chosen = project.takes.candidates.find(c => c.index === index);
    if (!chosen) { console.log(`  ⚠ Takes selection: no candidate at index ${index} (project ${projectId})`); return false; }
    this.completeStep(projectId, project.takes.stepId, chosen.text);
    void this.persistStepResultFile(projectId, project.takes.stepId, chosen.text); // BUG C5 parity
    if (project.status !== 'completed') project.status = 'active';
    delete project.takes;
    project.updatedAt = new Date().toISOString();
    this.persistState();
    return true;
  }

  /** Clear a project's Alternate Takes marker (abandoned — project stays paused). */
  clearTakesSelection(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;
    delete project.takes;
    project.updatedAt = new Date().toISOString();
    this.persistState();
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/unit/takes-selection.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — takes-selection test green.

---

### Task 4: Selection-log append (the preference dataset)

**Files:**
- Create: `gateway/src/sampling/takes-log.ts`
- Modify: `gateway/src/services/projects.ts` (`applyTakeSelection` calls the logger)
- Test: `tests/unit/takes-log.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TakesLogRecord { id: string; at: string; bookSlug: string; projectId: string; stepId: string; role: string; variant: string; k: number; threshold: number; provider: string; model: string; contextRef: string; candidates: Array<{ index: number; text: string }>; chosenIndex: number; edited: boolean; diversityScore: number | null; degraded: boolean; }
  export function appendTakesLog(booksDir: string, bookSlug: string, rec: TakesLogRecord): void; // fail-soft; per-book data/vs-selections.jsonl
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/unit/takes-log.test.ts`: write a record to a temp booksDir, read back the JSONL line, assert fields incl. `diversityScore: null`; assert a second append adds a second line; assert a bad path fails soft (no throw).

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/unit/takes-log.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `takes-log.ts`**

```ts
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface TakesLogRecord {
  id: string; at: string; bookSlug: string; projectId: string; stepId: string; role: string;
  variant: string; k: number; threshold: number; provider: string; model: string; contextRef: string;
  candidates: Array<{ index: number; text: string }>; chosenIndex: number; edited: boolean;
  diversityScore: number | null; degraded: boolean;
}

/** Append one Alternate Takes selection to the per-book preference log. Fail-soft. */
export function appendTakesLog(booksDir: string, bookSlug: string, rec: TakesLogRecord): void {
  try {
    const dir = join(booksDir, bookSlug, 'data');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'vs-selections.jsonl'), JSON.stringify(rec) + '\n', 'utf-8');
  } catch (err) {
    console.log(`  ⚠ Alternate Takes: could not append selection log for ${bookSlug}: ${(err as Error)?.message || err}`);
  }
}
```

- [ ] **Step 4: Wire it into `applyTakeSelection`**

The engine needs `booksDir` + the book slug. `ProjectEngine` already resolves per-step files (`persistStepResultFile`) so it knows the books dir; the project carries `bookSlug`. In `applyTakeSelection`, before `delete project.takes`, build a `TakesLogRecord` from `project.takes` + `project` (`chosenIndex: index`, `edited: false`, `diversityScore: null`, `degraded: false`, `contextRef: `${project.takes.stepId}``) and call `appendTakesLog(this.booksDir, project.bookSlug, rec)` guarded by `if (project.bookSlug)`. If `ProjectEngine` lacks a `booksDir` field, thread it from the same source `persistStepResultFile` uses (read that method and reuse its base path).

- [ ] **Step 5: Run to verify it passes**

Run: `node --import tsx --test tests/unit/takes-log.test.ts tests/unit/takes-selection.test.ts`
Expected: PASS (selection test still green; add one assertion there that a log line was written when `bookSlug` is set + a temp booksDir is configured).

- [ ] **Step 6: Checkpoint** — both green.

---

### Task 5: Takes gate — `maybeRunTakesStep` (modeled on `maybeRunCouncilStep`)

**Files:**
- Create: `gateway/src/services/takes-gate.ts`
- Test: `tests/unit/takes-gate.test.ts`

**Interfaces:**
- Consumes: `runVerbalizedSampling` (Task 1), `isVsEnabled`/`resolveVsConfig` (Task 2), the engine's `completeStep`/`parkForReview`/`persistStepResultFile` (as in `council-gate.ts` `EngineLike`).
- Produces:
  ```ts
  export function isTakesStep(step: { role?: any; vs?: any }): boolean; // = isVsEnabled
  export async function maybeRunTakesStep(deps: {
    engine: { getProject(id:string):any; completeStep(p:string,s:string,r:string):void; parkForReview(id:string):void; persistStepResultFile?(p:string,s:string,r:string):Promise<void> };
    generateTakes: (project: any, step: any) => Promise<{ candidates: Array<{ index:number; text:string }>; degraded: boolean; config: { k:number; variant:string; threshold:number } }>;
  }, project: any, step: any): Promise<{ handled: boolean; gated: boolean }>;
  ```
  Semantics mirror `maybeRunCouncilStep`: not-a-VS-step → `{false,false}`; marker already set (re-entry) → park + `{true,true}`; degraded → complete direct + `{true,false}`; else set `project.takes` + park + `{true,true}`. Fail-soft: `generateTakes` throw → complete the step with a single direct completion is the module's job (it fails open), so a throw here is unexpected → log ⚠, complete with `''`? No: rely on the module never throwing (it fails open internally). If it still throws, `{true,false}` after completing with the step's own direct path is not available — so catch, log, and return `{false,false}` so the normal executor runs the step directly.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/takes-gate.test.ts` with a fake engine (records completeStep/parkForReview calls) and a stub `generateTakes`:
```ts
// non-VS step → passthrough
assert.deepEqual(await maybeRunTakesStep(deps, project, { role:'draft' }), { handled:false, gated:false });
// VS step, healthy → sets project.takes + parks + gated
const step = { id:'s1', role:'approach', vs:{ enabled:true } };
const out = await maybeRunTakesStep(depsHealthy, project, step);
assert.deepEqual(out, { handled:true, gated:true });
assert.equal(project.takes.candidates.length, 3);
assert.equal(parkCalls, 1);
// re-entry (marker already set) → park again, no regenerate
const out2 = await maybeRunTakesStep(depsHealthy, project, step);
assert.equal(out2.gated, true);
assert.equal(genCalls, 1, 'did not regenerate on re-entry');
// degraded → completes direct, not gated
const out3 = await maybeRunTakesStep(depsDegraded, project2, step2);
assert.deepEqual(out3, { handled:true, gated:false });
assert.equal(completeCalls, 1);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/unit/takes-gate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `takes-gate.ts`** (mirror `council-gate.ts` structure)

```ts
import { isVsEnabled } from '../sampling/vs-roles.js';

export function isTakesStep(step: { role?: any; vs?: any } | null | undefined): boolean {
  return isVsEnabled(step as any);
}

interface EngineLike {
  getProject(id: string): any;
  completeStep(projectId: string, stepId: string, result: string): void;
  parkForReview(id: string): void;
  persistStepResultFile?(projectId: string, stepId: string, result: string): Promise<void>;
}
interface Deps {
  engine: EngineLike;
  generateTakes: (project: any, step: any) => Promise<{ candidates: Array<{ index: number; text: string }>; degraded: boolean; config: { k: number; variant: string; threshold: number } }>;
}

export async function maybeRunTakesStep(deps: Deps, project: any, step: any): Promise<{ handled: boolean; gated: boolean }> {
  if (!isTakesStep(step)) return { handled: false, gated: false };
  if (project.takes) { deps.engine.parkForReview(project.id); return { handled: true, gated: true }; }

  let result;
  try {
    result = await deps.generateTakes(project, step);
  } catch (err) {
    console.log(`  ⚠ Alternate Takes: generateTakes threw for project ${project?.id} — running the step directly: ${(err as Error)?.message || err}`);
    return { handled: false, gated: false }; // let the normal executor run the step
  }

  if (result.degraded) {
    const text = result.candidates[0]?.text ?? '';
    deps.engine.completeStep(project.id, step.id, text);
    await deps.engine.persistStepResultFile?.(project.id, step.id, text);
    return { handled: true, gated: false };
  }

  project.takes = {
    stepId: step.id, role: step.role,
    candidates: result.candidates,
    config: result.config,
    createdAt: new Date().toISOString(),
  };
  deps.engine.parkForReview(project.id);
  return { handled: true, gated: true };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/unit/takes-gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — gate test green.

---

### Task 6: Wire the gate into the 3 drive sites + `POST /takes/select` + build `generateTakes`

**Files:**
- Modify: `gateway/src/api/routes/projects.routes.ts` (2 drive sites ~:586, ~:1096; new endpoint near `/council/select` ~:1927; a `buildGenerateTakes(services)` helper)
- Modify: `gateway/src/index.ts` (1 drive site ~:2344)
- Create: `gateway/src/sampling/generate-takes.ts` (the `generateTakes` factory: composes routing + VS module)
- Test: `tests/unit/generate-takes.test.ts`

**Interfaces:**
- Consumes: `stepRouting` (`_shared.ts`), the AI router (`services.aiRouter.complete`), `runVerbalizedSampling` + `resolveVsConfig`.
- Produces: `makeGenerateTakes(deps: { complete: VsComplete; resolveRouting: (project:any, step:any) => VsRouting }): (project, step) => Promise<{candidates; degraded; config}>`.

- [ ] **Step 1: Write the failing test** (`generate-takes.test.ts`)

Assert `makeGenerateTakes` resolves the step's routing, calls the VS module, and returns `{ candidates, degraded, config }` with `config` from `resolveVsConfig`. Use a stub `complete` returning k `<take>` blocks and a stub `resolveRouting`.

- [ ] **Step 2: Run to verify it fails.** `node --import tsx --test tests/unit/generate-takes.test.ts` → FAIL.

- [ ] **Step 3: Implement `generate-takes.ts`**

```ts
import { runVerbalizedSampling, type VsComplete, type VsRouting } from './verbalized-sampling.js';
import { resolveVsConfig } from './vs-roles.js';

export function makeGenerateTakes(deps: { complete: VsComplete; resolveRouting: (project: any, step: any) => VsRouting }) {
  return async (project: any, step: any) => {
    const config = resolveVsConfig(step);
    const routing = deps.resolveRouting(project, step);
    const r = await runVerbalizedSampling({
      basePrompt: step.prompt ?? '', systemPrompt: project?.context?.systemPrompt ?? '',
      routing, config, complete: deps.complete,
    });
    return { candidates: r.candidates, degraded: r.degraded, config: { k: config.k, variant: config.variant, threshold: config.probabilityThreshold } };
  };
}
```
(Note: `systemPrompt` source — read how the executor builds the per-step system prompt in `projects.ts` and pass the same value; if it's assembled at execution time, thread it via `resolveRouting`'s closure or extend the signature. Keep the composed craft prompt in `step.prompt`.)

- [ ] **Step 4: Run to verify it passes.** → PASS.

- [ ] **Step 5: Add `POST /api/projects/:id/takes/select`** (mirror `/council/select` ~:1927)

```ts
app.post('/api/projects/:id/takes/select', async (req: Request, res: Response) => {
  const engine = gateway.getProjectEngine?.();
  if (!engine) return res.status(503).json({ error: 'Project engine not initialized' });
  const project = engine.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.takes) return res.status(409).json({ error: 'No Alternate Takes selection pending' });
  const index = Number(req.body?.index);
  if (!Number.isInteger(index)) return res.status(400).json({ error: 'index (integer) required' });
  if (!engine.applyTakeSelection(project.id, index)) return res.status(400).json({ error: 'unknown take index' });
  void driveResumedProject(project.id).catch(() => {});
  res.json({ ok: true, project: engine.getProject(req.params.id) });
});
```

- [ ] **Step 6: Wire `maybeRunTakesStep` at the 3 drive sites**

At each `maybeRunCouncilStep(...)` call site (`projects.routes.ts` ~:586 and ~:1096; `index.ts` ~:2344), add a `maybeRunTakesStep` check for the active step directly AFTER the council check and BEFORE `isHumanReviewStep`, and stop the drive when gated. Build `generateTakes` once via `makeGenerateTakes({ complete: (r) => services.aiRouter.complete(r).then(x => ({ text: x.text })), resolveRouting: (p, s) => stepRouting(p, s) })`. Example (routes site):
```ts
const takesOutcome = await maybeRunTakesStep(
  { engine, generateTakes: buildGenerateTakes(services) },
  project, activeStep,
);
if (takesOutcome.gated) return res.json({ takes: true, project: engine.getProject(project.id) });
// (index.ts site: return from the drive loop instead of res.json, mirroring the council early-return there.)
```
Add a `buildGenerateTakes(services)` helper in `projects.routes.ts` (and an equivalent inline build in `index.ts`) that constructs the `makeGenerateTakes` closure. Read the exact council early-return shape at each site and mirror it (routes return a JSON body; the index.ts loop `break`/`return`s).

- [ ] **Step 7: Type-check + regression**

Run: `npx tsc --noEmit && node --import tsx --test tests/unit/generate-takes.test.ts tests/unit/takes-gate.test.ts tests/unit/takes-selection.test.ts`
Expected: clean + PASS.

- [ ] **Step 8: Checkpoint** — endpoint compiles, gate wired, tests green.

---

### Task 7: Per-book opt-in — `alternateTakes` manifest flag + Scene Takes injection

**Files:**
- Modify: `gateway/src/services/book-types.ts` (`BookManifest.alternateTakes?`)
- Create: `gateway/src/sampling/inject-takes-steps.ts` (pure post-expand transform)
- Modify: `gateway/src/services/projects.ts` (~:943, call the injector after `expandSteps` when the flag is on; thread the flag via `context`)
- Modify: `gateway/src/services/book.ts` (`create()` passes `alternateTakes` into the project context; a `setAlternateTakes` setter)
- Test: `tests/unit/inject-takes-steps.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // inject-takes-steps.ts
  export function injectTakesSteps(steps: ResolvedStepInput[], flags: { sceneTakes?: boolean; draftOpening?: boolean }): ResolvedStepInput[];
  // BookManifest.alternateTakes?: { sceneTakes?: boolean; draftOpening?: boolean }
  ```

- [ ] **Step 1: Write the failing test** (`inject-takes-steps.test.ts`)

```ts
// Given expanded steps with a scene_brief step (role 'scene_brief'), sceneTakes:true
// inserts an { role:'approach', vs:{enabled:true} } "Scene Takes — Chapter N" step
// immediately BEFORE it, carrying the chapterNumber. draftOpening:false inserts nothing before draft.
const out = injectTakesSteps(steps, { sceneTakes: true });
const briefIdx = out.findIndex(s => s.role === 'scene_brief');
assert.equal(out[briefIdx - 1].role, 'approach');
assert.equal(out[briefIdx - 1].vs?.enabled, true);
// flags off → steps unchanged
assert.deepEqual(injectTakesSteps(steps, {}), steps);
```

- [ ] **Step 2: Run to verify it fails.** → FAIL.

- [ ] **Step 3: Implement `injectTakesSteps`**

Pure function: walk the steps; for each `scene_brief` step, if `sceneTakes`, splice a new `approach`/`vs.enabled` step before it whose `prompt` asks for the k short "what happens in this scene" approaches (2-3 sentences each), carrying the same `chapterNumber`/`phase`. For each `draft` step, if `draftOpening`, splice a `draft`/`vs.enabled` "Draft Opening" step (short word target) before it. Return a new array; return the input unchanged when both flags are falsy. (Chosen approach/opening feeds downstream via the existing step-result chaining — no extra wiring; the injected step's result lands in context for the next step.)

- [ ] **Step 4: Add the manifest field + thread the flag**

- `book-types.ts`: `alternateTakes?: { sceneTakes?: boolean; draftOpening?: boolean }; // Alternate Takes per-book opt-in (additive-optional)`.
- `book.ts` `create()`: `...(sel.alternateTakes ? { alternateTakes: sel.alternateTakes } : {})` on the manifest, and a `setAlternateTakes(slug, flags)` setter (mirror `setReviewCadence`).
- `projects.ts` ~:943: after `const resolved = expandSteps(...)`, add `const withTakes = injectTakesSteps(resolved, context?.alternateTakes ?? {});` and use `withTakes` downstream. Ensure the book→project creation path puts `alternateTakes` into `context` (mirror how `heat`/`genre` reach context).

- [ ] **Step 5: Run to verify it passes.** `node --import tsx --test tests/unit/inject-takes-steps.test.ts && npx tsc --noEmit` → PASS + clean.

- [ ] **Step 6: Checkpoint** — injection test green, tsc clean.

---

### Task 8: Book-board UI toggle for Alternate Takes

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts` (`GET/POST /api/books/:slug/models` carry `alternateTakes`, OR a small dedicated `POST /api/books/:slug/alternate-takes`)
- Modify: `frontend/studio/src/components/book/BookModelsPanel.tsx` (two checkboxes: "Scene Takes", "Draft Opening")

**Interfaces:**
- Consumes: `setAlternateTakes` (Task 7).
- Produces: the models config payload gains `alternateTakes: { sceneTakes, draftOpening }`; POST persists via `setAlternateTakes`.

- [ ] **Step 1** Extend `GET /models` response with `alternateTakes: m.alternateTakes ?? { sceneTakes:false, draftOpening:false }`.
- [ ] **Step 2** Extend `POST /models` to accept `alternateTakes` (booleans validated) and call `services.books.setAlternateTakes(slug, body.alternateTakes)` when present; re-apply to the live project is not needed (it only affects newly-expanded projects).
- [ ] **Step 3** In `BookModelsPanel.tsx`, add a small "Alternate Takes" row with two checkboxes bound to `cfg.alternateTakes`, `save({ alternateTakes: {...} })` on change. Add `alternateTakes?` to the `ModelConfig` interface.
- [ ] **Step 4** Build: `npm run build:frontend` → succeeds.
- [ ] **Step 5: Checkpoint** — frontend builds; endpoint persists the flag.

---

### Task 9: Decision point B wiring is already covered by injection

Draft Opening injection is implemented in Task 7's `injectTakesSteps` (the `draftOpening` branch) and toggled in Task 8. No separate task — verify with an added assertion in `inject-takes-steps.test.ts`:
- [ ] **Step 1** Add a test: `injectTakesSteps(steps, { draftOpening: true })` inserts a `draft`/`vs.enabled` "Draft Opening" step before each `draft` step and leaves `scene_brief` untouched. Run it green.
- [ ] **Step 2: Checkpoint.**

---

### Task 10: Full suite, docs, commit message

- [ ] **Step 1** `npm run test:unit` → PASS (includes frontend build).
- [ ] **Step 2** `npm run test:api && npm run test:smoke` → PASS.
- [ ] **Step 3** Move the TODO sub-project-1 checkbox to COMPLETED (`2026-07-26 — Alternate Takes (VS) sub-project 1: engine + Scene Takes + Draft Opening + Takes gate + selection log`), leaving sub-projects 2-4 in TODO.
- [ ] **Step 4** Write `commit_message`:
```
feat(sampling): Alternate Takes (Verbalized Sampling) — engine + Takes gate + two decision points

- gateway/src/sampling/verbalized-sampling.ts: compose-parse-fail-open VS module wrapping the router
- per-step vs opt-in + role allowlist {approach,draft,scene_brief} (new 'approach' role); refused elsewhere
- Takes gate modeled on council-gate: project.takes marker + applyTakeSelection + POST /takes/select, wired at all 3 drive sites; never auto-selects, fails open to a single degraded completion
- per-book alternateTakes flag injects Scene Takes (above scene_brief) + Draft Opening (above draft) at expand; pipelines untouched
- per-book data/vs-selections.jsonl preference log (diversityScore slot reserved for sub-project 3)
- book-board toggles; full suite green

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01KpsGKDcv9VBDNMCfUW4W5T
```
- [ ] **Step 5: Checkpoint** — suite green, docs moved, commit_message present. (Deploy to Mercury per the session goal follows this plan.)

---

## Self-review notes

- **Spec coverage:** core module (T1); per-step flag + role allowlist + `approach` role (T2); pick-gate marker/apply (T3); selection-log schema incl. `diversityScore:null` (T4); gate interception mirroring council (T5); endpoint + 3-site wiring + production-model routing (T6); decision point A / Scene Takes (T7); UI toggle (T8); decision point B / Draft Opening (T7 injection + T9 test). Fail-open, never-auto-select, and gating-rule enforcement all appear. Out-of-scope items (diversity metric, token accounting, experiments) are deliberately absent.
- **Deviation from spec, noted:** the pick-gate is modeled on the **council gate** (a purpose-built candidate-picker: `project.takes` marker + `applyTakeSelection` + `/takes/select`) rather than extending the approve/edit/regenerate `review` union. Both are "existing machinery"; the council gate is the closer analog and keeps the picker semantics clean. Same user-facing behavior.
- **Deviation from spec, noted:** decision points are opt-in via a **per-book `alternateTakes` manifest flag + runtime injection**, not by editing pipeline JSONs — non-disruptive to existing books and matches the per-book model-selection pattern.
- **Type consistency:** `VsConfig`/`VsCandidate`/`VsResult`/`VsRouting`/`VsComplete` defined in T1 and reused in T2/T6; `project.takes` shape defined in T3 and produced by T5, consumed by T3's `applyTakeSelection` and T6's endpoint; `TakesLogRecord` (T4) fields match the spec schema.
