#!/usr/bin/env bash
#
# World Repository smoke test — Phase 1 (CRUD) + Phase 3 (relevance-pull, curate/snapshot, series world ref)
# ─────────────────────────────────────────────────────────────────────────────────────────────────────────
# Boots the gateway, seeds a world overlay in the real workspace/library/worlds/
# dir, exercises the documents API (Phase 1), then exercises book/world binding,
# relevance-pull, curate+snapshot, and series world-ref (Phase 3).
#
# Hermetic: loopback bind, env-supplied token, no stray process. Cleanup trap
# removes the seeded world dir, the created book dir, and the created series on
# every exit path (pass or fail).
#
# Usage:
#   tests/world-crud-smoke.sh      # quiet
#   tests/world-crud-smoke.sh -v   # also streams the captured server log
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

HOST="127.0.0.1"
PORT="3849"
BASE="http://${HOST}:${PORT}"
TEST_TOKEN="smoke-world-crud-token-$$"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Unique names (PID ensures no collision with real data or parallel runs)
WORLD_NAME="smoke-world-$$"
WORLD_DIR="${ROOT_DIR}/workspace/library/worlds/${WORLD_NAME}"
BOOK_TITLE="Smoke World Book $$"
BOOK_SLUG=""     # filled in after book create
BOOK2_SLUG=""    # filled in after the series-inheritance book create (Phase 7)
SERIES_ID=""     # filled in after series create

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SERVER_LOG="$(mktemp)"
SERVER_PID=""
FAILED=0

log()  { printf '%s\n' "$*"; }
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

