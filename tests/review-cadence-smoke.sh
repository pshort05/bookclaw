#!/usr/bin/env bash
#
# BookClaw — review-gate cadence update smoke test
# ─────────────────────────────────────────────────
# Boots the gateway and asserts, end-to-end over the REAL HTTP API, that a
# book's human-review gate cadence can be READ and UPDATED after creation
# (filling the create-only gap), via the per-book config endpoint:
#
#   1. A new book has no explicit cadence — GET /api/books/:slug/models returns
#      reviewCadence "" (resolveCadence then falls back to per_act).
#   2. POST reviewCadence=per_chapter persists; GET round-trips it.
#   3. Setting the model config in the same endpoint does NOT wipe the cadence.
#   4. POST reviewCadence="" clears it (back to the per_act default).
#   5. An invalid cadence → 400.
#
# Hermetic and non-destructive: binds 127.0.0.1 only, creates one throwaway
# book and DELETEs it in the EXIT trap, and leaves no stray process.
#
# Usage:
#   tests/review-cadence-smoke.sh        # quiet — [PASS]/[FAIL] per check
#   tests/review-cadence-smoke.sh -v     # verbose — also streams the server log
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3851}"
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="review-cadence-smoke-0123456789abcdef"
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

req() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s --max-time 30 "${JSONH[@]}" -X "$method" -d "$body" "$BASE$path"
  else
    curl -s --max-time 30 "${JSONH[@]}" -X "$method" "$BASE$path"
  fi
}

reqcode() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 30 "${JSONH[@]}" -X "$1" -d "$3" "$BASE$2"
}

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
log "BookClaw review-gate cadence update smoke test"

if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE} — stop it first."; exit 2
fi

log ""; log "Phase 0: boot the gateway"
start_server || exit 1
pass "server started and serves ${BASE}/"

log ""; log "Phase 1: create a throwaway book"
BOOK_BODY="$(node -e 'console.log(JSON.stringify({
  title: "Review Cadence Smoke " + Math.floor(Math.random()*1e6),
  author: "default", voice: "default", genre: null, pipeline: "novel-pipeline", sections: []
}))')"
BRESP="$(req POST /api/books "$BOOK_BODY")"
CREATED_BOOK="$(printf '%s' "$BRESP" | pscalar 'book.slug')"
if [ -n "$CREATED_BOOK" ]; then pass "book created (slug=$CREATED_BOOK)"; else
  fail "book create failed — resp=$(printf '%s' "$BRESP" | head -c 200)"; exit 1; fi

log ""; log "Phase 2: default has no explicit cadence"
MG="$(req GET "/api/books/$CREATED_BOOK/models")"
DC="$(printf '%s' "$MG" | pscalar 'reviewCadence')"
[ -z "$DC" ] && pass "reviewCadence defaults to empty (per_act fallback)" || fail "reviewCadence = '$DC' (expected empty)"

log ""; log "Phase 3: set cadence to per_chapter"
req POST "/api/books/$CREATED_BOOK/models" '{"reviewCadence":"per_chapter"}' >/dev/null
MG2="$(req GET "/api/books/$CREATED_BOOK/models")"
PC="$(printf '%s' "$MG2" | pscalar 'reviewCadence')"
[ "$PC" = "per_chapter" ] && pass "cadence set to per_chapter + persisted" || fail "reviewCadence = '$PC' (expected per_chapter)"

log ""; log "Phase 4: a model-config change preserves the cadence"
req POST "/api/books/$CREATED_BOOK/models" '{"default":{"provider":"openrouter","model":"anthropic/claude-opus-4.8"}}' >/dev/null
MG3="$(req GET "/api/books/$CREATED_BOOK/models")"
PC3="$(printf '%s' "$MG3" | pscalar 'reviewCadence')"
DM3="$(printf '%s' "$MG3" | pscalar 'default.model')"
[ "$PC3" = "per_chapter" ] && pass "cadence preserved across a model-config write" || fail "cadence lost (='$PC3')"
[ "$DM3" = "anthropic/claude-opus-4.8" ] && pass "model config applied alongside cadence" || fail "default model = '$DM3'"

log ""; log "Phase 5: clear the cadence (blank → per_act default)"
req POST "/api/books/$CREATED_BOOK/models" '{"reviewCadence":""}' >/dev/null
MG4="$(req GET "/api/books/$CREATED_BOOK/models")"
PC4="$(printf '%s' "$MG4" | pscalar 'reviewCadence')"
[ -z "$PC4" ] && pass "cadence cleared" || fail "cadence still set (='$PC4')"

log ""; log "Phase 6: invalid cadence → 400"
CODE_BAD="$(reqcode POST "/api/books/$CREATED_BOOK/models" '{"reviewCadence":"every-other-tuesday"}')"
[ "$CODE_BAD" = "400" ] && pass "invalid cadence → 400" || fail "invalid cadence → $CODE_BAD (expected 400)"

log ""
if [ "$FAILED" -eq 0 ]; then log "ALL CHECKS PASSED"; else log "SOME CHECKS FAILED"; fi
exit "$FAILED"
