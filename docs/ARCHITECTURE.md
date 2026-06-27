# BookClaw Architecture

This document describes how BookClaw is structured and how a request flows through it. For installation and usage, see the [README](../README.md). For the forward-looking data model, see [BOOK-CONTAINER-ARCHITECTURE.md](BOOK-CONTAINER-ARCHITECTURE.md); for the in-progress decomposition of the large entry-point classes, see [GOD-CLASS-REFACTOR.md](GOD-CLASS-REFACTOR.md).

## Overview

BookClaw is a single Node.js/TypeScript process. One server:

- runs **Express + Socket.IO** on port `3847`,
- serves the **v6 React studio** (built with Vite) at `/`,
- exposes a **REST + WebSocket API** under `/api/*`,
- optionally serves a standalone **Chat app** on a second port (`BOOKCLAW_CHAT_PORT`),
- optionally bridges to **Telegram** and **Discord**.

TypeScript runs directly through `tsx` in development (no build step); the Docker image compiles to `dist/` with `tsc`. Node 22+ is required, and imports use explicit `.js` extensions (`NodeNext` module resolution). The displayed version (`DISPLAY_VERSION` in `gateway/src/version.ts`) is a CalVer date stamp `V{yy.mm.dd}` set at build/deploy time; `BREAKING_VERSION` is a separate hand-bumped, API-surfaced marker (distinct from the schema-driven version gate).

The agent's core job is to execute **projects** — multi-step writing pipelines (e.g. planning → bible → production → revision → format → launch) — by chaining tiered AI calls and injecting the right **skill** content into each step's prompt. Pipelines are **data-driven** (a book runs an editable named sequence of pipeline definitions, config-not-code), not a hardcoded phase enum.

## Entry Point and Initialization

`gateway/src/index.ts` is the single entry point: a `BookClawGateway` class that owns every service instance and wires them together. Its `initialize()` method is a thin composition root over a numbered sequence of init-phase modules in `gateway/src/init/`:

| Phase | Module | Responsibility |
|-------|--------|----------------|
| 1 | `phase-01-config` | Load config; stamp the workspace schema marker and enforce the boot-time version gate — `classifyWorkspace()` compares the persisted `workspace/.bookclaw/workspace.json` schema version against the build's supported range and refuses to start (fail-closed) on an incompatible workspace, unless `BOOKCLAW_SKIP_VERSION_GATE=1` |
| 2 | `phase-02-security` | Vault, sandbox, injection detector, audit log, permissions, confirmation gate |
| 3 | `phase-03-soul-memory` | Author identity (soul) and memory services |
| 4 | `phase-04-ai` | AI providers and the router |
| 5 | `phase-05-research-skills` | Research gate, skill loader, memory-search index |
| 5b | `phase-05b-editors` | Interactive developmental-editor service (`editor` library kind) |
| 6 | `phase-06-content` | Project engine, personas, library, books |
| 7 | `phase-07-knowledge` | Knowledge/plot-promise services |
| 8 | `phase-08-website` | Website publishing service |
| 9 | `phase-09-export-wave` | Export (DOCX/EPUB) and Wave-3 action services |
| 10 | `phase-10-heartbeat-bridges` | Autonomous heartbeat; Telegram/Discord bridges |
| 11 | `phase-11-http` | API routes, WebSocket, static studio, SPA fallback, ready banner |
| 12 | `phase-12-chat-http` | Second HTTP server for the standalone Chat app (when enabled) |

Each phase is **fail-soft**: when an optional dependency cannot initialize (e.g. `better-sqlite3` for memory search, or `yt-dlp` for video research), startup logs a notice and continues with degraded capability rather than aborting.

**Convention for adding a service:** instantiate it inside the relevant phase, wire dependencies via setter methods (not constructor injection), and pass it to `createAPIRoutes()` if it needs HTTP endpoints.

## Request and Data Flow

```
Channel (studio / chat app / Telegram / API)
        │
        ▼
Source-IP allowlist  →  Bearer auth  →  CORS  →  Injection detection
        │
        ▼
Express route (gateway/src/api/routes/*.routes.ts)  or  Socket.IO handler
        │
        ▼
Service (ProjectEngine / SoulService / BookService / …)
        │
        ▼
AI Router  ──►  provider (Ollama / Gemini / DeepSeek / OpenRouter / Claude / OpenAI)
        │
        ▼
Output written under workspace/  +  universal activity log entry
```

REST routes are assembled in `gateway/src/api/routes.ts` — a thin composition root that mounts per-feature route modules from `gateway/src/api/routes/` (`core`, `projects`, `personas`, `books`, `series`, `library`, `prompts`, `authoring`, `documents`, `export`, `media`, `ops`, `wave`, `knowledge`, `heartbeat`, `settings`, `website`, `backups`), sharing helpers from `_shared.ts`.

## The Three Concentric Layers

### 1. Security perimeter (`gateway/src/security/`)

