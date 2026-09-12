#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — View Book surface smoke
# ═══════════════════════════════════════════════════════════
# Exercises the four View Book endpoints end to end:
#
#   GET  /api/books/:slug/contents
#   GET  /api/books/:slug/items/:itemId[?version=]
#   PUT  /api/books/:slug/items/:itemId
#   POST /api/books/:slug/compile
#
# Two modes:
#   LOCAL (default)  — boots its own gateway on loopback with a known token,
#                      exactly like tests/smoke-test.sh. Hermetic.
#   REMOTE           — set BOOKCLAW_SMOKE_BASE + BOOKCLAW_SMOKE_TOKEN to run
#                      against a deployed box (e.g. Mercury at
#                      http://192.168.1.32:3847). Boots nothing.
#
# NON-DESTRUCTIVE. The only write is a byte-identical round trip: the script
# GETs a chapter body and PUTs exactly what it read back, then re-reads and
# asserts the content is unchanged. Pass --no-write to skip even that (use it
# if this is ever pointed at a production box).
#
# Content-dependent phases SKIP (not fail) when the target has no book with
# written chapters — a fresh install legitimately has none.
#
# Usage:
#   tests/view-book-smoke.sh              # local, quiet
#   tests/view-book-smoke.sh -v           # local, streams the server log
#   BOOKCLAW_SMOKE_BASE=http://192.168.1.32:3847 \
#     BOOKCLAW_SMOKE_TOKEN=xxx tests/view-book-smoke.sh
#
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight error.
set -uo pipefail

VERBOSE=0
NO_WRITE=0
for arg in "$@"; do
  case "$arg" in
    -v) VERBOSE=1 ;;
    --no-write) NO_WRITE=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="$(mktemp)"
BODY_FILE="$(mktemp)"
PUT_FILE="$(mktemp)"
SRV=""
FAILED=0
SKIPPED=0

pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }
skip() { printf '  [SKIP] %s\n' "$*"; SKIPPED=1; }
log()  { printf '%s\n' "$*"; }

cleanup() {
  [ -n "$SRV" ] && kill "$SRV" 2>/dev/null
  if [ -n "$SRV" ] && { [ "$VERBOSE" -eq 1 ] || [ "$FAILED" -ne 0 ]; }; then
    log ""; log "── captured server log ──"; cat "$LOG"
  fi
  rm -f "$LOG" "$BODY_FILE" "$PUT_FILE"
}
trap cleanup EXIT

command -v jq >/dev/null || { echo "ERROR: jq is required" >&2; exit 2; }

# ── target selection ───────────────────────────────────────
if [ -n "${BOOKCLAW_SMOKE_BASE:-}" ]; then
  BASE="$BOOKCLAW_SMOKE_BASE"
  TOKEN="${BOOKCLAW_SMOKE_TOKEN:-}"
  [ -n "$TOKEN" ] || { echo "ERROR: BOOKCLAW_SMOKE_BASE set without BOOKCLAW_SMOKE_TOKEN" >&2; exit 2; }
  MODE="remote"
  log "BookClaw View Book smoke — REMOTE target ${BASE}"
  curl -s -o /dev/null --max-time 10 "$BASE/" || { echo "ERROR: ${BASE} is not reachable" >&2; exit 2; }
else
  HOST=127.0.0.1
  PORT="${PORT:-3893}"
  BASE="http://${HOST}:${PORT}"
  TOKEN="view-book-smoke-token-0123456789"
  MODE="local"
  log "BookClaw View Book smoke — LOCAL gateway on ${BASE}"
  if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
    echo "ERROR: something is already listening on ${BASE} — stop it first." >&2; exit 2
  fi
  env BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" BOOKCLAW_CHAT_PORT="$((PORT + 1))" \
      BOOKCLAW_AUTH_TOKEN="$TOKEN" \
      node --import tsx "$ROOT/gateway/src/index.ts" > "$LOG" 2>&1 &
  SRV=$!
  ready=0
  for _ in $(seq 1 60); do
    curl -s -o /dev/null --max-time 2 "$BASE/" && { ready=1; break; }
    kill -0 "$SRV" 2>/dev/null || { echo "ERROR: server exited during startup" >&2; cat "$LOG"; exit 2; }
    sleep 0.5
  done
  [ "$ready" -eq 1 ] || { echo "ERROR: server did not become ready" >&2; cat "$LOG"; exit 2; }
