#!/usr/bin/env bash
#
# Consistency Auditor smoke test — Task 6
# ───────────────────────────────────────
# Boots the gateway, creates a 6-chapter book with a planted eye-color
# contradiction, a legitimate clothing-state reset (shower + next morning), a
# dream scene with an impossibility, a knowledge-timeline violation, and a
# legitimate relationship change across a "two years later" time skip,
# triggers a consistency audit, polls until the report is ready, then asserts:
#   - the report flags eye_color (blue vs green) as a contradiction
#   - the report does NOT flag clothing_state for the justified reset
#   - the report does NOT flag the relationship change across the large time skip
#     (story-time distance excuse — the fix); best-effort, deterministic guarantee
#     is the unit tests
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
PORT="${PORT:-3849}"   # overridable: 3849 may be taken on a shared host
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
chair and pulled off his boots. His sister Elena was already there, but he could barely look
at her; the old resentment sat cold between them.
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

# chapter-6.md: a legitimate emotional/relationship reset across a LARGE time skip.
# John's feeling toward his sister Elena flips from cold resentment (ch-1) to warm
# love after an explicit "Two years later" jump. The story-time elapsed clock must
# excuse this (the change is separated from its prior by a multi-unit time jump),
# so it must NOT produce a continuity finding — the bug this fix targets.
cat > "${DATA_DIR}/chapter-6.md" <<'MD'
# Chapter 6

Two years later, John pulled his sister Elena into a warm embrace at the family reunion.
Whatever had festered between them had long since healed. He loved her deeply now, and
told her so, and she wept with relief.
MD

pass "chapter files written to ${DATA_DIR}"

# ── 2b. Consistency model selection (per-book pin + round-trip) ────────────────
# Pin the audit's extractor/judge model on the book, then confirm the report
# endpoint echoes it back. Runs while the gateway is up and the book exists, but
# before the audit is kicked off (the audit POST below carries a per-run override).
MODEL_RESP="$(curl -fsS "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -X PUT "${BASE}/api/books/${BOOK_SLUG}/consistency-model" \
  -d '{"provider":"gemini","model":"gemini-2.5-flash"}' 2>/dev/null || true)"
printf '%s' "${MODEL_RESP}" | node -e \
     "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.exit(d.ok === true ? 0 : 1)" \
     2>/dev/null \
  && pass "PUT consistency-model accepted (ok:true)" \
  || fail "PUT consistency-model did not return ok:true (got: ${MODEL_RESP})"

MODEL_REPORT="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${BOOK_SLUG}/consistency-report" 2>/dev/null || true)"
printf '%s' "${MODEL_REPORT}" | node -e \
     "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const m=d.consistencyModel||{}; process.exit(m.provider === 'gemini' && m.model === 'gemini-2.5-flash' ? 0 : 1)" \
     2>/dev/null \
  && pass "consistency-report round-trips consistencyModel (gemini / gemini-2.5-flash)" \
  || fail "consistency-report did not echo the pinned model (got: ${MODEL_REPORT})"

# ── 3. Trigger consistency audit ──────────────────────────────────────────────
# No per-run body override: this exercises the per-book default saved in step 2b
# (the full precedence chain empty-override → book.json default → run).

AUDIT_CODE="$(curl -s -o /tmp/audit.$$.out -w '%{http_code}' "${AUTH[@]}" \
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

# ── 3a. Concurrency guard + running flag ──────────────────────────────────────
# Fired immediately while the first audit is still in flight (its per-chapter LLM
# calls take seconds). A second start must be rejected 409; the report endpoint
# must report running:true. Both are best-effort NOTES (not failures) if the
# first run already finished (e.g. an offline/instant model), to stay hermetic.
SECOND_CODE="$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -X POST "${BASE}/api/books/${BOOK_SLUG}/consistency-audit")"
if [ "${SECOND_CODE}" = "409" ]; then
  pass "concurrent second audit rejected with 409"
elif [ "${SECOND_CODE}" = "200" ]; then
  log "  [NOTE] second audit returned 200 — first run already finished; concurrency guard not exercised this run"
else
  fail "concurrent second audit returned ${SECOND_CODE} (expected 409)"
fi

RUN_RESP="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${BOOK_SLUG}/consistency-report" 2>/dev/null || true)"
if printf '%s' "${RUN_RESP}" | grep -q '"running":true'; then
  pass "report endpoint reports running:true during audit"
else
  log "  [NOTE] running:true not observed — audit may have already finished (checked best-effort)"
