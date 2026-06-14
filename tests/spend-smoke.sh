#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — per-book / lifetime spend smoke (REAL OpenRouter calls)
# ═══════════════════════════════════════════════════════════
# Verifies the 2026-06-14 spend-tracking feature end-to-end against a running
# instance: a pipeline step bound to a book is run on a paid OpenRouter model,
# then asserts the recorded cost lands in BOTH the lifetime total AND the book's
# per-book bucket (`byBook[slug]`), and that POST /api/costs/reset-total clears
# the selected book bucket. Forces OpenRouter so a non-zero cost is recorded;
# the small spend is the point ("spend real money to fully test"). Self-cleaning.
#
# Usage:  BASE_URL=http://192.168.1.32:3847 tests/spend-smoke.sh
#         CLEANUP=1 BASE_URL=... tests/spend-smoke.sh   # just remove leftovers
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else docker/.env / docker exec), CONTAINER, SMOKE_OR_MODEL.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SMOKE_OR_MODEL="${SMOKE_OR_MODEL:-google/gemini-2.5-flash}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIPE="spend-smoke-pipe"

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
code(){ local m="$1" p="$2" b="${3:-}" t="${4:-300}"; if [ -n "$b" ]; then curl -s -o /dev/null -w '%{http_code}' --max-time "$t" "${H[@]}" -X "$m" -d "$b" "$BASE_URL$p"; else curl -s -o /dev/null -w '%{http_code}' --max-time "$t" "${H[@]}" -X "$m" "$BASE_URL$p"; fi; }
req(){ local m="$1" p="$2" b="${3:-}" t="${4:-300}"; if [ -n "$b" ]; then curl -s --max-time "$t" "${H[@]}" -X "$m" -d "$b" "$BASE_URL$p"; else curl -s --max-time "$t" "${H[@]}" -X "$m" "$BASE_URL$p"; fi; }
jget(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){process.exit(0)}let c=j;for(const raw of process.argv[1].split(".")){const m=raw.match(/^([^\[]*)((\[\d+\])*)$/);if(!m)process.exit(0);if(m[1]!==""){if(c==null)process.exit(0);c=c[m[1]]}const idx=(m[2]||"").match(/\d+/g)||[];for(const i of idx){if(c==null)process.exit(0);c=c[Number(i)]}}if(c==null)process.exit(0);console.log(typeof c==="object"?JSON.stringify(c):String(c))})' "$1"; }
# byBook[slug] from /api/costs, or empty string
bookspend(){ req GET /api/costs | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const v=(j.byBook||{})[process.argv[1]];console.log(v==null?"":String(v))}catch(e){}})' "$1"; }

clean(){
  for slug in $(req GET /api/books | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).books||[]).filter(b=>String(b.title).startsWith("Spend Smoke")).forEach(b=>console.log(b.slug))}catch(e){}})'); do code DELETE "/api/books/$slug" >/dev/null && echo "  [clean] book $slug"; done
  code DELETE "/api/library/pipeline/$PIPE" >/dev/null 2>&1 && echo "  [clean] pipeline $PIPE" || true
}

if [ "${CLEANUP:-}" = "1" ]; then echo "▶ CLEANUP"; clean; exit 0; fi

echo "▶ Spend tracking smoke → $BASE_URL"
[ "$(code GET /api/costs)" = "404" ] && { echo "  ✗ /api/costs absent — aborting"; exit 1; }
# Need a paid provider so a non-zero cost is actually recorded.
if ! req POST /api/providers/refresh | grep -q '"openrouter"'; then
  echo "  ⚠ OpenRouter not configured on this instance — skipping (need a paid provider to record cost)"; exit 0
fi
clean

# ── 0. /api/costs exposes the new shape ──
COSTS=$(req GET /api/costs)
[ -n "$(printf '%s' "$COSTS" | jget total)" ] && pass "GET /api/costs exposes total" || fail "costs.total missing" "$(printf '%s' "$COSTS" | head -c 120)"
[ "$(printf '%s' "$COSTS" | jget byBook)" != "" ] && pass "GET /api/costs exposes byBook" || fail "costs.byBook missing"

