#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Mobile responsive shell smoke test
# ═══════════════════════════════════════════════════════════
# Validates that the SERVED v6 studio bundle carries the responsive mobile shell
# (Mobile Phase 1: collapse the desktop two-column grid + hamburger drawer),
# using ONLY read-only / no-AI-cost calls. It creates no book, spends nothing.
#
# What it asserts (all server-side — fetched from the SERVED bundle, work local
# OR remote):
#   1. Dashboard healthy      — GET / → 200 (studio HTML served).
#   2. From that HTML, extract the hashed asset URLs (/assets/index-*.css and
#      /assets/index-*.js — robust to the content-hash in each filename), curl
#      each, and assert:
#        - the built CSS carries the mobile breakpoint `@media (max-width: 768px)`
#          (whitespace-tolerant: matches `max-width:\s*768px`),
#        - the mobile `.main` rule `grid-row: 2` survives minification
#          (whitespace-tolerant: matches `grid-row:\s*2`),
#        - the built JS carries the hamburger `Open navigation` aria-label string.
#
# There are NO on-disk checks: the served, hash-named bundle IS the artifact under
# test (the source .module.css/.tsx would just re-assert what the build consumes).
#
# ── Modes ──────────────────────────────────────────────────
# DEFAULT (local): boots its own gateway on a loopback, non-default port with a
#   known token, polls /api/status, fetches / + assets from it, then kills the
#   server on exit. The served bundle is frontend/studio/dist — if that dist is
#   not built, the script builds it once (npm run -w frontend/studio build); if
#   the build is unavailable and the dist is still absent, it SKIPs (exit 0) with
#   a notice rather than failing spuriously.
#
# REMOTE: if BOTH env BASE_URL and BOOKCLAW_AUTH_TOKEN are set, the local boot is
#   skipped and the checks run against that deployed bundle instead (validates a
#   deploy, e.g. Mercury/Neptune). No dist/build concerns in this mode. Example:
#     BASE_URL=http://192.168.1.32:3847 BOOKCLAW_AUTH_TOKEN=xxxx \
#       tests/mobile-shell-smoke.sh
#
# Hermetic + non-destructive: creates NO resources, binds loopback only in local
# mode, and leaves no stray process.
#
# Usage:  tests/mobile-shell-smoke.sh [-v]   (-v: stream server log on failure, local mode)
# Exit: 0 = all checks passed (or SKIPPED), 1 = a check failed, 2 = preflight/startup error.
set -uo pipefail

VERBOSE=0; [[ "${1:-}" == "-v" ]] && VERBOSE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAILED=0
SRV=""
LOG="$(mktemp)"
CSS_FILE="$(mktemp)"
JS_FILE="$(mktemp)"

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
  TOKEN="mobile-shell-smoke-token"
fi

pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

cleanup() {
  [[ -n "$SRV" ]] && kill "$SRV" 2>/dev/null
  if [[ "$REMOTE" == 0 ]] && { [[ "$VERBOSE" == 1 ]] || [[ "$FAILED" != 0 ]]; }; then
    echo '--- server log ---'; cat "$LOG"
  fi
  rm -f "$LOG" "$CSS_FILE" "$JS_FILE"
}
trap cleanup EXIT

H=(-H "Authorization: Bearer $TOKEN")

# ── Local mode: ensure the served studio dist exists (build once if missing) ──
if [[ "$REMOTE" == 0 ]]; then
  DIST_HTML="$ROOT/frontend/studio/dist/index.html"
  if [[ ! -f "$DIST_HTML" ]]; then
    echo "ℹ studio dist not built — building it once (npm run -w frontend/studio build)…"
    ( cd "$ROOT" && npm run -w frontend/studio build ) >>"$LOG" 2>&1 || true
  fi
  if [[ ! -f "$DIST_HTML" ]]; then
    echo "SKIP: studio dist absent and could not be built ($DIST_HTML)."
    echo "      Build it with: npm run -w frontend/studio build"
    exit 0
  fi
