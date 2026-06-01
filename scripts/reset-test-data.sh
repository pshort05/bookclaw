#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — reset runtime data for a clean/fresh test
# ═══════════════════════════════════════════════════════════
# Empties the workspace volume (all projects, context, memory,
# conversations, soul/author identity, logs, exports, audio/images,
# costs) so the next run starts from a true blank slate — while KEEPING
# your settings:
#
#   KEPT  : API keys          → the separate `bookclaw-vault` volume is never touched
#   KEPT  : app config         → config/user.json + default.json + research-allowlist.json
#                                are baked into the image, not in the wiped volume
#   WIPED : everything under the workspace volume (/app/workspace)
#
# Mechanism (surgical — same container, no rebuild):
#   1. stop the container         (so nothing rewrites state mid-wipe)
#   2. empty the workspace volume (via a throwaway container on the same image)
#   3. start the container        (the gateway recreates a fresh workspace tree on init)
#
# Run this on the Docker host (Mercury), or remotely:
#   ssh mercury bash /home/paul/data/dev/bookclaw/scripts/reset-test-data.sh
#
# Options / env:
#   -y, --yes           skip the confirmation prompt (for scripted/CI use)
#   CONTAINER=bookclaw  target container name (default: bookclaw)
# ═══════════════════════════════════════════════════════════
set -euo pipefail

CONTAINER="${CONTAINER:-bookclaw}"
ASSUME_YES=0
[ "${1:-}" = "-y" ] || [ "${1:-}" = "--yes" ] && ASSUME_YES=1

die() { echo "  ✗ $*" >&2; exit 1; }

# ── Preflight ──
command -v docker >/dev/null 2>&1 || die "docker not found on this host."
docker inspect "$CONTAINER" >/dev/null 2>&1 \
  || die "container '$CONTAINER' not found. Deploy it first (scripts/deploy.sh)."

# Resolve the two volumes straight from the container's mounts so we never
# guess names: the workspace volume is the wipe target; the vault volume is
# only resolved to prove (and display) that it is left alone.
WS_VOL=$(docker inspect "$CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/app/workspace"}}{{.Name}}{{end}}{{end}}')
VAULT_VOL=$(docker inspect "$CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/app/config/.vault"}}{{.Name}}{{end}}{{end}}')
IMAGE=$(docker inspect "$CONTAINER" --format '{{.Config.Image}}')

[ -n "$WS_VOL" ] || die "could not resolve the /app/workspace volume for '$CONTAINER'."

echo ""
echo "  BookClaw — reset test data"
echo "  ═══════════════════════════════════════"
echo "  KEEP  vault (API keys) : ${VAULT_VOL:-<none>}"
echo "  KEEP  app config       : baked into image $IMAGE (config/*.json)"
echo "  WIPE  workspace volume : $WS_VOL"
echo "        (projects, memory, soul/identity, logs, exports, costs — all of it)"
echo "  ═══════════════════════════════════════"
echo ""

if [ "$ASSUME_YES" -ne 1 ]; then
  printf "  Type RESET to confirm: "
  read -r reply
  [ "$reply" = "RESET" ] || die "aborted — nothing changed."
fi

# ── 1. Stop the container so it cannot rewrite state during the wipe ──
echo "  [1/3] Stopping $CONTAINER..."
docker stop "$CONTAINER" >/dev/null
echo "  ✓ stopped"

# ── 2. Empty the workspace volume (throwaway container, reuses the app image — no pull) ──
echo "  [2/3] Emptying workspace volume $WS_VOL..."
# --entrypoint bypasses the image's docker-entrypoint wrapper so find runs directly.
docker run --rm --entrypoint find -v "$WS_VOL":/w "$IMAGE" /w -mindepth 1 -delete
echo "  ✓ workspace volume emptied (vault untouched)"

# ── 3. Start the container — gateway recreates a fresh workspace tree on init ──
echo "  [3/3] Starting $CONTAINER..."
docker start "$CONTAINER" >/dev/null

# Wait for the health check to go green (compose healthcheck hits /api/status).
echo -n "  ⏳ waiting for healthy"
for _ in $(seq 1 30); do
  status=$(docker inspect "$CONTAINER" --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)
  if [ "$status" = "healthy" ]; then echo " — ✓ healthy"; break; fi
  echo -n "."
  sleep 2
done
[ "$status" = "healthy" ] || { echo ""; die "container did not become healthy — check: docker logs $CONTAINER"; }

# ── Verify the slate is clean (best-effort; never fails the reset) ──
TOKEN=$(docker exec "$CONTAINER" sh -c 'grep "^BOOKCLAW_AUTH_TOKEN=" /app/.env | cut -d= -f2- | tr -d "\r\""' 2>/dev/null || true)
if [ -n "$TOKEN" ]; then
  # `|| true` keeps the no-match case (0 projects → grep exits 1 under pipefail)
  # from aborting; the count still comes from wc.
  COUNT=$( { docker exec "$CONTAINER" sh -c \
    "wget -qO- --header='Authorization: Bearer $TOKEN' http://localhost:3847/api/projects/list 2>/dev/null" \
    | grep -o '\"id\"' | wc -l | tr -d ' '; } || true )
  echo "  ℹ projects after reset: ${COUNT:-?}"
fi

echo ""
echo "  ✓ Clean slate ready. API keys and config preserved."
echo ""
