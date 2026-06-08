# Phase 6 — Front-end / UI rewrite

**Status:** Approved (concept iteration 2026-06-07; owner reviewed the standalone
HTML concepts under `dashboard/concept/`). Feeds `writing-plans`.

**Goal:** Replace the single self-contained vanilla-JS dashboard bundle with a
component-based **React + Vite** front-end and a **state layer that does not
assume a single global active book**, preserving feature parity, the security
perimeter, and the API contract — establishing the multi-book-capable foundation
that the concurrency (Phase 8) and book-board (Phase 9) phases build on.

**Architecture:** An npm-workspaces `frontend/` tree with three packages —
`shared/` (the "Atelier" design system: tokens, self-hosted fonts, base
components, the auth/API client, the Socket.IO client, the Zustand store
primitives), `studio/` (the full studio dashboard SPA), and `chat/` (the
standalone simple Chat SPA). Both SPAs talk to the **existing** gateway REST +
Socket.IO API; nothing client-side bypasses `/api/*` (API-first). The gateway
serves the studio build at `/` (token injected into a small inline bootstrap, as
today) and serves the chat build on a **second port** so it reads as a separate
application; the chat's origin is added to the CORS allowlist.

**Tech stack:** Node 22 + TypeScript (NodeNext, `.js` import extensions on
server). Front-end: Vite 5, React 18, TypeScript, React Router 6, Zustand
(store), `socket.io-client`, `@fontsource/*` (self-hosted fonts — CSP `'self'`),
optionally `framer-motion` for orchestrated load/hover motion. Server unchanged
in language; small additions in `library.ts`, `book.ts`, and route files.

**Roadmap:** Phase 6 of
[BOOK-CONTAINER-ARCHITECTURE.md](../../BOOK-CONTAINER-ARCHITECTURE.md). Unblocks
Phase 7 (genre wiring), 8 (multi-book concurrency), 9 (book-board UI), 10
(per-channel active book).

**Visual reference (built, owner-approved):** the concepts in
`dashboard/concept/` — `phase6-studio-shell.html` (Book Board · Write · Activity
· detail drawer · cross-links · letterpress/keyed buttons), `chat-app.html`
(standalone simple Chat), `asset-studio.html` (two-scope editor + re-pull +
canonical defs + per-asset descriptions), `new-book.html` (asset-selection
picker), `button-options.html` (button reference). These are the source of truth
for layout, the Atelier aesthetic, and copy; they are throwaway HTML, not code to
port verbatim.

---

## Background / current state (verified 2026-06-07)

- **Build:** `dashboard/build.mjs` esbuild-bundles `dashboard/src/main.js` (IIFE)
  and inlines `styles.css` into `dashboard/src/index.html` (`/*__JS__*/`,
  `/*__CSS__*/`), guarding the `__BOOKCLAW_AUTH_TOKEN__` placeholder survives →
  `dashboard/dist/index.html` (committed). `npm run build:dashboard`
  (`package.json`).
- **Serve + token injection:** `gateway/src/init/phase-11-http.ts:30-42` —
  `GET /` reads `dashboard/dist/index.html` and `replaceAll('__BOOKCLAW_AUTH_TOKEN__', gw.authToken ?? '')`;
  `express.static(dashboardPath, { index:false })` serves sibling assets.
- **Auth/CORS/CSP** (`gateway/src/index.ts`): bearer gate on `/api/*`
  (`:373-379`) with header + `?token=` query fallback (`extractToken`, `:99-115`);
  Socket.IO handshake token gate (`:444-449`); CORS allowlist from
  `BOOKCLAW_CORS_ORIGINS` (`:233-258`, deny-by-default, `*` = permissive);
  Helmet CSP (`:261-288`): `scriptSrc`/`styleSrc` `['self','unsafe-inline']`,
  `connectSrc: ['self']`, `upgradeInsecureRequests: null`.
