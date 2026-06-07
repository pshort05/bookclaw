#!/bin/bash
# ═══════════════════════════════════════════════════════════
# BookClaw Docker Deployment Script
# Run this INSIDE the VM from ~/bookclaw/
# ═══════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo ""
echo "  ✍️  BookClaw Docker Deploy"
echo "  ═══════════════════════════════════════"
echo ""

# ── Pre-flight checks ──
if ! command -v docker &> /dev/null; then
    echo "  ✗ Docker not found. Run vm-setup.sh first."
    exit 1
fi

if ! docker info &> /dev/null 2>&1; then
    echo "  ✗ Docker daemon not running or user not in docker group."
    echo "    Try: sudo systemctl start docker"
    echo "    Or:  newgrp docker"
    exit 1
fi

# ── Check for vault key ──
if [ -z "$BOOKCLAW_VAULT_KEY" ]; then
    echo "  ⚠ BOOKCLAW_VAULT_KEY not set."
    echo "    Generating a random vault key for this deployment."
    echo "    To persist vault data across deploys, set it explicitly:"
    echo "    export BOOKCLAW_VAULT_KEY='your-secure-passphrase'"
    echo ""
    BOOKCLAW_VAULT_KEY=$(openssl rand -hex 32)
fi

# ── Resolve a STABLE auth token (mirrors the vault key) ──
# Without this each fresh container auto-generates a new BOOKCLAW_AUTH_TOKEN,
# so every redeploy invalidates open dashboard tabs (401 until hard-reload).
# Prefer the env (build-watch sources the repo .env), then the repo .env file,
# else generate one and persist it to the repo .env so it is stable thereafter.
if [ -z "$BOOKCLAW_AUTH_TOKEN" ]; then
    if grep -q '^BOOKCLAW_AUTH_TOKEN=' .env 2>/dev/null; then
        BOOKCLAW_AUTH_TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' .env | head -1 | cut -d= -f2- | tr -d '"')
    else
        BOOKCLAW_AUTH_TOKEN=$(openssl rand -hex 32)
        printf '\n# BookClaw HTTP/WebSocket auth token (stable across deploys)\nBOOKCLAW_AUTH_TOKEN=%s\n' "$BOOKCLAW_AUTH_TOKEN" >> .env
        echo "  🔑 Generated BOOKCLAW_AUTH_TOKEN and saved it to .env (stable across deploys)."
    fi
fi

# ── Compute the date-time display version (V5.MM.DD.HH.MM) ──
# Stamped at deploy time so every push/build shows a fresh version; a plain
# container restart keeps this build's version. Local server time, to match the
# operator's clock. Distinct from package.json's semver.
BOOKCLAW_VERSION="V5.$(date +%m.%d.%H.%M)"

# ── Create .env for docker-compose ──
echo "  [1/4] Creating environment file..."
WORKSPACE_PATH="${BOOKCLAW_WORKSPACE_PATH:-$HOME/bookclaw-workspace}"
cat > docker/.env << EOF
BOOKCLAW_VAULT_KEY=${BOOKCLAW_VAULT_KEY}
BOOKCLAW_AUTH_TOKEN=${BOOKCLAW_AUTH_TOKEN}
AUTHOR_OS_PATH=${AUTHOR_OS_PATH:-$HOME/author-os}
BOOKCLAW_WORKSPACE_PATH=${WORKSPACE_PATH}
BOOKCLAW_VERSION=${BOOKCLAW_VERSION}
EOF
echo "  ✓ Environment file created (version ${BOOKCLAW_VERSION})"

# ── Ensure the host workspace dir exists (bind-mount target) ──
# Create it as this user (uid 1000) so the container (also uid 1000) can write.
# Otherwise Docker auto-creates it as root and the app cannot write to it.
mkdir -p "$WORKSPACE_PATH"
echo "  ✓ Workspace dir ready: $WORKSPACE_PATH"

# ── Build the image ──
echo "  [2/4] Building BookClaw Docker image..."
docker compose -f docker/docker-compose.yml build
echo "  ✓ Image built"

# ── Align bind-mount ownership with the container's app user ──
# The image runs as a baked non-root user (bookclaw, uid 999). Docker does NOT
# chown a host bind-mount the way it auto-owns a named volume, so a freshly
# created host workspace dir stays owned by the deploying user and the app (a
# different uid) can't write to it — the gateway would crash on its first mkdir
# under /app/workspace. Chown the mounted workspace to the app user via a one-off
# root container that reuses the service's mounts. Idempotent; cheap on re-runs.
echo "  Aligning workspace ownership with the container user..."
docker compose -f docker/docker-compose.yml run --rm --user 0 --no-deps \
    --entrypoint chown bookclaw -R bookclaw:bookclaw /app/workspace
echo "  ✓ Workspace ownership aligned"

# ── Start services ──
echo "  [3/4] Starting BookClaw..."
docker compose -f docker/docker-compose.yml up -d
echo "  ✓ Services started"

# ── Wait for health check ──
echo "  [4/4] Waiting for health check..."
RETRIES=0
MAX_RETRIES=30
while [ $RETRIES -lt $MAX_RETRIES ]; do
    if curl -sf http://localhost:3847/healthz > /dev/null 2>&1; then
        echo "  ✓ BookClaw is healthy!"
        break
    fi
    RETRIES=$((RETRIES + 1))
    sleep 2
done

if [ $RETRIES -eq $MAX_RETRIES ]; then
    echo "  ⚠ Health check didn't pass. Check logs:"
    echo "    docker compose -f docker/docker-compose.yml logs"
fi

echo ""
echo "  ═══════════════════════════════════════"
echo "  ✍️  BookClaw is running!"
echo "  📡 Dashboard: http://localhost:3847"
echo ""
echo "  Useful commands:"
echo "    Logs:    docker compose -f docker/docker-compose.yml logs -f"
echo "    Stop:    docker compose -f docker/docker-compose.yml down"
echo "    Restart: docker compose -f docker/docker-compose.yml restart"
echo "  ═══════════════════════════════════════"
echo ""
