# BookClaw Launch Guide

Quick reference for starting, stopping, and managing BookClaw.

---

## Windows — via Docker Desktop or WSL2

BookClaw does not ship a supported Windows-direct install. Windows users should run BookClaw through Docker Desktop or under WSL2; both flows reuse the steps in the **VPS / Remote Server (Docker)** section below.

- **Docker Desktop:** install Docker Desktop for Windows, clone the repo in PowerShell or Git Bash, then follow the **Start with Docker** subsection below. The studio is reachable at `http://localhost:3847` from the Windows host.
- **WSL2 (Ubuntu / Debian):** open your WSL distro and follow the **First-time setup** + **Start without Docker** steps below as if it were a Linux box.

Direct `npm start` from a Windows command prompt or PowerShell is not a supported configuration on this fork. Some `process.platform === 'win32'` branches survive in the source from upstream OpenClaw — they may continue to work, but Windows-direct is not tested or documented.

---

## VPS / Remote Server (Docker)

### First-time setup
```bash
# 1. Clone the repo
git clone https://github.com/pshort05/bookclaw.git
cd bookclaw

# 2. Install Node 22+ (if running without Docker)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Create .env with your vault key
echo "BOOKCLAW_VAULT_KEY=your-64-char-hex-key-here" > .env
chmod 600 .env

# 4. Install dependencies (if running without Docker)
npm ci
```

### Start with Docker
```bash
# Build and start
npm run docker:up

# View logs
npm run docker:logs

# Stop
npm run docker:down
```

### Start without Docker (direct on VPS)
```bash
npm start
```

> **Workspace version gate:** on boot the gateway compares the persisted
> `workspace/.bookclaw/workspace.json` schema version against the build's
> supported range and **fails closed** (process exits) if the workspace is
> incompatible — protecting an old or newer workspace from a mismatched build.
> Override with `BOOKCLAW_SKIP_VERSION_GATE=1` (unsafe; only when you know what
> you are doing).

### Network access

This fork binds to `0.0.0.0:3847` by default — the Docker image is reachable
from any host on the same LAN, no tunnel required. The bind address is
controlled by the `BOOKCLAW_BIND` env var.

**Trusted LAN (preferred for home / lab Docker deployment):**
```bash
# Default — open browser on any LAN host:
http://<docker-host-ip>:3847

# Explicit (already the default in docker/docker-compose.yml):
BOOKCLAW_BIND=0.0.0.0 npm start
```
The gateway enforces bearer-token auth (`BOOKCLAW_AUTH_TOKEN`, auto-generated
into `.env` on first run), deny-by-default CORS (`BOOKCLAW_CORS_ORIGINS`), and
an optional source-IP allowlist (`BOOKCLAW_ALLOWED_IPS`). For any internet-facing
or untrusted-network exposure, also front it with a TLS/auth reverse proxy. Only
deploy on a trusted single-user LAN without a reverse proxy.

**Untrusted network / public VPS:** lock the bind to loopback and reach it
through a tunnel or an authenticating reverse proxy.
```bash
# 1. Restrict the bind:
BOOKCLAW_BIND=127.0.0.1 npm start   # or set in docker-compose.yml

# 2a. SSH tunnel from your PC:
ssh -L 3847:localhost:3847 user@your-vps-ip
# Then open http://localhost:3847 on your PC.

# 2b. Or front it with Caddy / Nginx / Traefik enforcing HTTPS + auth.
```

---

## Key Locations

