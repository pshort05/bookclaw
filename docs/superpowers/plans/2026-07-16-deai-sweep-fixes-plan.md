# De-AI Sweep Enhancements (Items 2/3/4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three defects in the chunked two-pass de-AI sweep: (2) Pass 2 never runs when Pass 1 fails, (3) an unavailable pass provider spams per-window "Provider gemini not found" instead of failing over or failing loud, and (4) add a deterministic AI-name find/replace stage that runs globally (dialogue included).

**Architecture:** All work is in the gateway's pure, router-free de-AI modules under `gateway/src/services/deai/`. The orchestrator `runChunkedDeAiSweep` stays fully unit-testable with injected fakes; the router is reached only through the already-injected `aiComplete` plus a new injected `availableProviders: string[]` list (mirroring the `consistency/model-selection.ts` pattern of passing provider ids into pure functions). Item 4 reuses the banned-terms CSV loader and case-preserving/word-boundary replace, parameterized by a new `scope: 'narration' | 'global'` option. The `applyDeAiEdits` contract in `deterministic-apply.ts` is unchanged. Everything is fail-soft.

**Tech Stack:** Node 22 + TypeScript via `tsx`; tests are `node:test` (`node --import tsx --test`). `.js` import extensions (NodeNext). No new dependencies.

## Global Constraints

- **Test runner (single file):** `node --import tsx --test tests/unit/<file>.test.ts`
- **Test runner (full de-AI suite):** `node --import tsx --test tests/unit/deai-*.test.ts`
- **Imports use `.js` extensions** even though source is `.ts`.
- **Fail-soft everywhere:** a window/provider error logs `⚠`/`ℹ` and degrades; it never throws out of the sweep or blocks the chapter.
- **`applyDeAiEdits` / `deterministic-apply.ts` contract is unchanged** — do not touch that file.
- **Surgical changes only.** Touch only the lines each task names. Remove only orphans your own change creates (e.g. an import that becomes unused).
- **No mobile/frontend overlap.** This work is entirely gateway-side (`gateway/src/services/deai/`, one seed CSV, unit tests). No `frontend/` file is touched. Prior de-AI work owns every file below; no other in-flight stream shares them.
- **Log prefix convention:** init/step logs use two-space-indented `  ✓ ` / `  ⚠ ` / `  ℹ ` markers — match exactly.

---

## File Structure

**Modified**
- `gateway/src/services/deai/banned-terms.ts` — add `scope?: 'narration' | 'global'` to `applyBannedTerms` (Task 1). No other change.
- `gateway/src/services/deai/sweep.ts` — errored-vs-clean pass tracking + short-circuit fix (Task 4); `resolveAvailablePassModel` + `DEFAULT_PASS` change (Task 5); preflight wiring + AI-name stage + `aiNameCounts` (Tasks 3, 6).
- `gateway/src/services/deai/run-step.ts` — thread `aiNames` + `availableProviders`; use the sweep-resolved per-window `provider`/`model` (Tasks 3, 6).
- `gateway/src/index.ts` — load AI-names + pass `availableProviders` at the one sweep call site (Tasks 3, 6); extend the log line.
- `gateway/src/api/routes/projects.routes.ts` — same, at its two sweep call sites (Tasks 3, 6).

**Created**
- `gateway/src/services/deai/ai-names.ts` — AI-name map loader + global-scope apply wrapper (Task 2).
- `library/ai-names.csv` — versioned seed (Task 2).
- `tests/unit/deai-ai-names.test.ts` — Item 4 unit tests (Tasks 1, 2).
- `tests/unit/deai-passmodel-availability.test.ts` — Item 3 `resolveAvailablePassModel` unit tests (Task 5).

**Touched tests (existing)**
- `tests/unit/deai-sweep.test.ts` — add `availableProviders`/`aiNames` to calls; update the "errored empty pass 1" expectation; add clean-vs-errored short-circuit tests (Tasks 3, 4, 6).
- `tests/unit/deai-ch1-fixture.test.ts` — add `availableProviders` (and `aiNames` if you don't rely on the default) to its `runChunkedDeAiSweep` call (Task 6).
- `tests/unit/deai-run-step.test.ts` — add `availableProviders` to its `runDeaiSweepStep` call (Task 6).
- `tests/unit/deai-passmodels.test.ts` — update the pass-1 default expectation after the `DEFAULT_PASS` change (Task 5).

---

## Task 1: Scope-parameterize `applyBannedTerms` (narration vs global)

The AI-name checker needs the SAME case-preserving, word-boundary replace as banned-terms but WITHOUT the narration mask (it must rewrite names inside dialogue too). Add a `scope` option; default `'narration'` preserves today's behavior exactly.

**Files:**
- Modify: `gateway/src/services/deai/banned-terms.ts` (the `applyBannedTerms` function, currently lines 101-126)
- Test: `tests/unit/deai-ai-names.test.ts` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `applyBannedTerms(text, fixed, opts?: { dryRun?: boolean; scope?: 'narration' | 'global' }): BannedApplyResult` — `scope: 'global'` replaces everywhere (dialogue + markdown included); omitted/`'narration'` is unchanged.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/deai-ai-names.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBannedTerms } from '../../gateway/src/services/deai/banned-terms.js';

test("applyBannedTerms scope 'global' replaces inside dialogue too", () => {
  const map = [{ find: 'Sarah', replace: 'Delia' }];
  const text = 'Sarah nodded. "Hi, Sarah," he said.';
  const res = applyBannedTerms(text, map, { scope: 'global' });
  assert.equal(res.text, 'Delia nodded. "Hi, Delia," he said.');
  assert.equal(res.counts['Sarah'], 2);
});

test("applyBannedTerms default scope leaves dialogue untouched (narration only)", () => {
  const map = [{ find: 'Sarah', replace: 'Delia' }];
  const text = 'Sarah nodded. "Hi, Sarah," he said.';
  const res = applyBannedTerms(text, map); // default narration
  assert.equal(res.text, 'Delia nodded. "Hi, Sarah," he said.');
  assert.equal(res.counts['Sarah'], 1);
});

