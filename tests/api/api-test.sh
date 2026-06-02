#!/usr/bin/env bash
#
# BookClaw API test
# ─────────────────
# Boots the gateway and asserts the behavior and response shape of the core
# read-only REST endpoints (status, projects, config, vault key list) plus a
# couple of input-validation paths. Complements:
#   - tests/smoke-test.sh         (the security PERIMETER: auth/CORS/IP)
#   - tests/openrouter-autoregister.sh (the OpenRouter auto-register regression)
# This file is about the API CONTRACT: endpoints answer with the expected
# status codes and JSON keys.
#
# Hermetic and non-destructive (same approach as smoke-test.sh):
#   - Binds 127.0.0.1 only and supplies BOOKCLAW_AUTH_TOKEN via the environment
#     (no .env write); requests carry that bearer token.
#   - Read-only: the one POST sends an INVALID body to exercise 400 validation,
#     so nothing is persisted to the vault or workspace.
#   - Leaves no stray process.
#
# Usage:
#   tests/api/api-test.sh        # quiet — [PASS]/[FAIL] per check
#   tests/api/api-test.sh -v     # verbose — also streams the captured server log
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

HOST=127.0.0.1
PORT=3847
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="api-test-token-0123456789abcdef"
# tests/api/ → repo root is two levels up.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SERVER_LOG="$(mktemp)"
SERVER_PID=""
FAILED=0

AUTH=(-H "Authorization: Bearer $TEST_TOKEN")

log()  { printf '%s\n' "$*"; }
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

# code <curl-args...> : print the HTTP status code for a request
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$@"; }
# body <path> : print the response body for an authenticated GET
body() { curl -s --max-time 8 "${AUTH[@]}" "$BASE$1"; }

# has_status <path> <code> <label> : assert GET <path> returns <code>
has_status() {
  if [ "$(code "${AUTH[@]}" "$BASE$1")" = "$2" ]; then pass "$3"; else fail "$3 (expected $2)"; fi
}

# body_has <path> <needle> <label> : assert the response body contains <needle>
body_has() {
  case "$(body "$1")" in
    *"$2"*) pass "$3" ;;
    *)      fail "$3 (missing '$2')" ;;
  esac
}

# body_lacks <path> <needle> <label> : assert the response body does NOT contain <needle>
body_lacks() {
  case "$(body "$1")" in
    *"$2"*) fail "$3 (unexpected '$2')" ;;
    *)      pass "$3" ;;
  esac
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
  stop_server
  if [ "$VERBOSE" -eq 1 ] || [ "$FAILED" -ne 0 ]; then
    log ""
    log "── captured server log ──"
    cat "$SERVER_LOG"
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

# ════════════════════════════════════════════════════════════
log "BookClaw API test"

# Preflight: the port must be free so we test our own process.
if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE} — stop it before running this test."
  exit 2
fi

start_server || exit 1
pass "server started and serves ${BASE}/"

# ── /api/status ──
log ""
log "GET /api/status"
has_status "/api/status" "200" "status -> 200 with a valid token"
body_has   "/api/status" '"providers"' "status body reports providers"
body_has   "/api/status" '"soul"'      "status body reports soul"
body_has   "/api/status" '"skills"'    "status body reports skills"

# ── /api/projects/list ──
log ""
log "GET /api/projects/list"
has_status "/api/projects/list" "200" "projects/list -> 200"
body_has   "/api/projects/list" '"projects"' "projects/list returns a projects collection"

# ── /api/config ──
log ""
log "GET /api/config"
has_status "/api/config" "200" "config -> 200"
body_has   "/api/config" '"ai"'        "config exposes ai settings"
body_has   "/api/config" '"heartbeat"' "config exposes heartbeat settings"
# Regression guard: the footer-links 'branding' block was removed; the endpoint
# must no longer leak it (see docs/COMPLETED.md 2026-06-01).
body_lacks "/api/config" '"branding"'  "config no longer exposes the removed branding block"

# ── /api/vault/keys ──
log ""
log "GET /api/vault/keys"
has_status "/api/vault/keys" "200" "vault/keys -> 200"
body_has   "/api/vault/keys" '"keys"' "vault/keys returns a keys collection"

