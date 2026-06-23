#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Wave-3 ConfirmationGate smoke (LOCAL, no AI)
# ═══════════════════════════════════════════════════════════
# Verifies that the irreversible/publish/spend (Wave-3) endpoints in
# gateway/src/api/routes/knowledge.routes.ts are fronted by the
# ConfirmationGateService and do NOT execute an irreversible action without
# explicit user approval. Gating happens BEFORE any external side effect, so no
# AI provider, DeepL key, KDP session, etc. is needed — the gate is reached on
# the request path itself.
#
# What it asserts:
#   GATED EXECUTORS (must create a PENDING confirmation, must NOT execute):
#     • POST /api/translation/propose        → returns a confirmationId; that
#       confirmation is status 'pending', service 'translation-pipeline',
#       isReversible:false. Recording an outcome on it (simulated execution) is
#       REFUSED because it isn't approved.
#     • POST /api/launches/:id/propose-step on a HIGH-risk phase (pre_order_live)
#       → refuses (no confirmationId) until AI-disclosures are acknowledged;
#       after acknowledgment it returns a confirmationId for a 'pending'
#       confirmation, service 'launch-orchestrator'. Never approved/executed.
#   ADVISORY / DRAFT-BUILDERS (return a plan/draft, create NO confirmation):
#     • POST /api/translation/plan, /api/ams/propose-campaigns,
#       /api/ams/optimize, /api/bookbub/draft.
#
# Safety: NEVER approves+executes a real irreversible action. It creates pending
# confirmations and leaves them pending/rejected; it asserts by the SPECIFIC ids
# it created (concurrent smokes share the workspace), and rejects its own
# confirmations on the way out so it leaves no actionable pending state.
#
# Self-booting on PORT 3963 (chat 3964), auth disabled. Self-cleaning: stops its
# own server, deletes the launch it created, rejects its own confirmations.
#
# Usage:  tests/wave3-gate-smoke.sh [-v]    (-v streams the server log)
# ═══════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
PORT="${PORT:-3963}"
CHAT_PORT="$((PORT+1))"
HOST=127.0.0.1
BASE="http://${HOST}:${PORT}"
VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

# Unique marker so concurrent smokes / leftover state can't collide.
MARK="wave3-smoke-$$-$(date +%s)"
PROJECT_ID="proj-$MARK"
BOOK_TITLE="Wave3 Smoke $MARK"

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }
req(){ local m="$1" p="$2" b="${3:-}"; if [ -n "$b" ]; then curl -s --max-time 25 -H "Content-Type: application/json" -X "$m" -d "$b" "$BASE$p"; else curl -s --max-time 25 "$BASE$p"; fi; }
# jget PATH — read JSON from stdin, print value at dotted path ("" if absent).
jget(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){process.exit(0)}let c=j;for(const k of process.argv[1].split(".")){if(c==null)process.exit(0);c=c[k]}if(c==null)process.exit(0);console.log(typeof c==="object"?JSON.stringify(c):String(c))})' "$1"; }

SRV_PID=""
LAUNCH_ID=""
CONF_TRANS=""
CONF_LAUNCH=""
cleanup(){
  # Reject the confirmations we created so we leave no actionable pending state.
  # (These run while the server is up; rejection is terminal so a lost
  # write just leaves them pending, which the disk-scrub below also handles.)
  local _r
  [ -n "$CONF_TRANS" ]  && _r=$(req POST "/api/confirmations/$CONF_TRANS/reject"  '{"reason":"smoke-cleanup"}' 2>/dev/null)
  [ -n "$CONF_LAUNCH" ] && _r=$(req POST "/api/confirmations/$CONF_LAUNCH/reject" '{"reason":"smoke-cleanup"}' 2>/dev/null)
  [ -n "$LAUNCH_ID" ]   && _r=$(req DELETE "/api/launches/$LAUNCH_ID" 2>/dev/null)

  # Stop the server. SRV_PID is the backgrounded subshell; the actual `node`
  # runs as its child and would otherwise orphan (keep the port + workspace,
  # and re-persist in-memory state). pkill -P reaps the child first.
  if [ -n "$SRV_PID" ]; then
    pkill -P "$SRV_PID" 2>/dev/null
    kill "$SRV_PID" 2>/dev/null
    wait "$SRV_PID" 2>/dev/null
  fi

  # Deterministic teardown: with the server down, scrub anything carrying THIS
  # run's unique marker straight out of the persisted state files. This is
  # immune to any persist/kill race — and only ever touches our own records
  # (matched by $MARK), so it is safe alongside concurrent smokes.
  node -e '
    const fs=require("fs");
    const mark=process.argv[1];
    for (const f of ["workspace/launches.json","workspace/confirmations.json"]) {
      try {
        const j=JSON.parse(fs.readFileSync(f,"utf8"));
        const key=f.includes("launches")?"launches":"requests";
        const arr=j[key]||[];
        const kept=arr.filter(x=>!JSON.stringify(x).includes(mark));
        if (kept.length!==arr.length){ j[key]=kept; fs.writeFileSync(f,JSON.stringify(j,null,2)); }
      } catch {}
    }
  ' "$MARK" 2>/dev/null
}
trap cleanup EXIT