cleanup() {
  # Delete the created book via API (best-effort; server may be stopped already).
  if [ -n "${BOOK_SLUG}" ] && [ -n "${SERVER_PID}" ]; then
    curl -s -o /dev/null -X DELETE \
      -H "Authorization: Bearer ${TEST_TOKEN}" \
      "${BASE}/api/books/${BOOK_SLUG}" 2>/dev/null || true
  fi
  # Delete the Phase 7 inheritance book via API (best-effort).
  if [ -n "${BOOK2_SLUG}" ] && [ -n "${SERVER_PID}" ]; then
    curl -s -o /dev/null -X DELETE \
      -H "Authorization: Bearer ${TEST_TOKEN}" \
      "${BASE}/api/books/${BOOK2_SLUG}" 2>/dev/null || true
  fi
  # Delete the created series via API (best-effort).
  if [ -n "${SERIES_ID}" ] && [ -n "${SERVER_PID}" ]; then
    curl -s -o /dev/null -X DELETE \
      -H "Authorization: Bearer ${TEST_TOKEN}" \
      "${BASE}/api/series/${SERIES_ID}" 2>/dev/null || true
  fi
  stop_server
  # Remove the seeded world overlay dir so the real workspace is clean.
  rm -rf "${WORLD_DIR}"
  # Belt-and-suspenders: remove the book dir directly in case the API delete
  # failed (e.g. server was already dead when cleanup ran).
  if [ -n "${BOOK_SLUG}" ]; then
    rm -rf "${ROOT_DIR}/workspace/books/${BOOK_SLUG}"
  fi
  if [ -n "${BOOK2_SLUG}" ]; then
    rm -rf "${ROOT_DIR}/workspace/books/${BOOK2_SLUG}"
  fi
  # Belt-and-suspenders: remove the series dir directly (the API delete does not
  # always remove the on-disk dir, and workspace/series/ is not gitignored).
  if [ -n "${SERIES_ID}" ]; then
    rm -rf "${ROOT_DIR}/workspace/series/${SERIES_ID}"
  fi
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

# Preflight: port must be free
if curl -s -o /dev/null --max-time 2 "${BASE}/" 2>/dev/null; then
  log "ERROR: something is already listening on ${BASE} — stop it before running the smoke test."
  exit 2
fi

log "World Repository Phase 1 + Phase 3 smoke"

# Seed the world overlay BEFORE boot so LibraryService picks it up on loadAll().
mkdir -p "${WORLD_DIR}/documents"
cat > "${WORLD_DIR}/world.json" <<JSON
{
  "schemaVersion": 1,
  "name": "${WORLD_NAME}",
  "label": "Smoke World",
  "description": "Smoke world for CI.",
  "documentTypes": [{ "id": "field-guide", "label": "Field Guide" }],
  "domains": ["GEO"],
  "clearanceLevels": ["General Access"],
  "classificationScheme": "{TYPE}-{DOMAIN}-{NNNN}",
  "formatDirective": "Narrative prose only.",
  "authoringEditor": "world-author"
}
JSON

# Boot the gateway against the real workspace (same as smoke-test.sh)
: > "$SERVER_LOG"
env BOOKCLAW_BIND="${HOST}" BOOKCLAW_PORT="${PORT}" BOOKCLAW_CHAT_PORT="$((PORT + 1))" \
    BOOKCLAW_AUTH_TOKEN="${TEST_TOKEN}" \
  node --import tsx "${ROOT_DIR}/gateway/src/index.ts" > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# Wait for readiness (mirror smoke-test.sh pattern: poll / until it serves)
for i in $(seq 1 60); do
  curl -s -o /dev/null --max-time 2 "${BASE}/" && break
  kill -0 "$SERVER_PID" 2>/dev/null || { log "ERROR: server exited during startup"; exit 1; }
  sleep 0.5
done

AUTH=(-H "Authorization: Bearer ${TEST_TOKEN}")

# ── Phase 1: World Documents CRUD ──────────────────────────────────────────

# 1) The seeded world appears in GET /api/worlds
WORLDS_RESP="$(curl -fsS "${AUTH[@]}" "${BASE}/api/worlds")"
echo "${WORLDS_RESP}" | grep -q "\"${WORLD_NAME}\"" \
  && pass "world listed in GET /api/worlds" \
  || { fail "world not listed (got: ${WORLDS_RESP})"; }

# 2) POST /api/worlds/:name/documents → creates + auto-classifies FG-GEO-0001
CREATED="$(curl -fsS "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -X POST "${BASE}/api/worlds/${WORLD_NAME}/documents" \
  -d "{\"meta\":{\"title\":\"Geography\",\"type\":\"field-guide\",\"clearance\":\"General Access\",\"domain\":\"GEO\",\"tags\":[\"geo\"],\"summary\":\"A guide.\"},\"body\":\"Body.\"}")"
echo "${CREATED}" | grep -q '"classification":"FG-GEO-0001"' \
  && pass "POST creates doc with auto-classification FG-GEO-0001" \
  || { fail "auto-classify FG-GEO-0001 (got: ${CREATED})"; }
