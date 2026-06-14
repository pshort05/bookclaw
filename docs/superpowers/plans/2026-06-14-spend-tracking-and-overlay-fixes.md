# Spend Tracking + Overlay/Asset-Header Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent lifetime + per-book spend tracker (with a typed-confirmation Danger-Zone reset), re-point the AI-generated-skill writer to the workspace overlay, and fix the Asset Studio book-scope header to show the asset name instead of the kind string.

**Architecture:** Three independent tracks over mostly-disjoint files. Track A (spend) extends `CostTracker` with `totalSpend` + `byBook` odometers and threads `bookSlug` through the existing `record()` choke points; Track B is a one-line write-path repoint; Track C is a frontend header-name fix. Spec: `docs/superpowers/specs/2026-06-14-spend-tracking-and-overlay-fixes-design.md`.

**Tech Stack:** Node 22 + TypeScript (`tsx`, NodeNext, `.js` import extensions), Express, React + Vite studio, `node --test` unit tests, bash API/smoke tests.

**Commit policy:** No per-task `git commit` (repo uses a `commit_message` + `./push.sh` flow). Run the listed verification command after each step; commit only at the very end via the `commit_message` file (final task).

**Parallel-execution file ownership (no overlaps):**
- **Track A (Item 1)** owns: `gateway/src/services/costs.ts`, `gateway/src/index.ts`, `gateway/src/services/skill-runner.ts`, `gateway/src/api/routes/projects.routes.ts`, `gateway/src/api/routes/core.routes.ts`, `frontend/shared/src/types.ts`, `frontend/studio/src/Rail.tsx`, `frontend/studio/src/components/BookDrawer.tsx`, `frontend/studio/src/routes/Settings.tsx`, `frontend/studio/src/components/ResetSpendModal.tsx` (new), `tests/unit/costs.test.ts` (new), **and all of `tests/api/api-test.sh`** (adds both Track A and Track B assertions).
- **Track B (Item 2)** owns: `gateway/src/api/routes/heartbeat.routes.ts` only. (Its API-test assertion is written by Track A to avoid a shared-file conflict — Track B tells Track A nothing new; the endpoint shape is unchanged.)
- **Track C (Item 3)** owns: `frontend/studio/src/routes/AssetStudio.tsx`, `frontend/studio/src/components/asset/ProseEditor.tsx`, `frontend/studio/src/components/asset/SkillEditor.tsx`, `frontend/studio/src/components/asset/PipelineEditor.tsx`.

**Agent constraints during parallel run:** Do **not** run `npm run build:frontend` or any port-binding smoke test (avoids `dist/` races and port 3847 conflicts). Verify with `npx tsc --noEmit` and `node --import tsx --test tests/unit/<file>.test.ts` only. The integrator runs the full build + smoke after merge.

---

## Track A — Item 1: Persistent lifetime + per-book spend

### Task A1: Extend `CostTracker` state, `record()`, `getStatus()`, `resetLifetime()`

**Files:**
- Test: `tests/unit/costs.test.ts` (create)
- Modify: `gateway/src/services/costs.ts`

- [ ] **Step 1: Write the failing test** — create `tests/unit/costs.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CostTracker } from '../../gateway/src/services/costs.ts';

test('record accumulates total and attributes per book', () => {
  const c = new CostTracker({});
  c.record('openrouter', 1000, 0.10, 'book-a');
  c.record('openrouter', 1000, 0.20, 'book-b');
  c.record('openrouter', 1000, 0.05); // no slug -> unattributed
  const s = c.getStatus();
  assert.equal(s.total, 0.35);
  assert.equal(s.byBook['book-a'], 0.10);
  assert.equal(s.byBook['book-b'], 0.20);
  assert.equal(s.byBook['unattributed'], 0.05);
});

test('total and byBook survive the budget reset() (daily/monthly only)', async () => {
  const c = new CostTracker({});
  c.record('openrouter', 1000, 0.10, 'book-a');
  await c.reset();
  const s = c.getStatus();
  assert.equal(s.daily, 0);
  assert.equal(s.monthly, 0);
  assert.equal(s.total, 0.10);
  assert.equal(s.byBook['book-a'], 0.10);
});

test('resetLifetime zeroes total and only the listed books', async () => {
  const c = new CostTracker({});
  c.record('openrouter', 1000, 0.10, 'book-a');
  c.record('openrouter', 1000, 0.20, 'book-b');
  c.record('openrouter', 1000, 0.05); // unattributed
  await c.resetLifetime({ books: ['book-a'], unattributed: true });
  const s = c.getStatus();
  assert.equal(s.total, 0);
  assert.equal(s.byBook['book-a'], undefined);
  assert.equal(s.byBook['unattributed'], undefined);
  assert.equal(s.byBook['book-b'], 0.20); // untouched
});

test('getStatus exposes total and byBook shape', () => {
  const c = new CostTracker({});
  const s = c.getStatus();
  assert.equal(s.total, 0);
  assert.deepEqual(s.byBook, {});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test tests/unit/costs.test.ts`
