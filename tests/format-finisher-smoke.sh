#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# BookClaw — Format Finisher smoke (Pro publishing last mile)
# ═══════════════════════════════════════════════════════════
# Verifies the KDP DOCX finisher against a running instance: a .docx uploads
# into a book's data/, POST /api/books/:slug/format-finish applies the
# transforms and writes a new finished .docx, the result lists in runner-files
# and downloads as a valid zip, and the input guards (non-.docx, out-of-tree,
# corrupt .docx) reject correctly. Self-cleaning (deletes the created book).
#
# Usage:  BASE_URL=http://192.168.1.32:3847 tests/format-finisher-smoke.sh [-v]
# Env: BASE_URL, BOOKCLAW_AUTH_TOKEN (else docker/.env / docker exec), CONTAINER.
# ═══════════════════════════════════════════════════════════
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3847}"
CONTAINER="${CONTAINER:-bookclaw}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
[ "${1:-}" = "-v" ] && set -x

TOKEN="${BOOKCLAW_AUTH_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f "$REPO_DIR/docker/.env" ]; then
  TOKEN=$(grep '^BOOKCLAW_AUTH_TOKEN=' "$REPO_DIR/docker/.env" | cut -d= -f2- | tr -d '\r"')
fi
[ -z "$TOKEN" ] && TOKEN=$(docker exec "$CONTAINER" printenv BOOKCLAW_AUTH_TOKEN 2>/dev/null | tr -d '\r')
[ -z "$TOKEN" ] && { echo "ERROR: no auth token" >&2; exit 1; }
AUTH=(-H "Authorization: Bearer $TOKEN")
JH=("${AUTH[@]}" -H "Content-Type: application/json")

PASSES=0; FAILS=0
pass(){ PASSES=$((PASSES+1)); echo "  [PASS] $1${2:+ :: $2}"; }
fail(){ FAILS=$((FAILS+1));   echo "  [FAIL] $1${2:+ :: $2}"; }
code(){ local m="$1" p="$2" b="${3:-}"; if [ -n "$b" ]; then curl -s -o /dev/null -w '%{http_code}' --max-time 60 "${JH[@]}" -X "$m" -d "$b" "$BASE_URL$p"; else curl -s -o /dev/null -w '%{http_code}' --max-time 60 "${JH[@]}" -X "$m" "$BASE_URL$p"; fi; }
req(){ local m="$1" p="$2" b="${3:-}"; if [ -n "$b" ]; then curl -s --max-time 60 "${JH[@]}" -X "$m" -d "$b" "$BASE_URL$p"; else curl -s --max-time 60 "${JH[@]}" -X "$m" "$BASE_URL$p"; fi; }
jget(){ node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);let c=j;for(const k of process.argv[1].split("."))c=c?.[k];console.log(c==null?"":typeof c==="object"?JSON.stringify(c):String(c))}catch(e){console.log("")}})' "$1"; }

clean(){
  for slug in $(req GET /api/books | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{(JSON.parse(s).books||[]).filter(b=>String(b.title).startsWith("Finisher Smoke")).forEach(b=>console.log(b.slug))}catch(e){}})'); do code DELETE "/api/books/$slug" >/dev/null && echo "  [clean] book $slug"; done
}
[ "${CLEANUP:-}" = "1" ] && { echo "▶ CLEANUP"; clean; exit 0; }

echo "▶ Format Finisher smoke → $BASE_URL"
[ "$(code GET /api/library)" = "404" ] && { echo "  ✗ /api/library absent — aborting"; exit 1; }
clean

# ── 1. Create a book ──
SLUG=$(req POST /api/books "$(node -e 'console.log(JSON.stringify({title:"Finisher Smoke "+process.argv[1],author:"default",voice:"default",genre:null,pipelineSequence:["book-production"],sections:[]}))' "$RANDOM")" | jget book.slug)
[ -n "$SLUG" ] && pass "book created" "$SLUG" || { fail "book create"; clean; exit 1; }

