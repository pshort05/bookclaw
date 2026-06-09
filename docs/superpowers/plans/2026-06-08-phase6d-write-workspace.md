# Phase 6d — Write workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the studio's **Write workspace** at `/write` — a 3-pane view (outline · chat · pipeline rail) over the **active book**: real Socket.IO chat to steer the draft, the book's pipeline plan + context on the right with generation controls (start/execute/pause/resume + per-step model override), and the book's generated files as an outline on the left. Makes the Board drawer's "Open in Write" button real.

**Architecture:** A React route operating on the **active book** (generation binds to the single global active-book pointer — Phase 3; per-context binding is Phase 8). On entry, `/write` ensures the target book is active. Chat uses the existing shared `socket()` (6a) — emit `message {content}`, receive a single `response {content}` (the server does NOT stream chat; show a thinking indicator, then the full reply). Generation uses the projects REST API with **client-side polling** of `GET /api/projects/:id` (no server push for step progress). Book context/descriptions reuse 6e; the pipeline plan comes from `GET /api/books/active/templates/pipeline`.

**Tech Stack:** React 18 + Vite + Router + Zustand + `@bookclaw/shared` (`socket()`, `api`, `useActiveBook`). No new deps.

**Spec:** concept `dashboard/concept/phase6-studio-shell.html` (Write view — CSS/markup source of truth); 6d outline in `docs/superpowers/plans/2026-06-07-phase6-frontend-rewrite.md`.

---

## Conventions (read once)

- **No git commits during execution** — working tree only; maintainer pushes via `./push.sh`. Review checkpoint per task. On `main`.
- **No FE test runner** → verify via `npx tsc --noEmit` + `npm run -w frontend/studio build` + manual. (No backend change in this plan → unit suite stays at 120/120.)
- **Surgical; match existing style.** Port CSS **verbatim** from the concept Write view (`.writer`, `.wcol`/`.wleft`/`.wmid`/`.wright`, `.wtitle`/`.wsub`/`.sec`, `.chap`(+`.done`/`.cur`)/`.num`/`.tk`, `.thread`/`.msg`/`.av`(+`.ai`/`.me`)/`.mbody`/`.who`/`.mtext`(+`.dimmed`), `.composer`/`.cbox`/`.crow`/`.icobtn`/`.send`, `.binfo`/`.bi`(+`.l`/`.r`/`.adesc`), `.step`(+`.done`/`.cur`/`.queued`)/`.stem`/`.nub`/`.ln`/`.sbody`/`.sname`/`.smeta`(+`.model`/`.skill`), `@keyframes blink`/`pulse`). Tokens already in `tokens.css`.
- **Forward-compat:** read the active book only via the store's `useActiveBook()` seam + the active-book API. The Write route operates on whatever book it activated.
- **Honest scope (deferred + labeled in-UI):** chat is **not streamed** (single `response` event) — show a thinking indicator, not a fake token caret; the concept's live-draft "excerpt with streaming caret" is rendered as a completed step-output card (no fake streaming). Projects are **not book-bound** (Phase 8) — the Write view shows the active book's pipeline plan + any **active** generation project, associated loosely. No new backend.

---

## Backend contracts (confirmed; use exactly)