fi

# ── Boot local gateway (skipped in remote mode) ────────────────────────────
if [[ "$REMOTE" == 0 ]]; then
  if curl -s -o /dev/null --max-time 2 "$BASE/" 2>/dev/null; then
    echo "ERROR: something is already listening on ${BASE} — stop it before running this smoke." >&2
    exit 2
  fi
  BOOKCLAW_AUTH_TOKEN="$TOKEN" BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" \
    BOOKCLAW_CHAT_PORT="$((PORT + 1))" \
    node --import tsx "$ROOT/gateway/src/index.ts" >>"$LOG" 2>&1 &
  SRV=$!
  for i in $(seq 1 60); do
    curl -sf "$BASE/api/status" "${H[@]}" >/dev/null 2>&1 && break
    kill -0 "$SRV" 2>/dev/null || { echo "ERROR: server exited during startup" >&2; exit 2; }
    sleep 0.5
  done
fi

# ── Check 1 (server-side): dashboard healthy, studio HTML served ───────────
echo "Server-side checks (target: $BASE)"
HTML=$(curl -s -w '\n%{http_code}' --max-time 15 "${H[@]}" "$BASE/")
CODE=$(printf '%s' "$HTML" | tail -n1)
HTML=$(printf '%s' "$HTML" | sed '$d')
if [[ "$CODE" == "200" ]]; then
  pass "GET / → 200 (studio HTML served)"
else
  fail "GET / → $CODE (expected 200)"
  echo "ERROR: dashboard not reachable — aborting." >&2
  exit 2
fi

# ── Extract the hashed asset URLs from the served HTML (hash-agnostic) ──────
CSS_URL=$(printf '%s' "$HTML" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.css' | head -n1)
JS_URL=$(printf '%s'  "$HTML" | grep -oE '/assets/index-[A-Za-z0-9_-]+\.js'  | head -n1)

# ── Check 2a (server-side): built CSS carries the mobile shell ─────────────
if [[ -z "$CSS_URL" ]]; then
  fail "could not find /assets/index-*.css URL in served HTML"
else
  CSS_CODE=$(curl -s -o "$CSS_FILE" -w '%{http_code}' --max-time 15 "${H[@]}" "$BASE$CSS_URL")
  if [[ "$CSS_CODE" != "200" ]]; then
    fail "GET $CSS_URL → $CSS_CODE (expected 200)"
  else
    pass "GET $CSS_URL → 200 (built CSS fetched)"
    if grep -Eq 'max-width:[[:space:]]*768px' "$CSS_FILE"; then
      pass "CSS contains the mobile breakpoint (@media max-width: 768px)"
    else
      fail "CSS missing the mobile breakpoint (max-width: 768px)"
    fi
    if grep -Eq 'grid-row:[[:space:]]*2' "$CSS_FILE"; then
      pass "CSS retains the mobile .main rule (grid-row: 2)"
    else
      fail "CSS missing the mobile .main rule (grid-row: 2) — minified away or regressed"
    fi
  fi
fi

# ── Check 2b (server-side): built JS carries the hamburger aria-label ──────
if [[ -z "$JS_URL" ]]; then
  fail "could not find /assets/index-*.js URL in served HTML"
else
  JS_CODE=$(curl -s -o "$JS_FILE" -w '%{http_code}' --max-time 20 "${H[@]}" "$BASE$JS_URL")
  if [[ "$JS_CODE" != "200" ]]; then
    fail "GET $JS_URL → $JS_CODE (expected 200)"
  else
    pass "GET $JS_URL → 200 (built JS fetched)"
    if grep -q 'Open navigation' "$JS_FILE"; then
      pass "JS contains the hamburger aria-label (\"Open navigation\")"
    else
      fail "JS missing the hamburger aria-label (\"Open navigation\")"
    fi
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