test("applyBannedTerms scope 'global' is case-preserving and word-boundary aware", () => {
  const map = [{ find: 'Patel', replace: 'Okafor' }];
  const text = 'PATEL and Patel, but not Pateling.';
  const res = applyBannedTerms(text, map, { scope: 'global' });
  assert.equal(res.text, 'OKAFOR and Okafor, but not Pateling.');
  assert.equal(res.counts['Patel'], 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/deai-ai-names.test.ts`
Expected: FAIL — the global-scope test shows dialogue still masked (`"Hi, Sarah,"` unchanged), so `res.text`/`counts` mismatch.

- [ ] **Step 3: Write minimal implementation**

In `gateway/src/services/deai/banned-terms.ts`, change the `applyBannedTerms` signature and the two protected-range lines only:

```ts
export function applyBannedTerms(
  text: string,
  fixed: Array<{ find: string; replace: string }>,
  opts?: { dryRun?: boolean; scope?: 'narration' | 'global' },
): BannedApplyResult {
  const global = opts?.scope === 'global';
  let out = String(text ?? '');
  const counts: Record<string, number> = {};
  let total = 0;
  for (const { find, replace } of fixed) {
    if (!find) continue;
    const re = termRegex(find);
    // Recompute protected ranges each iteration — earlier replacements shift indices.
    // In 'global' scope nothing is protected (AI-name checker rewrites dialogue too).
    const ranges = global ? [] : protectedRanges(out);
    let result = '', last = 0, n = 0;
    for (let m; (m = re.exec(out)); ) {
      if (!global && isProtected(ranges, m.index)) continue;  // skip dialogue/markdown
      result += out.slice(last, m.index) + preserveCase(m[0], replace);
      last = m.index + m[0].length;
      n++;
    }
    result += out.slice(last);
    counts[find] = n; total += n;
    if (!opts?.dryRun && n > 0) out = result;
  }
  return { text: opts?.dryRun ? String(text ?? '') : out, counts, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/deai-ai-names.test.ts`
Expected: PASS (3/3). Also run `node --import tsx --test tests/unit/deai-banned-terms.test.ts` — Expected: PASS (default scope unchanged).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/banned-terms.ts tests/unit/deai-ai-names.test.ts
git commit -m "feat(deai): scope-parameterize applyBannedTerms (narration|global)"
```

---

## Task 2: AI-name checker module + seed CSV

A find/replace name map, loaded like banned-terms (versioned seed → workspace global → per-book overlay), applied globally via Task 1.

**Files:**
- Create: `gateway/src/services/deai/ai-names.ts`
- Create: `library/ai-names.csv`
- Test: `tests/unit/deai-ai-names.test.ts` (append)

**Interfaces:**
- Consumes: `parseBannedCsv`, `mergeBannedTerms`, `applyBannedTerms`, `BannedApplyResult` from `./banned-terms.js`.
- Produces:
  - `type AiNameMap = Array<{ find: string; replace: string }>`
  - `applyAiNames(text: string, names: AiNameMap): BannedApplyResult`
  - `loadAiNamesForBook(workspaceDir: string, slug: string, seedCsvPath: string): AiNameMap`

- [ ] **Step 1: Write the failing test** — append to `tests/unit/deai-ai-names.test.ts`:

```ts
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAiNames, loadAiNamesForBook } from '../../gateway/src/services/deai/ai-names.js';

test('applyAiNames replaces globally and counts per name', () => {
  const res = applyAiNames('Marcus Chen met Sarah. "Marcus Chen?" asked Sarah.',
    [{ find: 'Marcus Chen', replace: 'Theo Alvarez' }, { find: 'Sarah', replace: 'Delia' }]);
  assert.equal(res.text, 'Theo Alvarez met Delia. "Theo Alvarez?" asked Delia.');
  assert.equal(res.counts['Marcus Chen'], 2);
  assert.equal(res.counts['Sarah'], 2);
});

test('loadAiNamesForBook: seed copied to global, per-book overlay overrides by find', () => {
  const ws = mkdtempSync(join(tmpdir(), 'ainames-'));
  const seed = join(ws, 'seed-ai-names.csv');
  writeFileSync(seed, 'find,replace\nSarah,Delia\nPatel,Okafor\n');
  mkdirSync(join(ws, 'books', 'demo'), { recursive: true });
  writeFileSync(join(ws, 'books', 'demo', 'ai-names.csv'), 'find,replace\nSarah,Nadia\n');
  const map = loadAiNamesForBook(ws, 'demo', seed);
  // seed copied into workspace/.config on first load
  assert.ok(existsSync(join(ws, '.config', 'ai-names.csv')));
  // overlay overrides Sarah -> Nadia; Patel from global survives
  const bySarah = map.filter(e => e.find.toLowerCase() === 'sarah');
  assert.deepEqual(bySarah, [{ find: 'Sarah', replace: 'Nadia' }]);
  assert.ok(map.some(e => e.find === 'Patel' && e.replace === 'Okafor'));
  rmSync(ws, { recursive: true, force: true });
});

test('loadAiNamesForBook fail-soft: missing seed and files -> empty map', () => {
  const ws = mkdtempSync(join(tmpdir(), 'ainames-'));
  const map = loadAiNamesForBook(ws, 'nobook', join(ws, 'does-not-exist.csv'));
  assert.deepEqual(map, []);
  rmSync(ws, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/deai-ai-names.test.ts`
Expected: FAIL — `Cannot find module '.../ai-names.js'`.

- [ ] **Step 3a: Write the seed CSV** — create `library/ai-names.csv` (placeholder replacements — the author will curate/extend; each replacement is a natural, non-AI-default name in the same shape as its find: first→first, full→full, surname→surname):

```
find,replace
Sarah,Delia
Marcus Chen,Theo Alvarez
Patel,Okafor
```

- [ ] **Step 3b: Write the module** — create `gateway/src/services/deai/ai-names.ts`:

```ts
/**
 * Deterministic AI-name checker (zero-cost de-AI stage).
 *
 * A curated find/replace map of AI-default character names -> author alternatives,
 * applied by pure string replacement. Unlike banned-terms (narration only), this
 * runs GLOBALLY — INCLUDING dialogue — because a name must read the same in speech
 * and narration. Case-preserving and word-boundary aware (reuses applyBannedTerms
 * in 'global' scope). CSV storage mirrors banned-terms: a versioned seed +
 * workspace global + per-book overlay, columns `find,replace`.
 */

import { readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBannedCsv, mergeBannedTerms, applyBannedTerms, type BannedApplyResult } from './banned-terms.js';

export type AiNameMap = Array<{ find: string; replace: string }>;

/** Apply the AI-name map GLOBALLY (dialogue included). Thin wrapper over
 *  applyBannedTerms in 'global' scope so the case/word-boundary logic is shared. */
export function applyAiNames(text: string, names: AiNameMap): BannedApplyResult {
  return applyBannedTerms(text, names, { scope: 'global' });
}

/**
 * Load the AI-name map: create-if-absent global from the committed seed, merged
 * with the per-book overlay (overlay overrides global by `find`). Fail-soft: a
 * missing file → no entries. Blank-replace rows are dropped (a name map needs a
 * replacement; parseBannedCsv routes those to banOnly, which we ignore).
 */
export function loadAiNamesForBook(workspaceDir: string, slug: string, seedCsvPath: string): AiNameMap {
  const globalPath = join(workspaceDir, '.config', 'ai-names.csv');
  if (!existsSync(globalPath) && seedCsvPath && existsSync(seedCsvPath)) {
    try { mkdirSync(join(workspaceDir, '.config'), { recursive: true }); copyFileSync(seedCsvPath, globalPath); }
    catch { /* fail-soft: run against an empty map */ }
  }
  const readCsv = (p: string) => {
    try { return existsSync(p) ? parseBannedCsv(readFileSync(p, 'utf8')) : { fixed: [], banOnly: [] }; }
    catch { return { fixed: [], banOnly: [] }; }
  };
  const global = readCsv(globalPath);
  const overlay = readCsv(join(workspaceDir, 'books', slug, 'ai-names.csv'));
  return mergeBannedTerms(global, overlay).fixed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/deai-ai-names.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/ai-names.ts library/ai-names.csv tests/unit/deai-ai-names.test.ts
git commit -m "feat(deai): deterministic AI-name checker (global find/replace) + seed"
```

---

## Task 3: Run the AI-name stage inside the sweep

Add an AI-name deterministic stage to `runChunkedDeAiSweep` (right after banned-terms), thread `aiNames` through `run-step.ts` and the three production call sites, and report counts.

**Files:**
- Modify: `gateway/src/services/deai/sweep.ts` (`SweepResult`, `runChunkedDeAiSweep` args + Stage 0)
- Modify: `gateway/src/services/deai/run-step.ts` (`runDeaiSweepStep` args → sweep call)
- Modify: `gateway/src/index.ts` (~line 2513-2525)
- Modify: `gateway/src/api/routes/projects.routes.ts` (~lines 650-661 and ~1213-1225)
- Test: `tests/unit/deai-ai-names.test.ts` (append an end-to-end sweep test)

**Interfaces:**
- Consumes: `applyAiNames`, `type AiNameMap` from `./ai-names.js`; `loadAiNamesForBook` from `./ai-names.js` (callers).
- Produces:
  - `SweepResult` gains `aiNameCounts: Record<string, number>`.
  - `runChunkedDeAiSweep` args gain `aiNames?: AiNameMap` (default `[]`).
  - `runDeaiSweepStep` args gain `aiNames?: AiNameMap` (default `[]`).

- [ ] **Step 1: Write the failing test** — append to `tests/unit/deai-ai-names.test.ts`:

```ts
import { runChunkedDeAiSweep } from '../../gateway/src/services/deai/sweep.js';
import { parseBannedCsv } from '../../gateway/src/services/deai/banned-terms.js';
import { applyDeAiEdits, type DeAiEdit } from '../../gateway/src/services/deterministic-apply.js';

test('sweep runs the AI-name stage globally and reports aiNameCounts', async () => {
  const applyEdits = (base: string, edits: DeAiEdit[]) => applyDeAiEdits(base, edits);
  const res = await runChunkedDeAiSweep({
    draft: 'Sarah waved. "Bye, Sarah!" he called.',
    banned: parseBannedCsv('find,replace'),
    aiNames: [{ find: 'Sarah', replace: 'Delia' }],
    availableProviders: ['openrouter'],
    deps: { auditWindow: async () => [], applyEdits },
  });
  assert.equal(res.text, 'Delia waved. "Bye, Delia!" he called.'); // dialogue included
  assert.equal(res.aiNameCounts['Sarah'], 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/deai-ai-names.test.ts`
Expected: FAIL — `runChunkedDeAiSweep` rejects the unknown `aiNames`/`availableProviders` keys silently but `res.aiNameCounts` is `undefined` and the name is not replaced (TS also errors on `availableProviders` once Task 6 lands; for now the runtime assertion on `res.text`/`aiNameCounts` fails).

> Note: `availableProviders` becomes a required arg in Task 6. Include it here so this test needs no later edit; until Task 6 it is an ignored extra key (harmless at runtime through `tsx`).

- [ ] **Step 3a: Edit `sweep.ts`** — import, extend `SweepResult`, add the stage. At the top imports add:

```ts
import { applyAiNames, type AiNameMap } from './ai-names.js';
```

Change `SweepResult`:

```ts
export interface SweepResult { text: string; passes: number; bannedCounts: Record<string, number>; aiNameCounts: Record<string, number>; passStats: ApplyResult[]; }
```

Change `runChunkedDeAiSweep`'s args block and Stage 0 (keep the rest of the body as-is for now — Tasks 4/6 rewrite the pass logic):

```ts
export async function runChunkedDeAiSweep(args: {
  draft: string; banned: BannedTerms; aiNames?: AiNameMap;
  availableProviders: string[];
  stageModels?: Record<string, { provider?: string; model?: string }>;
  deps: SweepDeps; targetWords?: number;
}): Promise<SweepResult> {
  const targetWords = args.targetWords ?? 1000;
  const passStats: ApplyResult[] = [];

  // Stage 0: deterministic banned-terms (narration only) then AI-names (global).
  const banned = applyBannedTerms(args.draft, args.banned.fixed);
  const names = applyAiNames(banned.text, args.aiNames ?? []);
  let working = names.text;
  const forbiddenBlock = forbiddenWordsBlock(forbiddenWordsInNarration(working, args.banned.banOnly));
```

Then update EVERY `return { ... }` in the function to add `aiNameCounts: names.counts` (there are currently three; Tasks 4/6 add/adjust them — always include `aiNameCounts: names.counts`). For this task, the three existing returns become e.g.:

```ts
  return { text: working, passes: 1, bannedCounts: banned.counts, aiNameCounts: names.counts, passStats };
...
  return { text: working, passes: 2, bannedCounts: banned.counts, aiNameCounts: names.counts, passStats };
...
  return { text: working, passes: 2, bannedCounts: banned.counts, aiNameCounts: names.counts, passStats };
```

> `availableProviders` is added to the args signature here but not yet used until Task 6. That is intentional — it makes this task's test (which passes it) and Task 6 line up with no re-edit.

- [ ] **Step 3b: Edit `run-step.ts`** — add `aiNames` (and `availableProviders`, unused until Task 6) to `runDeaiSweepStep`'s args and forward them:

```ts
export async function runDeaiSweepStep(args: {
  steps: StepLike[];
  chapterNumber?: number;
  skillContent: string;
  stageModels?: Record<string, { provider?: string; model?: string }>;
  banned: BannedTerms;
  aiNames?: AiNameMap;
  availableProviders: string[];
  aiComplete: (req: any) => Promise<{ text?: string }>;
  targetWords?: number;
}): Promise<SweepResult> {
```

Add the import at the top:

```ts
import type { AiNameMap } from './ai-names.js';
```

And forward in the final call:

```ts
  return runChunkedDeAiSweep({
    draft, banned: args.banned, aiNames: args.aiNames, availableProviders: args.availableProviders,
    stageModels: args.stageModels,
    deps: { auditWindow, applyEdits }, targetWords: args.targetWords,
  });
```

- [ ] **Step 3c: Edit the three production call sites.** In `gateway/src/index.ts` near line 2513, after the `banned = loadBannedTermsForBook(...)` line, add the name load and pass both new args:

```ts
            const banned = loadBannedTermsForBook(workspaceDir, slug ?? '', join(ROOT_DIR, 'library', 'banned-terms.csv'));
            const aiNames = loadAiNamesForBook(workspaceDir, slug ?? '', join(ROOT_DIR, 'library', 'ai-names.csv'));
            const sweep = await runDeaiSweepStep({
              steps: project.steps as any,
              chapterNumber: (activeStep as any).chapterNumber,
              skillContent,
              stageModels: (project as any).stageModels,
              banned,
              aiNames,
              availableProviders: gateway.aiRouter.getActiveProviders().map(p => p.id),
              aiComplete: (r) => gateway.aiRouter.complete(r),
            });
```

Extend the log line to include names:

```ts
            const nm = Object.entries(sweep.aiNameCounts).filter(([, n]) => (n as number) > 0).map(([k, n]) => `${k}=${n}`).join(', ');
            console.log(`  ✓ romance-deai-audit ch${(activeStep as any).chapterNumber}: passes=${sweep.passes} banned=[${bt}] names=[${nm}] applies=${sweep.passStats.map(s => `${s.appliedSwaps}s/${s.appliedRewrites}r/${s.skipped}x`).join(' ')}`);
```

Add the import at the top of `index.ts` alongside the existing `run-step` import:

```ts
import { loadAiNamesForBook } from './services/deai/ai-names.js';
```

In `gateway/src/api/routes/projects.routes.ts` do the identical change at BOTH sweep call sites (~line 650 and ~line 1213). Use `services.aiRouter` and the route's `baseDir`/`j` helpers:

```ts
        const banned = loadBannedTermsForBook(j(baseDir, 'workspace'), slug ?? '', j(baseDir, 'library', 'banned-terms.csv'));
        const aiNames = loadAiNamesForBook(j(baseDir, 'workspace'), slug ?? '', j(baseDir, 'library', 'ai-names.csv'));
        const sweep = await runDeaiSweepStep({
          steps: project.steps as any,
          chapterNumber: (activeStep as any).chapterNumber,
          skillContent,
          stageModels: (project as any).stageModels,
          banned,
          aiNames,
          availableProviders: services.aiRouter.getActiveProviders().map(p => p.id),
          aiComplete: (r) => services.aiRouter.complete(r),
        });
        const nm = Object.entries(sweep.aiNameCounts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(', ');
        console.log(`  ✓ romance-deai-audit ch${(activeStep as any).chapterNumber}: passes=${sweep.passes} banned=[${bt}] names=[${nm}] applies=${sweep.passStats.map(s => `${s.appliedSwaps}s/${s.appliedRewrites}r/${s.skipped}x`).join(' ')}`);
```

Add the import near the existing `run-step` import at the top of `projects.routes.ts`:

```ts
import { loadAiNamesForBook } from '../../services/deai/ai-names.js';
```

- [ ] **Step 4: Verify** — new test + type-check + no regressions:

Run: `node --import tsx --test tests/unit/deai-ai-names.test.ts` → Expected: PASS.
Run: `npx tsc --noEmit` → Expected: no errors (this compiles the three call sites and confirms `getActiveProviders().map(p => p.id)` types).

> Existing `deai-sweep.test.ts`, `deai-ch1-fixture.test.ts`, and `deai-run-step.test.ts` still call the sweep WITHOUT `availableProviders`; they type-error now. Task 6 updates them. If you run the full suite here it will red on those three — that is expected and fixed in Task 6. Commit this task on the strength of the passing ai-names test + tsc of the production files.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/sweep.ts gateway/src/services/deai/run-step.ts gateway/src/index.ts gateway/src/api/routes/projects.routes.ts tests/unit/deai-ai-names.test.ts
git commit -m "feat(deai): run AI-name stage in the sweep + wire callers"
```

---

## Task 4: Errored-vs-clean pass tracking (Item 2 short-circuit fix)

Today Pass 2 is skipped whenever Pass 1's merged edit list is empty — even when every Pass-1 window ERRORED. Track per-pass whether any window errored, and short-circuit ONLY when Pass 1 completed with no errors and found nothing.

**Files:**
- Modify: `gateway/src/services/deai/sweep.ts` (`auditAllWindows` return shape + `runChunkedDeAiSweep` pass logic)
- Test: `tests/unit/deai-sweep.test.ts` (update one expectation + add two tests)

**Interfaces:**
- Consumes: nothing new.
- Produces (internal): `auditAllWindows(...) => Promise<{ edits: DeAiEdit[]; errored: boolean }>`. No external signature change.

- [ ] **Step 1: Write the failing tests** — in `tests/unit/deai-sweep.test.ts`:

First, UPDATE the existing "a thrown window audit is fail-soft" test — its `passes` expectation changes from `1` to `2` (Pass 2 now runs after a failed Pass 1). Also add `availableProviders` (needed once Task 6 lands; harmless now):

```ts
test('a thrown window audit is fail-soft (skipped, not fatal) and still runs pass 2', async () => {
  const banned = parseBannedCsv('find,replace');
  const res = await runChunkedDeAiSweep({
    draft: 'She utilized it.', banned, availableProviders: ['openrouter'],
    deps: { auditWindow: async () => { throw new Error('boom'); }, applyEdits },
  });
  assert.equal(res.text, 'She utilized it.'); // no crash, no edits
  assert.equal(res.passes, 2);                 // errored pass 1 must NOT short-circuit
});
```

Then ADD two tests that pin the clean-vs-errored distinction:

```ts
test('clean empty pass 1 (no errors) short-circuits at passes=1', async () => {
  const banned = parseBannedCsv('find,replace');
  let calls = 0;
  const res = await runChunkedDeAiSweep({
    draft: 'A calm clean paragraph.', banned, availableProviders: ['openrouter'],
    deps: { auditWindow: async () => { calls++; return []; }, applyEdits },
  });
  assert.equal(res.passes, 1);
  assert.equal(calls, 1, 'pass 2 must not run when pass 1 was clean');
});

test('errored empty pass 1 runs pass 2 which can still fix residue', async () => {
  const banned = parseBannedCsv('find,replace');
  const auditWindow = async ({ pass }: { pass: 1 | 2 }): Promise<DeAiEdit[]> => {
    if (pass === 1) throw new Error('provider down');
    return [{ op: 'swap', find: 'utilized', replace: 'used' }];
  };
  const res = await runChunkedDeAiSweep({
    draft: 'She utilized it.', banned, availableProviders: ['openrouter'],
    deps: { auditWindow, applyEdits },
  });
  assert.equal(res.passes, 2);
  assert.equal(res.text, 'She used it.');
});
```

Also add `availableProviders: ['openrouter']` to the OTHER existing calls in this file (the "banned-terms run first" test and the "two passes run" test) so the file compiles under Task 6; they behave identically.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/unit/deai-sweep.test.ts`
Expected: FAIL — "errored empty pass 1 runs pass 2" gets `passes: 1` (current code short-circuits on empty merge regardless of error).

- [ ] **Step 3: Implement** — in `sweep.ts`, change `auditAllWindows` to report errors:

```ts
async function auditAllWindows(
  working: string, pass: 1 | 2, forbiddenBlock: string, deps: SweepDeps, targetWords: number,
): Promise<{ edits: DeAiEdit[]; errored: boolean }> {
  const windows = chunkChapter(working, targetWords);
  const lists: DeAiEdit[][] = [];
  let errored = false;
  for (const w of windows) {
    try { lists.push(await deps.auditWindow({ windowText: w.text, seam: w.seam, pass, forbiddenBlock })); }
    catch (e) { errored = true; console.log(`  ⚠ deai pass ${pass} window audit failed — skipped: ${(e as Error).message}`); lists.push([]); }
  }
  return { edits: mergeWindowEdits(lists), errored };
}
```

Then rewrite the pass logic in `runChunkedDeAiSweep` (from "Pass 1" through the final return). Keep `aiNameCounts: names.counts` on every return:

```ts
  // Pass 1 — broad sweep, chunked.
  const p1 = await auditAllWindows(working, 1, forbiddenBlock, args.deps, targetWords);
  // Short-circuit ONLY when pass 1 completed with no errors AND found nothing.
  // A pass 1 that errored (empty due to failure) must NOT be mistaken for "clean".
  if (p1.edits.length === 0 && !p1.errored) {
    return { text: working, passes: 1, bannedCounts: banned.counts, aiNameCounts: names.counts, passStats };
  }
  if (p1.edits.length > 0) {
    const r1 = await args.deps.applyEdits(working, p1.edits);
    passStats.push(r1); working = r1.text;
  }

  // Pass 2 — second reader, re-window the applied text. Capped at 2 passes.
  const p2 = await auditAllWindows(working, 2, forbiddenBlock, args.deps, targetWords);
  if (p2.edits.length > 0) {
    const r2 = await args.deps.applyEdits(working, p2.edits);
    passStats.push(r2); working = r2.text;
  }

  return { text: working, passes: 2, bannedCounts: banned.counts, aiNameCounts: names.counts, passStats };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/deai-sweep.test.ts`
Expected: PASS (all tests, including the two new ones and the updated fail-soft test).

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/sweep.ts tests/unit/deai-sweep.test.ts
git commit -m "fix(deai): run pass 2 when pass 1 errored; short-circuit only on clean-empty"
```

---

## Task 5: `resolveAvailablePassModel` + change the pass-1 default (Item 3, pure part)

A pure resolver that, given a requested pass model and the router's available provider ids, keeps the request when its provider is available, otherwise falls back — preferring to preserve the detector family by routing through OpenRouter — and returns `null` only when NO provider is available at all. Also fix the `DEFAULT_PASS` pass-1 trap.

**Design note (why the default changes):** `DEFAULT_PASS[1] = { provider: 'gemini', model: 'auto:newest-gemini' }` is a double trap: (a) native `gemini` is often not configured (the observed "Provider gemini not found" spam), and (b) `auto:newest-gemini` is NOT a resolvable sentinel — only `auto:newest-sonnet|haiku|opus` exist (`gateway/src/ai/newest-sonnet.ts`), so even with a Gemini key it would send the literal string `auto:newest-gemini` to the Gemini API and 404. Change the default to a real OpenRouter Gemini slug so it works out of the box on the OpenRouter-only hosts (Mercury/Neptune) while keeping the detector≠writer intent (Gemini family for pass 1, Haiku for pass 2). The runtime preflight (Task 6) remains the safety net for any other misconfiguration or explicit `stageModels` pin.

**Files:**
- Modify: `gateway/src/services/deai/sweep.ts` (`DEFAULT_PASS`; add `resolveAvailablePassModel` + `OPENROUTER_FAMILY_SLUG`)
- Test: `tests/unit/deai-passmodel-availability.test.ts` (new); `tests/unit/deai-passmodels.test.ts` (update pass-1 default)

**Interfaces:**
- Consumes: `PassModel` (already exported).
- Produces: `resolveAvailablePassModel(requested: PassModel, available: string[]): { provider: string; model: string; fellBack: boolean } | null`.

- [ ] **Step 1: Write the failing tests** — create `tests/unit/deai-passmodel-availability.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAvailablePassModel } from '../../gateway/src/services/deai/sweep.js';

test('keeps the request when its provider is available', () => {
  assert.deepEqual(
    resolveAvailablePassModel({ provider: 'openrouter', model: 'x/y' }, ['openrouter', 'claude']),
    { provider: 'openrouter', model: 'x/y', fellBack: false });
});

test('native gemini unavailable -> falls back to OpenRouter Gemini slug (family preserved)', () => {
  assert.deepEqual(
    resolveAvailablePassModel({ provider: 'gemini', model: 'auto:newest-gemini' }, ['openrouter', 'claude']),
    { provider: 'openrouter', model: 'google/gemini-2.5-flash', fellBack: true });
});

test('provider unavailable and no OpenRouter -> last-resort first available, router-default model', () => {
  assert.deepEqual(
    resolveAvailablePassModel({ provider: 'gemini', model: 'auto:newest-gemini' }, ['ollama']),
    { provider: 'ollama', model: '', fellBack: true });
});

test('no provider available at all -> null', () => {
  assert.equal(resolveAvailablePassModel({ provider: 'gemini', model: 'x' }, []), null);
});
```

Also UPDATE `tests/unit/deai-passmodels.test.ts` — the pass-1 default now routes Gemini via OpenRouter:

```ts
test('defaults: pass1 OpenRouter-routed Gemini, pass2 Haiku', () => {
  assert.deepEqual(resolveDeaiPassModel(undefined, 1), { provider: 'openrouter', model: 'google/gemini-2.5-flash' });
  assert.deepEqual(resolveDeaiPassModel({}, 2), { provider: 'openrouter', model: 'auto:newest-haiku' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/unit/deai-passmodel-availability.test.ts tests/unit/deai-passmodels.test.ts`
Expected: FAIL — `resolveAvailablePassModel` is not exported; passmodels default mismatch.

- [ ] **Step 3: Implement** — in `sweep.ts`, change `DEFAULT_PASS` and add the resolver near `resolveDeaiPassModel`:

```ts
const DEFAULT_PASS: Record<1 | 2, PassModel> = {
  1: { provider: 'openrouter', model: 'google/gemini-2.5-flash' },
  2: { provider: 'openrouter', model: 'auto:newest-haiku' },
};

/** Family-preserving OpenRouter slug for a native provider whose direct API is
 *  unavailable (used by the preflight fallback). Unknown providers keep the
 *  requested model string. */
const OPENROUTER_FAMILY_SLUG: Record<string, string> = {
  gemini: 'google/gemini-2.5-flash',
  claude: 'auto:newest-haiku',
  openai: 'openai/gpt-4o-mini',
};

/**
 * Preflight-resolve a pass model against the router's available provider ids.
 * - Provider available → keep as-is (fellBack: false).
 * - Provider unavailable, OpenRouter available → route the same family through
 *   OpenRouter (keeps the "detector family" intent), fellBack: true.
 * - Provider unavailable, no OpenRouter → first available provider with an empty
 *   model (router picks its default), fellBack: true.
 * - Nothing available at all → null (caller fails loudly once and skips the sweep).
 */
export function resolveAvailablePassModel(
  requested: PassModel, available: string[],
): { provider: string; model: string; fellBack: boolean } | null {
  if (!available.length) return null;
  if (available.includes(requested.provider)) {
    return { provider: requested.provider, model: requested.model, fellBack: false };
  }
  if (available.includes('openrouter')) {
    return { provider: 'openrouter', model: OPENROUTER_FAMILY_SLUG[requested.provider] ?? requested.model, fellBack: true };
  }
  return { provider: available[0], model: '', fellBack: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/deai-passmodel-availability.test.ts tests/unit/deai-passmodels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/sweep.ts tests/unit/deai-passmodel-availability.test.ts tests/unit/deai-passmodels.test.ts
git commit -m "feat(deai): preflight pass-model resolver + OpenRouter-Gemini default"
```

---

## Task 6: Wire preflight into the sweep + thread available providers (Item 3, integration)

Resolve BOTH pass models against `availableProviders` at sweep start, log a single clear `⚠` per fallback, skip the LLM passes with ONE loud log when nothing is available (returning the banned/name-applied text), and pass the resolved `provider`/`model` down into each `auditWindow` call so `run-step.ts` stops re-resolving (killing the per-window "Provider gemini not found" spam).

**Files:**
- Modify: `gateway/src/services/deai/sweep.ts` (`SweepDeps.auditWindow` args; `auditAllWindows` params; preflight block; passes=0 skip return)
- Modify: `gateway/src/services/deai/run-step.ts` (use `w.provider`/`w.model`; drop the now-unused `resolveDeaiPassModel` call/import)
- Test: `tests/unit/deai-sweep.test.ts` (add preflight tests); update `tests/unit/deai-ch1-fixture.test.ts` and `tests/unit/deai-run-step.test.ts` calls

**Interfaces:**
- Consumes: `resolveAvailablePassModel` (Task 5); `resolveDeaiPassModel` (existing).
- Produces:
  - `SweepDeps.auditWindow` args gain `provider: string; model: string`.
  - `runChunkedDeAiSweep` uses the required `availableProviders: string[]` (added in Task 3).
  - New behavior: `passes: 0` when no provider is available (LLM passes skipped; banned/name stages still applied).

- [ ] **Step 1: Write the failing tests** — in `tests/unit/deai-sweep.test.ts` add:

```ts
test('preflight: no available provider skips LLM passes (passes=0) but keeps deterministic stages', async () => {
  const banned = parseBannedCsv('find,replace\nphone buzzed,phone vibrated');
  let audited = false;
  const res = await runChunkedDeAiSweep({
    draft: 'The phone buzzed. She utilized it.', banned, availableProviders: [],
    deps: { auditWindow: async () => { audited = true; return []; }, applyEdits },
  });
  assert.equal(res.passes, 0);
  assert.equal(audited, false, 'no window audit runs without a provider');
  assert.equal(res.text, 'The phone vibrated. She utilized it.'); // banned stage still applied
});

test('preflight: default pass-1 gemini falls back and the resolved model reaches auditWindow', async () => {
  const banned = parseBannedCsv('find,replace');
  const seen: Array<{ provider: string; model: string; pass: 1 | 2 }> = [];
  const auditWindow = async (w: { provider: string; model: string; pass: 1 | 2 }) => {
    seen.push({ provider: w.provider, model: w.model, pass: w.pass });
    return [] as DeAiEdit[];
  };
  const res = await runChunkedDeAiSweep({
    draft: 'A clean paragraph.', banned,
    // native gemini NOT available; openrouter is -> pass 1 should route via openrouter
    availableProviders: ['openrouter'],
    stageModels: { deai_pass1: { provider: 'gemini', model: 'auto:newest-gemini' } },
    deps: { auditWindow, applyEdits },
  });
  assert.equal(res.passes, 1); // clean, short-circuit
  assert.deepEqual(seen[0], { provider: 'openrouter', model: 'google/gemini-2.5-flash', pass: 1 });
});
```

Confirm every `runChunkedDeAiSweep` call in this file now passes `availableProviders` (added in Task 4 for most; ensure the two remaining originals have it).

Update `tests/unit/deai-ch1-fixture.test.ts` line 49 — add `availableProviders` and update its local `auditWindow` fake to accept the new arg shape (it can keep ignoring `provider`/`model`):

```ts
  const res = await runChunkedDeAiSweep({ draft: ch1, banned: parseBannedCsv('find,replace'), availableProviders: ['openrouter'], deps: { auditWindow, applyEdits } });
```

Update `tests/unit/deai-run-step.test.ts` — add `availableProviders` to the `runDeaiSweepStep` call:

```ts
  const res = await runDeaiSweepStep({
    steps, chapterNumber: 1,
    skillContent: '# De-AI Audit skill body',
    banned, availableProviders: ['openrouter'], aiComplete,
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/unit/deai-sweep.test.ts`
Expected: FAIL — `passes` is `1`/`2` (not `0`) with no provider, and `seen[0]` is `undefined` (auditWindow gets no `provider`/`model` yet).

- [ ] **Step 3a: Edit `sweep.ts`** — add `provider`/`model` to the `auditWindow` dep type:

```ts
export interface SweepDeps {
  auditWindow: (args: { windowText: string; seam: string; pass: 1 | 2; forbiddenBlock: string; provider: string; model: string }) => Promise<DeAiEdit[]>;
  applyEdits: (base: string, edits: DeAiEdit[]) => Promise<ApplyResult>;
}
```

Thread the resolved model through `auditAllWindows`:

```ts
async function auditAllWindows(
  working: string, pass: 1 | 2, forbiddenBlock: string, deps: SweepDeps, targetWords: number,
  provider: string, model: string,
): Promise<{ edits: DeAiEdit[]; errored: boolean }> {
  const windows = chunkChapter(working, targetWords);
  const lists: DeAiEdit[][] = [];
  let errored = false;
  for (const w of windows) {
    try { lists.push(await deps.auditWindow({ windowText: w.text, seam: w.seam, pass, forbiddenBlock, provider, model })); }
    catch (e) { errored = true; console.log(`  ⚠ deai pass ${pass} window audit failed — skipped: ${(e as Error).message}`); lists.push([]); }
  }
  return { edits: mergeWindowEdits(lists), errored };
}
```

Insert the preflight block right after `forbiddenBlock` is computed and BEFORE Pass 1, then pass `m1`/`m2` into the two `auditAllWindows` calls:

```ts
  // Preflight: resolve both pass models against the router's available providers.
  const req1 = resolveDeaiPassModel(args.stageModels, 1);
  const req2 = resolveDeaiPassModel(args.stageModels, 2);
  const m1 = resolveAvailablePassModel(req1, args.availableProviders);
  const m2 = resolveAvailablePassModel(req2, args.availableProviders);
  if (!m1 || !m2) {
    console.log('  ⚠ de-AI sweep skipped: no AI provider is available — ran banned-terms + AI-name stages only.');
    return { text: working, passes: 0, bannedCounts: banned.counts, aiNameCounts: names.counts, passStats };
  }
  if (m1.fellBack) console.log(`  ⚠ de-AI pass 1 provider "${req1.provider}" unavailable — routed to ${m1.provider}/${m1.model}`);
  if (m2.fellBack) console.log(`  ⚠ de-AI pass 2 provider "${req2.provider}" unavailable — routed to ${m2.provider}/${m2.model}`);

  // Pass 1 — broad sweep, chunked.
  const p1 = await auditAllWindows(working, 1, forbiddenBlock, args.deps, targetWords, m1.provider, m1.model);
  ...
  // Pass 2 — second reader, re-window the applied text. Capped at 2 passes.
  const p2 = await auditAllWindows(working, 2, forbiddenBlock, args.deps, targetWords, m2.provider, m2.model);
  ...
```

Add `resolveAvailablePassModel` to the local references (it is defined in this same file, so no import needed).

- [ ] **Step 3b: Edit `run-step.ts`** — the `auditWindow` closure now receives the resolved `provider`/`model`; use them and delete the in-closure `resolveDeaiPassModel` call:

```ts
  const auditWindow = async (w: { windowText: string; seam: string; pass: 1 | 2; forbiddenBlock: string; provider: string; model: string }): Promise<DeAiEdit[]> => {
    const system = args.skillContent
      + (w.pass === 2 ? `\n\n${secondReaderFraming()}` : '')
      + w.forbiddenBlock;
    const seamNote = w.seam
      ? `\n\n## Read-only preceding context (do NOT emit edits for this — it is here only so you can spot cross-seam tells):\n${w.seam}\n`
      : '';
    const res = await args.aiComplete({
      provider: w.provider,
      model: w.model,
      system,
      messages: [{ role: 'user', content: `Chapter window to audit:\n${w.windowText}${seamNote}` }],
      maxTokens: 4000,
      temperature: 0.3,
    });
    return parseAuditEdits(res?.text ?? '');
  };
```

Then remove `resolveDeaiPassModel` from the import on line 8 (it is now unused — an orphan this change creates); keep `runChunkedDeAiSweep`, `secondReaderFraming`, `type SweepResult`:

```ts
import { runChunkedDeAiSweep, secondReaderFraming, type SweepResult } from './sweep.js';
```

- [ ] **Step 4: Verify — full de-AI suite + type-check**

Run: `node --import tsx --test tests/unit/deai-*.test.ts`
Expected: PASS across every de-AI test (sweep, ai-names, passmodels, passmodel-availability, run-step, ch1-fixture, banned-terms, banned-loader, chunk-chapter, merge-edits, narration-spans, pipeline-substep-order).
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/deai/sweep.ts gateway/src/services/deai/run-step.ts tests/unit/deai-sweep.test.ts tests/unit/deai-ch1-fixture.test.ts tests/unit/deai-run-step.test.ts
git commit -m "feat(deai): preflight provider check with family-preserving fallback; skip loudly once when none"
```

---

## Task 7: Full-suite verification + docs bookkeeping

**Files:**
- Modify: `docs/TODO.md` / `docs/COMPLETED.md` (move the three items per the project workflow)
- Modify: `commit_message` (repo-root, per the maintainer workflow — do NOT `git commit`/`push`)

- [ ] **Step 1: Run the whole unit suite**

Run: `node --import tsx --test tests/unit/*.test.ts`
Expected: PASS (no red). If any non-de-AI test references the old `DEFAULT_PASS` pass-1 default or the sweep signature, fix that reference (none expected).

- [ ] **Step 2: Type-check the whole gateway**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Move the tracked items** — in `docs/TODO.md`, find the three de-AI sweep items (short-circuit fix, preflight/fallback, AI-name checker) and move them to `docs/COMPLETED.md` with a `2026-07-16` completion-date prefix, preserving the original bullet text. If they are not yet listed in `docs/TODO.md`, add them to `COMPLETED.md` directly under the de-AI grouping.

- [ ] **Step 4: Write the commit message** — write `commit_message` at the repo root (the maintainer runs `./push.sh`):

```
feat(deai): pass-2-after-failure fix, provider preflight/fallback, AI-name checker

- sweep: run pass 2 when pass 1 errored; short-circuit only on clean-empty pass 1
- sweep: preflight both pass models against available providers; family-preserving
  OpenRouter fallback; skip loudly once (passes=0) when no provider is available
- sweep/default: pass-1 default now openrouter/google/gemini-2.5-flash (native
  gemini + auto:newest-gemini was unresolvable and unconfigured on OpenRouter hosts)
- ai-names: deterministic global (dialogue-inclusive) AI-name find/replace stage,
  CSV seed library/ai-names.csv + workspace/per-book overlay, counts logged
- banned-terms: applyBannedTerms parameterized by scope (narration|global)
```

- [ ] **Step 5: Commit the plan bookkeeping**

```bash
git add docs/TODO.md docs/COMPLETED.md commit_message
git commit -m "docs(deai): move sweep-fix items to COMPLETED; write commit_message"
```

---

## Self-Review

**Spec coverage (against the task brief's three items):**
- Item 2 (short-circuit fix): Task 4 — per-pass `errored` tracking; short-circuit only on clean-empty pass 1; cap of 2 preserved. ✓
- Item 3 (preflight + fallback): Task 5 (pure resolver + `DEFAULT_PASS` fix) + Task 6 (wiring, single loud skip, resolved model threaded to `auditWindow`, spam removed). ✓
- Item 4 (AI-name checker): Task 1 (`scope` param), Task 2 (module + seed + loader), Task 3 (sweep stage + counts + caller wiring). ✓
- "Most-pure units first": name-checker global replace (Tasks 1-2), errored-vs-clean tracking (Task 4), preflight resolution (Task 5) precede all wiring (Tasks 3, 6). ✓
- Reuse existing deai modules: `applyBannedTerms`/`parseBannedCsv`/`mergeBannedTerms` (Item 4), `chunkChapter`/`mergeWindowEdits`/`resolveDeaiPassModel` (unchanged). ✓
- `applyDeAiEdits` contract unchanged: `deterministic-apply.ts` is never edited. ✓
- Fail-soft: window errors logged and skipped; no-provider skips (passes=0) not throws; loaders fail-soft to empty. ✓
- Shared-file callout: only gateway files + one seed CSV + unit tests; no `frontend/` overlap. ✓

**Type consistency:** `AiNameMap`, `SweepResult.aiNameCounts`, `resolveAvailablePassModel`'s `{ provider; model; fellBack }` return, and the `auditWindow` arg shape `{ windowText; seam; pass; forbiddenBlock; provider; model }` are used identically in every task that references them.

**Placeholder scan:** every code step shows complete code; every run step names the exact command and expected result. No TBD/TODO left in the plan.

**Open recommendation (surfaced, resolved in-plan):** change `DEFAULT_PASS[1]` to `{ provider: 'openrouter', model: 'google/gemini-2.5-flash' }` — recommended and adopted (Task 5), because native `gemini` + the non-existent `auto:newest-gemini` sentinel is the exact live trap and OpenRouter is the actual configured provider on Mercury/Neptune; preflight remains the safety net for other misconfigurations. Seed replacement names chosen as curatable placeholders: Sarah→Delia, Marcus Chen→Theo Alvarez, Patel→Okafor.