- **Chat (Socket.IO):** `socket()` from `@bookclaw/shared` (auth handshake token). Emit `socket.emit('message', { content })`; listen `socket.on('response', ({ content }) => …)` and `socket.on('error', ({ message }) => …)`. Single response per message (no streaming). Channel is server-side `webchat`.
- **Active book:** `GET /api/books/active` → `{ active: { slug, book, status } | null }`; `POST /api/books/active { slug }`. `GET /api/books/:slug` → `{ book, status, descriptions }` (6e). `GET /api/books/active/templates/pipeline` → `{ content: <raw JSON string>, wired }` (parse for the plan's steps).
- **Projects:** `GET /api/projects/list?status=active` → `{ projects: [{ id, title, type, status, progress, steps: [{ id, label, status, phase, skill?, chapterNumber?, wordCountTarget?, modelOverride? }], … }] }`. `GET /api/projects/:id` → one project (same shape). `GET /api/projects/:id/files` → `{ files: [{ name, size, type }] }`. `GET /api/projects/:id/download/:filename` → raw content. `POST /api/projects/:id/{start,execute,auto-execute,pause,resume}` (empty body). `POST /api/projects/:id/steps/:stepId/model { provider, model? }`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `frontend/shared/src/chat.ts` | thin chat-socket helper (subscribe + send) | Create |
| `frontend/shared/src/index.ts` | re-export `chat.js` | Modify |
| `frontend/studio/src/routes/Write.tsx` | `/write` route: ensure active book + 3-pane shell | Create |
| `frontend/studio/src/routes/Write.module.css` | ported Write-view CSS | Create |
| `frontend/studio/src/components/write/ChatThread.tsx` | socket chat thread + composer | Create |
| `frontend/studio/src/components/write/OutlinePane.tsx` | active book's files (outline) | Create |
| `frontend/studio/src/components/write/PipelineRail.tsx` | book context + pipeline plan + project controls | Create |
| `frontend/studio/src/main.tsx` | add `/write` + `/write/:slug` routes | Modify |
| `frontend/studio/src/Rail.tsx` | Write nav → `/write` | Modify |
| `frontend/studio/src/components/BookDrawer.tsx` | enable "Open in Write" → activate + navigate `/write` | Modify |

---

### Task 1: Chat socket helper

**Files:** Create `frontend/shared/src/chat.ts`; Modify `frontend/shared/src/index.ts`.

- [ ] **Step 1: `chat.ts`** — wrap the shared `socket()` for chat: subscribe to assistant replies/errors and expose a send. (Persistent listeners, not one-shot promises, so it's robust to ordering.)
```ts
import { socket } from './socket.js';

export interface ChatHandlers { onReply: (text: string) => void; onError: (msg: string) => void; }

/** Subscribe to chat events; returns an unsubscribe fn. */
export function subscribeChat({ onReply, onError }: ChatHandlers): () => void {
  const s = socket();
  const reply = (p: { content?: string }) => onReply(p?.content ?? '');
  const err = (p: { message?: string }) => onError(p?.message ?? 'error');
  s.on('response', reply);
  s.on('error', err);
  return () => { s.off('response', reply); s.off('error', err); };
}

/** Send a chat message (server replies via the 'response' event). */
export function sendChat(content: string): void {
  socket().emit('message', { content });
}
```

- [ ] **Step 2:** add `export * from './chat.js';` to `frontend/shared/src/index.ts`.

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean; `npm run -w frontend/studio build` succeeds.

- [ ] **Step 4: Review checkpoint** — listeners are removable; no streaming assumed.

---

### Task 2: ChatThread component

**Files:** Create `frontend/studio/src/components/write/ChatThread.tsx`.

- [ ] **Step 1:** Port the `.thread`/`.msg`/`.av`/`.mbody`/`.who`/`.mtext`/`.composer`/`.cbox`/`.crow`/`.send` CSS verbatim into `Write.module.css` (Task 5). Component:
```tsx
import { useEffect, useRef, useState } from 'react';
import { subscribeChat, sendChat } from '@bookclaw/shared';
import styles from '../../routes/Write.module.css';

interface Msg { who: 'me' | 'ai'; text: string; t: string }

export function ChatThread() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [waiting, setWaiting] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeChat({
    onReply: (text) => { setMsgs((m) => [...m, { who: 'ai', text, t: clock() }]); setWaiting(false); },
    onError: (msg) => { setMsgs((m) => [...m, { who: 'ai', text: `⚠ ${msg}`, t: clock() }]); setWaiting(false); },
  }), []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, waiting]);

  const send = () => {
    const text = draft.trim();
    if (!text || waiting) return;
    setMsgs((m) => [...m, { who: 'me', text, t: clock() }]);
    setDraft(''); setWaiting(true);
    sendChat(text);
  };

  return (
    <div className={styles.wmid}>
      <div className={styles.thread}>
        {msgs.map((m, i) => (
          <div key={i} className={styles.msg}>
            <div className={`${styles.av} ${m.who === 'ai' ? styles.ai : styles.me}`}>{m.who === 'ai' ? 'BC' : 'P'}</div>
            <div className={styles.mbody}>
              <div className={styles.who}>{m.who === 'ai' ? 'BookClaw' : 'You'} · {m.t}</div>
              <div className={styles.mtext}>{m.text}</div>
            </div>
          </div>
        ))}
        {waiting && <div className={styles.msg}><div className={`${styles.av} ${styles.ai}`}>BC</div><div className={styles.mbody}><div className={styles.who}>BookClaw</div><div className={`${styles.mtext} ${styles.dimmed}`}>Thinking…</div></div></div>}
        {msgs.length === 0 && !waiting && <p className={styles.dimmed} style={{ textAlign: 'center' }}>Steer the draft, or ask for the next chapter.</p>}
        <div ref={endRef} />
      </div>
      <div className={styles.composer}>
        <div className={styles.cbox}>
          <textarea
            className={styles.cinput}
            value={draft}
            placeholder="Steer the draft, or ask for the next chapter…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={2}
          />
          <div className={styles.crow}>
            <button className={styles.send} onClick={send} disabled={waiting} title="Send (Enter)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
function clock() { const d = new Date(); return isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5); }
```
(Add a `.cinput` rule to `Write.module.css`: transparent bg, no border, `var(--text)`, full width, resize:none, inherits font — so the textarea sits inside `.cbox`.)

- [ ] **Step 2: Verify** — builds after Task 5's CSS lands; `tsc` clean.

- [ ] **Step 3: Review checkpoint** — subscribe cleans up on unmount; Enter sends, Shift+Enter newline; thinking indicator clears on reply/error.

---

### Task 3: OutlinePane component

**Files:** Create `frontend/studio/src/components/write/OutlinePane.tsx`.

- [ ] **Step 1:** Props `{ projectId?: string }`. If a projectId is given, `GET /api/projects/:id/files` → list `.md` files as `.chap` rows (strip the `<projectId>-` prefix + `.md` for the label; manuscript files labelled plainly). Clicking a file fetches `GET /api/projects/:id/download/:filename` and shows it (a simple read-only `<pre>`/markdown block below, or emits to a parent — keep it self-contained: a local `selected` + a small reader panel). If no project, render the book's pipeline-plan step labels as a static outline (passed via props from the rail's parsed pipeline, or show "No outputs yet — start the pipeline from the right."). Port `.wleft`/`.wtitle`/`.wsub`/`.sec`/`.chap`/`.num`/`.tk` CSS.

```tsx
import { useEffect, useState } from 'react';
import { api } from '@bookclaw/shared';
import styles from '../../routes/Write.module.css';

export function OutlinePane({ title, subtitle, projectId }: { title: string; subtitle?: string; projectId?: string }) {
  const [files, setFiles] = useState<{ name: string }[]>([]);
  useEffect(() => {
    if (!projectId) { setFiles([]); return; }
    let cancelled = false;
    api<{ files: { name: string }[] }>(`/api/projects/${encodeURIComponent(projectId)}/files`)
      .then((r) => { if (!cancelled) setFiles((r.files ?? []).filter((f) => f.name.endsWith('.md'))); })
      .catch(() => { if (!cancelled) setFiles([]); });
    return () => { cancelled = true; };
  }, [projectId]);

  const label = (name: string) => name.replace(/^[^-]+-/, '').replace(/\.md$/, '').replace(/-/g, ' ');

  return (
    <div className={`${styles.wcol} ${styles.wleft}`}>
      <div className={styles.wtitle}>{title}</div>
      {subtitle && <div className={styles.wsub}>{subtitle}</div>}
      <div className={styles.sec}>Outline{files.length ? ` · ${files.length} files` : ''}</div>
      {files.length === 0 ? (
        <p className={styles.dimmed}>No outputs yet. Start the pipeline from the right.</p>
      ) : files.map((f, i) => (
        <div key={f.name} className={styles.chap}><span className={styles.num}>{String(i + 1).padStart(2, '0')}</span>{label(f.name)}</div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify** — `tsc` clean after CSS lands.

- [ ] **Step 3: Review checkpoint** — fetch cancellation; graceful no-project state; honest "files" not fake chapter counts.

---

### Task 4: PipelineRail component (book context + plan + generation controls)

**Files:** Create `frontend/studio/src/components/write/PipelineRail.tsx`.

- [ ] **Step 1:** Props `{ slug: string; activeProject?: Project; onProjectChange: (p?: Project) => void }`. Renders:
  - **Book context** (`.binfo`/`.bi`): from `GET /api/books/:slug` → manifest `pulledFrom` names + `descriptions` (6e) for author/voice/genre/pipeline (label `.l` with a `title=` canonical tooltip, value `.r`, `.adesc` description).
  - **Pipeline plan** (`.sec` "Pipeline · <name>" + `.step` rows): parse `GET /api/books/active/templates/pipeline` `content` → steps; render each as a `.step` with `.nub`/`.ln`/`.sname`/`.smeta` (skill in `.skill`). If an `activeProject` exists, map its `steps[].status` onto the rows (`done`/`cur`/queued) and show the per-step model (`.model`) + a model-override control on the current step.
  - **Generation controls:** if no active project for this book, a "Start pipeline" button (`POST /api/projects` create — REUSE the existing create path the legacy uses, i.e. `POST /api/pipeline/create` with the book's config, OR `POST /api/projects/:id/start` if a project exists). If an active project exists: Execute next step (`POST /api/projects/:id/execute`), Auto-run (`POST /api/projects/:id/auto-execute`), Pause/Resume. After any action, poll `GET /api/projects/:id` every ~3s while `status==='active'` and call `onProjectChange` so the outline + rail update; stop polling when not active or on unmount.
  - **Per-step model override:** on the current step, a small select (provider) → `POST /api/projects/:id/steps/:stepId/model { provider }` (empty clears). Keep minimal: provider only (model field optional, omit for now).

> Scope note (in a comment): true streaming progress isn't available — we poll. Project↔book association is loose (Phase 8); this rail shows the active book's plan + the most-recent active project.

- [ ] **Step 2:** Add a shared `Project`/`ProjectStep` type to `frontend/shared/src/types.ts` mirroring the projects API shape used here (id, title, status, progress, steps[{id,label,status,phase?,skill?,modelOverride?}]).

- [ ] **Step 3: Verify** — `tsc` clean; build succeeds.

- [ ] **Step 4: Review checkpoint** — polling stops on unmount + when inactive (no leak); controls call the real endpoints; model override sends `{provider}`; honest about no-streaming.

---

### Task 5: Write route + CSS + shell

**Files:** Create `frontend/studio/src/routes/Write.tsx`, `frontend/studio/src/routes/Write.module.css`.

- [ ] **Step 1: Port the Write-view CSS** verbatim into `Write.module.css` (all classes listed in Conventions, + `.cinput`).

- [ ] **Step 2: `Write.tsx`** — route for `/write` and `/write/:slug`. On mount: resolve the target slug (route param OR the current active book via the store). If a `:slug` param is given and differs from the active book, `POST /api/books/active { slug }` then refresh the store (`loadBooks`). If no book resolvable, render a centered "No active book — open one from the Board" with a link to `/`. Otherwise fetch `GET /api/books/:slug` for the title/subtitle, find the active project (`GET /api/projects/list?status=active` → first, if any), and render the 3-pane `.writer` grid: `<OutlinePane>` | `<ChatThread/>` | `<PipelineRail>`. Pass `activeProject` down + an `onProjectChange` setter so polling updates flow to OutlinePane (project files) + the rail.

```tsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, useStore, useActiveBook, type BookManifest } from '@bookclaw/shared';
import { OutlinePane } from '../components/write/OutlinePane.js';
import { ChatThread } from '../components/write/ChatThread.js';
import { PipelineRail } from '../components/write/PipelineRail.js';
import styles from './Write.module.css';

