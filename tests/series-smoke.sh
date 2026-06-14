#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Series smoke (REPORT + LEAVE-IN-PLACE, no AI)
# ═══════════════════════════════════════════════════════════
# Focused Series Phase A scenario: ONE series with TWO member books, plus ONE
# standalone book (no series). Asserts the two series books inherited the series'
# author/voice/genre + carry series provenance + are members, and that the
# standalone book did neither. Free (no generation) — just create + read calls.
#
# Unlike the security/feature smoke, this LEAVES the three books + the series on
# disk so you can inspect the result (the board shows the inherited byline on the
# two series books; the API shows membership). A prior run's demo data is removed
# first, so re-runs end with exactly 3 books + 1 series. CLEANUP=1 removes it all.
#
# Usage:
#   BASE_URL=http://192.168.1.32:3847 tests/series-smoke.sh
#   CLEANUP=1 BASE_URL=http://192.168.1.32:3847 tests/series-smoke.sh
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else repo docker/.env, else docker exec), CONTAINER.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SERIES_TITLE="Smoke Series — The Hollow Crown"
TITLE_A="The Hollow Crown: Book One"     # in series
TITLE_B="The Hollow Crown: Book Two"     # in series
TITLE_C="Unrelated: A Standalone Tale"   # NOT in a series
TITLES=("$TITLE_A" "$TITLE_B" "$TITLE_C")

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
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }

code(){ local m="$1" p="$2" b="${3:-}"; if [ -n "$b" ]; then curl -s -o /dev/null -w '%{http_code}' --max-time 30 "${H[@]}" -X "$m" -d "$b" "$BASE_URL$p"; else curl -s -o /dev/null -w '%{http_code}' --max-time 30 "${H[@]}" -X "$m" "$BASE_URL$p"; fi; }
req(){ local m="$1" p="$2" b="${3:-}"; if [ -n "$b" ]; then curl -s --max-time 30 "${H[@]}" -X "$m" -d "$b" "$BASE_URL$p"; else curl -s --max-time 30 "${H[@]}" -X "$m" "$BASE_URL$p"; fi; }
jget(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){process.exit(0)}let c=j;for(const raw of process.argv[1].split(".")){const m=raw.match(/^([^\[]*)((\[\d+\])*)$/);if(!m)process.exit(0);if(m[1]!==""){if(c==null)process.exit(0);c=c[m[1]]}}if(c==null)process.exit(0);console.log(typeof c==="object"?JSON.stringify(c):String(c))})' "$1"; }

# ── Remove a prior run's demo books (by title) + series (by title) ──
TITLES_JSON=$(node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "${TITLES[@]}")
clean(){
  for slug in $(req GET /api/books | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const w=new Set(JSON.parse(process.argv[1]));(JSON.parse(s).books||[]).filter(b=>w.has(b.title)).forEach(b=>console.log(b.slug))}catch(e){}})' "$TITLES_JSON"); do
    code DELETE "/api/books/$slug" >/dev/null && echo "  [clean] book $slug"
  done
  for sid in $(req GET /api/series | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).series||[]).filter(x=>x.title===process.argv[1]).forEach(x=>console.log(x.id))}catch(e){}})' "$SERIES_TITLE"); do
    code DELETE "/api/series/$sid" >/dev/null && echo "  [clean] series $sid"
  done
}

if [ "${CLEANUP:-}" = "1" ]; then
  echo "▶ CLEANUP — removing series-smoke books + series on $BASE_URL"
  clean
  exit 0
fi

echo "▶ Series smoke → $BASE_URL"
if [ "$(code GET /api/series)" = "404" ]; then
  echo "  ✗ /api/series not on this build — aborting"; exit 1
fi

# ── Resolve library assets (prefer 'default', else first) ──
pick(){ req GET "/api/library?kind=$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const n=(JSON.parse(s).entries||[]).map(x=>x.name);console.log(n.includes("default")?"default":(n[0]||""))}catch(e){console.log("")}})'; }
AUTHOR=$(pick author); VOICE=$(pick voice); GENRE=$(pick genre)
[ -z "$VOICE" ] && VOICE="default"
PIPE=$(req GET "/api/library?kind=pipeline" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const e=(JSON.parse(s).entries||[]);const p=e.find(x=>x.name!=="novel-pipeline")||e[0];console.log(p?p.name:"")}catch(e){console.log("")}})')
if [ -z "$AUTHOR" ] || [ -z "$PIPE" ]; then echo "  ✗ could not resolve author/pipeline from the library — aborting"; exit 1; fi
echo "  library: author='$AUTHOR' voice='$VOICE' genre='${GENRE:-<none>}' pipeline='$PIPE'"

