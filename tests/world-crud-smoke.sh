#!/usr/bin/env bash
#
# World Repository Phase 1 smoke test
# ─────────────────────────────────────
# Boots the gateway, seeds a world overlay in the real workspace/library/worlds/
# dir, then exercises the documents API (list worlds, create+auto-classify, list
# documents, get full doc, update, delete).
#
# Hermetic: loopback bind, env-supplied token, no stray process, cleans up the
# seeded world dir on EXIT (even on failure).
#
# Usage:
#   tests/world-crud-smoke.sh      # quiet
#   tests/world-crud-smoke.sh -v   # also streams the captured server log
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

HOST="127.0.0.1"
PORT="3849"
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="smoke-world-crud-token-$$"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Unique world name (PID ensures no collision with a real world or parallel run)
WORLD_NAME="smoke-world-$$"
WORLD_DIR="${ROOT_DIR}/workspace/library/worlds/${WORLD_NAME}"

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SERVER_LOG="$(mktemp)"
SERVER_PID=""
FAILED=0

log()  { printf '%s\n' "$*"; }
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

cleanup() {
  stop_server
  # Always remove the seeded world dir so the real workspace is clean
  rm -rf "${WORLD_DIR}"
  if [ "$VERBOSE" -eq 1 ] || [ "$FAILED" -ne 0 ]; then
    log ""
    log "── captured server log ──"
    cat "$SERVER_LOG"
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  kill "$SERVER_PID" 2>/dev/null
  local i
  for i in $(seq 1 25); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.2; done
  SERVER_PID=""
}

# Preflight: port must be free
if curl -s -o /dev/null --max-time 2 "${BASE}/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE} — stop it before running the smoke test."
  exit 2
fi

log "World Repository Phase 1 smoke"

# Seed the world overlay BEFORE boot so LibraryService picks it up on loadAll().
mkdir -p "${WORLD_DIR}/documents"
cat > "${WORLD_DIR}/world.json" <<JSON
{
  "schemaVersion": 1,
  "name": "${WORLD_NAME}",
  "label": "Smoke World",
  "description": "Smoke world for CI.",
  "documentTypes": [{ "id": "field-guide", "label": "Field Guide" }],
  "domains": ["GEO"],
  "clearanceLevels": ["General Access"],
  "classificationScheme": "{TYPE}-{DOMAIN}-{NNNN}",
  "formatDirective": "Narrative prose only."
}
JSON

# Boot the gateway against the real workspace (same as smoke-test.sh)
: > "$SERVER_LOG"
env BOOKCLAW_BIND="${HOST}" BOOKCLAW_PORT="${PORT}" BOOKCLAW_CHAT_PORT="$((PORT + 1))" \
    BOOKCLAW_AUTH_TOKEN="${TEST_TOKEN}" \
  node --import tsx "${ROOT_DIR}/gateway/src/index.ts" > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# Wait for readiness (mirror smoke-test.sh pattern: poll / until it serves)
for i in $(seq 1 60); do
  curl -s -o /dev/null --max-time 2 "${BASE}/" && break
  kill -0 "$SERVER_PID" 2>/dev/null || { log "ERROR: server exited during startup"; exit 1; }
  sleep 0.5
done

AUTH=(-H "Authorization: Bearer ${TEST_TOKEN}")

# 1) The seeded world appears in GET /api/worlds
WORLDS_RESP="$(curl -fsS "${AUTH[@]}" "${BASE}/api/worlds")"
echo "${WORLDS_RESP}" | grep -q "\"${WORLD_NAME}\"" \
  && pass "world listed in GET /api/worlds" \
  || { fail "world not listed (got: ${WORLDS_RESP})"; }

# 2) POST /api/worlds/:name/documents → creates + auto-classifies FG-GEO-0001
CREATED="$(curl -fsS "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -X POST "${BASE}/api/worlds/${WORLD_NAME}/documents" \
  -d "{\"meta\":{\"title\":\"Geography\",\"type\":\"field-guide\",\"clearance\":\"General Access\",\"domain\":\"GEO\",\"tags\":[\"geo\"],\"summary\":\"A guide.\"},\"body\":\"Body.\"}")"
echo "${CREATED}" | grep -q '"classification":"FG-GEO-0001"' \
  && pass "POST creates doc with auto-classification FG-GEO-0001" \
  || { fail "auto-classify FG-GEO-0001 (got: ${CREATED})"; }
DOC_ID="$(printf '%s' "${CREATED}" | sed -n 's/.*"docId":"\([^"]*\)".*/\1/p')"
[ -n "${DOC_ID}" ] \
  && pass "docId returned: ${DOC_ID}" \
  || { fail "no docId in POST response"; }

# 3) GET /api/worlds/:name/documents → catalog shows the doc (no body)
CATALOG="$(curl -fsS "${AUTH[@]}" "${BASE}/api/worlds/${WORLD_NAME}/documents")"
echo "${CATALOG}" | grep -q '"FG-GEO-0001"' \
  && pass "GET documents catalog contains FG-GEO-0001" \
  || { fail "catalog missing doc (got: ${CATALOG})"; }

# 4) GET /api/worlds/:name/documents/:docId → full doc includes body + document envelope
FULL="$(curl -fsS "${AUTH[@]}" "${BASE}/api/worlds/${WORLD_NAME}/documents/${DOC_ID}")"
echo "${FULL}" | grep -q '"body":"Body."' \
  && pass "GET full doc returns body" \
  || { fail "full read body wrong (got: ${FULL})"; }
echo "${FULL}" | grep -q '"document"' \
  && pass "GET full doc wrapped in document envelope" \
  || { fail "document envelope missing (got: ${FULL})"; }

# 5) PUT /api/worlds/:name/documents/:docId → update persists
UPDATED="$(curl -fsS "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -X PUT "${BASE}/api/worlds/${WORLD_NAME}/documents/${DOC_ID}" \
  -d "{\"meta\":{\"title\":\"Geography\",\"type\":\"field-guide\",\"classification\":\"FG-GEO-0001\",\"clearance\":\"General Access\",\"domain\":\"GEO\",\"tags\":[\"geo\"],\"summary\":\"Revised.\"},\"body\":\"Body two.\"}")"
echo "${UPDATED}" | grep -q '"summary":"Revised."' \
  && pass "PUT update persists revised summary" \
  || { fail "update did not persist (got: ${UPDATED})"; }

# 6a) DELETE /api/worlds/:name/documents/:docId → deleted:true
DELETED="$(curl -fsS "${AUTH[@]}" -X DELETE "${BASE}/api/worlds/${WORLD_NAME}/documents/${DOC_ID}")"
echo "${DELETED}" | grep -q '"deleted":true' \
  && pass "DELETE returns deleted:true" \
  || { fail "delete failed (got: ${DELETED})"; }

# 6b) catalog no longer contains the doc
AFTER_DEL="$(curl -fsS "${AUTH[@]}" "${BASE}/api/worlds/${WORLD_NAME}/documents")"
echo "${AFTER_DEL}" | grep -q '"FG-GEO-0001"' \
  && { fail "doc still present in catalog after delete"; } \
  || pass "catalog empty after delete"

stop_server

log ""
if [ "$FAILED" -eq 0 ]; then
  log "PASS: world documents CRUD smoke (8 checks)"
  exit 0
fi
log "FAIL: world documents CRUD smoke — see output above"
exit 1
