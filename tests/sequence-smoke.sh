#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — config-not-code pipelines smoke (REAL OpenRouter calls)
# ═══════════════════════════════════════════════════════════
# Verifies the 2026-06-14 sequence/expand feature end-to-end against a running
# instance: create a book bound to a one-pipeline sequence (book-production) with
# targetChapters=2, confirm the data-driven expand construct produced the
# per-chapter Write/Polish steps from the book's SNAPSHOT (not code), then run
# the first chapter step on a paid OpenRouter model and assert per-book spend.
# Self-cleaning. Forces OpenRouter so a real (small) cost is recorded.
#
# Usage:  BASE_URL=http://192.168.1.32:3847 tests/sequence-smoke.sh
#         CLEANUP=1 BASE_URL=... tests/sequence-smoke.sh
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else docker/.env / docker exec), CONTAINER, SMOKE_OR_MODEL.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SMOKE_OR_MODEL="${SMOKE_OR_MODEL:-google/gemini-2.5-flash}"
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
code(){ local m="$1" p="$2" b="${3:-}" t="${4:-300}"; if [ -n "$b" ]; then curl -s -o /dev/null -w '%{http_code}' --max-time "$t" "${H[@]}" -X "$m" -d "$b" "$BASE_URL$p"; else curl -s -o /dev/null -w '%{http_code}' --max-time "$t" "${H[@]}" -X "$m" "$BASE_URL$p"; fi; }
req(){ local m="$1" p="$2" b="${3:-}" t="${4:-300}"; if [ -n "$b" ]; then curl -s --max-time "$t" "${H[@]}" -X "$m" -d "$b" "$BASE_URL$p"; else curl -s --max-time "$t" "${H[@]}" -X "$m" "$BASE_URL$p"; fi; }
jget(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){process.exit(0)}let c=j;for(const raw of process.argv[1].split(".")){const m=raw.match(/^([^\[]*)((\[\d+\])*)$/);if(!m)process.exit(0);if(m[1]!==""){if(c==null)process.exit(0);c=c[m[1]]}const idx=(m[2]||"").match(/\d+/g)||[];for(const i of idx){if(c==null)process.exit(0);c=c[Number(i)]}}if(c==null)process.exit(0);console.log(typeof c==="object"?JSON.stringify(c):String(c))})' "$1"; }
bookspend(){ req GET /api/costs | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const v=(j.byBook||{})[process.argv[1]];console.log(v==null?"":String(v))}catch(e){}})' "$1"; }

clean(){
  for slug in $(req GET /api/books | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).books||[]).filter(b=>String(b.title).startsWith("Sequence Smoke")).forEach(b=>console.log(b.slug))}catch(e){}})'); do code DELETE "/api/books/$slug" >/dev/null && echo "  [clean] book $slug"; done
}

if [ "${CLEANUP:-}" = "1" ]; then echo "▶ CLEANUP"; clean; exit 0; fi

echo "▶ Sequence / expand smoke → $BASE_URL"
[ "$(code GET /api/library)" = "404" ] && { echo "  ✗ /api/library absent — aborting"; exit 1; }
if ! req POST /api/providers/refresh | grep -q '"openrouter"'; then
  echo "  ⚠ OpenRouter not configured — skipping (need a paid provider to record cost)"; exit 0
fi
clean

# ── 0. The sequence kind + novel preset exist ──
[ -n "$(req GET '/api/library/sequence/novel' | jget entry.sequence.pipelines[0])" ] && pass "novel sequence preset present" || fail "novel sequence missing"

# ── 1. Book bound to a one-pipeline sequence (book-production) ──
SLUG=$(req POST /api/books "$(node -e 'console.log(JSON.stringify({title:"Sequence Smoke "+process.argv[1],author:"default",voice:"default",genre:null,pipelineSequence:["book-production"],sections:[]}))' "$RANDOM")" | jget book.slug)
[ -n "$SLUG" ] && pass "book created from pipelineSequence" "$SLUG" || { fail "book create"; clean; exit "$FAILS"; }
SEQ=$(req GET "/api/books/$SLUG" | jget book.pipelineSequence)
case "$SEQ" in *book-production*) pass "manifest carries pipelineSequence" "$SEQ" ;; *) fail "pipelineSequence missing" "$SEQ" ;; esac
code POST /api/books/active "{\"slug\":\"$SLUG\"}" >/dev/null

# ── 2. Project from the sequence → expand produced per-chapter steps from DATA ──
BASE_TOTAL=$(printf '%s' "$(req GET /api/costs)" | jget total)
PID=$(req POST /api/projects/create '{"title":"Sequence Smoke Run","description":"Tiny two-chapter run.","chapters":2,"wordsPerChapter":120}' | jget project.id)
[ -n "$PID" ] && pass "project created via sequence path" "$PID" || { fail "project create"; clean; exit "$FAILS"; }
LABELS=$(req GET "/api/projects/$PID" | jget project.steps | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).map(x=>x.label).join(" | "))}catch(e){console.log("")}})')
case "$LABELS" in
  *"Write Chapter 1"*"Polish Chapter 1"*"Write Chapter 2"*"Polish Chapter 2"*)
    pass "expand construct produced interleaved per-chapter steps" "from the book snapshot (data, not code)" ;;
  *) fail "expand did not produce per-chapter steps" "labels=$LABELS" ;;
esac

# ── 3. Run the first chapter step on a paid model → per-book spend ──
code POST "/api/projects/$PID/provider" "{\"provider\":\"openrouter\",\"model\":\"$SMOKE_OR_MODEL\"}" >/dev/null
[ -z "$(req GET "/api/projects/$PID" | jget project.steps[0].status | grep -x active)" ] && code POST "/api/projects/$PID/start" >/dev/null
XR=$(req POST "/api/projects/$PID/execute" "" 300)
[ "$(printf '%s' "$XR" | jget success)" = "true" ] && pass "first chapter step ran (real OpenRouter call)" || fail "step execute" "$(printf '%s' "$XR" | head -c 200)"
SPEND=$(bookspend "$SLUG"); NEW_TOTAL=$(printf '%s' "$(req GET /api/costs)" | jget total)
{ [ -n "$SPEND" ] && node -e "process.exit(Number(process.argv[1])>0?0:1)" "$SPEND"; } \
  && pass "per-book spend attributed" "byBook[$SLUG]=$SPEND" || fail "per-book spend not attributed" "byBook[$SLUG]='$SPEND'"
# Non-decreasing: the 4dp-rounded display can stay flat for a sub-$0.0001 call
# while the new book's bucket (from 0) rounds up — byBook>0 above is the real proof.
node -e "process.exit(Number(process.argv[1])>=Number(process.argv[2])?0:1)" "${NEW_TOTAL:-0}" "${BASE_TOTAL:-0}" \
  && pass "lifetime total non-decreasing" "$BASE_TOTAL → $NEW_TOTAL" || fail "lifetime total decreased" "$BASE_TOTAL → $NEW_TOTAL"

echo ""; echo "  ── cleanup ──"; clean
echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
