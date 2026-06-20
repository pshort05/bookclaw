#!/usr/bin/env bash
#
# BookClaw — per-step model pinning + parallel execution smoke test
# ─────────────────────────────────────────────────────────────────
# Boots the gateway and asserts, end-to-end over the REAL HTTP API + engine,
# the two just-built pipeline features:
#
#   1. Per-step model pinning (+ temperature) — a library/pipelines/*.json step
#      can carry modelOverride:{provider,model?,temperature?} that pins its AI
#      call. We assert the pin survives JSON → book snapshot → engine and is
#      readable on the resolved ProjectStep over HTTP (exact provider/model/temp).
#
#   2. Parallel step execution — a { "parallel": [...] } group fans out as a
#      batch; the next ordinary step is the implicit JOIN/barrier. We assert the
#      grouped members carry the parallelGroup markers (g0/g1) and the join does
#      NOT, then drive the engine to prove the BEHAVIORAL fan-out + barrier:
#      on /start the whole leading group goes `active` together while every
#      later group member AND the join stay `pending`.
#
# The shipped library/pipelines/romantasy-planning.json is the fixture: it has
# two ADJACENT parallel groups (g0 = 4 concept generators, g1 = 3 evaluators)
# then an editor-in-chief JOIN, and each grouped member ALSO carries a
# modelOverride — so one pipeline exercises both features at once.
#
# HERMETIC: every assertion is structural / state-based and needs NO AI spend,
# NO network, NO flakiness. Project creation does NOT auto-execute (auto-exec is
# a separate /api/projects/:id/auto-execute call we never make), and /start only
# flips step statuses — so the fan-out + barrier is observed directly from step
# state, before any AI call. (Deeper fan-out/barrier edge cases — drain order,
# resume, orphan recovery — are covered by tests/unit/parallel-orchestration.test.ts.)
#
# Non-destructive: supplies BOOKCLAW_AUTH_TOKEN via env (never writes .env),
# binds 127.0.0.1 only, creates exactly one throwaway book + project and DELETEs
# both (with files) in the EXIT trap, and leaves no stray process.
#
# Usage:
#   tests/parallel-pinning-smoke.sh        # quiet — [PASS]/[FAIL] per check
#   tests/parallel-pinning-smoke.sh -v     # verbose — also streams the server log
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3847}"
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="parallel-pinning-smoke-0123456789abcdef"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIPELINE="romantasy-planning"

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SERVER_LOG="$(mktemp)"
SERVER_PID=""
FAILED=0
CREATED_BOOK=""
CREATED_PROJECT=""

log()  { printf '%s\n' "$*"; }
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

AUTHH=(-H "Authorization: Bearer $TEST_TOKEN")
JSONH=(-H "Authorization: Bearer $TEST_TOKEN" -H "Content-Type: application/json")

# req METHOD PATH [BODY] → response body of an authenticated JSON request.
req() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -s --max-time 30 "${JSONH[@]}" -X "$method" -d "$body" "$BASE$path"
  else
    curl -s --max-time 30 "${JSONH[@]}" -X "$method" "$BASE$path"
  fi
}

# Purpose-built JSON readers (JSON.parse only — no eval). Each reads the project
# response on stdin and prints one scalar. Args are matched literally against
# step fields, never executed.

# psteps_filter <field> <op> <value> → count of steps where step[field] <op> value.
#   op: eq (===) | has (label/text contains substring) | startsWith
psteps_count() {
  node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let j;try{j=JSON.parse(s)}catch(e){console.log("");return}
      const [field,op,val]=process.argv.slice(1);
      const steps=((j.project||{}).steps)||[];
      const hit=steps.filter(st=>{
        const v=st[field];
        if(op==="eq")return v===val;
        if(op==="has")return typeof v==="string"&&v.indexOf(val)>=0;
        if(op==="present")return v!==undefined&&v!==null&&v!=="";
        return false;
      });
      console.log(hit.length);
    })' "$1" "$2" "${3:-}"
}

