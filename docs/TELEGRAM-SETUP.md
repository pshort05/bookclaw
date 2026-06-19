# Telegram Bot + LAN Setup Guide

End-to-end setup for running BookClaw on a Linux or macOS host, exposing the dashboard to other devices on your LAN, and driving the agent from Telegram on your phone.

This guide is for the common home/lab case: one host machine on a trusted LAN, one or more authors who want to send `/novel` commands from their phones, and dashboard access from any device on the network.

---

## What you'll have at the end

```
   ┌───────────────────┐                     ┌────────────────────┐
   │  Telegram phone   │                     │  Telegram cloud    │
   │  app (you + LAN   │ ──── HTTPS ───▶    │  api.telegram.org  │
   │  users)           │                     └─────────┬──────────┘
   └───────────────────┘                               │
                                                       │ long-poll (outbound)
                                                       ▼
   ┌─────────────────────┐  LAN HTTP   ┌─────────────────────────┐
   │  Other devices on   │ ──────────▶ │  BookClaw host        │
   │  your LAN (laptop,  │   :3847     │  (Linux or macOS)       │
   │  tablet, phone)     │             │  bind 0.0.0.0           │
   └─────────────────────┘             └─────────────────────────┘
```

Two networks are in play, and the distinction matters:

| Network | Direction | What it's for |
|---|---|---|
| **Telegram cloud** | Outbound only (BookClaw → `api.telegram.org`) | Receiving bot messages, sending bot replies. **No inbound port needed.** |
| **Your LAN** | Inbound to port 3847 from local devices | Browser dashboard access from other devices on the LAN. |

Because BookClaw uses long polling (not webhooks), Telegram works even if your router blocks all inbound connections, your ISP doesn't give you a public IP, or you're behind CGNAT. **You never have to forward a port for Telegram.** Easy and safe.

---

## Prerequisites

- **Host machine** — a Linux PC, Raspberry Pi, mini-PC, Mac mini, or macOS laptop that stays on
- **Node.js 22+** installed (`node --version` to check)
- **BookClaw installed** — see [QUICKSTART.md](QUICKSTART.md) if you haven't yet
- **A Telegram account** on your phone
- **Both your host and your phone need internet.** They don't need to be on the same network — Telegram bridges them.

---

## STEP 1 — Create your Telegram bot

You'll create the bot once. The token Telegram gives you back is what BookClaw uses to authenticate every message.

### 1a. Open Telegram and message [@BotFather](https://t.me/BotFather)
BotFather is Telegram's official bot-creation bot. It's safe.

### 1b. Run `/newbot` and answer the two prompts
```
You:        /newbot
BotFather:  Alright, a new bot. How are we going to call it?
You:        BookClaw Home
BotFather:  Good. Now let's choose a username for your bot.
            It must end in `bot`.
You:        bookclaw_home_bot
BotFather:  Done! Congratulations on your new bot. ...
            Use this token to access the HTTP API:
            1234567890:AAEhBP1f-real-token-goes-here
```

The display name (`BookClaw Home`) is what users see in chat. The username (`@bookclaw_home_bot`) is how they find it. The username has to be globally unique and end in `bot`.

### 1c. Copy the token
The long string after `Use this token to access the HTTP API:` is your **bot token.** Treat it like a password — anyone with this token can impersonate your bot.

### 1d. (Optional) Set a description and profile picture
Still in the BotFather chat:
```
/setdescription   ← shown when someone opens your bot for the first time
/setabouttext     ← shown in the bot's "About" panel
/setuserpic       ← upload a square image as the bot avatar
/setcommands      ← register the slash command list so it autocompletes
```

A good `/setcommands` payload for BookClaw:
```
novel - Create a full novel pipeline
project - Plan and run any task
write - Quick writing task
status - Check what's running
stop - Pause active project
files - List output files
read - Preview a file
research - Research a topic
clean - Workspace cleanup
```

---

## STEP 2 — Find your Telegram user ID

BookClaw uses a per-user allowlist. You need the numeric user ID of every Telegram account that should be allowed to drive the bot. (Without this, the bot is open to anyone who finds the username — fix this before you put a paid API key in the vault.)