fi

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

  # 5b-2. Story-time distance (THE FIX): John's feeling toward Elena legitimately
  #       changes from cold (ch-1) to warm (ch-6) across an explicit "Two years
  #       later" jump. The cumulative elapsed clock must excuse it, so NO continuity
  #       finding may cite chapter-6 for that relationship/emotional change.
  #       Best-effort: passes vacuously if the model didn't extract the relationship
  #       state (the unit tests are the deterministic guarantee for this behavior).
  BAD_TIMESKIP="$(printf '%s' "${REPORT_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
const findings = (d.report && d.report.findings) ? d.report.findings : [];
const hit = findings.find(f => {
  const citesCh6 = (f.a && f.a.chapter === 'chapter-6') || (f.b && f.b.chapter === 'chapter-6');
  const isRel = /relationship|feeling|emotion|sister|elena|love|resent|warm|cold|affection|bond/i.test((f.attribute||'') + ' ' + (f.explanation||''));
  return citesCh6 && isRel && f.category === 'continuity';
});
process.stdout.write(hit ? JSON.stringify(hit) : '');
" 2>/dev/null || true)"
  [ -z "${BAD_TIMESKIP}" ] \
    && pass "relationship change across a 'two years later' skip not flagged (story-time distance excuse works)" \
    || { fail "time-skip relationship change wrongly flagged as continuity (story-time distance not applied): ${BAD_TIMESKIP}"; }

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

  # 5e. Worldfall quick-hits: the report must carry a reverseIndex (fact → chapters)
  #     and an orphanFacts array. Both fields are deterministic (always present on a
  #     new report). This book seeds no canon (no world), so orphanFacts is [] — the
  #     orphan logic itself is unit-tested. reverseIndex must be NON-EMPTY whenever the
  #     extractor produced facts (factCount > 0); skipped on a provider too weak to
  #     extract any (same graceful posture as the knowledge check).
  REV_STATE="$(printf '%s' "${REPORT_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const r = d.report || {};
if (!Array.isArray(r.reverseIndex) || !Array.isArray(r.orphanFacts)) { process.stdout.write('MISSING'); process.exit(0); }
process.stdout.write('OK:'+(r.factCount||0)+':'+r.reverseIndex.length+':'+r.orphanFacts.length);
" 2>/dev/null || true)"
  case "${REV_STATE}" in
    MISSING) fail "report is missing the reverseIndex / orphanFacts arrays" ;;
    OK:0:*)  log "  [SKIP] no facts extracted (factCount 0) — cannot assert a populated reverse index (provider-dependent)" ;;
    OK:*:0:*) fail "facts were extracted but reverseIndex is empty (${REV_STATE})" ;;
    OK:*)    pass "report carries reverseIndex + orphanFacts (factCount:revLen:orphanLen = ${REV_STATE#OK:})" ;;
    *)       fail "could not read reverseIndex/orphanFacts (got: ${REV_STATE})" ;;
  esac

  # 5f. (soft) The impact index links a recurring fact to ≥2 chapters (e.g. John's
  #     eye_color appears in chapter-1 and chapter-2). Model-dependent grouping.
  MULTI="$(printf '%s' "${REPORT_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const rev = ((d.report||{}).reverseIndex)||[];
process.stdout.write(rev.some(e => Array.isArray(e.chapters) && e.chapters.length >= 2) ? 'HIT' : '');
" 2>/dev/null || true)"
  if [ "${MULTI}" = "HIT" ]; then
    pass "impact index links a recurring fact across multiple chapters"
  else
    log "  [SKIP] no fact spanned ≥2 chapters in the index (model-dependent grouping)"
  fi

  # 5g. Downloadable reports: the audit must have emitted a consistency report
  #     (.md + .json) under data/reports/, the reports API must list it, and the
  #     :id endpoint must serve the markdown. (Deterministic once the audit ran;
  #     keep-last-N pruning is unit-tested rather than run 11x here.)
  if ls "${DATA_DIR}/reports/"consistency-*.md >/dev/null 2>&1 && ls "${DATA_DIR}/reports/"consistency-*.json >/dev/null 2>&1; then
    pass "consistency report files written to data/reports/ (.md + .json)"
  else
    fail "no consistency-*.md/.json under ${DATA_DIR}/reports/"
  fi

  REPORTS_JSON="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${BOOK_SLUG}/reports" 2>/dev/null || true)"
  REPORT_ID="$(printf '%s' "${REPORTS_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const r = (d.reports||[]).find(x => x.kind === 'consistency');
process.stdout.write(r ? r.id : '');
" 2>/dev/null || true)"
  if [ -n "${REPORT_ID}" ]; then
    pass "GET /api/books/:slug/reports lists the consistency report (${REPORT_ID})"
    MD="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${BOOK_SLUG}/reports/${REPORT_ID}?format=md" 2>/dev/null || true)"
    printf '%s' "${MD}" | grep -q "# Consistency" \
      && pass "GET …/reports/:id?format=md serves the markdown report" \
      || fail "report markdown did not serve as expected (got: $(printf '%s' "${MD}" | head -c 80))"
  else
    fail "reports API did not list a consistency report (got: ${REPORTS_JSON})"
  fi

  # 5h. Prompt Runner report-saving path (best-effort): run a prompt from the
  #     catalog against this book, save its output as a "prompt-run" report, then
  #     confirm the reports API lists it and serves the markdown. Fail-soft about
  #     the catalog — if no prompt asset exists this whole block is skipped so the
  #     hermetic smoke never hard-fails.
  PROMPTS_JSON="$(curl -fsS "${AUTH[@]}" "${BASE}/api/library?kind=prompt" 2>/dev/null || true)"
  PROMPT_NAME="$(printf '%s' "${PROMPTS_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const e = (d.entries||[])[0];
process.stdout.write(e && e.name ? e.name : '');
" 2>/dev/null || true)"
  if [ -n "${PROMPT_NAME}" ]; then
    # b. Run the prompt against the book.
    RUN_OUT="$(curl -fsS "${AUTH[@]}" \
      -H 'Content-Type: application/json' \
      -X POST "${BASE}/api/prompts/run" \
      -d "{\"prompt\":\"${PROMPT_NAME}\",\"content\":\"Sample text for a prompt run.\",\"bookSlug\":\"${BOOK_SLUG}\",\"provider\":\"gemini\",\"model\":\"gemini-2.5-flash\"}" 2>/dev/null || true)"
    PROMPT_OUTPUT="$(printf '%s' "${RUN_OUT}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.output || '');
