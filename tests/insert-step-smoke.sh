#!/usr/bin/env bash
#
# BookClaw — project step insertion smoke test
# ─────────────────────────────────────────────
# Boots the gateway and asserts, end-to-end over the REAL HTTP API, the
# POST /api/projects/:id/steps endpoint (insert a not-yet-run step before an
# existing pending step, inert to sequencing — used to add the per-chapter
# de-AI audit step ahead of each humanize step):
#
#   1. Insert before a pending step → 200; step count grows by one; the new step
#      is 'pending' and sits immediately before the target.
#   2. Insert before the ACTIVE step → 409 (only before a pending step).
#   3. Insert before an unknown step id → 404.
#   4. Missing label/prompt → 400.
#   5. The active step is untouched (insert was inert to the frontier).
#
# Hermetic and non-destructive: binds 127.0.0.1 only, creates one throwaway
# book + project and DELETEs the book in the EXIT trap.
#
# Usage: tests/insert-step-smoke.sh [-v]   Exit: 0 pass / 1 fail / 2 preflight.

set -uo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3855}"
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="insert-step-smoke-0123456789abcdef"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SERVER_LOG="$(mktemp)"; SERVER_PID=""; FAILED=0; CREATED_BOOK=""

log()  { printf '%s\n' "$*"; }
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

JSONH=(-H "Authorization: Bearer $TEST_TOKEN" -H "Content-Type: application/json")
req() { local m="$1" p="$2" b="${3:-}"; if [ -n "$b" ]; then curl -s --max-time 60 "${JSONH[@]}" -X "$m" -d "$b" "$BASE$p"; else curl -s --max-time 60 "${JSONH[@]}" -X "$m" "$BASE$p"; fi; }
reqcode() { curl -s -o /dev/null -w '%{http_code}' --max-time 60 "${JSONH[@]}" -X "$1" -d "${3:-}" "$BASE$2"; }
pscalar() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){console.log("");return}let c=j;for(const k of process.argv[1].split(".")){if(c==null){console.log("");return}c=c[k]}console.log(c==null?"":String(c))})' "$1"; }
step_id() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const st=(j.project&&j.project.steps)||j.steps||[];const w=process.argv[1],i=Number(process.argv[2]);const f=w?st.filter(x=>x.status===w):st;console.log(f[i]&&f[i].id?f[i].id:"")})' "$1" "$2"; }
step_count() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const st=(j.project&&j.project.steps)||j.steps||[];console.log(st.length)})'; }

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    [ -n "$CREATED_BOOK" ] && req DELETE "/api/books/$CREATED_BOOK" >/dev/null 2>&1
  fi
  stop_server
  { [ "$VERBOSE" -eq 1 ] || [ "$FAILED" -ne 0 ]; } && { log ""; log "── server log ──"; cat "$SERVER_LOG"; }
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

start_server() {
  : > "$SERVER_LOG"
  env BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" BOOKCLAW_CHAT_PORT="$((PORT + 1))" BOOKCLAW_AUTH_TOKEN="$TEST_TOKEN" \
      node --import tsx "$ROOT_DIR/gateway/src/index.ts" > "$SERVER_LOG" 2>&1 &
  SERVER_PID=$!
  for i in $(seq 1 60); do curl -s -o /dev/null --max-time 2 "$BASE/" && return 0; kill -0 "$SERVER_PID" 2>/dev/null || { log "ERROR: server exited"; return 1; }; sleep 0.5; done
  log "ERROR: server not ready"; return 1
}
stop_server() { [ -n "$SERVER_PID" ] || return 0; kill "$SERVER_PID" 2>/dev/null; for i in $(seq 1 25); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.2; done; SERVER_PID=""; }

# ════════════════════════════════════════════════════════════
log "BookClaw project step-insertion smoke test"
curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null && { log "ERROR: ${BASE} already in use"; exit 2; }

log ""; log "Phase 0: boot"; start_server || exit 1; pass "server up at ${BASE}/"

