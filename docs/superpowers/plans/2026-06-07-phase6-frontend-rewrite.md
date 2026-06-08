# Phase 6 — Front-end / UI rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the vanilla-JS dashboard with a React + Vite front-end whose state layer does not assume a single global active book, preserving feature parity, the API contract, and the security perimeter.

**Architecture:** npm-workspaces `frontend/{shared,studio,chat}`. `shared` is the Atelier design system + API/socket/store infra; `studio` and `chat` are two Vite SPAs over the existing gateway API. The gateway serves the studio at `/` (token injected into an inline bootstrap, as today) and the chat on a second port. Cutover is incremental and parity-gated; the old `dashboard/` stays servable until 6i.

**Tech Stack:** Node 22, Vite 5, React 18, TypeScript, React Router 6, Zustand, socket.io-client, `@fontsource/*` (self-hosted fonts), optional framer-motion. Server stays Node/TS (NodeNext, `.js` imports).

**Spec:** `docs/superpowers/specs/2026-06-07-phase6-frontend-rewrite-design.md`

**Conventions (read once):**
- Server imports use `.js` extensions even from `.ts`. Type-check server: `npx tsc --noEmit`. Tests: `npm test` (unit + api + smoke); single unit file: `node --import tsx --test tests/unit/<f>.test.ts`.
- Front-end lives under `frontend/`; build with `npm run -w frontend/studio build` (and `-w frontend/chat`). The aggregate `npm run build:frontend` builds all workspaces.
- **Commits:** make a real git commit per task on `main` with the message shown. Do NOT run `./push.sh`. Do NOT write a `commit_message` file. (Same convention as the Phase 5 plan.)
- **Visual/CSS source of truth:** the concept files in `dashboard/concept/`. Where a step says "port the `:root` block" or "port the `.card` rules", copy them verbatim from the named concept file — they are concrete, owner-approved CSS, not placeholders.
- **Forward-compat rule (do not violate):** components receive `bookId` via route/props/context; never read a module-global active book. The only place the global active-book API is touched is the store's `useActiveBook()` seam.

---

## Scope note

Phase 6 is multiple subsystems. Per the writing-plans Scope Check it is split into sub-phases, each producing working, testable software. **This document fully details 6a** (the foundation — the riskiest integration: workspaces + token/CSP + Docker + the store seam). **6b–6i are task-outlined** at the end; each is expanded into its own `docs/superpowers/plans/2026-06-…-phase6<x>-<name>.md` when started, exactly as phases 1–5 were specced+planned at their start. Do not attempt 6b+ from the outlines alone.

---

## File Structure (6a)

| File | Responsibility | Action |
|------|----------------|--------|
| `package.json` | declare `workspaces: ["frontend/*"]` + `build:frontend` script | Modify |
| `frontend/shared/package.json` | shared design-system/infra package | Create |
| `frontend/shared/src/tokens.css` | Atelier `:root` variables + base resets | Create |
| `frontend/shared/src/fonts.ts` | `@fontsource` imports (self-hosted) | Create |
| `frontend/shared/src/Button.tsx` | letterpress primary + keyed secondary | Create |
| `frontend/shared/src/api.ts` | token-aware fetch client (configurable base URL) | Create |
| `frontend/shared/src/socket.ts` | Socket.IO client with handshake token | Create |
| `frontend/shared/src/types.ts` | server-contract TS types (Book, Status, …) | Create |
| `frontend/shared/src/store.ts` | Zustand store + `useBooks`/`useActiveBook` seam | Create |
| `frontend/studio/package.json` | studio SPA | Create |
| `frontend/studio/vite.config.ts` | Vite + React, base `/`, outDir `dist` | Create |
| `frontend/studio/tsconfig.json` | TS config | Create |
| `frontend/studio/index.html` | token bootstrap + module entry | Create |
| `frontend/studio/src/main.tsx` | React root + Router | Create |
| `frontend/studio/src/App.tsx` | shell: rail + routed `<Outlet/>` | Create |
| `frontend/studio/src/Rail.tsx` | left nav (ported from concept) | Create |
| `frontend/studio/src/routes/Board.tsx` | minimal Book Board over `/api/books` | Create |
| `frontend/studio/dist/**` | committed build output (friction-free dev/tests) | Create |
| `gateway/src/init/phase-11-http.ts` | serve studio dist behind `BOOKCLAW_UI=v6` flag | Modify |
| `gateway/src/paths.ts` | add studio dist path constant | Modify |
| `docker/Dockerfile` | build frontend workspaces; copy dist | Modify |
| `.env.example` | document `BOOKCLAW_UI`, `BOOKCLAW_CHAT_PORT` | Modify |
| `tests/unit/studio-build.test.ts` | assert built index.html has token placeholder + module entry | Create |