" 2>/dev/null || true)"
    if [ -z "${PROMPT_OUTPUT}" ]; then
      fail "prompt run returned no output (got: ${RUN_OUT})"
    else
      pass "POST /api/prompts/run produced output for prompt '${PROMPT_NAME}'"
      # c. Save the run as a prompt-run report. Build the JSON body with node so
      #    the output text is properly escaped.
      REPORT_BODY="$(PROMPT_NAME="${PROMPT_NAME}" PROMPT_OUTPUT="${PROMPT_OUTPUT}" node -e "
const body = {
  prompt: process.env.PROMPT_NAME,
  file: 'data/sample.md',
  output: process.env.PROMPT_OUTPUT,
  meta: { provider: 'gemini', model: 'gemini-2.5-flash' },
};
process.stdout.write(JSON.stringify(body));
")"
      SAVE_RESP="$(printf '%s' "${REPORT_BODY}" | curl -fsS "${AUTH[@]}" \
        -H 'Content-Type: application/json' \
        -X POST "${BASE}/api/books/${BOOK_SLUG}/prompts/report" \
        --data-binary @- 2>/dev/null || true)"
      PROMPT_REPORT_ID="$(printf '%s' "${SAVE_RESP}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
process.stdout.write(d.id || '');
" 2>/dev/null || true)"
      [ -n "${PROMPT_REPORT_ID}" ] \
        && pass "POST /api/books/:slug/prompts/report saved a prompt-run report (${PROMPT_REPORT_ID})" \
        || fail "prompts/report did not return an id (got: ${SAVE_RESP})"

      # d. The reports API must list a prompt-run report and serve its markdown.
      PR_REPORTS_JSON="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${BOOK_SLUG}/reports" 2>/dev/null || true)"
      PR_REPORT_ID="$(printf '%s' "${PR_REPORTS_JSON}" | node -e "
const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const r = (d.reports||[]).find(x => x.kind === 'prompt-run');
process.stdout.write(r ? r.id : '');
" 2>/dev/null || true)"
      if [ -n "${PR_REPORT_ID}" ]; then
        pass "GET /api/books/:slug/reports lists a prompt-run report (${PR_REPORT_ID})"
        PR_MD="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${BOOK_SLUG}/reports/${PR_REPORT_ID}?format=md" 2>/dev/null || true)"
        printf '%s' "${PR_MD}" | grep -q "# Prompt Run" \
          && pass "GET …/reports/:id?format=md serves the prompt-run markdown" \
          || fail "prompt-run markdown did not serve as expected (got: $(printf '%s' "${PR_MD}" | head -c 80))"
      else
        fail "reports API did not list a prompt-run report (got: ${PR_REPORTS_JSON})"
      fi
    fi
  else
    echo "  (skip: no prompt asset available)"
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