### 2a. Get your own user ID
In Telegram, search for **[@userinfobot](https://t.me/userinfobot)**, open it, and press **Start**. It replies with your account info, including:
```
Id: 123456789
First: Paul
Username: @yourhandle
```
Copy the numeric `Id` value.

### 2b. Get the ID of every other user you want to authorize
Each LAN user does the same: message `@userinfobot`, copy their `Id`, send it to you. These are not secrets — they're just numbers Telegram uses internally.

---

## STEP 3 — Start BookClaw with LAN access

By default this fork already binds to `0.0.0.0:3847`, so the dashboard is reachable from any device on your LAN with no extra configuration. You just need to know the host's IP address.

### 3a. Find your host's LAN IP

**Linux:**
```bash
hostname -I | awk '{print $1}'
# or
ip -4 addr show | grep -oP '(?<=inet\s)192\.168\.\d+\.\d+|(?<=inet\s)10\.\d+\.\d+\.\d+'
```

**macOS:**
```bash
# Wi-Fi:
ipconfig getifaddr en0

# Wired ethernet (varies by Mac model — try en0, en1, en2):
ipconfig getifaddr en1
```

Write down the result. It will look something like `192.168.1.42` or `10.0.0.17`. This is your **`<host-ip>`** for everything below.

### 3b. Start BookClaw
From the BookClaw repo root on the host:
```bash
npx tsx gateway/src/index.ts
```
You should see:
```
BookClaw is ready to write
Dashboard: http://localhost:3847
```
The console says `localhost`, but because the bind is `0.0.0.0`, it's actually listening on every interface — including your LAN IP.

### 3c. Confirm LAN access from another device
On your phone, laptop, or tablet (on the same Wi-Fi/LAN as the host), open a browser to:
```
http://<host-ip>:3847
```
If the dashboard loads, LAN access works. If it doesn't, jump to the **Firewall** section below.

> **Trusted LAN only.** The API and Socket.IO handshake require the bearer token (`BOOKCLAW_AUTH_TOKEN`); an unauthenticated visitor to `:3847` cannot drive the agent. However, the security perimeter is designed for a trusted single-user LAN, not a hostile network. Only expose this on a network you trust. For untrusted networks, see [LAUNCH-GUIDE.md](LAUNCH-GUIDE.md#network-access) for the loopback + reverse-proxy pattern.

---

## STEP 4 — Connect the bot to BookClaw

### 4a. Open the dashboard
On the host machine (or any LAN device): `http://<host-ip>:3847`

### 4b. Save your bot token
Sidebar → **Settings** → paste the bot token from Step 1c into the **Telegram Bot Token** field → **Save**. The token is encrypted and written to `config/.vault/vault.enc` (AES-256-GCM).

### 4c. Save your allowed Telegram user IDs
Still in Settings, find the **Telegram Allowed Users** (or "Telegram User ID") field. Paste the numeric ID from Step 2a. To allow multiple LAN users, separate IDs with commas:
```
123456789, 987654321, 555000111
```
Click **Save**.

### 4d. Connect the bot
Click **Connect Telegram** (or restart BookClaw — the bridge auto-connects on startup if a token is saved).

In the console you should see:
```
  ✓ Telegram bridge connected (command center mode)
```
(The bridge validates the token against `api.telegram.org`, then starts long-poll polling.)

---

## STEP 5 — Verify end-to-end

### 5a. Phone test (Telegram)
On your phone, open Telegram, search for `@bookclaw_home_bot`, press **Start**, and send:
```
/status
```
You should get a reply within a second or two. If you do — Telegram is wired up.

### 5b. LAN test (dashboard)
From another device on your LAN, open `http://<host-ip>:3847`. You should see the same dashboard, same project list, same Activity Log as on the host machine. Both surfaces drive the same agent — start a project from your phone via Telegram, then watch it run live from your laptop's browser. A standalone Chat app can optionally be served on its own port — it's off unless you set `BOOKCLAW_CHAT_PORT` (e.g. `3848`).

### 5c. Sanity check the allowlist
Ask a friend (or a second Telegram account) who's **not** on the allowlist to open the bot and send `/status`. They should get:
```
🔒 Not authorized. Ask the owner to add your ID (NNNNNNN) in the dashboard.
```
That's the allowlist working. Add their ID via Settings if you want to authorize them.

---

## STEP 6 — Firewall configuration

If LAN devices can't reach the dashboard, the host's local firewall is almost always the cause.

### Linux (ufw — Ubuntu, Debian, Mint)
```bash
# Check status
sudo ufw status

# Allow port 3847 from your LAN subnet only (recommended — replace with your actual subnet)
sudo ufw allow from 192.168.1.0/24 to any port 3847 proto tcp

# Or, less restrictive — allow from any source on any interface
sudo ufw allow 3847/tcp

# Reload
sudo ufw reload
```

### Linux (firewalld — Fedora, RHEL, CentOS)
```bash
sudo firewall-cmd --add-port=3847/tcp --permanent
sudo firewall-cmd --reload
```

### macOS
macOS's built-in Application Firewall is per-process, not per-port. The first time BookClaw tries to listen on a network interface, you'll get a system dialog: **"Do you want the application 'node' to accept incoming network connections?"** — click **Allow**.

If you dismissed the dialog or want to verify:
1. **System Settings → Network → Firewall**
2. Click **Options…**
3. Find `node` in the list; set to **Allow incoming connections**
4. If it's not in the list, click **+**, navigate to your Node binary (`which node` to find the path), add it, and set to **Allow**

If macOS Firewall is **off** entirely (default on most consumer Macs), there's no firewall blocking — and the problem is something else (see Troubleshooting).

### Verify with a quick test
From another LAN device:
```bash
# Replace with your host IP
curl -v http://192.168.1.42:3847/api/status
```
A `200 OK` with JSON means the firewall is open and BookClaw is reachable. A connection timeout means the firewall is still blocking.

---

## STEP 7 — Make it persistent (run in the background)

So far you've been running BookClaw with `npx tsx gateway/src/index.ts` in a terminal. Close the terminal and the agent dies. For real use, run it as a background service so Telegram works 24/7.

### Linux — systemd user service

Create `~/.config/systemd/user/bookclaw.service`:
```ini
[Unit]
Description=BookClaw Agent
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/YOURUSER/data/dev/bookclaw
ExecStart=/usr/bin/npx tsx gateway/src/index.ts
Restart=on-failure
RestartSec=10
# Optional: pin the bind explicitly
Environment=BOOKCLAW_BIND=0.0.0.0

[Install]
WantedBy=default.target
```

Then:
```bash
# Enable the service so it survives logout (requires lingering for the user)
sudo loginctl enable-linger $USER

# Load and start
systemctl --user daemon-reload
systemctl --user enable --now bookclaw

# Check status
systemctl --user status bookclaw

# Tail logs
journalctl --user -u bookclaw -f
```

### macOS — launchd agent

Create `~/Library/LaunchAgents/com.bookclaw.agent.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.bookclaw.agent</string>
    <key>WorkingDirectory</key>
    <string>/Users/YOURUSER/data/dev/bookclaw</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/npx</string>
        <string>tsx</string>
        <string>gateway/src/index.ts</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>BOOKCLAW_BIND</key>
        <string>0.0.0.0</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/YOURUSER/Library/Logs/bookclaw.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOURUSER/Library/Logs/bookclaw.err.log</string>
</dict>
</plist>
```

> **Note:** `npx` lives at `/usr/local/bin/npx` if you installed Node via the official installer or Homebrew on Intel Macs, and at `/opt/homebrew/bin/npx` on Apple Silicon Homebrew installs. Run `which npx` and use that path.

Then:
```bash
launchctl load ~/Library/LaunchAgents/com.bookclaw.agent.plist

# Verify it's running
launchctl list | grep bookclaw

# Tail logs
tail -f ~/Library/Logs/bookclaw.log
```

To stop it:
```bash
launchctl unload ~/Library/LaunchAgents/com.bookclaw.agent.plist
```

### Both platforms
Once the service is running, you can close your terminal, log out, or even reboot. BookClaw will come back up automatically and the Telegram bot will resume polling within ~30 seconds.

---

## STEP 8 — Reserve the host's LAN IP (recommended)

If your host is on Wi-Fi or its IP is DHCP-assigned, the address can change after a router reboot. When that happens, every bookmark to `http://192.168.1.42:3847` breaks and you have to rediscover the IP.

Two options:

**Option A — DHCP reservation on the router (preferred).**
In your router's admin panel, find DHCP → Reservations (sometimes called "static leases" or "bind MAC to IP"). Reserve the host's MAC address to its current IP. The host still uses DHCP — it just always gets the same address.

**Option B — mDNS / hostname.**
Linux (with avahi-daemon) and macOS (built-in Bonjour) advertise themselves on the LAN as `<hostname>.local`. So instead of `http://192.168.1.42:3847` you can use `http://bookclaw-host.local:3847`. Works on most LANs without router changes. Hostname can be set with:
- **Linux:** `sudo hostnamectl set-hostname bookclaw-host`
- **macOS:** **System Settings → General → Sharing → Local Hostname**

---

## Multi-user LAN setup notes

When several people on your LAN drive the same bot:

- **They all share the same agent, workspace, and persona stack.** Multi-user is about who's allowed to send commands, not about isolated workspaces. If two people start novels in parallel, they queue against the same project engine.
- **Pipelines run sequentially by default.** If user A starts a 6-hour novel pipeline and user B sends `/novel` ten minutes later, B's project queues behind A's. Use `/status` to check what's running.
- **Anything destructive is gated.** The confirmation gate applies regardless of who initiated the action. The owner (you) sets policy in `config/default.json`.
- **The dashboard shows global state.** Any LAN user opening `http://<host-ip>:3847` sees every project, every persona, every file. There's no per-user view. Treat the bot allowlist as "trusted co-authors," not "isolated tenants."

For genuinely isolated multi-tenant use (one bot per pen name, separate workspaces, separate API keys per author), BookClaw doesn't support it yet — see [OPENCLAW-UPDATES.md](OPENCLAW-UPDATES.md) item #8 ("Multi-agent routing with isolated workspaces") for the upstream feature being tracked.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Bot doesn't reply to anything | Token wrong, or BookClaw not actually running | Check console: `✓ Telegram bridge connected (command center mode)` should appear. If not, verify the token in Settings. |
| Bot replies "Not authorized" | Your Telegram user ID isn't in the allowlist | Settings → Telegram Allowed Users → add your ID → Save → restart BookClaw |
| Bot was working, suddenly stops | Network blip or token revoked | `curl https://api.telegram.org/bot<TOKEN>/getMe` from the host. `ok: true` means token is fine. If not, regenerate via `/token` in BotFather. |
| LAN device can't open dashboard | Firewall on host, or host IP changed | See **Firewall** section. Re-check `<host-ip>` with `hostname -I` (Linux) or `ipconfig getifaddr en0` (macOS). |
| LAN device gets "connection refused" | BookClaw is bound to loopback only | Check the env: `echo $BOOKCLAW_BIND`. Should be empty or `0.0.0.0`. If it's `127.0.0.1`, unset it and restart. |
| LAN device sees the page, but it's blank | Browser is on a different subnet, or CSP blocking WebSocket | Open browser devtools → console. WebSocket connection errors usually mean the LAN device is on a guest network the host can't talk back to. |
| Multiple chats but only one gets replies | The bridge tracks chat IDs per known user — try sending any message from the other Telegram account first | The bridge auto-registers chat IDs on the first authorized message. |
| Service started but bot offline after reboot | Service didn't survive reboot — lingering not enabled (Linux) or KeepAlive missing (macOS) | Linux: `sudo loginctl enable-linger $USER`. macOS: confirm `KeepAlive` and `RunAtLoad` are both `<true/>` in the plist. |
| Can reach dashboard from host but not LAN | macOS Application Firewall denied `node` | System Settings → Network → Firewall → Options → set `node` to "Allow incoming connections." |
| Telegram works, dashboard works, agent does nothing | No AI provider configured | Settings → Providers → confirm at least one provider has a green status. Add a Gemini key if you skipped that in QUICKSTART. |

---

## Security checklist before you call it done

- [ ] `BOOKCLAW_AUTH_TOKEN` is set (auto-generated into `.env` on first run) — this is the primary API/WebSocket perimeter
- [ ] `BOOKCLAW_CORS_ORIGINS` is set to an explicit allowlist (unset = deny all cross-origin; do not set to `*` on a shared network)
- [ ] `BOOKCLAW_ALLOWED_IPS` configured if you want to restrict by source IP (optional; loopback is always allowed)
- [ ] Bot token is only in the vault, never pasted into a chat or a config file in plain text
- [ ] `config/.vault/vault.enc` exists and has restrictive permissions (`chmod 600 config/.vault/vault.enc`)
- [ ] `.env` exists and has `chmod 600`
- [ ] Telegram allowlist has at least one ID (never leave it empty — that means *anyone* who finds the bot can drive it)
- [ ] Host firewall allows 3847 **from your LAN subnet only**, not from `0.0.0.0/0`
- [ ] Host is on a trusted LAN — not a coffee-shop Wi-Fi, not a guest network
- [ ] If the host is a laptop that travels: either stop the service before leaving the trusted LAN, or set `BOOKCLAW_BIND=127.0.0.1` and use it locally-only until you're home again
- [ ] You know how to revoke the bot token if it leaks (`/revoke` to BotFather)

---

## Where to look next

- **[QUICKSTART.md](QUICKSTART.md)** — initial install and first task
- **[FIRST-NOVEL-GUIDE.md](FIRST-NOVEL-GUIDE.md)** — write your first novel once Telegram is wired up
- **[LAUNCH-GUIDE.md](LAUNCH-GUIDE.md)** — full server operations: Docker, VPS, ports, env vars
- **[SECURITY.md](SECURITY.md)** — vault internals, audit log, deployment posture for untrusted networks