Expected: FAIL (`getStatus().total` is `undefined`; `record` rejects the 4th arg / `resetLifetime` is not a function).

- [ ] **Step 3: Implement in `gateway/src/services/costs.ts`**

Update `PersistedState`:
```ts
interface PersistedState {
  dailySpend: number;
  monthlySpend: number;
  totalSpend: number;
  byBook: Record<string, number>;
  lastResetDay: string;
  lastResetMonth: string;
}
```
Add fields after `private monthlySpend = 0;`:
```ts
  private totalSpend = 0;
  private byBook: Record<string, number> = {};
```
In `initialize()`, after the `monthlySpend` hydrate line, add:
```ts
      this.totalSpend = state.totalSpend || 0;
      this.byBook = state.byBook || {};
```
Replace the `record(...)` signature + body tail. New signature and the additions:
```ts
  record(provider: string, tokens: number, estimatedCost?: number, bookSlug?: string): void {
    this.checkReset();
    let cost = estimatedCost;
    if (cost === undefined || cost === null || isNaN(cost)) {
      const costPer1k: Record<string, number> = {
        ollama: 0, gemini: 0, deepseek: 0.0003,
        claude: 0.009, openai: 0.006, openrouter: 0.006,
      };
      cost = (tokens / 1000) * (costPer1k[provider] || 0);
    }
    this.dailySpend += cost;
    this.monthlySpend += cost;
    this.totalSpend += cost;
    const key = bookSlug ?? 'unattributed';
    this.byBook[key] = (this.byBook[key] ?? 0) + cost;
    this.schedulePersist();
  }
```
Replace `getStatus()`:
```ts
  getStatus(): { daily: number; monthly: number; total: number; overBudget: boolean; dailyLimit: number; monthlyLimit: number; byBook: Record<string, number> } {
    this.checkReset();
    const byBook: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.byBook)) byBook[k] = Math.round(v * 100) / 100;
    return {
      daily: Math.round(this.dailySpend * 100) / 100,
      monthly: Math.round(this.monthlySpend * 100) / 100,
      total: Math.round(this.totalSpend * 100) / 100,
      overBudget: this.isOverBudget(),
      dailyLimit: this.dailyLimit,
      monthlyLimit: this.monthlyLimit,
      byBook,
    };
  }
```
Add a new method after `reset()` (leave `reset()` and `checkReset()` untouched so the budget button still clears only daily/monthly):
```ts
  /** Danger-zone reset: zero the lifetime total and selectively chosen book buckets. */
  async resetLifetime(opts: { books?: string[]; unattributed?: boolean }): Promise<void> {
    this.totalSpend = 0;
    for (const slug of opts.books ?? []) delete this.byBook[slug];
    if (opts.unattributed) delete this.byBook['unattributed'];
    await this.persist();
  }
```
In `persist()`, extend the `state` object:
```ts
    const state: PersistedState = {
      dailySpend: this.dailySpend,
      monthlySpend: this.monthlySpend,
      totalSpend: this.totalSpend,
      byBook: this.byBook,
      lastResetDay: this.lastResetDay,
      lastResetMonth: this.lastResetMonth,
    };
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --import tsx --test tests/unit/costs.test.ts`
Expected: PASS (4 tests).

### Task A2: Thread `bookSlug` through the recording call sites

