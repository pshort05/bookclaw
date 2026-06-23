#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — website-deploy confirmation-gate smoke (LOCAL, no AI)
# ═══════════════════════════════════════════════════════════
# The website deploy is the one true SERVER-issued irreversible action: the
# finalize path shells out to rsync/netlify/vercel/etc. The ConfirmationGate
# must stand between "request a deploy" and "run the deploy" — a deploy may run
# ONLY against an *approved* confirmation. This smoke proves the gate holds,
# end-to-end, through a running server, with zero real external side effects.
#
# It uses a deploy target of `none` (render-only — the deploy adapter is a
# verified no-op that never spawns a CLI), so it can safely exercise the full
# approve → finalize → runs-once path without touching the outside world.
#
# Asserted (by SPECIFIC confirmation/site id, since other smokes may run
# concurrently against the same workspace):
#   1. Create a `none`-target test site (unique slug; self-cleaned).
#   2. POST .../deploy → 202 + pendingConfirmation id; confirmation is 'pending'
#      (deploy NOT yet run — markDeployed has not fired).
#   3. Finalize WITHOUT approving → 409, deploy still not run.
#   4. Finalize with an UNKNOWN confirmation id → 404.
#   5. Approve, then finalize → deploy runs ONCE (render-only no-op); the
#      confirmation transitions to 'completed'; site.lastDeployedAt is now set.
#   6. Re-finalize the now-completed confirmation → 409 (no replay).
#
# Self-cleaning (site + confirmation outcome are workspace state; the site is
# deleted via the API and the server is stopped). Boots its own server.
#
# Usage:  tests/website-deploy-gate-smoke.sh [-v]    (PORT=3961, chat 3962)
#         -v  stream the captured server log on failure
# ═══════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
PORT="${PORT:-3961}"
HOST=127.0.0.1
BASE="http://${HOST}:${PORT}"
VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

# Unique slug so concurrent runs / leftover state never collide.
SLUG="deploy-gate-smoke-$$-${RANDOM}"

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }

# req METHOD PATH [JSON-BODY] — prints body (honors METHOD even with no body)
req(){ local m="$1" p="$2" b="${3:-}"; if [ -n "$b" ]; then
  curl -s --max-time 25 -H "Content-Type: application/json" -X "$m" -d "$b" "$BASE$p"; else
  curl -s --max-time 25 -X "$m" "$BASE$p"; fi; }
# code METHOD PATH [JSON-BODY] — prints HTTP status code only
code(){ local m="$1" p="$2" b="${3:-}"; if [ -n "$b" ]; then
  curl -s -o /dev/null -w '%{http_code}' --max-time 25 -H "Content-Type: application/json" -X "$m" -d "$b" "$BASE$p"; else
  curl -s -o /dev/null -w '%{http_code}' --max-time 25 -X "$m" "$BASE$p"; fi; }
# jget DOTPATH — read JSON from stdin, print the value at a.b.c (or nothing)
jget(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){process.exit(0)}let c=j;for(const k of process.argv[1].split(".")){if(c==null)process.exit(0);c=c[k]}if(c==null)process.exit(0);console.log(typeof c==="object"?JSON.stringify(c):String(c))})' "$1"; }

SRV_PID=""
LOG="$(mktemp)"
cleanup(){
  # Delete the test site (best-effort) before tearing the server down.
  [ -n "$SRV_PID" ] && req DELETE "/api/sites/$SLUG" >/dev/null 2>&1
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null
  # The site-delete API drops the registry entry but leaves the rendered output
  # dir; remove it so this smoke leaves no trace in the shared workspace.
  rm -rf "$ROOT/workspace/website/$SLUG"
  rm -f "$LOG"
}
trap cleanup EXIT

echo "▶ website-deploy gate smoke (local) → $BASE  (slug=$SLUG)"

