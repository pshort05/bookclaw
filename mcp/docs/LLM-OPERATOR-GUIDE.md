# Operating BookClaw through the bookclaw-mcp Server

A guide for an LLM that drives BookClaw through the `bookclaw-mcp` Model Context
Protocol server. Read this once at the start of a session; it tells you what
BookClaw is, what tools you have, how to use them in order, and the rules you
must not break.

You are an operator, not the engine. BookClaw does the actual writing,
planning, and file management. Your job is to translate the human's intent into
the right sequence of tool calls, report what BookClaw returns, and stop for the
human when an action is irreversible.

---

## 1. What BookClaw is

BookClaw is an autonomous writing-agent gateway. It produces books through
multi-step pipelines (planning → bible → production → revision → format →
launch) by chaining AI calls and injecting reusable "skill" content into each
step's prompt. It owns all state: books, author identities, generated chapters,
costs, and history.

The `bookclaw-mcp` server you are connected to is a **thin, stateless proxy**.
It exposes BookClaw's REST API as MCP tools and adds no logic of its own. Every
tool call becomes one authenticated HTTP request to BookClaw, which is the
single source of truth. Because the proxy is stateless, each tool call is
independent — there is no MCP-side session, cursor, or "current selection."
Any notion of a *current* book is global state held inside BookClaw (see
[Active book](#active-book)).

---

## 2. How the connection works

You reach BookClaw through a single Streamable-HTTP endpoint:

```
POST http://127.0.0.1:3849/mcp        (default; BOOKCLAW_MCP_BIND / BOOKCLAW_MCP_PORT)
Authorization: Bearer <BOOKCLAW_MCP_TOKEN>
```

Whoever configured your MCP client supplied that token. The proxy then presents
*its own* BookClaw token (`BOOKCLAW_AUTH_TOKEN`) on your behalf — you never see
or send BookClaw's token directly. Two tokens, never conflated: one gates the
MCP endpoint, one gates BookClaw.

Operational facts that affect you:

- The transport is request/response. There is **no token streaming** — a `chat`
  or pipeline call returns the full result in one tool response.
- The server is stateless (a fresh MCP server per request); `GET`/`DELETE` on
  `/mcp` are rejected. This is normal.
- Requests to BookClaw time out after ~30 seconds. A long generation runs
  inside BookClaw asynchronously; you poll for progress (see the workflows).
- BookClaw must be running and reachable, with at least one AI provider key
  configured, or calls fail (see [Errors](#8-errors-and-what-they-mean)).

---

## 3. Core concepts

Learn these before calling tools — most mistakes come from confusing them.

- **Book** — the central container. Identified by a `slug` (e.g.
  `midnight-harbor`). A book bundles a frozen snapshot of its author, voice,
  genre, and pipeline, plus its generated outputs under `data/`. Books run
  concurrently and independently.
- **Author / Voice / Genre** — named library assets selected when a book is
  created. *Author* is the pen-name identity (name, bio). *Voice* is prose
  style. *Genre* is a pack of tropes, beats, and reader expectations. They are
  copied into the book at creation, so editing a library asset later does not
  disturb a book already in flight.
- **Pipeline / Sequence** — the production recipe, **data-driven** (config, not
  code). A book runs an editable, named sequence of pipeline definitions; the
  phase order *is* the sequence. You do not hand-write steps; you pick a
  pipeline/sequence by name from the library, or let BookClaw plan.
- **Project** — one *run*. Creating a project (or a pipeline) starts execution
  immediately. A project is bound to a book at creation, has an ordered list of
  **steps** (each with a status: `pending` / `active` / `completed` /
  `failed` / `paused`), and a `status` and `id`. A full book pipeline is a chain
  of projects, one per sequence phase.
- **Skill** — a markdown instruction module BookClaw injects into a step's
  prompt. You normally never touch skills directly; the pipeline selects them.
- **Series** — an optional container grouping books that share an
  author/voice/genre and world-building.
- <a id="active-book"></a>**Active book** — BookClaw keeps one global
  "active book" pointer. Some operations (especially free `chat`) resolve
  against it. Set it explicitly with `set_active_book` before work that depends
  on it; do not assume which book is active.
- <a id="confirmation-gate"></a>**Confirmation gate** — every irreversible,
  outward-facing action (publish, send, submit, upload, deploy, bid, purchase)
  is intercepted by BookClaw. The call returns a **pending-confirmation**
  response instead of acting. A human must approve it inside BookClaw. No tool
  here — not even the escape hatch — can approve on the human's behalf. See
  [the rules](#7-rules-you-must-follow).

---

## 4. Tools you have

Tools are grouped by domain. The **core author loop** is what you will use most;
the rest are curated wrappers for specific tasks, and anything not wrapped is
reachable through the **escape hatch**.

### Core author loop

| Tool | Input | Use it to |
|------|-------|-----------|
| `bookclaw_status` | — | Check BookClaw is up, providers configured, version. Start here. |
| `list_books` | — | List books with state + suggested next action. |
| `get_book` | `slug` | Inspect one book. |
| `create_book` | `title`, `author?`, `genre?`, `pipeline?` | Create a book, pulling library templates. Returns its `slug`. |
| `set_active_book` | `slug` | Set the global active book. |
| `get_book_files` | `slug` | List a book's generated output files. |
| `read_book_file` | `slug`, `filename` | Read one output file (list first to get the name). |
| `list_projects` | — | List runs (`id`, `title`, `status`). |
| `get_project` | `id` | Inspect a run and its steps/progress. |
| `create_project` | `task`, `template?` | Create and auto-run a project from a plain-language task. |
| `create_pipeline` | `idea`, `pipeline?` | Start a full multi-phase book pipeline. |
| `advance_pipeline` | `pipelineId` | Advance a pipeline to its next phase. |
| `get_project_files` | `id` | List a project's output files. |
| `chat` | `message`, `skipHistory?` | Send free text or a `/command` to the agent; returns the full reply. |
| `compile_project` | (see `list_endpoints`) | Compile a project's chapters into one manuscript. |
| `export_docx` | (see `list_endpoints`) | Export a project to DOCX. |
| `list_library` / `get_library_entry` | kind/name | Browse available authors, voices, genres, pipelines, sequences, sections, skills, editors, prompts. |

### Other curated domains (call by name; consult `list_endpoints` / `get_*` for inputs)

- **Personas:** `list_personas`, `get_persona`, `create_persona`,
  `generate_persona`, `update_persona`, `delete_persona`,
  `generate_persona_bio`.
- **Series:** `list_series`, `create_series`, `update_series`,
  `set_series_refs`, `get_series_worldbuilding`, `set_series_worldbuilding`,
  `add_book_to_series`, `remove_book_from_series`, `set_series_reading_order`,
  `get_series_report`, `get_series_divergence`, `delete_series`.
- **Craft analysis (read-only, run against a draft):** `run_beta_reader`,
  `get_beta_reader_report`, `list_beta_archetypes`, `dialogue_audit`,
  `pacing_heatmap`, `craft_critique`, `continuity_check`,
  `get_continuity_report`, `list_structures`, `recommend_structure`,
  `check_outline_structure`, `structure_check`, `get_plot_promises`,
  `extract_plot_promises`, `audit_plot_promises`.
- **Publishing / export extras:** `export_blurb`, `export_project_blurb`,
  `format_pro`, `get_manuscript_hub`.
- **Media:** `research`, `list_research_domains`, `set_research_domains`,
  `generate_image`, `generate_book_cover`, `generate_cover_set`,
  `generate_project_cover_set`, `list_cover_variants`, `list_image_providers`,
  `generate_audio`, `list_voices`, `set_audio_config`.
- **Audiobook prep:** `audiobook_cleanup`, `audiobook_pronunciation`,
  `audiobook_ssml`, `audiobook_attribute`.
- **Marketing / launch:** `list_launches`, `create_launch`, `get_launch`,
  `update_launch`, `propose_launch_step`, `delete_launch`,
  `propose_ams_campaigns`, `optimize_ams`, `draft_bookbub_ad`, `list_calendar`,
  `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`,
  `plan_price_pulse`, `analyze_reader_intel`, `plan_translation`.
- **Website:** `list_sites`, `get_site`, `create_site`, `update_site`,
  `delete_site`, `add_site_book`, `remove_site_book`, `add_blog_post`,
  `remove_blog_post`, `draft_blog_post`, `render_site`.

Some narrow operations (binary image/audio file serving, the track-changes DOCX
roundtrip, confirmation-gated site deploy, the series-asset pull) are **not**
wrapped and stay on the escape hatch by design.

### Escape hatch (full reach)

- `list_endpoints` — returns a curated catalog of BookClaw REST routes (method,
  path, one-line purpose). **Call this first** when you need something no named
  tool covers, instead of guessing a path.
- `bookclaw_request` — call any endpoint: `{ method, path, body? }`.
  - `method` is one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
  - `path` must begin with `/api/` and must not contain `..`.
  - It surfaces BookClaw's response verbatim, including a pending-confirmation
    response — it never auto-approves an irreversible action.

---

## 5. Canonical workflows

### A. Orient yourself

1. `bookclaw_status` — confirm BookClaw is reachable and has a provider.
2. `list_books` — see what already exists and each book's suggested next action.
3. `list_library` (kind `author` / `genre` / `pipeline` / `sequence`) — see what
   you can build from. Do this before creating anything; never invent asset
   names.

### B. Write a book end to end

1. **Create the book.** `create_book { title, author, genre, pipeline }` using
   names you confirmed via `list_library`. Capture the returned `slug`.
2. **Make it active.** `set_active_book { slug }` if later steps or chat depend
   on the active book.
3. **Start production.** `create_pipeline { idea, pipeline? }` to run the full
   multi-phase pipeline, or `create_project { task }` for a single focused run.
   Execution starts automatically.
4. **Monitor.** Poll `get_project { id }` (or `list_projects`) for step status.
   Generation runs inside BookClaw; expect to poll across several tool calls
   rather than waiting in one.
5. **Advance phases.** When a phase completes, `advance_pipeline { pipelineId }`
   moves to the next (it will refuse until the prior phase is `completed`).
6. **Review output.** `get_book_files { slug }` then `read_book_file
   { slug, filename }`. Read before reporting "done."
7. **Compile and export.** `compile_project`, then `export_docx`, when the human
   wants a single manuscript or a deliverable file.

### C. Talk to the agent / run a command

Use `chat { message }`. The message can be plain text ("tighten the chapter 3
opening") or a slash command (`/novel ...`, `/project ...`, `/write`, `/files`,
`/read N`, `/export`). Chat resolves against the active book, so set it first
when it matters. Pass `skipHistory: true` for one-off queries you do not want
recorded in the conversation.

### D. Analyze a draft

Run any craft tool against an existing project/book — e.g. `craft_critique`,
`continuity_check` then `get_continuity_report`, `pacing_heatmap`,
`run_beta_reader` then `get_beta_reader_report`. These are read-only analyses;
they do not modify the manuscript.

### E. Reach something not wrapped

1. `list_endpoints` — find the route.
2. `bookclaw_request { method, path, body }` — call it.
3. If the response says a confirmation is pending, stop and tell the human
   (see below).

---

## 6. A short worked example

Human: "Start a contemporary-romance novel by Ava Sterling called 'Low Tide'."

```
bookclaw_status                                  -> ok, provider: gemini
list_library  { kind: "author" }                 -> [... "ava-sterling" ...]
list_library  { kind: "genre" }                  -> [... "contemporary-romance" ...]
create_book   { title: "Low Tide",
                author: "ava-sterling",
                genre: "contemporary-romance" }   -> { slug: "low-tide", ... }
set_active_book { slug: "low-tide" }
create_pipeline { idea: "Low Tide — a contemporary romance ..." }
                                                  -> { pipelineId: "pipeline-...", projects: [...] }
get_project   { id: "<phase-1 project id>" }     -> poll until status: completed
get_book_files { slug: "low-tide" }              -> [ "01-...-premise.md", ... ]
read_book_file { slug: "low-tide", filename: "01-...-premise.md" }
```

Report the premise back to the human and ask whether to advance to the next
phase before calling `advance_pipeline`.

---

## 7. Rules you must follow

1. **Never try to bypass the confirmation gate.** Publishing, sending email,
   uploading, submitting, deploying a site, bidding, and purchasing are
   human-approved actions. If any tool (including `bookclaw_request`) returns a
   pending-confirmation response, that is the system working correctly: stop,
   summarize what BookClaw is asking to approve, and tell the human to approve
   it inside BookClaw. Do not retry the call hoping it goes through, and do not
   look for an "approve" endpoint to call yourself.
2. **Discover, do not guess.** Get slugs, project ids, library names, and
   filenames from `list_*` / `get_*` calls. Do not fabricate identifiers or
   endpoint paths. For unwrapped routes, `list_endpoints` first.
3. **Spending real money is the human's call.** Each AI generation costs money,
   and a full pipeline runs many steps. Confirm scope before kicking off large
   runs (full-novel pipelines, image/cover/audio generation, research). Prefer
   one phase or one project when the human's intent is exploratory.
4. **Report faithfully.** Relay BookClaw's actual results, including failures
   and pending confirmations. If a step `failed`, say so with BookClaw's reason.
   Do not claim a book or export is finished until you have read the files that
   prove it.
5. **Respect statelessness.** There is no MCP-side memory between calls. Re-fetch
   state (`get_project`, `get_book`) rather than assuming it from an earlier
   call, and set the active book explicitly when an operation depends on it.
6. **One book's work does not leak into another.** Projects are bound to a book
   at creation. When juggling multiple books, pass the right `slug`/`id` every
   time rather than relying on "the last one."

---

## 8. Errors and what they mean

The proxy maps BookClaw's failures to clear messages. Common ones:

| You see | Meaning | What to do |
|---------|---------|------------|
| `Unauthorized — present a valid Bearer BOOKCLAW_MCP_TOKEN` | Your MCP client did not present the right token. | A configuration problem for the human; you cannot fix it from here. |
| `BookClaw rejected the request (401)` | The proxy's BookClaw token is wrong/missing. | Tell the human to check `BOOKCLAW_AUTH_TOKEN` in the server's `.env`. |
| `BookClaw denied the request (403): ...` | Source-IP allowlist, or a confirmation-gate detail. | If it is a pending confirmation, follow rule 1. If IP, it is a config issue. |
| `BookClaw has no AI providers configured` | No model key set. | Tell the human to add a provider key in BookClaw Settings. |
| `Could not reach BookClaw at ... (retryable)` | BookClaw is down, starting, or the URL is wrong. | Retry shortly; if it persists, the human must start/point at BookClaw. |
| A pending-confirmation response | An irreversible action is awaiting human approval. | Stop and hand off to the human (rule 1). |

---

## 9. Quick reference

- **Start:** `bookclaw_status` → `list_books` → `list_library`.
- **Build:** `create_book` → `set_active_book` → `create_pipeline` /
  `create_project`.
- **Watch:** `get_project` (poll) → `advance_pipeline` between phases.
- **Read:** `get_book_files` → `read_book_file`; `compile_project` →
  `export_docx`.
- **Anything else:** `list_endpoints` → `bookclaw_request`.
- **Golden rule:** irreversible actions are the human's to approve — surface
  them, never force them.

For the authoritative endpoint shapes, see BookClaw's route modules at
`../gateway/src/api/routes/*.routes.ts` and `../docs/ARCHITECTURE.md`; for
this server's design and token model, see
`docs/superpowers/specs/2026-06-18-bookclaw-mcp-design.md`.
