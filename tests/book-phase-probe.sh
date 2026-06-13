#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Book Board phase-progression probe (REPORT-ONLY)
# ═══════════════════════════════════════════════════════════
# Reproduction harness for docs/TODO.md item #15 ("books don't update in real
# time on the Book Board").
#
# Drives ONE book through a 4-step pipeline whose steps are tagged with the
# four leading board phases (planning → bible → production → revision) and, after
# each step, prints what GET /api/books reports for that book's row: its `phase`
# (the board chip + 6-segment bar), `live` (the "writing…" strip), and `next`
# (the suggested-action pill). REPORT-ONLY — it never asserts and always exits 0.
#
# What you should see TODAY: the step's intended phase walks
# planning→bible→production→revision, but the book's reported `phase` stays
# 'planning' the whole time — i.e. the manifest phase is never advanced
# server-side, so the board chip can't move no matter how the client polls.
# After that data gap is fixed, the same probe will show the chip advancing.
#
# Cost containment (same pattern as feature-smoke.sh): pins a cheap OpenRouter
# model and disables Ollama for the run (both restored on EXIT), and the steps
# are trivial (one short sentence, no wordCountTarget → no multi-pass
# continuation). ~4 tiny AI calls, a fraction of a cent.
#
# Persistence: leaves the probe book + its phase-probe pipeline + the project in
# place so you can inspect the board after the run. Re-run with CLEANUP=1 to
# delete every probe book (title prefix "Phase Probe") and the overlay pipeline.
#
# Usage:
#   BASE_URL=http://192.168.1.32:3847 tests/book-phase-probe.sh          # run + watch the board
#   CLEANUP=1 BASE_URL=http://192.168.1.32:3847 tests/book-phase-probe.sh # remove probe data
#
# Env knobs:
#   BASE_URL             gateway URL                    (default http://localhost:3847)
#   BOOKCLAW_AUTH_TOKEN  bearer; else repo docker/.env; else `docker exec CONTAINER`
#   CONTAINER            container for token lookup     (default bookclaw)
#   PAUSE                seconds between steps so the board's 4s poll refreshes (default 5)
#   PROBE_PIPE           overlay pipeline name          (default phase-probe)
#   SMOKE_OR_MODEL       pinned OpenRouter model        (default google/gemini-2.5-flash)
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
PAUSE="${PAUSE:-5}"
PROBE_PIPE="${PROBE_PIPE:-phase-probe}"
SMOKE_OR_MODEL="${SMOKE_OR_MODEL:-google/gemini-2.5-flash}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Resolve the bearer token: env → repo docker/.env → container env ──
TOKEN="${BOOKCLAW_AUTH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$SCRIPT_DIR/../docker/.env" ]; then
  TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' "$SCRIPT_DIR/../docker/.env" | cut -d= -f2- | tr -d '\r"')
fi
if [ -z "$TOKEN" ]; then
  TOKEN=$(docker exec "$CONTAINER" printenv BOOKCLAW_AUTH_TOKEN 2>/dev/null | tr -d '\r')
fi
if [ -z "$TOKEN" ]; then
  echo "ERROR: no auth token. Set BOOKCLAW_AUTH_TOKEN, or run where docker/.env or 'docker exec $CONTAINER' is available." >&2
  exit 1
fi

H=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

# ── HTTP helpers ──
req(){ # METHOD PATH [BODY] [MAXT] → response body
  local m="$1" p="$2" b="${3:-}" t="${4:-120}"
  if [ -n "$b" ]; then curl -s --max-time "$t" "${H[@]}" -X "$m" -d "$b" "$BASE_URL$p"
  else curl -s --max-time "$t" "${H[@]}" -X "$m" "$BASE_URL$p"; fi
}
code(){ # METHOD PATH [BODY] [MAXT] → HTTP status code
  local m="$1" p="$2" b="${3:-}" t="${4:-30}"
  if [ -n "$b" ]; then curl -s -o /dev/null -w '%{http_code}' --max-time "$t" "${H[@]}" -X "$m" -d "$b" "$BASE_URL$p"
  else curl -s -o /dev/null -w '%{http_code}' --max-time "$t" "${H[@]}" -X "$m" "$BASE_URL$p"; fi
}
# jget DOTTED.PATH (supports arr[idx]) — reads JSON from stdin, prints the value.
jget(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{let o=JSON.parse(s);for(const k of process.argv[1].split(".")){const m=k.match(/^(.+)\[(\d+)\]$/);o=m?o[m[1]][+m[2]]:o[k];if(o==null)break}console.log(o==null?"":typeof o==="object"?JSON.stringify(o):o)}catch(e){console.log("")}})' "$1"; }

# Print the board row (phase / live / next) for a given slug, as the dashboard sees it.
board_row(){ # SLUG
  req GET /api/books | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{
        const b=(JSON.parse(s).books||[]).find(x=>x.slug===process.argv[1]);
        if(!b){console.log("(book not in /api/books list)");return;}
        const live=b.live?`live[${b.live.stepLabel} ${b.live.progress||0}%]`:"live[none]";
        const nxt=b.next?`next[${b.next.label}]`:"next[none]";
        console.log(`phase=${b.phase}   ${live}   ${nxt}`);
      }catch(e){console.log("(parse error)")}
    })' "$1"; }

