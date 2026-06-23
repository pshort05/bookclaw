#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — documents/workspace data-loss + traversal guards smoke (LOCAL, no AI)
# ═══════════════════════════════════════════════════════════
# Security-critical, previously untested at the route level. Exercises the
# guards in gateway/src/api/routes/documents.routes.ts:
#
#   1. DELETE /api/workspace/clean?target=<t>  — recursive rm behind an allowlist
#      ['projects','research','exports','audio']. We ONLY drive REJECTION cases
#      (bad targets) and assert the workspace was NOT touched. We deliberately do
#      NOT call a valid allowlist target: ROOT_DIR is the REAL ./workspace and a
#      real clean would wipe live dev data (see "INTENTIONALLY SKIPPED" below).
#
#   2. DELETE /api/documents/:filename — safePath() traversal guard. Traversal
#      names → 403, no file escapes. Positive case operates ONLY on a throwaway
#      doc this smoke uploaded.
#
#   3. POST /api/documents/upload — filename sanitization (sandbox.sanitizeFilename
#      + leading-dot strip + 200-char clamp). Upload nasty names; assert the STORED
#      filename (read back from GET /api/documents) is sanitized.
#
# SAFETY: non-destructive to real data. The ONLY filesystem mutations are uploads
# of files whose names this smoke generates (unique per-run marker), and deletes
# of exactly those files. A cleanup trap removes them and stops the server.
#
# Debug: run with -v to stream the captured server log on demand / failure.
#
# Usage:  tests/documents-safety-smoke.sh [-v]   (PORT fixed at 3965, chat 3966)
# ═══════════════════════════════════════════════════════════
set -uo pipefail

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
PORT=3965
HOST=127.0.0.1
BASE="http://${HOST}:${PORT}"

# Unique marker so concurrent smokes (sharing the real workspace) never collide
# and we only ever assert/delete OUR OWN files.
MARK="docsafe-$$-$(date +%s)"
DOCSDIR="$ROOT/workspace/documents"
WORKSPACE="$ROOT/workspace"

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }

# raw curl helpers
code(){ curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }

SRV_PID=""; LOG="$(mktemp)"
# Track filenames (as stored under workspace/documents) we created, for cleanup.
CREATED=()

dump_log(){ echo "── server log tail ─────────────"; tail -30 "$LOG"; echo "────────────────────────────────"; }

cleanup(){
  # Delete ONLY the throwaway docs we uploaded (by exact stored name).
  for f in "${CREATED[@]:-}"; do
    [ -n "$f" ] && [ -e "$DOCSDIR/$f" ] && rm -f "$DOCSDIR/$f" 2>/dev/null
  done
  # Belt-and-braces: remove anything carrying our run marker.
  if [ -d "$DOCSDIR" ]; then
    find "$DOCSDIR" -maxdepth 1 -name "*${MARK}*" -type f -delete 2>/dev/null
  fi
  [ -n "$SRV_PID" ] && kill "$SRV_PID" 2>/dev/null
  [ "$VERBOSE" = 1 ] && dump_log
  rm -f "$LOG"
}
trap cleanup EXIT

echo "▶ documents/workspace safety smoke (local, REAL ./workspace) → $BASE"
echo "  run marker: $MARK"

# ── Boot a local gateway (auth disabled, no AI needed) ──
( cd "$ROOT" && env BOOKCLAW_BIND="$HOST" BOOKCLAW_PORT="$PORT" BOOKCLAW_CHAT_PORT=3966 BOOKCLAW_AUTH_DISABLED=1 \
    node --import tsx gateway/src/index.ts >"$LOG" 2>&1 ) &
SRV_PID=$!
for i in $(seq 1 60); do curl -s -o /dev/null --max-time 2 "$BASE/api/status" && break; sleep 0.5; done
if [ "$(code "$BASE/api/status")" = "200" ]; then
  pass "local gateway booted"
else
  fail "gateway did not boot (see log)"; dump_log; exit 1
fi