# ── input validation / error contracts ──
log ""
log "error contracts"
# POST /api/vault with no key/value must 400 (and persists nothing).
post_code="$(code "${AUTH[@]}" -H 'Content-Type: application/json' -d '{}' -X POST "$BASE/api/vault")"
[ "$post_code" = "400" ] \
  && pass "POST /api/vault with empty body -> 400" \
  || fail "POST /api/vault with empty body should be 400 (got $post_code)"
# Unknown API route -> 404.
has_status "/api/this-route-does-not-exist" "404" "unknown /api route -> 404"

# Per-step model override endpoint contract (no project needed for these paths):
mc() { code "${AUTH[@]}" -H 'Content-Type: application/json' -d "$1" -X POST "$BASE/api/projects/$2/steps/$3/model"; }
[ "$(mc '{"provider":"openrouter","model":"x/y"}' nope nostep)" = "404" ] \
  && pass "step model: unknown project -> 404" || fail "step model: unknown project should be 404"
[ "$(mc '{"provider":"bogus"}' any any)" = "400" ] \
  && pass "step model: invalid provider -> 400" || fail "step model: invalid provider should be 400"
LONGMODEL="$(printf 'a%.0s' $(seq 1 201))"
[ "$(mc "{\"provider\":\"openrouter\",\"model\":\"$LONGMODEL\"}" any any)" = "400" ] \
  && pass "step model: over-long model id -> 400" || fail "step model: over-long model id should be 400"
# Auth is enforced on the API (perimeter detail; smoke-test covers it in depth).
[ "$(code "$BASE/api/status")" = "401" ] \
  && pass "no token -> 401" || fail "no token should be 401"

# ── Authoring: prompts + skills editor (read + validation only; no writes,
#    so the dev workspace isn't modified) ──
log ""
log "authoring (prompts + skills)"
has_status "/api/prompts" "200" "prompts list -> 200"
body_has   "/api/prompts" '"files"' "prompts list returns files"
has_status "/api/skills" "200" "skills catalog -> 200"
body_has   "/api/skills" '"source"' "skills catalog tags each skill with a source"
has_status "/api/skills/__no-such-skill__" "404" "unknown skill -> 404"
# write/delete validation (these reject before touching disk):
pc() { code "${AUTH[@]}" -H 'Content-Type: application/json' "$@"; }
[ "$(pc -d '{"content":"x"}' -X PUT "$BASE/api/prompts/NOPE.md")" = "400" ] \
  && pass "prompt: unknown file -> 400" || fail "prompt unknown file should be 400"
[ "$(pc -d '{"category":"author","content":"---\ndescription: x\ntriggers:\n - t\n---\nb"}' -X PUT "$BASE/api/skills/BadName")" = "400" ] \
  && pass "skill: invalid name -> 400" || fail "skill invalid name should be 400"
[ "$(pc -d '{"category":"bogus","content":"---\ndescription: x\ntriggers:\n - t\n---\nb"}' -X PUT "$BASE/api/skills/tmptest")" = "400" ] \
  && pass "skill: invalid category -> 400" || fail "skill invalid category should be 400"
[ "$(pc -d '{"category":"author","content":"no frontmatter here"}' -X PUT "$BASE/api/skills/tmptest")" = "400" ] \
  && pass "skill: missing frontmatter -> 400" || fail "skill missing frontmatter should be 400"
[ "$(pc -X DELETE "$BASE/api/skills/write")" = "400" ] \
  && pass "skill: delete built-in -> 400 (read-only)" || fail "deleting a built-in skill should be 400"
[ "$(pc -X DELETE "$BASE/api/skills/__no-such-skill__")" = "404" ] \
  && pass "skill: delete unknown -> 404" || fail "deleting an unknown skill should be 404"
[ "$(pc -X POST "$BASE/api/authoring/reload")" = "200" ] \
  && pass "authoring reload -> 200" || fail "authoring reload should be 200"

# ── Result ──
log ""
if [ "$FAILED" -eq 0 ]; then
  log "All API checks passed."
  exit 0
fi
log "API test FAILED."
exit 1
