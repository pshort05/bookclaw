#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — autonomous heartbeat routes smoke (LOCAL, no AI / NO SPEND)
# ═══════════════════════════════════════════════════════════
# Coverage Batch D. Exercises the autonomous-mode toggles + idle-task CRUD in
# gateway/src/api/routes/heartbeat.routes.ts via a RUNNING server:
#
#   1. GET  /api/autonomous/status          — baseline shape (enabled/paused/running)
#   2. POST /api/autonomous/enable          — status.enabled === true
#   3. POST /api/autonomous/pause           — status.paused  === true (still enabled)
#   4. POST /api/autonomous/resume          — status.paused  === false
#   5. POST /api/autonomous/disable         — status.enabled === false AND the loop is
#                                             halted (disableAutonomous() calls
#                                             stopAutonomous() → running:false). Asserted
#                                             via the status endpoint, NOT by waiting for
#                                             a wake (no AI is ever triggered → no spend).
#   6. Idle-task CRUD round-trip:
#        POST   /api/autonomous/idle-tasks            (add a uniquely-labelled task → 201)
#        GET    /api/autonomous/idle-tasks            (our task present in the queue)
#        DELETE /api/autonomous/idle-tasks/:index     (remove it by its ACTUAL index → gone)
#
# NO AI / NO SPEND: only enable/disable/pause/resume + config-file CRUD are touched.
# We never call any wake/execute path, never advance the timer, and the default
# interval keeps the loop from firing within the test window anyway.
#
# SAFETY: the autonomous toggles are per-process runtime state on THIS booted server
# (its own port), so they don't bleed into other smokes. The idle-tasks.json config
# file IS shared on disk — so we assert ONLY on our unique label and delete by the
# index we re-discover for that exact label (race-safe), leaving the rest intact.
#
# Debug: run with -v to stream the captured server log on demand / failure.
#
# Usage:  tests/autonomous-routes-smoke.sh [-v]   (PORT fixed at 3973, chat 3974)
# ═══════════════════════════════════════════════════════════
set -uo pipefail

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
PORT=3973
HOST=127.0.0.1
BASE="http://${HOST}:${PORT}"

# Unique label so concurrent smokes sharing the real idle-tasks.json never collide.
MARK="autosmoke-$$-$(date +%s)"

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }

# JSON helpers
req(){ local m="$1" p="$2" b="${3:-}"; if [ -n "$b" ]; then
  curl -s --max-time 20 -H "Content-Type: application/json" -X "$m" -d "$b" "$BASE$p";
  else curl -s --max-time 20 -X "$m" "$BASE$p"; fi; }
code(){ curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
# Extract a top-level field from JSON on stdin.
jfield(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s);let c=v;for(const k of process.argv[1].split("."))c=c?.[k];console.log(c==null?"":String(c))}catch(e){console.log("")}})' "$1"; }

SRV_PID=""; LOG="$(mktemp)"
CLEANUP_LABEL=""   # set once our idle task is added, so we delete it even on failure

dump_log(){ echo "── server log tail ─────────────"; tail -30 "$LOG"; echo "────────────────────────────────"; }

# Re-discover the current index of a task by its unique label (race-safe against
# the shared config file); echoes the index or empty.
index_of_label(){
  req GET /api/autonomous/idle-tasks \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const q=(JSON.parse(s).queue||[]);const i=q.findIndex(t=>t&&t.label===process.argv[1]);console.log(i>=0?String(i):"")}catch(e){console.log("")}})' "$1"
}

cleanup(){
  # Remove our throwaway idle task by re-discovered index (idempotent; tolerant of
  # a concurrent smoke shifting indices).
  if [ -n "$CLEANUP_LABEL" ]; then
    idx="$(index_of_label "$CLEANUP_LABEL")"
    [ -n "$idx" ] && req DELETE "/api/autonomous/idle-tasks/$idx" >/dev/null 2>&1
  fi
  # Belt-and-braces: leave autonomous DISABLED so a leftover process can't wake.
  req POST /api/autonomous/disable >/dev/null 2>&1
  # Process-group kill so the node child is reaped (see boot note).
  if [ -n "$SRV_PID" ]; then kill -- "-$SRV_PID" 2>/dev/null || kill "$SRV_PID" 2>/dev/null; fi
  [ "$VERBOSE" = 1 ] && dump_log
  rm -f "$LOG"
}
trap cleanup EXIT

