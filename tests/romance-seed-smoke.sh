#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Romance Workflow Foundation seed round-trip smoke
# ═══════════════════════════════════════════════════════════
# Creates a book with author seeds (storyArc/characters/world) bound to the
# romance-sweet-full pipeline, makes it active, runs its sequence, and asserts
# the seed text lands in the resulting project's step prompts (i.e. the
# manifest's `seeds` made it into pipeline `context` and interpolated into
# {{storyArc}}/{{characters}}/{{setting}}). No AI call needed — the assertion is
# on the SYNCHRONOUS create-project response's step prompts.
#
# Hermetic-ish: boots its own gateway (loopback only, token via env, non-default
# port) and self-cleans the book it creates from the real ./workspace.
#
# Usage:  tests/romance-seed-smoke.sh [-v]
# Exit: 0 = pass, 1 = a check failed, 2 = preflight/startup error.
set -uo pipefail

VERBOSE=0; [[ "${1:-}" == "-v" ]] && VERBOSE=1
HOST=127.0.0.1
PORT="${PORT:-3878}"
BASE="http://${HOST}:${PORT}"
TOKEN="romance-seed-smoke-token"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$(mktemp)"
SLUG=""
FAILED=0

cleanup() {
  [[ -n "$SLUG" ]] && curl -sf -H "Authorization: Bearer $TOKEN" -X DELETE "$BASE/api/books/$SLUG" >/dev/null 2>&1
  [[ -n "${SRV:-}" ]] && kill "$SRV" 2>/dev/null
  if [[ "$VERBOSE" == 1 || "$FAILED" != 0 ]]; then echo '--- server log ---'; cat "$LOG"; fi
  rm -f "$LOG"
}
trap cleanup EXIT

if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
  echo "ERROR: something is already listening on ${BASE} — stop it before running this smoke." >&2
  exit 2
fi

BOOKCLAW_AUTH_TOKEN="$TOKEN" BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" \
  node --import tsx "$ROOT/gateway/src/index.ts" >"$LOG" 2>&1 &
SRV=$!
for i in $(seq 1 60); do
  curl -sf "$BASE/api/status" -H "Authorization: Bearer $TOKEN" >/dev/null 2>&1 && break
  kill -0 "$SRV" 2>/dev/null || { echo "ERROR: server exited during startup" >&2; exit 2; }
  sleep 0.5
done

H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
ARC="ARC_MARKER rivals-to-lovers over one summer"

AUTHOR=$(curl -sf "${H[@]}" "$BASE/api/library/author" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).entries[0].name))')
VOICE=$(curl -sf "${H[@]}" "$BASE/api/library/voice" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).entries[0].name))')
if [[ -z "$AUTHOR" || -z "$VOICE" ]]; then echo "FAIL: no author/voice library entry found"; FAILED=1; exit 1; fi

# 1) create the book with seeds, bound to a single-pipeline sequence
BOOK=$(curl -sf "${H[@]}" -X POST "$BASE/api/books" -d "$(cat <<JSON
{ "title": "Seed Smoke Romance", "pipelineSequence": ["romance-sweet-full"],
  "author": "$AUTHOR", "voice": "$VOICE",
  "storyArc": "$ARC", "characters": "CHAR_MARKER", "setting": "SETTING_MARKER", "councilSelection": "auto" }
JSON
)")
SLUG=$(echo "$BOOK" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).book.slug)}catch(e){}})')
if [[ -z "$SLUG" ]]; then echo "FAIL: no slug — response: $BOOK"; FAILED=1; exit 1; fi

# 2) make it active, then run its sequence
curl -sf "${H[@]}" -X POST "$BASE/api/books/active" -d "{\"slug\":\"$SLUG\"}" >/dev/null
RUN=$(curl -sf "${H[@]}" -X POST "$BASE/api/projects/create" -d '{"title":"Seed Smoke Romance","description":"seed round-trip"}')

# 3) assert all three seed markers are present in the first project's step prompts
if echo "$RUN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const p=(r.projects||[r.project])[0];if(!p||!p.steps){console.error("FAIL: no project/steps in response");process.exit(1)}const blob=JSON.stringify(p.steps.map(x=>x.prompt));for(const m of ["ARC_MARKER","CHAR_MARKER","SETTING_MARKER"]){if(!blob.includes(m)){console.error("FAIL: seed marker "+m+" not woven into project steps");process.exit(1)}}console.log("PASS: all three seed markers threaded into project step prompts")})'; then
  exit 0
else
  FAILED=1
  exit 1
fi
