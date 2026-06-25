# Consistency Audit Model Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user pick the AI provider + exact model for the consistency audit's fact extraction, persisted per book (`book.json`) and overridable per run (audit POST body).

**Architecture:** A pure resolver (`resolveConsistencyModel`) computes the effective `{provider, model}` from `per-run → per-book → auto`. The audit wrapper in `index.ts` reads the book manifest, resolves once, and bakes the selection into the `extract` closure it already builds — so `audit.ts`/`check-engine.ts` are untouched. `extractChapterFacts` gains an optional override and uses the router's existing `selectProvider(taskType, preferredId)` + `complete({provider, model})`. Persistence is an additive-optional `BookManifest.consistency` field with a `setConsistencyModel` setter mirroring `setFormat`. The studio Consistency panel gets a provider dropdown + free-text model input that PUTs the per-book default and sends a per-run override on Run.

**Tech Stack:** TypeScript (NodeNext, `.js` import extensions), Express, `node --test` via tsx, React (Vite studio), zod (MCP).

## Global Constraints

- Imports use `.js` extensions even from `.ts` (NodeNext). Match this in every new/edited file.
- Fail-soft posture: invalid provider → auto; persistence/UI failures never block an audit. Init/log style uses `console.log('  ✓ …' / '  ⚠ …')`.
- Provider keys come only from the vault; never hardcode. Provider set: `['gemini','deepseek','claude','openai','ollama','openrouter']`.
- Additive-optional manifest field — **no `schemaVersion` bump** (mirror `format?`).
- Reuse the existing `{provider, model}` override shape; do not invent a new mechanism.
- `mcp/` tools change in lockstep with the gateway route they wrap (same commit).
- Run unit tests with: `node --import tsx --test 'tests/unit/*.test.ts'`. Type-check with `npx tsc --noEmit`.

---

### Task 1: Model-selection resolver (pure)

**Files:**
- Create: `gateway/src/services/consistency/model-selection.ts`
- Test: `tests/unit/consistency-model-selection.test.ts`

**Interfaces:**
- Produces: `CONSISTENCY_PROVIDERS: readonly string[]`; `resolveConsistencyModel(perRun, perBook): { provider?: string; model?: string }` where each arg is `{ provider?: string; model?: string } | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/consistency-model-selection.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConsistencyModel, CONSISTENCY_PROVIDERS } from '../../gateway/src/services/consistency/model-selection.js';

test('per-run beats per-book', () => {
  const r = resolveConsistencyModel({ provider: 'claude', model: 'claude-x' }, { provider: 'gemini' });
  assert.deepEqual(r, { provider: 'claude', model: 'claude-x' });
});
test('falls back to per-book, then auto', () => {
  assert.deepEqual(resolveConsistencyModel(undefined, { provider: 'gemini' }), { provider: 'gemini', model: undefined });
  assert.deepEqual(resolveConsistencyModel(undefined, undefined), { provider: undefined, model: undefined });
});
test('invalid provider -> auto (and drops its model)', () => {
  assert.deepEqual(resolveConsistencyModel({ provider: 'bogus', model: 'm' }, undefined), { provider: undefined, model: undefined });
});
test('model without a provider is dropped; whitespace model dropped', () => {
  assert.deepEqual(resolveConsistencyModel({ model: 'm' }, undefined), { provider: undefined, model: undefined });
  assert.deepEqual(resolveConsistencyModel({ provider: 'openrouter', model: '   ' }, undefined), { provider: 'openrouter', model: undefined });
});
test('provider set is the six known providers', () => {
  assert.deepEqual([...CONSISTENCY_PROVIDERS].sort(), ['claude','deepseek','gemini','ollama','openai','openrouter']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/consistency-model-selection.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/services/consistency/model-selection.ts
/** Provider/model selection for the consistency audit's fact extraction. */
export const CONSISTENCY_PROVIDERS = ['gemini','deepseek','claude','openai','ollama','openrouter'] as const;

export interface ModelSel { provider?: string; model?: string }

/**
 * Effective selection: per-run override → per-book default → auto.
 * Invalid provider falls back to auto; a model is kept only with a valid provider.
 */
export function resolveConsistencyModel(perRun: ModelSel | undefined, perBook: ModelSel | undefined): ModelSel {
  const pick = perRun ?? perBook ?? {};
  const provider = (CONSISTENCY_PROVIDERS as readonly string[]).includes(pick.provider ?? '') ? pick.provider : undefined;
  const model = provider && typeof pick.model === 'string' && pick.model.trim() ? pick.model.trim() : undefined;
  return { provider, model };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/consistency-model-selection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** (defer to final push per repo workflow — no `git commit` here).

---

### Task 2: Manifest field + `setConsistencyModel`

**Files:**
- Modify: `gateway/src/services/book-types.ts` (BookManifest)
- Modify: `gateway/src/services/book.ts` (after `setFormat`, ~line 354)
- Test: `tests/unit/consistency-set-model.test.ts`

**Interfaces:**
- Consumes: `ModelSel` from Task 1.
- Produces: `BookManifest.consistency?: { provider?: string; model?: string }`; `BookService.setConsistencyModel(slug: string, sel: { provider?: string; model?: string }): Promise<BookManifest>` (an empty/cleared sel removes the field).

- [ ] **Step 1: Add the manifest field**

In `book-types.ts`, in `interface BookManifest`, immediately after the `format?` line:

```ts
  consistency?: { provider?: string; model?: string }; // Consistency audit model selection (additive-optional, no schema bump)
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/consistency-set-model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BookService } from '../../gateway/src/services/book.js';

