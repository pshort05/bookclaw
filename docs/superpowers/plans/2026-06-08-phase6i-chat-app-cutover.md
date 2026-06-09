# Phase 6i — Standalone Chat app (2nd port) + cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the lightweight, conversational **Chat app** as a standalone Vite SPA (`frontend/chat`) served on a **second port** (`BOOKCLAW_CHAT_PORT`, default 3848), calling the gateway API/socket cross-origin — with a book switcher, chat thread, suggested-next-step, book stats, and a help bubble. Wire the cutover: build both front-ends, expose the chat port in Docker, set the CORS/CSP perimeter for the cross-origin chat, and cross-link studio↔chat. **EXPLICITLY OUT OF SCOPE for this plan: deleting the legacy `dashboard/`** — it stays as the dormant fallback (v6 has had no human browser verification yet); the final `rm` is a separate, owner-confirmed step.

**Architecture:** A **second `http.Server`** (own minimal Express app) serves ONLY the chat dist with per-request injection of `__BOOKCLAW_AUTH_TOKEN__` and `__BOOKCLAW_API_BASE__` (derived from the request `Host` header → `http://<host>:<gatewayPort>`), and a **chat-specific CSP** whose `connectSrc` includes the gateway http+ws origin. The chat SPA's `api()`/`socket()` (6a, already `__BOOKCLAW_API_BASE__`-aware) target the gateway (3847) cross-origin. The gateway's existing **bearer-token gate is the real security boundary**; CORS is widened minimally to permit the chat origin.

**Tech Stack:** Node/TS (a new `gateway/src/init/phase-12-chat-http.ts`, edits to `index.ts` CORS), React 18 + Vite (new `frontend/chat` workspace, reusing `@bookclaw/shared`). Docker/compose/Dockerfile/.env edits.

**Spec:** concept `dashboard/concept/chat-app.html` (CSS/markup source of truth); 6i outline in `docs/superpowers/plans/2026-06-07-phase6-frontend-rewrite.md`.

---

## Conventions (read once)

- **No git commits during execution** — working tree only; maintainer pushes via `./push.sh`. Review checkpoint per task. On `main`.
- **Verify:** `npx tsc --noEmit` clean; `npm run build:frontend` builds BOTH studio + chat; `node --import tsx --test tests/unit/*.test.ts` 120/120 (+ any new unit test). FE behavior is manual.
- **Surgical; match existing style.** Port CSS verbatim from `chat-app.html` (`.app`/`.left`/`.center`/`.right`, `.book`, `.thread`/`.msg`/`.av`/`.bubble`, `.composer`/`.cbox`/`.suggest`/`.send`/`.qc`, `.stats`/`.stat`/`.pbar`, `.right`/`.asset`, `.helpbtn`/`.help`). Reuse `@bookclaw/shared` (`api`, `socket`/`subscribeChat`/`sendChat`, store, `hhmm`).
- **DO NOT delete `dashboard/`** or change the `BOOKCLAW_UI` default (v6 is already default from 6b). Legacy stays reachable via `BOOKCLAW_UI=legacy`.
- **SECURITY (cross-origin — do not loosen further):**
  - CORS: when `BOOKCLAW_CHAT_PORT` is set, auto-add `http://localhost:<chatPort>` + `http://127.0.0.1:<chatPort>` to the allowlist; LAN origins come from operator-set `BOOKCLAW_CORS_ORIGINS`. **Never** add a wildcard. The bearer token remains the real gate.
  - The chat CSP must be tight: `default-src 'self'`, `script-src 'self' 'unsafe-inline'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`, `font-src 'self'`, `connect-src 'self' http://<gatewayHost>:<gatewayPort> ws://<gatewayHost>:<gatewayPort>` (derived per-request from Host). No remote origins.
  - Token injection mirrors the studio: the placeholder is replaced at serve time; the token is never in a static file.

---

## Backend contracts / facts (confirmed)

