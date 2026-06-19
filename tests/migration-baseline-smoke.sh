#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — F3 migrated-book pipeline baseline smoke (LOCAL, no AI)
# ═══════════════════════════════════════════════════════════
# Verifies config-not-code follow-up F3 through a RUNNING server: the lazy v1→v2
# book migration now also writes the re-pull baseline (.baseline/pipeline/<name>.json),
# so repullStatus no longer reports 'no-baseline' for a migrated book's pipeline.
#
# F3 migrates legacy ON-DISK state, so this smoke must control the filesystem: it
# boots a local gateway (auth disabled, free port), drops a hand-built v1 book into
# the workspace, drives the live repull endpoint (which triggers open()→migrate),
# and asserts (a) the per-name baseline file now exists and (b) the pipeline asset
# reports hasBaseline. (A fresh Mercury deploy has only v2 books, so this can't run
# against it; the migration paths are also covered by tests/unit/book-migration-v2.)
# Self-cleaning; boots and stops its own server.
#
# Usage:  tests/migration-baseline-smoke.sh   [PORT=3957]
# ═══════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
PORT="${PORT:-3957}"
HOST=127.0.0.1
BASE="http://${HOST}:${PORT}"
SLUG="f3-baseline-smoke"
BOOKDIR="$ROOT/workspace/books/$SLUG"

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }
req(){ local m="$1" p="$2" b="${3:-}"; if [ -n "$b" ]; then curl -s --max-time 20 -H "Content-Type: application/json" -X "$m" -d "$b" "$BASE$p"; else curl -s --max-time 20 "$BASE$p"; fi; }
jget(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch(e){process.exit(0)}let c=j;for(const raw of process.argv[1].split(".")){const m=raw.match(/^([^\[]*)((\[\d+\])*)$/);if(!m)process.exit(0);if(m[1]!==""){if(c==null)process.exit(0);c=c[m[1]]}const idx=(m[2]||"").match(/\d+/g)||[];for(const i of idx){if(c==null)process.exit(0);c=c[Number(i)]}}if(c==null)process.exit(0);console.log(typeof c==="object"?JSON.stringify(c):String(c))})' "$1"; }

SRV_PID=""
cleanup(){
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null
  rm -rf "$BOOKDIR"
}
trap cleanup EXIT

echo "▶ F3 migration-baseline smoke (local) → $BASE"
rm -rf "$BOOKDIR"

# ── Boot a local gateway ──
LOG="$(mktemp)"
( cd "$ROOT" && env BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" BOOKCLAW_CHAT_PORT="$((PORT+1))" BOOKCLAW_AUTH_DISABLED=1 \
    node --import tsx gateway/src/index.ts >"$LOG" 2>&1 ) &
SRV_PID=$!
for i in $(seq 1 60); do curl -s -o /dev/null --max-time 2 "$BASE/api/status" && break; sleep 0.5; done
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$BASE/api/status")" = "200" ] \
  && pass "local gateway booted" || { fail "gateway did not boot (see $LOG)"; tail -8 "$LOG"; exit 1; }

# ── Pick a real library pipeline name so the asset isn't 'library-removed' ──
PNAME=$(req GET "/api/library?kind=pipeline" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const e=(JSON.parse(s).entries||[]).map(x=>x.name).filter(n=>n&&n!=="novel-pipeline");console.log(e[0]||"book-production")}catch(e){console.log("book-production")}})')
echo "  [info] using library pipeline: $PNAME"

# ── Hand-build a v1 book (single templates/pipeline.json, schemaVersion 1, NO .baseline) ──
mkdir -p "$BOOKDIR/templates" "$BOOKDIR/data"
node -e '
  const fs=require("fs"),path=require("path");
  const dir=process.argv[1], slug=process.argv[2], pname=process.argv[3];
  fs.writeFileSync(path.join(dir,"templates","pipeline.json"), JSON.stringify(
    {schemaVersion:1,name:pname,label:"L",description:"d",steps:[{label:"S",taskType:"general",promptTemplate:"do",phase:"revision"}]}, null, 2));
  fs.writeFileSync(path.join(dir,"book.json"), JSON.stringify(
    {id:slug,slug,title:"F3 Baseline Smoke",schemaVersion:1,createdByApp:"1.0.0",lastWrittenByApp:"1.0.0",
     phase:"planning",createdAt:"2026-01-01T00:00:00.000Z",
     pulledFrom:{author:{name:"default",source:"builtin"},pipeline:{name:pname,source:"builtin"},sections:[]},history:[]}, null, 2));
' "$BOOKDIR" "$SLUG" "$PNAME"
[ -f "$BOOKDIR/book.json" ] && pass "v1 book fixture written (schemaVersion 1, no baseline)" || { fail "fixture write"; exit 1; }

# ── Drive the live server: set active + GET repull → triggers open()→migrate ──
req POST /api/books/active "{\"slug\":\"$SLUG\"}" >/dev/null
RP=$(req GET /api/books/active/repull)
PASSET=$(printf '%s' "$RP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=(JSON.parse(s).assets||[]).find(x=>x.kind==="pipeline");console.log(a?JSON.stringify(a):"")}catch(e){console.log("")}})')
echo "  [info] pipeline asset: $PASSET"

# Migration ran → schemaVersion bumped to 2
[ "$(req GET "/api/books/$SLUG" | jget book.schemaVersion)" = "2" ] \
  && pass "v1 book migrated to v2 on open" || fail "book not migrated"

# F3: the per-name baseline file now exists on disk
[ -f "$BOOKDIR/.baseline/pipeline/$PNAME.json" ] \
  && pass "baseline written at .baseline/pipeline/$PNAME.json" || fail "baseline file missing (F3 regression)"

# F3: repull reports a baseline (NOT 'no-baseline')
HB=$(printf '%s' "$PASSET" | jget hasBaseline)
ST=$(printf '%s' "$PASSET" | jget status)
{ [ "$HB" = "true" ] && [ "$ST" != "no-baseline" ]; } \
  && pass "repull reports a baseline for the migrated pipeline" "hasBaseline=$HB status=$ST" \
  || fail "repull still 'no-baseline'" "hasBaseline=$HB status=$ST"

# ── Cleanup (book dir removed by trap; also drop via API) ──
req DELETE "/api/books/$SLUG" >/dev/null 2>&1 || true
echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
