#!/usr/bin/env bash
#
# BookClaw smoke test
# ─────────────────────
# Boots the gateway and verifies that bearer-token auth (security review item #1)
# is enforced. Covers startup, the /api/* gate, the dashboard token injection,
# and the BOOKCLAW_AUTH_DISABLED=1 escape hatch.
#
# Hermetic and non-destructive:
#   - Supplies BOOKCLAW_AUTH_TOKEN via the environment, so the server uses a
#     known token and never generates/writes one to .env.
#   - Binds 127.0.0.1 only (never exposes the LAN, even in the auth-disabled phase).
#   - Uses the project's normal vault-key handling and does not modify .env.
#
# Usage:
#   tests/smoke-test.sh        # quiet — prints [PASS]/[FAIL] per check
#   tests/smoke-test.sh -v     # verbose — also streams the captured server log
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

# This suite boots its OWN gateway with various startup env (auth on/off, CORS,
# IP allowlist), so it is inherently LOCAL — it cannot target a remote gateway
# like Mercury (that would need control of the remote's startup env). PORT is
# overridable so it can boot on a free port when the default 3847 is occupied
# locally, e.g. `PORT=3947 tests/smoke-test.sh`.
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3847}"
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="smoke-test-token-0123456789abcdef"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

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
  if [ "$VERBOSE" -eq 1 ] || [ "$FAILED" -ne 0 ]; then
    log ""
    log "── captured server log ──"
    cat "$SERVER_LOG"
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

# code <curl-args...> : print the HTTP status code for a request
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$@"; }

# acao <origin> <curl-args...> : print the Access-Control-Allow-Origin response
# header the server returns for a request carrying that Origin (empty if none).
acao() {
  local origin="$1"; shift
  curl -s -D - -o /dev/null --max-time 5 -H "Origin: $origin" "$@" \
    | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}'
}

# rheader <name> <curl-args...> : print the named response header's value (empty if absent)
rheader() {
  local name="$1"; shift
  curl -s -D - -o /dev/null --max-time 5 "$@" \
    | tr -d '\r' | awk -v n="$(printf '%s' "$name" | tr 'A-Z' 'a-z')" \
        -F': ' 'tolower($1)==n{sub(/^[^:]*: /,"");print}'
}

# start_server <extra-env=val...> : launch the gateway and wait until it serves
start_server() {
  : > "$SERVER_LOG"
  env BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" BOOKCLAW_CHAT_PORT="$((PORT + 1))" "$@" \
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

# ════════════════════════════════════════════════════════════
log "BookClaw smoke test"

# Preflight: the port must be free so we test our own process, not a stray one.
if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE} — stop it before running the smoke test."
  exit 2
fi

# ── Phase 1: auth ENABLED ──
log ""
log "Phase 1: startup + bearer-token auth enforced"
start_server BOOKCLAW_AUTH_TOKEN="$TEST_TOKEN" || exit 1
pass "server started and serves ${BASE}/"

[ "$(code "$BASE/api/status")" = "401" ] \
  && pass "no token -> 401" || fail "no token should be 401"

[ "$(code -H "Authorization: Bearer $TEST_TOKEN" "$BASE/api/status")" = "200" ] \
  && pass "valid bearer -> 200" || fail "valid bearer should be 200"

[ "$(code "$BASE/api/status?token=$TEST_TOKEN")" = "200" ] \
  && pass "valid ?token= query -> 200" || fail "valid ?token= query should be 200"

[ "$(code -H "Authorization: Bearer wrong-token" "$BASE/api/status")" = "401" ] \
  && pass "wrong token -> 401" || fail "wrong token should be 401"

HTML="$(curl -s --max-time 5 "$BASE/")"
case "$HTML" in
  *"__BOOKCLAW_AUTH_TOKEN__"*) fail "dashboard still contains the unsubstituted token placeholder" ;;
  *"$TEST_TOKEN"*)               pass "dashboard / serves with token injected" ;;
  *)                             fail "dashboard / missing injected token" ;;
esac

# Chat-app port injection (F46): the studio HTML carries BOOKCLAW_CHAT_PORT so the
# Rail's Chat link targets the right port. start_server sets it to PORT+1; the
# placeholder VALUE must be substituted while the global name is left intact.
case "$HTML" in
  *"__BOOKCLAW_CHAT_PORT_VALUE__"*)                   fail "dashboard still contains the unsubstituted chat-port placeholder" ;;
  *"window.__BOOKCLAW_CHAT_PORT__='$((PORT + 1))'"*)  pass "dashboard / serves with chat port injected" ;;
  *)                                                  fail "dashboard / missing injected chat port ($((PORT + 1)))" ;;
esac

# Workspace schema marker: phase-01-config stamps .bookclaw/workspace.json on boot.
MARKER="$ROOT_DIR/workspace/.bookclaw/workspace.json"
{ [ -f "$MARKER" ] && grep -q '"schemaVersion"' "$MARKER"; } \
  && pass "workspace schema marker stamped (.bookclaw/workspace.json)" \
  || fail "workspace schema marker missing or malformed"

