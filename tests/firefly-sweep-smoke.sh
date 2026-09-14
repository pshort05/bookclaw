#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — consistency-feedback smoke
# ═══════════════════════════════════════════════════════════
# Proves the three behaviours from the 2026-09-14 Firefly Pond review sweep:
#
#   1. the canon gate's Accept/Reject writes a decision that is read back, and
#      accepting a place changes NOTHING except that the phrase stops being
#      reported (it must never become a swap target or an anchor)
#   2. a place with no candidates is reported as unverifiable, not drifted
#   3. "apply to every <role>" — a book role pin beats a pipeline-baked pin, so
#      a chapter expanded AFTER the author pinned the role uses the new model
#
# None of these has an HTTP surface, so this drives the real modules directly.
# The same assertions run two ways:
#
#   LOCAL  (default) — against the SOURCE tree via tsx
#   REMOTE           — inside a DEPLOYED container, against its built `dist/`,
#                      which is what proves the shipped artifact has the fix
#                      rather than just the repo on disk
#
# Zero AI calls, zero network, zero writes — safe against production.
#
# Usage:
#   tests/firefly-sweep-smoke.sh
#   BOOKCLAW_SMOKE_HOST=192.168.1.32 tests/firefly-sweep-smoke.sh
#   BOOKCLAW_SMOKE_HOST=192.168.1.28 BOOKCLAW_SMOKE_CONTAINER=bookclaw-writing \
#     tests/firefly-sweep-smoke.sh
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESS_REL="tests/harness/firefly-sweep-check.mjs"
HOST="${BOOKCLAW_SMOKE_HOST:-}"
CONTAINER="${BOOKCLAW_SMOKE_CONTAINER:-bookclaw}"

if [ -z "$HOST" ]; then
  echo "BookClaw firefly-sweep smoke — LOCAL (source tree)"
  echo
  cd "$ROOT" || exit 2
  npx tsx "$HARNESS_REL" gateway/src
  exit $?
fi

echo "BookClaw firefly-sweep smoke — REMOTE ${HOST} (container ${CONTAINER}, built dist)"
echo

ssh -o ConnectTimeout=10 "paul@${HOST}" "docker ps --filter name=^${CONTAINER}\$ --format '{{.Names}}'" \
  | grep -q "^${CONTAINER}$" || { echo "ERROR: container ${CONTAINER} is not running on ${HOST}" >&2; exit 2; }

# The repo tree is shared with the hosts, so the harness is already on disk
# there; run it with the container's own node against the image's dist/.
ssh "paul@${HOST}" "docker exec ${CONTAINER} test -f /app/dist/gateway/src/services/canon-accept.js" \
  || { echo "ERROR: the deployed image predates this sweep (canon-accept.js missing from dist) — redeploy first" >&2; exit 1; }

ssh "paul@${HOST}" "docker cp ${ROOT}/${HARNESS_REL} ${CONTAINER}:/tmp/firefly-sweep-check.mjs \
  && docker exec ${CONTAINER} node /tmp/firefly-sweep-check.mjs /app/dist/gateway/src; \
  rc=\$?; docker exec ${CONTAINER} rm -f /tmp/firefly-sweep-check.mjs >/dev/null 2>&1; exit \$rc"
