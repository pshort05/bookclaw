#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Chunked Two-Pass De-AI Sweep + Banned-Terms smoke test
# ═══════════════════════════════════════════════════════════
# Validates that a DEPLOYED gateway has the "Chunked Two-Pass De-AI Sweep +
# Banned-Terms Registry" feature wired, using ONLY read-only / no-AI-cost calls.
# It never creates a book (book creation auto-executes a pipeline and would spend
# money), so it is cheap and safe to run against a live instance.
#
# What it asserts (all server-side, work local OR remote):
#   1. Gateway healthy         — GET /api/status → 200 with the bearer token.
#   2. Per-chapter substep ordering (server-side, via the read-only
#      GET /api/library/pipeline/<name> endpoint, descending into the
#      expand:"chapters" step's `steps` array). For BOTH
#      romance-sweet-deterministic and romance-spicy-deterministic:
#        - the deterministic-apply (Consistency Apply) substep PRECEDES the
#          romance-deai-audit (De-AI Sweep) substep
#        - the romance-deai-audit substep is the LAST per-chapter substep
#        - the romance-deai-audit substep has NO modelOverride (per-pass models
#          come from the book's deai_pass1/deai_pass2 stage slots)
#   3. Broadened taxonomy deployed — GET /api/skills/romance-deai-audit → 200 and
#      the returned skill body contains the new categories: the aphoristic-button
#      / sententious additions ("aphoristic") and the generalizing-second-person
#      addition ("second-person").
#
# Additional ON-DISK checks (LOCAL mode only — skipped when targeting a remote
# BASE_URL, since the remote box's on-disk tree isn't ours to read): the same
# substep-ordering assertions run directly against the versioned
# library/pipelines/*-deterministic.json files, and the seed
# library/banned-terms.csv is verified to exist and parse (header + the
# "phone buzzed,phone vibrated" fixed-substitution row + at least one ban-only
# row with a blank replace).
#
# NOTE: the per-book stage-key regex path (deai_pass1/deai_pass2 stage slots) is
# NOT exercised here — checking it would require creating a book (auto-pipeline
# spend). That path is unit-tested; this smoke intentionally skips it.
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
#       tests/deai-sweep-smoke.sh
#
# Hermetic + non-destructive: creates NO resources (no book → no auto-pipeline
# spend), binds loopback only in local mode, and leaves no stray process.
#
# Usage:  tests/deai-sweep-smoke.sh [-v]     (-v: stream server log on failure, local mode)
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
  PORT="${PORT:-3883}"
  BASE="http://${HOST}:${PORT}"
  TOKEN="deai-sweep-smoke-token"
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

# assert_pipeline <pipeline-name>: fetch it read-only and assert per-chapter
# substep ordering inside the expand:"chapters" step. Extracts
# "applyIdx deaiIdx lastIdx deaiOverride" from the JSON body.
assert_pipeline() {
  local name="$1"
  local body code
  body=$(curl -s -w '\n%{http_code}' --max-time 15 "${H[@]}" "$BASE/api/library/pipeline/$name")
  code=$(printf '%s' "$body" | tail -n1)
  body=$(printf '%s' "$body" | sed '$d')
  if [[ "$code" != "200" ]]; then
    fail "GET /api/library/pipeline/$name → $code (expected 200)"; return
  fi
  local out
  out=$(printf '%s' "$body" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      let j; try{ j=JSON.parse(s) }catch(e){ console.log("ERR parse"); return }
      const steps = j && j.entry && j.entry.pipeline && j.entry.pipeline.steps;
      if(!Array.isArray(steps)){ console.log("ERR nosteps"); return }
      const exp = steps.find(x=> x && x.expand==="chapters" && Array.isArray(x.steps));
      if(!exp){ console.log("ERR noexpand"); return }
      const sub = exp.steps;
      const applyIdx = sub.findIndex(x=> x && x.skill==="deterministic-apply");
      const deaiIdx  = sub.findIndex(x=> x && x.skill==="romance-deai-audit");
      const lastIdx  = sub.length - 1;
      const over = (deaiIdx>=0 && sub[deaiIdx].modelOverride) ? "yes" : "no";
      console.log([applyIdx, deaiIdx, lastIdx, over].join(" "));
    })')
  if [[ "$out" == ERR* || -z "$out" ]]; then
    fail "$name: could not read expand:chapters substeps ($out)"; return
  fi
  read -r APPLY_I DEAI_I LAST_I DEAI_OVER <<<"$out"
  if [[ "$APPLY_I" -ge 0 && "$DEAI_I" -ge 0 && "$APPLY_I" -lt "$DEAI_I" ]]; then
    pass "$name: Consistency Apply (idx $APPLY_I) precedes De-AI Sweep (idx $DEAI_I)"
  else
    fail "$name: apply/de-AI order wrong (apply=$APPLY_I deai=$DEAI_I)"
  fi
  if [[ "$DEAI_I" -ge 0 && "$DEAI_I" == "$LAST_I" ]]; then
    pass "$name: De-AI Sweep is the LAST per-chapter substep (idx $DEAI_I of $LAST_I)"
  else
    fail "$name: De-AI Sweep not last per-chapter substep (deai=$DEAI_I last=$LAST_I)"
  fi
  if [[ "$DEAI_OVER" == "no" ]]; then
    pass "$name: De-AI Sweep substep has NO modelOverride (uses deai_pass1/2 stage slots)"
  else
    fail "$name: De-AI Sweep substep unexpectedly carries a modelOverride"
  fi
}