# CORS unset -> deny: a cross-origin request gets no Access-Control-Allow-Origin.
[ -z "$(acao "http://evil.example" -H "Authorization: Bearer $TEST_TOKEN" "$BASE/api/status")" ] \
  && pass "CORS: cross-origin denied by default (no Access-Control-Allow-Origin)" \
  || fail "CORS: disallowed origin unexpectedly got an Access-Control-Allow-Origin"

# CSP: connect-src is tightened to 'self' (no permissive "*"). The dashboard only
# ever fetches its own origin, so the directive must be exactly "connect-src 'self'".
CSP="$(rheader content-security-policy "$BASE/")"
case "$CSP" in
  *"connect-src 'self';"*|*"connect-src 'self'") pass "CSP: connect-src is 'self'" ;;
  *)                                             fail "CSP: connect-src not tightened to 'self' (got: $CSP)" ;;
esac
case "$CSP" in
  *"connect-src"*"*"*) fail "CSP: connect-src still contains a permissive '*'" ;;
  *)                   pass "CSP: connect-src has no permissive '*'" ;;
esac

stop_server

# ── Phase 2: auth DISABLED escape hatch ──
log ""
log "Phase 2: BOOKCLAW_AUTH_DISABLED=1 escape hatch"
start_server BOOKCLAW_AUTH_DISABLED=1 || exit 1

grep -q "AUTH DISABLED" "$SERVER_LOG" \
  && pass "startup prints the AUTH DISABLED warning" || fail "missing AUTH DISABLED warning"

[ "$(code "$BASE/api/status")" = "200" ] \
  && pass "auth disabled, no token -> 200" || fail "auth disabled should allow 200"

stop_server

# ── Phase 3: CORS allowlist (BOOKCLAW_CORS_ORIGINS) ──
log ""
log "Phase 3: CORS allowlist"
ALLOWED="http://allowed.test:9999"
start_server BOOKCLAW_AUTH_TOKEN="$TEST_TOKEN" BOOKCLAW_CORS_ORIGINS="$ALLOWED" || exit 1

[ "$(acao "$ALLOWED" -H "Authorization: Bearer $TEST_TOKEN" "$BASE/api/status")" = "$ALLOWED" ] \
  && pass "CORS: listed origin echoed in Access-Control-Allow-Origin" \
  || fail "CORS: listed origin not echoed"

