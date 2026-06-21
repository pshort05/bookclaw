#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Board Author/Series/Genre grouping smoke (REPORT + LEAVE-IN-PLACE, no AI)
# ═══════════════════════════════════════════════════════════
# Seeds a deliberately varied set of books so the Board's "Group by"
# control (Author / Series / Genre — frontend/studio/src/routes/Board.tsx)
# has something to group, and asserts that GET /api/books returns the
# author/series/genre values the client-side grouping reads — including the
# catch-all buckets the feature defines (no series -> "Standalone"; missing
# author/genre -> "Unassigned").
#
# It is data-level: the grouping itself renders in the React studio, so this
# verifies the contract that feeds it (the same fallback labels used in
# Board.tsx `groupValue`) and LEAVES the books on disk so you can open the
# board and toggle Author / Series / Genre by hand.
#
# Seed (6 books), chosen for full coverage of all three dimensions:
#   - 2 distinct library authors (A1, A2)  -> >= 2 Author groups
#   - 2 distinct library genres (G1, G2) + one book with NO genre
#                                          -> 2 Genre groups + "Unassigned"
#   - 1 series with 2 member books + 4 standalones
#                                          -> 1 Series group + "Standalone"
#
# A prior run's seed (titles starting "Smoke Group") is removed first, so
# re-runs end with exactly this set. CLEANUP=1 removes it all and exits.
#
# Usage:
#   BASE_URL=http://192.168.1.32:3847 tests/board-grouping-smoke.sh
#   CLEANUP=1 BASE_URL=http://192.168.1.32:3847 tests/board-grouping-smoke.sh
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else repo docker/.env, else docker exec), CONTAINER.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PREFIX="Smoke Group"
SERIES_TITLE="Smoke Group Series — Ashfall Saga"
T1="Smoke Group — Crimson Vow"        # A1 / G1 / standalone
T2="Smoke Group — Iron Tide"          # A1 / G2 / standalone
T3="Smoke Group — Pale Lantern"       # A2 / G1 / standalone
T4="Smoke Group — Untitled Drift"     # A2 / (no genre) / standalone
T5="Smoke Group — Ashfall: Book One"  # series (inherits A1 / G2)
T6="Smoke Group — Ashfall: Book Two"  # series (inherits A1 / G2)

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

# Bucket the seeded books (title startsWith PREFIX) by a dimension, applying the
# SAME fallback labels as Board.tsx `groupValue`. Prints {label:count} JSON.
buckets(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let books=[];try{books=(JSON.parse(s).books||[])}catch(e){}const dim=process.argv[1],prefix=process.argv[2];books=books.filter(b=>String(b.title||"").startsWith(prefix));const val=(b)=>{const raw=dim==="author"?b.author:dim==="series"?b.series:b.genre;const v=(raw==null?"":String(raw)).trim();return v?v:(dim==="series"?"Standalone":"Unassigned")};const m={};for(const b of books){const k=val(b);m[k]=(m[k]||0)+1}console.log(JSON.stringify(m))})' "$1" "$2"; }
keycount(){ printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(Object.keys(JSON.parse(s)).length)}catch(e){console.log(0)}})'; }
keyval(){ printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log(o[process.argv[1]]!=null?o[process.argv[1]]:"")}catch(e){console.log("")}})' "$2"; }
haskey(){ printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(Object.prototype.hasOwnProperty.call(JSON.parse(s),process.argv[1])?"yes":"no")}catch(e){console.log("no")}})' "$2"; }

# ── Remove a prior run's seed (books + series, by title prefix) ──
clean(){
  for slug in $(req GET /api/books | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).books||[]).filter(b=>String(b.title||"").startsWith(process.argv[1])).forEach(b=>console.log(b.slug))}catch(e){}})' "$PREFIX"); do
    code DELETE "/api/books/$slug" >/dev/null && echo "  [clean] book $slug"
  done
  for sid in $(req GET /api/series | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).series||[]).filter(x=>String(x.title||"").startsWith(process.argv[1])).forEach(x=>console.log(x.id))}catch(e){}})' "$PREFIX"); do
    code DELETE "/api/series/$sid" >/dev/null && echo "  [clean] series $sid"
  done
}

