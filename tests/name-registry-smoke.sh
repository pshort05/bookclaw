#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Character Name Registry smoke test
# ═══════════════════════════════════════════════════════════
# Validates that a DEPLOYED gateway has the Character Name Registry feature
# wired, using ONLY read-only / no-AI-cost calls. It creates NO books (book
# creation auto-executes a pipeline and would spend money) and writes NO
# registry data, so it is cheap and safe to run against a live instance.
#
# What it asserts (all server-side, work local OR remote):
#   1. Gateway healthy — GET /api/status → 200 with the bearer token. This also
#      proves the new registry module (services/registry/*) loaded at boot
#      without crashing the process.
#   2. The registry endpoints are MOUNTED and behave in a DEFINED way:
#        a. GET /api/books/:slug/registry for a clearly-nonexistent (but
#           well-formed) slug → 404 "Book not found" — NOT a 500 and NOT an
#           unmounted-route 404-with-HTML. This proves the route exists and its
#           unknown-book path is defined.
#        b. If a real book slug is discoverable via the read-only GET /api/books
#           list, GET /api/books/<real>/registry → 200 with a well-formed
#           registry object: JSON containing `characters` and `locations`
#           ARRAYS (the fail-soft loadRegistry() shape). Skipped (not failed) if
#           the target has no books.
#        c. POST /api/books/.../registry/decide is mounted and rejected WITHOUT
#           mutating: against a real book (if any) an empty body → 400
#           "name is required" (the validation guard fires); otherwise a
#           nonexistent slug → 404 "Book not found". Either way a defined 4xx,
#           and nothing is written.
#
# Additional ON-DISK checks (LOCAL mode only — skipped when targeting a remote
# BASE_URL, since the remote box's on-disk tree isn't ours to read): the
# registry module source files exist
# (gateway/src/services/registry/{store,parse-manifest,remnant-sweep,roster,enforce}.ts)
# and the manifest sentinel string `BOOKCLAW:MANIFEST` appears in parse-manifest.ts.
#
# ── Modes ──────────────────────────────────────────────────
# DEFAULT (local): boots its own gateway on a loopback, non-default port with a
#   known token, polls /api/status, runs server-side + on-disk checks, then
#   kills the server on exit.
#
# REMOTE: if BOTH env BASE_URL and BOOKCLAW_AUTH_TOKEN are set, the local boot
#   is skipped and those checks run against that URL+token instead (validates a
#   deploy, e.g. Mercury). On-disk checks are skipped in this mode. Example:
#     BASE_URL=http://192.168.1.32:3847 BOOKCLAW_AUTH_TOKEN=xxxx \
#       tests/name-registry-smoke.sh
#
# Hermetic + non-destructive: creates NO resources (no book → no auto-pipeline
# spend), writes NO registry data, binds loopback only in local mode, and
# leaves no stray process.
#
# Usage:  tests/name-registry-smoke.sh [-v]  (-v: stream server log on failure, local mode)
# Exit: 0 = all checks passed, 1 = a check failed, 2 = preflight/startup error.
set -uo pipefail

VERBOSE=0; [[ "${1:-}" == "-v" ]] && VERBOSE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0
SRV=""
LOG="$(mktemp)"

# Remote mode iff BASE_URL and BOOKCLAW_AUTH_TOKEN are BOTH provided.
REMOTE=0
if [[ -n "${BASE_URL:-}" && -n "${BOOKCLAW_AUTH_TOKEN:-}" ]]; then
  REMOTE=1
  BASE="${BASE_URL%/}"
  TOKEN="$BOOKCLAW_AUTH_TOKEN"
else
  HOST=127.0.0.1
  PORT="${PORT:-3885}"
  BASE="http://${HOST}:${PORT}"
  TOKEN="name-registry-smoke-token"
fi

# A well-formed (SLUG_RE-passing) slug that will not exist on any target.
MISSING_SLUG="nope-no-such-book-0000zzz"

pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

cleanup() {
  [[ -n "$SRV" ]] && kill "$SRV" 2>/dev/null
  if [[ "$REMOTE" == 0 ]] && { [[ "$VERBOSE" == 1 ]] || [[ "$FAILED" != 0 ]]; }; then
    echo '--- server log ---'; cat "$LOG"
  fi
  rm -f "$LOG"
}
trap cleanup EXIT

H=(-H "Authorization: Bearer $TOKEN")

# ── Boot local gateway (skipped in remote mode) ────────────────────────────
if [[ "$REMOTE" == 0 ]]; then
  if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
    echo "ERROR: something is already listening on ${BASE} — stop it before running this smoke." >&2
    exit 2
  fi
  BOOKCLAW_AUTH_TOKEN="$TOKEN" BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" \
    BOOKCLAW_CHAT_PORT="$((PORT + 1))" \
    node --import tsx "$ROOT/gateway/src/index.ts" >"$LOG" 2>&1 &
  SRV=$!
  for i in $(seq 1 60); do
    curl -sf "$BASE/api/status" "${H[@]}" >/dev/null 2>&1 && break
    kill -0 "$SRV" 2>/dev/null || { echo "ERROR: server exited during startup" >&2; exit 2; }
    sleep 0.5
  done
fi

# ── Check 1 (server-side): gateway healthy (registry module loaded at boot) ─
echo "Server-side checks (target: $BASE)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${H[@]}" "$BASE/api/status")
if [[ "$CODE" == "200" ]]; then
  pass "GET /api/status → 200 (gateway healthy; registry module loaded at boot)"
else
  fail "GET /api/status → $CODE (expected 200)"
  echo "ERROR: gateway not reachable/authenticated — aborting." >&2
  exit 2
