# Ways to Use BookClaw — The Surfaces

## What it is

BookClaw is one gateway process (Express + Socket.IO on port `3847`) that you can reach through several different "surfaces": a full React Studio in the browser, a lightweight standalone Chat app, a Telegram bot on your phone, and a machine-facing REST + WebSocket API with an optional MCP server on top. Every surface drives the same agent, the same workspace, and the same books — they are different doors into one house, not separate products.

## Why it matters

You rarely sit in one place while writing a book. The Studio is where you plan and supervise a pipeline at your desk; Telegram lets you kick off a novel from your phone while you are away; the Chat app is a distraction-free conversation window; and the API/MCP surfaces let other tools (including Claude Desktop or Claude Code) operate BookClaw for you. Because they all share one state, you can start work on one surface and pick it up on another — launch a project from Telegram, then watch it run live in the Studio.

## How to use it

### 1. The React Studio (port 3847)

Open `http://<host>:3847` in a browser. This is the primary workspace. The left rail navigates between these areas:

- **Book Board** (`/`) — the home view. Every book is a card showing its phase and whether it is generating or idle. Start here.
- **Write** (`/write`, or `/write/<slug>` for a specific book) — the core writing workspace, a three-pane layout:
  - **Outline pane** (left) — the book's structure.
  - **Chat thread** (center) — converse with the agent about the current book.
  - **Pipeline rail** (right) — the planning -> bible -> production -> revision -> format -> launch steps. Each step shows its status, and a per-step **model override** dropdown lets you pin a specific AI provider to that one step (saved via `POST /api/projects/:id/steps/:stepId/model`); leave it blank to use the automatic routing.
- **New (Easy)** (`/start`) — the "Easy Button": a short guided wizard that creates a book and its starter bundle in a few clicks, for when you do not want to configure everything by hand. (`/new-book` is the fuller manual create form.)
- **Series** (`/series`) — group books into a series and manage shared worldbuilding and reading order.
- **Activity** (`/activity`) — the live activity feed of what the agent is doing.
- **Library** / Asset Studio (`/library`) — your reusable assets: authors, genres, pipelines, sections, skills, plus generated covers and images.
- **Files** (`/files`) — browse uploaded documents and per-book output files.
- **Prompt Runner** (`/prompt-runner`) — run a single writing-craft prompt against a book file and see the result, cost, and run stats.
- **Consistency** (`/consistency`) — the post-writing consistency auditor (fact-ledger continuity check).
- **Structure & Length** (`/structure-length`) — per-book structure and length review.
- **Insights** (`/insights`) — analytics and reporting across your work.
- **Settings** (`/settings`) — providers and API keys, the Telegram bot token and allowed users, and other configuration.
- **Confirmations** (`/confirmations`) — the approval inbox. Every irreversible external action (publish, send, submit, upload, etc.) waits here for your explicit approval. A badge shows the pending count.

The rail footer shows live generating/idle book counts and today's AI spend against your daily limit.

### 2. The standalone Chat app

A focused, full-window chat surface that runs on its own port, **off by default**. Enable it by setting `BOOKCLAW_CHAT_PORT` (for example `3848`) before starting BookClaw; the Studio rail then shows a **Chat** link that opens it in a new tab. With the port unset, the link is hidden and the app is disabled. The Chat app is a thin client of the same gateway — it talks back to the API on `3847` and respects the same bearer token and source-IP allowlist.

### 3. Telegram (and the Discord stub)

The Telegram bridge turns your phone into a command center. After you wire it up (paste the bot token and your allowed user IDs in **Settings**), message the bot. Key commands:

- `/novel <idea>` — create and auto-run a full novel pipeline.
- `/project <task>` / `/write <idea>` — plan and auto-execute any task.
- `/projects`, `/status`, `/stop` (and "continue"/"next" to resume) — track and control runs.
- `/book`, `/genre` — pin which book and genre this chat writes into.
- `/files`, `/read <# or name>`, `/export <# or name>` — list, preview, and export output files.
- `/research <topic>` — research a topic.
- `/speak <text or #>`, `/voice` — get spoken voice replies.
- `/clean`, `/version`, `/help` — workspace cleanup, version, and the full command list.

