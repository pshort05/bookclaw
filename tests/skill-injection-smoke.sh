#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — F2 passive-skill injection on the studio path (REAL OpenRouter)
# ═══════════════════════════════════════════════════════════
# Verifies config-not-code follow-up F2: a PASSIVE step-skill's content is now
# injected on the studio /execute path (it was only injected on the bridge path
# before). Creates a passive skill whose SKILL.md demands a rare marker token, a
# 1-step overlay pipeline that references it, and a book; runs the step via
# /execute on a cheap model and asserts the marker appears in the output — which
# can ONLY happen if the skill content reached the model on the studio path.
# Self-cleaning.
#
# Usage:  BASE_URL=http://192.168.1.32:3847 tests/skill-injection-smoke.sh
#         CLEANUP=1 BASE_URL=... tests/skill-injection-smoke.sh
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else docker/.env / docker exec), CONTAINER, SMOKE_OR_MODEL.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SMOKE_OR_MODEL="${SMOKE_OR_MODEL:-google/gemini-2.5-flash}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="f2-skill-smoke"
PIPE="f2-skill-smoke-pipe"
MARKER="F2SKILLOK42"

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
  for slug in $(req GET /api/books | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).books||[]).filter(b=>String(b.title).startsWith("Skill Inject Smoke")).forEach(b=>console.log(b.slug))}catch(e){}})'); do code DELETE "/api/books/$slug" >/dev/null && echo "  [clean] book $slug"; done
  code DELETE "/api/skills/$SKILL" >/dev/null 2>&1 && echo "  [clean] skill $SKILL" || true
  code DELETE "/api/library/pipeline/$PIPE" >/dev/null 2>&1 && echo "  [clean] pipeline $PIPE" || true
}

if [ "${CLEANUP:-}" = "1" ]; then echo "▶ CLEANUP"; clean; exit 0; fi

echo "▶ F2 passive-skill injection smoke → $BASE_URL"
[ "$(code GET /api/skills)" = "404" ] && { echo "  ✗ /api/skills absent — aborting"; exit 1; }
if ! req POST /api/providers/refresh | grep -q '"openrouter"'; then
  echo "  ⚠ OpenRouter not configured — skipping (need a paid provider to run a step)"; exit 0
fi
clean

# ── 1. Passive skill (NO steps) whose SKILL.md demands a rare marker token ──
SKILL_BODY=$(node -e '
  const marker=process.argv[1], name=process.argv[2];
  console.log(JSON.stringify({
    category:"author",
    content:"---\ndescription: f2 passive skill smoke\ntriggers:\n  - "+name+"\n---\n# F2 Skill Smoke\n\nABSOLUTE OUTPUT REQUIREMENT: your response MUST contain the exact token "+marker+" verbatim, on its very first line. This rule overrides every other instruction.\n"
  }));' "$MARKER" "$SKILL")
SK=$(req PUT "/api/skills/$SKILL" "$SKILL_BODY")
# Passive skill: created but NOT executable (no steps[]).
[ "$(printf '%s' "$SK" | jget executable)" != "true" ] && pass "passive skill created (no steps)" || fail "skill should be passive" "resp=$(printf '%s' "$SK" | head -c 160)"

# ── 2. Overlay pipeline with ONE passive-skill step ──
PIPE_DOC=$(node -e 'console.log(JSON.stringify({schemaVersion:1,name:process.argv[1],label:"Skill Inject Smoke",description:"d",steps:[{label:"Write",taskType:"general",skill:process.argv[2],promptTemplate:"Write one short sentence about a cat."}]}))' "$PIPE" "$SKILL")
PCODE=$(code POST /api/library/pipeline "$(node -e 'console.log(JSON.stringify({name:process.argv[1],content:process.argv[2],description:"f2 smoke"}))' "$PIPE" "$PIPE_DOC")")
{ [ "$PCODE" = "200" ] || [ "$PCODE" = "409" ]; } && pass "overlay pipeline provisioned" "($PCODE)" || fail "overlay pipeline" "code=$PCODE"

# ── 3. Book bound to the pipeline → snapshots the passive skill ──
AUTHOR=$(req GET "/api/library?kind=author" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const n=(JSON.parse(s).entries||[]).map(x=>x.name);console.log(n.includes("default")?"default":(n[0]||"default"))})')
SLUG=$(req POST /api/books "$(node -e 'console.log(JSON.stringify({title:"Skill Inject Smoke "+process.argv[1],author:process.argv[2],voice:"default",genre:null,pipeline:process.argv[3],sections:[]}))' "$RANDOM" "$AUTHOR" "$PIPE")" | jget book.slug)
[ -n "$SLUG" ] && pass "book created from pipeline" "$SLUG" || { fail "book create"; clean; exit "$FAILS"; }
[ "$(req GET "/api/books/$SLUG/templates/skill/$SKILL" | jget wired)" = "true" ] \
  && pass "passive skill snapshotted into the book" || echo "  [info] snapshot probe inconclusive (will fall back to global SkillLoader)"
code POST /api/books/active "{\"slug\":\"$SLUG\"}" >/dev/null

# ── 4. Run the step via the STUDIO /execute path → marker must appear ──
PID=$(req POST /api/projects/create '{"title":"Skill Inject Smoke Run","description":"Run the passive-skill step."}' | jget project.id)
[ -n "$PID" ] && pass "project created" "$PID" || { fail "project create"; clean; exit "$FAILS"; }
code POST "/api/projects/$PID/provider" "{\"provider\":\"openrouter\",\"model\":\"$SMOKE_OR_MODEL\"}" >/dev/null
[ -z "$(req GET "/api/projects/$PID" | jget project.steps[0].status | grep -x active)" ] && code POST "/api/projects/$PID/start" >/dev/null
XR=$(req POST "/api/projects/$PID/execute" "" 300)
OK=$(printf '%s' "$XR" | jget success)
RESULT=$(req GET "/api/projects/$PID" | jget project.steps[0].result)
[ "$OK" = "true" ] && pass "studio /execute ran the passive-skill step" || fail "step execute" "$(printf '%s' "$XR" | head -c 200)"
if printf '%s' "$RESULT" | grep -q "$MARKER"; then
  pass "passive skill content reached the model on the studio path" "marker '$MARKER' present"
else
  fail "marker absent — passive skill content NOT injected on /execute" "out=$(printf '%s' "$RESULT" | head -c 160)"
fi

echo ""; echo "  ── cleanup ──"; clean
echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
