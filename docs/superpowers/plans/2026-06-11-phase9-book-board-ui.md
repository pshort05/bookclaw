# Phase 9 — Book-Board UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the studio Book Board the face of the studio — every book shows phase, next-action, phase-progress, and a live "now generating" indicator — and land three studio-wide polish items (seconds in activity timestamps, single-spaced activity rows, 4-decimal cost precision).

**Architecture:** Enrich `GET /api/books` once per request with `next` (existing `nextStep`) and `live` (derived from Phase-8 `Project.bookSlug` on active projects) via a pure, unit-tested `buildBookCards` helper. The studio Board renders a phase-based 6-segment progress bar + live strip + next-action footer; the Rail's Generating/Idle counts become real; shared `money()`/`hhmmss()` helpers carry the polish items. Chat stays on the global pointer (per-channel is Phase 10).

**Tech Stack:** Node 22 + TypeScript (`tsx`, `.js` import extensions, `NodeNext`); React + Vite (npm workspaces `frontend/{shared,studio}`). Tests: `node --import tsx --test tests/unit/*.test.ts`; `npm run build:frontend`; bash `tests/feature-smoke.sh` against Mercury.

Spec: [docs/superpowers/specs/2026-06-11-phase9-book-board-ui-design.md](../specs/2026-06-11-phase9-book-board-ui-design.md). Mockup: `dashboard/concept/phase9-book-board.html`.

> **Repo workflow — do NOT `git commit`/`git push`.** Per `CLAUDE.md`, write a `commit_message` at the repo root; the maintainer runs `./push.sh`. Work on `main`, no worktree (deploy builds the working tree). Every "Commit" below is a **verification gate** (run the command, confirm output); the single `commit_message` is written in the final task. Deploy = `touch build_now` → poll `.build-logs/last-build.status` for a fresh `result=PASS`.

> **Canonical constants (use exactly):**
> - Phase order (manifest phase keys, NOT display names): `['planning','bible','production','revision','format','launch']`.
> - `money(n)` = `'$' + n.toFixed(4)` — for **spend** amounts only; budget **limits** stay as today (`dailyLimit`/`monthlyLimit` rendered raw or `.toFixed(2)`, never via `money()`).
> - `hhmmss(ts)` = `HH:MM:SS` local time; `''` for invalid dates.
> - `live` field shape: `{ stepLabel: string; progress: number } | null`.

---

## File Structure

- **Modify** `frontend/shared/src/format.ts` — add `hhmmss()` + `money()`.
- **Create** `tests/unit/format.test.ts` — unit tests for the two helpers.
- **Create** `gateway/src/services/book-card.ts` — `BookCard`/`BookLive` types + pure `buildBookCards()`.
- **Create** `tests/unit/book-card.test.ts` — unit tests for `buildBookCards()`.
- **Modify** `gateway/src/api/routes/books.routes.ts` — wire `buildBookCards` into `GET /api/books`.
- **Modify** `frontend/shared/src/types.ts` — add `BookLive` + `next?`/`live?` on `BookSummary`.
- **Modify** `frontend/studio/src/routes/Board.tsx` + `Board.module.css` — progress bar, live strip, next-action.
- **Modify** `frontend/studio/src/Rail.tsx` — real Generating/Idle counts + `money()` on spend.
- **Modify** `frontend/studio/src/routes/Activity.tsx` + `Activity.module.css` — `hhmmss`, single-space rows, `money()`.
- **Modify** `frontend/studio/src/routes/Insights.tsx`, `frontend/studio/src/routes/Confirmations.tsx` — `money()` on spend.
- **Modify** `tests/feature-smoke.sh` — assert `/api/books` carries `next`.
- **Modify** `docs/BOOK-CONTAINER-ARCHITECTURE.md`, `docs/TODO.md`, `docs/COMPLETED.md`; write `commit_message`.

---

## Task 1: Shared format helpers — `hhmmss()` + `money()`