The bridge uses long polling, so no inbound port is needed — it works even behind CGNAT. Only user IDs on the allowlist can drive the bot; everyone else is refused. Full walkthrough in [../TELEGRAM-SETUP.md](../TELEGRAM-SETUP.md).

A **Discord bridge is a stub only** — the class exists but Discord.js integration is not wired up, so Discord is not a usable surface today.

### 4. The REST + WebSocket API

Everything the UIs do, they do over the gateway's HTTP API on `3847`, with Socket.IO for live updates. This is the surface for scripts and integrations. All `/api/*` calls require the bearer token:

```bash
curl -H "Authorization: Bearer $BOOKCLAW_AUTH_TOKEN" http://localhost:3847/api/status
curl -H "Authorization: Bearer $BOOKCLAW_AUTH_TOKEN" http://localhost:3847/api/projects/list
```

Native-element GETs may instead pass the token as a `?token=` query parameter. The token is auto-generated into `.env` on first run. Cross-origin requests are denied by default unless you set `BOOKCLAW_CORS_ORIGINS`. See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the route layout and [../SECURITY.md](../SECURITY.md) for the perimeter.

### 5. The MCP server (drive BookClaw from an LLM client)

A vendored Model Context Protocol server (in `mcp/`) exposes BookClaw's author workflow as a curated set of tools to MCP clients such as **Claude Desktop** and **Claude Code**. It is a thin, stateless wrapper over the same REST API — BookClaw stays the single source of truth.

You run the MCP server, point your MCP client at it (HTTP or stdio), and then your client can call tools like `create_book`, `create_project`, `chat`, `compile_project`, and `export_docx`. A generic `bookclaw_request` escape hatch reaches any endpoint, and irreversible actions still route through BookClaw's confirmation gate — the MCP server never auto-approves them. The exposed tool set is configurable via `BOOKCLAW_MCP_PROFILE` (`core` / `author` / `publishing` / `marketing`) when ~100 tools is too many for a client.

Setup and install instructions: [../../mcp/README.md](../../mcp/README.md) and [../../mcp/docs/INSTALL.md](../../mcp/docs/INSTALL.md).

## Under the hood

- Studio routes: `frontend/studio/src/main.tsx` (route table) and `frontend/studio/src/Rail.tsx` (navigation). The Write panes live under `frontend/studio/src/components/write/` (`OutlinePane`, `ChatThread`, `PipelineRail`).
- Chat app server: `gateway/src/init/phase-12-chat-http.ts` (serves the chat dist on `BOOKCLAW_CHAT_PORT`, injects the token, points back at the gateway).
- Telegram bridge: `gateway/src/bridges/telegram.ts`. Discord stub: `gateway/src/bridges/discord.ts`.
- API: `gateway/src/api/routes.ts` plus the per-domain modules under `gateway/src/api/routes/`; wired in `gateway/src/index.ts`.
- MCP server: the `mcp/` subdirectory (a thin client of the API; see its own README).

## Related

- [../ARCHITECTURE.md](../ARCHITECTURE.md) — how the gateway, layers, and services fit together
- [../TELEGRAM-SETUP.md](../TELEGRAM-SETUP.md) — full Telegram + LAN setup
- [../QUICKSTART.md](../QUICKSTART.md) — install and first task
- [../FIRST-NOVEL-GUIDE.md](../FIRST-NOVEL-GUIDE.md) — write your first novel
- [../SECURITY.md](../SECURITY.md) — bearer auth, CORS, source-IP allowlist, confirmation gate
- [../../mcp/README.md](../../mcp/README.md) — the MCP server and its tool catalog
