#!/usr/bin/env bash
#
# BookClaw — Write-rail per-step model selection smoke test
# ─────────────────────────────────────────────────────────
# Boots the gateway and asserts, end-to-end over the REAL HTTP API, the exact
# contract the Write pipeline rail's per-step model picker depends on:
#
#   1. POST /api/projects/:id/steps/:stepId/model with a provider only pins the
#      provider (no model) on that step.
#   2. POST the same with { provider: "openrouter", model: "<slug>" } pins the
#      specific OpenRouter model — the "secondary" LLM selection.
#   3. GET /api/projects/:id round-trips the step's modelOverride.
#   4. A blank provider clears the override.
#   5. Input validation — an invalid provider and an invalid model id → 400.
#
# Hermetic and non-destructive: binds 127.0.0.1 only, creates one throwaway
# book + project and DELETEs the book in the EXIT trap, and leaves no stray
# process.
#
# Usage:
#   tests/write-rail-step-model-smoke.sh        # quiet — [PASS]/[FAIL] per check
#   tests/write-rail-step-model-smoke.sh -v     # verbose — also streams server log
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3849}"
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="write-rail-step-model-smoke-0123456789abcdef"
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
    curl -s --max-time 60 "${JSONH[@]}" -X "$method" -d "$body" "$BASE$path"
  else
    curl -s --max-time 60 "${JSONH[@]}" -X "$method" "$BASE$path"
  fi
}

# reqcode METHOD PATH BODY → HTTP status code only.
reqcode() {
  curl -s -o /dev/null -w '%{http_code}' --max-time 60 "${JSONH[@]}" -X "$1" -d "$3" "$BASE$2"
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

# first_step_id → the id of the first step of the created project (from a GET).
first_step_id() {
  node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let j;try{j=JSON.parse(s)}catch(e){console.log("");return}
      const steps=(j.project&&j.project.steps)||j.steps||[];
      console.log(steps[0]&&steps[0].id?steps[0].id:"");
    })'
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
log "BookClaw Write-rail per-step model-selection smoke test"

if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE} — stop it first."; exit 2
fi

log ""; log "Phase 0: boot the gateway"
start_server || exit 1
pass "server started and serves ${BASE}/"

log ""; log "Phase 1: create a throwaway book"
BOOK_BODY="$(node -e 'console.log(JSON.stringify({
  title: "Write Rail Step Model Smoke " + Math.floor(Math.random()*1e6),
  author: "default", voice: "default", genre: null, pipeline: "novel-pipeline", sections: []
}))')"
BRESP="$(req POST /api/books "$BOOK_BODY")"
CREATED_BOOK="$(printf '%s' "$BRESP" | pscalar 'book.slug')"
if [ -n "$CREATED_BOOK" ]; then pass "book created (slug=$CREATED_BOOK)"; else
  fail "book create failed — resp=$(printf '%s' "$BRESP" | head -c 200)"; exit 1; fi

log ""; log "Phase 2: create a project bound to the book (has steps)"
# The create route binds a new project to the ACTIVE book (not a body field), and
# plans steps deterministically from that book's pipeline snapshot — so make our
# throwaway book active first, guaranteeing steps without any AI planning call.
req POST /api/books/active "$(node -e 'console.log(JSON.stringify({slug:process.argv[1]}))' "$CREATED_BOOK")" >/dev/null
PROJ_BODY="$(node -e 'console.log(JSON.stringify({
  title: "Rail Step Model Project", description: "Smoke project for per-step model pinning."
}))')"
PRESP="$(req POST /api/projects/create "$PROJ_BODY")"
PROJ_ID="$(printf '%s' "$PRESP" | pscalar 'project.id')"
STEP_ID="$(printf '%s' "$PRESP" | first_step_id)"
if [ -z "$STEP_ID" ]; then
  # Some templates plan steps lazily; re-read the project to pick up the first step.
  PRESP2="$(req GET "/api/projects/$PROJ_ID")"
  STEP_ID="$(printf '%s' "$PRESP2" | first_step_id)"
fi
if [ -n "$PROJ_ID" ] && [ -n "$STEP_ID" ]; then
  pass "project created (id=$PROJ_ID, first step=$STEP_ID)"
else
  fail "project/step create failed — resp=$(printf '%s' "$PRESP" | head -c 300)"; exit 1
fi

log ""; log "Phase 3: pin provider only on the step"
req POST "/api/projects/$PROJ_ID/steps/$STEP_ID/model" '{"provider":"openrouter"}' >/dev/null
SG="$(req GET "/api/projects/$PROJ_ID")"
SP="$(printf '%s' "$SG" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const j=JSON.parse(s); const st=(j.project.steps).find(x=>x.id===process.argv[1]);
    console.log(st&&st.modelOverride?st.modelOverride.provider||"":"");
  })' "$STEP_ID")"
[ "$SP" = "openrouter" ] && pass "provider-only pin persisted (openrouter)" || fail "step provider = '$SP' (expected openrouter)"

log ""; log "Phase 4: pin a specific OpenRouter model (the secondary selection)"
req POST "/api/projects/$PROJ_ID/steps/$STEP_ID/model" '{"provider":"openrouter","model":"anthropic/claude-opus-4.8"}' >/dev/null
SG2="$(req GET "/api/projects/$PROJ_ID")"
SM="$(printf '%s' "$SG2" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const j=JSON.parse(s); const st=(j.project.steps).find(x=>x.id===process.argv[1]);
    console.log(st&&st.modelOverride?st.modelOverride.model||"":"");
  })' "$STEP_ID")"
[ "$SM" = "anthropic/claude-opus-4.8" ] && pass "specific OpenRouter model pinned + round-tripped" || fail "step model = '$SM'"

log ""; log "Phase 5: clear the override (blank provider)"
req POST "/api/projects/$PROJ_ID/steps/$STEP_ID/model" '{}' >/dev/null
SG3="$(req GET "/api/projects/$PROJ_ID")"
SC="$(printf '%s' "$SG3" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const j=JSON.parse(s); const st=(j.project.steps).find(x=>x.id===process.argv[1]);
    console.log(st&&st.modelOverride?"set":"cleared");
  })' "$STEP_ID")"
[ "$SC" = "cleared" ] && pass "override cleared on blank provider" || fail "override still set after clear"

log ""; log "Phase 6: input validation → 400"
CODE_BADPROV="$(reqcode POST "/api/projects/$PROJ_ID/steps/$STEP_ID/model" '{"provider":"not-a-provider"}')"
CODE_BADMODEL="$(reqcode POST "/api/projects/$PROJ_ID/steps/$STEP_ID/model" '{"provider":"openrouter","model":"bad model id!!"}')"
[ "$CODE_BADPROV" = "400" ] && pass "invalid provider → 400" || fail "invalid provider → $CODE_BADPROV (expected 400)"
[ "$CODE_BADMODEL" = "400" ] && pass "invalid model id → 400" || fail "invalid model id → $CODE_BADMODEL (expected 400)"

log ""
if [ "$FAILED" -eq 0 ]; then log "ALL CHECKS PASSED"; else log "SOME CHECKS FAILED"; fi
exit "$FAILED"