clean   # idempotent: start from a clean slate

# ── Create the series + set its shared refs ──
SID=$(req POST /api/series "{\"title\":\"$SERIES_TITLE\"}" | jget series.id)
if [ -z "$SID" ]; then echo "  ✗ series create failed"; exit 1; fi
GREFS=$(node -e 'console.log(JSON.stringify({author:process.argv[1],voice:process.argv[2],genre:process.argv[3]||null}))' "$AUTHOR" "$VOICE" "$GENRE")
[ "$(code PUT "/api/series/$SID/refs" "$GREFS")" = "200" ] && pass "series created + refs set" "id=$SID" || fail "series created + refs set"

# ── Two books IN the series (author/voice/genre inherited; pipeline supplied) ──
mkbook_series(){ req POST /api/books "$(node -e 'console.log(JSON.stringify({title:process.argv[1],series:process.argv[2],pipeline:process.argv[3]}))' "$1" "$SID" "$PIPE")" | jget book.slug; }
SLUG_A=$(mkbook_series "$TITLE_A")
SLUG_B=$(mkbook_series "$TITLE_B")
# ── One standalone book (no series) ──
SLUG_C=$(req POST /api/books "$(node -e 'console.log(JSON.stringify({title:process.argv[1],author:process.argv[2],voice:process.argv[3],genre:process.argv[4]||null,pipeline:process.argv[5]}))' "$TITLE_C" "$AUTHOR" "$VOICE" "$GENRE" "$PIPE")" | jget book.slug)

[ -n "$SLUG_A" ] && [ -n "$SLUG_B" ] && pass "two books created in the series" "$SLUG_A, $SLUG_B" || fail "two books created in the series" "A=$SLUG_A B=$SLUG_B"
[ -n "$SLUG_C" ] && pass "one standalone book created" "$SLUG_C" || fail "one standalone book created"

# ── Assertions ──
ser_of(){ req GET "/api/books/$1" | jget book.pulledFrom.series.id; }
auth_of(){ req GET "/api/books/$1" | jget book.pulledFrom.author.name; }

[ "$(ser_of "$SLUG_A")" = "$SID" ] && [ "$(ser_of "$SLUG_B")" = "$SID" ] \
  && pass "both series books carry series provenance" || fail "both series books carry series provenance" "A=$(ser_of "$SLUG_A") B=$(ser_of "$SLUG_B")"

[ "$(auth_of "$SLUG_A")" = "$AUTHOR" ] \
  && pass "series book inherited the series author" "author=$AUTHOR" || fail "series book inherited the series author" "got $(auth_of "$SLUG_A")"

if [ -z "$(ser_of "$SLUG_C")" ]; then pass "standalone book has NO series provenance"; else fail "standalone book has NO series provenance" "got $(ser_of "$SLUG_C")"; fi

MEMBERS=$(req GET /api/series | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const x=(JSON.parse(s).series||[]).find(y=>y.id===process.argv[1]);console.log(JSON.stringify(x?x.bookSlugs:[]))}catch(e){console.log("[]")}})' "$SID")
MCOUNT=$(printf '%s' "$MEMBERS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).length)})')
HASC=$(printf '%s' "$MEMBERS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).includes(process.argv[1])?"yes":"no")})' "$SLUG_C")
{ [ "$MCOUNT" = "2" ] && [ "$HASC" = "no" ]; } \
  && pass "series has exactly the 2 member books (standalone excluded)" "members=$MEMBERS" \
  || fail "series membership" "count=$MCOUNT hasStandalone=$HASC members=$MEMBERS"

[ "$(code GET "/api/series/$SID/report")" = "200" ] && pass "series report 200" || fail "series report"

echo ""
echo "  ════════════════════════════════════════════════════"
echo "  Left on disk for inspection:"
echo "    series : $SERIES_TITLE ($SID) — 2 books"
echo "      ├─ $SLUG_A"
echo "      └─ $SLUG_B"
echo "    standalone book (no series): $SLUG_C"
echo "  Remove with:  CLEANUP=1 BASE_URL=$BASE_URL $0"
echo "  ────────────────────────────────────────────────────"
echo "  SUMMARY: $PASSES passed, $FAILS failed"
echo "  ════════════════════════════════════════════════════"
exit "$FAILS"
