#!/usr/bin/env bash
#
# BookClaw workspace version-gate smoke
# ─────────────────────────────────────
# Verifies the boot-time workspace compatibility gate (owner roadmap: versioning
# breaking-change gate). Drives the real gateway against a temporarily-mutated
# workspace marker and asserts:
#   1. An incompatible (too-new) marker HALTS boot — non-zero exit + a FATAL log.
#   2. BOOKCLAW_SKIP_VERSION_GATE=1 overrides it — boot continues past the gate
#      with a loud warning (the conscious human consent).
#   3. A compatible marker proceeds normally (the ℹ schema line).
#
# The gate runs in Phase 1 (before HTTP/vault), so each case is decided from the
# early boot log — no full startup needed.
#
# Hermetic-ish: backs up the real workspace.json marker and restores it on exit
# (trap), so an interrupted run leaves the marker as it was.
#
# Usage: tests/version-gate-smoke.sh [-v]
# Exit:  0 = all checks passed, 1 = a check failed, 2 = preflight error.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKER_DIR="$ROOT_DIR/workspace/.bookclaw"
MARKER="$MARKER_DIR/workspace.json"
BACKUP="$(mktemp)"
HAD_MARKER=0

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

FAILED=0
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*"; FAILED=1; }

restore_marker() {
  if [ "$HAD_MARKER" -eq 1 ]; then
    cp "$BACKUP" "$MARKER"
  else
    rm -f "$MARKER"
  fi
  rm -f "$BACKUP"
}
trap restore_marker EXIT

# Preflight: capture the current marker so we can restore it.
mkdir -p "$MARKER_DIR" || { echo "preflight: cannot create $MARKER_DIR" >&2; exit 2; }
if [ -f "$MARKER" ]; then HAD_MARKER=1; cp "$MARKER" "$BACKUP"; fi

write_marker() { printf '{\n  "schemaVersion": %s,\n  "createdByApp": "smoke"\n}\n' "$1" > "$MARKER"; }

# boot_gate <extra-env=val...> : boot the gateway, wait until it either exits or
# prints the Phase-2 security banner (proof it passed the Phase-1 gate), then
# stop it. Echoes the captured log path via $LAST_LOG and the exit status via
# $LAST_EXIT (-1 if it was still running and we killed it).
LAST_LOG=""
LAST_EXIT=0
boot_gate() {
  local logf; logf="$(mktemp)"
  env BOOKCLAW_BIND=127.0.0.1 BOOKCLAW_PORT=3997 BOOKCLAW_CHAT_PORT=3998 \
      BOOKCLAW_AUTH_DISABLED=1 "$@" \
      node --import tsx "$ROOT_DIR/gateway/src/index.ts" > "$logf" 2>&1 &
  local pid=$!
  local waited=0
  LAST_EXIT=-1
  while [ "$waited" -lt 200 ]; do        # up to ~20s
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"; LAST_EXIT=$?
      break
    fi
    # Passed the Phase-1 gate once Phase 2 (security) starts logging.
    if grep -qE 'Phase 2|Security|Vault' "$logf" 2>/dev/null; then
      kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
      LAST_EXIT=-1
      break
    fi
    sleep 0.1; waited=$((waited + 1))
  done
  kill "$pid" 2>/dev/null
  LAST_LOG="$logf"
}

echo "Phase 1: incompatible (too-new) marker halts boot"
write_marker 999
boot_gate
if [ "$LAST_EXIT" -gt 0 ]; then pass "boot exited non-zero ($LAST_EXIT)"; else fail "boot did not exit (status $LAST_EXIT)"; fi
if grep -q 'FATAL' "$LAST_LOG"; then pass "FATAL message printed"; else fail "no FATAL message"; fi
if grep -q 'Refusing to start' "$LAST_LOG"; then pass "fatal message explains the refusal"; else fail "fatal message missing 'Refusing to start'"; fi
[ "$VERBOSE" -eq 1 ] && { echo "── log ──"; cat "$LAST_LOG"; }
rm -f "$LAST_LOG"

echo "Phase 2: override continues past the gate (unsafe)"
write_marker 999
boot_gate BOOKCLAW_SKIP_VERSION_GATE=1
if grep -qiE 'starting anyway \(unsafe\)' "$LAST_LOG"; then pass "override warning printed"; else fail "no override warning"; fi
if [ "$LAST_EXIT" -eq -1 ]; then pass "boot continued past the gate (not halted)"; else fail "boot halted despite override (status $LAST_EXIT)"; fi
[ "$VERBOSE" -eq 1 ] && { echo "── log ──"; cat "$LAST_LOG"; }
rm -f "$LAST_LOG"

echo "Phase 3: compatible marker proceeds normally"
write_marker 1
boot_gate
if [ "$LAST_EXIT" -eq -1 ]; then pass "boot continued past the gate"; else fail "boot halted on a compatible marker (status $LAST_EXIT)"; fi
if grep -q 'Workspace schema v1' "$LAST_LOG"; then pass "compatible schema line printed"; else fail "no compatible schema line"; fi
[ "$VERBOSE" -eq 1 ] && { echo "── log ──"; cat "$LAST_LOG"; }
rm -f "$LAST_LOG"

echo ""
if [ "$FAILED" -eq 0 ]; then echo "All version-gate checks passed."; else echo "Some checks FAILED."; fi
exit "$FAILED"
