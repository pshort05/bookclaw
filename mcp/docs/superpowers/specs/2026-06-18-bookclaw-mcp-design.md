# BookClaw MCP Server — Design

Date: 2026-06-18
Status: Approved (brainstorming)

## Purpose

Expose BookClaw's autonomous author workflow to MCP clients (Claude Desktop,
Claude Code, claude.ai) so an LLM can drive BookClaw — create books, run the
production pipeline, chat, export — through standard MCP tool calls.

BookClaw already exposes everything through a REST + WebSocket API on port
`3847` behind bearer-token auth. The MCP server is a **thin, stateless client**
of that API. It adds no business logic and owns no state; BookClaw remains the
single source of truth.

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language / runtime | TypeScript / Node 22 | Matches BookClaw's stack and `@modelcontextprotocol/sdk` first-class TS support; shared conventions (`.js` import extensions, `tsx`). |
| Transport | Streamable HTTP | Server is network-reachable for local and remote MCP clients. |
| MCP-client auth | Bearer token | Mirrors BookClaw's deny-by-default LAN perimeter. |
| BookClaw auth | Bearer token presented by the MCP server | Reuses BookClaw's existing `Authorization: Bearer` gate. |
| Tool surface | Curated workflow tools + generic escape hatch | ~284 endpoints is far past the point where MCP clients select tools well; curate the common loop, keep full reach via one generic tool. |
| First cut | Core author loop only | Books, projects/pipeline, chat, files/export, status, library-read, plus the escape hatch. Everything else stays reachable via the escape hatch and is wrapped later. |

## Architecture

```
MCP client ──Streamable HTTP (+ Bearer BOOKCLAW_MCP_TOKEN)──▶ bookclaw-mcp
                                                              (stateless tool layer)
                                                                     │
                                          HTTP (+ Bearer BOOKCLAW_AUTH_TOKEN)
                                                                     │
                                                                     ▼
                                                            BookClaw :3847
                                                          (all real logic + state)
```

### Two independent bearer tokens, never conflated

- `BOOKCLAW_MCP_TOKEN` — gates the MCP server's own Streamable-HTTP endpoint.
  Deny-by-default; a missing/blank token is a loud misconfiguration, matching
  BookClaw's posture (no silent open port).
- `BOOKCLAW_AUTH_TOKEN` — the token the MCP server presents when calling
  BookClaw (`Authorization: Bearer …`, with the `?token=` query fallback
  available for GETs). This is BookClaw's existing auto-generated token.

### One thin API client

A single module (`src/bookclaw-client.ts`) wraps `fetch` to BookClaw:

- reads `BOOKCLAW_BASE_URL` (default `http://127.0.0.1:3847`),
- injects the BookClaw bearer token,
- sets a request timeout,
- normalizes responses and errors into a small typed shape.

**Every tool goes through this client.** No tool calls `fetch` directly.

### Stateless

No database, no workspace, no persisted state. The server can be restarted
freely. Concurrency / active-book semantics are whatever BookClaw enforces.

## Tool catalog

### Phase 1 — curated core-author-loop tools

| Domain | Tools (working names) | BookClaw endpoints |
|--------|-----------------------|--------------------|
| Status | `bookclaw_status` | `GET /api/status`, `GET /api/health` |
| Books | `list_books`, `get_book`, `create_book`, `set_active_book`, `get_book_files`, `read_book_file` | `/api/books*` |
| Projects / Pipeline | `list_projects`, `get_project`, `create_project`, `create_pipeline`, `advance_pipeline`, `get_project_files` | `/api/projects*`, `/api/pipeline*` |
| Chat | `chat` | `POST /api/chat` |
| Export | `compile_project`, `export_docx` | `/api/projects/:id/compile`, `/api/projects/:id/export-docx` |
| Library (read) | `list_library`, `get_library_entry` | `/api/library`, `/api/library/:kind`, `/api/library/:kind/:name` |

### Escape hatch (full API reach)

- `bookclaw_request` — generic call: `{ method, path, body? }`.
  - `path` MUST start with `/api/`.
  - `method` constrained to an allowlist (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`).
  - **Never bypasses BookClaw's confirmation gate.** When BookClaw returns a
    pending-confirmation response for an irreversible action (publish, send,
    submit, upload, bid, purchase), the MCP tool surfaces that response to the
    LLM verbatim — it does not auto-approve.
- `list_endpoints` — returns a static, curated catalog of the BookClaw routes
  (method + path + one-line purpose), so the LLM can discover what
  `bookclaw_request` can reach without guessing paths.

### Deferred (reachable via escape hatch now, curated later)

personas, series, export-extras (KDP blurb, beta reader, pacing), media
(images/audio/TTS/research), website, knowledge/marketing (launches, AMS,
BookBub, calendar, translation), wave (goals, craft critique, audiobook,
style-clone), backups, settings/vault, authoring (prompts/skills), heartbeat.

## Cross-cutting concerns

### Error handling

The API client maps BookClaw failures to clean MCP tool errors:

| BookClaw response | MCP tool error message |
|-------------------|------------------------|
| `401` | "MCP→BookClaw auth misconfigured (check BOOKCLAW_AUTH_TOKEN)" |
| `403` | Surface BookClaw's reason (IP allowlist, or confirmation-gate detail) |
| `503` | "BookClaw has no AI providers configured — add a key in Settings" |
| network / timeout | retryable message naming the base URL |

Successful results return BookClaw's JSON, trimmed of obvious noise, as
structured tool content.

### Streaming

Phase 1 chat is request/response — BookClaw's `POST /api/chat` returns a full
response. Socket.IO token-streaming is **out of scope for v1** and noted as a
future enhancement.

### Configuration (env only)

| Variable | Purpose | Default |
|----------|---------|---------|
| `BOOKCLAW_BASE_URL` | BookClaw API base | `http://127.0.0.1:3847` |
| `BOOKCLAW_AUTH_TOKEN` | token presented to BookClaw | (required) |
| `BOOKCLAW_MCP_TOKEN` | gates the MCP endpoint | (required) |
| `BOOKCLAW_MCP_BIND` | MCP server bind address | `127.0.0.1` |
| `BOOKCLAW_MCP_PORT` | MCP server port | `3849` |

Documented in `.env.example`; no secrets committed.

### Testing (scripted, repeatable — mirrors BookClaw)

No heavy test framework.

- `node --test` unit tests for the API client (auth injection, error mapping)
  and the escape-hatch path/method guard.
- A smoke test that boots the MCP server and asserts the MCP endpoint enforces
  the bearer token and that one tool round-trips against a stub (or live)
  BookClaw. Includes a `-v` verbose flag streaming the server log, matching
  BookClaw's smoke-test convention.
- `tsc --noEmit` type-check.

## Project layout

Mirrors BookClaw conventions (`.js` import extensions under `NodeNext`, run via
`tsx`, fail-soft startup logging):

```
src/index.ts            # entry: build MCP server, register tools, start HTTP transport
src/bookclaw-client.ts  # the one fetch wrapper to BookClaw
src/auth.ts             # MCP-endpoint bearer gate
src/tools/
  status.ts
  books.ts
  projects.ts
  chat.ts
  export.ts
  library.ts
  escape-hatch.ts
src/endpoints.ts        # static catalog backing list_endpoints
tests/                  # smoke + unit scripts
.env.example
```

## Out of scope (v1)

- Socket.IO token streaming.
- OAuth 2.1 MCP authorization.
- Curated wrappers for the deferred domains (reachable via the escape hatch).
- Any change to BookClaw itself — this repo only consumes its API.
