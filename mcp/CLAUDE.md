# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What bookclaw-mcp is

A **Model Context Protocol (MCP) server** that exposes [BookClaw](..)'s
autonomous author workflow to MCP clients (Claude Desktop, Claude Code,
claude.ai). It is a Node.js/TypeScript process that listens over **Streamable
HTTP** and translates MCP tool calls into authenticated REST calls against a
running BookClaw gateway on port `3847`.

**It is a thin, stateless client.** It owns no database, no workspace, and no
business logic — BookClaw remains the single source of truth. Every tool is a
shaped wrapper over BookClaw's existing REST API; the server can be restarted
freely with no state loss. If a behaviour belongs in BookClaw, it goes in
BookClaw, not here.

**Primary deployment focus: local or trusted LAN**, mirroring BookClaw's
single-user home-LAN threat model. The MCP endpoint is gated by its own bearer
token (deny-by-default). For any internet-facing deployment, front it with a
reverse proxy enforcing TLS — design and review decisions weigh against the
local/LAN threat model, not a hostile-internet one.

There is **no heavy test framework**: tests are scripts (`node --test` unit
tests + a boot/auth smoke test), `tsx` runs TypeScript directly in development,
and the **`commit_message` + git** workflow applies (see [Git Workflow](#git-workflow)).

## Relationship to BookClaw

This server is **vendored into the BookClaw monorepo at `mcp/`** (BookClaw root
is `..`). It **consumes** BookClaw's API and never modifies BookClaw. The gateway
lives at `../gateway`; BookClaw's `../CLAUDE.md`, `../docs/ARCHITECTURE.md`, and
the per-feature route modules under `../gateway/src/api/routes/*.routes.ts` are
the authoritative reference for what endpoints exist and what they accept. When
an endpoint's shape is unclear, read the corresponding `*.routes.ts` handler
under `../gateway` rather than guessing. Because the tool surface maps onto those
routes, the two change in lockstep — keep MCP tool updates in the same commit as
the gateway change they wrap.

BookClaw exposes ~284 REST endpoints. This server does **not** wrap them 1:1
(MCP clients select tools poorly past ~50–100 tools). It exposes a **curated
set of core-author-loop tools** plus a generic **escape-hatch** tool
(`bookclaw_request`) that can reach any endpoint. See
[docs/superpowers/specs/2026-06-18-bookclaw-mcp-design.md](docs/superpowers/specs/2026-06-18-bookclaw-mcp-design.md)
for the full design.

## Two bearer tokens — never conflate them

The single most important security invariant in this repo:

- **`BOOKCLAW_MCP_TOKEN`** gates *this server's* Streamable-HTTP endpoint
  (inbound — MCP clients present it). Deny-by-default: a missing/blank value is
  a loud misconfiguration, not a silently open port.
- **`BOOKCLAW_AUTH_TOKEN`** is what *this server presents to BookClaw*
  (outbound — `Authorization: Bearer …`, with the `?token=` query fallback for
  GETs). This is BookClaw's own auto-generated token.

Do not pass one where the other belongs. Do not log either. Do not commit
either.

## Karpathy AI Coding Guidelines

**These directives are MANDATORY and apply to every coding task, in every
project, without exception.** They override conflicting habits and stylistic
preferences. Before submitting any code change, self-check against all four.

### 1. Think Before Coding

State assumptions explicitly. If multiple interpretations exist, present them —
don't pick silently. If a simpler approach exists, say so. If something is
unclear, stop and ask.

### 2. Simplicity First

Minimum code that solves the problem. No speculative features, no abstractions
for single-use code, no unrequested configurability, no error handling for
impossible scenarios. If you write 200 lines and it could be 50, rewrite it.
This server is deliberately thin — resist the urge to reimplement BookClaw
logic here.

### 3. Surgical Changes

Touch only what the task requires. Don't improve adjacent code, don't refactor
what isn't broken, match existing style. Remove only the orphans your own
changes create; note pre-existing dead code without deleting it.

### 4. Goal-Driven Execution

Define verifiable success criteria before starting. "Add a tool" → "boot the
server, call the tool, assert the BookClaw round-trip and the response shape."
For multi-step tasks, state a brief plan with a verification step per stage.

## Commands

```bash
npm start              # node --import tsx src/index.ts
npm run dev            # same, with --watch (file reload)
npx tsc --noEmit       # type-check only (no emit; nothing reads dist in dev)
npm run build          # tsc emit to dist/ (production)
npm test               # unit + smoke
npm run test:unit      # node --test (via tsx) over tests/unit/*.test.ts
npm run test:smoke     # boot the MCP server + assert the bearer gate + a tool round-trip
```

No lint runner is configured. Scripted tests live in `tests/`. Don't invent
other test commands.

## Testing

**Tests must be scripted so they can be repeated.** Any check worth running is
worth committing under `tests/`. Capture curl/boot sequences as a script before
considering the work done — do not leave verification as one-off shell commands.

**Debug logging must be available for testing.** The smoke test takes a `-v`
flag that streams the captured server log, matching BookClaw's
`tests/smoke-test.sh` convention, so a failing run can be diagnosed without
re-instrumenting code.

Current scripted tests (see the design doc for the target set):

- `tests/smoke-test.sh` — boots the MCP server and asserts the MCP endpoint
  rejects requests without `BOOKCLAW_MCP_TOKEN`, accepts a valid token, and
  round-trips one tool against a stub or live BookClaw. Hermetic and
  non-destructive: supplies tokens via env, binds loopback only, leaves no
  stray process.
- `tests/unit/*.test.ts` — the API client (auth injection, error mapping) and
  the escape-hatch path/method guard.

## High-level architecture

```
MCP client ──Streamable HTTP (+ Bearer BOOKCLAW_MCP_TOKEN)──▶ bookclaw-mcp
                                                                     │
                                          HTTP (+ Bearer BOOKCLAW_AUTH_TOKEN)
                                                                     ▼
                                                            BookClaw :3847
```

- **`src/index.ts`** — entry point. Builds the MCP server, registers every
  tool module, and starts the Streamable-HTTP transport on
  `BOOKCLAW_MCP_BIND:BOOKCLAW_MCP_PORT` (default `127.0.0.1:3849`). Fail-soft
  startup logging in BookClaw's `✓ / ⚠ / ℹ` style.
- **`src/bookclaw-client.ts`** — the **one** `fetch` wrapper to BookClaw. Reads
  `BOOKCLAW_BASE_URL`, injects the outbound bearer token, sets a timeout, and
  normalizes responses/errors into a small typed shape. **Every tool goes
  through this client; no tool calls `fetch` directly.**
- **`src/auth.ts`** — the inbound bearer gate on the MCP endpoint.
- **`src/tools/*.ts`** — one module per domain (`status`, `books`, `projects`,
  `chat`, `export`, `library`, `escape-hatch`). Each registers its tools and
  delegates to the API client.
- **`src/endpoints.ts`** — a static, curated catalog of BookClaw routes backing
  the `list_endpoints` discovery tool.

### Escape hatch — confirmation gate is sacred

`bookclaw_request` can reach any `/api/*` endpoint, but it **never bypasses
BookClaw's confirmation gate.** When BookClaw returns a pending-confirmation
response for an irreversible external action (publish, send, submit, upload,
bid, purchase), the tool surfaces that response to the LLM verbatim — it does
**not** auto-approve. Preserve this when touching the escape hatch.

## Conventions specific to this repo

- **Imports use `.js` extensions** even though source is `.ts` — required by
  `NodeNext` module resolution. Match this when adding files.
- **Node 22+** required; `--import tsx` loads TS — don't switch to `ts-node`.
- **All configuration is via environment variables** (`BOOKCLAW_BASE_URL`,
  `BOOKCLAW_AUTH_TOKEN`, `BOOKCLAW_MCP_TOKEN`, `BOOKCLAW_MCP_BIND`,
  `BOOKCLAW_MCP_PORT`, the transport selector `BOOKCLAW_MCP_TRANSPORT`
  (`http` default | `stdio`), plus the tool-selection vars
  `BOOKCLAW_MCP_PROFILE` / `BOOKCLAW_MCP_GROUPS`). Document new ones in
  `.env.example`; never commit secrets.
- **Two transports** (`src/index.ts` selects on `BOOKCLAW_MCP_TRANSPORT`):
  Streamable HTTP (default, bearer-gated) and stdio (the client launches the
  process). **In stdio mode stdout is the JSON-RPC channel — never `console.log`;
  all logs go to stderr** (`console.error`). Only the HTTP path uses the inbound
  bearer gate.
- **This repo is also a Claude Code plugin marketplace**
  (`.claude-plugin/marketplace.json` → `plugin/`). The plugin ships an HTTP MCP
  server config; see [docs/INSTALL.md](docs/INSTALL.md). Keep the plugin's
  `.mcp.json` under `plugin/` (not the repo root) so it does not auto-load as a
  project server during development.
- **Tools are organized into per-module groups** (`src/tool-groups.ts`); a
  profile is a named bundle of groups. When adding a new tool module, add its
  group name to `GROUP_NAMES`, map it in `REGISTRARS` (`src/server.ts`), and add
  it to the relevant profiles. The `escape-hatch` group is always registered —
  keep it that way so full API reach is never lost.
- **Stateless by design.** Do not add a database, cache, or persisted state. If
  you find yourself wanting to store something, the data belongs in BookClaw.
- **Fail-soft startup.** Log a notice and continue with degraded capability
  when an optional dependency is unavailable; don't make startup require it.
- The parent `/home/paul/data/dev/CLAUDE.md` applies: surgical changes only, no
  speculative abstractions, ask before system-level changes.

## Git Workflow

This server lives inside the BookClaw monorepo, so it uses **BookClaw's** git
workflow, not a separate one. When work is complete, write the commit message to
`../commit_message` (the monorepo root) and let the maintainer run the repo-root
`./push.sh`; there is no `mcp/push.sh`. Format: short one-line summary, blank
line, then dash-prefixed detail lines — minimal, no padding. Do not `git commit`
or `git push` directly. Build artifacts (`mcp/node_modules`, `mcp/dist`) are
git-ignored by both the nested `mcp/.gitignore` and the repo-root rules.