DOC_ID="$(printf '%s' "${CREATED}" | sed -n 's/.*"docId":"\([^"]*\)".*/\1/p')"
[ -n "${DOC_ID}" ] \
  && pass "docId returned: ${DOC_ID}" \
  || { fail "no docId in POST response"; }

# 3) GET /api/worlds/:name/documents → catalog shows the doc (no body)
CATALOG="$(curl -fsS "${AUTH[@]}" "${BASE}/api/worlds/${WORLD_NAME}/documents")"
echo "${CATALOG}" | grep -q '"FG-GEO-0001"' \
  && pass "GET documents catalog contains FG-GEO-0001" \
  || { fail "catalog missing doc (got: ${CATALOG})"; }

# 4) GET /api/worlds/:name/documents/:docId → full doc includes body + document envelope
FULL="$(curl -fsS "${AUTH[@]}" "${BASE}/api/worlds/${WORLD_NAME}/documents/${DOC_ID}")"
echo "${FULL}" | grep -q '"body":"Body."' \
  && pass "GET full doc returns body" \
  || { fail "full read body wrong (got: ${FULL})"; }
echo "${FULL}" | grep -q '"document"' \
  && pass "GET full doc wrapped in document envelope" \
  || { fail "document envelope missing (got: ${FULL})"; }

# 5) PUT /api/worlds/:name/documents/:docId → update persists
UPDATED="$(curl -fsS "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -X PUT "${BASE}/api/worlds/${WORLD_NAME}/documents/${DOC_ID}" \
  -d "{\"meta\":{\"title\":\"Geography\",\"type\":\"field-guide\",\"classification\":\"FG-GEO-0001\",\"clearance\":\"General Access\",\"domain\":\"GEO\",\"tags\":[\"geo\"],\"summary\":\"Revised.\"},\"body\":\"Body two.\"}")"
echo "${UPDATED}" | grep -q '"summary":"Revised."' \
  && pass "PUT update persists revised summary" \
  || { fail "update did not persist (got: ${UPDATED})"; }

# ── Phase 3: Book/World binding, relevance-pull, curate+snapshot, series ref ──
# All checks run while DOC_ID is still live (before Phase 1 delete checks 6a/6b).

# P3-1) Create a book bound to no world yet (world binding comes from curate step).
#        Required fields: title, author, voice, pipeline. genre is optional (null ok).
BOOK_RESP="$(curl -fsS "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -X POST "${BASE}/api/books" \
  -d "{\"title\":\"${BOOK_TITLE}\",\"author\":\"default\",\"voice\":\"default\",\"genre\":null,\"pipeline\":\"novel-pipeline\"}")"
BOOK_SLUG="$(printf '%s' "${BOOK_RESP}" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')"
[ -n "${BOOK_SLUG}" ] \
  && pass "book created: ${BOOK_SLUG}" \
  || { fail "book create failed (got: ${BOOK_RESP})"; }

# P3-2) Curate + snapshot: PUT /api/books/:slug/world/docs
#        Body: { "world": "<worldName>", "docIds": ["<docId>"] }
#        Response: { "worldDocs": ["<docId>", ...] }
#        Side-effect: sets manifest.pulledFrom.world (required for propose).
if [ -n "${BOOK_SLUG}" ] && [ -n "${DOC_ID}" ]; then
  CURATE_RESP="$(curl -fsS "${AUTH[@]}" \
    -H 'Content-Type: application/json' \
    -X PUT "${BASE}/api/books/${BOOK_SLUG}/world/docs" \
    -d "{\"world\":\"${WORLD_NAME}\",\"docIds\":[\"${DOC_ID}\"]}")"
  echo "${CURATE_RESP}" | grep -q '"worldDocs"' \
    && pass "PUT world/docs returns worldDocs field" \
    || { fail "PUT world/docs missing worldDocs (got: ${CURATE_RESP})"; }
  echo "${CURATE_RESP}" | grep -q "\"${DOC_ID}\"" \
    && pass "PUT world/docs worldDocs contains the curated docId" \
    || { fail "PUT world/docs docId not in worldDocs (got: ${CURATE_RESP})"; }
  # Assert snapshot landed on disk.
  SNAP_PATH="${ROOT_DIR}/workspace/books/${BOOK_SLUG}/templates/world/${DOC_ID}.md"
  BASE_PATH="${ROOT_DIR}/workspace/books/${BOOK_SLUG}/.baseline/world/${DOC_ID}.md"
  [ -f "${SNAP_PATH}" ] \
    && pass "snapshot written: templates/world/${DOC_ID}.md" \
    || { fail "snapshot missing: ${SNAP_PATH}"; }
  [ -f "${BASE_PATH}" ] \
    && pass "baseline written: .baseline/world/${DOC_ID}.md" \
    || { fail "baseline missing: ${BASE_PATH}"; }
else
  fail "P3 curate: skipped (no BOOK_SLUG or DOC_ID)"
  fail "P3 snapshot: skipped"
  fail "P3 baseline: skipped"
fi