# ════════════════════════ CLEANUP MODE ════════════════════════
if [ "${CLEANUP:-0}" = "1" ]; then
  echo "▶ CLEANUP — removing probe books + overlay pipeline on $BASE_URL"
  SLUGS=$(req GET /api/books | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).books||[]).filter(b=>String(b.title||"").startsWith("Phase Probe")).forEach(b=>console.log(b.slug))}catch(e){}})')
  if [ -z "$SLUGS" ]; then
    echo "  (no probe books found)"
  else
    for s in $SLUGS; do
      c=$(code DELETE "/api/books/$s")
      echo "  deleted book $s → $c"
    done
  fi
  c=$(code DELETE "/api/library/pipeline/$PROBE_PIPE")
  echo "  deleted overlay pipeline '$PROBE_PIPE' → $c (404 = no overlay, fine)"
  exit 0
fi

# ════════════════════════ RUN MODE ════════════════════════
echo "▶ Book Board phase-progression probe → $BASE_URL"
echo "  (report-only; leaves data in place; CLEANUP=1 to remove)"
echo ""

# ── 1. Provision the phase-probe pipeline (idempotent overlay entry) ──
PIPE_DOC=$(node -e '
  const name=process.argv[1];
  const step=(label,phase)=>({label:`Probe: ${phase}`,taskType:"general",phase,
    promptTemplate:`Write two short sentences (about 20-30 words total) confirming this is the "${phase}" step of the pipeline for the book titled "{{title}}". Do not write any book content.`});
  const doc={schemaVersion:1,name,label:"Phase Probe (test)",
    description:"Reproduction harness for board phase progression (TODO #15). 4 trivial steps tagged planning/bible/production/revision.",
    steps:["planning","bible","production","revision"].map(p=>step(p,p))};
  console.log(JSON.stringify(doc));' "$PROBE_PIPE")
# Pipeline entries take the raw JSON in `content` (library.ts writeEntry), not `files`.
CREATE_BODY=$(node -e 'console.log(JSON.stringify({name:process.argv[1],content:process.argv[2],description:"Board phase-progression probe (TODO #15)."}))' "$PROBE_PIPE" "$PIPE_DOC")
UPSERT_BODY=$(node -e 'console.log(JSON.stringify({content:process.argv[1],description:"Board phase-progression probe (TODO #15)."}))' "$PIPE_DOC")
PCODE=$(code POST /api/library/pipeline "$CREATE_BODY")
if [ "$PCODE" = "409" ]; then
  PCODE=$(code PUT "/api/library/pipeline/$PROBE_PIPE" "$UPSERT_BODY")
  echo "  pipeline '$PROBE_PIPE' already existed → upserted ($PCODE)"
elif [ "$PCODE" = "200" ]; then
  echo "  pipeline '$PROBE_PIPE' created (overlay)"
else
  echo "  ✗ could not provision pipeline (HTTP $PCODE) — aborting"; exit 0
fi

# ── 2. Resolve an author + voice from the library (prefer 'default') ──
pick(){ # KIND → a library entry name (prefers 'default', else first, else 'default')
  req GET "/api/library?kind=$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const n=(JSON.parse(s).entries||[]).map(x=>x.name);console.log(n.includes("default")?"default":(n[0]||"default"))}catch(e){console.log("default")}})'; }
AUTHOR_NAME=$(pick author)
VOICE_NAME=$(pick voice)
echo "  author='$AUTHOR_NAME'  voice='$VOICE_NAME'  pipeline='$PROBE_PIPE'"

# ── 3. Create the probe book + make it active ──
RAND=$RANDOM
BOOK_BODY=$(node -e 'console.log(JSON.stringify({title:`Phase Probe ${process.argv[1]}`,author:process.argv[2],voice:process.argv[3],genre:null,pipeline:process.argv[4],sections:[]}))' "$RAND" "$AUTHOR_NAME" "$VOICE_NAME" "$PROBE_PIPE")
BRESP=$(req POST /api/books "$BOOK_BODY")
SLUG=$(echo "$BRESP" | jget book.slug)
if [ -z "$SLUG" ]; then
  echo "  ✗ book create failed: $(echo "$BRESP" | head -c 200)"; exit 0
fi
echo "  book created: slug=$SLUG  title='Phase Probe $RAND'"
code POST /api/books/active "{\"slug\":\"$SLUG\"}" >/dev/null

# ── 4. Pin a cheap OpenRouter model + disable Ollama; restore on EXIT ──
OR_ORIG_MODEL=""
restore(){
  echo ""
  curl -s --max-time 30 "${H[@]}" -X POST -d '{"path":"ai.ollama.enabled","value":true}' "$BASE_URL/api/config/update" >/dev/null 2>&1 && echo "  [restore] Ollama re-enabled"
  if [ -n "$OR_ORIG_MODEL" ]; then
    curl -s --max-time 30 "${H[@]}" -X POST -d "{\"path\":\"ai.openrouter.model\",\"value\":\"$OR_ORIG_MODEL\"}" "$BASE_URL/api/config/update" >/dev/null 2>&1 && echo "  [restore] OpenRouter model → $OR_ORIG_MODEL"
  fi
}
trap restore EXIT
curl -s --max-time 30 "${H[@]}" -X POST -d '{"path":"ai.ollama.enabled","value":false}' "$BASE_URL/api/config/update" >/dev/null
OR_ORIG_MODEL=$(curl -s --max-time 25 "${H[@]}" -X POST "$BASE_URL/api/providers/refresh" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=(JSON.parse(s).providers||[]).find(x=>x.id==="openrouter");console.log(p&&p.model?p.model:"")}catch(e){console.log("")}})')
curl -s --max-time 30 "${H[@]}" -X POST -d "{\"path\":\"ai.openrouter.model\",\"value\":\"$SMOKE_OR_MODEL\"}" "$BASE_URL/api/config/update" >/dev/null
echo "  openrouter model: ${OR_ORIG_MODEL:-?} → $SMOKE_OR_MODEL  (ollama disabled for the run)"

