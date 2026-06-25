# Prompt Runner — Model Selection + Report Saving Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-run provider+model picker and a "Save as report" action to the Prompt Runner.

**Architecture:** `runPrompt` gains an optional `{provider, model}` override (precedence: per-run → prompt-asset model → tier default), honoring a pinned model only when its provider is actually selected. A new `prompt-run` report kind + renderer plug into the existing `ReportsService`; a new `POST /api/books/:slug/prompts/report` writes one. The studio adds the consistency-style picker and a Save-as-report button. Provider list/default-model map are lifted into a shared frontend module.

**Tech Stack:** TypeScript (NodeNext `.js` imports), Express, `node --test` via tsx, React (Vite studio).

## Global Constraints

- NodeNext `.js` import extensions in all `.ts`/`.tsx`.
- Fail-soft: invalid provider/model → 400; report write failure never loses the run output. No `schemaVersion` changes.
- Reuse, don't duplicate: backend provider list = `CONSISTENCY_PROVIDERS` (model-selection.ts); model validation = `isValidModelId` (ai/model-id.ts).
- No MCP change (no prompt-run tool exists).
- Unit tests: `node --import tsx --test 'tests/unit/*.test.ts'`. Type-check: `npx tsc --noEmit`. Frontend: `npm run build:frontend`.

---

### Task 1: Shared frontend provider constants

**Files:**
- Create: `frontend/studio/src/lib/providers.ts`
- Modify: `frontend/studio/src/lib/consistencyApi.ts` (re-export, remove the local literals)

**Interfaces:**
- Produces: `AI_PROVIDERS: readonly string[]`, `PROVIDER_DEFAULT_MODEL: Record<string,string>`.

- [ ] **Step 1: Create `providers.ts`**

```ts
// Shared studio provider list + per-provider default model (placeholder hints).
// Keep AI_PROVIDERS in sync with CONSISTENCY_PROVIDERS in
// gateway/src/services/consistency/model-selection.ts (cross-package; can't import gateway TS).
export const AI_PROVIDERS = ['gemini', 'deepseek', 'claude', 'openai', 'ollama', 'openrouter'] as const;
export const PROVIDER_DEFAULT_MODEL: Record<string, string> = {
  gemini: 'gemini-2.5-flash', deepseek: 'deepseek-chat', claude: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4o', ollama: 'llama3.2', openrouter: 'anthropic/claude-sonnet-4-5',
};
```

- [ ] **Step 2: Repoint `consistencyApi.ts`** — replace the existing `CONSISTENCY_PROVIDERS` and `PROVIDER_DEFAULT_MODEL` definitions (and their sync comment) with:

```ts
import { AI_PROVIDERS, PROVIDER_DEFAULT_MODEL } from './providers.js';
export const CONSISTENCY_PROVIDERS = AI_PROVIDERS;
export { PROVIDER_DEFAULT_MODEL };
```

Place the `import` with the other imports at the top; keep the two re-export lines where the constants were. Do not change any other line.

- [ ] **Step 3: Verify** — `npm run build:frontend` exits 0 (Consistency.tsx still resolves its imports).

---

### Task 2: `prompt-run` report kind + renderer

**Files:**
- Modify: `gateway/src/services/reports.ts:10-14` (ReportKind + KIND_LABELS)
- Create: `gateway/src/services/reports/render-prompt-run.ts`
- Test: `tests/unit/report-render-prompt-run.test.ts`

**Interfaces:**
- Produces: `renderPromptRunReport(r: PromptRunReportInput): { title: string; markdown: string; summary: string }` where `PromptRunReportInput = { prompt: string; file: string; output: string; meta?: { provider?: string; model?: string; tokensUsed?: number; estimatedCost?: number; ms?: number } }`.

- [ ] **Step 1: Extend the kind.** In `reports.ts`, change the union and labels:

```ts
export type ReportKind = 'consistency' | 'beta-reader' | 'structure' | 'plot-promises' | 'prompt-run';
export const KIND_LABELS: Record<ReportKind, string> = {
  consistency: 'Consistency', 'beta-reader': 'Beta Reader', structure: 'Structure & Length', 'plot-promises': 'Plot Promises', 'prompt-run': 'Prompt Run',
};
```