if [ "${CLEANUP:-}" = "1" ]; then
  echo "▶ CLEANUP — removing board-grouping smoke books + series on $BASE_URL"
  clean
  exit 0
fi

echo "▶ Board grouping smoke → $BASE_URL"
if [ "$(code GET /api/books)" != "200" ]; then
  echo "  ✗ /api/books unreachable — aborting"; exit 1
fi
if [ "$(code GET /api/series)" = "404" ]; then
  echo "  ✗ /api/series not on this build — aborting (series grouping needs it)"; exit 1
fi

# ── Resolve library assets: 2 distinct authors, 2 distinct genres, a voice + pipeline ──
two_distinct(){ req GET "/api/library?kind=$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const n=[...new Set((JSON.parse(s).entries||[]).map(x=>x.name).filter(Boolean))];console.log((n[0]||"")+" "+(n[1]||n[0]||""))}catch(e){console.log(" ")}})'; }
read -r A1 A2 <<<"$(two_distinct author)"
read -r G1 G2 <<<"$(two_distinct genre)"
VOICE=$(req GET "/api/library?kind=voice" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const n=(JSON.parse(s).entries||[]).map(x=>x.name);console.log(n.includes("default")?"default":(n[0]||"default"))}catch(e){console.log("default")}})')
PIPE=$(req GET "/api/library?kind=pipeline" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const e=(JSON.parse(s).entries||[]);const p=e.find(x=>x.name!=="novel-pipeline")||e[0];console.log(p?p.name:"")}catch(e){console.log("")}})')
if [ -z "$A1" ] || [ -z "$G1" ] || [ -z "$PIPE" ]; then echo "  ✗ could not resolve author/genre/pipeline from the library — aborting"; exit 1; fi
echo "  library: authors='$A1','$A2' genres='$G1','$G2' voice='$VOICE' pipeline='$PIPE'"
[ "$A1" != "$A2" ] && EXP_AUTHORS=2 || EXP_AUTHORS=1
[ "$G1" != "$G2" ] && EXP_GENRES=3 || EXP_GENRES=2   # distinct genres + "Unassigned"

clean   # idempotent: start from a clean slate

# ── Create the series + its shared refs (members inherit author/voice/genre) ──
SID=$(req POST /api/series "{\"title\":\"$SERIES_TITLE\"}" | jget series.id)
if [ -z "$SID" ]; then echo "  ✗ series create failed"; exit 1; fi
GREFS=$(node -e 'console.log(JSON.stringify({author:process.argv[1],voice:process.argv[2],genre:process.argv[3]||null}))' "$A1" "$VOICE" "$G2")
[ "$(code PUT "/api/series/$SID/refs" "$GREFS")" = "200" ] && pass "series created + refs set" "id=$SID" || fail "series created + refs set"

# ── 4 standalone books (author/voice/genre supplied directly) ──
mkbook(){ req POST /api/books "$(node -e 'console.log(JSON.stringify({title:process.argv[1],author:process.argv[2],voice:process.argv[3],genre:process.argv[4]||null,pipeline:process.argv[5]}))' "$1" "$2" "$VOICE" "$3" "$PIPE")" | jget book.slug; }
S1=$(mkbook "$T1" "$A1" "$G1")
S2=$(mkbook "$T2" "$A1" "$G2")
S3=$(mkbook "$T3" "$A2" "$G1")
S4=$(mkbook "$T4" "$A2" "")          # no genre -> "Unassigned" bucket
# ── 2 books IN the series ──
mkbook_series(){ req POST /api/books "$(node -e 'console.log(JSON.stringify({title:process.argv[1],series:process.argv[2],pipeline:process.argv[3]}))' "$1" "$SID" "$PIPE")" | jget book.slug; }
S5=$(mkbook_series "$T5")
S6=$(mkbook_series "$T6")