async function makeBook() {
  const root = mkdtempSync(join(tmpdir(), 'bc-cm-'));
  const svc = new BookService(root);
  await svc.create({ title: 'T', author: 'A' } as any); // returns slug-bearing manifest
  const list = svc.list();
  return { svc, root, slug: list[0].slug };
}

test('setConsistencyModel round-trips and clears', async () => {
  const { svc, root, slug } = await makeBook();
  try {
    await svc.setConsistencyModel(slug, { provider: 'openrouter', model: 'google/gemini-2.5-flash' });
    let m = (await svc.open(slug))!.manifest;
    assert.deepEqual(m.consistency, { provider: 'openrouter', model: 'google/gemini-2.5-flash' });
    await svc.setConsistencyModel(slug, {});
    m = (await svc.open(slug))!.manifest;
    assert.equal(m.consistency, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
```

> Note: confirm `BookService.create`'s exact argument shape against `book.ts` before running; adjust the `create(...)` call to match (the test only needs a created book + its slug).

- [ ] **Step 3: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/consistency-set-model.test.ts`
Expected: FAIL (`setConsistencyModel` is not a function).

- [ ] **Step 4: Implement `setConsistencyModel`** (in `book.ts`, right after `setFormat`)

```ts
  async setConsistencyModel(slug: string, sel: { provider?: string; model?: string }): Promise<BookManifest> {
    const opened = await this.open(slug);
    if (!opened) throw new Error(`book not found: ${slug}`);
    const { manifest } = opened;
    await this.assertWritable(slug);
    const provider = sel?.provider?.trim();
    const model = sel?.model?.trim();
    if (provider) manifest.consistency = model ? { provider, model } : { provider };
    else delete manifest.consistency;
    manifest.history.push({ at: new Date().toISOString(), event: 'consistency-model-set', detail: provider ? (model ? `${provider}/${model}` : provider) : 'auto' });
    await writeFile(join(this.booksDir, slug, 'book.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    return manifest;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/consistency-set-model.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit** (defer to final push).

---

### Task 3: Extractor honors the override

**Files:**
- Modify: `gateway/src/services/consistency/extractor.ts:194-227`
- Test: `tests/unit/consistency-extractor-override.test.ts`

**Interfaces:**
- Produces: `extractChapterFacts(deps, chapterText, knownEntities, chapterStoryBase, override?)` where `override?: { provider?: string; model?: string }`; `deps.ai.select(t: string, preferredId?: string)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/consistency-extractor-override.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractChapterFacts } from '../../gateway/src/services/consistency/extractor.js';

test('passes override provider to select and model to complete', async () => {
  let seenPref: string | undefined; let seenModel: string | undefined;
  const deps = { ai: {
    select: (_t: string, pref?: string) => { seenPref = pref; return { id: pref ?? 'gemini' }; },
    complete: async (r: any) => { seenModel = r.model; return { text: '{"facts":[],"events":[]}' }; },
  } };
  await extractChapterFacts(deps as any, 'text', [], 0, { provider: 'claude', model: 'claude-x' });
  assert.equal(seenPref, 'claude');
  assert.equal(seenModel, 'claude-x');
});

test('no override -> select gets no preferredId, complete gets no model', async () => {
  let seenPref: string | undefined = 'unset'; let seenModel: string | undefined = 'unset';
  const deps = { ai: {
    select: (_t: string, pref?: string) => { seenPref = pref; return { id: 'gemini' }; },
    complete: async (r: any) => { seenModel = r.model; return { text: '{"facts":[],"events":[]}' }; },
  } };
  await extractChapterFacts(deps as any, 'text', [], 0);
  assert.equal(seenPref, undefined);
  assert.equal(seenModel, undefined);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/unit/consistency-extractor-override.test.ts`
Expected: FAIL (override ignored; `seenPref`/`seenModel` wrong).

- [ ] **Step 3: Implement** — edit the `deps` type and the `select`/`complete` calls.

Change the `deps.ai` type (lines ~196-199) to:

```ts
    ai: {
      complete(req: any): Promise<{ text: string }>;
      select(t: string, preferredId?: string): { id: string };
    };
```

Add the override param to the signature (after `chapterStoryBase: number,`):

```ts
  override?: { provider?: string; model?: string },
```

Replace the call block (lines ~220-227) with:

```ts
  const provider = deps.ai.select('consistency', override?.provider);
  const res = await deps.ai.complete({
    provider: provider.id,
    model: override?.model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    maxTokens: 8000,
    temperature: 0.1,
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test tests/unit/consistency-extractor-override.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit** (defer to final push).

---

### Task 4: Wire the override through `consistencyAudit` (`index.ts`)

**Files:**
- Modify: `gateway/src/index.ts:1332-1366` (the `consistencyAudit` wrapper)

**Interfaces:**
- Consumes: `resolveConsistencyModel` (Task 1), `extractChapterFacts(…, override)` (Task 3), `BookManifest.consistency` (Task 2).
- Produces: `consistencyAudit(slug: string, onProgress?: (msg: string) => void, override?: { provider?: string; model?: string }): Promise<AuditReport>`.

- [ ] **Step 1: Add the import** near the other consistency imports (top of `index.ts`):

```ts
import { resolveConsistencyModel } from './services/consistency/model-selection.js';
```

- [ ] **Step 2: Rewrite the wrapper** (replace lines 1332-1366):

```ts
      consistencyAudit: async (slug: string, onProgress?: (msg: string) => void, override?: { provider?: string; model?: string }): Promise<AuditReport> => {
        const books = this.books;
        const aiRouter = this.aiRouter;
        // Resolve once: per-run override → per-book book.json → auto.
        const manifest = (await books.open(slug) as any)?.manifest;
        const sel = resolveConsistencyModel(override, manifest?.consistency);
        return runConsistencyAudit(slug, {
          store: this.consistencyStore!,
          books: {
            dataDirOf: (s) => books.dataDirOf(s),
            worldDocsOf: (s) => books.worldDocsOf(s),
            worldbuildingOf: (s) => books.worldbuildingOf(s),
            open: (s) => books.open(s) as Promise<any>,
          },
          extract: (chapterText, known, base) =>
            extractChapterFacts(
              {
                ai: {
                  complete: async (r) => {
                    const resp = await aiRouter.complete(r);
                    try { this.costs.record(resp.provider ?? r.provider, resp.tokensUsed, resp.estimatedCost, slug); } catch { /* best-effort */ }
                    return resp;
                  },
                  select: (t, pref) => aiRouter.selectProvider(t, pref),
                },
              },
              chapterText, known, base, sel,
            ),
          onProgress,
        });
      },
```

- [ ] **Step 3: Verify type-check**

Run: `npx tsc --noEmit`
Expected: clean (no errors). The full suite stays green: `node --import tsx --test 'tests/unit/*.test.ts'`.

- [ ] **Step 4: Commit** (defer to final push).

---

### Task 5: API — PUT default, POST override, GET rehydrate

**Files:**
- Modify: `gateway/src/api/routes/consistency.routes.ts`

**Interfaces:**
- Consumes: `consistencyAudit(slug, onProgress, override)` (Task 4); `services.books.setConsistencyModel` (Task 2).
- Produces: `PUT /api/books/:slug/consistency-model`; POST audit reads body `{provider, model}`; GET report returns `consistencyModel`.

- [ ] **Step 1: GET report — include `consistencyModel`.** In the GET `/consistency-report` handler, change the `res.json({...})` to add the field (read from the manifest):

```ts
      const cm = (await services.books.open(slug) as any)?.manifest?.consistency ?? null;
      res.json({
        report: services.consistencyStore?.getReport(slug) ?? null,
        running: gateway.consistencyJobs.isRunning(slug),
        job: gateway.consistencyJobs.get(slug),
        consistencyModel: cm,
      });
```

- [ ] **Step 2: POST audit — read the per-run override.** In the POST `/consistency-audit` handler, after the concurrency guard, capture the body and pass it into the audit call:

```ts
      const override = {
        provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      };
```

and change the audit invocation to `services.consistencyAudit(slug, (msg) => {…}, override)` (add `override` as the third argument; keep the existing progress callback).

- [ ] **Step 3: Add the PUT route** (inside `mountConsistency`, after the POST route):

```ts
  // Persist the per-book default model for the consistency audit. Empty body clears it.
  app.put('/api/books/:slug/consistency-model', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }
      await services.books.setConsistencyModel(slug, {
        provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
```

- [ ] **Step 4: Verify type-check + boot**

Run: `npx tsc --noEmit` → clean. Then `node --import tsx --test 'tests/unit/*.test.ts'` → green.

- [ ] **Step 5: Commit** (defer to final push).

---

### Task 6: Studio UI — provider + model picker (`Consistency.tsx`)

**Files:**
- Modify: `frontend/studio/src/routes/Consistency.tsx`
- Modify: `frontend/studio/src/lib/consistencyApi.ts` (API helpers)

**Interfaces:**
- Consumes: `GET /consistency-report` (now returns `consistencyModel`); `PUT /consistency-model`; `POST /consistency-audit` body `{provider, model}`.

- [ ] **Step 1: Add API helpers** in `consistencyApi.ts` (match the file's existing `api(...)` usage):

```ts
export const CONSISTENCY_PROVIDERS = ['gemini','deepseek','claude','openai','ollama','openrouter'] as const;
export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  gemini: 'gemini-2.5-flash', deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4o', ollama: 'llama3.2', openrouter: 'anthropic/claude-sonnet-4-5',
};
export function saveConsistencyModel(slug: string, sel: { provider?: string; model?: string }) {
  return api(`/api/books/${encodeURIComponent(slug)}/consistency-model`, { method: 'PUT', body: JSON.stringify(sel) });
}
```

Also extend the audit-start helper to accept and send `{provider, model}` in the POST body, and the report type to include `consistencyModel?: { provider?: string; model?: string } | null`.

- [ ] **Step 2: Add the picker UI** in `Consistency.tsx` near the Run control: a `<select>` with a `default (auto)` option (`value=""`) + `CONSISTENCY_PROVIDERS`; when a provider is chosen, a text input for the model with `placeholder={PROVIDER_DEFAULT_MODEL[provider]}`. Hold `provider`/`model` in component state, hydrate from the report's `consistencyModel` on load, call `saveConsistencyModel(slug, {provider, model})` on change (fire-and-forget, fail-soft), and pass `{provider, model}` when starting an audit.

- [ ] **Step 3: Build the frontend**

Run: `npm run build:frontend`
Expected: exit 0.

- [ ] **Step 4: Commit** (defer to final push).

---

### Task 7: MCP tools (lockstep)

**Files:**
- Modify: `mcp/src/tools/craft.ts` (the `consistency_audit` tool; add a `set_consistency_model` tool)
- Modify: `mcp/src/tool-groups.ts` if the new tool needs registration in a group (follow the existing pattern)

**Interfaces:**
- Consumes: the gateway routes from Task 5.

- [ ] **Step 1:** Add optional `provider` + `model` (zod `z.string().optional()`) to the `consistency_audit` tool input and include them in the POST body it sends.
- [ ] **Step 2:** Add a `set_consistency_model` tool wrapping `PUT /api/books/:slug/consistency-model` with `{ slug, provider?, model? }`.
- [ ] **Step 3: Build + test**

Run: `cd mcp && npm install && npm run build && npm test`
Expected: build clean, tests green. Then `cd ..`.

- [ ] **Step 4: Commit** (defer to final push).

---

### Task 8: Smoke test (`tests/consistency-smoke.sh`)

**Files:**
- Modify: `tests/consistency-smoke.sh`

- [ ] **Step 1:** After the existing book setup but before/around the audit run, add a block that:
  1. `PUT /api/books/:slug/consistency-model` with `{"provider":"gemini","model":"gemini-2.5-flash"}` → assert `ok:true`.
  2. `GET /api/books/:slug/consistency-report` → assert `consistencyModel.provider == "gemini"` and `consistencyModel.model == "gemini-2.5-flash"` (round-trip).
  3. Start the audit with a body override `{"provider":"...","model":"..."}` (the same body the smoke already POSTs, now carrying the fields) → assert HTTP 200 + report becomes ready (the existing poll already covers readiness).
- [ ] **Step 2:** `bash -n tests/consistency-smoke.sh` → syntax OK. (Full run happens in goal step 8 with Gemini Flash via OpenRouter.)
- [ ] **Step 3: Commit** (defer to final push).

---

## Self-Review

**Spec coverage:** persistence (Task 2) · resolver/precedence (Task 1) · plumbing (Tasks 3-4) · API PUT/POST/GET (Task 5) · UI (Task 6) · MCP (Task 7) · tests unit+smoke (Tasks 1-3, 8). All spec sections mapped.

**Type consistency:** `resolveConsistencyModel(perRun, perBook)` and `{provider, model}` shape used uniformly; `extractChapterFacts(…, override)` 5th param matches Task 4's call; `select(t, preferredId?)` matches the router's `selectProvider(taskType, preferredId?)`; `setConsistencyModel` name consistent across Tasks 2/5/7.

**Parallelization (fan-out):** Tasks 1, 2, 3 are independent → run in parallel. Task 4 depends on 1+3. Task 5 depends on 2+4. Tasks 6, 7, 8 depend on 5's contract → run in parallel. Verify integration (`tsc --noEmit` + full unit suite + `npm run build:frontend` + `mcp` build/test + smoke `bash -n`) after the parallel batches.