---

### Task 1: npm workspaces + Vite scaffold

**Files:** Modify `package.json`; Create `frontend/shared/package.json`, `frontend/studio/{package.json,vite.config.ts,tsconfig.json}`.

- [ ] **Step 1: Add workspaces + build script to root `package.json`**

In `package.json` add (merge, don't clobber existing fields):

```jsonc
{
  "workspaces": ["frontend/*"],
  "scripts": {
    // …existing…
    "build:frontend": "npm run -w frontend/studio build && npm run -w frontend/chat build || npm run -w frontend/studio build"
  }
}
```
(The `|| …` keeps it working in 6a before `frontend/chat` exists; tighten to both in 6i.)

- [ ] **Step 2: Create `frontend/shared/package.json`**

```json
{
  "name": "@bookclaw/shared",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "dependencies": {
    "@fontsource/fraunces": "^5.0.0",
    "@fontsource/ibm-plex-mono": "^5.0.0",
    "@fontsource/hanken-grotesk": "^5.0.0",
    "socket.io-client": "^4.7.0",
    "zustand": "^4.5.0"
  },
  "peerDependencies": { "react": "^18", "react-dom": "^18" }
}
```

- [ ] **Step 3: Create `frontend/studio/package.json`**

```json
{
  "name": "@bookclaw/studio",
  "version": "0.0.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -b && vite build", "preview": "vite preview" },
  "dependencies": {
    "@bookclaw/shared": "*",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 4: Create `frontend/studio/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: '/',                 // served at site root by the gateway
  build: { outDir: 'dist', emptyOutDir: true },
});
```

- [ ] **Step 5: Create `frontend/studio/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020", "lib": ["ES2020", "DOM", "DOM.Iterable"], "module": "ESNext",
    "moduleResolution": "Bundler", "jsx": "react-jsx", "strict": true,
    "noEmit": true, "skipLibCheck": true, "types": ["vite/client"]
  },
  "include": ["src", "../shared/src"]
}
```

- [ ] **Step 6: Install + commit**

Run: `npm install`
Expected: `frontend/shared` + `frontend/studio` linked as workspaces; no error.
```bash
git add package.json package-lock.json frontend/
git commit -m "build(phase6): npm workspaces + Vite/React studio scaffold"
```

---

### Task 2: Atelier design system in `frontend/shared`

**Files:** Create `frontend/shared/src/{tokens.css,fonts.ts,Button.tsx,Button.module.css,index.ts}`.

- [ ] **Step 1: `tokens.css`** — copy the `:root { … }` variable block verbatim from `dashboard/concept/phase6-studio-shell.html` (the `--bg/--ember/--ember-grad/--ph-*/--ease/…` set), plus the `*{box-sizing}`, `body` base, grain `body::before/::after`, and scrollbar rules. This is the single source of the theme.

- [ ] **Step 2: `fonts.ts`** (self-hosted — keeps CSP `'self'`)

```ts
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/400-italic.css';
import '@fontsource/fraunces/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/hanken-grotesk/700.css';
```

- [ ] **Step 3: `Button.tsx` + `Button.module.css`** — letterpress primary + keyed secondary. Port the `.btn` (letterpress) and `.btn-key` (keyed, with `.kk` chip) rules verbatim from `phase6-studio-shell.html` into `Button.module.css`.

```tsx
import styles from './Button.module.css';
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'; shortcut?: string;
};
export function Button({ variant = 'primary', shortcut, children, ...rest }: Props) {
  const cls = variant === 'secondary' ? styles.key : styles.btn;
  return <button className={cls} {...rest}>{children}{shortcut && <span className={styles.kk}>{shortcut}</span>}</button>;
}
```

- [ ] **Step 4: `index.ts`** re-export

```ts
export * from './Button.js';
export * from './api.js';
export * from './socket.js';
export * from './store.js';
export * from './types.js';
```
(Imports in front-end TS use bundler resolution; `.js` specifiers are fine via Vite. Match whichever the studio tsconfig accepts — if `Bundler` resolution rejects `.js`, drop the extension here; verify with the studio build in Task 7.)

- [ ] **Step 5: Commit**
```bash
git add frontend/shared/src
git commit -m "feat(phase6): Atelier design system — tokens, fonts, Button"
```

---

### Task 3: API client, socket client, types, store seam

**Files:** Create `frontend/shared/src/{api.ts,socket.ts,types.ts,store.ts}`.

- [ ] **Step 1: `types.ts`** — mirror the server contracts used by the board.

```ts
export interface Status { ok: boolean; version?: string; [k: string]: unknown; }
export interface BookSummary {
  slug: string; title: string; phase: string; status?: 'ok'|'readonly'|'quarantined';
  pulledFrom?: { author?: { name: string }; voice?: { name: string }; genre?: { name: string } | null; pipeline?: { name: string } };
}
export interface Costs { daily: number; monthly: number; overBudget: boolean; dailyLimit: number; monthlyLimit: number; }
```

- [ ] **Step 2: `api.ts`** — token-aware fetch; base URL configurable (chat app targets `:3847`).

```ts
declare global { interface Window { __BOOKCLAW_TOKEN__?: string; __BOOKCLAW_API_BASE__?: string; } }
const token = () => (typeof window !== 'undefined' && window.__BOOKCLAW_TOKEN__) || '';
const base  = () => (typeof window !== 'undefined' && window.__BOOKCLAW_API_BASE__) || '';
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(base() + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}), ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.status === 204 ? (undefined as T) : res.json();
}
```

- [ ] **Step 3: `socket.ts`** — Socket.IO client passing the handshake token.

```ts
import { io, Socket } from 'socket.io-client';
let s: Socket | null = null;
export function socket(): Socket {
  if (s) return s;
  const base = (typeof window !== 'undefined' && window.__BOOKCLAW_API_BASE__) || undefined;
  const token = (typeof window !== 'undefined' && window.__BOOKCLAW_TOKEN__) || '';
  s = io(base, { auth: { token }, transports: ['websocket', 'polling'] });
  return s;
}
```

- [ ] **Step 4: `store.ts`** — Zustand store + the active-book seam (the forward-compat boundary).

```ts
import { create } from 'zustand';
import { api } from './api.js';
import type { BookSummary, Status } from './types.js';
interface S {
  status?: Status; books: BookSummary[]; activeSlug?: string;
  loadStatus: () => Promise<void>; loadBooks: () => Promise<void>;
}
export const useStore = create<S>((set) => ({
  books: [],
  loadStatus: async () => set({ status: await api<Status>('/api/status') }),
  // single source today; Phase 8 swaps to per-context binding behind this seam
  loadBooks: async () => {
    const r = await api<{ books: BookSummary[] }>('/api/books');
    const a = await api<{ slug?: string }>('/api/books/active').catch(() => ({ slug: undefined }));
    set({ books: r.books ?? [], activeSlug: a.slug });
  },
}));
// the seam every component uses — never a module global:
export const useBooks = () => useStore((s) => s.books);
export const useActiveBook = () => useStore((s) => s.books.find((b) => b.slug === s.activeSlug));
```

- [ ] **Step 5: Commit**
```bash
git add frontend/shared/src
git commit -m "feat(phase6): shared api/socket clients, contract types, store seam"
```

---

### Task 4: Studio app shell (rail + router) with token bootstrap

**Files:** Create `frontend/studio/index.html`, `frontend/studio/src/{main.tsx,App.tsx,Rail.tsx,App.module.css}`.

- [ ] **Step 1: `index.html`** — the token bootstrap is the only inline script (preserves the existing injection mechanism).

```html
<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>BookClaw · Studio</title>
<script>window.__BOOKCLAW_TOKEN__='__BOOKCLAW_AUTH_TOKEN__';</script>
</head><body><div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body></html>
```

- [ ] **Step 2: `main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import '@bookclaw/shared/src/tokens.css';
import '@bookclaw/shared/src/fonts.js';
import { App } from './App.js';
import { Board } from './routes/Board.js';
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <Routes><Route element={<App />}><Route index element={<Board />} /></Route></Routes>
  </BrowserRouter>
);
```

- [ ] **Step 3: `App.tsx`** — shell grid (rail + outlet); port `.app`/`.main`/`.topbar` from the concept into `App.module.css`.

```tsx
import { Outlet } from 'react-router-dom';
import { Rail } from './Rail.js';
import styles from './App.module.css';
export function App() {
  return <div className={styles.app}><Rail /><main className={styles.main}><Outlet /></main></div>;
}
```

- [ ] **Step 4: `Rail.tsx`** — port the nav markup from `phase6-studio-shell.html` (brand, Studio/Make/Approvals groups, the live/spend footer). Nav items are `<NavLink>`s; the Chat item is an external `<a target="_blank">` to the chat origin (placeholder `#` until 6i).

