#!/usr/bin/env bash
#
# BookClaw — per-stage model selection smoke test
# ────────────────────────────────────────────────
# Boots the gateway and asserts, end-to-end over the REAL HTTP API, the
# per-stage model-selection feature:
#
#   1. Default seed — a new book with no explicit model defaults to the newest
#      Sonnet sentinel (openrouter / auto:newest-sonnet).
#   2. GET  /api/books/:slug/models — returns the default + per-stage map.
#   3. POST /api/books/:slug/models — sets a per-stage (taskType) model, and a
#      new default; both survive a round-trip.
#   4. Clearing a stage (blank provider) removes it.
#   5. Input validation — a bad stage key / provider → 400.
#
# Hermetic and non-destructive: binds 127.0.0.1 only, creates one throwaway
# book and DELETEs it in the EXIT trap, and leaves no stray process.
#
# Usage:
#   tests/per-stage-models-smoke.sh        # quiet — [PASS]/[FAIL] per check
#   tests/per-stage-models-smoke.sh -v     # verbose — also streams the server log
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3847}"
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="per-stage-models-smoke-0123456789abcdef"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SERVER_LOG="$(mktemp)"
SERVER_PID=""
FAILED=0
CREATED_BOOK=""

log()  { printf '%s\n' "$*"; }
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

JSONH=(-H "Authorization: Bearer $TEST_TOKEN" -H "Content-Type: application/json")

# req METHOD PATH [BODY] → response body.
req() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s --max-time 30 "${JSONH[@]}" -X "$method" -d "$body" "$BASE$path"
  else
    curl -s --max-time 30 "${JSONH[@]}" -X "$method" "$BASE$path"
  fi
}

# reqcode METHOD PATH BODY → HTTP status code only.
reqcode() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 30 "${JSONH[@]}" -X "$1" -d "$3" "$BASE$2"
}

# pscalar <dotPath> → scalar at a dot path from the JSON response root. "" if absent.
pscalar() {
  node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let j;try{j=JSON.parse(s)}catch(e){console.log("");return}
      let cur=j;
      for(const k of process.argv[1].split(".")){ if(cur==null){console.log("");return} cur=cur[k]; }
      console.log(cur===undefined||cur===null?"":String(cur));
    })' "$1"
}

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    [ -n "$CREATED_BOOK" ] && req DELETE "/api/books/$CREATED_BOOK" >/dev/null 2>&1
  fi
  stop_server
  if [ "$VERBOSE" -eq 1 ] || [ "$FAILED" -ne 0 ]; then
    log ""; log "── captured server log ──"; cat "$SERVER_LOG"
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

start_server() {
  : > "$SERVER_LOG"
  env BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" BOOKCLAW_CHAT_PORT="$((PORT + 1))" \
      BOOKCLAW_AUTH_TOKEN="$TEST_TOKEN" \
      node --import tsx "$ROOT_DIR/gateway/src/index.ts" > "$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  local i
  for i in $(seq 1 60); do
    curl -s -o /dev/null --max-time 2 "$BASE/" && return 0
    kill -0 "$SERVER_PID" 2>/dev/null || { log "ERROR: server exited during startup"; return 1; }
    sleep 0.5
  done
  log "ERROR: server did not become ready within timeout"; return 1
}

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  kill "$SERVER_PID" 2>/dev/null
  local i
  for i in $(seq 1 25); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.2; done
  SERVER_PID=""
}

# ════════════════════════════════════════════════════════════
log "BookClaw per-stage model-selection smoke test"

if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE} — stop it first."; exit 2
fi

log ""; log "Phase 0: boot the gateway"
start_server || exit 1
pass "server started and serves ${BASE}/"

