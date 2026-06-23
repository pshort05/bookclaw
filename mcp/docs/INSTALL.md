# Installing the BookClaw MCP server in Claude Code

This repo is also a **Claude Code plugin marketplace**. Installing the
`bookclaw-mcp` plugin wires Claude Code to the MCP server so you can drive
BookClaw with the 101 author-workflow tools.

There are two transports. Pick one.

## Prerequisites (both transports)

- A running **BookClaw** gateway you can reach (e.g. `http://192.168.1.32:3847`)
  and its `BOOKCLAW_AUTH_TOKEN`.
- This repo cloned with `npm install` already run (Node 22+).

---

## Option A — HTTP (the plugin marketplace flow)

Claude connects to an **already-running** `bookclaw-mcp` HTTP service. This is
what the marketplace plugin ships, and it is the most robust option (no
dependency on the plugin cache having `node_modules`).

### 1. Run the MCP server (always-on systemd user service — recommended)

```bash
cd /home/paul/data/dev/bookclaw/mcp
BOOKCLAW_AUTH_TOKEN="<bookclaw token>" \
BOOKCLAW_MCP_TOKEN="<choose a token>" \
BOOKCLAW_BASE_URL="http://192.168.1.32:3847" \
  bash deploy/install-service.sh
```

This installs a **localhost-only** `bookclaw-mcp.service` (listening on
`127.0.0.1:3850`), writes the secrets to `~/.config/bookclaw-mcp/bookclaw-mcp.env`
(chmod 600, never committed), enables it (survives reboot if user lingering is
on), and starts it. Re-run the script after a `git pull` or a Node upgrade —
it's idempotent and never overwrites your env file. Manage it with:

```bash
systemctl --user status bookclaw-mcp
systemctl --user restart bookclaw-mcp
journalctl --user -u bookclaw-mcp -f
```

Scope the tool surface by editing `BOOKCLAW_MCP_PROFILE` in the env file, then
`systemctl --user restart bookclaw-mcp`.

> **Foreground alternative (no service):**
> ```bash
> BOOKCLAW_BASE_URL=… BOOKCLAW_AUTH_TOKEN=… BOOKCLAW_MCP_TOKEN=… \
> BOOKCLAW_MCP_PORT=3850 npm start
> ```

### 2. Add this repo as a marketplace and install the plugin

```bash
claude plugin marketplace add /home/paul/data/dev/bookclaw-mcp
claude plugin install bookclaw-mcp@bookclaw \
  --config url=http://127.0.0.1:3850/mcp \
  --config token=<the same BOOKCLAW_MCP_TOKEN>
```

(Equivalently, the interactive slash-commands `/plugin marketplace add …` and
`/plugin install bookclaw-mcp@bookclaw` from inside a Claude Code session.)

### 3. Approve the MCP server

Installing a plugin does **not** auto-approve its MCP server. The first time
Claude Code uses it you'll be asked to approve the `bookclaw` server (one-time).

Verify: `claude plugin list` shows `bookclaw-mcp`, and in a session the
`bookclaw_status` tool returns BookClaw's status.

---

## Option B — stdio (Claude launches the server)

Claude Code spawns the server as a subprocess and talks over stdio. No port or
long-running service to manage. Because the server runs via `tsx`, it needs this
repo's `node_modules`, so point Claude at the **local checkout** (not the plugin
cache).

Add it as a project- or user-scoped MCP server:

```bash
claude mcp add bookclaw \
  --transport stdio \
  --env BOOKCLAW_MCP_TRANSPORT=stdio \
  --env BOOKCLAW_BASE_URL=http://192.168.1.32:3847 \
  --env BOOKCLAW_AUTH_TOKEN=<bookclaw token> \
  --env BOOKCLAW_MCP_PROFILE=all \
  -- node --import tsx /home/paul/data/dev/bookclaw-mcp/src/index.ts
```

No inbound `BOOKCLAW_MCP_TOKEN` is needed in stdio mode — the OS process
boundary is the trust boundary.

---

## Scoping the tool surface

Both transports honor the Phase 6 profile/group selection. To expose fewer than
all 101 tools, set `BOOKCLAW_MCP_PROFILE` (`core` / `author` / `publishing` /
`marketing`) or `BOOKCLAW_MCP_GROUPS` in the server's environment. See the main
[README](../README.md#tool-profiles).

## Updating / removing

```bash
claude plugin update bookclaw-mcp@bookclaw
claude plugin uninstall bookclaw-mcp@bookclaw
claude plugin marketplace remove bookclaw
```
