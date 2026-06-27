# Session Handoff — 2026-06-26

Portable state snapshot so this work can resume on another machine. Read this top to bottom before doing anything.

## 0. CRITICAL — nothing is committed yet

`git HEAD` is still `652a361`. **Every change from this session is uncommitted in the working tree**, described in the repo-root `commit_message` file. To move to a new system safely:

1. **On this machine, run `./push.sh`** — commits the working tree with `commit_message` and pushes to the git remote, then deletes `commit_message`. (Per repo convention the maintainer runs this; Claude does not `git push`.)
2. On the new machine, `git clone`/`git pull` the repo to get the committed work.
3. If you cannot run `./push.sh` first, you must copy the working tree (`/home/paul/data/dev/bookclaw`) to the new machine — the uncommitted changes only travel via the commit or a file copy.

Verified before handoff: `tsc` clean, full unit suite **1074/1074**, `build:frontend` green, MCP build green.

## 1. Where things live (three buckets)

- **In git (after `./push.sh`):** all gateway/frontend/MCP code, `docs/TODO.md`, the new apply-fix spec, and `docker/docker-compose.writing.yml` (the vault host-bind-mount change). The full diff is summarized in `commit_message`.
- **Neptune-local, NOT in git** (lives on the Neptune host `192.168.1.28`; reach via `ssh neptune`):
  - The **Margot "fanfiction" editor** — `workspace/library/editors/fanfiction.json` (overlay asset). Edit it live via `PUT /api/library/editor/fanfiction` with `{content}`.
  - **`.env.writing`** secrets/config at `/mnt/bckup1/bookclaw-writing/.env.writing` — incl. the chat-enable + CORS vars added this session.
  - The **Dropbox mirror** script + cron — `/mnt/bckup1/bookclaw-writing/dropbox-mirror.sh` + paul's crontab.
- **Claude memory** (local to this machine's Claude install, may not transfer): `~/.claude/projects/-home-paul-data-dev-bookclaw/memory/` — esp. `writing-instance-neptune.md`, which has the authoritative Neptune ops detail (deploy command, vault, DB, chat config, Dropbox mirror, providers gotcha). If the new machine's Claude doesn't have it, this doc + `commit_message` are the fallback.

## 2. Deployment state

- **Neptune** (`192.168.1.28:3847`, the production "writing" instance, real books) — **fully deployed** with everything below. Healthy, vault key intact. Chat app live on `:3848`.
- **Mercury** (`192.168.1.32:3847`, dev) — got only the **early** batch (prompt-runner OpenRouter picker, the first consistency capability/failure/cost work). The **later** session work (summary chart, retry, empty-handling, chat composer fix, editor number-select) was deployed **Neptune-only** and is **not on Mercury**. It will land on Mercury's next `touch build_now` rebuild (chat is disabled there anyway — `BOOKCLAW_CHAT_PORT` unset — so the chat fixes don't matter there).

### How Neptune is deployed (no `build_now`; manual rebuild)
```
ssh neptune
cd /mnt/bckup1/Dropbox/dev/bookclaw          # Dropbox-synced working tree (gets your edits)
docker compose -p bookclaw-writing \
  --env-file /mnt/bckup1/bookclaw-writing/.env.writing \
  -f docker/docker-compose.yml -f docker/docker-compose.writing.yml up -d --build
```
Always check idle first (`curl …/api/projects/list` → `{"projects":[]}`). Env-only changes use `up -d` (no `--build`). See `writing-instance-neptune.md` for the vault/DB/CORS detail.

## 3. What this session shipped (all in `commit_message`)

