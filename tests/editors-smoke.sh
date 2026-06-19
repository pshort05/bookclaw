#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Editors feature smoke (REAL AI call)
# ═══════════════════════════════════════════════════════════
# Verifies the developmental-editor chat feature against a running instance:
# the built-in `maeve` editor resolves, /editors prints the numbered selection
# menu (with both modes), bare /editor maeve re-prompts for a mode, /editor maeve
# brainstorm enters and returns an in-character AI greeting, a follow-up message
# gets an in-character reply, /editor maeve critique enters critique mode, and
# /editor off returns to normal chat. Drives POST /api/chat (the same endpoint the
# dashboard uses; channel "api"). Self-cleaning (ends in /editor off).
#
# Usage:  BASE_URL=http://192.168.1.32:3847 tests/editors-smoke.sh
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else docker/.env / docker exec), CONTAINER.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TOKEN="${BOOKCLAW_AUTH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$SCRIPT_DIR/../docker/.env" ]; then
  TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' "$SCRIPT_DIR/../docker/.env" | cut -d= -f2- | tr -d '\r"')
fi
[ -z "$TOKEN" ] && TOKEN=$(docker exec "$CONTAINER" printenv BOOKCLAW_AUTH_TOKEN 2>/dev/null | tr -d '\r')
[ -z "$TOKEN" ] && { echo "ERROR: no auth token" >&2; exit 1; }
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }
req(){ local m="$1" p="$2" b="${3:-}" t="${4:-300}"; if [ -n "$b" ]; then curl -s --max-time "$t" "${H[@]}" -X "$m" -d "$b" "$BASE_URL$p"; else curl -s --max-time "$t" "${H[@]}" -X "$m" "$BASE_URL$p"; fi; }
jget(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){process.exit(0)}let c=j;for(const k of process.argv[1].split(".")){if(c==null)process.exit(0);c=c[k]}if(c==null)process.exit(0);console.log(typeof c==="object"?JSON.stringify(c):String(c))})' "$1"; }
# Send a chat message (command or prose) → returns the `response` string.
chat(){ req POST /api/chat "$(node -e 'console.log(JSON.stringify({message:process.argv[1]}))' "$1")" 300 | jget response; }

echo "▶ Editors smoke → $BASE_URL"
# Always end the session, even on early failure.
trap 'chat "/editor off" >/dev/null 2>&1 || true' EXIT

# ── 1. Built-in editor present ──
[ -n "$(req GET /api/library/editor/maeve | jget entry.editor.systemPrompt)" ] \
  && pass "built-in editor 'maeve' resolves" || fail "maeve editor missing"

# ── 2. /editors prints the numbered selection menu (with both modes) ──
LIST=$(chat "/editors")
case "$LIST" in
  *[Mm]aeve*brainstorm*critique*|*brainstorm*[Mm]aeve*) pass "/editors prints the menu with modes" ;;
  *[Mm]aeve*) case "$LIST" in *brainstorm*) pass "/editors prints the menu with modes" ;; *) fail "/editors menu missing modes" "$(printf '%s' "$LIST" | head -c 160)" ;; esac ;;
  *) fail "/editors missing maeve" "$(printf '%s' "$LIST" | head -c 160)" ;;
esac

# ── 3. Bare /editor maeve (no mode) re-prompts for a mode ──
NEED=$(chat "/editor maeve")
case "$NEED" in *brainstorm*critique*|*critique*brainstorm*) pass "/editor maeve re-prompts for a mode" ;; *) fail "/editor maeve did not re-prompt for mode" "$(printf '%s' "$NEED" | head -c 160)" ;; esac

# ── 4. Enter brainstorm mode → in-character AI greeting (real model call) ──
GREET=$(chat "/editor maeve brainstorm")
if [ -n "$GREET" ] && [ "${#GREET}" -gt 20 ] && ! printf '%s' "$GREET" | grep -q '\[AI provider failure\]'; then
  pass "/editor maeve brainstorm returns an AI greeting" "${GREET:0:60}…"
else
  fail "brainstorm greeting empty/failed" "$(printf '%s' "$GREET" | head -c 160)"
fi

# ── 5. Follow-up message → in-character reply (still in editor mode) ──
REPLY=$(chat "I have a romantasy idea: a rebel sky-sailor bonded to a storm-dragon. Poke holes in the premise in two or three sentences.")
if [ -n "$REPLY" ] && [ "${#REPLY}" -gt 20 ] && ! printf '%s' "$REPLY" | grep -q '\[AI provider failure\]'; then
  pass "editor replied in mode (real AI call)" "${REPLY:0:60}…"
else
  fail "editor reply empty/failed" "$(printf '%s' "$REPLY" | head -c 160)"
fi

# ── 6. Switch to critique mode → in-character AI greeting ──
CRIT=$(chat "/editor maeve critique")
if [ -n "$CRIT" ] && [ "${#CRIT}" -gt 20 ] && ! printf '%s' "$CRIT" | grep -q '\[AI provider failure\]'; then
  pass "/editor maeve critique enters critique mode" "${CRIT:0:60}…"
else
  fail "critique greeting empty/failed" "$(printf '%s' "$CRIT" | head -c 160)"
fi

# ── 7. Leave editor mode ──
OFF=$(chat "/editor off")
case "$OFF" in *[Nn]ormal*|*chat*) pass "/editor off returns to normal chat" ;; *) fail "/editor off did not confirm" "$(printf '%s' "$OFF" | head -c 120)" ;; esac

# ── 8. Socket.IO path (what the studio chat + Chat app actually use) ──
# The dashboard/Chat-app send over Socket.IO, not POST /api/chat. This asserts
# slash commands are dispatched over the socket too (the bug: they weren't).
if [ -f "$SCRIPT_DIR/chat-socket-smoke.js" ]; then
  if BASE_URL="$BASE_URL" BOOKCLAW_AUTH_TOKEN="$TOKEN" node "$SCRIPT_DIR/chat-socket-smoke.js"; then
    pass "socket.io chat dispatches /editor commands"
  else
    fail "socket.io chat command dispatch failed (see output above)"
  fi
else
  echo "  [SKIP] chat-socket-smoke.js not found"
fi

echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
