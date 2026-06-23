#!/usr/bin/env bash
#
# Easy Button — Starter Bundles smoke test
# ────────────────────────────────────────
# Boots the gateway and exercises the API contract the studio wizard depends on,
# grown per phase:
#   Task 1 (skeleton): gateway boots; /healthz OK.
#   Task 2 (create contract): for each of the 3 bundles, resolve the `novel`
#     sequence's pipelines, POST /api/books with the exact body the wizard's
#     bundleToCreateBody() produces, and assert the book persists a `format`
#     block (formId=novel, totalTarget=chapters*words).
#   Task 4 (rigor): a bad-genre body does not 500; teardown leaves no residue.
#
# The bundle field values below mirror frontend/studio/src/data/bundles.ts. The
# IP guardrail (bundles reference only public library assets) is enforced by the
# unit test tests/unit/easy-button-bundles.test.ts; this smoke proves the
# create+persist path works against a real boot.
#
# Hermetic: loopback bind, env token, cleanup trap removes created books.
# Usage: tests/easy-button-smoke.sh [-v]
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

# Local (hermetic) by default; set BASE_URL to run against a deployed instance
# (e.g. Mercury) — then BOOKCLAW_AUTH_TOKEN must be provided and no local server
# is booted. Example:
#   BASE_URL=http://192.168.1.32:3847 BOOKCLAW_AUTH_TOKEN=… tests/easy-button-smoke.sh
HOST="127.0.0.1"
PORT="3853"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE=0
if [ -n "${BASE_URL:-}" ]; then
  REMOTE=1
  BASE="${BASE_URL%/}"
  TEST_TOKEN="${BOOKCLAW_AUTH_TOKEN:-}"
else
  BASE="http://${HOST}:${PORT}"
  TEST_TOKEN="smoke-easy-token-$$"
fi

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SERVER_LOG="$(mktemp)"
SERVER_PID=""
FAILED=0
SLUGS=()

log()  { printf '%s\n' "$*"; }
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  kill "$SERVER_PID" 2>/dev/null
  for _ in $(seq 1 25); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.2; done
  SERVER_PID=""
}

cleanup() {
  for s in "${SLUGS[@]:-}"; do
    [ -n "$s" ] && [ -n "${SERVER_PID}" ] && curl -s -o /dev/null -X DELETE -H "Authorization: Bearer ${TEST_TOKEN}" "${BASE}/api/books/${s}" 2>/dev/null || true
  done
  stop_server
  # Only scrub local workspace files when we booted a local server.
  [ "$REMOTE" -eq 0 ] && for s in "${SLUGS[@]:-}"; do [ -n "$s" ] && rm -rf "${ROOT_DIR}/workspace/books/${s}"; done
  if [ "$VERBOSE" -eq 1 ] || [ "$FAILED" -ne 0 ]; then log ""; log "── captured server log ──"; cat "$SERVER_LOG"; fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

if [ "$REMOTE" -eq 1 ] && [ -z "$TEST_TOKEN" ]; then
  log "ERROR: BASE_URL set but BOOKCLAW_AUTH_TOKEN not provided"; exit 2
fi
if [ "$REMOTE" -eq 0 ] && curl -s -o /dev/null --max-time 2 "${BASE}/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE}"; exit 2
fi

log "Easy Button — Starter Bundles smoke${REMOTE:+ }$( [ "$REMOTE" -eq 1 ] && echo "(remote: ${BASE})" )"

if [ "$REMOTE" -eq 0 ]; then
  : > "$SERVER_LOG"
  env BOOKCLAW_BIND="${HOST}" BOOKCLAW_PORT="${PORT}" BOOKCLAW_CHAT_PORT="$((PORT + 100))" \
      BOOKCLAW_AUTH_TOKEN="${TEST_TOKEN}" \
    node --import tsx "${ROOT_DIR}/gateway/src/index.ts" > "$SERVER_LOG" 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 1 60); do
    curl -s -o /dev/null --max-time 2 "${BASE}/" && break
    kill -0 "$SERVER_PID" 2>/dev/null || { log "ERROR: server exited during startup"; exit 1; }
    sleep 0.5
  done
fi

AUTH=(-H "Authorization: Bearer ${TEST_TOKEN}")

# Task 1 — boot/health.
if curl -fsS "${AUTH[@]}" "${BASE}/healthz" >/dev/null 2>&1; then pass "gateway booted, /healthz OK"; else fail "healthz unreachable"; fi

# Baseline book count (for the residue check at the end).
book_count() { curl -fsS "${AUTH[@]}" "${BASE}/api/books" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String((d.books||[]).length))}catch{process.stdout.write('-1')}"; }
BASELINE="$(book_count)"
[ "$BASELINE" = "-1" ] && fail "GET /api/books count failed at baseline (residue check would be unreliable)"

