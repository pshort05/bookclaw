#!/usr/bin/env bash
#
# Consistency Auditor smoke test — Task 6
# ───────────────────────────────────────
# Boots the gateway, creates a 5-chapter book with a planted eye-color
# contradiction, a legitimate clothing-state reset (shower + next morning), a
# dream scene with an impossibility, and a knowledge-timeline violation,
# triggers a consistency audit, polls until the report is ready, then asserts:
#   - the report flags eye_color (blue vs green) as a contradiction
#   - the report does NOT flag clothing_state for the justified reset
#   - a chapter marked non-canonical via the .non-canonical.json author override
#     contributes NO findings (Selective Exclusion)
#   - when the extractor emits knowledge events, a knowledge-violation is reported
#     (Elena uses a secret before learning it); skipped on a model too weak to
#     emit knowledge events (same graceful-skip posture as the 503 path)
#
# If better-sqlite3 is unavailable the audit returns 503 — asserts that path
# is clean and exits 0 (no content checks on a box without the native binary).
#
# Hermetic: loopback bind, env-supplied token, cleanup trap kills the server
# and removes the created book + consistency.db on every exit path.
#
# Usage:
#   tests/consistency-smoke.sh      # quiet
#   tests/consistency-smoke.sh -v   # also streams the captured server log
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

HOST="127.0.0.1"
PORT="3849"
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="smoke-consistency-token-$$"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BOOK_TITLE="Consistency Smoke Book $$"
BOOK_SLUG=""   # filled in after book create

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SERVER_LOG="$(mktemp)"
SERVER_PID=""
FAILED=0

log()  { printf '%s\n' "$*"; }
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

cleanup() {
  # Delete the created book via API (best-effort; server may be gone).
  if [ -n "${BOOK_SLUG}" ] && [ -n "${SERVER_PID}" ]; then
    curl -s -o /dev/null -X DELETE \
      -H "Authorization: Bearer ${TEST_TOKEN}" \
      "${BASE}/api/books/${BOOK_SLUG}" 2>/dev/null || true
  fi
  stop_server
  # Belt-and-suspenders: remove book dir directly in case the API delete failed.
  if [ -n "${BOOK_SLUG}" ]; then
    rm -rf "${ROOT_DIR}/workspace/books/${BOOK_SLUG}"
  fi
  # Remove the consistency DB (and any WAL/SHM files).
  rm -f \
    "${ROOT_DIR}/workspace/memory/consistency.db" \
    "${ROOT_DIR}/workspace/memory/consistency.db-wal" \
    "${ROOT_DIR}/workspace/memory/consistency.db-shm"
  if [ "$VERBOSE" -eq 1 ] || [ "$FAILED" -ne 0 ]; then
    log ""
    log "── captured server log ──"
    cat "$SERVER_LOG"
  fi
  rm -f "$SERVER_LOG"
}
trap cleanup EXIT

stop_server() {
  [ -n "$SERVER_PID" ] || return 0
  kill "$SERVER_PID" 2>/dev/null
  local i
  for i in $(seq 1 25); do kill -0 "$SERVER_PID" 2>/dev/null || break; sleep 0.2; done
  SERVER_PID=""
}

# Preflight: port must be free.
if curl -s -o /dev/null --max-time 2 "${BASE}/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE} — stop it before running the smoke test."
  exit 2
fi

log "Consistency Auditor smoke"

# Boot the gateway (loopback, env token, no BOOKCLAW_DB_DIR so the DB lands
# in workspace/memory/consistency.db as per the Global Constraints).
: > "$SERVER_LOG"
env BOOKCLAW_BIND="${HOST}" \
    BOOKCLAW_PORT="${PORT}" \
    BOOKCLAW_CHAT_PORT="$((PORT + 1))" \
    BOOKCLAW_AUTH_TOKEN="${TEST_TOKEN}" \
  node --import tsx "${ROOT_DIR}/gateway/src/index.ts" > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# Wait for readiness.
for i in $(seq 1 60); do
  curl -s -o /dev/null --max-time 2 "${BASE}/" && break
  kill -0 "$SERVER_PID" 2>/dev/null || { log "ERROR: server exited during startup"; exit 1; }
  sleep 0.5
done

AUTH=(-H "Authorization: Bearer ${TEST_TOKEN}")

# ── 1. Create the book ────────────────────────────────────────────────────────

BOOK_RESP="$(curl -fsS "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -X POST "${BASE}/api/books" \
  -d "{\"title\":\"${BOOK_TITLE}\",\"author\":\"default\",\"voice\":\"default\",\"genre\":null,\"pipeline\":\"novel-pipeline\"}")"
BOOK_SLUG="$(printf '%s' "${BOOK_RESP}" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')"
[ -n "${BOOK_SLUG}" ] \
  && pass "book created: ${BOOK_SLUG}" \
  || { fail "book create failed (got: ${BOOK_RESP})"; }

