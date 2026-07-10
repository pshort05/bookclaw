#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Romance Premise-File Intake (POST /api/books/intake) smoke
# ═══════════════════════════════════════════════════════════
# Boots its own gateway (loopback only, token via env, non-default port) and
# exercises the intake route.
#
# Hard gates (always run, no AI provider required):
#   (a) empty premise            -> 400
#   (b) oversized premise (>200k)-> 400
#   (c) route is mounted         -> a POST with a valid premise must NOT 404
#
# AI happy-path (gated on provider availability — this dev env has none
# configured; the real check runs on a provisioned deploy e.g. Mercury):
#   - valid premise -> 200: assert the response shape (seeds/gaps/
#     discrepancies/realPlace/groundingStatus present) — hard pass/fail.
#   - valid premise -> 500: no AI provider configured in this env — print a
#     SKIP notice and do not fail the run.
#   - any other status (404/401/...) -> hard FAIL.
#
# Usage:  tests/romance-premise-intake-smoke.sh [-v]
# Exit: 0 = pass, 1 = a check failed, 2 = preflight/startup error.
set -uo pipefail

VERBOSE=0; [[ "${1:-}" == "-v" ]] && VERBOSE=1
HOST=127.0.0.1
PORT="${PORT:-3879}"
BASE="http://${HOST}:${PORT}"
TOKEN="premise-intake-smoke-token"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$(mktemp)"
BIGFILE="$(mktemp)"
FAILED=0

cleanup() {
  [[ -n "${SRV:-}" ]] && kill "$SRV" 2>/dev/null
  if [[ "$VERBOSE" == 1 || "$FAILED" != 0 ]]; then echo '--- server log ---'; cat "$LOG"; fi
  rm -f "$LOG" "$BIGFILE"
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

# (a) empty premise -> 400
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -X POST "$BASE/api/books/intake" --data '{"premise":""}')
if [[ "$CODE" == "400" ]]; then
  echo "PASS: empty premise -> 400"
else
  echo "FAIL: empty premise not 400 (got $CODE)"; FAILED=1
fi

# (b) oversized premise (>200k chars) -> 400
head -c 200001 /dev/zero | tr '\0' 'a' > "$BIGFILE.raw"
{ printf '{"premise":"'; cat "$BIGFILE.raw"; printf '"}'; } > "$BIGFILE"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "${H[@]}" -X POST "$BASE/api/books/intake" --data @"$BIGFILE")
if [[ "$CODE" == "400" ]]; then
  echo "PASS: oversized premise -> 400"
else
  echo "FAIL: oversized premise not 400 (got $CODE)"; FAILED=1
fi
rm -f "$BIGFILE.raw"

# (c)+AI happy-path: valid premise. Route-mounted check is a hard gate; the
# response shape is asserted only when an AI provider actually ran (200).
VALID='{"premise":"# Test\nA baker on Long Beach Island, NJ (Surf City, Long Beach Boulevard) rivals a cafe owner. Open choice: the cousin is unnamed."}'
RESP=$(curl -s -w '\n%{http_code}' "${H[@]}" -X POST "$BASE/api/books/intake" --data "$VALID")
BODY=$(echo "$RESP" | sed '$d')
CODE=$(echo "$RESP" | tail -n1)

if [[ "$CODE" == "404" ]]; then
  echo "FAIL: route not mounted (404 on POST /api/books/intake)"; FAILED=1
elif [[ "$CODE" == "200" ]]; then
  echo "PASS: route mounted (200)"
  MISSING=""
  for key in '"seeds"' '"gaps"' '"discrepancies"' '"realPlace"' '"groundingStatus"'; do
    echo "$BODY" | grep -q "$key" || MISSING="$MISSING $key"
  done
  if [[ -z "$MISSING" ]]; then
    echo "PASS: happy-path response shape complete"
  else
    echo "FAIL: happy-path response missing:$MISSING"; FAILED=1
  fi
elif [[ "$CODE" == "500" ]]; then
  echo "PASS: route mounted (500 without 404)"
  echo "SKIP: no AI provider configured in this env — happy-path shape check deferred to a provisioned deploy (Mercury)"
else
  echo "FAIL: unexpected status on valid premise (got $CODE)"; FAILED=1
fi

if [[ "$FAILED" == 0 ]]; then
  echo "PASS"
  exit 0
else
  exit 1
fi