- [ ] **Step 2: Write the failing test** `tests/unit/report-render-prompt-run.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPromptRunReport } from '../../gateway/src/services/reports/render-prompt-run.js';

test('renders metadata block and output', () => {
  const out = renderPromptRunReport({
    prompt: 'line-edit', file: 'data/chapter-1.md', output: 'Edited prose here.',
    meta: { provider: 'openrouter', model: 'google/gemini-2.5-flash', tokensUsed: 1200, estimatedCost: 0.0012, ms: 4200 },
  });
  assert.equal(out.title, 'Prompt Run report');
  assert.match(out.markdown, /# Prompt Run report/);
  assert.match(out.markdown, /line-edit/);
  assert.match(out.markdown, /data\/chapter-1\.md/);
  assert.match(out.markdown, /openrouter\/google\/gemini-2\.5-flash/);
  assert.match(out.markdown, /## Output/);
  assert.match(out.markdown, /Edited prose here\./);
  assert.match(out.summary, /line-edit/);
});

test('handles missing meta', () => {
  const out = renderPromptRunReport({ prompt: 'p', file: 'data/x.md', output: 'o' });
  assert.match(out.markdown, /# Prompt Run report/);
  assert.match(out.markdown, /## Output/);
});
```

- [ ] **Step 3: Run → fail** `node --import tsx --test tests/unit/report-render-prompt-run.test.ts` (module not found).

- [ ] **Step 4: Implement** `gateway/src/services/reports/render-prompt-run.ts`:

```ts
export interface PromptRunReportInput {
  prompt: string;
  file: string;
  output: string;
  meta?: { provider?: string; model?: string; tokensUsed?: number; estimatedCost?: number; ms?: number };
}

/** Pure renderer: a prompt run -> a reviewable markdown report + a one-line summary. */
export function renderPromptRunReport(r: PromptRunReportInput): { title: string; markdown: string; summary: string } {
  const m = r.meta ?? {};
  const providerModel = m.provider ? `${m.provider}${m.model ? '/' + m.model : ''}` : 'unknown';
  const L: string[] = [];
  L.push('# Prompt Run report');
  L.push('');
  L.push(`- Prompt: ${r.prompt}`);
  L.push(`- Source file: ${r.file}`);
  L.push(`- Model: ${providerModel}`);
  if (typeof m.tokensUsed === 'number') L.push(`- Tokens: ${m.tokensUsed.toLocaleString()}`);
  if (typeof m.estimatedCost === 'number') L.push(`- Est. cost: $${m.estimatedCost.toFixed(4)}`);
  if (typeof m.ms === 'number') L.push(`- Elapsed: ${(m.ms / 1000).toFixed(1)}s`);
  L.push('');
  L.push('## Output');
  L.push('');
  L.push(r.output);
  L.push('');
  return { title: 'Prompt Run report', markdown: L.join('\n'), summary: `${r.prompt} on ${r.file} — ${providerModel}` };
}
```

- [ ] **Step 5: Run → pass** (2 tests). Then `npx tsc --noEmit` clean.

---

### Task 3: `runPrompt` honors a per-run override

**Files:**
- Modify: `gateway/src/services/prompt-runner.ts:24-44`
- Test: `tests/unit/prompt-runner-override.test.ts`

**Interfaces:**
- Produces: `runPrompt(deps, promptName, content, bookSlug?, override?)` where `override?: { provider?: string; model?: string }`.

- [ ] **Step 1: Write the failing test** `tests/unit/prompt-runner-override.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPrompt } from '../../gateway/src/services/prompt-runner.js';

function deps(selImpl: (t: string, p?: string) => { id: string }, capture: { pref?: string; model?: string }) {
  return {
    prompts: { get: (_n: string) => ({ systemPrompt: 'sys' } as any) },
    aiRouter: {
      selectProvider: (t: string, p?: string) => { capture.pref = p; return selImpl(t, p); },
      complete: async (r: any) => { capture.model = r.model; return { text: 'out', tokensUsed: 1, estimatedCost: 0, model: r.model }; },
    },
  };
}

test('per-run override: provider to select, model to complete', async () => {
  const cap: any = {};
  const d = deps((_t, p) => ({ id: p ?? 'x' }), cap);
  await runPrompt(d as any, 'p', 'content', undefined, { provider: 'claude', model: 'claude-x' });
  assert.equal(cap.pref, 'claude');
  assert.equal(cap.model, 'claude-x');
});

test('override model dropped when select falls back to another provider', async () => {
  const cap: any = {};
  const d = deps((_t, _p) => ({ id: 'ollama' }), cap);
  await runPrompt(d as any, 'p', 'content', undefined, { provider: 'gemini', model: 'gemini-2.5-flash' });
  assert.equal(cap.model, undefined);
});

test('no override falls back to the prompt asset model (openrouter)', async () => {
  const cap: any = {};
  const d = {
    prompts: { get: (_n: string) => ({ systemPrompt: 'sys', model: 'anthropic/x' } as any) },
    aiRouter: {
      selectProvider: (t: string, p?: string) => { cap.pref = p; return { id: 'openrouter' }; },
      complete: async (r: any) => { cap.model = r.model; return { text: 'out', model: r.model }; },
    },
  };
  await runPrompt(d as any, 'p', 'content');
  assert.equal(cap.pref, 'openrouter');
  assert.equal(cap.model, 'anthropic/x');
});
```