echo "▶ autonomous heartbeat routes smoke (local, REAL ./workspace) → $BASE"
echo "  run marker: $MARK"

# ── Boot a local gateway (auth disabled, no AI needed) ──
# setsid → the boot subshell leads its own process group, so the cleanup trap can
# reap the node child via a process-group kill (`cd && env node` forks node as a
# child rather than exec-replacing the subshell).
setsid bash -c "cd '$ROOT' && exec env BOOKCLAW_BIND='$HOST' BOOKCLAW_PORT='$PORT' BOOKCLAW_CHAT_PORT=3974 BOOKCLAW_AUTH_DISABLED=1 node --import tsx gateway/src/index.ts" >"$LOG" 2>&1 &
SRV_PID=$!
for i in $(seq 1 60); do curl -s -o /dev/null --max-time 2 "$BASE/api/status" && break; sleep 0.5; done
if [ "$(code "$BASE/api/status")" = "200" ]; then
  pass "local gateway booted"
else
  fail "gateway did not boot (see log)"; dump_log; exit 1
fi

# ═══════════════════════════════════════════════════════════
# PHASE 1 — autonomous enable/pause/resume/disable toggles
# ═══════════════════════════════════════════════════════════
echo "── Phase 1: autonomous toggles ──"

# Baseline status returns the documented shape.
ST="$(req GET /api/autonomous/status)"
EN="$(printf '%s' "$ST" | jfield enabled)"
if [ "$EN" = "true" ] || [ "$EN" = "false" ]; then
  pass "status returns boolean 'enabled' field" "enabled=$EN"
else
  fail "status missing 'enabled' field" "resp=$ST"
fi

# enable → enabled:true
R="$(req POST /api/autonomous/enable)"
EN="$(printf '%s' "$R" | jfield status.enabled)"
[ "$EN" = "true" ] && pass "enable → status.enabled=true" \
                   || fail "enable did not set enabled=true" "status.enabled=$EN"
# Confirm via the dedicated status endpoint too (not just the enable response).
EN2="$(req GET /api/autonomous/status | jfield enabled)"
[ "$EN2" = "true" ] && pass "GET status reflects enabled after enable" \
                    || fail "GET status not enabled after enable" "enabled=$EN2"

# pause → paused:true, still enabled.
R="$(req POST /api/autonomous/pause)"
PA="$(printf '%s' "$R" | jfield status.paused)"
EN="$(printf '%s' "$R" | jfield status.enabled)"
if [ "$PA" = "true" ] && [ "$EN" = "true" ]; then
  pass "pause → status.paused=true (still enabled)" "paused=$PA enabled=$EN"
else
  fail "pause did not reflect paused+enabled" "paused=$PA enabled=$EN"
fi
# Confirm via status endpoint.
PA2="$(req GET /api/autonomous/status | jfield paused)"
[ "$PA2" = "true" ] && pass "GET status reflects paused after pause" \
                    || fail "GET status not paused after pause" "paused=$PA2"

# resume → paused:false.
R="$(req POST /api/autonomous/resume)"
PA="$(printf '%s' "$R" | jfield status.paused)"
[ "$PA" = "false" ] && pass "resume → status.paused=false" \
                    || fail "resume did not clear paused" "paused=$PA"

# disable → enabled:false AND running:false (loop halted; stopAutonomous called).
R="$(req POST /api/autonomous/disable)"
EN="$(printf '%s' "$R" | jfield status.enabled)"
RUN="$(printf '%s' "$R" | jfield status.running)"
if [ "$EN" = "false" ] && [ "$RUN" = "false" ]; then
  pass "disable → enabled=false AND loop halted (running=false)" "enabled=$EN running=$RUN"