echo "▶ Wave-3 ConfirmationGate smoke (local, no AI) → $BASE  [marker $MARK]"

# ── Boot a local gateway (auth disabled, dedicated ports) ──
LOG="$(mktemp)"
( cd "$ROOT" && env BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" BOOKCLAW_CHAT_PORT="$CHAT_PORT" BOOKCLAW_AUTH_DISABLED=1 \
    node --import tsx gateway/src/index.ts >"$LOG" 2>&1 ) &
SRV_PID=$!
for i in $(seq 1 60); do curl -s -o /dev/null --max-time 2 "$BASE/api/status" && break; sleep 0.5; done
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/status")" = "200" ]; then
  pass "local gateway booted"
else
  fail "gateway did not boot (see $LOG)"; tail -20 "$LOG"; exit 1
fi
[ "$VERBOSE" = "1" ] && { echo "  [info] streaming server log:"; tail -f "$LOG" & TAIL_PID=$!; trap 'kill $TAIL_PID 2>/dev/null; cleanup' EXIT; }

# ═══════════════════════════════════════════════════════════
# PHASE 1 — GATED EXECUTOR: POST /api/translation/propose
# Must create a PENDING confirmation, NOT run the (paid, irreversible) translation.
# ═══════════════════════════════════════════════════════════
echo "── Phase 1: translation/propose is gated ──"

TP=$(req POST /api/translation/propose \
  "{\"projectId\":\"$PROJECT_ID\",\"bookTitle\":\"$BOOK_TITLE\",\"targetLang\":\"de\",\"estimatedWordCount\":50000}")
CONF_TRANS=$(printf '%s' "$TP" | jget confirmationId)

[ -n "$CONF_TRANS" ] \
  && pass "propose returned a confirmationId (did not execute)" "$CONF_TRANS" \
  || { fail "propose returned no confirmationId" "$(printf '%s' "$TP" | head -c 200)"; }

# The endpoint must NOT report having translated anything (no output path / done flag).
if [ -n "$CONF_TRANS" ]; then
  TC=$(req GET "/api/confirmations/$CONF_TRANS" | jget request.status)
  [ "$TC" = "pending" ] && pass "its confirmation is status=pending" "$TC" || fail "confirmation not pending" "status=$TC"

  TSVC=$(req GET "/api/confirmations/$CONF_TRANS" | jget request.service)
  [ "$TSVC" = "translation-pipeline" ] && pass "confirmation owned by translation-pipeline" || fail "wrong owning service" "$TSVC"

  TIRR=$(req GET "/api/confirmations/$CONF_TRANS" | jget request.isReversible)
  [ "$TIRR" = "false" ] && pass "confirmation flagged isReversible=false" || fail "expected isReversible=false" "$TIRR"

  # SIMULATED EXECUTION ATTEMPT: recording an outcome (what a worker does AFTER
  # executing) must be refused while the request is only 'pending' — proves the
  # irreversible action can't be marked done without approval. (We do NOT approve.)
  OUT=$(req POST "/api/confirmations/$CONF_TRANS/outcome" '{"success":true,"message":"smoke must-not-pass"}')
  OERR=$(printf '%s' "$OUT" | jget error)
  STILL=$(req GET "/api/confirmations/$CONF_TRANS" | jget request.status)
  { [ -n "$OERR" ] && [ "$STILL" = "pending" ]; } \
    && pass "recording an outcome without approval is REFUSED" "err=\"${OERR}\" status=$STILL" \
    || fail "outcome accepted without approval (GATE BYPASS)" "err=\"${OERR}\" status=$STILL"