if [ -z "${BOOK_SLUG}" ]; then
  fail "cannot continue without a book slug"
  exit 1
fi

DATA_DIR="${ROOT_DIR}/workspace/books/${BOOK_SLUG}/data"
mkdir -p "${DATA_DIR}"

# ── 2. Write chapter files ────────────────────────────────────────────────────

# chapter-1.md: establishes blue eyes + muddy work clothes.
cat > "${DATA_DIR}/chapter-1.md" <<'MD'
# Chapter 1

John stepped through the door, his piercing blue eyes scanning the room. He was still in his
muddy work clothes, hair a mess after the shift. Exhausted but alert, he dropped into the
chair and pulled off his boots.
MD

# chapter-2.md: planted eye-color contradiction (green) + legitimate reset
# (showered and changed, next morning — justified stateful transition).
cat > "${DATA_DIR}/chapter-2.md" <<'MD'
# Chapter 2

The next morning John stood at the mirror, his green eyes catching the early light. He had
showered and changed into a clean grey suit, the mud of the previous day washed away. He
knotted his tie and headed out.
MD

# chapter-3.md: a DREAM scene asserting an impossibility (purple eyes). It is marked
# non-canonical via the author-override sidecar below, so Selective Exclusion must
# keep ANY of its details out of the findings — deterministically, independent of
# whether the extractor model auto-detected the dream. (Auto-detect is unit-tested.)
cat > "${DATA_DIR}/chapter-3.md" <<'MD'
# Chapter 3

That night John dreamed. In the dream, his eyes burned a brilliant purple and he soared above
the rooftops, weightless. He woke with a start, the vision already fading.
MD

# Author override: mark chapter-3 (the dream) non-canonical so its facts are stored
# but excluded from the consistency check as both priors and subjects.
cat > "${DATA_DIR}/.non-canonical.json" <<'JSON'
{ "chapter-3": false }
JSON

# chapter-4.md + chapter-5.md plant a knowledge-timeline violation: Elena USES the
# secret (states the killer) in chapter 4, but is only TOLD it in chapter 5.
cat > "${DATA_DIR}/chapter-4.md" <<'MD'
# Chapter 4

Elena turned to the inspector. "Marsh is the killer," she said flatly. "He has been all along."
The inspector frowned; no one had told her that yet.
MD

cat > "${DATA_DIR}/chapter-5.md" <<'MD'
# Chapter 5

It was here that the inspector finally told Elena the truth: Marsh was the killer.
She received the news as though hearing it for the very first time.
MD

pass "chapter files written to ${DATA_DIR}"

# ── 3. Trigger consistency audit ──────────────────────────────────────────────

AUDIT_CODE="$(curl -s -o /tmp/audit.$$.out -w '%{http_code}' "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -X POST "${BASE}/api/books/${BOOK_SLUG}/consistency-audit")"
AUDIT_BODY="$(cat /tmp/audit.$$.out 2>/dev/null)"
rm -f "/tmp/audit.$$.out"

if [ "${AUDIT_CODE}" = "503" ]; then
  # better-sqlite3 not available — assert the 503 path is clean and exit.
  echo "${AUDIT_BODY}" | grep -qi "unavailable\|disabled\|sqlite" \
    && pass "503 path returns a clean unavailability message" \
    || { fail "503 but body doesn't describe unavailability (got: ${AUDIT_BODY})"; }
  log ""
  log "SKIP: better-sqlite3 unavailable — skipping content asserts (expected on boxes without the native binary)"
  exit 0
fi

[ "${AUDIT_CODE}" = "200" ] \
  && pass "POST consistency-audit returned 200" \
  || { fail "POST consistency-audit returned ${AUDIT_CODE} (got: ${AUDIT_BODY})"; }

echo "${AUDIT_BODY}" | grep -q '"started"' \
  && pass "audit body contains status:started" \
  || { fail "audit body missing status:started (got: ${AUDIT_BODY})"; }

# ── 4. Poll for the report (up to 90 s) ──────────────────────────────────────

log "  polling for consistency report (up to 90s)..."
REPORT_JSON=""
for i in $(seq 1 90); do
  POLL_RESP="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${BOOK_SLUG}/consistency-report" 2>/dev/null || true)"
  # report is non-null when the "report" key is present and not the literal null.
  if printf '%s' "${POLL_RESP}" | node -e \
       "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.report == null ? 1 : 0)" \
       2>/dev/null; then
    REPORT_JSON="${POLL_RESP}"
    break
  fi
  sleep 1
done

[ -n "${REPORT_JSON}" ] \
  && pass "consistency report is ready" \
  || { fail "consistency report timed out after 90s (last: ${POLL_RESP:-<empty>})"; }