- **Docker** (`docker/Dockerfile`): builder runs `node dashboard/build.mjs`
  (after `tsc`, before `npm prune`); runtime `COPY --from=builder /app/dashboard ./dashboard`.
- **Library model** (`gateway/src/services/library{,-types}.ts`): `LibraryEntry {
  kind, name, source, description? }`; `description` is populated **only for
  pipelines and skills** today. Authors/voices/genres are directories of `.md`;
  sections are single `.md` — **no description metadata**. `GET /api/library`
  returns rows via `list()`; `GET /api/library/:kind/:name` returns
  `LibraryEntryFull` (files/content/pipeline).
- **Book manifest** (`book-types.ts`): `BookManifest.pulledFrom`
  {author, voice?, genre?, pipeline, sections[], skills[]}.
- **Activity log** (`gateway/src/services/activity-log.ts`): per-day JSONL under
  `workspace/.activity/`; read `GET /api/activity?count=&goalId=`
  (`core.routes.ts:160-169`) + SSE `GET /api/activity/stream` (`:172-201`).
- **Costs:** `GET /api/costs` → `{ daily, monthly, overBudget, dailyLimit, monthlyLimit }`.
- **Current panels (parity surface)** `dashboard/src/panels/`: `home`,
  `projects`, `books`, `authoring`, `library`, `chat`, `personas`, `insights`,
  `hq`, `idle-tasks`, `settings`. Libs: `api`, `state`, `ui`, `format`.

---

## Decisions

1. **Stack = React + Vite + TypeScript** (owner choice). Routing: React Router.
   State: **Zustand** (tiny, no boilerplate; the store is the seam that must not
   assume a single active book). Animation: `framer-motion` (optional, for the
   orchestrated load + hover micro-interactions the concepts show). No CSS
   framework — port the Atelier tokens as CSS variables + CSS Modules.

2. **Monorepo via npm workspaces** under `frontend/`:
   - `frontend/shared/` — design system + cross-cutting infra: `tokens.css`
     (the `:root` variables from the concepts), self-hosted fonts (Fraunces /
     IBM Plex Mono / Hanken Grotesk via `@fontsource`), base components
     (`Button` with `letterpress` primary + `keyed` secondary, `SourceBadge`,
     `PhasePill`, `Toggle`, `Drawer`, `CmdK`), the **API client** (token +
     base-URL aware), the **Socket.IO client**, the activity SSE client, and
     shared TS types mirrored from the server contracts.
   - `frontend/studio/` — the full studio SPA (the screens in
     `phase6-studio-shell.html` + `asset-studio.html` + `new-book.html` + the
     parity panels).
   - `frontend/chat/` — the standalone simple Chat SPA (`chat-app.html`).
   - The old `dashboard/` stays until cutover, then is removed.

3. **Self-host fonts** (not the Google Fonts CDN the concepts use). The CSP is
   same-origin (`'self'`); pulling fonts/CSS from `fonts.googleapis.com` would
   require loosening `styleSrc`/`fontSrc`. `@fontsource/*` bundles fonts into the
   Vite build so `fontSrc`/`styleSrc` stay `'self'`. This is a hard requirement,
   not a preference.

4. **Token delivery preserves the current model.** Vite emits an `index.html`
   that loads hashed `/assets/*.js` via `<script type="module" src>`. The gateway
   keeps serving `index.html` at `/` and injects the token into a **small inline
   bootstrap** (`window.__BOOKCLAW_TOKEN__ = '__BOOKCLAW_AUTH_TOKEN__'`), exactly
   the existing `replaceAll` mechanism, just into a different file. `scriptSrc`
   keeps `'unsafe-inline'` (already present) for that one bootstrap; the app
   bundle is `'self'`. The smoke-test assertion "dashboard `/` serves with token
   injected" must stay green against the new HTML. (A CSP **nonce** for the
   bootstrap is a future hardening, out of scope.)

