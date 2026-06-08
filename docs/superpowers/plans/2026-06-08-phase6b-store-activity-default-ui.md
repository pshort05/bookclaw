# Phase 6b — Studio store extension + Activity feed + v6-as-default Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the v6 React studio the default served UI (legacy reachable via `BOOKCLAW_UI=legacy`), extend the shared store with costs/activity/confirmations, and add a live-tailing **Activity** route fed by the existing `/api/activity` + SSE stream — wiring the Rail's Activity link, spend footer, and Confirmations badge to real data.

**Architecture:** Pure additive front-end work on the existing `frontend/{shared,studio}` workspaces plus a 2-line serve-default inversion in the gateway. The store keeps the forward-compat seam from 6a (components never read a module-global active book). Activity uses `EventSource` against `/api/activity/stream` with the `?token=` query fallback (EventSource cannot send `Authorization` headers); the server SSE channel already exists.

**Tech Stack:** React 18, Vite 5, React Router 6, Zustand, TypeScript (bundler resolution), the existing `@bookclaw/shared` alias. Server: Node/TS, `phase-11-http.ts`.

**Spec:** `docs/superpowers/specs/2026-06-07-phase6-frontend-rewrite-design.md` (6b is task-outlined at the end of `docs/superpowers/plans/2026-06-07-phase6-frontend-rewrite.md`).

---

## Conventions (read once)

- **No git commits during execution.** Per the project handoff + `CLAUDE.md`, Claude never `git commit`s directly — build in the working tree; the maintainer pushes via `./push.sh` at the end. (This **overrides** the "real commit per task" instruction in the 6a plan.) Each task ends with a **verification + review checkpoint** instead of a commit.
- **No front-end unit-test runner exists** (no vitest/jsdom; adding one is out of scope). Verification per task = `npx tsc --noEmit` (server) + `tsc -b` via the studio build + `npm run -w frontend/studio build` succeeds + the existing `tests/unit/studio-build.test.ts` + manual browser check. Component *behavior* is verified manually; the build/type-check is the automated gate.
- **Front-end imports:** in `frontend/shared/src` use `.js` specifiers in re-exports (matches 6a `index.ts`); studio imports the barrel via `@bookclaw/shared`. CSS via CSS Modules (`*.module.css`).
- **CSS source of truth:** `dashboard/concept/phase6-studio-shell.html` — the Activity view. Port the `.feed`, `.ev`, `.ts`, `.cat`, `.bd`, `.sl`, `.mt`, `.now`, `.hero`, `.filters`, `.chip` rules **verbatim** into `Activity.module.css`. The `:root` tokens (`--ember`, `--gold`, `--dim`, `--ph-*`, `--ease`, etc.) already live in `frontend/shared/src/tokens.css`.
- **Forward-compat rule (do not violate):** components receive data via store hooks/props; the only active-book-API touch stays the store's `useActiveBook()` seam from 6a.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `gateway/src/init/phase-11-http.ts` | invert UI default: v6 unless `BOOKCLAW_UI=legacy` | Modify (lines 24–27) |
| `.env.example` | document the inverted `BOOKCLAW_UI` semantics | Modify |
| `package.json` | build the frontend before `npm test` (studio dist must exist for the `/` + studio-build assertions) | Modify (`test` script) |
| `frontend/shared/src/types.ts` | add `ActivityEntry`, `ActivityType`, `ActivitySource`, `ConfirmationRequest`, `ConfirmationStatus` | Modify |
| `frontend/shared/src/activity.ts` | `streamActivity()` — EventSource client with `?token=` | Create |
| `frontend/shared/src/store.ts` | add `costs`/`activity`/`confirmations` slices + loaders + `pushActivity` + selectors | Modify |
| `frontend/shared/src/index.ts` | re-export `activity.js` | Modify |
| `frontend/studio/src/routes/Activity.tsx` | live-tailing feed route | Create |
| `frontend/studio/src/routes/Activity.module.css` | ported feed CSS | Create |
| `frontend/studio/src/main.tsx` | add `/activity` route | Modify |
| `frontend/studio/src/Rail.tsx` | Activity `NavLink`, real spend footer, real Confirmations badge | Modify |

---

### Task 1: Make v6 the default UI (legacy = opt-out)

**Files:** Modify `gateway/src/init/phase-11-http.ts` (lines 24–27), `.env.example`, `package.json`.

- [ ] **Step 1: Invert the UI selector** in `gateway/src/init/phase-11-http.ts`. Replace the current:

```ts
  const useV6 = process.env.BOOKCLAW_UI === 'v6';
  const uiDir = useV6 ? STUDIO_DIST : join(ROOT_DIR, 'dashboard', 'dist');
  const uiHtml = join(uiDir, 'index.html');
  console.log(`  ✓ UI: ${useV6 ? 'v6 studio (frontend/studio)' : 'legacy dashboard'}`);
```

with (v6 is now the default; `BOOKCLAW_UI=legacy` opts back to the old dashboard):

```ts
  // v6 React studio is the default UI. Opt back to the legacy dashboard with BOOKCLAW_UI=legacy.
  const useV6 = process.env.BOOKCLAW_UI !== 'legacy';
  const uiDir = useV6 ? STUDIO_DIST : join(ROOT_DIR, 'dashboard', 'dist');
  const uiHtml = join(uiDir, 'index.html');
  console.log(`  ✓ UI: ${useV6 ? 'v6 studio (frontend/studio)' : 'legacy dashboard (BOOKCLAW_UI=legacy)'}`);
```

(Note: the live Mercury repo `.env` still has `BOOKCLAW_UI=v6` — harmless, since `'v6' !== 'legacy'` → v6. It can be removed later; leaving it is fine.)

- [ ] **Step 2: Update `.env.example`.** Find the `BOOKCLAW_UI` line and change its comment to reflect the inverted default:

```
# Front-end served at "/": the v6 React studio is the DEFAULT. Set to "legacy"
# to serve the old vanilla-JS dashboard instead. (Written to docker/.env / repo .env.)
# BOOKCLAW_UI=legacy
```

- [ ] **Step 3: Make `npm test` build the studio first.** With v6 default, `tests/smoke-test.sh` GET `/` and `tests/unit/studio-build.test.ts` both need `frontend/studio/dist` to exist. In `package.json` change the `test` script:

```jsonc
    "test": "npm run build:frontend && npm run test:unit && npm run test:api && npm run test:smoke",
```

- [ ] **Step 4: Build the studio + type-check the server**

Run: `npm run build:frontend`
Expected: `frontend/studio/dist/index.html` + `dist/assets/*` produced, no error.
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Verify smoke serves the studio at `/` with the token injected**

Run: `npm run test:smoke`
Expected: all phases PASS — in particular "dashboard / serves with token injected" now hits the **studio** HTML (title `BookClaw · Studio`), placeholder substituted. (CSP `connect-src 'self'` assertion still passes; the studio is same-origin.)

- [ ] **Step 6: Review checkpoint** — diff `phase-11-http.ts`, `.env.example`, `package.json`. Confirm only the default inverted; legacy still reachable; no other behavior touched.

---

### Task 2: Extend shared contract types

**Files:** Modify `frontend/shared/src/types.ts` (append; do not touch existing exports).

- [ ] **Step 1: Append the activity + confirmation types** (mirrors `gateway/src/services/activity-log.ts` and `confirmation-gate.ts`):

```ts
/** Activity feed — mirrors gateway/src/services/activity-log.ts (ActivityEntry). */
export type ActivityType =
  | 'project_created' | 'project_planned' | 'goal_created' | 'goal_planned'
  | 'step_started' | 'step_completed' | 'step_failed' | 'chat_message'
  | 'skill_matched' | 'file_saved' | 'provider_selected'
  | 'preference_detected' | 'lesson_learned' | 'error' | 'system';

export type ActivitySource = 'telegram' | 'dashboard' | 'api' | 'internal';

export interface ActivityEntry {
  timestamp: string;          // ISO 8601
  type: ActivityType;
  source: ActivitySource;
  goalId?: string;
  stepLabel?: string;
  message: string;
  metadata?: Record<string, unknown>;   // provider, tokens, cost, wordCount, fileName, skillName, …
}

/** ConfirmationGate queue — mirrors gateway/src/services/confirmation-gate.ts (only fields the UI reads). */
export type ConfirmationStatus =
  | 'pending' | 'approved' | 'rejected' | 'completed' | 'failed' | 'expired';

export interface ConfirmationRequest {
  id: string;
  createdAt: string;
  expiresAt: string;
  service: string;
  action: string;
  platform: string;
  description: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  isReversible: boolean;
  disclosures: string[];
  estimatedCost?: number;
  status: ConfirmationStatus;
  decidedAt?: string;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Review checkpoint** — confirm `Costs`, `BookSummary`, `Status` exports are untouched.

---

### Task 3: Activity SSE client

**Files:** Create `frontend/shared/src/activity.ts`; Modify `frontend/shared/src/index.ts`.

- [ ] **Step 1: Create `frontend/shared/src/activity.ts`**

```ts
import type { ActivityEntry } from './types.js';

const token = (): string =>
  (typeof window !== 'undefined' && window.__BOOKCLAW_TOKEN__) || '';