# ── 1. One-step overlay pipeline (short, cheap) ──
PIPE_DOC=$(node -e 'console.log(JSON.stringify({schemaVersion:1,name:process.argv[1],label:"Spend Smoke",description:"d",steps:[{label:"Tiny",taskType:"general",phase:"planning",promptTemplate:"In three or four complete sentences, describe the color blue and how it makes people feel. Write at least sixty words."}]}))' "$PIPE")
PCODE=$(code POST /api/library/pipeline "$(node -e 'console.log(JSON.stringify({name:process.argv[1],content:process.argv[2],description:"spend smoke"}))' "$PIPE" "$PIPE_DOC")")
{ [ "$PCODE" = "200" ] || [ "$PCODE" = "409" ]; } && pass "overlay pipeline provisioned" "($PCODE)" || fail "overlay pipeline" "code=$PCODE"

# ── 2. Book bound to the pipeline + project pinned to OpenRouter ──
AUTHOR=$(req GET "/api/library?kind=author" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=(JSON.parse(s).entries||[]).map(x=>x.name);console.log(n.includes("default")?"default":(n[0]||"default"))})')
SLUG=$(req POST /api/books "$(node -e 'console.log(JSON.stringify({title:"Spend Smoke "+process.argv[1],author:process.argv[2],voice:"default",genre:null,pipeline:process.argv[3],sections:[]}))' "$RANDOM" "$AUTHOR" "$PIPE")" | jget book.slug)
[ -n "$SLUG" ] && pass "book created" "$SLUG" || { fail "book create"; clean; exit "$FAILS"; }
code POST /api/books/active "{\"slug\":\"$SLUG\"}" >/dev/null
BASE_TOTAL=$(printf '%s' "$(req GET /api/costs)" | jget total)
PID=$(req POST /api/projects/create '{"title":"Spend Smoke Run","description":"Tiny step."}' | jget project.id)
[ -n "$PID" ] && pass "project created" "$PID" || { fail "project create"; clean; exit "$FAILS"; }
# Force OpenRouter so the step records a real (small) cost, and pin the cheap model.
code POST "/api/projects/$PID/provider" "{\"provider\":\"openrouter\",\"model\":\"$SMOKE_OR_MODEL\"}" >/dev/null
[ -z "$(req GET "/api/projects/$PID" | jget project.steps[0].status | grep -x active)" ] && code POST "/api/projects/$PID/start" >/dev/null

# ── 3. Run the step (real OpenRouter call) ──
XR=$(req POST "/api/projects/$PID/execute" "" 300)
OK=$(printf '%s' "$XR" | jget success)
[ "$OK" = "true" ] && pass "pipeline step ran (real OpenRouter call)" || fail "step execute" "$(printf '%s' "$XR" | head -c 200)"

# ── 4. Per-book + lifetime attribution ──
SPEND=$(bookspend "$SLUG")
NEW_TOTAL=$(printf '%s' "$(req GET /api/costs)" | jget total)
if [ -n "$SPEND" ] && node -e "process.exit(Number(process.argv[1])>0?0:1)" "$SPEND"; then
  pass "per-book spend attributed" "byBook[$SLUG]=$SPEND"
else
  fail "per-book spend not attributed" "byBook[$SLUG]='$SPEND' (provider may have routed free/Ollama)"
fi
if node -e "process.exit(Number(process.argv[1])>Number(process.argv[2])?0:1)" "${NEW_TOTAL:-0}" "${BASE_TOTAL:-0}"; then
  pass "lifetime total increased" "$BASE_TOTAL → $NEW_TOTAL"
else
  fail "lifetime total did not increase" "$BASE_TOTAL → $NEW_TOTAL"
fi

# ── 5. Selective reset clears the book bucket ──
code POST /api/costs/reset-total "{\"books\":[\"$SLUG\"]}" >/dev/null
AFTER=$(bookspend "$SLUG")
RESET_TOTAL=$(printf '%s' "$(req GET /api/costs)" | jget total)
[ -z "$AFTER" ] && pass "reset-total cleared the book bucket" "byBook[$SLUG] gone" || fail "book bucket not cleared" "byBook[$SLUG]='$AFTER'"
[ "${RESET_TOTAL:-x}" = "0" ] && pass "reset-total zeroed the lifetime total" || fail "lifetime total not zeroed" "total=$RESET_TOTAL"

echo ""; echo "  ── cleanup ──"; clean
echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