**Files:**
- Modify: `frontend/shared/src/format.ts`
- Test: `tests/unit/format.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/unit/format.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hhmmss, money } from '../../frontend/shared/src/format.js';

test('hhmmss formats local time to HH:MM:SS', () => {
  // 2026-06-11T14:32:09 local — build from parts so the test is timezone-stable.
  const d = new Date(2026, 5, 11, 14, 32, 9);
  assert.equal(hhmmss(d.toISOString()), '14:32:09');
});

test('hhmmss pads single digits', () => {
  const d = new Date(2026, 5, 11, 4, 5, 6);
  assert.equal(hhmmss(d.toISOString()), '04:05:06');
});

test('hhmmss returns empty string for an invalid date', () => {
  assert.equal(hhmmss('not-a-date'), '');
});

test('money renders four decimal places with a leading $', () => {
  assert.equal(money(0), '$0.0000');
  assert.equal(money(0.0001), '$0.0001');
  assert.equal(money(0.012345), '$0.0123');
  assert.equal(money(5), '$5.0000');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/format.test.ts`
Expected: FAIL — `hhmmss`/`money` are not exported.

- [ ] **Step 3: Add the helpers** — append to `frontend/shared/src/format.ts`:

```ts
/**
 * Returns an HH:MM:SS string in local time.
 * @param ts - optional ISO 8601 string; defaults to now.
 * Returns an empty string for invalid dates.
 */
export function hhmmss(ts?: string): string {
  const d = ts ? new Date(ts) : new Date();
  return isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 8);
}

/**
 * Formats a USD spend amount with 4 decimals ($0.0001 resolution) so cheap-model
 * spend reads as non-zero. For SPEND amounts only — budget limits/caps render
 * separately (they are whole-dollar figures and 4 decimals would read oddly).
 */
export function money(n: number): string {
  return '$' + (Number.isFinite(n) ? n : 0).toFixed(4);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/format.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verification gate** — `npx tsc --noEmit` (repo root) is clean. Do NOT commit.

---

## Task 2: Backend `buildBookCards` helper + types

**Files:**
- Create: `gateway/src/services/book-card.ts`
- Test: `tests/unit/book-card.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `tests/unit/book-card.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBookCards } from '../../gateway/src/services/book-card.js';
import type { BookSummary, NextStep } from '../../gateway/src/services/book-types.js';

const sum = (slug: string, phase = 'production'): BookSummary => ({
  slug, title: slug, phase, schemaVersion: 1, status: 'ok', createdAt: '2026-06-11T00:00:00.000Z',
});
const next = (slug: string): NextStep => ({ phase: 'production', hasOutput: true, label: 'Continue drafting', hint: '7 of 20' });

test('attaches next for every book and live=null when no active project', () => {
  const cards = buildBookCards([sum('a'), sum('b')], next, []);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[0].next, next('a'));
  assert.equal(cards[0].live, null);
  assert.equal(cards[1].live, null);
});

test('derives live from an active project bound to the book', () => {
  const active = [{ bookSlug: 'a', progress: 35, steps: [
    { label: 'Outline', status: 'completed' },
    { label: 'Draft chapter 7', status: 'active' },
  ] }];
  const cards = buildBookCards([sum('a'), sum('b')], next, active);
  assert.deepEqual(cards[0].live, { stepLabel: 'Draft chapter 7', progress: 35 });
  assert.equal(cards[1].live, null);
});

test('live falls back to the last step label when none is active', () => {
  const active = [{ bookSlug: 'a', progress: 90, steps: [{ label: 'Compile', status: 'completed' }] }];
  const cards = buildBookCards([sum('a')], next, active);
  assert.deepEqual(cards[0].live, { stepLabel: 'Compile', progress: 90 });
});

test('first active project wins when two are bound to the same book', () => {
  const active = [
    { bookSlug: 'a', progress: 10, steps: [{ label: 'First', status: 'active' }] },
    { bookSlug: 'a', progress: 80, steps: [{ label: 'Second', status: 'active' }] },
  ];
  const cards = buildBookCards([sum('a')], next, active);
  assert.equal(cards[0].live?.stepLabel, 'First');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/book-card.test.ts`
Expected: FAIL — `book-card.js` does not exist.

- [ ] **Step 3: Create the helper** — create `gateway/src/services/book-card.ts`:

```ts
/**
 * Book-board enrichment (book-container Phase 9). Pure, side-effect-free:
 * given the book summaries, a nextStep lookup, and the currently-active
 * projects, produce the BookCard rows the board renders. Kept out of the route
 * handler so it is unit-testable in isolation.
 */
import type { BookSummary, NextStep } from './book-types.js';

/** Live generation state for a book, derived from its bound active project. */
export interface BookLive {
  stepLabel: string;
  progress: number;   // 0-100, from the bound project
}

/** A board row: a BookSummary plus its suggested next action and live state. */
export interface BookCard extends BookSummary {
  next: NextStep | null;
  live: BookLive | null;
}

/** Minimal shape this helper needs from a project (decouples it from ProjectEngine). */
interface ActiveProjectLike {
  bookSlug?: string;
  progress?: number;
  steps?: Array<{ label: string; status: string }>;
}

export function buildBookCards(
  summaries: BookSummary[],
  nextStepFn: (slug: string) => NextStep | null,
  activeProjects: ActiveProjectLike[],
): BookCard[] {
  // First active project per bound book wins (stable: listProjects() order).
  const liveBySlug = new Map<string, BookLive>();
  for (const p of activeProjects) {
    if (!p.bookSlug || liveBySlug.has(p.bookSlug)) continue;
    const step = p.steps?.find((s) => s.status === 'active') ?? p.steps?.[p.steps.length - 1];
    liveBySlug.set(p.bookSlug, { stepLabel: step?.label ?? 'working', progress: p.progress ?? 0 });
  }
  return summaries.map((b) => ({
    ...b,
    next: nextStepFn(b.slug),
    live: liveBySlug.get(b.slug) ?? null,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/book-card.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verification gate** — `npx tsc --noEmit` clean. Do NOT commit.

---

## Task 3: Wire `buildBookCards` into `GET /api/books`

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts`

- [ ] **Step 1: Add the import** — at the top of `gateway/src/api/routes/books.routes.ts`, alongside the other imports:

```ts
import { buildBookCards } from '../../services/book-card.js';
```

- [ ] **Step 2: Replace the handler body** — change the existing route (currently `app.get('/api/books', (_req, res) => { res.json({ books: services.books.list() }); })`) to:

```ts
  app.get('/api/books', (_req: Request, res: Response) => {
    // Phase 9: enrich each summary with its suggested next action + live state.
    // live is derived from active projects bound to the book (Phase 8 bookSlug).
    const engine = gateway.getProjectEngine?.();
    const active = engine ? engine.listProjects('active') : [];
    const cards = buildBookCards(
      services.books.list(),
      (slug: string) => services.books.nextStep(slug),
      active,
    );
    res.json({ books: cards });
  });
```

- [ ] **Step 3: Verification gate**

Run: `npx tsc --noEmit`
Expected: clean. Then run the full unit suite — `node --import tsx --test tests/unit/*.test.ts` — expected all pass (now includes format + book-card). Do NOT commit.

---

## Task 4: Frontend types — `next`/`live` on `BookSummary`

**Files:**
- Modify: `frontend/shared/src/types.ts`

- [ ] **Step 1: Add `BookLive` + extend `BookSummary`** — in `frontend/shared/src/types.ts`, change the `BookSummary` interface (lines 11-21) to add the two optional fields, and add `BookLive` just above it. `NextStep` is already defined further down in this file, so reference it:

```ts
/** Live generation state for a book (book-container Phase 9) — present when a bound project is running. */
export interface BookLive {
  stepLabel: string;
  progress: number;
}

/** Summary row returned by GET /api/books — lighter than the full manifest. */
export interface BookSummary {
  slug: string;
  title: string;
  phase: string;
  schemaVersion: number;
  status: BookStatus;
  createdAt: string;
  author?: string;
  voice?: string;
  genre?: string | null;
  // Phase 9 board enrichment (GET /api/books). Optional so older callers/tests still typecheck.
  next?: NextStep | null;
  live?: BookLive | null;
}
```

Note: `NextStep` is declared later in the same file (hoisted interface — fine to reference it above its declaration in TypeScript).

- [ ] **Step 2: Verification gate**

Run: `npm --prefix frontend/shared run build` (or `npx tsc --noEmit` at repo root if it covers the workspace).
Expected: clean. The store's `loadBooks` already types the response as `{ books: BookSummary[] }`, so no store change is needed. Do NOT commit.

---

## Task 5: Board card — progress bar, live strip, next-action

**Files:**
- Modify: `frontend/studio/src/routes/Board.tsx`
- Modify: `frontend/studio/src/routes/Board.module.css`

- [ ] **Step 1: Add the phase-order constant + helpers to `Board.tsx`** — directly below the existing `PHASE_VAR` constant (line 7-10), add:

```ts
// Canonical pipeline phase order (manifest phase keys) — drives the 6-segment progress bar.
const PHASE_ORDER = ['planning', 'bible', 'production', 'revision', 'format', 'launch'];
```

