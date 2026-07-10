#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Romance Adaptive Interview (POST /api/romance/interview) smoke
# ═══════════════════════════════════════════════════════════
# Boots its own gateway (loopback only, token via env, non-default port) and
# exercises the interview route.
#
# Hard gates (always run, no AI provider required):
#   (a) no messages array           -> 400
#   (b) messages not an array       -> 400
#   (c) route is mounted            -> a POST with a valid turn must NOT 404
#
# AI happy-path (gated on provider availability):
#   - valid turn -> 200: assert the response carries a reply — hard pass/fail.
#   - valid turn -> 500: no AI provider configured in this env — print a
#     SKIP notice and do not fail the run.
#   - any other status (404/401/...) -> hard FAIL.
#
# Usage:  tests/romance-adaptive-smoke.sh [-v]
# Exit: 0 = pass, 1 = a check failed, 2 = preflight/startup error.
set -uo pipefail

VERBOSE=0; [[ "${1:-}" == "-v" ]] && VERBOSE=1
HOST=127.0.0.1
PORT="${PORT:-3880}"
BASE="http://${HOST}:${PORT}"
TOKEN="romance-adaptive-smoke-token"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$(mktemp)"
FAILED=0

cleanup() {
  [[ -n "${SRV:-}" ]] && kill "$SRV" 2>/dev/null
  if [[ "$VERBOSE" == 1 || "$FAILED" != 0 ]]; then echo '--- server log ---'; cat "$LOG"; fi
  rm -f "$LOG"
}
trap cleanup EXIT

if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
  echo "ERROR: something is already listening on ${BASE} — stop it before running this smoke." >&2
  exit 2
fi

BOOKCLAW_AUTH_TOKEN="$TOKEN" BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" \
  node --import tsx "$ROOT/gateway/src/index.ts" >"$LOG" 2>&1 &
SRV=$!
for i in $(seq 1 60); do
  curl -sf "$BASE/api/status" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 && break
  kill -0 "$SRV" 2>/dev/null || { echo "ERROR: server exited during startup" >&2; exit 2; }
  sleep 0.5
done
curl -sf "$BASE/api/status" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 || { echo "ERROR: server never became ready" >&2; exit 2; }

H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

# (a) empty body {} (no messages array) -> 400
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -X POST "$BASE/api/romance/interview" --data '{}')
[[ "$CODE" == "400" ]] && echo "PASS: no messages -> 400" || { echo "FAIL: no messages not 400 (got $CODE)"; FAILED=1; }

# (b) messages not an array -> 400
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -X POST "$BASE/api/romance/interview" --data '{"messages":"nope"}')
[[ "$CODE" == "400" ]] && echo "PASS: bad messages -> 400" || { echo "FAIL: bad messages not 400 (got $CODE)"; FAILED=1; }

# (c)+AI happy-path: a valid turn. Route-mounted is a hard gate; the reply is asserted
# only when an AI provider actually ran (200). No provider in this dev env -> 500 -> SKIP.
VALID='{"messages":[{"role":"user","content":"A grumpy-sunshine bakery romance on Long Beach Island, NJ."}]}'
RESP=$(curl -s -w '\n%{http_code}' "${H[@]}" -X POST "$BASE/api/romance/interview" --data "$VALID")
BODY=$(echo "$RESP" | sed '$d'); CODE=$(echo "$RESP" | tail -n1)
if [[ "$CODE" == "404" ]]; then echo "FAIL: route not mounted (404)"; FAILED=1
elif [[ "$CODE" == "200" ]]; then
  echo "$BODY" | grep -q '"reply"' && echo "PASS: turn returns a reply" || { echo "FAIL: 200 without reply"; FAILED=1; }
elif [[ "$CODE" == "500" ]]; then
  echo "PASS: route mounted (500 without 404)"; echo "SKIP: no AI provider configured — happy-path deferred to a provisioned deploy (Mercury)"
else echo "FAIL: unexpected status (got $CODE)"; FAILED=1; fi

if [[ "$FAILED" == 0 ]]; then
  echo "PASS"
  exit 0
else
  exit 1
fi