fi

AUTH=(-H "Authorization: Bearer $TOKEN")

# code <curl-args...>            : HTTP status only
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$@"; }
# get  <path>                    : authenticated GET body
get()  { curl -s --max-time 30 "${AUTH[@]}" "$BASE$1"; }
# gcode <path>                   : authenticated GET status
gcode(){ code "${AUTH[@]}" "$BASE$1"; }

# ══ Phase 1: the surface is mounted and behind auth ════════
log ""
log "Phase 1: mount + auth"

[ "$(code --max-time 30 "$BASE/api/books/any-book/contents")" = "401" ] \
  && pass "contents without a token -> 401" \
  || fail "contents without a token must be 401 (auth gate sits in front of routing)"

[ "$(code --max-time 30 -X POST "$BASE/api/books/any-book/compile")" = "401" ] \
  && pass "compile without a token -> 401" \
  || fail "compile without a token must be 401"

st=$(gcode "/api/books/definitely-not-a-real-book-xyz/contents")
[ "$st" = "404" ] \
  && pass "unknown book -> 404" \
  || fail "unknown book should be 404, got $st"

st=$(gcode "/api/books/..%2F..%2Fetc/contents")
[ "$st" = "400" ] || [ "$st" = "404" ] \
  && pass "path-traversal slug rejected ($st)" \
  || fail "traversal slug must be rejected, got $st"

# ── pick a book that actually has written chapters ─────────
# A book past the writing phase that reports ZERO written chapters is a BUG,
# not an empty target — that is exactly how the chain-resolution defect hid
# (a launch-phase book showed "0 of 32 written" because the frontier project
# holds no chapter steps). Fail on it instead of skipping into a green run.
BOOKLIST=$(get "/api/books" | jq -r '.books[]? | "\(.slug)\t\(.phase)"' 2>/dev/null)
SLUG=""
while IFS=$'\t' read -r b phase; do
  [ -n "$b" ] || continue
  n=$(get "/api/books/$b/contents" | jq '[.groups[]? | select(.id=="manuscript") | .items[]? | select(.ready)] | length' 2>/dev/null || echo 0)
  case "$phase" in
    revision|assembly|launch)
      [ "${n:-0}" -gt 0 ] \
        && pass "book past writing ('$b', $phase) reports $n written chapters" \
        || fail "'$b' is in '$phase' but View Book reports 0 written chapters — chain resolution is broken"
      ;;
  esac
  if [ -z "$SLUG" ] && [ "${n:-0}" -gt 0 ]; then SLUG="$b"; CH_COUNT="$n"; fi
done <<< "$BOOKLIST"

if [ -z "$SLUG" ]; then
  log ""
  skip "no book on this target has written chapters — content phases skipped"
  log ""
  log "── result ──"
  [ "$FAILED" -eq 0 ] && { log "PASS (content phases skipped)"; exit 0; } || { log "FAIL"; exit 1; }
fi
log ""
log "Using book '${SLUG}' (${CH_COUNT} written chapters)"

# ══ Phase 2: contents tree ═════════════════════════════════
log ""
log "Phase 2: contents tree"
CONTENTS=$(get "/api/books/$SLUG/contents")

ids=$(echo "$CONTENTS" | jq -r '[.groups[].id] | join(",")')
[ "$ids" = "front,manuscript,back,reference,launch" ] \
  && pass "five groups in reading order" \
  || fail "group order should be front,manuscript,back,reference,launch — got: $ids"

echo "$CONTENTS" | jq -e '.run | has("status") and has("frontier") and has("total")' >/dev/null \
  && pass "run state present (status/frontier/total)" \
  || fail "run state missing required keys"