# ── Boot a local gateway (auth disabled, loopback only) ──
( cd "$ROOT" && env BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" BOOKCLAW_CHAT_PORT="$((PORT+1))" BOOKCLAW_AUTH_DISABLED=1 \
    node --import tsx gateway/src/index.ts >"$LOG" 2>&1 ) &
SRV_PID=$!
for i in $(seq 1 60); do curl -s -o /dev/null --max-time 2 "$BASE/api/status" && break; sleep 0.5; done
if [ "$(code GET /api/status)" = "200" ]; then pass "local gateway booted"; else
  fail "gateway did not boot (see log below)"; tail -20 "$LOG"; exit 1; fi

# ── 1. Create a `none`-target test site (render-only; deploy is a verified no-op) ──
CREATE_BODY=$(node -e 'const s=process.argv[1];console.log(JSON.stringify({config:{slug:s,siteName:"Deploy Gate Smoke",authorName:"Smoke Tester",baseUrl:"https://example.invalid"},deploy:{target:"none"}}))' "$SLUG")
SITE=$(req POST /api/sites "$CREATE_BODY")
SITE_ID=$(printf '%s' "$SITE" | jget site.id)
SITE_TARGET=$(printf '%s' "$SITE" | jget site.deploy.target)
{ [ -n "$SITE_ID" ] && [ "$SITE_TARGET" = "none" ]; } \
  && pass "test site created with none target" "id=$SITE_ID" \
  || { fail "site create failed" "site=$SITE"; exit 1; }

# Render is a precondition of deploy (sets lastRenderedAt). Pure static HTML, no AI.
RENDER=$(req POST "/api/sites/$SITE_ID/render")
[ "$(printf '%s' "$RENDER" | jget rendered)" = "true" ] \
  && pass "site rendered (deploy precondition met)" \
  || { fail "render failed" "render=$RENDER"; exit 1; }

# Capture the pre-deploy state so we can prove the no-op deploy ran exactly once.
DEPLOYED_BEFORE=$(req GET "/api/sites/$SITE_ID" | jget lastDeployedAt)

# ── 2. POST deploy → 202 + pendingConfirmation; confirmation is 'pending' ──
# Single POST (-w appends the status code after the body) so we don't create a
# second orphan confirmation in the shared workspace.
DEP_RAW=$(curl -s --max-time 25 -w '\n%{http_code}' -H "Content-Type: application/json" -X POST "$BASE/api/sites/$SITE_ID/deploy")
DEP_CODE=$(printf '%s' "$DEP_RAW" | tail -n1)
DEP_BODY=$(printf '%s' "$DEP_RAW" | sed '$d')
CONF_ID=$(printf '%s' "$DEP_BODY" | jget pendingConfirmation)
[ "$DEP_CODE" = "202" ] && pass "deploy returns 202 (gated, not executed)" "code=$DEP_CODE" \
  || fail "deploy did not return 202" "code=$DEP_CODE"
[ -n "$CONF_ID" ] && pass "deploy returns a pendingConfirmation id" "conf=$CONF_ID" \
  || { fail "no pendingConfirmation id" "body=$DEP_BODY"; exit 1; }
# The created confirmation is the website-deploy gate, in 'pending'.
CONF=$(req GET "/api/confirmations/$CONF_ID")
{ [ "$(printf '%s' "$CONF" | jget request.service)" = "website-deploy" ] \
  && [ "$(printf '%s' "$CONF" | jget request.status)" = "pending" ]; } \
  && pass "confirmation is website-deploy + pending" \
  || fail "confirmation not pending website-deploy" "conf=$CONF"
# Deploy must NOT have run yet: lastDeployedAt is unchanged from pre-deploy.
[ "$(req GET "/api/sites/$SITE_ID" | jget lastDeployedAt)" = "$DEPLOYED_BEFORE" ] \
  && pass "deploy NOT executed while pending (lastDeployedAt unchanged)" \
  || fail "deploy ran before approval (lastDeployedAt changed)"

# ── 3. Finalize WITHOUT approving → 409; still not executed ──
FIN_BODY=$(node -e 'console.log(JSON.stringify({confirmationId:process.argv[1]}))' "$CONF_ID")
UNAPPROVED_CODE=$(code POST /api/sites/deploy/finalize "$FIN_BODY")
[ "$UNAPPROVED_CODE" = "409" ] \
  && pass "finalize WITHOUT approval refused (409)" "code=$UNAPPROVED_CODE" \
  || fail "unapproved finalize not refused with 409" "code=$UNAPPROVED_CODE"
[ "$(req GET "/api/sites/$SITE_ID" | jget lastDeployedAt)" = "$DEPLOYED_BEFORE" ] \
  && pass "deploy still NOT executed after refused finalize" \
  || fail "deploy ran despite refused finalize"
# And the confirmation is still pending (refusal didn't mutate it).
[ "$(req GET "/api/confirmations/$CONF_ID" | jget request.status)" = "pending" ] \
  && pass "confirmation remains pending after refused finalize" \
  || fail "confirmation status changed after refused finalize"

# ── 4. Finalize with an UNKNOWN confirmation id → 404 ──
BOGUS_BODY='{"confirmationId":"conf-0-doesnotexist"}'
BOGUS_CODE=$(code POST /api/sites/deploy/finalize "$BOGUS_BODY")
[ "$BOGUS_CODE" = "404" ] \
  && pass "finalize with unknown confirmation id → 404" "code=$BOGUS_CODE" \
  || fail "unknown confirmation id did not 404" "code=$BOGUS_CODE"

# ── 5. Approve → finalize → runs ONCE (none-target no-op) → completed ──
# Safe to actually run: target=none never shells out (see website-deploy.ts).
APP=$(req POST "/api/confirmations/$CONF_ID/approve")
[ "$(printf '%s' "$APP" | jget request.status)" = "approved" ] \
  && pass "confirmation approved" \
  || { fail "approve failed" "app=$APP"; exit 1; }
FIN=$(req POST /api/sites/deploy/finalize "$FIN_BODY")
[ "$(printf '%s' "$FIN" | jget deploy.success)" = "true" ] \
  && pass "approved finalize runs the (no-op) deploy" "target=$(printf '%s' "$FIN" | jget deploy.target)" \
  || fail "approved finalize did not run deploy" "fin=$FIN"
# Outcome recorded: confirmation transitions to 'completed'.
[ "$(req GET "/api/confirmations/$CONF_ID" | jget request.status)" = "completed" ] \
  && pass "confirmation transitioned to completed" \
  || fail "confirmation not completed after finalize"
# Deploy actually executed once: lastDeployedAt is now set (changed from before).
DEPLOYED_AFTER=$(req GET "/api/sites/$SITE_ID" | jget lastDeployedAt)
{ [ -n "$DEPLOYED_AFTER" ] && [ "$DEPLOYED_AFTER" != "$DEPLOYED_BEFORE" ]; } \
  && pass "deploy executed exactly once after approval (lastDeployedAt set)" \
  || fail "deploy did not execute after approval" "after=$DEPLOYED_AFTER before=$DEPLOYED_BEFORE"

# ── 6. Re-finalize the now-completed confirmation → 409 (no replay) ──
REPLAY_CODE=$(code POST /api/sites/deploy/finalize "$FIN_BODY")
[ "$REPLAY_CODE" = "409" ] \
  && pass "re-finalize of completed confirmation refused (409, no replay)" "code=$REPLAY_CODE" \
  || fail "completed confirmation could be replayed" "code=$REPLAY_CODE"

# ── Done ──
echo "  SUMMARY: $PASSES passed, $FAILS failed"
[ "$FAILS" -ne 0 ] && [ "$VERBOSE" = "1" ] && { echo "── server log tail ──"; tail -40 "$LOG"; }
exit "$FAILS"