fi

# ── Check 2a: unknown slug → defined 404 (route mounted, not 500) ──────────
BODY=$(curl -s -w '\n%{http_code}' --max-time 10 "${H[@]}" "$BASE/api/books/$MISSING_SLUG/registry")
CODE=$(printf '%s' "$BODY" | tail -n1)
BODY=$(printf '%s' "$BODY" | sed '$d')
if [[ "$CODE" == "404" ]] && printf '%s' "$BODY" | grep -qi "not found"; then
  pass "GET /api/books/<missing>/registry → 404 JSON 'Book not found' (route mounted, unknown-book path defined)"
elif [[ "$CODE" == "500" ]]; then
  fail "GET /api/books/<missing>/registry → 500 (registry handler crashed)"
elif [[ "$CODE" == "404" ]]; then
  fail "GET /api/books/<missing>/registry → 404 but body isn't the JSON 'Book not found' (looks unmounted): $BODY"
else
  fail "GET /api/books/<missing>/registry → $CODE (expected a defined 404)"
fi

# ── Discover a real book slug (read-only) for the happy-path checks ─────────
REAL_SLUG=$(curl -s --max-time 10 "${H[@]}" "$BASE/api/books" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    let j; try{ j=JSON.parse(s) }catch(e){ return }
    const books = j && Array.isArray(j.books) ? j.books : [];
    const first = books.find(b=> b && typeof b.slug==="string" && b.slug);
    if(first) process.stdout.write(first.slug);
  })' 2>/dev/null)

# ── Check 2b: real book registry → 200 well-formed {characters[],locations[]}
if [[ -n "$REAL_SLUG" ]]; then
  BODY=$(curl -s -w '\n%{http_code}' --max-time 10 "${H[@]}" "$BASE/api/books/$REAL_SLUG/registry")
  CODE=$(printf '%s' "$BODY" | tail -n1)
  BODY=$(printf '%s' "$BODY" | sed '$d')
  if [[ "$CODE" != "200" ]]; then
    fail "GET /api/books/$REAL_SLUG/registry → $CODE (expected 200)"
  else
    SHAPE=$(printf '%s' "$BODY" | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        let j; try{ j=JSON.parse(s) }catch(e){ console.log("ERRparse"); return }
        console.log((Array.isArray(j.characters)&&Array.isArray(j.locations))?"ok":"bad");
      })' 2>/dev/null)
    if [[ "$SHAPE" == "ok" ]]; then
      pass "GET /api/books/$REAL_SLUG/registry → 200 with characters[] + locations[] (well-formed registry)"
    else
      fail "GET /api/books/$REAL_SLUG/registry → 200 but missing characters[]/locations[] arrays ($SHAPE)"
    fi
  fi
else
  echo "  [SKIP] no book on target — happy-path GET registry shape not exercised"
fi

# ── Check 2c: decide endpoint mounted + rejected WITHOUT mutating ──────────
if [[ -n "$REAL_SLUG" ]]; then
  # Real book + empty body → the validation guard must fire (400, no write).
  BODY=$(curl -s -w '\n%{http_code}' --max-time 10 "${H[@]}" \
    -H 'Content-Type: application/json' -d '{}' \
    "$BASE/api/books/$REAL_SLUG/registry/decide")
  CODE=$(printf '%s' "$BODY" | tail -n1)
  BODY=$(printf '%s' "$BODY" | sed '$d')
  if [[ "$CODE" == "400" ]] && printf '%s' "$BODY" | grep -qi "name is required"; then
    pass "POST /api/books/$REAL_SLUG/registry/decide {} → 400 'name is required' (guard fires, no write)"
  else
    fail "POST decide with empty body → $CODE (expected 400 'name is required'): $BODY"
  fi
else
  # No book: nonexistent slug still proves the route is mounted (404, no write).
  BODY=$(curl -s -w '\n%{http_code}' --max-time 10 "${H[@]}" \
    -H 'Content-Type: application/json' -d '{}' \
    "$BASE/api/books/$MISSING_SLUG/registry/decide")
  CODE=$(printf '%s' "$BODY" | tail -n1)
  BODY=$(printf '%s' "$BODY" | sed '$d')
  if [[ "$CODE" == "404" ]] && printf '%s' "$BODY" | grep -qi "not found"; then
    pass "POST /api/books/<missing>/registry/decide → 404 'Book not found' (route mounted, no write)"
  else
    fail "POST decide on missing slug → $CODE (expected a defined 404): $BODY"
  fi
fi

# ── On-disk checks (LOCAL mode only) ───────────────────────────────────────
if [[ "$REMOTE" == 1 ]]; then
  echo "On-disk checks: SKIPPED (remote BASE_URL target — not our tree to read)"
else
  echo "On-disk checks (registry module source)"
  REG_DIR="$ROOT/gateway/src/services/registry"
  for f in store parse-manifest remnant-sweep roster enforce; do
    if [[ -f "$REG_DIR/$f.ts" ]]; then
      pass "on-disk: gateway/src/services/registry/$f.ts present"
    else
      fail "on-disk: gateway/src/services/registry/$f.ts MISSING"
    fi
  done
  if grep -q "BOOKCLAW:MANIFEST" "$REG_DIR/parse-manifest.ts" 2>/dev/null; then
    pass "on-disk: manifest sentinel 'BOOKCLAW:MANIFEST' found in parse-manifest.ts"
  else
    fail "on-disk: manifest sentinel 'BOOKCLAW:MANIFEST' NOT found in parse-manifest.ts"
  fi
fi

echo ""
if [[ "$FAILED" == 0 ]]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "SOME CHECKS FAILED"
  exit 1
fi