echo "$CONTENTS" | jq -e '[.groups[].items[] | select((.id|type)!="string" or (.kind|type)!="string" or (.ready|type)!="boolean")] | length == 0' >/dev/null \
  && pass "every item has id/kind/ready of the right type" \
  || fail "an item is missing id/kind/ready"

echo "$CONTENTS" | jq -e '[.groups[].items[] | select(.ready==false) | select(.producedBy.skill == null)] | length == 0' >/dev/null \
  && pass "every ghost item names the skill that produces it" \
  || fail "a not-generated item has no producedBy.skill"

echo "$CONTENTS" | jq -e '[.groups[] | select(.id=="manuscript") | .items[] | select(.ready) | select((.versions|length) == 0)] | length == 0' >/dev/null \
  && pass "written chapters carry a version trail" \
  || fail "a written chapter has an empty versions array"

echo "$CONTENTS" | jq -e '[.groups[].items[] | select(.ready) | select([.versions[]|select(.latest)]|length > 1)] | length == 0' >/dev/null \
  && pass "no item has more than one latest version" \
  || fail "an item marks multiple versions latest"

# the chapter we will read/round-trip: the last written one
ITEM=$(echo "$CONTENTS" | jq -r '[.groups[] | select(.id=="manuscript") | .items[] | select(.ready)] | last | .id')
LATEST_V=$(echo "$CONTENTS" | jq -r --arg i "$ITEM" '[.groups[].items[] | select(.id==$i)][0].versions[] | select(.latest) | .id')
PRIOR_V=$(echo "$CONTENTS" | jq -r --arg i "$ITEM" '[.groups[].items[] | select(.id==$i)][0].versions[] | select(.latest|not) | .id' | head -1)

# ══ Phase 3: reading an item ═══════════════════════════════
log ""
log "Phase 3: item bodies"
ENC_ITEM=$(printf '%s' "$ITEM" | jq -sRr @uri)

get "/api/books/$SLUG/items/$ENC_ITEM" > "$BODY_FILE"
jq -e '(.body|length) > 200' "$BODY_FILE" >/dev/null \
  && pass "latest chapter body is real prose (>200 chars)" \
  || fail "latest chapter body is missing or too short"

jq -e '.item.id != null and .version.latest == true' "$BODY_FILE" >/dev/null \
  && pass "latest read reports the latest version" \
  || fail "latest read did not report version.latest"

st=$(gcode "/api/books/$SLUG/items/chapter%3A99999")
[ "$st" = "404" ] \
  && pass "unknown item id -> 404" \
  || fail "unknown item should be 404, got $st"

if [ -n "$PRIOR_V" ] && [ "$PRIOR_V" != "null" ]; then
  prior=$(get "/api/books/$SLUG/items/$ENC_ITEM?version=$PRIOR_V")
  echo "$prior" | jq -e '.editable == false' >/dev/null \
    && pass "earlier version reads back editable:false" \
    || fail "earlier version must not be editable"
else
  skip "chapter has only one version — earlier-version read skipped"
fi

# ══ Phase 4: save routing ══════════════════════════════════
log ""
log "Phase 4: save routing"

if [ -n "$PRIOR_V" ] && [ "$PRIOR_V" != "null" ]; then
  jq -n --arg b "x" --arg v "$PRIOR_V" '{body:$b, versionId:$v}' > "$PUT_FILE"
  st=$(code "${AUTH[@]}" -X PUT -H 'Content-Type: application/json' --data @"$PUT_FILE" \
       "$BASE/api/books/$SLUG/items/$ENC_ITEM")
  [ "$st" = "409" ] \
    && pass "PUT on an earlier version -> 409" \
    || fail "PUT on an earlier version must be 409, got $st"
else
  skip "no earlier version to test the read-only refusal against"
fi

if [ "$NO_WRITE" -eq 1 ]; then
  skip "--no-write: identical-body round trip skipped"