- [ ] **Step 5: Commit**
```bash
git add frontend/studio/src frontend/studio/index.html
git commit -m "feat(phase6): studio app shell — rail, router, token bootstrap"
```

---

### Task 5: Minimal Book Board over the real API

**Files:** Create `frontend/studio/src/routes/{Board.tsx,Board.module.css}`.

- [ ] **Step 1: `Board.tsx`** — load books + status from the store; render the card grid (port `.grid`/`.card`/`.phase`/`.prog` CSS from the concept; data is real).

```tsx
import { useEffect } from 'react';
import { useStore, useBooks } from '@bookclaw/shared';
import styles from './Board.module.css';
export function Board() {
  const books = useBooks();
  const load = useStore((s) => s.loadBooks);
  useEffect(() => { load(); }, [load]);
  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Books, <em>in flight</em></h1>
      <div className={styles.grid}>
        {books.map((b) => (
          <article key={b.slug} className={styles.card}>
            <span className={styles.phase}>{b.phase}</span>
            <h3>{b.title}</h3>
            <div className={styles.byline}>{b.pulledFrom?.author?.name} · {b.pulledFrom?.voice?.name}</div>
          </article>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**
```bash
git add frontend/studio/src/routes
git commit -m "feat(phase6): minimal Book Board reading /api/books"
```

---

### Task 6: Serve the studio behind `BOOKCLAW_UI=v6` (old dashboard stays default)

**Files:** Modify `gateway/src/paths.ts`, `gateway/src/init/phase-11-http.ts`, `docker/Dockerfile`, `.env.example`.

- [ ] **Step 1: Add the studio dist path** in `gateway/src/paths.ts` (next to the existing dashboard path), e.g. `export const STUDIO_DIST = join(ROOT_DIR, 'frontend/studio/dist');`.

- [ ] **Step 2: Make the serve handler flag-selectable** in `phase-11-http.ts`. Keep the exact token-injection `replaceAll`; choose the dir/file by env:

```ts
const useV6 = process.env.BOOKCLAW_UI === 'v6';
const uiDir = useV6 ? STUDIO_DIST : dashboardPath;
const uiHtml = join(uiDir, 'index.html');
const serveDashboard = async (_req: any, res: any) => {
  try {
    const html = await fs.readFile(uiHtml, 'utf-8');
    res.type('html').send(html.replaceAll('__BOOKCLAW_AUTH_TOKEN__', gw.authToken ?? ''));
  } catch { if (!res.headersSent) res.status(500).json({ status: 'error', message: 'dashboard HTML not found.' }); }
};
gw.app.get('/', serveDashboard);
gw.app.use(express.static(uiDir, { index: false }));   // serves Vite /assets/* when v6
```
(SPA deep-link fallback isn't needed in 6a — the board is the only route; add a catch-all `GET *` → index.html when more routes land in 6c.)

- [ ] **Step 3: Build the studio in Docker.** In `docker/Dockerfile` builder stage, after `npm ci`, add `RUN npm run build:frontend` (keep `node dashboard/build.mjs` for now); ensure `COPY --from=builder /app/frontend ./frontend` in the runtime stage.

- [ ] **Step 4: Document env** in `.env.example`: `BOOKCLAW_UI` (`v6` to opt into the new front-end; default = legacy dashboard) and `BOOKCLAW_CHAT_PORT` (default 3848; used from 6i).

- [ ] **Step 5: Build + commit the studio dist** (friction-free dev/tests, mirroring `dashboard/dist`).

Run: `npm run -w frontend/studio build`
Expected: `frontend/studio/dist/index.html` (contains `__BOOKCLAW_AUTH_TOKEN__`) + `frontend/studio/dist/assets/*`.
```bash
git add gateway/src/paths.ts gateway/src/init/phase-11-http.ts docker/Dockerfile .env.example frontend/studio/dist
git commit -m "feat(phase6): serve studio behind BOOKCLAW_UI=v6; docker builds frontend"
```

---

### Task 7: Tests + verification

**Files:** Create `tests/unit/studio-build.test.ts`.

- [ ] **Step 1: Write the build-artifact test**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const dist = join(process.cwd(), 'frontend/studio/dist');
test('studio dist exists and carries the token placeholder', () => {
  const html = readFileSync(join(dist, 'index.html'), 'utf-8');
  assert.ok(html.includes('__BOOKCLAW_AUTH_TOKEN__'), 'token placeholder must survive the build');
  assert.match(html, /<script type="module"[^>]*src="\/assets\//, 'hashed module entry referenced');
});
```

- [ ] **Step 2: Run it**

Run: `node --import tsx --test tests/unit/studio-build.test.ts`
Expected: PASS.

- [ ] **Step 3: Server type-check + full suite (old dashboard still default → smoke unchanged)**

Run: `npx tsc --noEmit` → clean.
Run: `npm test` → unit (incl. the new test) + api + smoke green. The smoke "dashboard `/` serves with token injected" still hits the legacy dashboard (no `BOOKCLAW_UI`).

- [ ] **Step 4: Manual v6 check (documented, not automated in 6a)**

Run: `BOOKCLAW_UI=v6 BOOKCLAW_AUTH_TOKEN=test npm start`, then
`curl -s localhost:3847/ | grep -c 'test'` (token injected; placeholder gone) and load `/` in a browser — board lists real books, no CSP violations in console, Socket.IO connects.

- [ ] **Step 5: Commit**
```bash
git add tests/unit/studio-build.test.ts
git commit -m "test(phase6): assert studio build carries token + module entry"
```

**6a done when:** `npm test` green with the legacy dashboard unchanged; `BOOKCLAW_UI=v6` serves the React studio with the token injected, tight CSP, a working websocket, and a board populated from `/api/books`.

---

## 6b–6i — task outlines (each expands into its own dated plan when started)

> These are intentionally outlines, not literal steps: a multi-screen React rewrite written as fully-literal code up front would be speculative. Expand each into `docs/superpowers/plans/2026-…-phase6<x>-<name>.md` at start, using the matching concept file as the concrete CSS/markup source.

- **6b — Studio store + API/socket layer + Activity.**
  - Files: `frontend/shared/src/store.ts` (extend: costs, activity, confirmations), `frontend/shared/src/activity.ts` (SSE `EventSource` over `/api/activity/stream`), `frontend/studio/src/routes/Activity.{tsx,module.css}`, SPA catch-all route fallback in `phase-11-http.ts`.
  - Produces: live Activity feed (concept: `phase6-studio-shell.html` Activity view) reading `/api/activity` + SSE; typed client over all board/costs/confirmation endpoints.
  - Verify: feed renders real entries; new ones arrive over SSE; `tsc`/build clean; `npm test` green.

- **6c — Book Board + detail drawer (full).**
  - Files: `frontend/studio/src/routes/Board.tsx` (filters, ember glow, "needs you" badge), `frontend/studio/src/components/BookDrawer.tsx` (assets grid + per-asset descriptions + canonical tooltips + pipeline timeline).
  - Produces: the full board + drawer (concept: `phase6-studio-shell.html`), New-Book entry navigates to `/new-book`.
  - Verify: drawer opens per book from `/api/books/:slug`; descriptions shown; parity with legacy `home`+`books` list/open.

- **6d — Write workspace.**
  - Files: `frontend/studio/src/routes/Write.tsx` (`/write/:bookId`), `components/{Outline,ChatThread,PipelineRail}.tsx`; reuse `socket()` for chat; per-step model via `POST /api/projects/:id/steps/:stepId/model`.
  - Produces: outline + chat + pipeline rail (concept: `phase6-studio-shell.html` Write); subsumes legacy `projects` + `chat`.
  - Verify: a chat round-trip over Socket.IO; a step model override persists; chapter list from `/api/books/:slug` data.

- **6e — Backend: per-asset `description` + suggested-next-step (TDD).**
  - Files: `gateway/src/services/library{,-types}.ts` (sidecar `meta.json` read/write; `description` on author/voice/genre/section), `gateway/src/api/routes/library.routes.ts` + `books.routes.ts` (accept/persist description), `gateway/src/services/book.ts` (snapshot the sidecar), new `GET /api/books/active/next` + `/api/books/:slug/next` in `books.routes.ts`; tests `tests/unit/{library-description,book-next}.test.ts` + api assertions.
  - Produces: descriptions persisted + returned by `GET /api/library`; next-step endpoint derived from phase + `data/` contents.
  - Verify: unit tests for sidecar round-trip + next-step logic; `feature-smoke.sh` description + next-step assertions; `tsc` clean.

- **6f — Asset Studio.**
  - Files: `frontend/studio/src/routes/AssetStudio.tsx` + `components/{KindRail,EntryList,PipelineEditor,ProseEditor,RepullPanel,ScopeToggle}.tsx`.
  - Produces: two-scope editor + pipeline step editor + prose markdown editor + per-asset description (consuming 6e) + re-pull (concept: `asset-studio.html`); subsumes legacy `authoring` + `library`.
  - Verify: scope toggle drives library-overlay vs active-book-snapshot writes (`library.routes.ts`, `books.routes.ts`); re-pull status/execute over the Phase 4 API; parity checklist for the authoring panel.

- **6g — New-Book picker.**
  - Files: `frontend/studio/src/routes/NewBook.tsx` + `components/{OptionCard,SnapshotSummary}.tsx`.
  - Produces: asset selection + live summary → `POST /api/books` (concept: `new-book.html`).
  - Verify: create round-trips; book appears on the board; includes/toggles map to the create payload.

- **6h — Insights/HQ + Settings + Confirmations.**
  - Files: `frontend/studio/src/routes/{Insights,Settings,Confirmations}.tsx`.
  - Produces: spend (`/api/costs`) + stats (`heartbeat.routes.ts`) + research; providers/keys/vault/preferences (`settings.routes.ts`); the gate queue (`/api/confirmations` + approve/reject). Closes parity for `insights`/`hq`/`idle-tasks`/`settings`.
  - Verify: per-panel parity checklist; settings writes persist; a confirmation can be approved/rejected.

- **6i — Standalone Chat app + cutover.**
  - Files: `frontend/chat/**` (Vite SPA from `chat-app.html`: book switcher + bottom-left stats + "what you've made" + Suggested-next-step consuming 6e + Help bubble; `window.__BOOKCLAW_API_BASE__` = gateway origin); `gateway/src/init/phase-11-http.ts` or a new `phase-12-chat-http.ts` (second listener on `BOOKCLAW_CHAT_PORT`, token-injected serve, chat-specific CSP with `connectSrc` incl. gateway origin); `gateway/src/index.ts` (add chat origin to CORS allowlist when `BOOKCLAW_CHAT_PORT` set); cross-links (studio Rail → chat origin, chat → studio); **cutover** — flip `BOOKCLAW_UI` default to v6 (or remove the flag), repoint Docker, delete `dashboard/`, `package.json` `build:frontend` requires both workspaces.
  - Produces: the separate-port simple chat (concept: `chat-app.html`); the full multi-app studio.
  - Verify: chat on `:3848` reaches the API only with its origin allowlisted + a valid token (blocked without either); studio websocket + CSP intact; **parity checklist signed off**; `npm test` green; Mercury deploy serves studio `:3847` + chat `:3848` healthy.

---

## Self-review (6a)

- **Spec coverage:** 6a implements spec decisions 1–5 + 9 (stack, workspaces, self-host fonts, token model, CSP, incremental cutover) and the store seam (decision 7). Decisions 6 (second port), 8/10 (API-first/description) land in 6e/6i — outlined.
- **Placeholder scan:** CSS "port from concept X" references concrete in-repo artifacts (not placeholders); all code steps show code; commands have expected output.
- **Type consistency:** `BookSummary`/`Status`/`Costs` in `types.ts` are used consistently by `store.ts` and `Board.tsx`; the `useBooks`/`useActiveBook` names match between `store.ts` and `Board.tsx`.
