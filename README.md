# BookClaw

**The open-source, self-hosted AI writing *studio* for the prolific author.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)
[![Security](https://img.shields.io/badge/security-hardened-green.svg)](#security)

> **BookClaw is a fork of [AuthorClaw](https://github.com/Ckokoski/authorclaw) by Christopher Kokoski (Writing Secrets)** — with deep thanks for the foundation it builds on. AuthorClaw is itself a fork of OpenClaw. See [Acknowledgements](#acknowledgements).

BookClaw is a self-hosted, security-hardened AI writing studio for authors who run **more than one book at a time**. Most AI writing tools help you draft a single manuscript. BookClaw treats the **book as a first-class object** — so several novels, each under its own pen name, in its own genre, with its own editable production pipeline, can be in flight at once and run themselves from first idea to KDP-ready manuscript.

**Give it an idea and a pen name. It plans, writes, checks its own continuity, revises, formats, and launches** — autonomously, on your hardware, with your keys. A free Google Gemini key (or a local Ollama install) can write a whole book for $0.

---

## Why BookClaw stands out

The 2026 AI-writing field splits into lanes — autocomplete assistants, lore/codex managers, continuity checkers, and publish-and-earn platforms — each strong in one. BookClaw's edge is combining the hardest capabilities into one self-hosted studio and going deeper than the single-lane tools:

- **A multi-author, multi-book studio — not a single-document editor.** Run several books concurrently, each bound to a distinct **author voice + genre + pipeline**. Add another pen name, genre, or workflow as *configuration, not code*. This studio model is structurally absent from single-manuscript tools.
- **The deepest continuity engine in the category.** A per-book **fact ledger**, a **Character Knowledge Matrix** ("who knows what, and when"), dream/flashback **selective exclusion**, red-herring protection, and Sanderson-style **plot-promise** tracking. Continuity tools flag contradictions; BookClaw also enforces *what a character could plausibly know* at each point in the story.
- **The publishing last mile, end to end.** Idea → professionally typeset DOCX/EPUB → covers → blurbs → a 90-day **Launch Orchestrator** (KDP metadata, ARC seeding, AMS ads, BookBub, a release calendar). Every irreversible external action passes through a confirmation gate.
- **A curated craft library at scale.** 190+ genre guides, named editor personas and a debating **Editorial Council**, a dozen story-structure frameworks (Three-Act, Save the Cat, Hero's Journey, Lester Dent, and more), and a manuscript-analysis suite (craft critic, dialogue auditor, pacing heatmap, AI beta-reader panel).
- **A structured World Repository.** A reusable worldbuilding codex per series — relevance-pulled into each book's bible and optionally rendered as reader-facing appendixes.
- **Autonomous, but yours.** Self-hosted on your LAN, API keys sealed in an AES-256 vault, manuscripts that never leave your machine, default-on local backups. Built for a trusted home-LAN, not a hostile internet.
- **A 3-click on-ramp.** The **Easy Button** turns a beginner into a running novel from a Starter Bundle — the full engine, zero configuration — then graduates them into the studio.

> **"It's not just a writing tool. It's a writing partner, research assistant, editor, and marketing team rolled into one."**

For the strategy behind this positioning, see [docs/STRATEGY-LEADING-AI-WRITING-ASSISTANT.md](docs/STRATEGY-LEADING-AI-WRITING-ASSISTANT.md).

---

## What can it do?

- **Run a production line** — several books in flight at once, each its own pen name, genre, and editable pipeline; idea → planning → bible → production → revision → format → launch.
- **Write in many voices** — first-class Author and Voice profiles per book; draft scenes, chapters, and full manuscripts in each pen name's style.
- **Hold the canon** — a World Repository, a fact-ledger consistency auditor, a Character Knowledge Matrix, plot-promise tracking, and cross-book series continuity.
- **Plan the shape** — declare structure × form × chapter-count × words-per-chapter at creation; it drives generation and a per-book Structure & Length review.
- **Critique and revise** — craft critic, dialogue auditor, pacing heatmap, structure check, AI beta-reader panel, named editors, and multi-pass editorial pipelines.
- **Publish** — KDP-ready DOCX (trim sizes, front/back matter) and valid EPUB3, covers, blurbs, and a 90-day launch orchestrator (metadata, ads, BookBub, calendar).
- **Market and research** — blurbs, ad copy, AMS campaigns, a release/price calendar, reader-review intelligence, and allowlisted deep research.
- **Listen** — neural TTS with author-optimized voice presets and audiobook-prep passes (SSML, pronunciation, multi-voice attribution).
- **Drive it from anywhere** — the React studio, a simple Chat app, a Telegram bot, the REST/WebSocket API, or the MCP server (Claude Desktop/Code).
- **Stay safe** — encrypted vault, workspace sandbox, injection detection, confirmation gate, audit log, and default-on backups.

See the **[Feature guides](#feature-guides)** below for an in-depth document on each.

---

## Feature guides

In-depth, end-user documentation for each capability lives in [`docs/features/`](docs/features/):

**Write**
- [Books and pen names](docs/features/books-and-authors.md) — books as first-class containers; Author/Voice profiles; running many books at once.
- [Genres](docs/features/genres.md) — 190+ genre guides snapshotted per book and injected into generation.
- [Pipelines and sequences](docs/features/pipelines-and-sequences.md) — config-not-code production pipelines, per-step model overrides, and the built-in suites.
- [Book format and structure](docs/features/book-format-and-structure.md) — declare structure × form × chapter-count × words-per-chapter; drive generation and the Structure & Length review.
- [The Easy Button](docs/features/easy-button.md) — a 3-click novel from a Starter Bundle.

**Keep the canon**
- [World Repository](docs/features/world-repository.md) — a structured worldbuilding codex, per-book relevance-pull, and appendixes.
- [Continuity and consistency](docs/features/continuity-and-consistency.md) — the fact ledger, Character Knowledge Matrix, selective exclusion, and plot promises.
- [Series](docs/features/series.md) — multi-book continuity, shared refs, and divergence detection.

**Polish**
- [Craft and editorial tools](docs/features/craft-and-editorial.md) — craft critic, dialogue auditor, pacing heatmap, beta readers, editorial council, and the Prompt Runner.

**Publish and grow**
- [Publishing and launch](docs/features/publishing-and-launch.md) — DOCX/EPUB export, covers, blurbs, the launch orchestrator, AMS, BookBub, and the website builder.
- [Audiobook and TTS](docs/features/audiobook-and-tts.md) — neural voice presets and audiobook-prep passes.
- [Research and reader intelligence](docs/features/research-and-reader-intel.md) — allowlisted deep research and review-data analysis.

**Operate**
- [Ways to use BookClaw (the surfaces)](docs/features/surfaces.md) — Studio, Chat app, Telegram, API, and the MCP server.
- [Backups and recovery](docs/features/backups-and-recovery.md) — default-on snapshots, per-book restore, and opt-in cloud push.

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
- **Skills + Projects** — markdown skills injected into a project engine that runs config-driven pipeline sequences (editable named pipelines under `library/`) or AI-planned steps, with per-book containers (a portable `book.json` + template snapshot + outputs) as the data model.

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
├── mcp/                  # Vendored MCP server (own package; exposes the API to MCP clients)
├── scripts/              # setup, deploy, build-watch, security-check
└── workspace/            # Runtime data (gitignored): books, projects, soul, memory, audio, logs
```

---

## Testing

Tests run through Node's built-in `node --test` runner (no third-party test framework) so any check can be re-run:

```bash
npm run test:unit      # node --test (via tsx) over tests/unit/*.test.ts (~400 unit tests; builds the frontend first)
npm run test:api       # bash tests/api/api-test.sh against a running instance
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

**Feature guides** — in-depth, per-feature end-user documentation lives in [`docs/features/`](docs/features/); see the [Feature guides](#feature-guides) section above for the annotated list.

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
- [docs/STRATEGY-LEADING-AI-WRITING-ASSISTANT.md](docs/STRATEGY-LEADING-AI-WRITING-ASSISTANT.md) — Market positioning and the differentiators behind the "Why BookClaw stands out" section.
- [mcp/README.md](mcp/README.md) — The vendored MCP server (exposes BookClaw to MCP clients like Claude Desktop/Code); see [mcp/docs/INSTALL.md](mcp/docs/INSTALL.md) to install it.

**Roadmap, research & history**
- [docs/TODO.md](docs/TODO.md) / [docs/COMPLETED.md](docs/COMPLETED.md) — Tracked work items, and finished items by date.
- [docs/NERDY-NOVELIST-WORKFLOW.md](docs/NERDY-NOVELIST-WORKFLOW.md) — Design for a human-in-the-loop novel mode.
- [docs/OPENCLAW-UPDATES.md](docs/OPENCLAW-UPDATES.md) — Audit of upstream OpenClaw features worth adopting.
- [docs/STORYHACKERAI-PORTING.md](docs/STORYHACKERAI-PORTING.md) — Patterns to port from StoryHackerAI.
- [docs/MATTERMOST-AGENT-CHAT-PLAN.md](docs/MATTERMOST-AGENT-CHAT-PLAN.md) — Plan for a Mattermost chat bridge.
- [docs/BOOKCLAW-FORK-DECISION.md](docs/BOOKCLAW-FORK-DECISION.md) — Why BookClaw forked from AuthorClaw.
- [docs/RENAME-PLAN.md](docs/RENAME-PLAN.md) — Historical record of the AuthorClaw → BookClaw rename.