5. **CSP stays tight, with the websocket caveat.** `connectSrc: ['self']` covers
   the same-origin REST + the Socket.IO websocket on the studio (`'self'`
   includes same-origin `ws:`/`wss:`). Keep `scriptSrc`/`styleSrc`
   `['self','unsafe-inline']`, add `fontSrc: ['self']`, `imgSrc: ['self','data:']`
   (React/icon inline `data:` if any). Verify the websocket actually connects
   under CSP during 6a; if a browser rejects same-origin `ws:` under `'self'`,
   add the explicit origin — recorded as a known risk.

6. **Standalone Chat on a second port** (owner choice: "feels like a different
   application"). The gateway starts a **second HTTP listener** on
   `BOOKCLAW_CHAT_PORT` (default `3848`) that serves only the chat SPA's
   token-injected `index.html` + its `/assets`. The chat SPA calls the API on the
   main port (`3847`) — **cross-origin** — so:
   - The chat origin (e.g. `http://<host>:3848`) must be in
     `BOOKCLAW_CORS_ORIGINS` (documented; `deploy.sh`/`.env.example` updated).
   - The chat app's own CSP `connectSrc` must include the **gateway origin**
     (REST + ws), so it is a *different* CSP from the studio's same-origin one.
   - The chat app still presents the bearer token and falls under
     `BOOKCLAW_ALLOWED_IPS`. The confirmation gate still fronts side-effects.
   - **Rejected alternative:** serving chat under `/chat` on `3847` (same-origin,
     no CORS) — simpler, but doesn't meet the "separate app on a different port"
     requirement. Recorded so the tradeoff is conscious.

7. **State layer is per-context, not global-active-book.** The backend keeps its
   single global active-book pointer (`workspace/.config/active-book.json`, Phase
   3) for Phase 6. The front-end store models a **`books` collection + a selected
   `bookId` per view/route** (the Write route, the Asset Studio scope, etc. each
   carry the book id), and components receive `bookId` via route/props/context —
   never a module-global. The active-book API is used as the *current* data
   source behind a thin `useActiveBook()`/`useBook(id)` seam, so Phase 8 swaps
   the source (per-channel/per-project binding) without touching components. This
   is the single most important forward-compatibility constraint.

8. **API-first, no behavior client-side only.** Every action calls an existing
   `/api/*` endpoint (the standing TODO rule). Where the concepts imply data the
   API doesn't yet expose, add the minimal endpoint (below) rather than faking it
   client-side.

9. **Incremental cutover, parity-gated.** Build the new SPA behind a build/serve
   switch; port screens one sub-phase at a time; keep the old dashboard servable
   until the new one reaches parity; only then repoint `/` and delete
   `dashboard/`. Each sub-phase keeps `npm test` (unit + api + smoke) green.

10. **Canonical vocabulary + per-asset descriptions are first-class** (recent
    owner asks). The UI uses `docs/GLOSSARY.md` terms; every asset kind surfaces
    its glossary definition; every asset carries an editable **description**
    shown wherever it is listed. The description requires a small backend model
    change (below).

---

## Components

### Front-end (new)

- **`frontend/shared/`** — `tokens.css` (Atelier `:root`); fonts (`@fontsource`);
  `Button`, `SourceBadge`, `PhasePill`, `Toggle`, `Drawer`, `CmdK`, `Scrim`;
  `apiClient` (reads `window.__BOOKCLAW_TOKEN__`, `Authorization: Bearer`,
  configurable base URL so the chat app can target `:3847`); `socketClient`
  (passes `auth.token`); `activityStream` (EventSource for SSE);
  `createStore` primitives + shared server-contract types.
- **`frontend/studio/`** routes (parity map → concept):
  - `/` **Book Board** (`phase6-studio-shell.html`) — cards, filters, drawer
    (assets + descriptions + canonical tooltips + pipeline timeline), New-Book
    entry. *Subsumes* `home`/`books`.
  - `/write/:bookId` **Write workspace** — outline, chat thread, pipeline rail
    with per-step model. *Subsumes* `projects` + dashboard `chat`.
  - `/activity` **Activity** — live feed from `/api/activity` + SSE. *Net-new
    surface over existing data.*
  - `/library` **Asset Studio** (`asset-studio.html`) — two-scope editor
    (library overlay vs active-book snapshot), pipeline step editor, prose
    markdown editor, per-asset description, re-pull panel. *Subsumes*
    `authoring` + `library` + the books re-pull UI.
  - `/new-book` **New-Book picker** (`new-book.html`) — asset selection + live
    snapshot summary.
  - `/insights` **Insights / HQ** — spend (`/api/costs`), stats
    (`/api/heartbeat/*`), research. *Subsumes* `insights` + `hq` + `idle-tasks`.
  - `/settings` **Settings** — providers/keys/vault/preferences
    (`settings.routes.ts`). *Ports* `settings`.
  - `/confirmations` **Confirmations** — the gate queue
    (`GET /api/confirmations`, approve/reject). *Net-new surface over existing
    data* (badge already in the shell concept).
  - **Authors/personas:** `personas` folds into the Asset Studio **Authors**
    kind (Author = the consolidated persona/soul identity); persona-specific
    actions reuse `personas.routes.ts`.
- **`frontend/chat/`** — single route: the simple Chat (`chat-app.html`) — left
  book switcher + bottom-left stats, centre conversation, right "what you've
  made", context-aware **Suggested next step** + Help bubble.

### Back-end (small additions)

- **Per-asset `description`** for author/voice/genre/section (pipelines/skills
  already have one). Storage: a sidecar `meta.json` (`{ "description": "..." }`)
  in each entry's directory (author/voice/genre) and a sibling
  `<name>.meta.json` for single-file sections; `LibraryService.list()`/`get()`
  read it into `LibraryEntry.description`; the library write API and the
  book-template write API accept/persist it; `BookService.create()` copies the
  sidecar into the snapshot. (Author/voice/genre/section bodies stay freeform
  `.md` — only metadata is added, so no schema-version bump.)
- **Suggested-next-step** endpoint: `GET /api/books/active/next` (and
  `/api/books/:slug/next`) → `{ command, label, reason }`, derived from the
  book's `phase` + which `data/` artifacts exist (e.g. mid-production →
  "write the next chapter"; all chapters present → "make a cover" / "export").
  Pure read; powers the chat Suggested-next-step helper.