| What | Path |
|---|---|
| Main code | `gateway/src/index.ts` |
| UI (v6 React studio) | Served statically at `/` (built from `frontend/studio/`). The old vanilla-JS dashboard was retired. |
| Skills | `skills/{core,author,marketing,ops,toolkit}/` (active categories; `premium/` is gitignored, rest in `_archived/`) |
| Config | `config/default.json` (public), `config/user.json` (private) |
| Vault (encrypted keys) | `config/.vault/vault.enc` |
| Project outputs | `workspace/projects/` |
| Author Personas | `workspace/.config/personas.json` |
| Project state | `workspace/.config/projects-state.json` |
| Soul system | `workspace/soul/` |
| Memory/Bible | `workspace/memory/` |
| Self-improvement | `workspace/.agent/` |
| Workspace (Docker host mount) | `/home/paul/bookclaw-workspace` — the whole `workspace/` tree, bind-mounted on the host (override with `BOOKCLAW_WORKSPACE_PATH`). Back this directory up. Owned by the container user (uid 999), so host writes/deletes need `sudo`. |

## API Keys (Studio > Settings)

All keys are stored in the encrypted vault. Set them via the studio:
1. Open **http://localhost:3847** > **Settings** (`/settings`)
2. Enter API keys in the provider fields (values are write-only — never read back)
3. Click **Save** — keys are encrypted with AES-256-GCM

| Provider | Where to get key | Cost |
|---|---|---|
| Gemini | https://aistudio.google.com/apikey | Free |
| Ollama | Install locally: https://ollama.ai | Free |
| OpenAI | https://platform.openai.com/api-keys | Paid |
| Claude | https://console.anthropic.com | Paid |
| DeepSeek | https://platform.deepseek.com | Cheap |

## Telegram Bot

1. Message **@BotFather** on Telegram → `/newbot`
2. Copy the bot token
3. Studio > Settings > paste the Telegram bot token > Save
4. Studio > Settings > enter your Telegram user ID (allowed users) > Save
5. Message your bot — it should respond

## Common Commands

All `/api/*` endpoints require the bearer token. Use `-H "Authorization: Bearer $BOOKCLAW_AUTH_TOKEN"` or append `?token=$BOOKCLAW_AUTH_TOKEN`. The token is auto-generated into `.env` on first run.

```bash
# Check if server is running
curl -H "Authorization: Bearer $BOOKCLAW_AUTH_TOKEN" http://localhost:3847/api/status

# TypeScript compile check (no output = success)
npx tsc --noEmit

# View project list
curl -H "Authorization: Bearer $BOOKCLAW_AUTH_TOKEN" http://localhost:3847/api/projects/list | node -e "const d=require('fs').readFileSync(0,'utf8');JSON.parse(d).projects.forEach(p=>console.log(p.id,p.title,p.status,p.progress+'%'))"

# Compile manuscript from chapter files
curl -X POST -H "Authorization: Bearer $BOOKCLAW_AUTH_TOKEN" http://localhost:3847/api/projects/PROJECT_ID/compile

# Resume a stuck project
curl -X POST -H "Authorization: Bearer $BOOKCLAW_AUTH_TOKEN" http://localhost:3847/api/projects/PROJECT_ID/resume
```

## Ports

| Service | Port | Binding |
|---|---|---|
| BookClaw | 3847 | configurable via `BOOKCLAW_BIND` (default `0.0.0.0`; set `127.0.0.1` for loopback-only) |
| Chat app | 3848 (convention) | disabled unless `BOOKCLAW_CHAT_PORT` is set (docker-compose publishes 3848); served separately from the main studio |
| Ollama (if installed) | 11434 | localhost only |

## Security Checklist

- [ ] `.env` file permissions set to 600 (`chmod 600 .env`)
- [ ] Vault key is unique 64-char hex (not the default)
- [ ] No API keys in plain text files
- [ ] Telegram bot token only in vault
- [ ] `.gitignore` covers `.env`, `vault.enc`, `user.json`, `workspace/`
- [ ] Bind address is appropriate for the environment: `BOOKCLAW_BIND=0.0.0.0` (default) only on a trusted LAN; `BOOKCLAW_BIND=127.0.0.1` for loopback-only when fronted by a tunnel or auth proxy
- [ ] SSH tunnel or auth-enforcing reverse proxy (Caddy / Nginx / Traefik) in front of any non-trusted-LAN deployment