- [ ] **Step 2: Replace the card body** — replace the book card `<article>...</article>` (Board.tsx lines 47-61, the one keyed `b.slug`, NOT the ghost card) with this enriched version:

```tsx
            <article key={b.slug} className={b.live ? `${styles.card} ${styles.live}` : styles.card} onClick={() => setOpenSlug(b.slug)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenSlug(b.slug); } }} role="button" tabIndex={0}>
              <span className={b.live ? `${styles.phase} ${styles.gen}` : styles.phase} style={{ ['--ph' as string]: `var(${PHASE_VAR[b.phase] ?? '--ph-plan'})` }}>
                <i /> {b.phase}
              </span>
              <h3>{b.title}</h3>
              {b.genre && <div className={styles.genre}>{b.genre}</div>}
              <div className={styles.byline}>
                <b>{b.author ?? '—'}</b>
                {b.voice && <><span className={styles.v} /> {b.voice}</>}
              </div>
              <div className={styles.prog}>
                <div className={styles.progMeta}><span>{b.phase}</span><b>{Math.max(0, PHASE_ORDER.indexOf(b.phase))}/6 phases</b></div>
                <div className={styles.bar}>
                  {PHASE_ORDER.map((_, i) => {
                    const cur = PHASE_ORDER.indexOf(b.phase);
                    const cls = i < cur ? styles.lit : i === cur ? styles.cur : '';
                    return <i key={i} className={cls} />;
                  })}
                </div>
              </div>
              {b.live && <div className={styles.livestrip}><span className={styles.pip} />writing · {b.live.stepLabel}</div>}
              {b.next && (
                <div className={styles.next}>
                  <span className={styles.ndot} />
                  <span className={styles.nlbl}>{b.next.label}</span>
                  <span className={styles.nhint}>{b.next.hint}</span>
                </div>
              )}
              <div className={styles.meta}>
                <span className={styles.slug}>{b.slug}</span>
                {b.status !== 'ok' && <span className={styles.flag}>{b.status}</span>}
              </div>
            </article>
```

- [ ] **Step 3: Append the new card CSS** — append to `frontend/studio/src/routes/Board.module.css` (classes mirror `dashboard/concept/phase9-book-board.html`):

```css
/* Phase 9 — live state */
.card.live {
  border-color: rgba(240, 145, 58, 0.28);
  box-shadow: 0 0 60px -30px var(--glow);
}
.card.live::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: var(--ember-grad);
}
.phase.gen i {
  animation: pulse 1.3s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 var(--glow); }
  70% { box-shadow: 0 0 0 7px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
@keyframes breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }

/* Phase 9 — 6-segment phase progress */
.prog { margin-top: 14px; }
.progMeta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11px;
  color: var(--faint);
  margin-bottom: 6px;
}
.progMeta b { font-family: 'IBM Plex Mono', monospace; color: var(--text); font-weight: 500; }
.bar { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; }
.bar i { height: 4px; border-radius: 3px; background: rgba(238, 229, 210, 0.16); }
.bar i.lit { background: var(--ember-grad); }
.bar i.cur { background: var(--ember); box-shadow: 0 0 10px -1px var(--glow); animation: breathe 2s infinite; }

/* Phase 9 — live "writing…" strip */
.livestrip {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: var(--dim);
  background: rgba(240, 145, 58, 0.07);
  border: 1px solid rgba(240, 145, 58, 0.2);
  border-radius: 20px;
  padding: 5px 12px;
  margin-top: 14px;
}
.pip { width: 6px; height: 6px; border-radius: 50%; background: var(--ember); animation: pulse 1.3s infinite; }

/* Phase 9 — next-action footer */
.next {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 14px;
  padding-top: 13px;
  border-top: 1px solid var(--line);
}
.ndot { width: 5px; height: 5px; border-radius: 50%; background: var(--ember); flex: none; }
.nlbl { font-size: 13px; color: var(--text); }
.nhint { font-size: 12px; color: var(--faint); margin-left: auto; white-space: nowrap; }
```

- [ ] **Step 4: Verification gate**

Run: `npm run build:frontend`
Expected: studio + chat build succeed (no TS/Vite errors). Do NOT commit.

---

## Task 6: Rail — real Generating/Idle counts + `money()` on spend

**Files:**
- Modify: `frontend/studio/src/Rail.tsx`

- [ ] **Step 1: Import `money`** — change the shared import (Rail.tsx line 2) to add `money`:

```ts
import { useStore, useCosts, usePendingConfirmations, useBooks, money } from '@bookclaw/shared';
```