- **Second-port chat server**: a small Express listener on `BOOKCLAW_CHAT_PORT`
  (default 3848, `0` disables) serving the chat SPA with token injection + its
  own CSP; the chat origin added to the CORS allowlist when set.
- **Serve repoint + Docker**: `phase-11-http.ts` serves `frontend/studio/dist`;
  Dockerfile builds the workspaces and copies the dist trees.

---

## Security

- **Token:** unchanged model — injected into the served HTML at request time;
  never baked into a hashed bundle. Studio same-origin; chat cross-origin with an
  explicit CORS allowlist entry + the same bearer token.
- **CSP:** studio `connectSrc: ['self']`; chat `connectSrc: ['self', <gateway
  origin>]` (REST + ws). Fonts/styles/scripts stay `'self'`/`'unsafe-inline'`;
  fonts self-hosted. No new external origins.
- **No new auth surface.** All actions go through the existing gated `/api/*` and
  the existing Socket.IO handshake. The confirmation gate continues to front
  every external side-effect, including any triggered from the chat app.
- **Known accepted limitations carried forward** (home-LAN threat model): token
  readable from served HTML; `?token=` query fallback for native GETs. The
  rewrite must not *worsen* these — prefer header auth from the SPA's fetch
  client (the SPA can always send `Authorization`, so the `?token=` fallback is
  only for any remaining native-element GETs, e.g. audio/image `src`).

---

## Out of scope (for Phase 6)

- **Genre wiring into generation** (Phase 7) — genre is shown/edited, not yet
  injected into prompts.