- `index.ts`: single `http.Server` on `server.port` (3847) bound `BOOKCLAW_BIND`; Socket.IO on it; global helmet CSP (`connectSrc 'self'`); `corsOptions` from `BOOKCLAW_CORS_ORIGINS`; bearer gate on `/api/*` (+ `?token=` fallback); Socket.IO handshake auth.
- `frontend/shared/src/{api,socket}.ts`: already read `window.__BOOKCLAW_API_BASE__` + `window.__BOOKCLAW_TOKEN__` (6a) — the chat SPA just sets them via injection.
- Chat data: `socket()` chat (`message`→`response`), `GET /api/books` + `POST /api/books/active`, `GET /api/books/active` / `GET /api/books/:slug` (+ descriptions, 6e), `GET /api/books/active/next` (6e), `GET /api/costs`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `package.json` | `build:frontend` builds studio + chat | Modify |
| `frontend/chat/{package.json,vite.config.ts,tsconfig.json,index.html}` | chat SPA scaffold (mirror studio) | Create |
| `frontend/chat/src/{main.tsx,App.tsx,App.module.css}` | shell (3-col layout) | Create |
| `frontend/chat/src/components/{BookSwitcher,ChatPane,Stats,Suggest,MadeList,HelpBubble}.tsx` | the panels | Create |
| `gateway/src/init/phase-12-chat-http.ts` | 2nd http.Server: serve chat dist + token/API_BASE injection + chat CSP | Create |
| `gateway/src/index.ts` | start the chat listener; widen CORS for the chat origin | Modify |
| `gateway/src/paths.ts` | `CHAT_DIST` path constant | Modify |
| `.env.example` | document `BOOKCLAW_CHAT_PORT` + CORS for chat | Modify |
| `docker/docker-compose.yml` | expose 3848 + pass `BOOKCLAW_CHAT_PORT`/`BOOKCLAW_CORS_ORIGINS` | Modify |
| `docker/Dockerfile` | copy `frontend/chat/dist` | Modify |
| `frontend/studio/src/Rail.tsx` | "Chat" nav → external link to the chat origin | Modify |
| `tests/unit/chat-build.test.ts` | assert chat dist carries the token + API_BASE placeholders | Create |

---

### Task 1: Chat workspace scaffold + build wiring

**Files:** Modify `package.json`; Create `frontend/chat/{package.json,vite.config.ts,tsconfig.json,index.html}`.

- [ ] **Step 1:** `package.json` — `"build:frontend": "npm run -w frontend/studio build && npm run -w frontend/chat build"`.

- [ ] **Step 2:** Create `frontend/chat/package.json` mirroring `frontend/studio/package.json` (name `@bookclaw/chat`, deps: `@bookclaw/shared`, react, react-dom; devDeps: vite, @vitejs/plugin-react, typescript, @types/react*). Scripts `dev`/`build` (`tsc -b && vite build`). Run `npm install`.

- [ ] **Step 3:** `frontend/chat/vite.config.ts` — copy studio's (`plugins: [react()]`, `base: '/'`, `build: { outDir: 'dist', emptyOutDir: true }`). `tsconfig.json` — copy studio's (include `src` + `../shared/src`).

- [ ] **Step 4:** `frontend/chat/index.html` — the SPA shell with BOTH placeholders (token + API base):
```html
<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>BookClaw · Chat</title>
<script>window.__BOOKCLAW_TOKEN__='__BOOKCLAW_AUTH_TOKEN__';window.__BOOKCLAW_API_BASE__='__BOOKCLAW_API_BASE__';</script>
</head><body><div id="root"></div>
<script type="module" src="/src/main.tsx"></script>
</body></html>
```

- [ ] **Step 5:** Run `npm install`; `npm run -w frontend/chat build` — fails only because `src/` is empty (created next). `npx tsc --noEmit` clean. Commit-free checkpoint.

---

### Task 2: Chat shell + Book switcher + Chat pane

**Files:** Create `frontend/chat/src/{main.tsx,App.tsx,App.module.css}`, `components/{BookSwitcher,ChatPane}.tsx`.

