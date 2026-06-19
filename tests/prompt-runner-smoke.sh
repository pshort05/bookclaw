#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Prompt Runner smoke (REAL AI call)
# ═══════════════════════════════════════════════════════════
# Verifies the Prompt Runner feature against a running instance: a built-in prompt
# resolves, a book data/ file is written, POST /api/prompts/run produces an
# in-character editorial result (real model call), the result is saved back over
# the file, and the prior content is snapshotted as a restorable version.
# Self-cleaning (deletes the created book).
#
# Usage:  BASE_URL=http://192.168.1.32:3847 tests/prompt-runner-smoke.sh
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else docker/.env / docker exec), CONTAINER.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPT="${PROMPT:-copy-editor}"

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
  for slug in $(req GET /api/books | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).books||[]).filter(b=>String(b.title).startsWith("Prompt Runner Smoke")).forEach(b=>console.log(b.slug))}catch(e){}})'); do code DELETE "/api/books/$slug" >/dev/null && echo "  [clean] book $slug"; done
}

if [ "${CLEANUP:-}" = "1" ]; then echo "▶ CLEANUP"; clean; exit 0; fi

echo "▶ Prompt Runner smoke → $BASE_URL"
[ "$(code GET /api/library)" = "404" ] && { echo "  ✗ /api/library absent — aborting"; exit 1; }
clean

# ── 1. Built-in prompt present ──
[ -n "$(req GET "/api/library/prompt/$PROMPT" | jget entry.prompt.systemPrompt)" ] \
  && pass "built-in prompt '$PROMPT' resolves" || { fail "prompt '$PROMPT' missing"; exit 1; }

# ── 2. Book + a data/ file to run against ──
SLUG=$(req POST /api/books "$(node -e 'console.log(JSON.stringify({title:"Prompt Runner Smoke "+process.argv[1],author:"default",voice:"default",genre:null,pipelineSequence:["book-production"],sections:[]}))' "$RANDOM")" | jget book.slug)
[ -n "$SLUG" ] && pass "book created" "$SLUG" || { fail "book create"; clean; exit 1; }
PROSE='She walked quickly into the room and she was very nervous. "I just wanted to say that, well, I think we should maybe talk," she said nervously. He looked at her and he felt angry but he did not say anything at all.'
[ "$(code PUT "/api/books/$SLUG/files/probe.md" "$(node -e 'console.log(JSON.stringify({content:process.argv[1]}))' "$PROSE")")" = "200" ] \
  && pass "wrote a data/ file to run against" || fail "PUT probe.md failed"

# ── 3. Run the prompt against the file (real model call) ──
RUN=$(req POST /api/prompts/run "$(node -e 'console.log(JSON.stringify({prompt:process.argv[1],content:process.argv[2],bookSlug:process.argv[3]}))' "$PROMPT" "$PROSE" "$SLUG")" 300)
OUT=$(printf '%s' "$RUN" | jget output)
if [ -n "$OUT" ] && [ "${#OUT}" -gt 20 ] && ! printf '%s' "$OUT" | grep -q '\[AI provider failure\]'; then
  pass "prompt produced an editorial result (real AI call)" "${OUT:0:60}…"
else
  fail "prompt run empty/failed" "$(printf '%s' "$RUN" | head -c 200)"
fi

# ── 4. Save the result back → prior content snapshotted as a version ──
[ "$(code PUT "/api/books/$SLUG/files/probe.md" "$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify({content:s})))' <<<"$OUT")")" = "200" ] \
  && pass "saved the result back over the file" || fail "PUT result back failed"
VID=$(req GET "/api/books/$SLUG/files/probe.md/versions" | jget versions[0].id)
[ -n "$VID" ] && pass "prior content snapshotted as a restorable version" "$VID" || fail "no version recorded after save-back"

# ── 5. Book-root file API: runner-files lists data/ + templates/ ──
RF=$(req GET "/api/books/$SLUG/runner-files")
case "$RF" in *'data/probe.md'*) pass "runner-files lists the data/ output" ;; *) fail "runner-files missing data/probe.md" "$(printf '%s' "$RF" | head -c 160)" ;; esac
TPL=$(printf '%s' "$RF" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const f=(JSON.parse(s).files||[]).find(x=>x.group==="Templates");if(f)console.log(f.path)}catch(e){}})')
[ -n "$TPL" ] && pass "runner-files lists a templates/ snapshot" "$TPL" || fail "runner-files has no templates/ entry"

# ── 6. Read + write-back + version + restore a TEMPLATE file via /file?path= ──
if [ -n "$TPL" ]; then
  ORIG=$(req GET "/api/books/$SLUG/file?path=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$TPL")")
  [ -n "$ORIG" ] && pass "read a template file by path" || fail "GET /file?path=$TPL empty"
  [ "$(code PUT "/api/books/$SLUG/file" "$(node -e 'console.log(JSON.stringify({path:process.argv[1],content:process.argv[2]+"\n<!-- runner smoke -->"}))' "$TPL" "$ORIG")")" = "200" ] \
    && pass "wrote back to a template file" || fail "PUT /file (template) failed"
  TVID=$(req GET "/api/books/$SLUG/file/versions?path=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$TPL")" | jget versions[0].id)
  [ -n "$TVID" ] && pass "template write-back snapshotted a version" "$TVID" || fail "no template version recorded"
  [ "$(code POST "/api/books/$SLUG/file/restore" "$(node -e 'console.log(JSON.stringify({path:process.argv[1],id:process.argv[2]}))' "$TPL" "$TVID")")" = "200" ] \
    && pass "restored the template version" || fail "template restore failed"
fi

# ── 7. Path guard: book.json / traversal are rejected ──
[ "$(code GET "/api/books/$SLUG/file?path=book.json")" = "400" ] \
  && pass "path outside data/|templates/ rejected (400)" || fail "book.json was not rejected"

echo ""; echo "  ── cleanup ──"; clean
echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
