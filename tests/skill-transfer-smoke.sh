#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — executable-skill share/import round-trip smoke (Phase B)
# ═══════════════════════════════════════════════════════════
# Verifies that a multi-step (executable) skill survives an export → import
# round-trip with its steps.json intact: create via PUT /api/skills (steps +
# retries), export the .zip via GET /api/library/skill/:name/export, delete the
# skill, re-import the .zip via POST /api/library/import, then assert the
# re-imported skill is still executable (steps + retries preserved). No AI
# calls — pure transfer surface. Cleans up after itself.
#
# Usage:  BASE_URL=http://192.168.1.32:3847 tests/skill-transfer-smoke.sh
#         CLEANUP=1 BASE_URL=... tests/skill-transfer-smoke.sh   # just remove leftovers
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else docker/.env / docker exec), CONTAINER.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="skill-transfer-smoke"

TOKEN="${BOOKCLAW_AUTH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$SCRIPT_DIR/../docker/.env" ]; then
  TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' "$SCRIPT_DIR/../docker/.env" | cut -d= -f2- | tr -d '\r"')
fi
[ -z "$TOKEN" ] && TOKEN=$(docker exec "$CONTAINER" printenv BOOKCLAW_AUTH_TOKEN 2>/dev/null | tr -d '\r')
[ -z "$TOKEN" ] && { echo "ERROR: no auth token" >&2; exit 1; }
H=(-H "Authorization: Bearer $TOKEN")
HJ=("${H[@]}" -H "Content-Type: application/json")

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }
req(){ local m="$1" p="$2" b="${3:-}"; if [ -n "$b" ]; then curl -s --max-time 30 "${HJ[@]}" -X "$m" -d "$b" "$BASE_URL$p"; else curl -s --max-time 30 "${HJ[@]}" -X "$m" "$BASE_URL$p"; fi; }
code(){ curl -s -o /dev/null -w '%{http_code}' --max-time 30 "${HJ[@]}" -X "$1" "$BASE_URL$2"; }
jget(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){process.exit(0)}let c=j;for(const k of process.argv[1].split(".")){if(c==null)process.exit(0);c=c[k]}if(c==null)process.exit(0);console.log(typeof c==="object"?JSON.stringify(c):String(c))})' "$1"; }

clean(){ code DELETE "/api/skills/$SKILL" >/dev/null 2>&1 && echo "  [clean] skill $SKILL" || true; }

if [ "${CLEANUP:-}" = "1" ]; then echo "▶ CLEANUP"; clean; exit 0; fi

echo "▶ Executable-skill transfer round-trip → $BASE_URL"
[ "$(code GET /api/skills)" = "404" ] && { echo "  ✗ /api/skills absent — aborting"; exit 1; }
clean

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
ZIP="$TMP/skill.zip"

# ── 1. Create an executable 2-phase skill (steps.json via the API) ──
BODY=$(node -e 'console.log(JSON.stringify({
  category: "author",
  content: "---\ndescription: transfer round-trip smoke\ntriggers:\n  - transfer-smoke\n---\n# Transfer Smoke\n\nGuidance body.",
  steps: [
    { name: "detect", model: "google/gemini-2.5-flash", temperature: 0.2, prompt: "find AI tells in {{input}}" },
    { model: "google/gemini-2.5-pro", prompt: "humanize {{input}} using {{previous}}" }
  ],
  retries: 3
}))')
R=$(req PUT "/api/skills/$SKILL" "$BODY")
[ "$(echo "$R" | jget executable)" = "true" ] && pass "executable skill created" || fail "create" "$R"

# ── 2. Export the skill as a .zip ──
HTTP=$(curl -s -o "$ZIP" -w '%{http_code}' --max-time 30 "${H[@]}" "$BASE_URL/api/library/skill/$SKILL/export")
if [ "$HTTP" = "200" ] && unzip -l "$ZIP" 2>/dev/null | grep -q 'files/steps.json'; then
  pass "exported .zip contains steps.json"
else
  fail "export" "http=$HTTP (steps.json present? $(unzip -l "$ZIP" 2>/dev/null | grep -c steps.json))"
fi

# ── 3. Delete the skill so the import is a genuine re-create ──
code DELETE "/api/skills/$SKILL" >/dev/null
[ "$(code GET "/api/skills/$SKILL")" = "404" ] && pass "skill deleted before import" || fail "delete"

# ── 4. Re-import the .zip ──
R=$(curl -s --max-time 30 "${H[@]}" -F "file=@$ZIP" "$BASE_URL/api/library/import")
[ "$(echo "$R" | jget ok)" = "true" ] && pass "imported .zip (clean, no findings)" || fail "import" "$R"

# ── 5. Assert the re-imported skill is still executable ──
R=$(req GET "/api/skills/$SKILL")
STEPS=$(echo "$R" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((j.skill&&j.skill.steps||[]).length)}catch(e){console.log(0)}})')
RETRIES=$(echo "$R" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log(j.skill&&j.skill.retries)}catch(e){console.log("")}})')
if [ "$STEPS" = "2" ] && [ "$RETRIES" = "3" ]; then
  pass "re-imported skill is executable (2 phases, retries=3)"
else
  fail "round-trip fidelity" "steps=$STEPS retries=$RETRIES"
fi

echo ""
echo "  ── cleanup ──"
clean
echo "  SUMMARY: $PASSES passed, $FAILS failed"
[ "$FAILS" -eq 0 ]