# ═══════════════════════════════════════════════════════════
# PHASE 1 — DELETE /api/workspace/clean guard (rejection-only)
# Assert bad targets are REJECTED and the workspace is NOT touched.
# We capture the existence of the allowlisted dirs before/after to prove no
# deletion happened. We never pass a valid allowlist target.
# ═══════════════════════════════════════════════════════════
echo "── Phase 1: workspace/clean rejection guard ──"

# Snapshot: which standard subdirs exist now (so we can prove none vanished).
ws_snapshot(){ for d in projects research exports audio; do [ -d "$WORKSPACE/$d" ] && echo "$d"; done | sort | tr '\n' ' '; }
BEFORE="$(ws_snapshot)"
echo "  [info] workspace subdirs present before: [$BEFORE]"

# target values that MUST be rejected. Note: URL-encode where needed.
declare -a BADTARGETS=( ".." "" "vault" "..%2Fprojects" "%2Fetc%2Fpasswd" "../projects" )
declare -a BADLABELS=( "dotdot" "empty" "vault" "url-enc ../projects" "absolute /etc/passwd" "raw ../projects" )

for i in "${!BADTARGETS[@]}"; do
  t="${BADTARGETS[$i]}"; lbl="${BADLABELS[$i]}"
  c="$(code -X DELETE "$BASE/api/workspace/clean?target=${t}")"
  # Guard returns 400 for non-allowlist targets. Anything < 400 = accepted = FAIL.
  if [ "$c" -ge 400 ] 2>/dev/null; then
    pass "clean rejects bad target [$lbl]" "HTTP $c"
  else
    fail "clean ACCEPTED bad target [$lbl] — POSSIBLE DATA-LOSS GUARD FAILURE" "HTTP $c"
  fi
done

AFTER="$(ws_snapshot)"
if [ "$BEFORE" = "$AFTER" ]; then
  pass "workspace untouched by rejected cleans" "[$AFTER]"
else
  fail "workspace CHANGED after rejected cleans — DATA LOSS" "before=[$BEFORE] after=[$AFTER]"
fi

# ═══════════════════════════════════════════════════════════
# PHASE 2 — DELETE /api/documents/:filename traversal guard + positive delete
# ═══════════════════════════════════════════════════════════
echo "── Phase 2: documents delete traversal guard ──"

# Traversal delete attempts → must NOT 200 (403 traversal-blocked or 404).
# We also confirm a sentinel file outside the docs dir is never removed: use
# the project's own package.json as a witness (it must still exist after).
WITNESS="$ROOT/package.json"
[ -f "$WITNESS" ] && WITNESS_OK=1 || WITNESS_OK=0

declare -a TRAVNAMES=( "..%2F..%2Fetc%2Fpasswd" "..%2F..%2Fpackage.json" "..%2F..%2F..%2Fetc%2Fpasswd" )
declare -a TRAVLABELS=( "encoded ../../etc/passwd" "encoded ../../package.json" "encoded ../../../etc/passwd" )

for i in "${!TRAVNAMES[@]}"; do
  n="${TRAVNAMES[$i]}"; lbl="${TRAVLABELS[$i]}"
  c="$(code -X DELETE "$BASE/api/documents/${n}")"
  # Acceptable: 403 (traversal blocked) or 404 (not found inside sandbox). 200 = escape.
  if [ "$c" = "403" ] || [ "$c" = "404" ]; then
    pass "documents delete blocks traversal [$lbl]" "HTTP $c"
  else
    fail "documents delete traversal NOT blocked [$lbl] — POSSIBLE ESCAPE" "HTTP $c"
  fi
done

# Witness file must still exist (proves no arbitrary-file delete escaped).
if [ "$WITNESS_OK" = 1 ]; then
  if [ -f "$WITNESS" ]; then
    pass "witness file survived traversal-delete attempts" "package.json"
  else
    fail "WITNESS FILE DELETED — arbitrary-file delete escaped sandbox" "package.json"
  fi
fi

# Positive: upload a throwaway doc, then DELETE it by its real name → 200 + gone.
POSNAME="${MARK}-positive-delete.md"
UP="$(curl -s --max-time 20 -F "file=@-;filename=${POSNAME};type=text/markdown" \
      "$BASE/api/documents/upload" <<<"# throwaway $MARK")"