- **Multi-book concurrency / dropping the global active-book pointer** (Phase 8)
  — Phase 6 only makes the *front-end state* ready for it.
- **Book-board richness beyond the concept** (Phase 9) and **per-channel active
  book** (Phase 10).
- **Backup & recovery** (Phase 11).
- **A Playwright e2e suite** — tracked separately; Phase 6 keeps the existing
  shell-script smoke/feature tests as the gate.
- **The full canonical-term UI rename of server/API names** — the UI adopts
  canonical labels; server/route/field renames are not in scope.

---

## Verification

- **Parity:** every current panel's behavior reachable in the new front-end
  (mapped above). A parity checklist is the cutover gate.
- **Tests unchanged, green:** `tests/smoke-test.sh` and `tests/feature-smoke.sh`
  hit the API, not the UI, so they must pass unchanged throughout. The smoke
  "dashboard `/` serves with token injected" assertion must hold for the new
  served HTML (the token placeholder is present pre-serve and replaced at serve
  time).
- **Security perimeter:** after cutover, `GET /` still injects the token; CSP
  headers present and tight; the studio websocket connects under CSP; the chat
  app on `:3848` can reach the API only with its origin allowlisted + a valid
  token (and is blocked without either).
- **Build/Docker:** `npm run build` (workspaces) produces `studio/dist` +
  `chat/dist`; the Docker image serves both; `deploy.sh` to Mercury yields a
  healthy container serving the new studio at `:3847` and the chat at `:3848`.
- **Per sub-phase:** `npx tsc --noEmit` (server) clean; front-end `tsc`/Vite
  build clean; `npm test` green.

---

## Sub-phase breakdown (each gets its own dated plan when started)

Phase 6 is several subsystems; per the writing-plans Scope Check it is split into
sub-phases that each produce working, testable software. **6a is fully detailed
in the companion plan**; 6b–6i are task-outlined there and expanded into their
own `docs/superpowers/plans/` files when reached — mirroring how phases 1–5 were
each specced+planned at start.

- **6a — Foundation: workspaces, design system, serve one React screen with
  token injection + CSP intact.** Stand up `frontend/{shared,studio}`, the
  Atelier `tokens.css` + self-hosted fonts + `Button`, the API/socket clients and
  the Zustand store seam (`useBooks`/`useActiveBook`), and a minimal Studio shell
  that renders the rail + a Book Board reading `/api/status` + `/api/books`. Serve
  `frontend/studio/dist` from the gateway with token injection; update Docker.
  Keep the old dashboard servable behind a flag. **Gate:** smoke green (token
  injected into new HTML), CSP tight, websocket connects, board lists real books.
- **6b — Studio state + API/socket layer + Activity.** Flesh out the store
  (books, costs, activity SSE, confirmations), the typed API client over all
  needed endpoints, and ship the **Activity** route end-to-end.
- **6c — Book Board + detail drawer** (full concept: filters, glow, drawer with
  assets + descriptions + canonical tooltips + pipeline timeline; New-Book entry).
- **6d — Write workspace** (outline, chat thread over Socket.IO, pipeline rail
  with per-step model; subsumes projects + dashboard chat).
- **6e — Backend: per-asset `description` + suggested-next-step endpoint** (the
  two small server additions, TDD, unit + api tests).
- **6f — Asset Studio** (two-scope editor + pipeline step editor + prose markdown
  editor + per-asset description + re-pull, over the Phase 4 API).
- **6g — New-Book picker** (asset selection + live snapshot summary →
  `POST /api/books`).
- **6h — Insights/HQ + Settings + Confirmations** (parity for the remaining
  panels; spend/stats/research; providers/keys/vault/preferences; gate queue).
- **6i — Standalone Chat app (`frontend/chat`) on the second port** + CORS wiring
  + the context-aware Suggested-next-step/Help + cross-links; then **cutover**
  (repoint `/`, delete `dashboard/`, parity checklist sign-off).
