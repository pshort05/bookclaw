#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — F1 sequence advancement smoke (REAL OpenRouter calls)
# ═══════════════════════════════════════════════════════════
# Verifies config-not-code follow-up F1 against a running instance: a book bound
# to a MULTI-pipeline sequence chains one Project per phase (shared pipelineId).
#  - GET  /api/pipeline/:id            lists all phases.
#  - POST /api/pipeline/:id/advance    is GATED: it will not start phase 2 while
#                                      phase 1 is still running.
#  - the onProjectCompleted hook AUTO-advances: once phase 1 actually completes,
#    phase 2 is started (active) without a manual advance call.
# Runs phase 1 to completion on a cheap OpenRouter model (chapters=1) to exercise
# the real completion→hook path. Self-cleaning.
#
# Usage:  BASE_URL=http://192.168.1.32:3847 tests/pipeline-advance-smoke.sh
#         CLEANUP=1 BASE_URL=... tests/pipeline-advance-smoke.sh
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
# phase status by 0-based index, from GET /api/pipeline/:id
phstat(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=(JSON.parse(s).phases||[])[Number(process.argv[1])];console.log(p?p.status:"")}catch(e){}})' "$1"; }

clean(){
  for slug in $(req GET /api/books | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).books||[]).filter(b=>String(b.title).startsWith("Advance Smoke")).forEach(b=>console.log(b.slug))}catch(e){}})'); do code DELETE "/api/books/$slug" >/dev/null && echo "  [clean] book $slug"; done
}

if [ "${CLEANUP:-}" = "1" ]; then echo "▶ CLEANUP"; clean; exit 0; fi

echo "▶ F1 sequence-advance smoke → $BASE_URL"
[ "$(code GET /api/library)" = "404" ] && { echo "  ✗ /api/library absent — aborting"; exit 1; }
# advance endpoint must exist on the target build (feature-detect)
[ "$(code POST /api/pipeline/__none__/advance)" = "404" ] || { echo "  ⚠ POST /api/pipeline/:id/advance absent (404 expected for unknown id) — build lacks F1; skipping"; exit 0; }
if ! req POST /api/providers/refresh | grep -q '"openrouter"'; then
  echo "  ⚠ OpenRouter not configured — skipping (need a paid provider to complete a phase)"; exit 0
fi
clean

# ── 1. Book bound to a TWO-pipeline sequence ──
SLUG=$(req POST /api/books "$(node -e 'console.log(JSON.stringify({title:"Advance Smoke "+process.argv[1],author:"default",voice:"default",genre:null,pipelineSequence:["book-production","book-production"],sections:[]}))' "$RANDOM")" | jget book.slug)
[ -n "$SLUG" ] && pass "book created from 2-pipeline sequence" "$SLUG" || { fail "book create"; clean; exit "$FAILS"; }
code POST /api/books/active "{\"slug\":\"$SLUG\"}" >/dev/null

# ── 2. Sequence project chains 2 phases under one pipelineId ──
CREATE=$(req POST /api/projects/create '{"title":"Advance Smoke Run","description":"Tiny one-chapter run.","chapters":1,"wordsPerChapter":80}')
PLID=$(printf '%s' "$CREATE" | jget pipelineId)
P1=$(printf '%s' "$CREATE" | jget project.id)
NPROJ=$(printf '%s' "$CREATE" | jget projects | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).length)}catch(e){console.log(0)}})')
{ [ -n "$PLID" ] && [ "$NPROJ" = "2" ]; } && pass "create chained 2 phase-projects" "pipelineId=$PLID" || { fail "sequence create" "pipelineId='$PLID' nproj='$NPROJ'"; clean; exit "$FAILS"; }
[ "$(req GET "/api/pipeline/$PLID" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).phases||[]).length)}catch(e){console.log(0)}})')" = "2" ] \
  && pass "GET /api/pipeline lists both phases" || fail "pipeline listing"

# ── 3. Advance is GATED while phase 1 is unstarted/incomplete ──
code POST "/api/projects/$P1/start" >/dev/null   # phase 1 → active (mirrors PipelineRail)
ADV=$(req POST "/api/pipeline/$PLID/advance")
[ "$(printf '%s' "$ADV" | jget advanced)" = "false" ] \
  && pass "advance blocked while phase 1 active" || fail "advance NOT gated" "$(printf '%s' "$ADV" | head -c 160)"
[ "$(req GET "/api/pipeline/$PLID" | phstat 1)" = "pending" ] \
  && pass "phase 2 still pending (not started early)" || fail "phase 2 started prematurely"

# ── 4. Complete phase 1 on a cheap model → hook AUTO-advances phase 2 ──
code POST "/api/projects/$P1/provider" "{\"provider\":\"openrouter\",\"model\":\"$SMOKE_OR_MODEL\"}" >/dev/null
code POST "/api/projects/$P1/auto-execute" "" 600 >/dev/null
P1STATUS=$(req GET "/api/projects/$P1" | jget project.status)
[ "$P1STATUS" = "completed" ] && pass "phase 1 ran to completion (real OpenRouter)" \
  || { fail "phase 1 did not complete" "status=$P1STATUS"; clean; exit "$FAILS"; }
P2STATUS=$(req GET "/api/pipeline/$PLID" | phstat 1)
[ "$P2STATUS" = "active" ] \
  && pass "onProjectCompleted hook AUTO-started phase 2" "phase2=$P2STATUS" \
  || fail "phase 2 not auto-advanced" "phase2=$P2STATUS"

echo ""; echo "  ── cleanup ──"; clean
echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