- [ ] **Step 2: Compute counts** — inside `Rail()`, just after `const books = useBooks();` (line 9), add:

```ts
  const generating = books.filter((b) => b.live).length;
  const idle = books.length - generating;
```

- [ ] **Step 3: Replace the static status rows** — replace the two hardcoded rows (Rail.tsx lines 158-165, "Generating 2 books" / "Idle 3 books") with:

```tsx
        <div className={styles.row}>
          <span className={`${styles.dot} ${styles.dotGen}`}></span>
          Generating <span className={styles.v}>{generating} {generating === 1 ? 'book' : 'books'}</span>
        </div>
        <div className={styles.row}>
          <span className={styles.dot}></span>
          Idle <span className={styles.v}>{idle} {idle === 1 ? 'book' : 'books'}</span>
        </div>
```

- [ ] **Step 4: 4-decimal spend** — replace the budget cap line (Rail.tsx line 169) so the spent figure uses `money()` (4 decimals) while the limit reads as whole dollars (`$5.00`, via `toFixed(2)` — NOT `money()`):

```tsx
            <b>{money(costs?.daily ?? 0)} / ${(costs?.dailyLimit ?? 0).toFixed(2)}</b>
```

- [ ] **Step 5: Verification gate**

Run: `npm run build:frontend`
Expected: success. Do NOT commit.

---

## Task 7: Activity polish + cost-precision sweep

**Files:**
- Modify: `frontend/studio/src/routes/Activity.tsx`
- Modify: `frontend/studio/src/routes/Activity.module.css`
- Modify: `frontend/studio/src/routes/Insights.tsx`
- Modify: `frontend/studio/src/routes/Confirmations.tsx`

- [ ] **Step 1: Activity — seconds + money** — in `Activity.tsx`: change the import (line 2) `hhmm` → `hhmmss` and add `money`:

```ts
import { useStore, useActivity, streamActivity, hhmmss, money } from '@bookclaw/shared';
```

Then change the timestamp (line 75) and the per-event cost (lines 81-83):

```tsx
            <span className={styles.ts}>{hhmmss(e.timestamp)}</span>
```

```tsx
              {typeof e.metadata?.cost === 'number'
                ? money(e.metadata.cost as number)
                : (e.metadata?.provider as string) ?? ''}
```

- [ ] **Step 2: Activity CSS — single-space rows + wider timestamp** — in `Activity.module.css`, change `.ev` (lines 80-91: `padding: 11px 14px` → `padding: 4px 12px`, `gap: 16px` → `gap: 12px`) and `.ts` (line 102: `width: 60px` → `width: 66px` to fit `HH:MM:SS`). Final `.ev` and `.ts`:

```css
.ev {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 4px 12px;
  border-radius: 9px;
  border-left: 2px solid transparent;
  transition: 0.15s;
  opacity: 0;
  transform: translateY(8px);
  animation: rise 0.5s var(--ease) forwards;
}
```

```css
.ts {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: var(--faint);
  flex: none;
  width: 66px;
}
```

- [ ] **Step 3: Insights — money on spend** — in `Insights.tsx`, add `money` to the shared import (line 2: `import { api, useStore, useCosts, useActivity, hhmm, money } from '@bookclaw/shared';`), then change the two spend lines (53, 65) so only the spent figure uses `money()` (limits unchanged):

```tsx
            <b>{money(costs?.daily ?? 0)} / ${(costs?.dailyLimit ?? 0).toFixed(2)}</b>
```

```tsx
            <b>{money(costs?.monthly ?? 0)} / ${(costs?.monthlyLimit ?? 0).toFixed(2)}</b>
```

(Leave the existing `hhmm` usage in Insights as-is — only Activity timestamps gain seconds.)

- [ ] **Step 4: Confirmations — money on estimatedCost** — in `Confirmations.tsx`, add `money` to the shared import (line 2: `import { api, useStore, usePendingConfirmations, Button, money } from '@bookclaw/shared';`), then change line 54:

```tsx
                <span className={styles.cost}>{money(c.estimatedCost)}</span>
```

- [ ] **Step 5: Verification gate**

Run: `npm run build:frontend`
Expected: success. (`money`/`hhmmss` are re-exported automatically — `frontend/shared/src/index.ts` line 5 is `export * from './format.js';`, so no index edit is needed.) Do NOT commit.

---

## Task 8: feature-smoke — assert `/api/books` carries `next`