- **OpenRouter model picker** — `GET /api/models/openrouter` (cached 24h, fail-soft) + a shared `useOpenRouterModels` datalist on the Prompt Runner and Consistency exact-model fields.
- **Consistency engine, major hardening:** require a large-context model (Ollama excluded; 422 when none configured); surface per-chapter failures (`chaptersTotal`/`chaptersFailed`/`failureSamples`, named chapters) instead of a false all-clear; **JSON-repair** (`jsonrepair`) + output cap **8000→16000** so dense chapters don't truncate; **retry** a failed chapter 3× (fleeting errors recover, systemic ones still fail); fail-fast abort after 3 dead chapters; **per-chapter summary chart** (`chapterSummary`: scan status / high·med·low / items tracked) in report + UI; empty-completion handling with `finish_reason`; **cost display** (`AuditReport.estimatedCost`) + OpenRouter `usage:{include:true}` for real per-model cost; per-run/per-book model selection.
- **Studio Rail** refreshes AI spend / pending / status on a 20s poll (was once-on-mount → stale).
- **Shared `api()`** surfaces the server's `{error}` body in thrown errors (was a bare `status path`).
- **Chat app composer fix** — the shell grid had no `grid-template-rows`; a long book list pushed the composer off-screen. Added `grid-template-rows: minmax(0,1fr)` + scrollable `.left`.
- **Editor menu number-select** — after `/editors`, a bare reply like `7` now enters that editor (one-shot `pendingEditorMenu` + pure `editorNumberSelection`).
- MCP `craft.ts` consistency tool descriptions updated (lockstep).

## 4. Neptune-only changes this session (re-apply if the instance is ever rebuilt from scratch)

- **Vault durability:** moved the vault from a project-scoped named volume (which got orphaned/lost) to a **host bind-mount** `/mnt/bckup1/bookclaw-writing/vault` → `/app/config/.vault` (the `docker-compose.writing.yml` change IS in git; the existing `vault.enc` was migrated by hand). Owned `999:999`.
- **Dropbox browse-mirror:** the live data is owned by `plex(999)` but Dropbox runs as `paul(1000)` and can't index it, so a cron rsyncs `workspace`+`backups` into `/home/paul/Dropbox/Writing/bookclaw/` (paul-owned → syncs). One-way browse copy, every 15 min.
- **Chat enabled:** `.env.writing` had only `BOOKCLAW_CHAT_HTTP_PORT` (host port map), not `BOOKCLAW_CHAT_PORT` (the enable flag). Added `BOOKCLAW_CHAT_PORT=3848` and `BOOKCLAW_CORS_ORIGINS=http://192.168.1.28:3848` (chat at :3848 calls the gateway at :3847 cross-origin).
- **Margot "fanfiction" editor** created + iterated: a paranoid Big-Name-Fan co-writer (warm, fandom-fluent, sure the studios are scraping her ideas). Paranoia is her default state; it never leaks into the story prose (locked to the Montgomery anchor); box-art/scaffolding banners stripped so they don't print in chat. Use via `/editor fanfiction brainstorm` or `/editors` → `7`.

## 5. Open work / where to resume

- **`./push.sh`** the batch (see §0). Optionally `touch build_now` + push to bring Mercury up to parity.
- **Owner was test-driving Margot** — last ask was tuning her paranoia; she's working now. Possible next: dial paranoia menacing↔comic; trim `━━━` dividers if they ever print.
- **Consistency apply-fix** — design approved, spec written: `docs/superpowers/specs/2026-06-26-consistency-apply-fix-design.md`. Next step is an implementation plan (writing-plans), then build. Tracked in `docs/TODO.md` (Larger items).
- **New TODOs added this session** (in `docs/TODO.md`): cost-warning on the Consistency screen; choosable download location; reliable physical-trait tracking; in-depth beta/alpha read; more detailed logs + in-app log viewer; OpenRouter model picker (done-but-listed).

## 6. Access cheat-sheet

- Neptune writing instance: `http://192.168.1.28:3847` (studio), `:3848` (chat). `ssh neptune`. Auth token + all secrets in `/mnt/bckup1/bookclaw-writing/.env.writing` (0600). uid 999 = `plex` on host = `bookclaw` in container.
- Mercury dev: `http://192.168.1.32:3847`. Deploy by `touch build_now` + push (a timer rebuilds from the working tree).
- Local dev: `npm start` (gateway), `npm run build:frontend`, `node --import tsx --test tests/unit/*.test.ts` (1074 tests). MCP: `cd mcp && npm run build && npm test`.