else
  fail "disable did not halt the loop" "enabled=$EN running=$RUN"
fi
# Confirm halt via the status endpoint (source of truth, not the toggle response).
ST="$(req GET /api/autonomous/status)"
EN2="$(printf '%s' "$ST" | jfield enabled)"
RUN2="$(printf '%s' "$ST" | jfield running)"
if [ "$EN2" = "false" ] && [ "$RUN2" = "false" ]; then
  pass "GET status confirms disabled + halted loop" "enabled=$EN2 running=$RUN2"
else
  fail "GET status does not confirm halted loop" "enabled=$EN2 running=$RUN2"
fi

# ═══════════════════════════════════════════════════════════
# PHASE 2 — idle-task CRUD round-trip (add → list → delete)
# ═══════════════════════════════════════════════════════════
echo "── Phase 2: idle-task CRUD round-trip ──"

# Missing fields → 400 (label+prompt required).
c="$(code -H "Content-Type: application/json" -X POST -d '{"label":"only-label"}' "$BASE/api/autonomous/idle-tasks")"
[ "$c" = "400" ] && pass "add idle-task without prompt → 400" "HTTP $c" \
                 || fail "add idle-task missing-field guard failed" "HTTP $c"

# Add a uniquely-labelled task → 201 + success.
ADD="$(req POST /api/autonomous/idle-tasks "{\"label\":\"$MARK\",\"prompt\":\"smoke probe — never executed\",\"enabled\":false}")"
ADD_CODE="$(code -H "Content-Type: application/json" -X POST -d "{\"label\":\"${MARK}-codecheck\",\"prompt\":\"x\"}" "$BASE/api/autonomous/idle-tasks")"
OK="$(printf '%s' "$ADD" | jfield success)"
if [ "$OK" = "true" ]; then
  CLEANUP_LABEL="$MARK"
  pass "add idle-task → success" "label=$MARK"
else
  fail "add idle-task did not succeed" "resp=$ADD"
fi
# The codecheck add (separate label) should report HTTP 201; clean it immediately.
[ "$ADD_CODE" = "201" ] && pass "add idle-task returns HTTP 201" "HTTP $ADD_CODE" \
                        || fail "add idle-task not 201" "HTTP $ADD_CODE"
CC_IDX="$(index_of_label "${MARK}-codecheck")"
[ -n "$CC_IDX" ] && req DELETE "/api/autonomous/idle-tasks/$CC_IDX" >/dev/null 2>&1

# List → our task is present (asserted by exact label, not by count).
PRESENT_IDX="$(index_of_label "$MARK")"
if [ -n "$PRESENT_IDX" ]; then
  pass "list shows our idle-task" "label=$MARK index=$PRESENT_IDX"
else
  fail "added idle-task not found in list" "label=$MARK"
fi

# Delete by re-discovered index → success + gone.
if [ -n "$PRESENT_IDX" ]; then
  DEL="$(req DELETE "/api/autonomous/idle-tasks/$PRESENT_IDX")"
  DOK="$(printf '%s' "$DEL" | jfield success)"
  GONE_IDX="$(index_of_label "$MARK")"
  if [ "$DOK" = "true" ] && [ -z "$GONE_IDX" ]; then
    CLEANUP_LABEL=""   # already removed; nothing left for the trap
    pass "delete idle-task by index → success + gone" "label=$MARK"
  else
    fail "delete idle-task failed or task still present" "success=$DOK remaining_idx=$GONE_IDX"
  fi
fi

# Out-of-range delete → 404.
c="$(code -X DELETE "$BASE/api/autonomous/idle-tasks/999999")"
[ "$c" = "404" ] && pass "delete out-of-range index → 404" "HTTP $c" \
                 || fail "out-of-range delete not 404" "HTTP $c"

# ── Summary ──
echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
