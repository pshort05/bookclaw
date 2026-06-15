# BookClaw

**The Autonomous AI Writing Agent — Built for Authors**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)
[![Security](https://img.shields.io/badge/security-hardened-green.svg)](#security)

> **BookClaw is a fork of [AuthorClaw](https://github.com/Ckokoski/authorclaw) by Christopher Kokoski (Writing Secrets)** — with deep thanks for the foundation it builds on. AuthorClaw is itself a fork of OpenClaw. See [Acknowledgements](#acknowledgements).

BookClaw is a security-hardened AI agent purpose-built for fiction and nonfiction authors. It doesn't just write — it runs the entire book production pipeline autonomously, from first idea to KDP-ready manuscript.

**Give it an idea and a pen name. It plans, writes, revises, formats, and launches.** Pipeline mode chains 6 production phases automatically. Author personas manage multiple pen names with distinct voices. Deep revision runs 21 editing passes. Export produces professional DOCX and EPUB ready for self-publishing.

Tell it what you want. It figures out the steps, picks the right skills, and executes.

> **"It's not just a writing tool. It's a writing partner, research assistant, editor, and marketing team rolled into one."**

---

## What Can It Do?

- **Pipeline** — Turn one idea + one pen name into a finished book across 6 automated phases
- **Write** — Draft scenes, chapters, and full manuscripts in your persona's voice
- **Revise** — 21-step deep revision: 3 passes (structural → scene-level → line-level) + AI beta readers
- **Plan** — 6 project templates: Book Planning, Book Bible, Book Production, Deep Revision, Format & Export, Book Launch
- **Personas** — Manage multiple pen names with distinct genres, voices, style markers, and bios
- **Research** — Deep dives into genres, markets, historical periods, craft techniques
- **Beta Read** — AI beta reader panel (romance super-reader, harsh critic, casual reader)
- **Market** — Blurbs, ad copy, Amazon descriptions, keywords, social media launch posts
- **Format** — KDP-ready DOCX (trim sizes, front/back matter) and valid EPUB3 export
- **Manage** — Track projects, pipelines, word counts across pen names
- **Listen** — Neural TTS voice engine with 9 author-optimized presets — hear your writing read aloud

---

## Requirements

- **Node.js 22+** (TypeScript runs directly through `tsx` — no build step in development)
- **An AI provider key** — at minimum a free [Google Gemini](https://aistudio.google.com/apikey) key, or a local [Ollama](https://ollama.com) install for $0 offline use
- **Optional:** Docker + Docker Compose for containerized/LAN deployment; a Telegram bot token for phone control

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/pshort05/bookclaw.git
cd bookclaw
npm install

# 2. Start BookClaw (auto-generates a vault encryption key into .env on first run)
npm start                      # → http://localhost:3847

# 3. Open the studio at http://localhost:3847
#    Settings → add an AI provider key (Gemini's free tier writes a whole book for $0) → Save

# 4. Create a book and start writing — or send /novel to your Telegram bot
```

On first run BookClaw generates a vault key, writes it to `.env`, and creates the `workspace/` data directory. Your API keys (stored in the encrypted vault) persist across restarts.

For a guided, interactive setup, run the wizard:

```bash
npm run setup                  # OS detection, Node/Ollama install, keys, personalization
```

See [docs/QUICKSTART.md](docs/QUICKSTART.md) for the full setup guide and [docs/FIRST-NOVEL-GUIDE.md](docs/FIRST-NOVEL-GUIDE.md) for a step-by-step walkthrough of writing your first novel.

---

## Usage

BookClaw exposes the same agent through several surfaces, all backed by one REST + WebSocket API.

### The Studio (web)

Open `http://localhost:3847` for the React studio: a Book Board of every book in flight, a Write workspace (outline + chat + the production pipeline with per-step model overrides), an Asset Studio for editing authors/voices/genres/pipelines, Insights, Settings, and the Confirmations approval queue.

### The Chat app (web, optional)

A deliberately simple, non-technical chat interface runs on a second port when `BOOKCLAW_CHAT_PORT` is set (e.g. `3848`). It talks to the same gateway API and is ideal for "just write with me" use.

### Telegram

Connect a Telegram bot to drive BookClaw from your phone. Common commands:

| Command | What it does |
|---------|--------------|
| `/novel [idea]` | Create a full novel pipeline (planning → bible → production → revision → format → launch) |
| `/project [task]` | Plan and auto-execute any task — BookClaw decides the steps |
| `/write [idea]` | A quick, short-form writing task |
| `/projects`, `/status` | List projects / check what's running |
| `/stop`, `continue` | Pause / resume the active project |
| `/research [topic]` | Research over allowlisted domains (Wikipedia, Google Books, …) |
| `/files`, `/read [#]`, `/export [#] [fmt]` | List, preview, and export output files |
| `/speak [text or #]`, `/voice [on/off/preset]` | Neural TTS — generate or read aloud |

See [docs/TELEGRAM-SETUP.md](docs/TELEGRAM-SETUP.md) for end-to-end bot setup, LAN access, and multi-user allowlists.

### How autonomous execution works

1. You describe what you want (studio, chat, Telegram, or API).
2. BookClaw plans the steps — the AI decomposes the task, or a pipeline template supplies a fixed sequence.
3. The right **skills** are auto-selected and their content is injected into each step's prompt.
4. Each step runs through the [tiered AI router](#ai-providers); output is saved to the active book.
5. Everything is recorded in a universal, live-tailing activity feed.

New to the vocabulary (Book, Pipeline, Step, Author, Voice, Genre, …)? See the **[Glossary](docs/GLOSSARY.md)**.

---

## AI Providers

BookClaw routes each task to a provider tier automatically — planning and research use free models, creative writing uses mid-tier, and final editing uses premium when a key is available.

| Provider | Tier | Typical cost | Best for |
|----------|------|--------------|----------|
| Ollama | Free | $0 (local) | Private, offline drafting |
| Google Gemini | Free | $0 | General writing, planning |
| DeepSeek | Cheap | ~$0.14/M tokens | Creative writing |
| OpenRouter | Varies | per-model | One key, many models |
| Anthropic Claude | Paid | ~$3/M tokens | Complex reasoning, editing |
| OpenAI | Paid | ~$2.5/M tokens | Alternative premium |

Add keys in the studio's **Settings** (they are stored write-only in the encrypted vault). Task-to-tier mapping lives in `gateway/src/ai/router.ts`.

---

## Skills

Skills are markdown files (`skills/<category>/<name>/SKILL.md`, YAML frontmatter + body) that teach the agent how to handle a specific writing task. They are matched by trigger keywords and injected into the relevant step's prompt. BookClaw ships ~29 author-centric skills across **core**, **author**, **marketing**, and **ops** categories, plus optional purchasable **premium** skills (gitignored). BookClaw can also read a tool's source code and synthesize a new skill from it.

---

## Configuration

Configuration comes from `config/default.json` (versioned), overridden by `config/user.json` (gitignored), with environment variables for runtime/security posture. Key variables:

| Variable | Purpose |
|----------|---------|
| `BOOKCLAW_AUTH_TOKEN` | Bearer token gating `/api/*` + the Socket.IO handshake (auto-generated on first run) |
| `BOOKCLAW_AUTH_DISABLED` | `1` turns auth off (development only; logged loudly) |
| `BOOKCLAW_BIND` | Server bind address (default `0.0.0.0` for LAN; `127.0.0.1` for loopback-only) |
| `BOOKCLAW_CORS_ORIGINS` | Comma-separated browser-origin allowlist (unset = deny all cross-origin) |
| `BOOKCLAW_ALLOWED_IPS` | Optional source-IP/CIDR allowlist in front of auth (loopback always allowed) |
| `BOOKCLAW_CHAT_PORT` | Enables the standalone Chat app on a second port (e.g. `3848`) |
| `BOOKCLAW_VAULT_KEY` | Master key for the credential vault (auto-generated into `.env` if missing) |
| `BOOKCLAW_WORKSPACE_PATH` | Host path bind-mounted as `workspace/` in Docker |

See [docs/SECURITY.md](docs/SECURITY.md) for the full security-posture reference.

---

## Architecture

One Node process runs an Express + Socket.IO server on port `3847`. It serves the React studio, exposes a REST + WebSocket API, optionally bridges to Telegram/Discord, and serves the standalone Chat app on a second port. The agent executes "projects" (multi-step writing pipelines) by chaining tiered AI calls and injecting skill content into each step.

Three concentric layers wrap the work:

- **Security perimeter** — bearer auth, deny-by-default CORS, optional source-IP allowlist, encrypted vault, workspace sandbox, prompt-injection detection, audit logging, and a confirmation gate for irreversible external actions.
- **AI routing** — six providers mapped to free / mid / premium tiers with per-task reasoning and output budgets.
- **Skills + Projects** — markdown skills injected into a project engine that runs hardcoded templates or AI-planned pipelines, with per-book containers (a portable `book.json` + template snapshot + outputs) as the emerging data model.

**For the full design — entry point and init sequence, request/data flow, the three layers in detail, the book-container model, and the on-disk layout — see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).**

---

## Project Structure

```
bookclaw/
├── gateway/src/          # Core application (TypeScript via tsx)
│   ├── index.ts          # Entry point + BookClawGateway class
│   ├── init/             # Numbered init-phase modules (config → … → http + chat)
│   ├── ai/router.ts      # Multi-provider tiered AI routing
│   ├── api/              # routes.ts composition root + per-feature routes/
│   ├── bridges/          # Telegram, Discord
│   ├── security/         # Vault, sandbox, injection detection, audit
│   └── services/         # projects, personas, books, library, memory, soul, …
├── frontend/             # v6 React UI (npm workspaces, built with Vite)
│   ├── shared/           #   shared api/socket/store seam, types
│   ├── studio/           #   the studio served at "/"
│   └── chat/             #   standalone Chat app (own port)
├── dashboard/concept/    # Design source-of-truth mockups (legacy UI retired)
├── skills/               # SKILL.md definitions (core/author/marketing/ops/premium)
├── library/              # Built-in authors/voices/genres/pipelines/sections
├── tests/                # Scripted tests (unit + smoke + feature smoke)
├── config/               # default.json (versioned), .vault/, research allowlist
├── docker/               # Dockerfile + docker-compose.yml
├── scripts/              # setup, deploy, build-watch, security-check
└── workspace/            # Runtime data (gitignored): books, projects, soul, memory, audio, logs
```

---

## Testing

Tests are plain scripts (no test-framework dependency) so any check can be re-run:

```bash
npm run test:unit      # node --test (via tsx) over tests/unit/*.test.ts (+ builds the frontend)
npm run test:smoke     # boots the gateway and asserts the security perimeter (hermetic)
npm test               # unit + api + smoke
npx tsc --noEmit       # type-check only
```

`tests/feature-smoke.sh` exercises the live product surface (library, books, chat, the novel pipeline, the craft suite, compile) against a running instance.

---

## Deployment

- **Local development** — `npm start` (or `npm run dev` for file-watch reload).
- **Docker / LAN** — `npm run docker:up` (uses `docker/docker-compose.yml`); the image binds `0.0.0.0` so the published port is reachable across the LAN, gated by the bearer token.
- **Always-on / remote** — run inside a VM or VPS with Docker, and front it with a VPN (e.g. Tailscale) or a TLS-terminating reverse proxy. BookClaw is built for a trusted single-user home-LAN threat model, **not** direct hostile-internet exposure.

Full operational guidance — ports, environment, start/stop/monitor across local, Docker, and VPS — is in [docs/LAUNCH-GUIDE.md](docs/LAUNCH-GUIDE.md).

---

## Security

BookClaw ships a security perimeter tuned for a single-user home-LAN threat model:

- **Authentication** — bearer token on every `/api/*` route and the Socket.IO handshake.
- **CORS** — cross-origin denied by default; allow specific origins via `BOOKCLAW_CORS_ORIGINS`.
- **Source-IP allowlist** — optional network gate in front of auth (`BOOKCLAW_ALLOWED_IPS`, CIDRs supported).
- **Vault** — AES-256-GCM encrypted credential storage (scrypt KDF); key values are write-only in the UI.
- **Sandbox** — file access is confined to `workspace/`.
- **Injection detection** — inbound messages are scanned for prompt-injection patterns.
- **Confirmation gate** — every irreversible external action (publish, send, submit, upload, purchase) requires explicit approval.
- **Audit logging** — daily JSONL logs under `workspace/.audit/`.

For untrusted networks, front BookClaw with a reverse proxy that enforces TLS. See [docs/SECURITY.md](docs/SECURITY.md) for the complete posture and deployment guidance.

---

## Contributing

Contributions are welcome — new skills, bug fixes, AI providers, bridges, UI improvements, and documentation.

1. Fork the repository and create a feature branch.
2. Make your changes and test locally (`npm test`, `npx tsc --noEmit`).
3. Open a Pull Request with a clear description.

For new skills, add a folder under `skills/author/`, `skills/marketing/`, `skills/ops/`, or `skills/core/` with a `SKILL.md` (YAML frontmatter + markdown body) following the existing format.

---

## Acknowledgements

BookClaw is a fork of **[AuthorClaw](https://github.com/Ckokoski/authorclaw)** by **Christopher Kokoski (Writing Secrets)** — enormous thanks for the foundation: the autonomous pipeline, author personas, skills system, and book-production workflow all originate there. AuthorClaw is itself a fork of **OpenClaw**, whose architecture and features (TTS engine, thinking-budget controls, browser-doctor probe, and more) this project continues to build on. Fork-attribution and "Inspired by OpenClaw …" credits remain throughout the code by design.

---

## License & Disclaimer

MIT License — see [LICENSE](LICENSE).

This software is provided "as is" without warranty of any kind. **Use at your own risk.** BookClaw is an experimental AI writing tool; AI output should always be reviewed by a human before publishing. BookClaw relies on third-party AI providers (Gemini, Claude, OpenAI, DeepSeek, OpenRouter, Ollama), whose usage is subject to their respective terms and pricing. API costs are your responsibility.

---

## Additional Documentation

All supporting documents live in [`docs/`](docs/).

**Getting started**
- [docs/QUICKSTART.md](docs/QUICKSTART.md) — Install and run your first task in minutes.
- [docs/FIRST-NOVEL-GUIDE.md](docs/FIRST-NOVEL-GUIDE.md) — Step-by-step walkthrough of the full novel pipeline.
- [docs/GLOSSARY.md](docs/GLOSSARY.md) — Canonical vocabulary (Book, Pipeline, Step, Author, Voice, Genre, …).
- [docs/HOW-TO-CREATE-GENRE-GUIDES.md](docs/HOW-TO-CREATE-GENRE-GUIDES.md) — Author a genre guide: the seven files, what each contains, and how to add one.
- [docs/HOW-TO-CREATE-AUTHOR-PROFILES.md](docs/HOW-TO-CREATE-AUTHOR-PROFILES.md) — Build an author profile: the author + voice files, what each contains, and how to add one.

**Operations & security**
- [docs/LAUNCH-GUIDE.md](docs/LAUNCH-GUIDE.md) — Start, stop, monitor, and manage across local, Docker, and VPS.
- [docs/TELEGRAM-SETUP.md](docs/TELEGRAM-SETUP.md) — End-to-end Telegram bot setup, LAN access, and multi-user allowlists.
- [docs/SECURITY.md](docs/SECURITY.md) — Vault, sandbox, audit log, network posture, and deployment guidance.

**Architecture & design**
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System architecture: entry point, init sequence, the three layers, and on-disk layout.
- [docs/BOOK-CONTAINER-ARCHITECTURE.md](docs/BOOK-CONTAINER-ARCHITECTURE.md) — The book-as-container data model and its phased roadmap toward a multi-book studio.
- [docs/GOD-CLASS-REFACTOR.md](docs/GOD-CLASS-REFACTOR.md) — The incremental refactor of the former `index.ts` / `routes.ts` god classes.
- [docs/PRODUCT-DIRECTION.md](docs/PRODUCT-DIRECTION.md) — Product vision and the North Star.

**Roadmap, research & history**
- [docs/TODO.md](docs/TODO.md) / [docs/COMPLETED.md](docs/COMPLETED.md) — Tracked work items, and finished items by date.
- [docs/NERDY-NOVELIST-WORKFLOW.md](docs/NERDY-NOVELIST-WORKFLOW.md) — Design for a human-in-the-loop novel mode.
- [docs/OPENCLAW-UPDATES.md](docs/OPENCLAW-UPDATES.md) — Audit of upstream OpenClaw features worth adopting.
- [docs/STORYHACKERAI-PORTING.md](docs/STORYHACKERAI-PORTING.md) — Patterns to port from StoryHackerAI.
- [docs/MATTERMOST-AGENT-CHAT-PLAN.md](docs/MATTERMOST-AGENT-CHAT-PLAN.md) — Plan for a Mattermost chat bridge.
- [docs/BOOKCLAW-FORK-DECISION.md](docs/BOOKCLAW-FORK-DECISION.md) — Why BookClaw forked from AuthorClaw.
- [docs/RENAME-PLAN.md](docs/RENAME-PLAN.md) — Historical record of the AuthorClaw → BookClaw rename.