if [ -n "$S1" ] && [ -n "$S2" ] && [ -n "$S3" ] && [ -n "$S4" ] && [ -n "$S5" ] && [ -n "$S6" ]; then
  pass "all 6 seed books created"
else
  fail "all 6 seed books created" "S1=$S1 S2=$S2 S3=$S3 S4=$S4 S5=$S5 S6=$S6"
fi

# ── Assertions over the data the board groups on ──
BOOKS=$(req GET /api/books)
SEEDN=$(printf '%s' "$BOOKS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).books||[]).filter(b=>String(b.title||"").startsWith(process.argv[1])).length)}catch(e){console.log(0)}})' "$PREFIX")
[ "$SEEDN" = "6" ] && pass "GET /api/books returns the 6 seeded books" || fail "GET /api/books returns the 6 seeded books" "got $SEEDN"

# Group-by AUTHOR — >= 2 buckets, A1 and A2 both present (when distinct).
AB=$(printf '%s' "$BOOKS" | buckets author "$PREFIX")
if [ "$(keycount "$AB")" -ge "$EXP_AUTHORS" ] && [ "$(haskey "$AB" "$A1")" = "yes" ]; then
  if [ "$A1" = "$A2" ] || [ "$(haskey "$AB" "$A2")" = "yes" ]; then
    pass "Author grouping yields $(keycount "$AB") buckets" "$AB"
  else fail "Author grouping missing A2 bucket" "$AB"; fi
else
  fail "Author grouping bucket count" "want >= $EXP_AUTHORS incl '$A1' — got $AB"
fi

# Group-by GENRE — real genre buckets + the "Unassigned" catch-all (book 4).
GB=$(printf '%s' "$BOOKS" | buckets genre "$PREFIX")
if [ "$(haskey "$GB" Unassigned)" = "yes" ] && [ "$(keycount "$GB")" -ge "$EXP_GENRES" ]; then
  pass "Genre grouping yields $(keycount "$GB") buckets incl 'Unassigned'" "$GB"
else
  fail "Genre grouping (want >= $EXP_GENRES incl 'Unassigned')" "$GB"
fi

# Group-by SERIES — the series-title bucket (2) + the "Standalone" catch-all (4).
SB=$(printf '%s' "$BOOKS" | buckets series "$PREFIX")
if [ "$(keyval "$SB" "$SERIES_TITLE")" = "2" ] && [ "$(keyval "$SB" Standalone)" = "4" ]; then
  pass "Series grouping: '$SERIES_TITLE'=2 + 'Standalone'=4" "$SB"
else
  fail "Series grouping buckets" "want series=2 + Standalone=4 — got $SB"
fi

# The board card reads b.series — confirm the two members carry the title, standalones don't.
card_series(){ printf '%s' "$BOOKS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const b=(JSON.parse(s).books||[]).find(x=>x.slug===process.argv[1]);console.log(b&&b.series?b.series:"")}catch(e){console.log("")}})' "$1"; }
if [ "$(card_series "$S5")" = "$SERIES_TITLE" ] && [ "$(card_series "$S6")" = "$SERIES_TITLE" ] && [ -z "$(card_series "$S1")" ]; then
  pass "board card series field set on members only"
else
  fail "board card series field" "S5=$(card_series "$S5") S6=$(card_series "$S6") S1=$(card_series "$S1")"
fi

echo ""
echo "  ════════════════════════════════════════════════════"
echo "  Left on disk for inspection — open the board and try 'Group by':"
echo "    Author : '$A1' → $T1, $T2, $T5, $T6   |   '$A2' → $T3, $T4"
echo "    Genre  : '$G1' → $T1, $T3   |   '$G2' → $T2, $T5, $T6   |   Unassigned → $T4"
echo "    Series : '$SERIES_TITLE' → $T5, $T6   |   Standalone → $T1, $T2, $T3, $T4"
echo "  Remove with:  CLEANUP=1 BASE_URL=$BASE_URL $0"
echo "  ────────────────────────────────────────────────────"
echo "  SUMMARY: $PASSES passed, $FAILS failed"
echo "  ════════════════════════════════════════════════════"
exit "$FAILS"