# pstep_field <matchField> <matchOp> <matchValue> <outPath> → scalar of the FIRST
# matching step's field at outPath (dot path into the step object). "" if absent.
#   matchOp: has (substring) | startsWith
pstep_field() {
  node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let j;try{j=JSON.parse(s)}catch(e){console.log("");return}
      const [mf,mo,mv,out]=process.argv.slice(1);
      const steps=((j.project||{}).steps)||[];
      const st=steps.find(x=>{
        const v=x[mf];
        if(typeof v!=="string")return false;
        return mo==="startsWith"?v.indexOf(mv)===0:v.indexOf(mv)>=0;
      });
      if(!st){console.log("");return}
      let cur=st;
      for(const k of out.split(".")){ if(cur==null){console.log("");return} cur=cur[k]; }
      console.log(cur===undefined||cur===null?"":String(cur));
    })' "$1" "$2" "$3" "$4"
}

# pscalar <dotPath> → scalar at a dot path from the response root. "" if absent.
pscalar() {
  node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let j;try{j=JSON.parse(s)}catch(e){console.log("");return}
      let cur=j;
      for(const k of process.argv[1].split(".")){ if(cur==null){console.log("");return} cur=cur[k]; }
      console.log(cur===undefined||cur===null?"":String(cur));
    })' "$1"
}

# pgroup_ids → JSON array of the distinct, document-order parallelGroup ids.
pgroup_ids() {
  node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let j;try{j=JSON.parse(s)}catch(e){console.log("");return}
      const steps=((j.project||{}).steps)||[];
      const ids=[];for(const st of steps){const g=st.parallelGroup;if(g&&!ids.includes(g))ids.push(g);}
      console.log(JSON.stringify(ids));
    })'
}

cleanup() {
  # Tear down the throwaway project + book (with files) before killing the
  # server — DELETE goes through the same engine that created them.
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    [ -n "$CREATED_PROJECT" ] && req DELETE "/api/projects/$CREATED_PROJECT?files=true" >/dev/null 2>&1
    [ -n "$CREATED_BOOK" ]    && req DELETE "/api/books/$CREATED_BOOK"                   >/dev/null 2>&1
  fi
  stop_server
  if [ "$VERBOSE" -eq 1 ] || [ "$FAILED" -ne 0 ]; then
    log ""
    log "── captured server log ──"
    cat "$SERVER_LOG"
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
log "BookClaw per-step model-pinning + parallel-execution smoke test"

# Preflight: the port must be free so we test our own process, not a stray one.
if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE} — stop it before running the smoke test."
  exit 2
fi

log ""
log "Phase 0: boot the gateway"
start_server || exit 1
pass "server started and serves ${BASE}/"

# Sanity: the fixture pipeline is present in the (built-in) library.
PIPE_GET="$(req GET "/api/library/pipeline/$PIPELINE")"
if printf '%s' "$PIPE_GET" | grep -q '"steps"'; then
  pass "fixture pipeline present (library/pipeline/$PIPELINE)"
else
  fail "fixture pipeline $PIPELINE missing from library — cannot run smoke"
  exit 1
fi

# ── Phase 1: create a book bound to the parallel+pinned pipeline ──
# author/voice default to the built-in "default" entries; the pipeline carries
# the parallel groups + per-step model overrides the rest of the run asserts.
log ""
log "Phase 1: create a book on the parallel+pinned pipeline"
BOOK_BODY="$(node -e 'console.log(JSON.stringify({
  title: "Parallel Pinning Smoke " + Math.floor(Math.random()*1e6),
  author: "default", voice: "default", genre: null,
  pipeline: process.argv[1], sections: []
}))' "$PIPELINE")"
BRESP="$(req POST /api/books "$BOOK_BODY")"
CREATED_BOOK="$(printf '%s' "$BRESP" | pscalar 'book.slug')"
if [ -n "$CREATED_BOOK" ]; then
  pass "book created (slug=$CREATED_BOOK)"
else
  fail "book create failed — resp=$(printf '%s' "$BRESP" | head -c 200)"
  exit 1
fi

# Bind it as the active book so /api/projects/create resolves its pipeline snapshot.
ACT_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${JSONH[@]}" \
  -X POST -d "{\"slug\":\"$CREATED_BOOK\"}" "$BASE/api/books/active")"
{ [ "$ACT_CODE" = "200" ] || [ "$ACT_CODE" = "204" ]; } \
  && pass "book set active" || fail "book set active (code=$ACT_CODE)"