- [ ] **Step 1:** Port the `:root` tokens + base/grain/scrollbar from `chat-app.html` into `App.module.css` (or a `tokens.css` import — reuse `@bookclaw/shared`'s `tokens.css` since the values match; prefer importing `'@bookclaw/shared/src/tokens.css'` + `'@bookclaw/shared/src/fonts.js'` in `main.tsx` to avoid duplicating tokens). Port the layout/component classes (`.app`/`.left`/`.center`/`.right`, `.book`, `.thread`/`.msg`/`.av`/`.bubble`, `.composer`/`.cbox`/`.send`/`.qc`/`.suggest`, `.stats`/`.stat`/`.pbar`, `.asset`, `.helpbtn`/`.help`) into `App.module.css`.

- [ ] **Step 2:** `main.tsx` — React root (no router needed; single screen):
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import '@bookclaw/shared/src/tokens.css';
import '@bookclaw/shared/src/fonts.js';
import { App } from './App.js';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 3:** `App.tsx` — the 3-col shell: `<BookSwitcher>`+`<Stats>` (left), `<ChatPane>` (center), `<MadeList>` (right), `<HelpBubble>` (fixed). Loads books + active on mount (store `loadBooks`). Cross-link to the studio: a "Studio" link/button in the left brand area → the studio origin (derive from API base: `apiBase()` is the gateway 3847; the studio is the same host on 3847 → link to `apiBase() || '/'`).

- [ ] **Step 4:** `BookSwitcher.tsx` — `useBooks()` + `useActiveBook()`; render `.book` rows (cover `.cv`, `.t` title, `.s` phase, `.d` byline). Click → `POST /api/books/active {slug}` → `loadBooks()`. A "Start a new book" `.newbtn` → opens the studio's `/new-book` (external link to `apiBase()+'/new-book'`) since creation lives in the studio.

- [ ] **Step 5:** `ChatPane.tsx` — reuse `subscribeChat`/`sendChat` (shared, cross-origin to the gateway socket). Thread of `.msg`/`.av`(`.ai`/`.me`)/`.bubble`; composer `.cbox` with `.send` (Enter to send, disabled while waiting or empty); thinking indicator; quick chips `.qc` (e.g. "write the next chapter", "make a cover") that fill/send the composer. Same single-response model as 6d (no streaming).

- [ ] **Step 6: Verify** — `npx tsc --noEmit` clean; `npm run -w frontend/chat build` succeeds.

- [ ] **Step 7: Review checkpoint** — chat uses the shared socket (cross-origin), book switch sets active, no streaming faked.

---

### Task 3: Stats + Suggested-next + Made-list + Help

**Files:** Create `frontend/chat/src/components/{Stats,Suggest,MadeList,HelpBubble}.tsx`.

- [ ] **Step 1:** `Stats.tsx` (bottom-left) — active book title + a few real stats: phase (from the active book), today's spend (`useCosts`), and the next-step phase. (No chapter/word counts — no endpoint; show phase + spend honestly, omit fabricated word counts.) Port `.stats`/`.stitle`/`.stat`/`.k`/`.v`/`.pbar`.

- [ ] **Step 2:** `Suggest.tsx` (above the composer) — `GET /api/books/active/next` (6e) → `.suggest` block (`.lb` icon, `.k` "Suggested next step", `.m` = `next.hint`/`next.label`). A "Do it" button sends `next.label` as a chat message (calls a passed `onSend`). Refetch when the active book changes.

- [ ] **Step 3:** `MadeList.tsx` (right) — "What you've made". Honest scope: with no per-book files endpoint yet, show the book's **assets** from `GET /api/books/:slug` (author/voice/genre/pipeline names + 6e descriptions) as `.asset` rows (what the book is built from), and the **pipeline plan** steps as a checklist (from `GET /api/books/active/templates/pipeline`). Mark "needs the `GET /api/books/:slug/files` endpoint for real outputs" in a comment. Do NOT fabricate chapter/output rows.

- [ ] **Step 4:** `HelpBubble.tsx` — fixed `.helpbtn` toggling a `.help` panel with static context tips (port the markup; the tips can reference the current phase). Close on outside click (a `useEffect` document listener with cleanup).

- [ ] **Step 5: Verify** — `tsc` clean; chat build succeeds.

- [ ] **Step 6: Review checkpoint** — stats/made-list show only real data (no fake word counts/outputs); next-step "Do it" sends the real suggestion.

---

### Task 4: Backend — 2nd http.Server (serve chat) + CORS widening

**Files:** Create `gateway/src/init/phase-12-chat-http.ts`; Modify `gateway/src/index.ts`, `gateway/src/paths.ts`.

- [ ] **Step 1:** `paths.ts` — add `export const CHAT_DIST = join(ROOT_DIR, 'frontend/chat/dist');`.

- [ ] **Step 2:** `phase-12-chat-http.ts` — when `BOOKCLAW_CHAT_PORT` is set, create a SECOND minimal Express app + `http.Server` that serves the chat dist with per-request injection + a tight chat CSP, and listens on the chat port (same `BOOKCLAW_BIND`):
```ts
import express from 'express';
import { createServer } from 'http';
import { join } from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { CHAT_DIST } from '../paths.js';
import type { BookClawGateway } from '../index.js';

/** Phase 12: optional standalone Chat SPA on BOOKCLAW_CHAT_PORT (cross-origin to the gateway). */
export async function initChatHttp(gw: BookClawGateway): Promise<void> {
  const chatPort = Number(process.env.BOOKCLAW_CHAT_PORT || 0);
  if (!chatPort) { console.log('  ℹ Chat app: disabled (set BOOKCLAW_CHAT_PORT to enable)'); return; }

  const gatewayPort = gw.config.get('server.port', 3847);
  const indexHtml = join(CHAT_DIST, 'index.html');
  if (!existsSync(indexHtml)) {
    console.log(`  ⚠ Chat app: dist not found at ${indexHtml} — run \`npm run -w frontend/chat build\`.`);
  }

  const chatApp = express();

  // Per-request: derive the gateway origin from the Host the browser used, set a
  // chat-specific CSP that allows calling the gateway (http + ws), and serve the
  // SPA index with the token + API base injected. Static assets are same-origin.
  const serveIndex = async (req: express.Request, res: express.Response) => {
    const host = String(req.headers.host || `localhost:${chatPort}`).replace(/:\d+$/, '');
    const gatewayOrigin = `http://${host}:${gatewayPort}`;
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      `connect-src 'self' ${gatewayOrigin} ws://${host}:${gatewayPort}`,
    ].join('; '));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const html = await fs.readFile(indexHtml, 'utf-8');
      res.type('html').send(
        html
          .replaceAll('__BOOKCLAW_AUTH_TOKEN__', gw.authToken ?? '')
          .replaceAll('__BOOKCLAW_API_BASE__', gatewayOrigin),
      );
    } catch { if (!res.headersSent) res.status(500).send('Chat UI not built'); }
  };

  chatApp.get('/', serveIndex);
  chatApp.use(express.static(CHAT_DIST, { index: false }));
  chatApp.get('*', (req, res) => {           // SPA fallback (no API on this server)
    if (/\.[a-zA-Z0-9]+$/.test(req.path)) return res.status(404).send('Not found');
    serveIndex(req, res);
  });

  const chatServer = createServer(chatApp);
  await new Promise<void>((resolve) => chatServer.listen(chatPort, process.env.BOOKCLAW_BIND || '0.0.0.0', resolve));
  gw.chatServer = chatServer;                 // hold a ref (add the field to the class)
  console.log(`  ✓ Chat app: serving on :${chatPort} (API → :${gatewayPort})`);
}
```

- [ ] **Step 3:** `index.ts` — (a) add a `public chatServer?: ReturnType<typeof createServer>` field; (b) call `await initChatHttp(this)` near the end of `start()` (after the main `listen`); (c) **widen CORS**: when `BOOKCLAW_CHAT_PORT` is set, push `http://localhost:<chatPort>` and `http://127.0.0.1:<chatPort>` into `corsAllowlist` BEFORE building `corsOptions` (so dev works without config); operator-set `BOOKCLAW_CORS_ORIGINS` still adds LAN origins. Update `this.corsSummary` to mention the chat origin(s). **Do not add a wildcard.**

