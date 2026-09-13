#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — consistency-feedback smoke
# ═══════════════════════════════════════════════════════════
# Proves the two consistency-feedback behaviours (design doc
# docs/superpowers/specs/2026-09-13-consistency-feedback-design.md):
#
#   1. a chapter's continuity flags reach the Rewrite prompt for the
#      deterministic romance pipelines (they did not — 113 flags on the live
#      book never reached a generation step)
#   2. a pile of contradictions force-opens a human gate
#
# Neither behaviour has an HTTP surface, so this drives the real modules with
# a project-84-shaped fixture. The same assertions run two ways:
#
#   LOCAL  (default) — against the SOURCE tree via tsx
#   REMOTE           — inside a DEPLOYED container, against its built `dist/`,
#                      which is what proves the shipped artifact has the fix
#                      rather than just the repo on disk
#
# Zero AI calls, zero network, zero writes — safe against production.
#
# Usage:
#   tests/consistency-feedback-smoke.sh
#   BOOKCLAW_SMOKE_HOST=192.168.1.32 tests/consistency-feedback-smoke.sh
#   BOOKCLAW_SMOKE_HOST=192.168.1.28 BOOKCLAW_SMOKE_CONTAINER=bookclaw-writing \
#     tests/consistency-feedback-smoke.sh
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS_REL="tests/harness/consistency-feedback-check.mjs"
HOST="${BOOKCLAW_SMOKE_HOST:-}"
CONTAINER="${BOOKCLAW_SMOKE_CONTAINER:-bookclaw}"

if [ -z "$HOST" ]; then
  echo "BookClaw consistency-feedback smoke — LOCAL (source tree)"
  echo
  cd "$ROOT" || exit 2
  npx tsx "$HARNESS_REL" gateway/src
  exit $?
fi

echo "BookClaw consistency-feedback smoke — REMOTE ${HOST} (container ${CONTAINER}, built dist)"
echo

ssh -o ConnectTimeout=10 "paul@${HOST}" "docker ps --filter name=^${CONTAINER}\$ --format '{{.Names}}'" \
  | grep -q "^${CONTAINER}$" || { echo "ERROR: container ${CONTAINER} is not running on ${HOST}" >&2; exit 2; }

# The repo tree is shared with the hosts, so the harness is already on disk
# there; run it with the container's own node against the image's dist/.
ssh "paul@${HOST}" "docker exec ${CONTAINER} test -f /app/dist/gateway/src/services/consistency/continuity-gate.js" \
  || { echo "ERROR: the deployed image predates this feature (continuity-gate.js missing from dist) — redeploy first" >&2; exit 1; }

ssh "paul@${HOST}" "docker cp ${ROOT}/${HARNESS_REL} ${CONTAINER}:/tmp/consistency-feedback-check.mjs \
  && docker exec ${CONTAINER} node /tmp/consistency-feedback-check.mjs /app/dist/gateway/src; \
  rc=\$?; docker exec ${CONTAINER} rm -f /tmp/consistency-feedback-check.mjs >/dev/null 2>&1; exit \$rc"
