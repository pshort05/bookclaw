#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Tier-2/3 AuthorAgent port smoke (features #4–#9)
# ═══════════════════════════════════════════════════════════
# Exercises the LIVE HTTP surface of the six ported features against a running
# gateway. Deterministic checks (validation 400s, 404, stats round-trip, boot
# health) are hard assertions; provider-dependent runs (prose-evolve, reader-
# panel) accept EITHER a 200 report OR a 503 "no provider" — both prove the
# route is wired and validation passed; a real provider (Mercury has Ollama/
# Gemini) yields 200 and the shape is then checked.
#
#   #4 prose-evolver     POST /api/prose/evolve
#   #5 reader-panel      POST /api/reader-panel/run
#   #6 conductor         boot-health (opt-in path unreachable for normal projects)
#   #7 learning          POST /api/projects/:id/learn  (route wired + service init)
#   #8 writing-stats     GET /api/writing/stats + POST /api/writing/log-words
#   #9 archival-recall   splice is chat-only + unit-tested (buildArchivalBlock);
#                        boot-health confirms the splice didn't break startup.
#
# Usage:  BASE_URL=http://192.168.1.32:3847 tests/tier2-features-smoke.sh [-v]
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else docker/.env / .env / docker exec), CONTAINER.
# Exit: 0 all pass, N = number of failed checks.
# NOTE: POST /api/writing/log-words mutates persistent stats — run against a DEV
# instance (Mercury), not production (Neptune). It logs a single test word.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

TOKEN="${BOOKCLAW_AUTH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$SCRIPT_DIR/../docker/.env" ]; then
  TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' "$SCRIPT_DIR/../docker/.env" | cut -d= -f2- | tr -d '\r"')
fi
[ -z "$TOKEN" ] && [ -f "$SCRIPT_DIR/../.env" ] && TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' "$SCRIPT_DIR/../.env" | cut -d= -f2- | tr -d '\r"')
[ -z "$TOKEN" ] && TOKEN=$(docker exec "$CONTAINER" printenv BOOKCLAW_AUTH_TOKEN 2>/dev/null | tr -d '\r')
[ -z "$TOKEN" ] && { echo "ERROR: no auth token" >&2; exit 1; }
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }
vlog(){ [ "$VERBOSE" = 1 ] && echo "        $1"; return 0; }

# code+body: emit "<http_code>\n<body>"
req(){ # method path [json-body]
  local m="$1" p="$2" b="${3:-}"
  if [ -n "$b" ]; then
    curl -s --max-time 90 -w '\n%{http_code}' "${H[@]}" -X "$m" -d "$b" "$BASE_URL$p"
  else
    curl -s --max-time 90 -w '\n%{http_code}' "${H[@]}" -X "$m" "$BASE_URL$p"
  fi
}
code_of(){ printf '%s' "$1" | tail -n1; }
body_of(){ printf '%s' "$1" | sed '$d'; }

echo "▶ Tier-2/3 feature smoke → $BASE_URL"
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "${H[@]}" "$BASE_URL/api/status")" != "401" ] \
  || { echo "  ✗ auth failed (401) — wrong token for this host"; exit 1; }

# ── #6/#9 boot health: server is up and authed (conductor wiring + #9 splice did not break startup) ──
SC=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "${H[@]}" "$BASE_URL/api/status")
[ "$SC" = "200" ] && pass "boot health: /api/status 200 (conductor + archival splice did not break boot)" \
  || fail "boot health: /api/status not 200" "code=$SC"

# ── #8 writing-stats: GET returns a snapshot ──
R=$(req GET /api/writing/stats); C=$(code_of "$R"); B=$(body_of "$R"); vlog "stats: $B"
if [ "$C" = "200" ] && printf '%s' "$B" | grep -q '"currentStreakDays"'; then
  pass "#8 GET /api/writing/stats returns a snapshot (currentStreakDays present)"
else
  fail "#8 GET /api/writing/stats" "code=$C body=$(printf '%s' "$B" | head -c 120)"
fi