export function Write() {
  const { slug: paramSlug } = useParams();
  const active = useActiveBook();
  const loadBooks = useStore((s) => s.loadBooks);
  const [book, setBook] = useState<BookManifest | null>(null);
  const [project, setProject] = useState<any | undefined>(undefined);
  const slug = paramSlug || active?.slug;

  useEffect(() => {
    let cancelled = false;
    if (!slug) return;
    (async () => {
      if (paramSlug && paramSlug !== active?.slug) {
        await api('/api/books/active', { method: 'POST', body: JSON.stringify({ slug: paramSlug }) }).catch(() => {});
        await loadBooks().catch(() => {});
      }
      const d = await api<{ book: BookManifest }>(`/api/books/${encodeURIComponent(slug)}`).catch(() => null);
      if (!cancelled && d) setBook(d.book);
      const pl = await api<{ projects: any[] }>('/api/projects/list?status=active').catch(() => ({ projects: [] }));
      if (!cancelled) setProject(pl.projects?.[0]);
    })();
    return () => { cancelled = true; };
  }, [slug, paramSlug, active?.slug, loadBooks]);

  if (!slug) return <div className={styles.empty}>No active book. <Link to="/">Open one from the Board.</Link></div>;

  return (
    <div className={styles.writer}>
      <OutlinePane title={book?.title ?? slug} subtitle={book?.pulledFrom?.genre?.name ?? undefined} projectId={project?.id} />
      <ChatThread />
      <PipelineRail slug={slug} activeProject={project} onProjectChange={setProject} />
    </div>
  );
}
```

- [ ] **Step 3: Verify** — `tsc` clean; `npm run -w frontend/studio build` succeeds.

- [ ] **Step 4: Review checkpoint** — `/write/:slug` activates that book; no-active-book path is graceful; panes wired.

---

### Task 6: Router + Rail + drawer wiring + verification

**Files:** Modify `frontend/studio/src/main.tsx`, `frontend/studio/src/Rail.tsx`, `frontend/studio/src/components/BookDrawer.tsx`.

- [ ] **Step 1: Routes.** `main.tsx`: `import { Write }` + `<Route path="write" element={<Write />} />` and `<Route path="write/:slug" element={<Write />} />`.

- [ ] **Step 2: Rail.** Convert the inert Write `<a href="#">` to `<NavLink to="/write">` (keep the icon + the generating-dot if present; mirror the active-class pattern).

- [ ] **Step 3: Drawer.** In `BookDrawer.tsx`, enable the "Open in Write" button: `onClick={() => { onClose(); navigate(\`/write/${slug}\`); }}` (import `useNavigate`); remove the `disabled`/`title="…6d"`. (It already activates via the route.)

- [ ] **Step 4: Build + type-check** — `npm run build:frontend`; `npx tsc --noEmit` clean; `node --import tsx --test tests/unit/*.test.ts` still 120/120.

- [ ] **Step 5: Manual** — `BOOKCLAW_AUTH_TOKEN=test npm start`:
  - Rail → Write (or Board → a book → drawer → Open in Write). The `:slug` variant activates that book.
  - Right rail shows book context (author/voice/genre/pipeline + descriptions) + the pipeline plan steps.
  - Chat: type a message → it appears as "You", a "Thinking…" indicator shows, then the assistant reply renders (Socket.IO round-trip; confirm in the Network/WS tab). No CSP errors.
  - If an active generation project exists, its step statuses map onto the rail + its files list in the outline; Execute/Pause/Resume + a per-step model override call the real endpoints; polling updates the panes.
  - No active book → the graceful empty state.

- [ ] **Step 6: Review checkpoint** — chat works over the socket; generation controls hit real endpoints; "Open in Write" is now live; nothing fabricates streaming or book-bound projects.

---

## Self-Review (6d)

- **Spec coverage:** the Write workspace — outline (book files) · Socket.IO chat · pipeline rail (book context + plan + generation controls incl. per-step model override + start/execute/auto-execute/pause/resume). Makes "Open in Write" real. **Deferred + labeled:** real token streaming (server sends one `response` — we show a thinking indicator + poll generation); per-project book binding (Phase 8 — the view operates on the active book + the active project, associated loosely). No backend change.
- **Placeholder scan:** chat/projects/book endpoints + the socket events are literal from confirmed contracts; CSS ports reference the concrete concept Write view with named classes.
- **Type consistency:** the `subscribeChat`/`sendChat` signatures match `ChatThread`; `Project`/`ProjectStep` (Task 4) match the projects API used by the rail + Write route; `useActiveBook`/active-book API used for activation.
- **Honesty:** no fake streaming caret on chat; generation progress via polling; the rail states the project↔book association is loose pending Phase 8.