**Files:**
- Modify: `gateway/src/services/skill-runner.ts`
- Modify: `gateway/src/api/routes/projects.routes.ts:372,570`
- Modify: `gateway/src/index.ts:703,762` (+ the `runExecutableSkillStep` call near `:1832`)

- [ ] **Step 1: `skill-runner.ts`** — widen the `costs.record` dep type and add a `bookSlug` param:

Change the `costs?` dep type (line ~44) to:
```ts
    costs?: { record(provider: string, tokens: number, estimatedCost?: number, bookSlug?: string): void };
```
Add a 4th param to `runExecutableSkillStep`:
```ts
  skillName: string | undefined,
  input: string,
  bookSlug?: string,
```
Pass it in the `complete` wrapper:
```ts
    try { deps.costs?.record('openrouter', res.tokensUsed ?? 0, res.estimatedCost, bookSlug); } catch { /* non-fatal */ }
```

- [ ] **Step 2: `projects.routes.ts`** — at both call sites (lines ~372 and ~570) add the book slug:
```ts
// line ~372
const execOut = await runExecutableSkillStep(services, (activeStep as any).skill, userMessage, project.bookSlug);
// line ~570
const execOut = await runExecutableSkillStep(services, (activeStep as any).skill, userMessage, currentProject.bookSlug);
```

