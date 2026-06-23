#!/usr/bin/env bash
# Idempotent installer: run the BookClaw MCP server as a systemd USER service
# (localhost-only Streamable HTTP). Safe to re-run after a git pull or node upgrade.
#
# Optional env overrides on first run (used to fill the secret env file):
#   BOOKCLAW_AUTH_TOKEN=...  BOOKCLAW_MCP_TOKEN=...  BOOKCLAW_BASE_URL=...
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$REPO/deploy"

NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "ERROR: node not found on PATH" >&2; exit 1; }
NODE="$(readlink -f "$NODE")"

CFG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/bookclaw-mcp"
ENVFILE="$CFG_DIR/bookclaw-mcp.env"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/bookclaw-mcp.service"

mkdir -p "$CFG_DIR" "$UNIT_DIR"

# 1) Secret env file — create once, never clobber an existing edited copy.
if [ ! -f "$ENVFILE" ]; then
  echo "Creating $ENVFILE (chmod 600)"
  cp "$DEPLOY/bookclaw-mcp.env.example" "$ENVFILE"
  chmod 600 "$ENVFILE"

  AUTH="${BOOKCLAW_AUTH_TOKEN:-}"
  # Vendored at <bookclaw>/mcp, so the gateway's .env is one level up at $REPO/../.env.
  if [ -z "$AUTH" ] && [ -f "$REPO/../.env" ]; then
    AUTH="$(grep -hoE '^BOOKCLAW_AUTH_TOKEN=.+' "$REPO/../.env" | head -1 | cut -d= -f2- | tr -d '"'\''\r' || true)"
  fi
  MCPTOK="${BOOKCLAW_MCP_TOKEN:-}"
  [ -n "$MCPTOK" ] || MCPTOK="$(openssl rand -hex 24)"
  BASEURL="${BOOKCLAW_BASE_URL:-}"

  [ -n "$AUTH" ]    && sed -i "s|^BOOKCLAW_AUTH_TOKEN=.*|BOOKCLAW_AUTH_TOKEN=$AUTH|"    "$ENVFILE"
  sed -i "s|^BOOKCLAW_MCP_TOKEN=.*|BOOKCLAW_MCP_TOKEN=$MCPTOK|" "$ENVFILE"
  [ -n "$BASEURL" ] && sed -i "s|^BOOKCLAW_BASE_URL=.*|BOOKCLAW_BASE_URL=$BASEURL|"     "$ENVFILE"

  [ -n "$AUTH" ] || echo "  ⚠ BOOKCLAW_AUTH_TOKEN is blank — edit $ENVFILE before the server can reach BookClaw."
else
  echo "Keeping existing $ENVFILE (not overwriting secrets)"
fi

# 2) Render the unit from the template with detected paths.
sed -e "s|@NODE@|$NODE|g" -e "s|@REPO@|$REPO|g" -e "s|@ENVFILE@|$ENVFILE|g" \
  "$DEPLOY/bookclaw-mcp.service" > "$UNIT"
echo "Installed unit: $UNIT  (node: $NODE)"

# 3) Enable + (re)start to pick up the current unit/env.
systemctl --user daemon-reload
systemctl --user enable bookclaw-mcp.service >/dev/null 2>&1 || true
systemctl --user restart bookclaw-mcp.service

sleep 1
systemctl --user --no-pager --output=short status bookclaw-mcp.service | head -n 12 || true
echo
echo "Done. Follow logs with:  journalctl --user -u bookclaw-mcp -f"