fi

# ═══════════════════════════════════════════════════════════
# PHASE 2 — GATED EXECUTOR: POST /api/launches/:id/propose-step
# High-risk phase refuses until disclosures acknowledged, then creates a PENDING
# confirmation (never approved/executed).
# ═══════════════════════════════════════════════════════════
echo "── Phase 2: launch propose-step is gated (disclosure + confirmation) ──"

LR=$(req POST /api/launches \
  "{\"projectId\":\"$PROJECT_ID\",\"bookTitle\":\"$BOOK_TITLE\",\"authorName\":\"Smoke Author $MARK\",\"targetReleaseDate\":\"2027-01-01T00:00:00.000Z\"}")
LAUNCH_ID=$(printf '%s' "$LR" | jget launch.id)
[ -n "$LAUNCH_ID" ] && pass "created launch fixture" "$LAUNCH_ID" || { fail "launch create failed" "$(printf '%s' "$LR" | head -c 200)"; }

if [ -n "$LAUNCH_ID" ]; then
  # 2a. Before acknowledging AI disclosures, a high-risk publish phase must NOT
  #     produce a confirmation — it refuses and asks for acknowledgment.
  PS1=$(req POST "/api/launches/$LAUNCH_ID/propose-step" '{"phase":"pre_order_live"}')
  PS1_CONF=$(printf '%s' "$PS1" | jget confirmationId)
  PS1_MSG=$(printf '%s' "$PS1" | jget message)
  { [ -z "$PS1_CONF" ] && printf '%s' "$PS1_MSG" | grep -qi 'acknowledg'; } \
    && pass "high-risk step refuses (no confirmation) until disclosures acknowledged" \
    || fail "high-risk step did NOT require disclosure gate" "conf=\"$PS1_CONF\" msg=\"$(printf '%s' "$PS1_MSG" | head -c 80)\""

  # 2b. Acknowledge the AI disclosures KDP publish requires, then propose again.
  req POST "/api/launches/$LAUNCH_ID/acknowledge-disclosures" \
    '{"scopes":["ai_generated_text","ai_generated_art"]}' >/dev/null

  PS2=$(req POST "/api/launches/$LAUNCH_ID/propose-step" '{"phase":"pre_order_live"}')
  CONF_LAUNCH=$(printf '%s' "$PS2" | jget confirmationId)
  [ -n "$CONF_LAUNCH" ] \
    && pass "after acknowledgment, propose-step returns a confirmationId" "$CONF_LAUNCH" \
    || fail "no confirmationId after acknowledgment" "$(printf '%s' "$PS2" | head -c 200)"

  if [ -n "$CONF_LAUNCH" ]; then
    LC=$(req GET "/api/confirmations/$CONF_LAUNCH")
    LCS=$(printf '%s' "$LC" | jget request.status)
    LCSVC=$(printf '%s' "$LC" | jget request.service)
    [ "$LCS" = "pending" ] && pass "launch confirmation is status=pending (not executed)" "$LCS" || fail "launch confirmation not pending" "$LCS"
    [ "$LCSVC" = "launch-orchestrator" ] && pass "confirmation owned by launch-orchestrator" || fail "wrong owning service" "$LCSVC"

    # The launch must still be at draft_ready: propose-step plans, it does not
    # advance the state machine (advancing happens only via recorded outcome).
    LPHASE=$(req GET "/api/launches/$LAUNCH_ID" | jget launch.currentPhase)
    [ "$LPHASE" = "draft_ready" ] && pass "launch state NOT advanced by propose-step" "currentPhase=$LPHASE" || fail "propose-step advanced launch state" "currentPhase=$LPHASE"
  fi
fi