- [ ] **Step 4: Type-check** — `npx tsc --noEmit` clean.

- [ ] **Step 5: Review checkpoint** — the chat server is optional (no-op without the env), serves only static + injects token/API base, sets a tight chat CSP; CORS gains only explicit localhost + operator origins; the bearer gate is unchanged (the real boundary).

---

### Task 5: Config / env / Docker

**Files:** Modify `.env.example`, `docker/docker-compose.yml`, `docker/Dockerfile`.

- [ ] **Step 1:** `.env.example` — document `BOOKCLAW_CHAT_PORT=3848` (enables the chat app) and that `BOOKCLAW_CORS_ORIGINS` must include the chat origin for LAN access (e.g. `http://192.168.1.32:3848`).

- [ ] **Step 2:** `docker/docker-compose.yml` — add `- "3848:3848"` to `ports`; add to `environment`: `- BOOKCLAW_CHAT_PORT=${BOOKCLAW_CHAT_PORT:-}` and `- BOOKCLAW_CORS_ORIGINS=${BOOKCLAW_CORS_ORIGINS:-}`.

- [ ] **Step 3:** `docker/Dockerfile` — after the existing studio dist copy, add `COPY --from=builder /app/frontend/chat/dist ./frontend/chat/dist` (the builder already runs `npm run build:frontend`, now building both).

