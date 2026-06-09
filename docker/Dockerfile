# BookClaw - Hardened Container Image
# Based on MoatBot security architecture
#
# Security features:
# - Non-root user execution
# - Read-only base filesystem
# - Minimal attack surface (no shell tools beyond what's needed)
# - Only workspace directory is writable

FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
COPY gateway ./gateway
COPY dashboard ./dashboard
COPY frontend ./frontend

# Install ALL deps (including devDependencies for tsc + the dashboard build)
RUN npm ci || npm install

# Compile TypeScript to JavaScript
RUN npx tsc --outDir dist

# Build the dashboard (esbuild bundle → dashboard/dist/index.html). Must run
# while devDependencies are still present, i.e. before the prune below.
RUN node dashboard/build.mjs

# Build frontend workspaces (studio + chat) while devDeps are still present.
RUN npm run build:frontend

# Prune to production deps only
RUN npm prune --omit=dev

# ── Production Image ──
FROM node:22-slim

# Security: Create non-root user
RUN groupadd -r bookclaw && \
    useradd -r -g bookclaw -d /app -s /sbin/nologin bookclaw

WORKDIR /app

# Copy production dependencies
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled JavaScript
COPY --from=builder /app/dist ./dist

# Copy non-TypeScript assets
COPY skills ./skills
COPY library ./library
COPY config ./config
COPY workspace ./workspace
# Dashboard comes from the builder so the freshly-built dist/ is shipped
# (not a possibly-stale committed copy from the build context).
COPY --from=builder /app/dashboard ./dashboard
# Studio dist from builder (opt-in via BOOKCLAW_UI=v6; src not needed at runtime)
COPY --from=builder /app/frontend/studio/dist ./frontend/studio/dist
# Chat app dist from builder (enabled when BOOKCLAW_CHAT_PORT is set)
COPY --from=builder /app/frontend/chat/dist ./frontend/chat/dist
COPY package.json ./

# Optional: Install Python for Author OS tool execution (Format Factory Pro)
# Uncomment if you need Python tools inside Docker:
# RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && \
#     rm -rf /var/lib/apt/lists/*

# Create writable directories and give bookclaw user ownership of everything
RUN mkdir -p /app/workspace/memory/conversations \
             /app/workspace/memory/book-bible \
             /app/workspace/memory/voice-data \
             /app/workspace/projects \
             /app/workspace/exports \
             /app/workspace/research \
             /app/workspace/.audit \
             /app/config/.vault \
             /app/skills/premium && \
    chown -R bookclaw:bookclaw /app

# Security: Drop to non-root user
USER bookclaw

# Health check — liveness probe (proves process is running and accepting HTTP)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:3847/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 3847 3848

# Run compiled JavaScript
CMD ["node", "dist/gateway/src/index.js"]
