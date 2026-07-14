#!/usr/bin/env bash
#
# BookClaw — project step removal smoke test
# ───────────────────────────────────────────
# Boots the gateway and asserts, end-to-end over the REAL HTTP API, the
# DELETE /api/projects/:id/steps/:stepId endpoint (remove a not-yet-run step,
# inert to sequencing — used to drop the remaining per-chapter intimacy steps
# of a sweet romance mid-run):
#
#   1. A pending step is removed (200) and the project's step count drops by one.
#   2. Removing the SAME id again → 404 (already gone).
#   3. Removing an unknown step id → 404.
#   4. Removing the ACTIVE step → 409 (only a pending step can be removed).
#
# Hermetic and non-destructive: binds 127.0.0.1 only, creates one throwaway
# book + project and DELETEs the book in the EXIT trap, and leaves no stray
# process.
#
# Usage:
#   tests/remove-step-smoke.sh        # quiet — [PASS]/[FAIL] per check
#   tests/remove-step-smoke.sh -v     # verbose — also streams the server log
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3853}"
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="remove-step-smoke-0123456789abcdef"
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
    curl -s --max-time 60 "${JSONH[@]}" -X "$method" -d "$body" "$BASE$path"
  else
    curl -s --max-time 60 "${JSONH[@]}" -X "$method" "$BASE$path"
  fi
}
reqcode() {
  local method="$1" path="$2"
  curl -s -o /dev/null -w '%{http_code}' --max-time 60 "${JSONH[@]}" -X "$method" "$BASE$path"
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
# nth_step_id STATUS INDEX → the id of the INDEX-th step with STATUS ("" = any)
step_id() {
  node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const j=JSON.parse(s); const steps=(j.project&&j.project.steps)||j.steps||[];
      const want=process.argv[1], i=Number(process.argv[2]);
      const f=want?steps.filter(x=>x.status===want):steps;
      console.log(f[i]&&f[i].id?f[i].id:"");
    })' "$1" "$2"
}
step_count() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const st=(j.project&&j.project.steps)||j.steps||[];console.log(st.length)})'
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
log "BookClaw project step-removal smoke test"

if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE} — stop it first."; exit 2
fi

log ""; log "Phase 0: boot the gateway"
start_server || exit 1
pass "server started and serves ${BASE}/"

log ""; log "Phase 1: create a book, make it active, create a project (has steps)"
BOOK_BODY="$(node -e 'console.log(JSON.stringify({
  title: "Remove Step Smoke " + Math.floor(Math.random()*1e6),
  author: "default", voice: "default", genre: null, pipeline: "novel-pipeline", sections: []
}))')"
BRESP="$(req POST /api/books "$BOOK_BODY")"
CREATED_BOOK="$(printf '%s' "$BRESP" | pscalar 'book.slug')"
[ -n "$CREATED_BOOK" ] && pass "book created (slug=$CREATED_BOOK)" || { fail "book create failed"; exit 1; }
req POST /api/books/active "$(node -e 'console.log(JSON.stringify({slug:process.argv[1]}))' "$CREATED_BOOK")" >/dev/null
PRESP="$(req POST /api/projects/create '{"title":"Remove Step Project","description":"Smoke project for step removal."}')"
PROJ_ID="$(printf '%s' "$PRESP" | pscalar 'project.id')"
[ -z "$PROJ_ID" ] && { fail "project create failed — $(printf '%s' "$PRESP" | head -c 200)"; exit 1; }
# Start it so step 1 becomes ACTIVE (for the 409 check). /start activates the
# first step without driving an AI call.
req POST "/api/projects/$PROJ_ID/start" '{}' >/dev/null
PG="$(req GET "/api/projects/$PROJ_ID")"
BEFORE="$(printf '%s' "$PG" | step_count)"
ACTIVE_ID="$(printf '%s' "$PG" | step_id active 0)"
PENDING_ID="$(printf '%s' "$PG" | step_id pending 0)"
if [ -n "$PROJ_ID" ] && [ -n "$ACTIVE_ID" ] && [ -n "$PENDING_ID" ] && [ "$BEFORE" -gt 1 ]; then
  pass "project started (id=$PROJ_ID, $BEFORE steps, active=$ACTIVE_ID, pending=$PENDING_ID)"
else
  fail "unexpected project shape — before=$BEFORE active=$ACTIVE_ID pending=$PENDING_ID"; exit 1
fi

log ""; log "Phase 2: cannot remove the ACTIVE step → 409"
CODE_ACTIVE="$(reqcode DELETE "/api/projects/$PROJ_ID/steps/$ACTIVE_ID")"
[ "$CODE_ACTIVE" = "409" ] && pass "active step removal refused (409)" || fail "active step → $CODE_ACTIVE (expected 409)"

log ""; log "Phase 3: remove a PENDING step → 200, count drops by one"
DR="$(req DELETE "/api/projects/$PROJ_ID/steps/$PENDING_ID")"
OK="$(printf '%s' "$DR" | pscalar 'success')"
AFTER="$(printf '%s' "$DR" | step_count)"
[ "$OK" = "true" ] && pass "pending step removed (success=true)" || fail "remove failed — $(printf '%s' "$DR" | head -c 160)"
[ "$AFTER" = "$((BEFORE - 1))" ] && pass "step count $BEFORE → $AFTER" || fail "count $BEFORE → $AFTER (expected $((BEFORE - 1)))"

log ""; log "Phase 4: removing the same id again → 404"
CODE_GONE="$(reqcode DELETE "/api/projects/$PROJ_ID/steps/$PENDING_ID")"
[ "$CODE_GONE" = "404" ] && pass "already-removed step → 404" || fail "→ $CODE_GONE (expected 404)"

log ""; log "Phase 5: unknown step id → 404"
CODE_UNK="$(reqcode DELETE "/api/projects/$PROJ_ID/steps/does-not-exist")"
[ "$CODE_UNK" = "404" ] && pass "unknown step → 404" || fail "→ $CODE_UNK (expected 404)"

log ""; log "Phase 6: the active step still exists (removal was inert to the frontier)"
PG2="$(req GET "/api/projects/$PROJ_ID")"
STILL="$(printf '%s' "$PG2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const st=(j.project.steps).find(x=>x.id===process.argv[1]);console.log(st?st.status:"gone")})' "$ACTIVE_ID")"
[ "$STILL" = "active" ] && pass "active step untouched by the removal" || fail "active step now '$STILL' (expected active)"

log ""
if [ "$FAILED" -eq 0 ]; then log "ALL CHECKS PASSED"; else log "SOME CHECKS FAILED"; fi
exit "$FAILED"