**Files:**
- Modify: `tests/feature-smoke.sh`

- [ ] **Step 1: Add an assertion in Tier A** — after the Tier-A block that creates a book and lists `/api/books`, add a check that the listed books now carry a `next` object. Find the Tier-A `GET /api/books` list call (search `GET /api/books` / `/api/books"`); after it, add:

```bash
# Phase 9: GET /api/books rows carry an enriched `next` action object.
BOOKS_LIST=$(req GET /api/books)
HAS_NEXT=$(printf '%s' "$BOOKS_LIST" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    try{
      const bs=(JSON.parse(s).books||[]);
      // pass if there are no books (nothing to assert) or every book has a `next` key (object or null)
      const ok = bs.length===0 || bs.every(b=>Object.prototype.hasOwnProperty.call(b,"next"));
      console.log(ok?"yes":"no");
    }catch(e){console.log("err")}
  })')
if [ "$HAS_NEXT" = "yes" ]; then
  pass "Phase 9: /api/books rows carry next-action" "enriched list shape"
else
  fail "Phase 9: /api/books rows carry next-action" "next key missing ($HAS_NEXT)"
fi
```

- [ ] **Step 2: Verification gate**

Run: `bash -n tests/feature-smoke.sh`
Expected: SYNTAX OK. (The live assertion runs in Task 9's smoke run.) Do NOT commit.

---

## Task 9: Gates, deploy, visual check, docs, commit_message

- [ ] **Step 1: Full local gates**

Run: `npx tsc --noEmit` → clean.
Run: `node --import tsx --test tests/unit/*.test.ts` → all pass (now includes `format` + `book-card`).
Run: `npm run build:frontend` → studio + chat build succeed.

- [ ] **Step 2: Deploy to Mercury**

Run: `touch build_now`, then poll `.build-logs/last-build.status` until a fresh timestamp shows `result=PASS`.

- [ ] **Step 3: Live feature-smoke**

Run:
```bash
TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '"')
BASE_URL=http://192.168.1.32:3847 BOOKCLAW_AUTH_TOKEN="$TOKEN" bash tests/feature-smoke.sh
```
Expected: SUMMARY all passed, 0 failed, including `Phase 9: /api/books rows carry next-action`.

- [ ] **Step 4: Live visual check (documentation surface)** — open `http://192.168.1.32:3847/` and confirm: board cards show the 6-segment phase bar + next-action; a book with a running project shows the live strip and the rail's Generating count is non-zero; the Activity feed shows `HH:MM:SS` single-spaced rows; costs read 4-decimals (e.g. `$0.0001`) while limits read `$5.00`. (This is the screenshot surface — the renamed real book titles make it presentable.)

- [ ] **Step 5: Docs** — mark Phase 9 Implemented in `docs/BOOK-CONTAINER-ARCHITECTURE.md` (one line + verify note, matching the Phase 7/8 entries); move the three GUI-polish items + the Phase 9 board item from `docs/TODO.md` to `docs/COMPLETED.md` under a `## 2026-06-11` heading (preserve bullet text, prepend the date, link spec+plan). Note Phase 10 (per-channel active book) is next.

- [ ] **Step 6: Write `commit_message`** — at the repo root:

```
feat(phase9): book-board UI — live phase/next-action/progress + studio polish

- GET /api/books enriched with per-book `next` (suggested action) and `live`
  (derived from active projects bound via Phase-8 bookSlug) through a pure,
  unit-tested buildBookCards() helper
- Board cards gain a 6-segment phase progress bar, a live "writing · <step>"
  strip + pulsing phase dot, and a next-action footer
- Rail Generating/Idle counts are now real (from the books' live state)
- GUI polish: activity timestamps HH:MM:SS, single-spaced activity rows,
  4-decimal cost precision ($0.0001) on spend amounts (limits unchanged)
- shared helpers money()/hhmmss() + unit tests; book-card helper + unit tests;
  feature-smoke asserts the enriched /api/books shape
- mockup: dashboard/concept/phase9-book-board.html
```

Do NOT `git commit`. Confirm `git status` shows the expected file set + `commit_message`, the live smoke is green, and the handoff (`.remember/remember.md`) + memory index reflect Phase 9 done.

---

## Out of scope (do not do here)

Per-channel active book (**Phase 10**); new Write/Asset/New-Book flows (exist); backup (**Phase 11**); library share/import (**Phase 12**); a Playwright DOM harness (tracked separately).