log ""; log "Phase 1: book + active + project"
BB="$(node -e 'console.log(JSON.stringify({title:"Insert Step Smoke "+Math.floor(Math.random()*1e6),author:"default",voice:"default",genre:null,pipeline:"novel-pipeline",sections:[]}))')"
CREATED_BOOK="$(req POST /api/books "$BB" | pscalar 'book.slug')"
[ -n "$CREATED_BOOK" ] && pass "book $CREATED_BOOK" || { fail "book create failed"; exit 1; }
req POST /api/books/active "$(node -e 'console.log(JSON.stringify({slug:process.argv[1]}))' "$CREATED_BOOK")" >/dev/null
PROJ_ID="$(req POST /api/projects/create '{"title":"Insert Step Project","description":"Smoke project for step insertion."}' | pscalar 'project.id')"
[ -z "$PROJ_ID" ] && { fail "project create failed"; exit 1; }
req POST "/api/projects/$PROJ_ID/start" '{}' >/dev/null
PG="$(req GET "/api/projects/$PROJ_ID")"
BEFORE="$(printf '%s' "$PG" | step_count)"
ACTIVE_ID="$(printf '%s' "$PG" | step_id active 0)"
TARGET_ID="$(printf '%s' "$PG" | step_id pending 0)"
[ -n "$ACTIVE_ID" ] && [ -n "$TARGET_ID" ] && [ "$BEFORE" -gt 1 ] && pass "project $PROJ_ID ($BEFORE steps, active=$ACTIVE_ID, target=$TARGET_ID)" || { fail "shape before=$BEFORE active=$ACTIVE_ID target=$TARGET_ID"; exit 1; }

log ""; log "Phase 2: insert before a pending step → 200, count +1"
IBODY="$(node -e 'console.log(JSON.stringify({beforeStepId:process.argv[1],step:{label:"De-AI Audit — Chapter 1",prompt:"Audit the chapter for AI tells; output a findings list only.",taskType:"revision",skill:"romance-humanize-audit",role:"humanize_audit",chapterNumber:1,modelOverride:{provider:"openrouter",model:"auto:newest-haiku"}}}))' "$TARGET_ID")"
IR="$(req POST "/api/projects/$PROJ_ID/steps" "$IBODY")"
OKI="$(printf '%s' "$IR" | pscalar 'success')"
NEWID="$(printf '%s' "$IR" | pscalar 'inserted')"
AFTER="$(printf '%s' "$IR" | step_count)"
[ "$OKI" = "true" ] && pass "insert ok (new step $NEWID)" || fail "insert failed — $(printf '%s' "$IR" | head -c 160)"
[ "$AFTER" = "$((BEFORE + 1))" ] && pass "step count $BEFORE → $AFTER" || fail "count $BEFORE → $AFTER (expected $((BEFORE + 1)))"

log ""; log "Phase 3: new step is pending and sits immediately before the target"
POS="$(printf '%s' "$IR" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const st=j.project.steps;const ni=st.findIndex(x=>x.id===process.argv[1]);const ti=st.findIndex(x=>x.id===process.argv[2]);console.log(JSON.stringify({newStatus:st[ni]&&st[ni].status,adjacent:ni>=0&&ti===ni+1,haiku:st[ni]&&st[ni].modelOverride&&st[ni].modelOverride.model}))})' "$NEWID" "$TARGET_ID")"
echo "$POS" | grep -q '"newStatus":"pending"' && pass "new step is pending" || fail "new step not pending ($POS)"
echo "$POS" | grep -q '"adjacent":true' && pass "new step sits immediately before the target" || fail "new step not adjacent ($POS)"
echo "$POS" | grep -q '"haiku":"auto:newest-haiku"' && pass "audit modelOverride = auto:newest-haiku" || fail "modelOverride wrong ($POS)"

log ""; log "Phase 4: error paths"
C_ACTIVE="$(reqcode POST "/api/projects/$PROJ_ID/steps" "$(node -e 'console.log(JSON.stringify({beforeStepId:process.argv[1],step:{label:"x",prompt:"y"}}))' "$ACTIVE_ID")")"
C_UNK="$(reqcode POST "/api/projects/$PROJ_ID/steps" '{"beforeStepId":"nope","step":{"label":"x","prompt":"y"}}')"
C_BAD="$(reqcode POST "/api/projects/$PROJ_ID/steps" "$(node -e 'console.log(JSON.stringify({beforeStepId:process.argv[1],step:{label:"",prompt:""}}))' "$TARGET_ID")")"
[ "$C_ACTIVE" = "409" ] && pass "insert before active → 409" || fail "before active → $C_ACTIVE (expected 409)"
[ "$C_UNK" = "404" ] && pass "insert before unknown → 404" || fail "before unknown → $C_UNK (expected 404)"
[ "$C_BAD" = "400" ] && pass "missing label/prompt → 400" || fail "missing fields → $C_BAD (expected 400)"

log ""; log "Phase 5: frontier untouched"
STILL="$(req GET "/api/projects/$PROJ_ID" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const st=(j.project.steps).find(x=>x.id===process.argv[1]);console.log(st?st.status:"gone")})' "$ACTIVE_ID")"
[ "$STILL" = "active" ] && pass "active step untouched by inserts" || fail "active step now '$STILL'"

log ""
if [ "$FAILED" -eq 0 ]; then log "ALL CHECKS PASSED"; else log "SOME CHECKS FAILED"; fi
exit "$FAILED"