const base = (): string =>
  (typeof window !== 'undefined' && window.__BOOKCLAW_API_BASE__) || '';

/**
 * Subscribe to the live activity stream (GET /api/activity/stream, text/event-stream).
 * EventSource cannot set Authorization headers, so the bearer token is passed via the
 * server's ?token= query fallback. Returns an unsubscribe function (closes the stream).
 * The server sends an initial {"type":"connected"} handshake frame — it is filtered out.
 */
export function streamActivity(onEntry: (e: ActivityEntry) => void): () => void {
  const t = token();
  const url = `${base()}/api/activity/stream${t ? `?token=${encodeURIComponent(t)}` : ''}`;
  const es = new EventSource(url);
  es.onmessage = (ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data);
      if (data && data.type === 'connected') return; // handshake, not an entry
      onEntry(data as ActivityEntry);
    } catch {
      /* ignore malformed frame */
    }
  };
  return () => es.close();
}
```

- [ ] **Step 2: Re-export from the barrel** — add to `frontend/shared/src/index.ts`:

```ts
export * from './activity.js';
```

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run -w frontend/studio build` → succeeds (the barrel resolves `activity.js`).

- [ ] **Step 4: Review checkpoint** — confirm the file uses the same `token()`/`base()` pattern as `api.ts`/`socket.ts`.

---

### Task 4: Extend the store (costs / activity / confirmations)

**Files:** Modify `frontend/shared/src/store.ts`.

- [ ] **Step 1: Extend imports + state.** Update the import line and `StoreState`:

```ts
import { create } from 'zustand';
import { api } from './api.js';
import type { BookSummary, Status, Costs, ActivityEntry, ConfirmationRequest } from './types.js';
```

Add these fields to the `StoreState` interface (keep all existing fields):

```ts
  costs?: Costs;
  /** Most-recent-first activity buffer (capped). */
  activity: ActivityEntry[];
  confirmations: ConfirmationRequest[];
  loadCosts: () => Promise<void>;
  /** Loads the recent backlog (newest first). */
  loadActivity: (count?: number) => Promise<void>;
  /** Prepend a live entry (from the SSE stream); caps the buffer at 200. */
  pushActivity: (entry: ActivityEntry) => void;
  loadConfirmations: () => Promise<void>;
```

- [ ] **Step 2: Initialize + implement** inside `create<StoreState>((set) => ({ … }))` (add alongside the existing members):

```ts
  activity: [],
  confirmations: [],

  loadCosts: async () => {
    const costs = await api<Costs>('/api/costs');
    set({ costs });
  },

  // GET /api/activity returns { entries } oldest→newest; reverse to newest-first for the feed.
  loadActivity: async (count = 100) => {
    const r = await api<{ entries: ActivityEntry[] }>(`/api/activity?count=${count}`);
    set({ activity: (r.entries ?? []).slice().reverse() });
  },

  pushActivity: (entry) =>
    set((s) => ({ activity: [entry, ...s.activity].slice(0, 200) })),

  loadConfirmations: async () => {
    const r = await api<{ requests: ConfirmationRequest[] }>('/api/confirmations?status=pending');
    set({ confirmations: r.requests ?? [] });
  },
```

- [ ] **Step 3: Add selectors** at the bottom (next to `useBooks`/`useActiveBook`):

```ts
/** Current spend/limits, or undefined until loadCosts() resolves. */
export const useCosts = () => useStore((s) => s.costs);

/** Activity entries, newest first. */
export const useActivity = () => useStore((s) => s.activity);

/** Pending confirmation requests (the approvals queue). */
export const usePendingConfirmations = () => useStore((s) => s.confirmations);
```

- [ ] **Step 4: Type-check + build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run -w frontend/studio build` → succeeds.

- [ ] **Step 5: Review checkpoint** — confirm the existing `loadBooks`/`loadStatus`/seam selectors are unchanged and the new slices follow the same shape.

---

### Task 5: Activity route (live feed)

**Files:** Create `frontend/studio/src/routes/Activity.tsx`, `frontend/studio/src/routes/Activity.module.css`.

- [ ] **Step 1: Port the feed CSS.** Create `Activity.module.css` by copying **verbatim** from `dashboard/concept/phase6-studio-shell.html` the rules for the Activity view: `.scroll`, `.hero`, `.filters`, `.chip` (+ `.chip.on`, `.chip .n`), `.feed`, `.ev` (+ `.ev.now`), `.ts`, `.cat` (+ `.cat i`), `.bd`, `.sl`, `.mt`, and the `@keyframes rise`. Rename only the leading selectors to local module class names (CSS Modules) — keep declarations identical. The `--ember/--gold/--dim/--ph-*/--ease` variables resolve from the global `tokens.css` already imported in `main.tsx`.

- [ ] **Step 2: Create `Activity.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useStore, useActivity, streamActivity } from '@bookclaw/shared';
import type { ActivityEntry } from '@bookclaw/shared';
import styles from './Activity.module.css';