# ── Check 2 (server-side): per-chapter substep ordering ────────────────────
assert_pipeline romance-sweet-deterministic
assert_pipeline romance-spicy-deterministic

# ── Check 3 (server-side): broadened de-AI taxonomy deployed ───────────────
SKILL_BODY=$(curl -s -w '\n%{http_code}' --max-time 10 "${H[@]}" "$BASE/api/skills/romance-deai-audit")
SKILL_CODE=$(printf '%s' "$SKILL_BODY" | tail -n1)
SKILL_BODY=$(printf '%s' "$SKILL_BODY" | sed '$d')
if [[ "$SKILL_CODE" != "200" ]]; then
  fail "GET /api/skills/romance-deai-audit → $SKILL_CODE (expected 200)"
else
  pass "GET /api/skills/romance-deai-audit → 200 (skill registered server-side)"
  if printf '%s' "$SKILL_BODY" | grep -q "aphoristic"; then
    pass "de-AI skill body includes the aphoristic-button/sententious category (\"aphoristic\")"
  else
    fail "de-AI skill body missing the aphoristic-button/sententious category (\"aphoristic\")"
  fi
  if printf '%s' "$SKILL_BODY" | grep -q "second-person"; then
    pass "de-AI skill body includes the generalizing-second-person category (\"second-person\")"
  else
    fail "de-AI skill body missing the generalizing-second-person category (\"second-person\")"
  fi
fi

# ── On-disk checks (LOCAL mode only) ───────────────────────────────────────
if [[ "$REMOTE" == 1 ]]; then
  echo "On-disk checks: SKIPPED (remote BASE_URL target — not our tree to read)"
else
  echo "On-disk checks (versioned library/pipelines + library/banned-terms.csv)"
  check_ondisk() {
    local name="$1" file="$ROOT/library/pipelines/$1.json"
    if [[ ! -f "$file" ]]; then fail "on-disk: $file missing"; return; fi
    local out
    out=$(node -e '(()=>{
      const p=require(process.argv[1]);
      const steps=Array.isArray(p.steps)?p.steps:[];
      const exp=steps.find(x=>x&&x.expand==="chapters"&&Array.isArray(x.steps));
      if(!exp){ console.log("ERR noexpand"); return }
      const sub=exp.steps;
      const applyIdx=sub.findIndex(x=>x&&x.skill==="deterministic-apply");
      const deaiIdx =sub.findIndex(x=>x&&x.skill==="romance-deai-audit");
      const over=(deaiIdx>=0 && sub[deaiIdx].modelOverride)?"yes":"no";
      console.log([applyIdx,deaiIdx,sub.length-1,over].join(" "));
    })()' "$file")
    if [[ "$out" == ERR* || -z "$out" ]]; then
      fail "on-disk $name: could not read expand:chapters substeps ($out)"; return
    fi
    read -r APPLY_I DEAI_I LAST_I DEAI_OVER <<<"$out"
    if [[ "$APPLY_I" -ge 0 && "$DEAI_I" -ge 0 && "$APPLY_I" -lt "$DEAI_I" ]]; then
      pass "on-disk $name: Consistency Apply (idx $APPLY_I) precedes De-AI Sweep (idx $DEAI_I)"
    else
      fail "on-disk $name: apply/de-AI order wrong (apply=$APPLY_I deai=$DEAI_I)"
    fi
    if [[ "$DEAI_I" -ge 0 && "$DEAI_I" == "$LAST_I" ]]; then
      pass "on-disk $name: De-AI Sweep is the LAST per-chapter substep (idx $DEAI_I of $LAST_I)"
    else
      fail "on-disk $name: De-AI Sweep not last per-chapter substep (deai=$DEAI_I last=$LAST_I)"
    fi
    if [[ "$DEAI_OVER" == "no" ]]; then
      pass "on-disk $name: De-AI Sweep substep has NO modelOverride"
    else
      fail "on-disk $name: De-AI Sweep substep unexpectedly carries a modelOverride"
    fi
  }
  check_ondisk romance-sweet-deterministic
  check_ondisk romance-spicy-deterministic

  # Seed banned-terms registry: exists + parses (header + fixed-substitution row
  # + at least one ban-only row with a blank replace).
  CSV="$ROOT/library/banned-terms.csv"
  if [[ ! -f "$CSV" ]]; then
    fail "on-disk: $CSV missing"
  else
    CSV_OUT=$(node -e '(()=>{
      const fs=require("fs");
      const lines=fs.readFileSync(process.argv[1],"utf-8").split(/\r?\n/).filter(l=>l.length>0);
      if(lines.length<2){ console.log("ERR tooShort"); return }
      const header=lines[0].split(",").map(s=>s.trim());
      const hasHeader = header.includes("find") && header.includes("replace");
      const rows=lines.slice(1).map(l=>l.split(","));
      const hasPhone = rows.some(r=> (r[0]||"").trim()==="phone buzzed" && (r[1]||"").trim()==="phone vibrated");
      const hasBanOnly = rows.some(r=> (r[0]||"").trim().length>0 && (r[1]||"").trim().length===0);
      console.log([hasHeader?"h":"-", hasPhone?"p":"-", hasBanOnly?"b":"-"].join(""));
    })()' "$CSV")
    if [[ "$CSV_OUT" == "hpb" ]]; then
      pass "on-disk banned-terms.csv: header + phone-buzzed→phone-vibrated row + a ban-only (blank replace) row"
    else
      fail "on-disk banned-terms.csv: parse/content check failed (flags=$CSV_OUT, expected hpb)"
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