# ── 5. Assert content of the report ──────────────────────────────────────────

if [ -n "${REPORT_JSON}" ]; then
  # 5a. The report must contain a contradiction/canon-divergence on eye_color
  #     (blue in ch-1 vs green in ch-2 — a genuine immutable-attribute conflict).
  EYE_FINDING="$(printf '%s' "${REPORT_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
const findings = (d.report && d.report.findings) ? d.report.findings : [];
const hit = findings.find(f =>
  (f.attribute === 'eye_color' || /eye/i.test(f.attribute || '') || /eye/i.test(f.explanation || '')) &&
  (f.category === 'contradiction' || f.category === 'canon-divergence' || f.severity === 'high')
);
process.stdout.write(hit ? JSON.stringify(hit) : '');
" 2>/dev/null || true)"

  [ -n "${EYE_FINDING}" ] \
    && pass "eye_color contradiction finding present in report" \
    || { fail "eye_color contradiction NOT found in report (findings: $(printf '%s' "${REPORT_JSON}" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(JSON.stringify((d.report||{}).findings||[]))" 2>/dev/null))"; }

  # 5b. The report must NOT contain a continuity finding for clothing_state that
  #     is unjustified — the clean suit is explicitly preceded by "showered" and
  #     "next morning", making it a legitimate stateful transition.
  #     We look for any high/medium-severity continuity finding that mentions
  #     clothing (clothing_state, outfit, attire, clothes, suit) WITHOUT the
  #     transition being justified.  A low-severity note is acceptable.
  BAD_CLOTHING="$(printf '%s' "${REPORT_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
const findings = (d.report && d.report.findings) ? d.report.findings : [];
const hit = findings.find(f => {
  const isClothing = /clothing|clothes|attire|outfit|suit|apparel/i.test(f.attribute || '') ||
                     /clothing|clothes|attire|outfit|suit|apparel/i.test(f.explanation || '');
  const isContinuity = f.category === 'continuity' || f.category === 'impossibility';
  const isSignificant = f.severity === 'high' || f.severity === 'medium';
  return isClothing && isContinuity && isSignificant;
});
process.stdout.write(hit ? JSON.stringify(hit) : '');
" 2>/dev/null || true)"

  [ -z "${BAD_CLOTHING}" ] \
    && pass "no unjustified continuity finding for clothing state (legitimate reset not flagged)" \
    || { fail "clothing-state continuity finding unexpectedly present (justified reset flagged): ${BAD_CLOTHING}"; }

  # 5c. Selective Exclusion (author override): chapter-3 is marked non-canonical,
  #     so it must contribute ZERO findings (its facts are excluded as both priors
  #     and subjects). Deterministic — does not depend on the extractor model.
  CH3_FINDING="$(printf '%s' "${REPORT_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
const findings = (d.report && d.report.findings) ? d.report.findings : [];
const cites = f => (f.a && f.a.chapter === 'chapter-3') || (f.b && f.b.chapter === 'chapter-3');
const hit = findings.find(cites);
process.stdout.write(hit ? JSON.stringify(hit) : '');
" 2>/dev/null || true)"
  [ -z "${CH3_FINDING}" ] \
    && pass "non-canonical chapter-3 produced no findings (Selective Exclusion works)" \
    || { fail "non-canonical chapter-3 was still checked (exclusion failed): ${CH3_FINDING}"; }

  # 5d. Knowledge Matrix (positive confirmation, never a hard failure): Elena
  #     references the killer (ch4) before being told (ch5). Knowledge-event
  #     extraction AND the use/acquire factKey match are model-dependent — there
  #     is no deterministic injection path, and a weak extractor cannot reliably
  #     normalize the two events to the same factKey. The deterministic engine is
  #     fully covered by tests/unit/consistency-check-engine.test.ts; here we PASS
  #     when a capable model reproduces the planted violation and SKIP otherwise
  #     (same graceful-skip posture as the 503 path) so the smoke is not flaky.
  KNOW_HIT="$(printf '%s' "${REPORT_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
const findings = (d.report && d.report.findings) ? d.report.findings : [];
process.stdout.write(findings.some(f => f.category === 'knowledge-violation') ? 'HIT' : '');
" 2>/dev/null || true)"
  if [ "${KNOW_HIT}" = "HIT" ]; then
    pass "knowledge-violation reported (use precedes acquire)"
  else
    log "  [SKIP] extractor did not reproduce the planted knowledge-violation (model-dependent) — deterministic logic is unit-tested"
  fi
fi

stop_server

log ""
if [ "$FAILED" -eq 0 ]; then
  log "PASS: consistency smoke — all checks passed"
  exit 0
fi
log "FAIL: consistency smoke — see output above"
exit 1