# P3-3) Relevance-pull (fail-soft path): with no AI key configured the service
#        falls back to returning the full catalog unranked (reason "manual").
#        Precondition: the world is now bound (set by curate above).
if [ -n "${BOOK_SLUG}" ]; then
  PROPOSE_RESP="$(curl -fsS "${AUTH[@]}" \
    -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/books/${BOOK_SLUG}/world/propose")"
  echo "${PROPOSE_RESP}" | grep -q '"proposals"' \
    && pass "POST world/propose returns proposals field" \
    || { fail "POST world/propose missing proposals (got: ${PROPOSE_RESP})"; }
  echo "${PROPOSE_RESP}" | grep -q "\"${DOC_ID}\"" \
    && pass "propose includes the world document in proposals" \
    || { fail "propose missing expected docId (got: ${PROPOSE_RESP})"; }
  echo "${PROPOSE_RESP}" | grep -q '"reason"' \
    && pass "propose proposal carries reason field (fail-soft: manual)" \
    || { fail "propose proposal missing reason field (got: ${PROPOSE_RESP})"; }
else
  fail "P3 propose: skipped (no BOOK_SLUG)"
  fail "P3 propose docId: skipped"
  fail "P3 propose reason: skipped"
fi

# P3-4) Series world ref: create a series then PUT /api/series/:id/refs with world.
#        Body: { "world": "<worldName>" }  (resolveRef accepts a plain name string)
#        Response: { "series": { ..., "pulledFrom": { "world": { "name": "...", ... } } } }
SERIES_RESP="$(curl -fsS "${AUTH[@]}" \
  -H 'Content-Type: application/json' \
  -X POST "${BASE}/api/series" \
  -d "{\"title\":\"Smoke Series $$\",\"description\":\"Smoke series for CI.\"}")"
SERIES_ID="$(printf '%s' "${SERIES_RESP}" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')"
[ -n "${SERIES_ID}" ] \
  && pass "series created: ${SERIES_ID}" \
  || { fail "series create failed (got: ${SERIES_RESP})"; }

if [ -n "${SERIES_ID}" ]; then
  REFS_RESP="$(curl -fsS "${AUTH[@]}" \
    -H 'Content-Type: application/json' \
    -X PUT "${BASE}/api/series/${SERIES_ID}/refs" \
    -d "{\"world\":\"${WORLD_NAME}\"}")"
  echo "${REFS_RESP}" | grep -q "\"${WORLD_NAME}\"" \
    && pass "series refs carry world name after PUT /refs" \
    || { fail "series world ref missing (got: ${REFS_RESP})"; }
  echo "${REFS_RESP}" | grep -q '"world"' \
    && pass "series pulledFrom contains world key" \
    || { fail "series pulledFrom.world key missing (got: ${REFS_RESP})"; }
else
  fail "P3 series refs: skipped (no SERIES_ID)"
  fail "P3 series world key: skipped"
fi

# ── Phase 5: per-book appendix selection ───────────────────────────────────
# PUT /api/books/:slug/world/appendix  body { "appendix":[{docId,order,title?}] }
#   → { "appendix":[ ... ] }. (Render into DOCX/EPUB is covered by unit tests
#   that inspect the rendered EPUB XHTML; here we assert the selection API.)
if [ -n "${BOOK_SLUG}" ] && [ -n "${DOC_ID}" ]; then
  APPX_RESP="$(curl -fsS "${AUTH[@]}" \
    -H 'Content-Type: application/json' \
    -X PUT "${BASE}/api/books/${BOOK_SLUG}/world/appendix" \
    -d "{\"appendix\":[{\"docId\":\"${DOC_ID}\",\"order\":1,\"title\":\"Appendix A\"}]}")"
  echo "${APPX_RESP}" | grep -q '"appendix"' \
    && pass "PUT world/appendix returns appendix field" \
    || { fail "PUT world/appendix missing appendix (got: ${APPX_RESP})"; }
  echo "${APPX_RESP}" | grep -q "\"${DOC_ID}\"" \
    && pass "appendix contains the selected docId" \
    || { fail "appendix docId missing (got: ${APPX_RESP})"; }
  # Persisted to the book manifest on disk.
  grep -q "\"${DOC_ID}\"" "${ROOT_DIR}/workspace/books/${BOOK_SLUG}/book.json" \
    && pass "appendix persisted to book.json manifest" \
    || { fail "appendix not persisted in book.json"; }