log ""; log "Phase 1: create a throwaway book (no explicit model → default seed applies)"
BOOK_BODY="$(node -e 'console.log(JSON.stringify({
  title: "Per-Stage Models Smoke " + Math.floor(Math.random()*1e6),
  author: "default", voice: "default", genre: null, pipeline: "novel-pipeline", sections: []
}))')"
BRESP="$(req POST /api/books "$BOOK_BODY")"
CREATED_BOOK="$(printf '%s' "$BRESP" | pscalar 'book.slug')"
if [ -n "$CREATED_BOOK" ]; then pass "book created (slug=$CREATED_BOOK)"; else
  fail "book create failed — resp=$(printf '%s' "$BRESP" | head -c 200)"; exit 1; fi

log ""; log "Phase 2: default seed = newest Sonnet"
MG="$(req GET "/api/books/$CREATED_BOOK/models")"
DEF_PROV="$(printf '%s' "$MG" | pscalar 'default.provider')"
DEF_MODEL="$(printf '%s' "$MG" | pscalar 'default.model')"
[ "$DEF_PROV" = "openrouter" ] && pass "default provider seeded to openrouter" || fail "default provider = '$DEF_PROV' (expected openrouter)"
[ "$DEF_MODEL" = "auto:newest-sonnet" ] && pass "default model seeded to auto:newest-sonnet" || fail "default model = '$DEF_MODEL' (expected auto:newest-sonnet)"

log ""; log "Phase 3: set a per-stage model (creative_writing)"
req POST "/api/books/$CREATED_BOOK/models" '{"stageModels":{"creative_writing":{"provider":"openrouter","model":"anthropic/claude-opus-4.8"}}}' >/dev/null
MG2="$(req GET "/api/books/$CREATED_BOOK/models")"
CW="$(printf '%s' "$MG2" | pscalar 'stageModels.creative_writing.model')"
[ "$CW" = "anthropic/claude-opus-4.8" ] && pass "creative_writing stage pinned + persisted" || fail "creative_writing model = '$CW'"

log ""; log "Phase 4: change the default model"
req POST "/api/books/$CREATED_BOOK/models" '{"default":{"provider":"openrouter","model":"anthropic/claude-sonnet-4.6"}}' >/dev/null
MG3="$(req GET "/api/books/$CREATED_BOOK/models")"
ND="$(printf '%s' "$MG3" | pscalar 'default.model')"
CW3="$(printf '%s' "$MG3" | pscalar 'stageModels.creative_writing.model')"
[ "$ND" = "anthropic/claude-sonnet-4.6" ] && pass "default model updated" || fail "default model = '$ND'"
[ "$CW3" = "anthropic/claude-opus-4.8" ] && pass "stage pin preserved across a default change" || fail "stage pin lost (='$CW3')"

log ""; log "Phase 5: clear the per-stage model (blank provider)"
req POST "/api/books/$CREATED_BOOK/models" '{"stageModels":{"creative_writing":{"provider":""}}}' >/dev/null
MG4="$(req GET "/api/books/$CREATED_BOOK/models")"
CW4="$(printf '%s' "$MG4" | pscalar 'stageModels.creative_writing.model')"
[ -z "$CW4" ] && pass "cleared stage removed" || fail "stage still present (='$CW4')"

log ""; log "Phase 6: input validation → 400"
CODE_BADKEY="$(reqcode POST "/api/books/$CREATED_BOOK/models" '{"stageModels":{"BadKey!":{"provider":"openrouter"}}}')"
CODE_BADPROV="$(reqcode POST "/api/books/$CREATED_BOOK/models" '{"default":{"provider":"not-a-provider"}}')"
[ "$CODE_BADKEY" = "400" ] && pass "invalid stage key → 400" || fail "invalid stage key → $CODE_BADKEY (expected 400)"
[ "$CODE_BADPROV" = "400" ] && pass "invalid provider → 400" || fail "invalid provider → $CODE_BADPROV (expected 400)"

log ""
if [ "$FAILED" -eq 0 ]; then log "ALL CHECKS PASSED"; else log "SOME CHECKS FAILED"; fi
exit "$FAILED"