- **Vault** — AES-256-GCM credential store at `config/.vault/vault.enc`; master key from `BOOKCLAW_VAULT_KEY` (auto-generated into `.env` on first run).
- **SandboxGuard** — enforces that all file access stays under `workspace/`.
- **InjectionDetector** — pattern-matches inbound messages for prompt-injection attempts.
- **AuditLog** — hash-chained daily JSONL logs under `workspace/.audit/`.
- **PermissionManager** — preset-based gating (default "standard").
- **ConfirmationGateService** — a universal approval gate (24h expiry) in front of every irreversible external action (publish, send, submit, upload, bid, purchase). New external-side-effect features must route through it.

The network perimeter sits in front of the application: an optional source-IP allowlist (`BOOKCLAW_ALLOWED_IPS`, with `BOOKCLAW_TRUST_PROXY=1` to read the client IP from `X-Forwarded-For`), then bearer-token auth on `/api/*` and the Socket.IO handshake (auto-generated `BOOKCLAW_AUTH_TOKEN`, `?token=` query fallback for native GETs, `BOOKCLAW_AUTH_DISABLED=1` escape hatch), then deny-by-default CORS (`BOOKCLAW_CORS_ORIGINS`). Per-IP fixed-window rate limiting on `/api/*` (`BOOKCLAW_RATELIMIT_UNAUTH` / `_AUTH` / `_WINDOW_MS`; loopback and allowlisted IPs exempt) sits alongside, and Helmet's `connectSrc` is tightened to `'self'`. The server bind defaults to `0.0.0.0` (`BOOKCLAW_BIND`) so the Docker port is LAN-reachable — set `BOOKCLAW_BIND=127.0.0.1` to restore loopback-only. See [SECURITY.md](SECURITY.md) for the full posture and threat model.

### 2. AI routing (`gateway/src/ai/router.ts`)

Six providers — **Ollama** (free local), **Gemini** (free), **DeepSeek** (cheap), **OpenRouter**, **Claude**, **OpenAI**. Task types map to tiers (`free` / `mid` / `premium`), which map to ordered provider-preference lists. The constants `TASK_TIERS`, `TIER_ROUTING`, `TASK_REASONING`, and `TASK_OUTPUT_BUDGET` at the top of `router.ts` are the source of truth.

- **Output budget matters** — tasks such as `outline`, `book_bible`, and `creative_writing` need large token budgets (≈16K); under-budgeting silently truncates output and breaks downstream pipeline steps.
- **Reasoning effort** (`thinking: low|medium|high`) is translated per provider (Claude thinking budget, Gemini `thinkingConfig`, DeepSeek model swap, OpenAI `reasoning.effort`) and ignored silently where unsupported.

### 3. Skills and Projects (the autonomous loop)

- **Skills** are markdown files at `skills/<category>/<name>/SKILL.md` with YAML frontmatter (`description`, `triggers`, `permissions`). Categories: `core`, `author`, `marketing`, `ops`, `toolkit` (lightweight support roles that flag-don't-fix), `premium` (gitignored). `SkillLoader` parses the frontmatter, stores the full body, and matches skills by trigger-keyword substring. A user overlay lives in `workspace/library/skills/` and overrides built-ins by name.
- **ProjectEngine** (`services/projects.ts`) runs **data-driven, config-not-code pipelines**: a book runs a named `sequence` of editable `pipeline` definitions pulled from its `templates/` snapshot (the static step-template lookup and the hardcoded phase enum were removed in book-container Phase 3c). A project is a sequence of steps, each with a `taskType` (routes to a tier), a `prompt`, an optional injected `skill`, and an optional `wordCountTarget` (triggering multi-pass continuation). A `dynamic` pipeline (e.g. `novel-pipeline`) delegates to the code generator; when nothing else matches, the engine asks the AI to plan steps from the skill catalog. Projects auto-execute on creation; completion fires `onProjectCompleted` hooks.

Each project is **bound to a book at creation** via an immutable `bookSlug`, so its output routes to that book's `data/` directory regardless of which book is active later (an unbound project falls back to the globally-active book's `data/` directory, then to `workspace/projects/<id>/` when no book resolves at all). Multiple books therefore run concurrently without cross-leak.

## The Book-Container Model

BookClaw is a **multi-author, multi-book studio**, where each book is a self-contained, portable container. The book-container model is complete (Phases 0–12). The pieces:

- **Library** (`library/` built-in, read-only; `workspace/library/` user overlay) — the catalog of reusable assets you pull from, by kind: **author**, **voice**, **genre**, **pipeline**, **sequence**, **editor**, **prompt**, **sections**, and **skills**. `LibraryService` resolves overlay-over-builtin by name (skills are delegated to `SkillLoader`).
- **Book** (`workspace/books/<slug>/`) — created by `BookService` with **copy-on-create** semantics:
  - `book.json` — the manifest (`schemaVersion`-gated: too-old quarantines, too-new is read-only) with `pulledFrom` provenance.
  - `templates/` — a snapshot of the chosen author/voice/genre/pipeline/sections/skills copied from the library at create time.
  - `.baseline/` — a pristine mirror of the snapshot for 3-way **re-pull** merges (`services/merge.ts`).
  - `data/` — generated outputs.