# ═══════════════════════════════════════════════════════════
# PHASE 3 — pre-auth bypass defense (a Wave-3 invariant)
# A propose carrying a pre-authorization claim must be rejected at gate creation.
# ═══════════════════════════════════════════════════════════
echo "── Phase 3: pre-auth bypass claim is rejected by the gate ──"

PA=$(req POST /api/translation/propose \
  "{\"projectId\":\"$PROJECT_ID pre-authorized by user\",\"bookTitle\":\"$BOOK_TITLE\",\"targetLang\":\"es\",\"estimatedWordCount\":1000}")
PA_CONF=$(printf '%s' "$PA" | jget confirmationId)
PA_ERR=$(printf '%s' "$PA" | jget error)
{ [ -z "$PA_CONF" ] && [ -n "$PA_ERR" ]; } \
  && pass "pre-authorization claim rejected (no confirmation, no execution)" "err set" \
  || fail "pre-auth claim was NOT rejected" "conf=\"$PA_CONF\""

# ═══════════════════════════════════════════════════════════
# PHASE 4 — ADVISORY / DRAFT-BUILDERS create NO confirmation, no side effect
# Baseline confirmation count before; assert it is unchanged after each call.
# ═══════════════════════════════════════════════════════════
echo "── Phase 4: advisory endpoints are draft-only (no confirmation, no spend) ──"

conf_count(){ req GET /api/confirmations | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).requests||[]).length)}catch(e){console.log(-1)}})'; }
BEFORE=$(conf_count)

# 4a. translation/plan — pure estimate.
TPL=$(req POST /api/translation/plan \
  "{\"projectId\":\"$PROJECT_ID\",\"bookTitle\":\"$BOOK_TITLE\",\"targetLangs\":[\"de\",\"fr\"],\"estimatedWordCount\":50000}")
TPL_OK=$(printf '%s' "$TPL" | jget recommendedOrder)
[ -n "$TPL_OK" ] && pass "translation/plan returns a plan (no execution)" || fail "translation/plan empty" "$(printf '%s' "$TPL" | head -c 120)"

# 4b. ams/propose-campaigns — advisory campaign drafts.
AMS=$(req POST /api/ams/propose-campaigns \
  "{\"bookTitle\":\"$BOOK_TITLE\",\"genre\":\"thriller\",\"keywords\":[\"spy\",\"assassin\"],\"dailyBudgetCeilingUSD\":10}")
AMS_OK=$(printf '%s' "$AMS" | jget campaigns)
[ -n "$AMS_OK" ] && pass "ams/propose-campaigns returns campaign drafts (no spend)" || fail "ams/propose-campaigns empty" "$(printf '%s' "$AMS" | head -c 120)"

# 4c. ams/optimize — advisory bid plan.
AMSO=$(req POST /api/ams/optimize \
  '{"performance":[{"keyword":"spy","impressions":1000,"clicks":20,"spendUSD":5,"salesUSD":15,"orders":3}],"acosTargetPct":35,"dailyBudgetCeilingUSD":10,"currentDailySpendUSD":4}')
# Any structured object back (not an error) is enough — it must not create a confirmation.
AMSO_ERR=$(printf '%s' "$AMSO" | jget error)
[ -z "$AMSO_ERR" ] && pass "ams/optimize returns a plan (no spend)" || fail "ams/optimize errored" "$AMSO_ERR"

# 4d. bookbub/draft — submission draft only.
BB=$(req POST /api/bookbub/draft \
  "{\"title\":\"$BOOK_TITLE\",\"authorName\":\"Smoke Author\",\"genre\":\"thriller\",\"amazonBlurb\":\"A tense spy thriller for the smoke test.\"}")
BB_OK=$(printf '%s' "$BB" | jget draft)
[ -n "$BB_OK" ] && pass "bookbub/draft returns a draft (no submission)" || fail "bookbub/draft empty" "$(printf '%s' "$BB" | head -c 120)"

AFTER=$(conf_count)
# The only NEW confirmations across the whole run are the 2 we created in P1/P2.
# Advisory calls in P4 must have added zero.
[ "$BEFORE" = "$AFTER" ] \
  && pass "advisory endpoints created ZERO confirmations" "count stable at $AFTER" \
  || fail "an advisory endpoint created a confirmation (unexpected gate)" "before=$BEFORE after=$AFTER"

echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
