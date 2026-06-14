#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — multi-step executable skill smoke (REAL OpenRouter calls)
# ═══════════════════════════════════════════════════════════
# Creates an executable 2-phase skill (steps.json via PUT /api/skills), a 1-step
# overlay pipeline that uses it, and a book; runs the step and asserts the skill's
# OpenRouter phase chain produced a non-empty, non-failure result. Multi-step skills
# are OpenRouter-only, so OpenRouter must be configured. Cleans up after itself.
#
# Usage:  BASE_URL=http://192.168.1.32:3847 tests/skill-steps-smoke.sh
#         CLEANUP=1 BASE_URL=... tests/skill-steps-smoke.sh   # just remove leftovers
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else docker/.env / docker exec), CONTAINER, SMOKE_OR_MODEL.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SMOKE_OR_MODEL="${SMOKE_OR_MODEL:-google/gemini-2.5-flash}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="skill-steps-smoke"
PIPE="skill-steps-smoke-pipe"

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

clean(){
  for slug in $(req GET /api/books | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).books||[]).filter(b=>String(b.title).startsWith("Skill Steps Smoke")).forEach(b=>console.log(b.slug))}catch(e){}})'); do code DELETE "/api/books/$slug" >/dev/null && echo "  [clean] book $slug"; done
  code DELETE "/api/skills/$SKILL" >/dev/null 2>&1 && echo "  [clean] skill $SKILL" || true
  code DELETE "/api/library/pipeline/$PIPE" >/dev/null 2>&1 && echo "  [clean] pipeline $PIPE" || true
}

if [ "${CLEANUP:-}" = "1" ]; then echo "▶ CLEANUP"; clean; exit 0; fi

echo "▶ Multi-step skill smoke → $BASE_URL"
[ "$(code GET /api/skills)" = "404" ] && { echo "  ✗ /api/skills absent — aborting"; exit 1; }
# OpenRouter must be present (the feature is OpenRouter-only).
if ! req POST /api/providers/refresh | grep -q '"openrouter"'; then
  echo "  ⚠ OpenRouter not configured on this instance — skipping (multi-step skills are OpenRouter-only)"; exit 0
fi
clean

# ── 1. Create the executable 2-phase skill (steps.json via the API) ──
SKILL_BODY=$(node -e '
  const model=process.argv[1];
  console.log(JSON.stringify({
    category:"author",
    content:"---\ndescription: smoke 2-phase humanize\ntriggers:\n  - "+process.argv[2]+"\n---\n# "+process.argv[2]+"\n\nShared guidance: write plainly.\n",
    retries:1,
    steps:[
      {name:"detect",   model, temperature:0.2, prompt:"List up to 2 AI-cliche phrases in this text (or write NONE):\n{{input}}"},
      {name:"humanize", model, temperature:0.7, prompt:"Rewrite the text below in ONE short, plain sentence. Cliches to remove:\n{{previous}}\n\nGuidance: {{guidance}}\n\nText:\n{{input}}"}
    ]
  }));' "$SMOKE_OR_MODEL" "$SKILL")
SK=$(req PUT "/api/skills/$SKILL" "$SKILL_BODY")
[ "$(printf '%s' "$SK" | jget executable)" = "true" ] && pass "executable skill created (2 phases)" || fail "executable skill created" "resp=$(printf '%s' "$SK" | head -c 160)"

# ── 2. Overlay pipeline with ONE step that uses the skill ──
PIPE_DOC=$(node -e 'console.log(JSON.stringify({schemaVersion:1,name:process.argv[1],label:"Skill Steps Smoke",description:"d",steps:[{label:"Humanize",taskType:"general",skill:process.argv[2],phase:"revision",promptTemplate:"In todays fast-paced world, it is important to note that we must leverage synergies to humanize \"{{title}}\"."}]}))' "$PIPE" "$SKILL")
PCODE=$(code POST /api/library/pipeline "$(node -e 'console.log(JSON.stringify({name:process.argv[1],content:process.argv[2],description:"skill-steps smoke"}))' "$PIPE" "$PIPE_DOC")")
{ [ "$PCODE" = "200" ] || [ "$PCODE" = "409" ]; } && pass "overlay pipeline provisioned" "($PCODE)" || fail "overlay pipeline" "code=$PCODE"

# ── 3. Book from the pipeline + a project, then execute the step ──
AUTHOR=$(req GET "/api/library?kind=author" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=(JSON.parse(s).entries||[]).map(x=>x.name);console.log(n.includes("default")?"default":(n[0]||"default"))})')
SLUG=$(req POST /api/books "$(node -e 'console.log(JSON.stringify({title:"Skill Steps Smoke "+process.argv[1],author:process.argv[2],voice:"default",genre:null,pipeline:process.argv[3],sections:[]}))' "$RANDOM" "$AUTHOR" "$PIPE")" | jget book.slug)
[ -n "$SLUG" ] && pass "book created" "$SLUG" || { fail "book create"; clean; exit "$FAILS"; }
code POST /api/books/active "{\"slug\":\"$SLUG\"}" >/dev/null
PID=$(req POST /api/projects/create '{"title":"Skill Steps Smoke Run","description":"Run the humanize skill step."}' | jget project.id)
[ -n "$PID" ] && pass "project created" "$PID" || { fail "project create"; clean; exit "$FAILS"; }
# ensure first step active
[ -z "$(req GET "/api/projects/$PID" | jget project.steps[0].status | grep -x active)" ] && code POST "/api/projects/$PID/start" >/dev/null
XR=$(req POST "/api/projects/$PID/execute" "" 300)
OK=$(printf '%s' "$XR" | jget success)
RESULT=$(req GET "/api/projects/$PID" | jget project.steps[0].result)
if [ "$OK" = "true" ] && [ -n "$RESULT" ] && ! printf '%s' "$RESULT" | grep -q '\[AI provider failure\]'; then
  pass "executable skill ran through the pipeline step (2-phase chain)" "out=$(printf '%s' "$RESULT" | head -c 60)…"
else
  fail "executable skill step" "ok=$OK result=$(printf '%s' "$XR" | head -c 200)"
fi

echo ""; echo "  ── cleanup ──"; clean
echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