# Resolve the `novel` sequence's ordered pipeline list (what the wizard does).
SEQ_JSON="$(curl -fsS "${AUTH[@]}" "${BASE}/api/library/sequence/novel" 2>/dev/null || true)"
PIPELINES="$(printf '%s' "$SEQ_JSON" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const e=d.entry||{};let p=(e.sequence&&e.sequence.pipelines)||[];if(!p.length&&typeof e.content==='string'){try{p=JSON.parse(e.content).pipelines||[]}catch{}}process.stdout.write(JSON.stringify(p))" 2>/dev/null || echo '[]')"
PCOUNT="$(printf '%s' "$PIPELINES" | node -e "try{const a=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(Array.isArray(a)?String(a.length):'0')}catch{process.stdout.write('0')}" 2>/dev/null)"
if [ "${PCOUNT:-0}" -gt 0 ] 2>/dev/null; then pass "resolved 'novel' sequence pipelines (${PCOUNT})"; else fail "could not resolve a non-empty novel pipeline list (got: ${PIPELINES})"; fi

# Task 2 — create-from-bundle contract for all three bundles.
# args: label title author voice genre structure form chapters words
check_bundle() {
  local label="$1" title="$2" author="$3" voice="$4" genre="$5" structure="$6" form="$7" ch="$8" wpc="$9"
  local expected_total=$(( ch * wpc ))
  local body resp slug fmt
  body="$(printf '{"title":"%s","author":"%s","voice":"%s","genre":"%s","sequence":"novel","pipelineSequence":%s,"structure":"%s","form":"%s","chapterCount":%s,"wordsPerChapter":%s}' \
    "$title" "$author" "$voice" "$genre" "$PIPELINES" "$structure" "$form" "$ch" "$wpc")"
  resp="$(curl -fsS "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${BASE}/api/books" -d "$body" 2>/dev/null || true)"
  slug="$(printf '%s' "$resp" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')"
  if [ -z "$slug" ]; then fail "${label}: create failed (got: ${resp})"; return; fi
  SLUGS+=("$slug")
  fmt="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${slug}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const f=(d.book||{}).format||{};process.stdout.write(f.formId==='${form}'&&f.totalTarget===${expected_total}?'yes':JSON.stringify(f))" 2>/dev/null)"
  if [ "$fmt" = "yes" ]; then pass "${label}: created ${slug} with persisted format (${form}, ${expected_total})"; else fail "${label}: format not persisted (got: ${fmt})"; fi
}

check_bundle "romance"  "Easy Smoke Romance $$"  "warm-smalltown-romance" "warm-smalltown-romance" "contemporary-romance" "romancing_the_beat" "novel" 32 2500
check_bundle "scifi"    "Easy Smoke SciFi $$"    "kinetic-ya-scifi"       "kinetic-ya-scifi"       "hard-science-fiction" "three_act"          "novel" 30 2800
check_bundle "thriller" "Easy Smoke Thriller $$" "contemporary-thriller"  "contemporary-thriller"  "military-thriller"    "three_act"          "novel" 40 2000

# Task 4 — a bad-genre body must not 500 (graceful handling of a bad slug).
BAD_BODY="$(printf '{"title":"Easy Smoke Bad %s","author":"default","voice":"default","genre":"zzz-nonexistent-genre","sequence":"novel","pipelineSequence":%s,"structure":"three_act","form":"novel","chapterCount":30,"wordsPerChapter":2000}' "$$" "$PIPELINES")"
BAD_CODE="$(curl -s -o /tmp/easybad.$$ -w '%{http_code}' "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${BASE}/api/books" -d "$BAD_BODY")"
BAD_SLUG="$(sed -n 's/.*"slug":"\([^"]*\)".*/\1/p' /tmp/easybad.$$ 2>/dev/null)"; rm -f /tmp/easybad.$$
[ -n "$BAD_SLUG" ] && SLUGS+=("$BAD_SLUG")
if [ "${BAD_CODE:-500}" -ge 200 ] 2>/dev/null && [ "${BAD_CODE}" -lt 500 ] 2>/dev/null; then pass "bad-genre create handled gracefully (HTTP ${BAD_CODE}, not 5xx)"; else fail "bad-genre create returned ${BAD_CODE} (expected a non-5xx response)"; fi

# Task 4 — teardown residue check: delete created books, count returns to baseline.
for s in "${SLUGS[@]:-}"; do [ -n "$s" ] && curl -s -o /dev/null -X DELETE "${AUTH[@]}" "${BASE}/api/books/${s}" 2>/dev/null || true; done
SLUGS=()
AFTER="$(book_count)"
if [ "$AFTER" = "$BASELINE" ]; then pass "teardown left no residue (book count back to ${BASELINE})"; else fail "residue after teardown (baseline ${BASELINE}, now ${AFTER})"; fi

log ""
[ "$FAILED" -eq 0 ] && log "RESULT: all checks passed" || log "RESULT: failures above"
exit "$FAILED"
