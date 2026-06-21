#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Memory-search health smoke (READ-ONLY, no AI, non-destructive)
# ═══════════════════════════════════════════════════════════
# Verifies the FTS-index memory-search subsystem is healthy on a running
# gateway. This is the subsystem touched by the configurable-DB-location change
# (BOOKCLAW_DB_DIR): if the SQLite DB couldn't be opened at its (default or
# relocated) path, /api/memory/stats reports available:false and a query 503s.
#
# Checks (all read-only — creates nothing, so no cleanup):
#   1. Auth gate: /api/status 401 without a token, 200 with one.
#   2. /api/memory/stats → 200 + available:true + numeric totalEntries
#      (a real SELECT COUNT(*) on the DB — proves it opened at its path).
#   3. /api/memory/search?q=... → 200 (not 503) + a hits array
#      (a real FTS5 query — proves the index is queryable post-deploy).
#
# NOTE: on an instance with BOOKCLAW_DB_DIR unset (e.g. Mercury), this exercises
# the DEFAULT in-workspace DB path. Relocation itself is covered by the unit test
# (tests/unit/memory-search-dbpath.test.ts); this smoke confirms the deployed
# change didn't break memory search.
#
# Usage:
#   BASE_URL=http://192.168.1.32:3847 tests/memory-search-smoke.sh
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else repo docker/.env, else docker exec), CONTAINER.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Resolve the bearer token: env → repo docker/.env → container env ──
TOKEN="${BOOKCLAW_AUTH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$SCRIPT_DIR/../docker/.env" ]; then
  TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' "$SCRIPT_DIR/../docker/.env" | cut -d= -f2- | tr -d '\r"')
fi
if [ -z "$TOKEN" ]; then
  TOKEN=$(docker exec "$CONTAINER" printenv BOOKCLAW_AUTH_TOKEN 2>/dev/null | tr -d '\r')
fi
if [ -z "$TOKEN" ]; then
  echo "ERROR: no auth token. Set BOOKCLAW_AUTH_TOKEN, or run where docker/.env or 'docker exec $CONTAINER' is available." >&2
  exit 1
fi
H=(-H "Authorization: Bearer $TOKEN")

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }

code(){ curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
jget(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){process.exit(0)}let c=j;for(const k of process.argv[1].split(".")){if(c==null)process.exit(0);c=c[k]}if(c==null)process.exit(0);console.log(typeof c==="object"?JSON.stringify(c):String(c))})' "$1"; }

echo "▶ Memory-search smoke → $BASE_URL"

# 1. Auth gate
[ "$(code "$BASE_URL/api/status")" = "401" ] && pass "auth gate: /api/status 401 without token" || fail "auth gate: 401 without token" "got $(code "$BASE_URL/api/status")"
[ "$(code "${H[@]}" "$BASE_URL/api/status")" = "200" ] && pass "auth gate: /api/status 200 with token" || fail "auth gate: 200 with token"

# 2. Memory stats — the DB opened at its path and answers a COUNT(*)
STATS=$(curl -s --max-time 20 "${H[@]}" "$BASE_URL/api/memory/stats")
SC=$(code "${H[@]}" "$BASE_URL/api/memory/stats")
AVAIL=$(printf '%s' "$STATS" | jget available)
TOTAL=$(printf '%s' "$STATS" | jget totalEntries)
if [ "$SC" = "200" ] && [ "$AVAIL" = "true" ] && printf '%s' "$TOTAL" | grep -qE '^[0-9]+$'; then
  pass "memory search available" "totalEntries=$TOTAL bySource=$(printf '%s' "$STATS" | jget bySource)"
else
  fail "memory search available" "http=$SC available=$AVAIL total=$TOTAL reason=$(printf '%s' "$STATS" | jget unavailableReason)"
fi

# 3. A real FTS5 query returns 200 (not 503) with a hits array
QC=$(code "${H[@]}" "$BASE_URL/api/memory/search?q=the&limit=3")
QBODY=$(curl -s --max-time 20 "${H[@]}" "$BASE_URL/api/memory/search?q=the&limit=3")
if [ "$QC" = "200" ] && [ -n "$(printf '%s' "$QBODY" | jget hits)" ]; then
  pass "FTS query returns 200 with hits[]" "count=$(printf '%s' "$QBODY" | jget count)"
else
  fail "FTS query" "http=$QC body=$(printf '%s' "$QBODY" | head -c 160)"
fi

echo "  ────────────────────────────────────────────────────"
echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