- [ ] **Step 2: Run → fail** `node --import tsx --test tests/unit/prompt-runner-override.test.ts`.

- [ ] **Step 3: Implement.** Add the param to the signature (after `bookSlug?: string,`):

```ts
  override?: { provider?: string; model?: string },
```

Replace the current provider/model resolution (lines ~34-35):

```ts
  const provider = deps.aiRouter.selectProvider?.('prompt_run', prompt.model ? 'openrouter' : undefined) ?? { id: 'openrouter' };
  const model = prompt.model && provider.id === 'openrouter' ? prompt.model : undefined;
```

with:

```ts
  // Precedence: per-run override → the prompt asset's pinned model → tier default.
  let provider: { id: string };
  let model: string | undefined;
  if (override?.provider) {
    provider = deps.aiRouter.selectProvider?.('prompt_run', override.provider) ?? { id: override.provider };
    // Honor the pinned model only when the requested provider was actually selected.
    model = provider.id === override.provider ? override.model : undefined;
  } else {
    provider = deps.aiRouter.selectProvider?.('prompt_run', prompt.model ? 'openrouter' : undefined) ?? { id: 'openrouter' };
    model = prompt.model && provider.id === 'openrouter' ? prompt.model : undefined;
  }
```

(The rest — `complete({ provider: provider.id, …, ...(model ? { model } : {}) })`, cost recording, meta — is unchanged.)

- [ ] **Step 4: Run → pass** (3 tests). Then `npx tsc --noEmit` clean + full suite green.

---

### Task 4: Routes — `/run` override + `/report` save

**Files:**
- Modify: `gateway/src/api/routes/prompts.routes.ts`

**Interfaces:**
- Consumes: `runPrompt(…, override)` (Task 3); `renderPromptRunReport` (Task 2); `isValidModelId`; `CONSISTENCY_PROVIDERS`; `services.reports.write`.

- [ ] **Step 1: Imports.** Add at the top of `prompts.routes.ts`:

```ts
import { SLUG_RE } from '../../services/book-types.js';
import { CONSISTENCY_PROVIDERS } from '../../services/consistency/model-selection.js';
import { isValidModelId } from '../../ai/model-id.js';
import { renderPromptRunReport } from '../../services/reports/render-prompt-run.js';
```

- [ ] **Step 2: Validate + forward the override in `/api/prompts/run`.** After the existing `content` checks, before the `runPrompt` call:

```ts
      const provider = req.body?.provider;
      const model = req.body?.model;
      if (provider !== undefined && provider !== null && provider !== '') {
        if (typeof provider !== 'string' || !(CONSISTENCY_PROVIDERS as readonly string[]).includes(provider)) {
          return res.status(400).json({ error: `Invalid provider. Use one of: ${CONSISTENCY_PROVIDERS.join(', ')}` });
        }
      }
      if (model !== undefined && model !== null && model !== '') {
        if (!isValidModelId(model)) return res.status(400).json({ error: 'Invalid model id' });
      }
```

and pass `{ provider: typeof provider === 'string' ? provider : undefined, model: typeof model === 'string' ? model : undefined }` as the 4th `runPrompt` argument (after the bookSlug argument).

- [ ] **Step 3: Add the save-report route** (inside `mountPrompts`, after the run route):

```ts
  // Save a prompt-run output as a downloadable report (prompt-run kind).
  app.post('/api/books/:slug/prompts/report', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }
      const { prompt, file, output, meta } = req.body ?? {};
      if (typeof output !== 'string' || !output.trim()) return res.status(400).json({ error: 'output required' });
      if (output.length > 100000) return res.status(400).json({ error: 'output too long (max 100k chars)' });
      if (!services.reports) return res.status(503).json({ error: 'Reports unavailable' });
      const r = renderPromptRunReport({
        prompt: typeof prompt === 'string' ? prompt : 'prompt',
        file: typeof file === 'string' ? file : '(unknown)',
        output,
        meta: meta && typeof meta === 'object' ? meta : undefined,
      });
      const written = services.reports.write(slug, 'prompt-run', { title: r.title, markdown: r.markdown, json: { prompt, file, output, meta }, summary: r.summary });
      if (!written) return res.status(500).json({ error: 'Failed to write report' });
      res.json({ id: written.id });
    } catch (err: any) {
      res.status(500).json({ error: 'Save report failed: ' + String(err?.message || err) });
    }
  });
```

- [ ] **Step 4: Verify** `npx tsc --noEmit` clean; full unit suite green.

---

### Task 5: PromptRunner UI — picker + Save as report

**Files:**
- Modify: `frontend/studio/src/routes/PromptRunner.tsx`
- (CSS: reuse existing `styles.field`/`styles.fl`/`styles.pick`/`styles.act` classes; add none unless needed.)

