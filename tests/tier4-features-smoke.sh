#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Tier-4 AuthorAgent port smoke (features #10–#17)
# ═══════════════════════════════════════════════════════════
# Exercises the LIVE HTTP surface of the ported Tier-4 features. All checks are
# deterministic and NON-DESTRUCTIVE: no provider key is overwritten, no
# translation is executed (all are gated/validation paths), only a single
# harmless unused vault key is written for #10.
#
#   #10 vault key-format   POST /api/vault (unknown slot → 200, no warning; wiring proof)
#   #11 onboarding         GET  /api/onboarding/status (firstRun + checklist)
#   #12 motivation         POST /api/projects/:id/motivation-critique (unknown → 404 = wired+init)
#   #13 translation exec   POST /api/translation/execute (no/void confirmation → 400/404, gated)
#   #17 revision report    POST /api/projects/:id/revision-report (unknown → 404 = wired+init)
#   #14/#15/#16 are internal (pricing/path-safety/dialogue-parser) — unit-tested,
#     no clean live surface; boot-health confirms they didn't break startup.
#
# Usage:  BASE_URL=http://192.168.1.32:3847 tests/tier4-features-smoke.sh [-v]
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else docker/.env / .env / docker exec), CONTAINER.
# Exit: 0 all pass, N = number of failed checks. Run against DEV (Mercury), not prod.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

TOKEN="${BOOKCLAW_AUTH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$SCRIPT_DIR/../docker/.env" ]; then
  TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' "$SCRIPT_DIR/../docker/.env" | cut -d= -f2- | tr -d '\r"')
fi
[ -z "$TOKEN" ] && [ -f "$SCRIPT_DIR/../.env" ] && TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' "$SCRIPT_DIR/../.env" | cut -d= -f2- | tr -d '\r"')
[ -z "$TOKEN" ] && TOKEN=$(docker exec "$CONTAINER" printenv BOOKCLAW_AUTH_TOKEN 2>/dev/null | tr -d '\r')
[ -z "$TOKEN" ] && { echo "ERROR: no auth token" >&2; exit 1; }
H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }
vlog(){ [ "$VERBOSE" = 1 ] && echo "        $1"; return 0; }

req(){ local m="$1" p="$2" b="${3:-}"
  if [ -n "$b" ]; then curl -s --max-time 60 -w '\n%{http_code}' "${H[@]}" -X "$m" -d "$b" "$BASE_URL$p"
  else curl -s --max-time 60 -w '\n%{http_code}' "${H[@]}" -X "$m" "$BASE_URL$p"; fi
}
code_of(){ printf '%s' "$1" | tail -n1; }
body_of(){ printf '%s' "$1" | sed '$d'; }

echo "▶ Tier-4 feature smoke → $BASE_URL"
[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "${H[@]}" "$BASE_URL/api/status")" != "401" ] \
  || { echo "  ✗ auth failed (401) — wrong token for this host"; exit 1; }

# ── boot health (all features wired without breaking startup) ──
SC=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "${H[@]}" "$BASE_URL/api/status")
[ "$SC" = "200" ] && pass "boot health: /api/status 200" || fail "boot health not 200" "code=$SC"

# ── #11 onboarding status ──
R=$(req GET /api/onboarding/status); C=$(code_of "$R"); B=$(body_of "$R"); vlog "onboarding: $B"
if [ "$C" = "200" ] && printf '%s' "$B" | grep -q '"checklist"' && printf '%s' "$B" | grep -q '"firstRun"'; then
  pass "#11 GET /api/onboarding/status returns firstRun + checklist"
else
  fail "#11 onboarding status" "code=$C body=$(printf '%s' "$B" | head -c 140)"
fi

# ── #10 vault key-format: unknown slot → 200, NO warning (route + validateKeyFormat wired, non-destructive) ──
R=$(req POST /api/vault '{"key":"smoke_test_unused_key","value":"harmless-not-a-provider-key"}'); C=$(code_of "$R"); B=$(body_of "$R"); vlog "vault: $B"
if [ "$C" = "200" ] && printf '%s' "$B" | grep -q '"success":true' && ! printf '%s' "$B" | grep -q '"warning"'; then
  pass "#10 vault save accepts an unknown-slot key with no warning (validateKeyFormat wired)"
else
  fail "#10 vault key-format wiring" "code=$C body=$(printf '%s' "$B" | head -c 140)"
fi

# ── #12 motivation critique: unknown project → 404 (route wired + service initialized; 503 = not init) ──
R=$(req POST /api/projects/__nope__/motivation-critique '{"chapterText":"x"}'); C=$(code_of "$R"); B=$(body_of "$R"); vlog "motivation: $B"
if [ "$C" = "404" ]; then
  pass "#12 motivation-critique route wired + service initialized (unknown project → 404)"
elif [ "$C" = "503" ]; then
  fail "#12 character-motivation service NOT initialized (503)" "body=$(printf '%s' "$B" | head -c 120)"
else
  fail "#12 motivation-critique" "code=$C body=$(printf '%s' "$B" | head -c 120)"
fi

# ── #13 translation execute: gated — missing confirmationId → 400; bogus confirmationId → 404 (never executes) ──
R=$(req POST /api/translation/execute '{"targetLanguage":"es","text":"hello"}'); C=$(code_of "$R"); vlog "trans no-conf: $(body_of "$R")"
[ "$C" = "400" ] && pass "#13 translation/execute rejects missing confirmationId (400)" || fail "#13 translation/execute missing conf not 400" "code=$C"
R=$(req POST /api/translation/execute '{"confirmationId":"__nope__","targetLanguage":"es","text":"hello"}'); C=$(code_of "$R"); vlog "trans bogus-conf: $(body_of "$R")"
if [ "$C" = "404" ] || [ "$C" = "409" ]; then
  pass "#13 translation/execute refuses an unapproved confirmation ($C, no execution)"
else
  fail "#13 translation/execute bogus conf" "code=$C"
fi

# ── #17 revision report: unknown project → 404 (route wired + orchestrator initialized) ──
R=$(req POST /api/projects/__nope__/revision-report '{}'); C=$(code_of "$R"); B=$(body_of "$R"); vlog "revision: $B"
if [ "$C" = "404" ]; then
  pass "#17 revision-report route wired + orchestrator initialized (unknown project → 404)"
elif [ "$C" = "503" ]; then
  fail "#17 revision orchestrator NOT initialized (503)" "body=$(printf '%s' "$B" | head -c 120)"
else
  fail "#17 revision-report" "code=$C body=$(printf '%s' "$B" | head -c 120)"
fi

echo ""; echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