# ── 2. Build a minimal .docx + upload it into data/ ──
TMP=$(mktemp -d)
( cd "$REPO_DIR" && node -e '
const AdmZip=require("adm-zip");
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const p=(s)=>`<w:p><w:r><w:t>${s}</w:t></w:r></w:p>`;
const h=(s)=>`<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${s}</w:t></w:r></w:p>`;
const doc=`<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>`+
  h("Chapter 1")+p("Opening line of the chapter.")+p("Second paragraph follows here.")+
  "<w:p></w:p><w:p></w:p>"+p("Text after some blank paragraphs.")+
  h("Chapter 2")+p("Another chapter opener.")+
  "</w:body></w:document>";
const z=new AdmZip();
z.addFile("[Content_Types].xml",Buffer.from(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`));
z.addFile("word/document.xml",Buffer.from(doc));
z.writeZip(process.argv[1]);
' "$TMP/manuscript.docx" )
UP=$(curl -s --max-time 60 "${AUTH[@]}" -F "file=@$TMP/manuscript.docx;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" "$BASE_URL/api/books/$SLUG/finish-upload")
[ "$(printf '%s' "$UP" | jget path)" = "data/manuscript.docx" ] && pass "uploaded .docx into data/" || fail "docx upload" "$(printf '%s' "$UP" | head -c 160)"

# ── 3. Finish it (real transform pass) ──
OPTS='{"path":"data/manuscript.docx","options":{"clean":true,"pageBreaks":true,"fixHrules":true,"indentParagraphs":true,"lineSpacing":1.15,"spaceAfter":0.25,"chapterInitial":{"font":"Palatino Linotype","size":18}}}'
FIN=$(req POST "/api/books/$SLUG/format-finish" "$OPTS")
OUTPATH=$(printf '%s' "$FIN" | jget outputPath)
BYTES=$(printf '%s' "$FIN" | jget bytes)
if [ -n "$OUTPATH" ] && [ "${BYTES:-0}" -gt 0 ]; then pass "format-finish wrote a finished .docx" "$OUTPATH ($BYTES bytes)"; else fail "format-finish failed" "$(printf '%s' "$FIN" | head -c 200)"; fi

# ── 4. It lists in runner-files and downloads as a valid zip ──
case "$(req GET "/api/books/$SLUG/runner-files")" in *"$OUTPATH"*) pass "finished file appears in runner-files" ;; *) fail "finished file missing from runner-files" ;; esac
MAGIC=$(curl -s --max-time 60 "${AUTH[@]}" "$BASE_URL/api/books/$SLUG/file?path=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$OUTPATH")&download=1" | head -c 2)
[ "$MAGIC" = "PK" ] && pass "finished .docx downloads as a valid zip (PK)" || fail "finished file not a zip" "magic=$MAGIC"

# ── 5. Input guards ──
[ "$(code POST "/api/books/$SLUG/format-finish" '{"path":"data/notes.txt","options":{}}')" = "400" ] && pass "non-.docx input rejected (400)" || fail "non-.docx not rejected"
[ "$(code POST "/api/books/$SLUG/format-finish" '{"path":"book.json","options":{}}')" = "400" ] && pass "out-of-tree path rejected (400)" || fail "out-of-tree not rejected"
[ "$(code POST "/api/books/no-such-book/format-finish" '{"path":"data/manuscript.docx","options":{}}')" = "404" ] && pass "unknown book → 404 (not 400)" || fail "unknown book not 404"
[ "$(code POST "/api/books/$SLUG/format-finish" '{"path":"data/manuscript.docx","options":{"range":{"start":"No Such Heading"}}}')" = "400" ] && pass "unmatched range marker rejected (400)" || fail "unmatched range not rejected"

# ── 6. A corrupt .docx → 422 ──
printf 'this is not a zip' > "$TMP/bad.docx"
curl -s -o /dev/null --max-time 60 "${AUTH[@]}" -F "file=@$TMP/bad.docx" "$BASE_URL/api/books/$SLUG/finish-upload" >/dev/null
[ "$(code POST "/api/books/$SLUG/format-finish" '{"path":"data/bad.docx","options":{"clean":true}}')" = "422" ] && pass "corrupt .docx rejected (422)" || fail "corrupt .docx not 422"

rm -rf "$TMP"
echo ""; echo "  ── cleanup ──"; clean
echo "  SUMMARY: $PASSES passed, $FAILS failed"
exit "$FAILS"