STORED="$(printf '%s' "$UP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).filename||"")}catch(e){console.log("")}})')"
if [ -n "$STORED" ] && [ -f "$DOCSDIR/$STORED" ]; then
  CREATED+=("$STORED")
  pass "throwaway doc uploaded" "$STORED"
else
  fail "throwaway upload did not land on disk" "resp=$UP"
fi

if [ -n "$STORED" ]; then
  c="$(code -X DELETE "$BASE/api/documents/$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$STORED")")"
  if [ "$c" = "200" ] && [ ! -f "$DOCSDIR/$STORED" ]; then
    pass "throwaway doc deleted by real name → 200 + gone" "$STORED"
  else
    fail "positive delete failed" "HTTP $c, exists=$([ -f "$DOCSDIR/$STORED" ] && echo yes || echo no)"
  fi
fi

# ═══════════════════════════════════════════════════════════
# PHASE 3 — Upload filename sanitization
# Nasty originalname → stored name must have NO leading dots, NO path separators,
# and be clamped (<=200 chars). Verify via the GET /api/documents listing.
# ═══════════════════════════════════════════════════════════
echo "── Phase 3: upload filename sanitization ──"

list_has(){ # arg: exact stored filename → 0 if present in /api/documents listing
  curl -s --max-time 20 "$BASE/api/documents" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s).documents||[];process.exit(d.some(x=>x.filename===process.argv[1])?0:1)}catch(e){process.exit(1)}})' "$1"
}

upload_raw(){ # arg1: raw originalname (sent verbatim to multer) → echoes stored filename
  curl -s --max-time 20 -F "file=@-;filename=$1;type=text/markdown" \
    "$BASE/api/documents/upload" <<<"# sanitize probe $MARK" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).filename||"")}catch(e){console.log("")}})'
}

# 3a. Leading dots must be stripped (no dotfiles). Embed marker so it's unique.
LEADNAME="...${MARK}-evil.md"
S1="$(upload_raw "$LEADNAME")"
if [ -n "$S1" ]; then CREATED+=("$S1"); fi
if [ -n "$S1" ] && [[ "$S1" != .* ]] && list_has "$S1"; then
  pass "leading dots stripped from stored name" "in:'$LEADNAME' out:'$S1'"
else
  fail "leading-dot sanitization failed" "in:'$LEADNAME' out:'$S1'"
fi

# 3b. Path separators must not survive (no '/' or '\' in stored name).
SEPNAME="${MARK}/sub\\dir.md"
S2="$(upload_raw "$SEPNAME")"
if [ -n "$S2" ]; then CREATED+=("$S2"); fi
if [ -n "$S2" ] && [[ "$S2" != */* ]] && [[ "$S2" != *\\* ]] && list_has "$S2"; then
  pass "path separators removed from stored name" "in:'$SEPNAME' out:'$S2'"
else
  fail "path-separator sanitization failed" "in:'$SEPNAME' out:'$S2'"
fi

# 3c. Over-long name must be clamped to <=200 chars.
LONGCORE="$(node -e 'process.stdout.write("a".repeat(400))')"
LONGNAME="${MARK}-${LONGCORE}.md"
S3="$(upload_raw "$LONGNAME")"
if [ -n "$S3" ]; then CREATED+=("$S3"); fi
S3LEN=${#S3}
if [ -n "$S3" ] && [ "$S3LEN" -le 200 ] && list_has "$S3"; then
  pass "over-long filename clamped to <=200" "len=$S3LEN (in was ${#LONGNAME})"
else
  fail "length-clamp sanitization failed" "len=$S3LEN out:'$S3'"
fi

# ── Summary ──
echo "  SUMMARY: $PASSES passed, $FAILS failed"
echo "  INTENTIONALLY SKIPPED: destructive positive-clean (a valid allowlist target"
echo "    on the REAL ./workspace would wipe live data); covered only by rejection paths."
exit "$FAILS"