# ── Phase 2: create the project (NO auto-exec) ──
# /api/projects/create returns the project in `pending` status with every step
# `pending` — it does NOT run any AI. The book-sequence branch resolves the
# project[0] from the active book's pipeline snapshot.
log ""
log "Phase 2: create the project from the book's pipeline (no AI executed)"
PROJ_BODY="$(node -e 'console.log(JSON.stringify({
  title: "Parallel Pinning Project " + Math.floor(Math.random()*1e6),
  description: "Hermetic smoke fixture — a fae heist romance with a collapsing magic system."
}))')"
PRESP="$(req POST /api/projects/create "$PROJ_BODY")"
PLANNING="$(printf '%s' "$PRESP" | pscalar 'planning')"
CREATED_PROJECT="$(printf '%s' "$PRESP" | pscalar 'project.id')"
if [ -n "$CREATED_PROJECT" ]; then
  pass "project created (id=$CREATED_PROJECT, planning=$PLANNING)"
else
  fail "project create failed — resp=$(printf '%s' "$PRESP" | head -c 300)"
  exit 1
fi

# Read the project back over HTTP — every later assertion uses this resolved view.
PROJ="$(req GET "/api/projects/$CREATED_PROJECT")"

# Project must be pending with no step active yet (proves we observe pre-exec state).
PROJ_STATUS="$(printf '%s' "$PROJ" | pscalar 'project.status')"
ACTIVE_COUNT="$(printf '%s' "$PROJ" | psteps_count status eq active)"
{ [ "$PROJ_STATUS" = "pending" ] && [ "$ACTIVE_COUNT" = "0" ]; } \
  && pass "project is pending with 0 active steps (no auto-exec)" \
  || fail "expected pending/0-active, got status=$PROJ_STATUS active=$ACTIVE_COUNT"

# ── Phase 3: model-pinning passthrough (structural, hermetic) ──
# The JSON → snapshot → engine path must carry the exact pinned provider/model/
# temperature onto the resolved ProjectStep. We assert two distinct pins: a
# parallel MEMBER (Concepts A) and the JOIN step (Editor-in-Chief).
log ""
log "Phase 3: per-step model pinning passthrough (exact provider/model/temperature)"

# Concepts A — Dark & Political → openrouter / google/gemini-3-pro / 1
# (matches the n8n "Suggest Book Ideas 1" generator model)
MO_PROVIDER="$(printf '%s' "$PROJ" | pstep_field label startsWith "Concepts A" modelOverride.provider)"
MO_MODEL="$(printf '%s' "$PROJ" | pstep_field label startsWith "Concepts A" modelOverride.model)"
MO_TEMP="$(printf '%s' "$PROJ" | pstep_field label startsWith "Concepts A" modelOverride.temperature)"
if [ "$MO_PROVIDER" = "openrouter" ] && [ "$MO_MODEL" = "google/gemini-3-pro" ] && [ "$MO_TEMP" = "1" ]; then
  pass "parallel member pin survives passthrough (openrouter / google/gemini-3-pro / 1)"
else
  fail "member pin wrong: provider=$MO_PROVIDER model=$MO_MODEL temp=$MO_TEMP"
fi

# Editor-in-Chief (the join) → openrouter / anthropic/claude-sonnet-4.6 / 0.3
# (matches the n8n "Select Best" editor-in-chief model)
JO_PROVIDER="$(printf '%s' "$PROJ" | pstep_field label has "Editor-in-Chief" modelOverride.provider)"
JO_MODEL="$(printf '%s' "$PROJ" | pstep_field label has "Editor-in-Chief" modelOverride.model)"
JO_TEMP="$(printf '%s' "$PROJ" | pstep_field label has "Editor-in-Chief" modelOverride.temperature)"
if [ "$JO_PROVIDER" = "openrouter" ] && [ "$JO_MODEL" = "anthropic/claude-sonnet-4.6" ] && [ "$JO_TEMP" = "0.3" ]; then
  pass "join-step pin survives passthrough (openrouter / anthropic/claude-sonnet-4.6 / 0.3)"
else
  fail "join pin wrong: provider=$JO_PROVIDER model=$JO_MODEL temp=$JO_TEMP"
fi