- [ ] **Step 4:** (Deploy-time, the maintainer/operator step — note in the plan, do not edit secrets here): the Mercury repo `.env` should set `BOOKCLAW_CHAT_PORT=3848` and `BOOKCLAW_CORS_ORIGINS=http://192.168.1.32:3848` so the chat app is reachable + allowed on the LAN. (build-watch sources repo `.env` → compose interpolation.)

- [ ] **Step 5: Verify** — `docker compose config` (or a yaml lint) parses; `npm run build:frontend` builds both dists.

- [ ] **Step 6: Review checkpoint** — port exposed, env plumbed, dist copied; no secret written into the repo by this task.

---

### Task 6: Cross-links + build test + verification

**Files:** Modify `frontend/studio/src/Rail.tsx`; Create `tests/unit/chat-build.test.ts`.

- [ ] **Step 1:** `Rail.tsx` — the "Chat" nav item: make it an external `<a target="_blank" rel="noopener">` whose href points to the chat origin. Derive it: same host as the studio, port from a global the studio knows? The studio doesn't know the chat port. Simplest: link to `:3848` on the current host — `href={\`\${location.protocol}//\${location.hostname}:3848/\`}` (the default chat port). Keep the existing external-link icon. (If `BOOKCLAW_CHAT_PORT` differs, this is a known limitation — note it.)

- [ ] **Step 2:** `tests/unit/chat-build.test.ts` — mirror `studio-build.test.ts`: assert `frontend/chat/dist/index.html` exists, contains `__BOOKCLAW_AUTH_TOKEN__` AND `__BOOKCLAW_API_BASE__` placeholders + a hashed module entry. (Run only meaningfully after a build; the test reads the committed/just-built dist — guard or skip gracefully if absent, matching studio-build's approach.)

- [ ] **Step 3: Build + suite** — `npm run build:frontend` (both); `npx tsc --noEmit` clean; `node --import tsx --test tests/unit/*.test.ts` → all pass (incl. chat-build).

- [ ] **Step 4: Manual** — `BOOKCLAW_AUTH_TOKEN=test BOOKCLAW_CHAT_PORT=3848 npm start`:
  - `http://localhost:3848/` serves the chat app (token + API base injected; check the page source has `localhost:3847` as the API base and the real token).
  - Book switcher lists books; clicking sets active.
  - Chat: send a message → assistant reply over the cross-origin socket (Network/WS tab shows the connection to `:3847`, no CORS error). Suggested-next-step renders; "Do it" sends it.
  - No CSP violations in the console (the chat CSP allows `:3847` http+ws).
  - Studio Rail "Chat" opens `:3848` in a new tab.
  - `BOOKCLAW_UI` default unchanged; the legacy dashboard still reachable via `BOOKCLAW_UI=legacy` (NOT deleted).

- [ ] **Step 5: Review checkpoint** — cross-origin chat works under a tight CSP + minimal CORS; the studio↔chat cross-links work; **`dashboard/` is untouched**; the build produces both dists.

---

## Self-Review (6i)

- **Spec coverage:** standalone Chat SPA on a 2nd port (book switcher, chat, suggested-next-step, stats, made-list, help bubble) cross-origin to the gateway; CORS widened minimally + a tight chat CSP; build/Docker/env wiring for both front-ends; studio↔chat cross-links. **Deliberately deferred (stated up front): the `rm dashboard/` cutover step** (owner-confirmed separately); and the rich "what you've made" outputs list (needs a `GET /api/books/:slug/files` endpoint — shows book assets + plan instead, no fabricated outputs).
- **Placeholder scan:** the backend listener + CSP + injection are literal; chat endpoints/socket are confirmed; CSS ports reference `chat-app.html` with named classes.
- **Type consistency:** the chat SPA reuses `@bookclaw/shared` (`api`/`socket`/`subscribeChat`/`sendChat`/store/`hhmm`); the new `gw.chatServer` field + `initChatHttp(gw)` signature match `index.ts`.
- **Security:** cross-origin is gated by the unchanged bearer token (the real boundary); CORS gains only explicit localhost + operator-configured origins (no wildcard); the chat CSP is tight (`connect-src` limited to the gateway http+ws origin); the token is injected at serve time, never static. The legacy fallback is preserved.
