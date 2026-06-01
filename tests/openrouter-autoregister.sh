#!/usr/bin/env bash
#
# BookClaw — OpenRouter key auto-registration test
# ─────────────────────────────────────────────────
# Guards the regression fixed in settings.routes.ts: storing an OpenRouter API
# key via `POST /api/vault` must register the OpenRouter provider immediately,
# without a manual `POST /api/providers/refresh` or a restart. The bug was that
# `openrouter_api_key` was missing from the handler's `apiKeyNames` list, so the
# auto-refresh never fired for it.
#
# Hermetic and non-destructive:
#   - Binds 127.0.0.1 only and supplies BOOKCLAW_AUTH_TOKEN via the environment
#     (no .env write), mirroring tests/smoke-test.sh.
#   - Uses a DUMMY key value — provider registration is key-PRESENCE only
#     (ai/router.ts registers OpenRouter whenever the key exists; no network
#     call at registration), so no real credential or API call is needed.
#   - Refuses to touch a real key: if openrouter_api_key is already in the vault,
#     the write/delete path is skipped (it would clobber the real key) and the
#     test degrades to asserting the provider is registered.
#   - On exit, deletes the dummy key and — if this run created the vault file —
#     removes it, leaving the vault exactly as it was found.
#
# Usage:
#   tests/openrouter-autoregister.sh        # quiet — [PASS]/[FAIL] per check
#   tests/openrouter-autoregister.sh -v     # verbose — also streams the server log
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

HOST=127.0.0.1
PORT=3847
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="openrouter-autoreg-token-0123456789ab"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT_FILE="$ROOT_DIR/config/.vault/vault.enc"

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SERVER_LOG="$(mktemp)"
SERVER_PID=""
FAILED=0
DUMMY_STORED=0
VAULT_PREEXISTED=0
[ -f "$VAULT_FILE" ] && VAULT_PREEXISTED=1

AUTH=(-H "Authorization: Bearer $TEST_TOKEN")

log()  { printf '%s\n' "$*"; }
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

# status_has_openrouter : 0 if /api/status lists a provider with id "openrouter"
status_has_openrouter() {
  curl -s --max-time 5 "${AUTH[@]}" "$BASE/api/status" | grep -q '"id":"openrouter"'
}

# vault_has_openrouter : 0 if the vault already holds openrouter_api_key
vault_has_openrouter() {
  curl -s --max-time 5 "${AUTH[@]}" "$BASE/api/vault/keys" | grep -q '"openrouter_api_key"'
}

start_server() {
  : > "$SERVER_LOG"
  env BOOKCLAW_BIND="$HOST" BOOKCLAW_AUTH_TOKEN="$TEST_TOKEN" \
    node --import tsx "$ROOT_DIR/gateway/src/index.ts" > "$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  local i
  for i in $(seq 1 60); do
    curl -s -o /dev/null --max-time 2 "$BASE/" && return 0
    kill -0 "$SERVER_PID" 2>/dev/null || { log "ERROR: server exited during startup"; return 1; }
    sleep 0.5
  done
  log "ERROR: server did not become ready within timeout"
  return 1
}

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  kill "$SERVER_PID" 2>/dev/null
  local i
  for i in $(seq 1 25); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.2; done
  SERVER_PID=""
}

cleanup() {
  # Remove the dummy key while the server is still up (best effort).
  if [ "$DUMMY_STORED" -eq 1 ] && [ -n "$SERVER_PID" ]; then
    curl -s -o /dev/null --max-time 5 "${AUTH[@]}" -X DELETE "$BASE/api/vault/openrouter_api_key" || true
  fi
  stop_server
  # If this run created the vault file, remove it to leave the tree untouched.
  [ "$VAULT_PREEXISTED" -eq 0 ] && rm -f "$VAULT_FILE"
  if [ "$VERBOSE" -eq 1 ] || [ "$FAILED" -ne 0 ]; then
    log ""
    log "── captured server log ──"
    cat "$SERVER_LOG"
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

# ════════════════════════════════════════════════════════════
log "BookClaw OpenRouter auto-registration test"

# Preflight: the port must be free so we test our own process.
if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE} — stop it before running this test."
  exit 2
fi

start_server || exit 1
pass "server started and serves ${BASE}/"

if vault_has_openrouter; then
  # A real key is present — do not clobber it. Just assert it registered.
  log "  (openrouter_api_key already in vault — skipping the store/delete path)"
  status_has_openrouter \
    && pass "existing OpenRouter key is registered in /api/status" \
    || fail "existing OpenRouter key is NOT registered in /api/status"
else
  # Clean baseline: no OpenRouter key, so the provider must be absent first —
  # proving the POST below is what registers it.
  status_has_openrouter \
    && fail "OpenRouter unexpectedly present before storing a key" \
    || pass "baseline: OpenRouter not registered (no key stored yet)"

  # Store a dummy key (presence is all the router needs to register it).
  store_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${AUTH[@]}" \
    -H 'Content-Type: application/json' \
    -d '{"key":"openrouter_api_key","value":"sk-or-dummy-autoreg-test-key"}' \
    "$BASE/api/vault")"
  [ "$store_code" = "200" ] \
    && { DUMMY_STORED=1; pass "POST /api/vault stored openrouter_api_key (200)"; } \
    || fail "POST /api/vault should return 200 (got $store_code)"

  # The fix: registration happens on save, with NO manual refresh call.
  status_has_openrouter \
    && pass "OpenRouter registered in /api/status without a manual refresh" \
    || fail "OpenRouter NOT registered after save — apiKeyNames regression"
fi

# ── Result ──
log ""
if [ "$FAILED" -eq 0 ]; then
  log "All checks passed."
  exit 0
fi
log "OpenRouter auto-registration test FAILED."
exit 1