else
  fail "P5 appendix: skipped (no BOOK_SLUG or DOC_ID)"
  fail "P5 appendix docId: skipped"
  fail "P5 appendix persist: skipped"
fi

# ── Phase 7: World binding wiring (bind + auto-propose, inheritance, unbind) ──
# Exercises the endpoints added by the world-binding feature. Runs while DOC_ID
# is still live (the world has one document) and the series carries the world ref
# (set in P3-4 above).

# P7-1) Bind an existing book: PUT /api/books/:slug/world { world }
#        → auto-proposes (fail-soft → full catalog, capped) and snapshots as the
#        initial bible. Response: { world, worldDocs, proposed }.
if [ -n "${BOOK_SLUG}" ] && [ -n "${DOC_ID}" ]; then
  BIND_RESP="$(curl -fsS "${AUTH[@]}" \
    -H 'Content-Type: application/json' \
    -X PUT "${BASE}/api/books/${BOOK_SLUG}/world" \
    -d "{\"world\":\"${WORLD_NAME}\"}")"
  echo "${BIND_RESP}" | grep -q "\"world\":\"${WORLD_NAME}\"" \
    && pass "PUT /world binds the book to the world" \
    || { fail "PUT /world bind missing world (got: ${BIND_RESP})"; }
  echo "${BIND_RESP}" | grep -q "\"${DOC_ID}\"" \
    && pass "PUT /world auto-proposed bible contains the world doc" \
    || { fail "PUT /world worldDocs missing docId (got: ${BIND_RESP})"; }
  echo "${BIND_RESP}" | grep -q '"proposed"' \
    && pass "PUT /world response carries proposed count" \
    || { fail "PUT /world missing proposed field (got: ${BIND_RESP})"; }
  BOUND="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${BOOK_SLUG}")"
  echo "${BOUND}" | grep -q "\"world\":{\"name\":\"${WORLD_NAME}\"" \
    && pass "book manifest pulledFrom.world set after bind" \
    || { fail "manifest world not set after bind (got: ${BOUND})"; }
else
  fail "P7 bind: skipped (no BOOK_SLUG or DOC_ID)"
  fail "P7 bind doc: skipped"
  fail "P7 bind proposed: skipped"
  fail "P7 bind manifest: skipped"
fi

# P7-2) Creation inheritance: a new book created in the series (whose world ref
#        was set in P3-4) auto-binds to that world, no explicit world in the body.
if [ -n "${SERIES_ID}" ]; then
  BOOK2_RESP="$(curl -fsS "${AUTH[@]}" \
    -H 'Content-Type: application/json' \
    -X POST "${BASE}/api/books" \
    -d "{\"title\":\"Smoke Inherit Book $$\",\"author\":\"default\",\"voice\":\"default\",\"genre\":null,\"pipeline\":\"novel-pipeline\",\"series\":\"${SERIES_ID}\"}")"
  BOOK2_SLUG="$(printf '%s' "${BOOK2_RESP}" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')"
  [ -n "${BOOK2_SLUG}" ] \
    && pass "series-inheritance book created: ${BOOK2_SLUG}" \
    || { fail "inheritance book create failed (got: ${BOOK2_RESP})"; }
  if [ -n "${BOOK2_SLUG}" ]; then
    INH="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${BOOK2_SLUG}")"
    echo "${INH}" | grep -q "\"world\":{\"name\":\"${WORLD_NAME}\"" \
      && pass "new series book auto-bound to the series world" \
      || { fail "inheritance: world not bound on create (got: ${INH})"; }
    echo "${INH}" | grep -q "\"${DOC_ID}\"" \
      && pass "inherited book bible populated by auto-propose" \
      || { fail "inheritance: worldDocs empty (got: ${INH})"; }
  else
    fail "P7 inherit world: skipped"
    fail "P7 inherit bible: skipped"
  fi