# ── 5. Create the project from the book's pipeline + start it ──
PRESP=$(req POST /api/projects/create '{"title":"Phase Probe Run","description":"Probe run: walk a book through 4 phase-tagged steps and watch the board."}')
PID=$(echo "$PRESP" | jget project.id)
PLANNING=$(echo "$PRESP" | jget planning)
NSTEPS=$(echo "$PRESP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).project.steps||[]).length)}catch(e){console.log(0)}})')
if [ -z "$PID" ]; then
  echo "  ✗ project create failed: $(echo "$PRESP" | head -c 200)"; exit 0
fi
echo "  project: id=$PID  planning='$PLANNING'  steps=$NSTEPS"
if [ "$PLANNING" != "book-pipeline" ]; then
  echo "  ⚠ expected planning='book-pipeline' (book's pipeline drives the steps); got '$PLANNING' — board phases may not match intended."
fi
# Ensure the first step is active (creation leaves steps pending).
if [ -z "$(req GET "/api/projects/$PID" | jget project.steps[0].status | grep -x active)" ]; then
  code POST "/api/projects/$PID/start" >/dev/null
fi

# ── 6. Walk the steps one at a time, reporting the board row after each ──
echo ""
echo "  Intended step phases:  planning → bible → production → revision"
echo -n "  BOARD at start:        "; board_row "$SLUG"
echo ""
PHASE_SEQ=""
for i in 1 2 3 4; do
  IDX=$((i-1))
  PROJ=$(req GET "/api/projects/$PID")
  STEP_LABEL=$(echo "$PROJ" | jget "project.steps[$IDX].label")
  STEP_PHASE=$(echo "$PROJ" | jget "project.steps[$IDX].phase")
  ACTIVE=$(echo "$PROJ" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const p=JSON.parse(s).project;const a=(p.steps||[]).find(x=>x.status==="active");console.log(a?a.id:"")}catch(e){console.log("")}})')
  if [ -z "$ACTIVE" ]; then echo "  ── Stage $i: no active step (project finished early) ──"; break; fi
  echo "  ── Stage $i: execute \"$STEP_LABEL\"  (intended book phase: ${STEP_PHASE:-?}) ──"
  XR=$(req POST "/api/projects/$PID/execute" "" 300)
  OK=$(echo "$XR" | jget success)
  [ "$OK" = "true" ] && echo "     step → success" || echo "     step → FAILED: $(echo "$XR" | jget error | head -c 120)"
  PH=$(req GET /api/books | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const b=(JSON.parse(s).books||[]).find(x=>x.slug===process.argv[1]);console.log(b?b.phase:"?")}catch(e){console.log("?")}})' "$SLUG")
  PHASE_SEQ="${PHASE_SEQ}${PHASE_SEQ:+ → }${PH}"
  echo -n "     BOARD now:          "; board_row "$SLUG"
  if [ "$i" -lt 4 ]; then echo "     (pausing ${PAUSE}s — watch the Book Board refresh)"; sleep "$PAUSE"; fi
done

# ── 7. Summary (report-only) ──
echo ""
echo "  ════════════════════════════════════════════════════"
echo "  Intended phases:        planning → bible → production → revision"
echo "  Observed board phase:   ${PHASE_SEQ:-(none)}"
DISTINCT=$(echo "$PHASE_SEQ" | tr ' →' '\n\n' | grep -v '^$' | sort -u | wc -l)
if [ "${DISTINCT:-1}" -le 1 ]; then
  echo "  RESULT: the board phase did NOT advance — reproduces TODO #15"
  echo "          (book.json manifest 'phase' is written once at creation and never updated)."
else
  echo "  RESULT: the board phase advanced across $DISTINCT distinct values — the data gap is fixed."
fi
echo "  ════════════════════════════════════════════════════"
echo ""
echo "  Left in place for inspection on the Book Board:"
echo "    book slug : $SLUG"
echo "    project   : $PID"
echo "    pipeline  : $PROBE_PIPE (workspace overlay)"
echo "  Remove with:  CLEANUP=1 BASE_URL=$BASE_URL $0"
exit 0