/** Map an entry to a display category (label + the CSS color var name). */
function category(e: ActivityEntry): { label: string; varName: string } {
  if (typeof e.metadata?.cost === 'number') return { label: 'Cost', varName: '--gold' };
  switch (e.type) {
    case 'step_started': case 'step_completed': case 'step_failed':
    case 'project_created': case 'project_planned':
    case 'goal_created': case 'goal_planned':
      return { label: 'Production', varName: '--ember' };
    case 'provider_selected':
      return { label: 'Model', varName: '--dim' };
    case 'file_saved':
      return { label: 'Book', varName: '--ph-world' };
    case 'skill_matched':
      return { label: 'Skill', varName: '--gold' };
    case 'error':
      return { label: 'Error', varName: '--alert' };
    default:
      return { label: 'System', varName: '--ph-fmt' };
  }
}

const FILTERS = ['All', 'Production', 'Cost', 'Model', 'Book', 'System'] as const;
type Filter = typeof FILTERS[number];

function clock(ts: string): string {
  // HH:MM, local — defensive against a bad timestamp.
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5);
}

export function Activity() {
  const entries = useActivity();
  const loadActivity = useStore((s) => s.loadActivity);
  const pushActivity = useStore((s) => s.pushActivity);
  const [filter, setFilter] = useState<Filter>('All');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadActivity().catch((e) => setError(String(e)));
    const stop = streamActivity((entry) => pushActivity(entry));
    return stop;
  }, [loadActivity, pushActivity]);

  const shown = useMemo(
    () => (filter === 'All' ? entries : entries.filter((e) => category(e).label === filter)),
    [entries, filter],
  );

  return (
    <div className={styles.scroll}>
      <div className={styles.hero}>
        <h1>Activity, <em>as it happens</em></h1>
        <p>Drafts, model calls, book events, approvals and spend — live.</p>
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f}
              className={f === filter ? `${styles.chip} ${styles.on}` : styles.chip}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className={styles.empty}>Couldn’t load activity — {error}</p>
      ) : (
        <div className={styles.feed}>
          {shown.map((e, i) => {
            const c = category(e);
            return (
              <div key={`${e.timestamp}-${i}`} className={i === 0 ? `${styles.ev} ${styles.now}` : styles.ev}>
                <span className={styles.ts}>{clock(e.timestamp)}</span>
                <span className={styles.cat} style={{ ['--c' as string]: `var(${c.varName})` }}>
                  <i /> {c.label}
                </span>
                <span className={styles.bd}>{e.message}</span>
                <span className={styles.mt}>
                  {typeof e.metadata?.cost === 'number'
                    ? `$${(e.metadata.cost as number).toFixed(2)}`
                    : (e.metadata?.provider as string) ?? ''}
                </span>
              </div>
            );
          })}
          {shown.length === 0 && <p className={styles.empty}>No activity yet.</p>}
        </div>
      )}
    </div>
  );
}
```

(Add an `.empty` rule to `Activity.module.css` if the concept lacks one — copy the `.empty` rule from `Board.module.css` for consistency.)

- [ ] **Step 3: Type-check + build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run -w frontend/studio build` → succeeds.

- [ ] **Step 4: Review checkpoint** — confirm the feed renders newest-first, the SSE unsubscribes on unmount (the `return stop`), and no `Authorization` header is attempted on the EventSource.

---

### Task 6: Wire the Rail (Activity link, real spend, real badge)

**Files:** Modify `frontend/studio/src/Rail.tsx`.

- [ ] **Step 1: Import the store hooks + NavLink usage.** At the top:

```tsx
import { NavLink } from 'react-router-dom';
import { useStore, useCosts, usePendingConfirmations } from '@bookclaw/shared';
import { useEffect } from 'react';
import styles from './Rail.module.css';
```

- [ ] **Step 2: Load costs + confirmations once** at the top of the component body:

```tsx
export function Rail() {
  const costs = useCosts();
  const pending = usePendingConfirmations();
  const loadCosts = useStore((s) => s.loadCosts);
  const loadConfirmations = useStore((s) => s.loadConfirmations);
  useEffect(() => {
    loadCosts().catch(() => {});
    loadConfirmations().catch(() => {});
  }, [loadCosts, loadConfirmations]);
```