# ── Phase 4: parallel markers (structural, hermetic) ──
# g0 = 4 concept generators, g1 = 3 evaluators; the Editor-in-Chief join carries
# NO parallelGroup, and so do the ordinary outline/bible steps after it.
log ""
log "Phase 4: parallelGroup markers (groups stamped, join unmarked)"

G0_COUNT="$(printf '%s' "$PROJ" | psteps_count parallelGroup eq g0)"
G1_COUNT="$(printf '%s' "$PROJ" | psteps_count parallelGroup eq g1)"
[ "$G0_COUNT" = "4" ] && pass "group g0 has 4 members" || fail "group g0 expected 4, got $G0_COUNT"
[ "$G1_COUNT" = "3" ] && pass "group g1 has 3 members" || fail "group g1 expected 3, got $G1_COUNT"

JOIN_MARK="$(printf '%s' "$PROJ" | pstep_field label has "Editor-in-Chief" parallelGroup)"
[ -z "$JOIN_MARK" ] \
  && pass "join step (Editor-in-Chief) carries NO parallelGroup" \
  || fail "join step unexpectedly stamped parallelGroup=$JOIN_MARK"

# Exactly two distinct groups, in document order g0 then g1.
GROUP_IDS="$(printf '%s' "$PROJ" | pgroup_ids)"
[ "$GROUP_IDS" = '["g0","g1"]' ] \
  && pass "exactly two parallel groups in order: g0, g1" \
  || fail "unexpected group set: $GROUP_IDS"

# ── Phase 5: fan-out + barrier (BEHAVIORAL, hermetic) ──
# /start flips statuses only (no AI). The whole leading group g0 must go active
# together (fan-out); every g1 member and the join must stay pending (barrier).
log ""
log "Phase 5: fan-out + barrier — start the project and inspect step state"
START_RESP="$(req POST "/api/projects/$CREATED_PROJECT/start")"
START_OK="$(printf '%s' "$START_RESP" | pscalar 'step.id')"
[ -n "$START_OK" ] && pass "project started (a runnable step returned)" || fail "start returned no step"

PROJ2="$(req GET "/api/projects/$CREATED_PROJECT")"

# Fan-out: all 4 g0 members active.
G0_ACTIVE="$(printf '%s' "$PROJ2" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j;try{j=JSON.parse(s)}catch(e){console.log("");return}
    const steps=((j.project||{}).steps)||[];
    console.log(steps.filter(st=>st.parallelGroup==="g0"&&st.status==="active").length);
  })')"
[ "$G0_ACTIVE" = "4" ] \
  && pass "fan-out: all 4 g0 members are active together" \
  || fail "fan-out broken: expected 4 active g0 members, got $G0_ACTIVE"

# Barrier (inter-group): no g1 member has left pending while g0 is still in flight.
G1_NONPENDING="$(printf '%s' "$PROJ2" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j;try{j=JSON.parse(s)}catch(e){console.log("");return}
    const steps=((j.project||{}).steps)||[];
    console.log(steps.filter(st=>st.parallelGroup==="g1"&&st.status!=="pending").length);
  })')"
[ "$G1_NONPENDING" = "0" ] \
  && pass "barrier: no g1 member started while g0 is in flight (all pending)" \
  || fail "barrier broken: $G1_NONPENDING g1 member(s) left pending early"

# Barrier (join): the Editor-in-Chief join stays pending behind both groups.
JOIN_STATUS="$(printf '%s' "$PROJ2" | pstep_field label has "Editor-in-Chief" status)"
[ "$JOIN_STATUS" = "pending" ] \
  && pass "barrier: join step stays pending behind the groups" \
  || fail "join step should be pending, got $JOIN_STATUS"

# Exactly the 4 fan-out members are active project-wide (nothing else leaked active).
TOTAL_ACTIVE="$(printf '%s' "$PROJ2" | psteps_count status eq active)"
[ "$TOTAL_ACTIVE" = "4" ] \
  && pass "exactly 4 steps active project-wide (only the g0 fan-out)" \
  || fail "expected 4 active steps total, got $TOTAL_ACTIVE"

# ── Result ──
log ""
if [ "$FAILED" -eq 0 ]; then
  log "All parallel/pinning smoke checks passed."
  exit 0
fi
log "Parallel/pinning smoke test FAILED."
exit 1
