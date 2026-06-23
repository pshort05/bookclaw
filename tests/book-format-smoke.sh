#!/usr/bin/env bash
#
# Book Format & Structure smoke test
# ──────────────────────────────────
# Boots the gateway and exercises the feature end to end, grown per phase:
#   Phase 1 (creation config): GET /api/forms lists the catalog; POST /api/books
#     with a valid format persists a book.json `format` block; an out-of-band
#     total is hard-blocked with 400.
#   Phase 2 (generation wiring): a book created with a format yields a project
#     whose outline step carries the structure rail and chapter steps carry the
#     declared per-chapter word target.
#   Phase 3 (review): structure-review propose/persist + length-review + the
#     out-of-band length-target block.
#
# If better-sqlite3 / a provider is unavailable, LLM-dependent steps SKIP with a
# notice (deterministic checks are unit-tested). Hermetic: loopback bind, env
# token, cleanup trap removes the created books.
#
# Usage: tests/book-format-smoke.sh [-v]
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

HOST="127.0.0.1"
PORT="3851"
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="smoke-format-token-$$"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SERVER_LOG="$(mktemp)"
SERVER_PID=""
FAILED=0
SLUGS=()

log()  { printf '%s\n' "$*"; }
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

cleanup() {
  for s in "${SLUGS[@]:-}"; do
    [ -n "$s" ] && [ -n "${SERVER_PID}" ] && curl -s -o /dev/null -X DELETE -H "Authorization: Bearer ${TEST_TOKEN}" "${BASE}/api/books/${s}" 2>/dev/null || true
  done
  stop_server
  for s in "${SLUGS[@]:-}"; do [ -n "$s" ] && rm -rf "${ROOT_DIR}/workspace/books/${s}"; done
  if [ "$VERBOSE" -eq 1 ] || [ "$FAILED" -ne 0 ]; then log ""; log "── captured server log ──"; cat "$SERVER_LOG"; fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  kill "$SERVER_PID" 2>/dev/null
  for _ in $(seq 1 25); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.2; done
  SERVER_PID=""
}

if curl -s -o /dev/null --max-time 2 "${BASE}/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE}"; exit 2
fi

log "Book Format & Structure smoke"

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

AUTH=(-H "Authorization: Bearer ${TEST_TOKEN}")

# ── Phase 1: catalog + creation config ───────────────────────────────────────

FORMS="$(curl -fsS "${AUTH[@]}" "${BASE}/api/forms" 2>/dev/null || true)"
FORM_COUNT="$(printf '%s' "${FORMS}" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String((d.forms||[]).length))}catch{process.stdout.write('0')}" 2>/dev/null)"
[ "${FORM_COUNT}" = "8" ] && pass "GET /api/forms lists 8 forms" || fail "GET /api/forms returned ${FORM_COUNT} forms (expected 8)"

# Valid format → 200 + persisted format block.
OK_RESP="$(curl -fsS "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${BASE}/api/books" \
  -d '{"title":"Format Smoke OK","author":"default","voice":"default","genre":null,"pipeline":"novel-pipeline","structure":"four_act","form":"novella","chapterCount":20,"wordsPerChapter":1500}' 2>/dev/null || true)"
OK_SLUG="$(printf '%s' "${OK_RESP}" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')"
if [ -n "${OK_SLUG}" ]; then
  SLUGS+=("${OK_SLUG}")
  pass "POST /api/books with a valid format → ${OK_SLUG}"
  FMT_OK="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${OK_SLUG}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const f=(d.book||{}).format;process.stdout.write(f&&f.formId==='novella'&&f.totalTarget===30000?'yes':'no')" 2>/dev/null)"
  [ "${FMT_OK}" = "yes" ] && pass "book.json format block persisted (novella, 30000)" || fail "format block missing/incorrect on the created book"
else
  fail "valid-format create failed (got: ${OK_RESP})"
fi