else
  fail "P7 inherit: skipped (no SERIES_ID)"
  fail "P7 inherit world: skipped"
  fail "P7 inherit bible: skipped"
fi

# P7-3) Unbind: DELETE /api/books/:slug/world → { unbound: true }; clears
#        pulledFrom.world + worldDocs and removes templates/world/.
if [ -n "${BOOK_SLUG}" ]; then
  UNBIND_RESP="$(curl -fsS "${AUTH[@]}" -X DELETE "${BASE}/api/books/${BOOK_SLUG}/world")"
  echo "${UNBIND_RESP}" | grep -q '"unbound":true' \
    && pass "DELETE /world returns unbound:true" \
    || { fail "unbind failed (got: ${UNBIND_RESP})"; }
  AFTER_UNBIND="$(curl -fsS "${AUTH[@]}" "${BASE}/api/books/${BOOK_SLUG}")"
  echo "${AFTER_UNBIND}" | grep -q '"world":null' \
    && pass "manifest pulledFrom.world cleared after unbind" \
    || { fail "world not cleared after unbind (got: ${AFTER_UNBIND})"; }
  [ ! -d "${ROOT_DIR}/workspace/books/${BOOK_SLUG}/templates/world" ] \
    && pass "templates/world/ removed after unbind" \
    || { fail "templates/world/ still present after unbind"; }
else
  fail "P7 unbind: skipped (no BOOK_SLUG)"
  fail "P7 unbind clear: skipped"
  fail "P7 unbind dir: skipped"
fi

# ── Phase 1 continued: Delete checks ──────────────────────────────────────

# 6a) DELETE /api/worlds/:name/documents/:docId → deleted:true
DELETED="$(curl -fsS "${AUTH[@]}" -X DELETE "${BASE}/api/worlds/${WORLD_NAME}/documents/${DOC_ID}")"
echo "${DELETED}" | grep -q '"deleted":true' \
  && pass "DELETE returns deleted:true" \
  || { fail "delete failed (got: ${DELETED})"; }

# 6b) catalog no longer contains the doc
AFTER_DEL="$(curl -fsS "${AUTH[@]}" "${BASE}/api/worlds/${WORLD_NAME}/documents")"
echo "${AFTER_DEL}" | grep -q '"FG-GEO-0001"' \
  && { fail "doc still present in catalog after delete"; } \
  || pass "catalog empty after delete"

# ── Phase 4: world-aware authoring editor (generic, user-replaceable) ──────

# 7) The world config carries its authoringEditor (default generic editor).
WCFG="$(curl -fsS "${AUTH[@]}" "${BASE}/api/worlds/${WORLD_NAME}")"
echo "${WCFG}" | grep -q '"authoringEditor":"world-author"' \
  && pass "world config exposes authoringEditor=world-author" \
  || { fail "world config missing authoringEditor (got: ${WCFG})"; }

# 8) The generic world-author editor asset ships + loads via the library API.
WEDITOR="$(curl -fsS "${AUTH[@]}" "${BASE}/api/library/editor/world-author")"
echo "${WEDITOR}" | grep -q '"world-author"' \
  && pass "generic world-author editor asset loads" \
  || { fail "world-author editor not loaded (got: ${WEDITOR})"; }

stop_server

log ""
if [ "$FAILED" -eq 0 ]; then
  log "PASS: world smoke (Phase 1 + Phase 3 + Phase 4 + Phase 5 + Phase 7 binding) — 39 checks"
  exit 0
fi
log "FAIL: world smoke — see output above"
exit 1