- [ ] **Step 3: `index.ts`** — at the two `costs.record` sites pass `overrideSlug` (resolved at `index.ts:575` in the same method; confirm it is in scope — if the method exposes it under a different name use that, else use the method's `bookSlug` param):
```ts
// line ~703
this.costs.record(provider.id, response.tokensUsed, response.estimatedCost, overrideSlug);
// line ~762
this.costs.record(fallback.id, response.tokensUsed, response.estimatedCost, overrideSlug);
```
At the `runExecutableSkillStep(...)` call near `:1832`, pass the goal's bound book slug if one is in scope; otherwise leave the 4th arg off (it defaults to `undefined` → `'unattributed'`).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

### Task A3: Add `POST /api/costs/reset-total`

**Files:**
- Modify: `gateway/src/api/routes/core.routes.ts` (near the existing `/api/costs` GET at line ~133)

- [ ] **Step 1: Add the route** right after the `app.get('/api/costs', …)` handler:
```ts
  app.post('/api/costs/reset-total', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { books?: unknown; unattributed?: unknown };
    const books = Array.isArray(body.books)
      ? body.books.filter((b): b is string => typeof b === 'string')
      : [];
    await services.costs.resetLifetime({ books, unattributed: !!body.unattributed });
    res.json(services.costs.getStatus());
  });
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

### Task A4: Frontend types + Rail + BookDrawer

**Files:**
- Modify: `frontend/shared/src/types.ts:50-56`
- Modify: `frontend/studio/src/Rail.tsx` (the spend footer, ~lines 187-191)
- Modify: `frontend/studio/src/components/BookDrawer.tsx` (the `assets` block, after the Pipeline row ~line 90)

- [ ] **Step 1: Extend the `Costs` type:**
```ts
export interface Costs {
  daily: number;
  monthly: number;
  total: number;
  overBudget: boolean;
  dailyLimit: number;
  monthlyLimit: number;
  byBook: Record<string, number>;
}
```

- [ ] **Step 2: Rail lifetime line** — read the existing "AI spend · today" row markup and add a sibling row directly below it using the same wrapper classes, e.g.:
```tsx
<div className={styles.spendrow}>
  <span>AI spend · lifetime</span>
  <b>{money(costs?.total ?? 0)}</b>
</div>
```
(Match the actual class names in `Rail.tsx`; no budget bar for the lifetime row.)

- [ ] **Step 3: BookDrawer per-book spend** — add `import { useCosts, money } from '@bookclaw/shared';` to the existing shared import, add `const costs = useCosts();` inside the component, and add an asset row after the Pipeline row:
```tsx
<div className={styles.asset}>
  <div className={styles.l}>Spend</div>
  <div className={styles.v}>{money(costs?.byBook?.[slug] ?? 0)}</div>
</div>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

### Task A5: `ResetSpendModal` + Settings Danger-Zone wiring

**Files:**
- Create: `frontend/studio/src/components/ResetSpendModal.tsx`
- Modify: `frontend/studio/src/routes/Settings.tsx` (Danger-zone block ~lines 163-176)

- [ ] **Step 1: Create `ResetSpendModal.tsx`** (mirrors `DeleteBooksModal`; reuses `Settings.module.css` classes via the import other Settings modals use — confirm the class names against `DeleteBooksModal`):

```tsx
import { useEffect, useMemo, useState } from 'react';
import { api, Button, useBooks, useCosts, useStore, money } from '@bookclaw/shared';
import styles from '../routes/Settings.module.css';

const CONFIRM_PHRASE = 'RESET MY TOTAL SPEND';

/**
 * Danger-zone "reset total spend" dialog. Stage 1: optionally select per-book
 * buckets to also zero (the lifetime total is always reset). Stage 2: type the
 * confirmation phrase. POSTs /api/costs/reset-total, then refreshes the cost store.
 */
export function ResetSpendModal({ onClose }: { onClose: () => void }) {
  const books = useBooks();
  const costs = useCosts();
  const loadBooks = useStore((s) => s.loadBooks);
  const loadCosts = useStore((s) => s.loadCosts);
  const [stage, setStage] = useState<'select' | 'confirm'>('select');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [unattributed, setUnattributed] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);

  const phraseOk = phrase.trim() === CONFIRM_PHRASE;
  const byBook = costs?.byBook ?? {};
  const unattributedSpend = byBook['unattributed'] ?? 0;

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  }

  async function doReset() {
    setBusy(true);
    try {
      await api('/api/costs/reset-total', {
        method: 'POST',
        body: JSON.stringify({ books: [...selected], unattributed }),
      });
      await loadCosts().catch(() => {});
      setResult('Lifetime total reset.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalWrap} role="dialog" aria-modal="true" aria-label="Reset total spend">
      <div className={styles.modal}>
        {stage === 'select' && (
          <>
            <h2>Reset total spend</h2>
            <p className={styles.dim}>
              This resets your <strong>lifetime total</strong> to $0. Optionally also zero individual book totals below.
            </p>
            <div>
              {books.map((b) => (
                <label key={b.slug} className={styles.row}>
                  <input type="checkbox" checked={selected.has(b.slug)} onChange={() => toggle(b.slug)} />
                  <span>{b.title}</span>
                  <span className={styles.dim}>{money(byBook[b.slug] ?? 0)}</span>
                </label>
              ))}
              <label className={styles.row}>
                <input type="checkbox" checked={unattributed} onChange={(e) => setUnattributed(e.target.checked)} />
                <span>Unattributed (free chat / planning)</span>
                <span className={styles.dim}>{money(unattributedSpend)}</span>
              </label>
            </div>
            <div className={styles.actions}>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={() => setStage('confirm')}>Continue…</Button>
            </div>
          </>
        )}
        {stage === 'confirm' && !result && (
          <>
            <h2>Reset total spend</h2>
            <p className={styles.warn}>
              This permanently zeroes your lifetime total{selected.size + (unattributed ? 1 : 0) > 0 ? ` and ${selected.size + (unattributed ? 1 : 0)} book bucket(s)` : ''}. There is no undo.
            </p>
            <p>Type <code>{CONFIRM_PHRASE}</code> to confirm:</p>
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              disabled={busy}
            />
            <div className={styles.actions}>
              <Button variant="secondary" onClick={() => { setStage('select'); setPhrase(''); }} disabled={busy}>Back</Button>
              <Button variant="primary" onClick={doReset} disabled={!phraseOk || busy}>Reset total spend</Button>
            </div>
          </>
        )}
        {result && (
          <>
            <p>{result}</p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={onClose}>Done</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```
NOTE for implementer: match the exact wrapper/class names and `useStore` selector names (`loadBooks`/`loadCosts`) to `DeleteBooksModal.tsx`. If a class (e.g. `modalWrap`, `row`, `actions`, `warn`) doesn't exist in `Settings.module.css`, reuse the closest existing class `DeleteBooksModal` uses rather than inventing new CSS.

- [ ] **Step 2: Wire into Settings danger zone** — add modal state near the existing `showDelete` state:
```tsx
const [showReset, setShowReset] = useState(false);
```
Add a second danger block after the "Delete books from disk" block:
```tsx
<div className={styles.danger}>
  <div>
    <strong>Reset total spend</strong>
    <p className={styles.dim}>
      Reset the lifetime spend total and, optionally, individual book totals. Requires typing a confirmation phrase.
    </p>
  </div>
  <Button variant="secondary" onClick={() => setShowReset(true)}>Reset total spend…</Button>
</div>
```
Add the modal mount next to the delete modal:
```tsx
{showReset && <ResetSpendModal onClose={() => setShowReset(false)} />}
```
Import it: `import { ResetSpendModal } from '../components/ResetSpendModal';`

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

### Task A6: API-test assertions (Track A reset-total + Track B skill-save)

**Files:**
- Modify: `tests/api/api-test.sh`

- [ ] **Step 1: Read `tests/api/api-test.sh`** to learn its helper pattern (auth header, `assert`/check function names, base URL var).

- [ ] **Step 2: Add a reset-total assertion** using the file's existing helpers: `POST /api/costs/reset-total` with body `{}` returns 200 and the JSON has `.total == 0`. Example shape (adapt to the file's helpers):
```bash
RT=$(curl -s -X POST "$BASE/api/costs/reset-total" -H "$AUTH" -H 'Content-Type: application/json' -d '{}')
echo "$RT" | grep -q '"total":0' && pass "reset-total -> total 0" || fail "reset-total total not 0: $RT"
```

