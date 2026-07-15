#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Canon Drift Gate smoke test
# ═══════════════════════════════════════════════════════════
# Validates that a DEPLOYED gateway has the Canon Drift Gate feature wired,
# using ONLY read-only / no-AI-cost calls. It never creates a book (book
# creation auto-executes a pipeline and would spend money), so it is cheap
# and safe to run against a live instance.
#
# What it asserts (all server-side, work local OR remote):
#   1. Gateway healthy         — GET /api/status → 200 with the bearer token.
#   2. Deterministic pipelines reordered + gated (server-side, via the
#      read-only GET /api/library/pipeline/<name> endpoint, which returns the
#      parsed pipeline incl. its ordered `steps`). For BOTH
#      romance-sweet-deterministic and romance-spicy-deterministic:
#        - the "Setting" bible step comes BEFORE the "Character Bible" step
#        - exactly two canon-drift-apply gate steps are present
#        - the romance-canon-audit skill is referenced by a step
#   3. Canon-audit skill registered — GET /api/skills/romance-canon-audit → 200.
#
# Additional ON-DISK checks (LOCAL mode only — skipped when targeting a remote
# BASE_URL, since the remote box's on-disk tree isn't ours to read): the same
# ordering + gate-presence assertions run directly against the versioned
# library/pipelines/*.json files.
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
#       tests/canon-drift-smoke.sh
#
# Hermetic + non-destructive: creates NO resources (no book → no auto-pipeline
# spend), binds loopback only in local mode, and leaves no stray process.
#
# Usage:  tests/canon-drift-smoke.sh [-v]     (-v: stream server log on failure, local mode)
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
  PORT="${PORT:-3881}"
  BASE="http://${HOST}:${PORT}"
  TOKEN="canon-drift-smoke-token"
fi

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

# ── Check 1 (server-side): gateway healthy ─────────────────────────────────
echo "Server-side checks (target: $BASE)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${H[@]}" "$BASE/api/status")
if [[ "$CODE" == "200" ]]; then
  pass "GET /api/status → 200 (gateway healthy, auth accepted)"
else
  fail "GET /api/status → $CODE (expected 200)"
  echo "ERROR: gateway not reachable/authenticated — aborting." >&2
  exit 2
fi

# assert_pipeline <pipeline-name>: fetch it read-only and assert step order + gates.
# Extracts "settingIdx charIdx applyCount auditCount httpish" from the JSON body.
assert_pipeline() {
  local name="$1"
  local body code
  body=$(curl -s -w '\n%{http_code}' --max-time 15 "${H[@]}" "$BASE/api/library/pipeline/$name")
  code=$(printf '%s' "$body" | tail -n1)
  body=$(printf '%s' "$body" | sed '$d')
  if [[ "$code" != "200" ]]; then
    fail "GET /api/library/pipeline/$name → $code (expected 200)"; return
  fi
  # Parse the ordered top-level steps out of entry.pipeline.steps.
  local out
  out=$(printf '%s' "$body" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let j; try{ j=JSON.parse(s) }catch(e){ console.log("ERR parse"); return }
      const steps = j && j.entry && j.entry.pipeline && j.entry.pipeline.steps;
      if(!Array.isArray(steps)){ console.log("ERR nosteps"); return }
      const idxByLabel = (lbl)=> steps.findIndex(x=> x && x.label===lbl);
      const cnt = (skill)=> steps.filter(x=> x && x.skill===skill).length;
      console.log([idxByLabel("Setting"), idxByLabel("Character Bible"), cnt("canon-drift-apply"), cnt("romance-canon-audit")].join(" "));
    })')
  if [[ "$out" == ERR* || -z "$out" ]]; then
    fail "$name: could not read entry.pipeline.steps ($out)"; return
  fi
  read -r SET_I CHAR_I APPLY_N AUDIT_N <<<"$out"
  if [[ "$SET_I" -ge 0 && "$CHAR_I" -ge 0 && "$SET_I" -lt "$CHAR_I" ]]; then
    pass "$name: Setting step (idx $SET_I) precedes Character Bible (idx $CHAR_I)"
  else
    fail "$name: Setting/Character order wrong (Setting=$SET_I Character=$CHAR_I)"
  fi
  if [[ "$APPLY_N" == 2 ]]; then
    pass "$name: two canon-drift-apply gate steps present"
  else
    fail "$name: expected 2 canon-drift-apply gate steps, found $APPLY_N"
  fi
  if [[ "$AUDIT_N" -ge 1 ]]; then
    pass "$name: romance-canon-audit skill referenced ($AUDIT_N step(s))"
  else
    fail "$name: no step references the romance-canon-audit skill"
  fi
}

# ── Check 2 (server-side): deterministic pipelines reordered + gated ───────
assert_pipeline romance-sweet-deterministic
assert_pipeline romance-spicy-deterministic

# ── Check 3 (server-side): canon-audit skill registered ────────────────────
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${H[@]}" "$BASE/api/skills/romance-canon-audit")
if [[ "$CODE" == "200" ]]; then
  pass "GET /api/skills/romance-canon-audit → 200 (skill registered server-side)"
else
  fail "GET /api/skills/romance-canon-audit → $CODE (expected 200)"
fi

# ── On-disk checks (LOCAL mode only) ───────────────────────────────────────
if [[ "$REMOTE" == 1 ]]; then
  echo "On-disk checks: SKIPPED (remote BASE_URL target — not our tree to read)"
else
  echo "On-disk checks (versioned library/pipelines/*.json)"
  check_ondisk() {
    local name="$1" file="$ROOT/library/pipelines/$1.json"
    if [[ ! -f "$file" ]]; then fail "on-disk: $file missing"; return; fi
    local out
    out=$(node -e '
      const p=require(process.argv[1]);
      const steps=Array.isArray(p.steps)?p.steps:[];
      const idx=(l)=>steps.findIndex(x=>x&&x.label===l);
      const cnt=(s)=>steps.filter(x=>x&&x.skill===s).length;
      console.log([idx("Setting"),idx("Character Bible"),cnt("canon-drift-apply")].join(" "));
    ' "$file")
    read -r SET_I CHAR_I APPLY_N <<<"$out"
    if [[ "$SET_I" -ge 0 && "$CHAR_I" -ge 0 && "$SET_I" -lt "$CHAR_I" ]]; then
      pass "on-disk $name: Setting (idx $SET_I) precedes Character Bible (idx $CHAR_I)"
    else
      fail "on-disk $name: Setting/Character order wrong (Setting=$SET_I Character=$CHAR_I)"
    fi
    if [[ "$APPLY_N" == 2 ]]; then
      pass "on-disk $name: two canon-drift-apply gate steps present"
    else
      fail "on-disk $name: expected 2 canon-drift-apply gate steps, found $APPLY_N"
    fi
  }
  check_ondisk romance-sweet-deterministic
  check_ondisk romance-spicy-deterministic
fi

echo ""
if [[ "$FAILED" == 0 ]]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "SOME CHECKS FAILED"
  exit 1
fi