else
  # Byte-identical round trip: PUT exactly what we read, then assert unchanged.
  jq -n --slurpfile d "$BODY_FILE" --arg v "$LATEST_V" '{body:$d[0].body, versionId:$v}' > "$PUT_FILE"
  st=$(code "${AUTH[@]}" -X PUT -H 'Content-Type: application/json' --data @"$PUT_FILE" \
       "$BASE/api/books/$SLUG/items/$ENC_ITEM")
  if [ "$st" = "200" ]; then
    pass "PUT identical body to the latest version -> 200"
    after=$(get "/api/books/$SLUG/items/$ENC_ITEM" | jq -r '.body')
    before=$(jq -r '.body' "$BODY_FILE")
    [ "$after" = "$before" ] \
      && pass "round trip left the chapter byte-identical" \
      || fail "round trip CHANGED the chapter text — save path is lossy"
  elif [ "$st" = "409" ]; then
    # Legitimate when the book is mid-drive or sitting at a gate on this chapter.
    skip "PUT refused with 409 (chapter is gated or the pipeline is driving)"
  else
    fail "PUT of an identical body should be 200 or 409, got $st"
  fi
fi

# ══ Phase 5: compile ═══════════════════════════════════════
log ""
log "Phase 5: compile"
COMPILE=$(curl -s --max-time 120 "${AUTH[@]}" -X POST "$BASE/api/books/$SLUG/compile")

chapters=$(echo "$COMPILE" | jq -r '.chapters // 0')
# THE regression this feature exists to prevent: assembly used to match only
# write/polish labels and returned 0 chapters for deterministic pipelines.
[ "${chapters:-0}" -gt 0 ] \
  && pass "compile assembled ${chapters} chapters (not 0)" \
  || fail "compile returned ${chapters} chapters — the assembly regex regression is back"

[ "${chapters:-0}" = "$CH_COUNT" ] \
  && pass "compiled chapter count matches the contents tree (${CH_COUNT})" \
  || fail "compile got ${chapters} chapters but contents lists ${CH_COUNT}"

echo "$COMPILE" | jq -e '(.words // 0) > 1000' >/dev/null \
  && pass "compiled manuscript has a believable word count" \
  || fail "compiled word count is implausibly small"

AFTER=$(get "/api/books/$SLUG/contents")
echo "$AFTER" | jq -e '[.groups[] | select(.id=="reference") | .items[] | select(.derived==true)] | length > 0' >/dev/null \
  && pass "compiled output appears as a derived Reference item" \
  || fail "compiled output is not listed as a derived item"

DERIVED=$(echo "$AFTER" | jq -r '[.groups[] | select(.id=="reference") | .items[] | select(.derived==true)][0].id')
if [ -n "$DERIVED" ] && [ "$DERIVED" != "null" ]; then
  ENC_D=$(printf '%s' "$DERIVED" | jq -sRr @uri)
  get "/api/books/$SLUG/items/$ENC_D" | jq -e '.editable == false' >/dev/null \
    && pass "compiled item reads back editable:false" \
    || fail "compiled item must not be editable"

  dv=$(get "/api/books/$SLUG/items/$ENC_D" | jq -r '.version.id')
  jq -n --arg b "tampered" --arg v "$dv" '{body:$b, versionId:$v}' > "$PUT_FILE"
  st=$(code "${AUTH[@]}" -X PUT -H 'Content-Type: application/json' --data @"$PUT_FILE" \
       "$BASE/api/books/$SLUG/items/$ENC_D")
  [ "$st" = "409" ] \
    && pass "PUT on the compiled item -> 409" \
    || fail "PUT on derived output must be 409, got $st"
fi

# ══ result ═════════════════════════════════════════════════
log ""
log "── result ──"
if [ "$FAILED" -eq 0 ]; then
  [ "$SKIPPED" -eq 1 ] && log "PASS (with skips) — ${MODE} target" || log "PASS — ${MODE} target"
  exit 0
fi
log "FAIL — ${MODE} target"
exit 1