**Interfaces:**
- Consumes: `AI_PROVIDERS`, `PROVIDER_DEFAULT_MODEL` (Task 1); `POST /api/prompts/run` body `{provider, model}`; `POST /api/books/:slug/prompts/report`.

- [ ] **Step 1: Import** `import { AI_PROVIDERS, PROVIDER_DEFAULT_MODEL } from '../lib/providers.js';`

- [ ] **Step 2: State** — add `const [provider, setProvider] = useState('');` and `const [model, setModel] = useState('');` (session-remembered; no reset on book/file change).

- [ ] **Step 3: Send the override** — in `run()`, change the POST body to:

```ts
        body: JSON.stringify({ prompt: promptName, content: text, bookSlug: slug, provider: provider || undefined, model: model || undefined }),
```

- [ ] **Step 4: Picker UI** — after the Prompt `<div className={styles.field}>…</div>` block (and before the Run button), add a provider select + conditional model input:

```tsx
          <div className={styles.field}>
            <span className={styles.fl}>Model</span>
            <select className={styles.pick} value={provider} onChange={(e) => { setProvider(e.target.value); if (!e.target.value) setModel(''); }} disabled={running}>
              <option value="">default (auto)</option>
              {AI_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {provider !== '' && (
            <div className={styles.field}>
              <span className={styles.fl}>Exact model</span>
              <input className={styles.pick} type="text" value={model} placeholder={PROVIDER_DEFAULT_MODEL[provider]} onChange={(e) => setModel(e.target.value)} disabled={running} />
            </div>
          )}
```

- [ ] **Step 5: Save-as-report handler** — add:

```tsx
  async function saveAsReport() {
    if (output === null) return;
    try {
      const r = await api<{ id: string }>(`/api/books/${encodeURIComponent(slug)}/prompts/report`, {
        method: 'POST',
        body: JSON.stringify({ prompt: promptName, file, output, meta }),
      });
      setMsg(`Saved report ${r.id} — view it on the Reports page.`);
    } catch (e) { setErr(`Save report failed — ${String(e)}`); }
  }
```

- [ ] **Step 6: Button** — in the non-diff output actions (next to "Save as new file"):

```tsx
                  <button className={styles.act} onClick={saveAsReport}>Save as report</button>
```

- [ ] **Step 7: Verify** `npm run build:frontend` exits 0.

---

### Task 6: Reports page recognizes `prompt-run`

**Files:**
- Modify: `frontend/studio/src/routes/Reports.tsx`

- [ ] **Step 1:** Add `'prompt-run'` to the `ReportKind` type (line ~5), `KIND_LABELS` (`'prompt-run': 'Prompt Run',`), `KIND_ORDER` (append `'prompt-run'`), and the `grouped` initializer object (`'prompt-run': []`).
- [ ] **Step 2: Verify** `npm run build:frontend` exits 0.

---

### Task 7: Smoke coverage

**Files:**
- Modify: `tests/consistency-smoke.sh`

- [ ] **Step 1:** In the reports area of the smoke (after the book exists), add a best-effort block: pick a prompt from `GET /api/library?kind=prompt` (skip with a logged notice if none), `POST /api/prompts/run` with `{prompt, content:"Sample text.", bookSlug, provider:"gemini", model:"gemini-2.5-flash"}`, capture `.output`; `POST /api/books/:slug/prompts/report` with `{prompt, file:"data/sample.md", output, meta}`; then assert `GET …/reports` lists a `prompt-run` entry and `GET …/reports/:id?format=md` serves markdown containing `# Prompt Run`. Use the existing `pass`/`fail`/`node -e` JSON-parse conventions; gate behind a prompt being available so the hermetic smoke never hard-fails on a missing prompt asset.
- [ ] **Step 2:** `bash -n tests/consistency-smoke.sh` → syntax OK.

---

## Self-Review

**Spec coverage:** model picker (Tasks 1,3,4,5) · report saving (Tasks 2,4,5,6) · shared constants (Task 1) · tests unit+smoke (Tasks 2,3,7). All mapped.

**Type consistency:** `override?: {provider?, model?}` identical across Tasks 3/4; `renderPromptRunReport(PromptRunReportInput)` matches Task 2 ↔ Task 4 call; `'prompt-run'` kind added in both backend (Task 2) and frontend (Task 6); `AI_PROVIDERS`/`PROVIDER_DEFAULT_MODEL` names consistent across Tasks 1/5.

**Fan-out:** Tasks 1, 2, 3, 6 are independent (frontend providers; backend reports kind+renderer; backend runPrompt; frontend Reports page) → parallel. Task 4 depends on 2+3 (do inline). Tasks 5, 7 depend on 4's contract → parallel. Integration verify (`tsc` + full unit suite + `npm run build:frontend` + smoke `bash -n`) after each batch.