[ -z "$(acao "http://other.test:1234" -H "Authorization: Bearer $TEST_TOKEN" "$BASE/api/status")" ] \
  && pass "CORS: unlisted origin gets no Access-Control-Allow-Origin" \
  || fail "CORS: unlisted origin unexpectedly allowed"

stop_server

# ── Phase 4: source-IP allowlist (BOOKCLAW_ALLOWED_IPS + trust-proxy) ──
# Trust-proxy lets us drive the client IP via X-Forwarded-For so allow/deny is
# deterministic from loopback. Allowlist = one exact IP + one CIDR.
log ""
log "Phase 4: source-IP allowlist"
start_server BOOKCLAW_AUTH_TOKEN="$TEST_TOKEN" \
             BOOKCLAW_ALLOWED_IPS="203.0.113.7,10.0.0.0/24" \
             BOOKCLAW_TRUST_PROXY=1 || exit 1
AUTHH=(-H "Authorization: Bearer $TEST_TOKEN")

grep -q "IP allowlist: 2 rule(s) enforced" "$SERVER_LOG" \
  && pass "startup logs the enforced allowlist" || fail "missing IP-allowlist enforcement log"

[ "$(code "${AUTHH[@]}" -H "X-Forwarded-For: 203.0.113.7" "$BASE/api/status")" = "200" ] \
  && pass "listed IP (via XFF) -> 200" || fail "listed IP should be 200"

[ "$(code "${AUTHH[@]}" -H "X-Forwarded-For: 10.0.0.55" "$BASE/api/status")" = "200" ] \
  && pass "IP inside listed CIDR -> 200" || fail "CIDR member should be 200"

[ "$(code "${AUTHH[@]}" -H "X-Forwarded-For: 203.0.113.9" "$BASE/api/status")" = "403" ] \
  && pass "unlisted IP -> 403 (in front of auth, even with valid token)" || fail "unlisted IP should be 403"

[ "$(code "${AUTHH[@]}" "$BASE/api/status")" = "200" ] \
  && pass "loopback (no XFF) always allowed (recovery path)" || fail "loopback should be allowed"

stop_server

# ── Phase 5: API rate limiting (BOOKCLAW_RATELIMIT_* + trust-proxy) ──
# Trust-proxy lets us drive the client IP via X-Forwarded-For, so each test IP is a
# distinct, non-loopback bucket (loopback is exempt). Low limits make it fast:
# 3 unauthenticated / 5 authenticated requests per window.
log ""
log "Phase 5: API rate limiting"
start_server BOOKCLAW_AUTH_TOKEN="$TEST_TOKEN" \
             BOOKCLAW_TRUST_PROXY=1 \
             BOOKCLAW_RATELIMIT_UNAUTH=3 \
             BOOKCLAW_RATELIMIT_AUTH=5 \
             BOOKCLAW_RATELIMIT_WINDOW_MS=60000 || exit 1

grep -q "API rate limiting: 3 unauth / 5 auth per 60s window" "$SERVER_LOG" \
  && pass "startup logs the rate-limit posture" || fail "missing rate-limit posture log"

# Unauthenticated bucket (no token, distinct non-loopback IP): the first 3 are under
# the strict limit and get the usual 401; the 4th trips the limiter with a 429.
RLIP_A="198.51.100.10"
c=""
for i in 1 2 3; do c="$(code -H "X-Forwarded-For: $RLIP_A" "$BASE/api/status")"; done
[ "$c" = "401" ] \
  && pass "anon under strict limit -> 401 (not yet limited)" || fail "anon under limit should be 401 (got $c)"
[ "$(code -H "X-Forwarded-For: $RLIP_A" "$BASE/api/status")" = "429" ] \
  && pass "anon over strict limit -> 429" || fail "anon over strict limit should be 429"
RA="$(rheader retry-after -H "X-Forwarded-For: $RLIP_A" "$BASE/api/status")"
[ -n "$RA" ] \
  && pass "429 carries Retry-After (${RA}s)" || fail "429 should carry a Retry-After header"

# Authenticated bucket (valid token, different IP): generous limit is separate from
# the anon bucket — sails past the strict (3) limit, only 429s past the generous (5).
RLIP_B="198.51.100.20"
c=""
for i in 1 2 3 4 5; do c="$(code -H "Authorization: Bearer $TEST_TOKEN" -H "X-Forwarded-For: $RLIP_B" "$BASE/api/status")"; done
[ "$c" = "200" ] \
  && pass "authed past the unauth limit still 200 (separate, generous bucket)" || fail "authed within limit should be 200 (got $c)"
[ "$(code -H "Authorization: Bearer $TEST_TOKEN" -H "X-Forwarded-For: $RLIP_B" "$BASE/api/status")" = "429" ] \
  && pass "authed over generous limit -> 429" || fail "authed over generous limit should be 429"

# Loopback is exempt: hammering past the strict limit never yields a 429.
c=""
for i in 1 2 3 4 5; do c="$(code "$BASE/api/status")"; done
[ "$c" = "401" ] \
  && pass "loopback exempt (never 429, stays 401 with no token)" || fail "loopback should be exempt from rate limiting (got $c)"

stop_server

# ── Phase 6: model catalog endpoints (claude/gemini live picker) ──
# The studio exact-model pickers fetch /api/models/<provider>. claude/gemini are
# gated by auth and fall back to a pre-seeded list when no API key is configured
# (or a live fetch fails), so the response is always a non-empty {id,name} array —
# never a 5xx. BOOKCLAW_MODELS_OFFLINE=1 keeps this phase hermetic: the gateway
# serves the seed list and never touches the Anthropic/Google network, regardless
# of whether a key is present in the dev/CI vault.
log ""
log "Phase 6: model catalog endpoints"
start_server BOOKCLAW_AUTH_TOKEN="$TEST_TOKEN" BOOKCLAW_MODELS_OFFLINE=1 || exit 1

# models_ok <url> : 0 if the JSON body is {models:[{id,name},...]} with >=1 entry.
models_ok() {
  curl -s --max-time 5 -H "Authorization: Bearer $TEST_TOKEN" "$1" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const m=JSON.parse(s).models;
        process.exit(Array.isArray(m) && m.length>0 &&
          m.every(e=>typeof e.id==="string" && e.id && typeof e.name==="string") ? 0 : 1);
      } catch { process.exit(1); }
    });'
}

for prov in claude gemini; do
  [ "$(code "$BASE/api/models/$prov")" = "401" ] \
    && pass "models/$prov: no token -> 401" || fail "models/$prov should be 401 without token"
  [ "$(code -H "Authorization: Bearer $TEST_TOKEN" "$BASE/api/models/$prov")" = "200" ] \
    && pass "models/$prov: valid bearer -> 200" || fail "models/$prov should be 200 with token"
  if models_ok "$BASE/api/models/$prov"; then
    pass "models/$prov: returns a non-empty {id,name} list (seed or live)"
  else
    fail "models/$prov: missing non-empty {id,name} models array"
  fi
done

stop_server

# ── Result ──
log ""
if [ "$FAILED" -eq 0 ]; then
  log "All smoke checks passed."
  exit 0
fi
log "Smoke test FAILED."
exit 1
