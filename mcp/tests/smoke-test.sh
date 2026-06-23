#!/usr/bin/env bash
# Hermetic smoke test: boots a stub BookClaw + the MCP server, asserts the
# inbound bearer gate and an MCP initialize round-trip. Use -v to stream logs.
set -uo pipefail

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MCP_TOKEN="smoke-mcp-token"
MCP_PORT=3859
LOG="$(mktemp)"
STUB_LOG="$(mktemp)"

cleanup() {
  [ -n "${MCP_PID:-}" ] && kill "$MCP_PID" 2>/dev/null
  [ -n "${STUB_PID:-}" ] && kill "$STUB_PID" 2>/dev/null
  [ "$VERBOSE" = "1" ] && { echo "--- mcp log ---"; cat "$LOG"; }
  rm -f "$LOG" "$STUB_LOG"
}
trap cleanup EXIT

# 1) Start the stub BookClaw on an ephemeral port.
STUB_PORT=0 node "$ROOT/tests/stub-bookclaw.mjs" >"$STUB_LOG" 2>&1 &
STUB_PID=$!
for _ in $(seq 1 50); do grep -q 'STUB_PORT=' "$STUB_LOG" && break; sleep 0.1; done
STUB_PORT="$(sed -n 's/STUB_PORT=//p' "$STUB_LOG" | head -1)"
[ -z "$STUB_PORT" ] && { echo "FAIL: stub did not start"; exit 1; }

# 2) Start the MCP server pointed at the stub.
BOOKCLAW_BASE_URL="http://127.0.0.1:$STUB_PORT" \
BOOKCLAW_AUTH_TOKEN="stub-token" \
BOOKCLAW_MCP_TOKEN="$MCP_TOKEN" \
BOOKCLAW_MCP_BIND="127.0.0.1" \
BOOKCLAW_MCP_PORT="$MCP_PORT" \
  node --import tsx "$ROOT/src/index.ts" >"$LOG" 2>&1 &
MCP_PID=$!
for _ in $(seq 1 100); do grep -q 'listening on' "$LOG" && break; sleep 0.1; done
grep -q 'listening on' "$LOG" || { echo "FAIL: MCP server did not start"; exit 1; }

URL="http://127.0.0.1:$MCP_PORT/mcp"
ACCEPT='Accept: application/json, text/event-stream'
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'

# Assertion 1: no token -> 401
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL" \
  -H 'Content-Type: application/json' -H "$ACCEPT" -d "$INIT")
[ "$code" = "401" ] || { echo "FAIL: expected 401 without token, got $code"; exit 1; }
echo "PASS: unauthenticated request rejected (401)"

# Assertion 2: with token -> 200 and a JSON-RPC result
resp=$(curl -s -X POST "$URL" -H 'Content-Type: application/json' -H "$ACCEPT" \
  -H "Authorization: Bearer $MCP_TOKEN" -d "$INIT" -w '\n%{http_code}')
code=$(printf '%s' "$resp" | tail -1)
body=$(printf '%s' "$resp" | sed '$d')
[ "$code" = "200" ] || { echo "FAIL: expected 200 with token, got $code"; exit 1; }
printf '%s' "$body" | grep -q 'bookclaw-mcp' || { echo "FAIL: initialize result missing server name"; exit 1; }
echo "PASS: authenticated initialize round-trip (200)"

echo "SMOKE OK"