- [ ] **Step 3: Convert the Activity nav item** from the inert `<a href="#">` to a routed `NavLink` (mirror the Book Board `NavLink` active-class pattern; keep the existing `<svg>` icon):

```tsx
        <NavLink
          to="/activity"
          className={({ isActive }) => isActive ? `${styles.navLink} ${styles.active}` : styles.navLink}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h4l2 6 4-14 2 8h6"/>
          </svg>
          Activity
        </NavLink>
```

- [ ] **Step 4: Real Confirmations badge.** Replace the hard-coded `<span className={styles.badge}>1</span>` so it shows the live pending count and hides at zero:

```tsx
          Confirmations {pending.length > 0 && <span className={styles.badge}>{pending.length}</span>}
```

- [ ] **Step 5: Real spend footer.** Replace the static budget block (`$23.41 / $40` + the `width: '58%'` bar) with live cost data, falling back gracefully before `costs` loads:

```tsx
        <div className={styles.budget}>
          <div className={styles.cap}>
            <span>AI spend · today</span>
            <b>${(costs?.daily ?? 0).toFixed(2)} / ${costs?.dailyLimit ?? 0}</b>
          </div>
          <div className={styles.bar}>
            <i style={{ width: `${costs && costs.dailyLimit > 0 ? Math.min(100, (costs.daily / costs.dailyLimit) * 100) : 0}%` }} />
          </div>
        </div>
```

(Leave the static "Generating 2 books / Idle 3 books" rows as-is for now — per-book live status is 6c/6h; this task only wires data that already has endpoints.)

- [ ] **Step 6: Type-check + build**

Run: `npx tsc --noEmit` → clean.
Run: `npm run -w frontend/studio build` → succeeds.

- [ ] **Step 7: Review checkpoint** — confirm the Activity link routes (no `href="#"` left for it), the badge hides at zero, and the spend bar clamps to 100%.

---

### Task 7: Router wiring + full verification

**Files:** Modify `frontend/studio/src/main.tsx`.

- [ ] **Step 1: Register the `/activity` route.** Update the imports + `<Routes>`:

```tsx
import { App } from './App.js';
import { Board } from './routes/Board.js';
import { Activity } from './routes/Activity.js';
```

```tsx
      <Routes>
        <Route element={<App />}>
          <Route index element={<Board />} />
          <Route path="activity" element={<Activity />} />
        </Route>
      </Routes>
```

- [ ] **Step 2: Build + full type-check**

Run: `npm run build:frontend` → studio `dist` produced.
Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Run the test suite** (now builds the frontend first per Task 1)

Run: `npm test`
Expected: unit (incl. `studio-build`) + api + smoke all green; `/` serves the studio with token injected.

- [ ] **Step 4: Manual v6 check (documented; the project has no FE test runner)**

Run: `BOOKCLAW_AUTH_TOKEN=test npm start` (no `BOOKCLAW_UI` → v6 is now default).
- Load `/` → board renders; the **Activity** rail item is now active-routable.
- Click **Activity** → feed renders the recent backlog (newest first); trigger any action (e.g. create a tiny project) and confirm a new row prepends live over SSE; no CSP errors in the console; the Network tab shows `GET /api/activity/stream?token=…` open (EventSource), not a 401.
- Rail footer shows the real today's spend; the Confirmations badge reflects `/api/confirmations?status=pending` (absent when zero).

- [ ] **Step 5: Review checkpoint** — the route renders, SSE authenticates via `?token=`, and nothing else regressed.

---

## Self-Review (6b)

- **Spec coverage:** 6b delivers the spec's store extension (costs/activity/confirmations), the live Activity view (SSE), and the v6-as-default decision. The SPA catch-all the outline mentioned **already exists** in `phase-11-http.ts` (no task needed). Suggested-next-step + per-asset description are **6e** (no endpoint yet) — explicitly out of this round.
- **Placeholder scan:** all code steps show real code; CSS "port verbatim from concept" references the concrete `phase6-studio-shell.html` Activity view (the 6a precedent for CSS), with exact class names listed.
- **Type consistency:** `ActivityEntry`/`ConfirmationRequest`/`Costs` defined in Task 2 are consumed unchanged by `activity.ts` (Task 3), `store.ts` (Task 4), `Activity.tsx` (Task 5), and `Rail.tsx` (Task 6). Selector names (`useCosts`/`useActivity`/`usePendingConfirmations`) match between `store.ts` and their consumers. `streamActivity` signature matches its use in `Activity.tsx`.
- **Honest scope:** the Rail's "Generating/Idle book counts" stay static (no per-book live-status endpoint); only data with real endpoints is wired.