# Out-of-band total → 400.
BLOCK_CODE="$(curl -s -o /tmp/fmtblock.$$ -w '%{http_code}' "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${BASE}/api/books" \
  -d '{"title":"Format Smoke Block","author":"default","voice":"default","genre":null,"pipeline":"novel-pipeline","structure":"three_act","form":"short-story","chapterCount":24,"wordsPerChapter":100000}')"
BLOCK_BODY="$(cat /tmp/fmtblock.$$ 2>/dev/null)"; rm -f /tmp/fmtblock.$$
if [ "${BLOCK_CODE}" = "400" ] && printf '%s' "${BLOCK_BODY}" | grep -qi "short story"; then
  pass "out-of-band total hard-blocked (400 with band message)"
else
  fail "expected 400 band block, got ${BLOCK_CODE} (${BLOCK_BODY})"
fi

# ── Phase 2: generation wiring ────────────────────────────────────────────────
# Activate the format book, create a project, and assert the project picks up the
# declared per-chapter target and the structure rail in its outline step.

if [ -n "${OK_SLUG}" ]; then
  curl -s -o /dev/null "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${BASE}/api/books/active" -d "{\"slug\":\"${OK_SLUG}\"}"
  PROJ_RESP="$(curl -fsS "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${BASE}/api/projects/create" \
    -d '{"type":"novel-pipeline","title":"Format Gen Smoke","description":"A four-act novella to verify format-driven generation."}' 2>/dev/null || true)"
  PROJ_ID="$(printf '%s' "${PROJ_RESP}" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write((d.project&&d.project.id)||'')}catch{process.stdout.write('')}" 2>/dev/null)"
  if [ -n "${PROJ_ID}" ]; then
    GEN_EVAL="$(printf '%s' "${PROJ_RESP}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const steps = (d.project && d.project.steps) ? d.project.steps : [];
const rail = steps.some(s => /Midpoint Turn|Inciting Turn|Crisis Turn/.test(s.prompt||''));
const target = steps.some(s => s.wordCountTarget === 1500);
process.stdout.write(rail && target ? 'BOTH' : (rail ? 'RAIL' : (target ? 'TARGET' : 'NONE')));
" 2>/dev/null)"
    [ "${GEN_EVAL}" = "BOTH" ] \
      && pass "project picked up structure rail + 1500-word per-chapter target" \
      || fail "generation wiring incomplete (got: ${GEN_EVAL})"
    curl -s -o /dev/null "${AUTH[@]}" -X DELETE "${BASE}/api/projects/${PROJ_ID}" 2>/dev/null || true
  else
    log "  [SKIP] project create returned no id — generation-wiring check skipped (got: ${PROJ_RESP})"
  fi
fi

# ── Phase 3: review surface ───────────────────────────────────────────────────
# Seed an editable outline + two chapters, then exercise the review endpoints:
# structure-review GET/propose/PUT, length-review GET, and the out-of-band
# length-targets block. Propose is LLM-dependent → SKIP if it returns no mapping.