- **Re-pull** — an opt-in, 3-way merge that pulls newer library content into a book without auto-propagation, so a library edit never corrupts a book mid-production.
- **Export / import** — a book is a portable `.zip` (manifest + templates + data; never `.baseline/` or the vault). Import runs strict per-entry guards and injection scanning, routing anything flagged through the confirmation gate.

- **Series** (`workspace/series/`) — an optional container above books for authors running multi-book series, with a cross-book series bible and divergence tracking between a book's snapshot refs and the series' current refs.

The (now-completed) phased roadmap (storage → library → book entity → per-book wiring → editor/re-pull → share/import → front-end → genre wiring → multi-book concurrency → book-board UI → per-channel active book → backup/recovery) is recorded in [BOOK-CONTAINER-ARCHITECTURE.md](BOOK-CONTAINER-ARCHITECTURE.md).

## Frontend

The UI is the **v6 React studio**, built with Vite and organized as npm workspaces under `frontend/`:

- `frontend/shared/` — the shared `api`/`socket`/`store` seam (including a `useActiveBook()` indirection so components never assume a single global active book), shared types, and chat/format helpers.
- `frontend/studio/` — the studio served at `/` (Book Board, Write, Asset Studio, Insights, Settings, Confirmations, Activity).
- `frontend/chat/` — the standalone Chat app served on its own port.

`npm run build:frontend` builds both dists (gitignored; built by Docker and by the build-then-assert unit tests). The studio HTML is served statically with the `__BOOKCLAW_AUTH_TOKEN__` placeholder injected per request; the chat server (`init/phase-12-chat-http.ts`) injects the token and API base, validates the `Host` header (forged hosts fall back to localhost), reuses the source-IP allowlist, and applies a tight CSP. The legacy vanilla-JS dashboard was retired in the Phase 6i cutover; only `dashboard/concept/` remains as the design source-of-truth.

## Bridges

`gateway/src/bridges/{telegram,discord}.ts` translate channel-specific commands (`/novel`, `/project`, `/write`, `/files`, `/read`, `/export`, `/speak`, `/voice`, …) into the same internal handlers used by the studio chat. Conversation history is keyed by channel name to prevent cross-contamination between Telegram users, web chat, and API callers.

## Stateful Directories

Everything user-generated lives under `workspace/` (gitignored except the directory itself; a host bind-mount in Docker):

| Path | Contents |
|------|----------|
| `workspace/soul/` | Author identity files (SOUL.md, STYLE-GUIDE.md, VOICE-PROFILE.md), prompt-injected |
| `workspace/memory/` | Conversation history, book bible, summaries, lessons, preferences |
| `workspace/library/` | User overlay over the built-in `library/` (authors/voices/genres/pipelines/sections/skills) |
| `workspace/books/<slug>/` | Per-book containers (`book.json` + `templates/` + `.baseline/` + `data/`) |
| `workspace/series/` | Optional series containers (cross-book series bible, divergence tracking) |
| `workspace/projects/<id>/` | Project outputs (legacy / no-active-book path) |
| `workspace/documents/` | Uploaded large manuscripts (excerpts sent to AI; full text stays on disk) |
| `workspace/.config/` | `personas.json`, project state, the global active-book pointer (`active-book.json`), per-channel overrides (`channel-books.json`) |
| `workspace/.activity/` | Universal activity log (JSONL), surfaced to the UI |
| `workspace/.audit/` | Security audit log (JSONL) |
| `workspace/.agent/` | Agent journal and self-improvement notes |
| `workspace/audio/` | Generated TTS files (auto-cleaned after 24h) |
| `workspace/.vault/` · `config/.vault/` | Encrypted credential storage |

`config/default.json` is the only versioned config; `config/user.json` overrides it and is gitignored.

## Testing

There is no heavyweight test framework. Tests are scripts so any check is repeatable:

- `tests/unit/*.test.ts` — `node --test` via `tsx` (services, the router, build-then-assert checks for the studio/chat bundles).
- `tests/smoke-test.sh` — boots the gateway and asserts the security perimeter (hermetic, non-destructive).
- `tests/feature-smoke.sh` — exercises the live product surface (library, books, chat, the novel pipeline, the craft suite, compile) against a running instance.

## Related Documents

- [README.md](../README.md) — installation, usage, and configuration.
- [BOOK-CONTAINER-ARCHITECTURE.md](BOOK-CONTAINER-ARCHITECTURE.md) — the book-container data model and phased roadmap.
- [GOD-CLASS-REFACTOR.md](GOD-CLASS-REFACTOR.md) — decomposition of the `index.ts` / `routes.ts` god classes.
- [SECURITY.md](SECURITY.md) — security posture, threat model, and deployment guidance.
- [GLOSSARY.md](GLOSSARY.md) — canonical vocabulary.
