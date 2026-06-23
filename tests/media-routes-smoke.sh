#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — media routes (image/audio serving) guards smoke (LOCAL, no AI)
# ═══════════════════════════════════════════════════════════
# Coverage Batch D. Exercises the file-serving guards in
# gateway/src/api/routes/media.routes.ts at the route level:
#
#   1. GET /api/images/:filename — only serves names matching
#      /^cover-[a-f0-9]+\.png$/ that exist on disk, behind safePath().
#        a. A disallowed/odd filename (right shape, wrong chars) → 404 (regex reject).
#        b. A traversal filename (encoded ../../etc/passwd) → blocked (403/404),
#           no file escapes the image dir.
#        c. A well-formed-but-ABSENT cover-<hex>.png → 404 (not 500, not a serve).
#        d. A well-formed cover-<hex>.png we CREATE in the image dir → 200 served.
#
#   2. GET /api/audio/file/:filename — safePath() traversal guard + 404 for absent.
#        a. Traversal name (encoded) → 403/404, witness file never served.
#        b. Absent well-formed name → 404.
#        c. A real .mp3 we drop into workspace/audio → 200 + audio/mpeg content-type.
#
# SAFETY: non-destructive. The ONLY filesystem mutations are creating two
# throwaway served files (unique per-run marker) inside the image/audio dirs and
# removing exactly those on exit. A cleanup trap removes them + stops the server.
#
# Debug: run with -v to stream the captured server log on demand / failure.
#
# Usage:  tests/media-routes-smoke.sh [-v]   (PORT fixed at 3971, chat 3972)
# ═══════════════════════════════════════════════════════════
set -uo pipefail

VERBOSE=0
[ "${1:-}" = "-v" ] && VERBOSE=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
PORT=3971
HOST=127.0.0.1
BASE="http://${HOST}:${PORT}"

# Unique hex marker so concurrent smokes sharing the real workspace never collide
# and we only ever serve/delete OUR OWN files. Must be [a-f0-9] for the cover regex.
MARK="$(printf '%s' "$$$(date +%s)" | md5sum | cut -c1-16)"
AUDIODIR="$ROOT/workspace/audio"
# Image dir is owned by ImageGenService; discover it after boot via a served probe.
# Default location is workspace/images — confirmed below, but we create-then-serve
# to be robust to the actual configured dir.

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }

# raw curl helpers
code(){ curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$@"; }
hdr(){ curl -s -D - -o /dev/null --max-time 20 "$@"; }

SRV_PID=""; LOG="$(mktemp)"
IMGDIR=""               # resolved after boot
COVER_FILE=""           # throwaway image we create (full path)
AUDIO_FILE=""           # throwaway audio we create (full path)

dump_log(){ echo "── server log tail ─────────────"; tail -30 "$LOG"; echo "────────────────────────────────"; }

cleanup(){
  [ -n "$COVER_FILE" ] && [ -f "$COVER_FILE" ] && rm -f "$COVER_FILE" 2>/dev/null
  [ -n "$AUDIO_FILE" ] && [ -f "$AUDIO_FILE" ] && rm -f "$AUDIO_FILE" 2>/dev/null
  # Kill the whole process group of the boot subshell so the node grandchild
  # (forked because the boot line uses `cd && env node`, not a sole exec) is
  # reaped too — a plain kill $SRV_PID can leave node listening.
  if [ -n "$SRV_PID" ]; then kill -- "-$SRV_PID" 2>/dev/null || kill "$SRV_PID" 2>/dev/null; fi
  [ "$VERBOSE" = 1 ] && dump_log
  rm -f "$LOG"
}
trap cleanup EXIT

echo "▶ media routes (image/audio serving) smoke (local, REAL ./workspace) → $BASE"
echo "  run marker: $MARK"

# ── Boot a local gateway (auth disabled, no AI needed) ──
# setsid → the boot subshell leads its own process group, so the cleanup trap can
# reap the node child via a process-group kill (`cd && env node` forks node as a
# child rather than exec-replacing the subshell).
setsid bash -c "cd '$ROOT' && exec env BOOKCLAW_BIND='$HOST' BOOKCLAW_PORT='$PORT' BOOKCLAW_CHAT_PORT=3972 BOOKCLAW_AUTH_DISABLED=1 node --import tsx gateway/src/index.ts" >"$LOG" 2>&1 &
SRV_PID=$!
for i in $(seq 1 60); do curl -s -o /dev/null --max-time 2 "$BASE/api/status" && break; sleep 0.5; done
if [ "$(code "$BASE/api/status")" = "200" ]; then
  pass "local gateway booted"
else
  fail "gateway did not boot (see log)"; dump_log; exit 1
fi

# ═══════════════════════════════════════════════════════════
# PHASE 1 — GET /api/images/:filename  (allow-regex + traversal + absent)
# ═══════════════════════════════════════════════════════════
echo "── Phase 1: /api/images/:filename guards ──"

# 1a. Disallowed name: correct shape but chars outside [a-f0-9] (uppercase + 'z').
#     Even if it existed, the regex would reject. → 404.
c="$(code "$BASE/api/images/cover-ZZZ123.png")"
if [ "$c" = "404" ]; then
  pass "image: odd filename (non-hex) rejected" "HTTP $c"
else
  fail "image: odd filename NOT rejected as 404" "HTTP $c"
fi

# 1b. Wrong extension / wrong prefix → regex reject → 404.
c="$(code "$BASE/api/images/notacover-abc123.png")"
if [ "$c" = "404" ]; then
  pass "image: wrong-prefix filename rejected" "HTTP $c"
else
  fail "image: wrong-prefix NOT rejected as 404" "HTTP $c"
fi

# 1c. Traversal (encoded ../../etc/passwd) → safePath blocks (403) or 404. Never 200.
for enc in "..%2F..%2F..%2Fetc%2Fpasswd" "..%2F..%2Fpackage.json"; do
  c="$(code "$BASE/api/images/${enc}")"
  if [ "$c" = "403" ] || [ "$c" = "404" ]; then
    pass "image: traversal blocked [$enc]" "HTTP $c"
  else
    fail "image: traversal NOT blocked [$enc] — POSSIBLE ESCAPE" "HTTP $c"
  fi
done

# 1d. Well-formed but ABSENT cover-<hex>.png → 404 (NOT 500, NOT a serve).
ABSENT="cover-${MARK}absent.png"
c="$(code "$BASE/api/images/${ABSENT}")"
if [ "$c" = "404" ]; then
  pass "image: well-formed-but-absent cover → 404" "HTTP $c ($ABSENT)"
else
  fail "image: absent cover returned non-404 (500/serve?)" "HTTP $c"
fi

# 1e. Drop a real cover-<hex>.png into the image dir, assert it SERVES (200).
#     ImageGenService is constructed with join(ROOT,'workspace') and getImageDir()
#     returns join(workspaceDir,'images') — see init/phase-06-content.ts +
#     services/image-gen.ts. So the served dir is workspace/images.
IMGDIR="$ROOT/workspace/images"

COVER_NAME="cover-${MARK}.png"
COVER_FILE="$IMGDIR/$COVER_NAME"
mkdir -p "$IMGDIR" 2>/dev/null
# Minimal valid-enough PNG header bytes (content irrelevant; route only stats + sendFile).
printf '\x89PNG\r\n\x1a\n%s' "served-by-smoke-$MARK" > "$COVER_FILE"
if [ -f "$COVER_FILE" ]; then
  c="$(code "$BASE/api/images/${COVER_NAME}")"
  if [ "$c" = "200" ]; then
    pass "image: real cover-<hex>.png served" "HTTP $c ($COVER_NAME)"
  else
    fail "image: real well-formed cover NOT served" "HTTP $c (dir=$IMGDIR)"
  fi
else
  fail "image: could not create throwaway cover for serve test" "dir=$IMGDIR"
fi

# ═══════════════════════════════════════════════════════════
# PHASE 2 — GET /api/audio/file/:filename  (traversal + absent + serve)
# ═══════════════════════════════════════════════════════════
echo "── Phase 2: /api/audio/file/:filename guards ──"

# Witness: project package.json must never be served/leaked via audio traversal.
WITNESS="$ROOT/package.json"

# 2a. Traversal → 403/404, never 200 (would leak an out-of-dir file).
for enc in "..%2F..%2Fpackage.json" "..%2F..%2F..%2Fetc%2Fpasswd"; do
  c="$(code "$BASE/api/audio/file/${enc}")"
  if [ "$c" = "403" ] || [ "$c" = "404" ]; then
    pass "audio: traversal blocked [$enc]" "HTTP $c"
  else
    fail "audio: traversal NOT blocked [$enc] — POSSIBLE ESCAPE" "HTTP $c"
  fi
done
# Witness untouched (it is never deleted here; assert it still exists as a sanity floor).
[ -f "$WITNESS" ] && pass "audio: witness file intact after traversal attempts" "package.json" \
                   || fail "audio: witness file vanished" "package.json"

# 2b. Absent well-formed audio name → 404.
ABSENTA="${MARK}-absent.mp3"
c="$(code "$BASE/api/audio/file/${ABSENTA}")"
if [ "$c" = "404" ]; then
  pass "audio: absent file → 404" "HTTP $c ($ABSENTA)"
else
  fail "audio: absent file returned non-404" "HTTP $c"
fi

# 2c. Drop a real .mp3 into workspace/audio, assert 200 + audio/mpeg content-type.
AUDIO_NAME="${MARK}-served.mp3"
AUDIO_FILE="$AUDIODIR/$AUDIO_NAME"
mkdir -p "$AUDIODIR" 2>/dev/null
printf 'ID3-stub-%s' "$MARK" > "$AUDIO_FILE"
if [ -f "$AUDIO_FILE" ]; then
  c="$(code "$BASE/api/audio/file/${AUDIO_NAME}")"
  CT="$(hdr "$BASE/api/audio/file/${AUDIO_NAME}" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print tolower($2)}')"
  if [ "$c" = "200" ] && printf '%s' "$CT" | grep -q "audio/mpeg"; then
    pass "audio: real .mp3 served with audio/mpeg" "HTTP $c, CT=$CT"
  else
    fail "audio: real .mp3 not served correctly" "HTTP $c, CT=$CT"
  fi
else
  fail "audio: could not create throwaway mp3 for serve test" "dir=$AUDIODIR"
fi

# ── Summary ──
echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