# ── #8 log-words: bad input → 400 ──
R=$(req POST /api/writing/log-words '{"words":0}'); C=$(code_of "$R")
[ "$C" = "400" ] && pass "#8 log-words rejects words<=0 (400)" || fail "#8 log-words words=0 not 400" "code=$C"
R=$(req POST /api/writing/log-words '{"words":200001}'); C=$(code_of "$R")
[ "$C" = "400" ] && pass "#8 log-words rejects over-cap 200001 (400)" || fail "#8 log-words over-cap not 400" "code=$C"

# ── #8 log-words: valid → 200 with a stats snapshot (mutates DEV stats by 1 word) ──
R=$(req POST /api/writing/log-words '{"words":1}'); C=$(code_of "$R"); B=$(body_of "$R"); vlog "log-words: $B"
if [ "$C" = "200" ] && printf '%s' "$B" | grep -q '"success":true'; then
  pass "#8 POST /api/writing/log-words accepts a valid entry (200)"
else
  fail "#8 log-words valid entry" "code=$C body=$(printf '%s' "$B" | head -c 120)"
fi

# ── #5 reader-panel: empty candidates → 400 (validation, provider-independent) ──
R=$(req POST /api/reader-panel/run '{"kind":"blurb","candidates":[]}'); C=$(code_of "$R")
[ "$C" = "400" ] && pass "#5 reader-panel rejects empty candidates (400)" || fail "#5 reader-panel empty not 400" "code=$C"

# ── #5 reader-panel: real run → 200 report OR 503 (no provider) ──
R=$(req POST /api/reader-panel/run '{"kind":"blurb","candidates":["A dragon guards a lonely keep.","She traded her name for a map of the stars."]}')
C=$(code_of "$R"); B=$(body_of "$R"); vlog "reader-panel: $(printf '%s' "$B" | head -c 200)"
if [ "$C" = "200" ] && printf '%s' "$B" | grep -q '"winnerIndex"'; then
  pass "#5 reader-panel run returns a PanelReport (winnerIndex present)"
elif [ "$C" = "503" ]; then
  pass "#5 reader-panel route wired (503 — no AI provider on this host)"
else
  fail "#5 reader-panel run" "code=$C body=$(printf '%s' "$B" | head -c 160)"
fi

# ── #4 prose-evolver: empty text → 400; over-length → 400 (validation) ──
R=$(req POST /api/prose/evolve '{"text":""}'); C=$(code_of "$R")
[ "$C" = "400" ] && pass "#4 prose-evolve rejects empty text (400)" || fail "#4 prose-evolve empty not 400" "code=$C"
BIG=$(printf 'x%.0s' $(seq 1 20001))
R=$(req POST /api/prose/evolve "{\"text\":\"$BIG\"}"); C=$(code_of "$R")
[ "$C" = "400" ] && pass "#4 prose-evolve rejects text >20000 chars (400)" || fail "#4 prose-evolve over-length not 400" "code=$C"

# ── #4 prose-evolver: real run → 200 result OR 503 (no provider) ──
R=$(req POST /api/prose/evolve '{"text":"The rain fell. It was cold. She walked to the door and opened it slowly.","rounds":1}')
C=$(code_of "$R"); B=$(body_of "$R"); vlog "prose-evolve: $(printf '%s' "$B" | head -c 200)"
if [ "$C" = "200" ] && printf '%s' "$B" | grep -q '"finalText"'; then
  pass "#4 prose-evolve run returns an EvolveResult (finalText present)"
elif [ "$C" = "503" ]; then
  pass "#4 prose-evolve route wired (503 — no AI provider on this host)"
else
  fail "#4 prose-evolve run" "code=$C body=$(printf '%s' "$B" | head -c 160)"
fi

# ── #7 learning: unknown project → 404 (proves route wired AND service initialized; 503 = service absent) ──
R=$(req POST /api/projects/__nope__/learn); C=$(code_of "$R"); B=$(body_of "$R"); vlog "learn: $B"
if [ "$C" = "404" ]; then
  pass "#7 learn route wired + service initialized (unknown project → 404)"
elif [ "$C" = "503" ]; then
  fail "#7 learning service NOT initialized (503)" "body=$(printf '%s' "$B" | head -c 120)"
else
  fail "#7 learn route" "code=$C body=$(printf '%s' "$B" | head -c 120)"
fi

echo ""; echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
