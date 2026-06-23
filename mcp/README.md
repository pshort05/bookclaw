# bookclaw-mcp

A Model Context Protocol (MCP) server that exposes [BookClaw](..)'s
author workflow to MCP clients over Streamable HTTP. It is a thin, stateless
client of BookClaw's REST API — see `CLAUDE.md` and
`docs/superpowers/specs/2026-06-18-bookclaw-mcp-design.md`.

**Driving BookClaw from an LLM client?** See
[docs/LLM-OPERATOR-GUIDE.md](docs/LLM-OPERATOR-GUIDE.md) — a guide to hand to the
LLM that will operate BookClaw through these tools (core concepts, the tool
catalog, canonical workflows, and the confirmation-gate rules).

## Setup

```bash
npm install
cp .env.example .env   # fill in BOOKCLAW_AUTH_TOKEN and BOOKCLAW_MCP_TOKEN
npm start              # listens on http://127.0.0.1:3849/mcp
```

`BOOKCLAW_AUTH_TOKEN` is BookClaw's own token (from BookClaw's `.env`).
`BOOKCLAW_MCP_TOKEN` is a token you choose to gate this server.

## Install into Claude Code

This repo is also a Claude Code plugin marketplace. Quick HTTP install (server
running on `:3849`):

```bash
claude plugin marketplace add /home/paul/data/dev/bookclaw-mcp
claude plugin install bookclaw-mcp@bookclaw \
  --config url=http://127.0.0.1:3850/mcp --config token=<BOOKCLAW_MCP_TOKEN>
```

For an always-on localhost service, run `bash deploy/install-service.sh`
(systemd user unit on `127.0.0.1:3850`).

A stdio option (Claude launches the server itself) and full details are in
[docs/INSTALL.md](docs/INSTALL.md). The server also speaks stdio directly when
`BOOKCLAW_MCP_TRANSPORT=stdio`.

## Tool profiles

The full surface is ~101 tools. Some MCP clients select tools less reliably past
~50–100, so the exposed set is configurable. The default exposes everything.

- `BOOKCLAW_MCP_PROFILE` — a named bundle of tool groups. One of:
  - `all` (default) — every tool.
  - `core` — status, books, projects, chat, export, library.
  - `author` — core + personas, series, craft.
  - `publishing` — core + publishing, media, audiobook.
  - `marketing` — core + marketing, website.
- `BOOKCLAW_MCP_GROUPS` — optional override: an explicit comma-list of per-module
  groups (`status,books,projects,chat,export,library,personas,series,craft,publishing,media,audiobook,marketing,website,escape-hatch`).
  When set, it takes precedence over the profile.

The `escape-hatch` group (`bookclaw_request`, `list_endpoints`) is **always
included**, so every BookClaw endpoint stays reachable regardless of profile.
Unknown profile/group names fall back to `all` / are ignored, with a warning.

## Tools

**Core author loop:** `bookclaw_status`, `list_books`, `get_book`,
`create_book`, `set_active_book`, `get_book_files`, `read_book_file`,
`list_projects`, `get_project`, `create_project`, `create_pipeline`,
`advance_pipeline`, `get_project_files`, `chat`, `compile_project`,
`export_docx`, `list_library`, `get_library_entry`.

**Personas:** `list_personas`, `get_persona`, `create_persona`,
`generate_persona`, `update_persona`, `delete_persona`, `generate_persona_bio`.

**Series:** `list_series`, `create_series`, `update_series`, `set_series_refs`,
`get_series_worldbuilding`, `set_series_worldbuilding`, `add_book_to_series`,
`remove_book_from_series`, `set_series_reading_order`, `get_series_report`,
`get_series_divergence`, `delete_series`. (The confirmation-gated series-asset
pull stays on the escape hatch.)

**Craft analysis:** `list_beta_archetypes`, `run_beta_reader`,
`get_beta_reader_report`, `dialogue_audit`, `pacing_heatmap`, `craft_critique`,
`continuity_check`, `get_continuity_report`, `list_structures`,
`recommend_structure`, `check_outline_structure`, `structure_check`,
`get_plot_promises`, `extract_plot_promises`, `audit_plot_promises`.

**Publishing / export extras:** `export_blurb`, `export_project_blurb`,
`format_pro`, `get_manuscript_hub`. (The multipart track-changes DOCX roundtrip
and cover typography stay on the escape hatch.)

**Media:** `research`, `list_research_domains`, `set_research_domains`,
`generate_image`, `generate_book_cover`, `generate_cover_set`,
`generate_project_cover_set`, `list_cover_variants`, `list_image_providers`,
`generate_audio`, `list_voices`, `set_audio_config`.

**Audiobook prep:** `audiobook_cleanup`, `audiobook_pronunciation`,
`audiobook_ssml`, `audiobook_attribute`. (Binary image/audio file-serving
endpoints stay on the escape hatch.)

**Marketing / launch:** `list_launches`, `create_launch`, `get_launch`,
`update_launch`, `propose_launch_step`, `delete_launch`,
`propose_ams_campaigns`, `optimize_ams`, `draft_bookbub_ad`, `list_calendar`,
`create_calendar_event`, `plan_price_pulse`, `update_calendar_event`,
`delete_calendar_event`, `analyze_reader_intel`, `plan_translation`.

**Website:** `list_sites`, `get_site`, `create_site`, `update_site`,
`delete_site`, `add_site_book`, `remove_site_book`, `add_blog_post`,
`remove_blog_post`, `draft_blog_post`, `render_site`. (Confirmation-gated site
deploy/publish, disclosure helpers, and the ICS calendar export stay on the
escape hatch.)

**Escape hatch:** `list_endpoints`, `bookclaw_request`.

## Testing

```bash
npm test            # unit + smoke
npx tsc --noEmit    # type-check
```