- [ ] **Step 3: Add a skill-save overlay assertion (covers Track B)** — `POST /api/tools/ingest/save` with a minimal skill, assert it appears in `GET /api/skills` as `source: workspace`, then DELETE it:
```bash
SKILL_MD=$'---\ndescription: api-test probe skill\ntriggers: []\n---\n# Probe\n'
curl -s -X POST "$BASE/api/tools/ingest/save" -H "$AUTH" -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg md "$SKILL_MD" '{skillMd:$md, skillPath:"skills/ops/api-test-probe/SKILL.md"}')" >/dev/null
CAT=$(curl -s "$BASE/api/skills" -H "$AUTH")
echo "$CAT" | jq -e '.[]? | select(.name=="api-test-probe") | select(.source=="workspace")' >/dev/null \
  && pass "ingest/save lands in workspace overlay" || fail "skill not in workspace overlay"
curl -s -X DELETE "$BASE/api/skills/api-test-probe" -H "$AUTH" >/dev/null
```
(Adapt JSON parsing to whatever the script already uses — match existing style; if `jq` isn't used elsewhere, use the same grep style the file uses.)

- [ ] **Step 4: Note** — this assertion will only pass once Track B (Item 2) is merged. During the parallel run, write it but do not execute the full API suite; the integrator runs it post-merge.

---

## Track B — Item 2: Re-point AI-generated-skill writer to the overlay

### Task B1: Change the write base to the workspace overlay

**Files:**
- Modify: `gateway/src/api/routes/heartbeat.routes.ts` (the `POST /api/tools/ingest/save` handler, ~line 398)

- [ ] **Step 1: Change the base path.** Replace:
```ts
    const skillsBase = j(baseDir, 'skills');
```
with:
```ts
    const skillsBase = j(baseDir, 'workspace', 'library', 'skills');
```
Leave the `safePath(skillsBase, skillPath.replace(/^skills[/\\]?/, ''))` call, the `mkdir`/`writeFile`, and the `services.skills.loadAll()` reload unchanged.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Manual confirmation note** — the round-trip is asserted by the api-test added in Task A6 (owned by Track A to keep `api-test.sh` single-owner). No edit to `api-test.sh` from Track B.

---

## Track C — Item 3: Asset Studio book-scope header shows kind instead of name

### Task C1: Derive and pass a `displayName` to the editors

**Files:**
- Modify: `frontend/studio/src/routes/AssetStudio.tsx`
- Modify: `frontend/studio/src/components/asset/ProseEditor.tsx`
- Modify: `frontend/studio/src/components/asset/SkillEditor.tsx`
- Modify: `frontend/studio/src/components/asset/PipelineEditor.tsx`

- [ ] **Step 1: Read `AssetStudio.tsx`** to confirm how the active book is obtained (it already references `activeBook` for the re-pull panel) and which fields carry the snapshot names (`author` / `voice` / `genre` / `pipeline`, per the books list API).

- [ ] **Step 2: Compute `displayName` in `AssetStudio.tsx`.** For `scope === 'book'` and a single-snapshot kind, map the kind to the active book's field:
```tsx
const SINGLE_SNAPSHOT_KINDS = ['author', 'voice', 'genre', 'pipeline'] as const;
const bookDisplayName =
  scope === 'book' && activeBook && (SINGLE_SNAPSHOT_KINDS as readonly string[]).includes(kind)
    ? ((activeBook as Record<string, any>)[kind] as string | undefined)
    : undefined;
```
(If `activeBook` exposes names under `pulledFrom.<kind>.name` rather than flat fields, read from there instead — confirm against the active-book shape in the store.)

- [ ] **Step 3: Pass it to each editor** in the JSX where they're rendered:
```tsx
<PipelineEditor key={editorKey} scope={scope} kind={kind} name={selectedName} displayName={bookDisplayName} />
<SkillEditor key={editorKey} scope={scope} kind={kind} name={selectedName} displayName={bookDisplayName} />
<ProseEditor key={editorKey} scope={scope} kind={kind} name={selectedName} displayName={bookDisplayName} />
```

- [ ] **Step 4: Accept the prop in each editor.** In each of `ProseEditor.tsx`, `SkillEditor.tsx`, `PipelineEditor.tsx`, add `displayName?: string` to the `Props` type and change the header render from `{name}` to `{displayName ?? name}` (ProseEditor header is `<h2>{name}</h2>` ~line 110; find the equivalent header in the other two).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0.

---

## Integration (run by the integrator after all tracks merge)

### Task INT1: Full type-check + frontend build + unit tests

- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npm run build:frontend` → builds studio + chat with no errors
- [ ] `node --import tsx --test tests/unit/*.test.ts` → all pass (342 prior + new `costs.test.ts` cases)

### Task INT2: Hermetic smoke + API suites

- [ ] `npm run test:smoke` → all checks pass (includes the Vite build)
- [ ] `npm run test:api` → all checks pass, including the new reset-total and skill-save-overlay assertions

### Task INT3: Code review

- [ ] Run a code review across the diff; fix every medium-or-higher finding; re-run INT1/INT2 after fixes.

### Task INT4: TODO/COMPLETED bookkeeping + commit message

- [ ] Move the three items from `docs/TODO.md` to `docs/COMPLETED.md` with a `2026-06-14` completion date (preserve original bullet text).
- [ ] Write `commit_message` (one-line summary + dash detail lines). Do **not** `git commit`/`git push` — the maintainer runs `./push.sh`.

### Task INT5: Deploy + real-money smoke (authorized)

- [ ] Deploy to the target (Mercury) per the repo deploy flow.
- [ ] Run the real-OpenRouter smoke (`tests/feature-smoke.sh` and/or the spend-relevant paths) to confirm per-book spend attributes and the lifetime total accumulates on a live run.

---

## Self-Review (performed during planning)

- **Spec coverage:** A1 (state/record/getStatus/resetLifetime) ✓, A2 (bookSlug threading incl. skill-runner) ✓, A3 (endpoint) ✓, A4 (types/Rail/BookDrawer) ✓, A5 (ResetSpendModal + Danger-Zone, `RESET MY TOTAL SPEND`, unattributed row) ✓, A6 (unit + api tests) ✓; B1 (overlay repoint) ✓; C1 (displayName header) ✓. All three TODO items covered.
- **Placeholder scan:** Real code in every code step; the two "match the existing class/field names" notes are deliberate integration checks against existing files, not deferred work.
- **Type consistency:** `record(provider, tokens, estimatedCost?, bookSlug?)`, `resetLifetime({ books?, unattributed? })`, `Costs.total`/`Costs.byBook`, and `CONFIRM_PHRASE = 'RESET MY TOTAL SPEND'` are used identically across backend, endpoint, tests, and UI.