if [ -n "${OK_SLUG}" ]; then
  DATA_DIR="${ROOT_DIR}/workspace/books/${OK_SLUG}/data"
  mkdir -p "${DATA_DIR}"
  printf '# Chapter 1\n\n%s\n' "$(yes 'word' | head -1500 | tr '\n' ' ')" > "${DATA_DIR}/chapter-1.md"
  printf '# Chapter 2\n\n%s\n' "$(yes 'word' | head -1400 | tr '\n' ' ')" > "${DATA_DIR}/chapter-2.md"
  printf '{"outline":[{"chapter":1,"summary":"Setup: the protagonist is introduced."},{"chapter":2,"summary":"The inciting turn launches the conflict."}],"mapping":{}}\n' > "${DATA_DIR}/.structure-review.json"

  SR_CODE="$(curl -s -o /tmp/sr.$$ -w '%{http_code}' "${AUTH[@]}" "${BASE}/api/books/${OK_SLUG}/structure-review")"
  if [ "${SR_CODE}" = "200" ] && grep -q '"structure"' /tmp/sr.$$; then
    pass "GET structure-review returns the declared structure + report"
  else
    fail "GET structure-review failed (code ${SR_CODE})"
  fi
  rm -f /tmp/sr.$$

  PROP="$(curl -fsS "${AUTH[@]}" -X POST "${BASE}/api/books/${OK_SLUG}/structure-review/propose" 2>/dev/null || true)"
  if printf '%s' "${PROP}" | grep -q '"mapping"'; then
    HAS_MAP="$(printf '%s' "${PROP}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(Object.keys(d.mapping||{}).length>0?'yes':'no')" 2>/dev/null)"
    if [ "${HAS_MAP}" = "yes" ]; then pass "structure-review propose returned a beat mapping"; else log "  [SKIP] propose returned an empty mapping (model-dependent) — deterministic check is unit-tested"; fi
  else
    fail "structure-review propose returned no mapping field (got: ${PROP})"
  fi

  PUT_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -H 'Content-Type: application/json' -X PUT "${BASE}/api/books/${OK_SLUG}/structure-review" \
    -d '{"outline":[{"chapter":1,"summary":"Setup."}],"mapping":{"Setup":[1]}}')"
  [ "${PUT_CODE}" = "200" ] && pass "PUT structure-review persisted edits" || fail "PUT structure-review returned ${PUT_CODE}"

  LR_TOTAL="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${OK_SLUG}/length-review" | node -e "try{const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));process.stdout.write(String(d.totalWords||0))}catch{process.stdout.write('0')}" 2>/dev/null)"
  [ "${LR_TOTAL}" -gt 0 ] 2>/dev/null && pass "GET length-review reports per-chapter word totals (${LR_TOTAL})" || fail "GET length-review returned no totals (${LR_TOTAL})"

  # Out-of-band length-targets edit (novella min 17,500; 2 chapters × 200 = 400) → 400.
  LT_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -H 'Content-Type: application/json' -X PUT "${BASE}/api/books/${OK_SLUG}/length-targets" \
    -d '{"overrides":{"chapter-1":200,"chapter-2":200}}')"
  [ "${LT_CODE}" = "400" ] && pass "out-of-band length-targets edit hard-blocked (400)" || fail "expected 400 on out-of-band length-targets, got ${LT_CODE}"
fi

# A book WITHOUT a declared format must read as a clean empty state (200 configured:false),
# never a 400 — this is what the studio panel renders for legacy/unconfigured books.
NOFMT_RESP="$(curl -fsS "${AUTH[@]}" -H 'Content-Type: application/json' -X POST "${BASE}/api/books" \
  -d '{"title":"No Format Book","author":"default","voice":"default","genre":null,"pipeline":"novel-pipeline"}' 2>/dev/null || true)"
NOFMT_SLUG="$(printf '%s' "${NOFMT_RESP}" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')"
if [ -n "${NOFMT_SLUG}" ]; then
  SLUGS+=("${NOFMT_SLUG}")
  SRC="$(curl -s -o /tmp/nofmt.$$ -w '%{http_code}' "${AUTH[@]}" "${BASE}/api/books/${NOFMT_SLUG}/structure-review")"
  SRB="$(cat /tmp/nofmt.$$ 2>/dev/null)"; rm -f /tmp/nofmt.$$
  if [ "${SRC}" = "200" ] && printf '%s' "${SRB}" | grep -q '"configured":false'; then
    pass "unconfigured book → 200 {configured:false} (no 400, no console error)"
  else
    fail "unconfigured structure-review should be 200 configured:false, got ${SRC} (${SRB})"
  fi
  LRC="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${BASE}/api/books/${NOFMT_SLUG}/length-review")"
  [ "${LRC}" = "200" ] && pass "unconfigured length-review → 200" || fail "unconfigured length-review should be 200, got ${LRC}"
fi

stop_server
log ""
if [ "$FAILED" -eq 0 ]; then log "PASS: book-format smoke — all checks passed"; exit 0; fi
log "FAIL: book-format smoke — see output above"; exit 1
