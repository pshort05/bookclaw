# Romance Workflow — Foundation (Sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two end-to-end, seed-woven romance pipelines (`romance-sweet-full`, `romance-spicy-full`) plus the plumbing that carries author "seeds" (`storyArc` / `characters` / `world`) from `POST /api/books` through the book manifest into project `context`, so the pipelines' `{{storyArc}}`, `{{characters}}`, `{{world}}` template vars resolve.

**Architecture:** Declarative static JSON pipelines reusing the existing `expandSteps` / `buildPipelineVars` path (no new engine). Seeds are persisted on `book.json` (`manifest.seeds`, additive-optional, no schema bump) at book-create time and spread into the project `context` when the book's sequence is run, where `buildPipelineVars({ ...context })` passes every key through as a `{{var}}`. The two pipeline files share an identical front half (premise/bible/world/outline) apart from heat-specific wording, and differ substantively only in the per-chapter production block (copied verbatim from the existing `romance-sweet.json` / `romance-spicy.json`) and its intimacy skill.

**Tech Stack:** Node 22 + TypeScript via `tsx`, Express routes, JSON pipeline files under `library/pipelines/`, `node:test` unit tests (`node --import tsx --test`), bash server smokes.

> **Post-plan rename (2026-07-08, during build):** the setting seed was renamed `world` → `setting` at every layer (HTTP body key, `manifest.seeds` field, context key, `{{setting}}` template var, MCP param), because romance is grounded in the real world (immersive place/setting texture, not a built-world) and `world` collided with the pre-existing World Repository bind (`body.world`, left untouched). References to `world`/`{{world}}` below predate that decision — read them as `setting`/`{{setting}}`. The shipped code and tests use `setting`.

## Global Constraints

- **Imports use `.js` extensions** in TS source (NodeNext) — match when adding/editing.
- **Context-key / template-var names are BARE and locked:** `storyArc`, `characters`, `world`, `councilSelection` (author seeds); `chapterCount`, `wordsPerChapter` already exist as computed vars from `targetChapters` / `targetWordsPerChapter`. Pipeline JSON `{{var}}` MUST match the context key exactly.
- **`councilSelection` is accepted and persisted but INERT in Foundation** — reserved for sub-project 2 (LLM Council). Do not wire any behavior to it.
- **`heat` is represented by pipeline selection**, not a threaded var: `romance-sweet-full` = fade-to-black (spice 2), `romance-spicy-full` = open-door/explicit. Each file bakes its own heat language into the front-half prompts. No `{{heat}}` var, no `heat` field on the route.
- **Surgical changes only** — every changed line traces to this plan. Match existing file style (e.g. the `...(sel.field ? { field } : {})` spread pattern in `book.ts`).
- **Fail-soft posture** — missing seeds are normal (empty string → clean generation), never an error.
- **Output-contract guard (rebased in from `9561bca`)** — `tests/unit/pipeline-output-contract.test.ts` fails the build if ANY `library/pipelines/*.json` step with a narrative `taskType` (`creative_writing`, `final_edit`, `book_bible`, `outline`, `consistency`, `revision`) lacks an output-contract phrase. Every front-half narrative step in the two new files MUST include a clause the guard recognizes — e.g. `Output the <thing> only — no preamble or commentary.` (matches `output … only`) or `Do not rewrite …`. The copied production block already satisfies this (it's from the shipped `romance-sweet.json`/`romance-spicy.json`, which pass the guard). The completion-report step is `general` (exempt).
- **MCP lockstep** — if `/api/books` seed fields are surfaced through the MCP `create_book` tool, update `mcp/` in the same commit as the gateway route (Task 3, Step 6).

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `library/pipelines/romance-sweet-full.json` | Full sweet pipeline: seed-woven front half + verbatim sweet production block + revision + report | Create |
| `library/pipelines/romance-spicy-full.json` | Same, spicy production block | Create |
| `gateway/src/services/book-types.ts` | `BookManifest.seeds?` field | Modify (~line 71) |
| `gateway/src/services/book.ts` | `BookSelection.seeds?` field + persist in `create()` | Modify (~line 54, ~line 365) |
| `gateway/src/api/routes/books.routes.ts` | Parse/validate seed fields on `POST /api/books`; pass into `create()` | Modify (~line 594, ~line 597) |
| `gateway/src/api/routes/projects.routes.ts` | Spread `manifest.seeds` into `seqContext` when running a book sequence | Modify (~line 181) |
| `mcp/src/tools/*` (create_book) | Optional seed passthrough (lockstep) | Modify |
| `tests/unit/romance-full-pipeline.test.ts` | Pure expansion test: seeds weave into front-half prompts; production block carries romance skills + modelOverrides; empty seeds collapse cleanly | Create |
| `tests/romance-seed-smoke.sh` | End-to-end: create book with seeds → run sequence → assert seed text in project step prompts | Create |

Seeds live nested under `manifest.seeds = { storyArc, characters, world, councilSelection }` on the manifest (keeps the manifest tidy), but are spread FLAT into project context at run time so templates see bare `{{storyArc}}`.

---

## Task 1: The two full-pipeline JSON files

**Files:**
- Create: `library/pipelines/romance-sweet-full.json`
- Create: `library/pipelines/romance-spicy-full.json`
- Reference (copy production block from): `library/pipelines/romance-sweet.json`, `library/pipelines/romance-spicy.json`
- Reference (var mechanism): `gateway/src/services/pipeline-vars.ts`, `gateway/src/services/pipeline-expand.ts`
- Test: `tests/unit/romance-full-pipeline.test.ts`

**Interfaces:**
- Produces: two library pipelines named `romance-sweet-full` / `romance-spicy-full`, each a `{ schemaVersion, name, label, description, steps[] }` object. `steps[]` = 4 front-half planning steps (`premise` → character bible → world → outline), then one `{ expand: 'chapters', steps: [...] }` production group copied verbatim from the matching existing romance pipeline, then a manuscript continuity-review step, then a completion report.
- Consumes: template vars `{{title}}`, `{{storyArc}}`, `{{characters}}`, `{{world}}`, `{{chapterCount}}`, `{{wordsPerChapter}}`, `{{setupEnd}}`, `{{incitingEnd}}`, `{{midpoint}}`, `{{twist75}}`, `{{climaxStart}}`, `{{climaxEnd}}` (all supplied by `buildPipelineVars`).

**Design note (deviation from spec, surfaced per Karpathy #1):** the spec's Revision phase lists "developmental edit, line edit, consistency check" as three steps. The per-chapter production block already runs improvement-plan → rewrite → humanize per chapter, so a whole-manuscript line edit as a single AI step is both redundant and impractical (a full book exceeds one step's output budget). Foundation collapses Revision to **one** manuscript-level "Continuity & Arc Review" report step (advisory, like the existing compile-report step). Deeper revision stays the existing per-chapter loop. If you want the three-step version, stop and confirm before expanding.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/romance-full-pipeline.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.js';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (name: string) => JSON.parse(readFileSync(join(root, 'library', 'pipelines', `${name}.json`), 'utf-8'));

const SEEDS = {
  title: 'Test Book',
  description: 'desc',
  targetChapters: 4,
  targetWordsPerChapter: 2000,
  storyArc: 'ARC_MARKER rivals-to-lovers over one summer',
  characters: 'CHAR_MARKER Mara, a stubborn baker; Jonah, the new rival',
  world: 'WORLD_MARKER a small coastal town',
};

for (const [name, prodSkill, heatWord] of [
  ['romance-sweet-full', 'romance-sweet-first-draft', 'fade-to-black'],
  ['romance-spicy-full', 'romance-spicy-first-draft', 'open-door'],
] as const) {
  test(`${name}: front half weaves the seeds`, () => {
    const p = load(name);
    const steps = expandSteps(p.steps, buildPipelineVars(SEEDS));
    const allPrompts = steps.map((s) => s.prompt).join('\n');
    assert.ok(allPrompts.includes('ARC_MARKER'), 'storyArc woven');
    assert.ok(allPrompts.includes('CHAR_MARKER'), 'characters woven');
    assert.ok(allPrompts.includes('WORLD_MARKER'), 'world woven');
  });

  test(`${name}: production block carries romance skills + modelOverrides`, () => {
    const p = load(name);
    const steps = expandSteps(p.steps, buildPipelineVars(SEEDS));
    // 4 chapters × 6 per-chapter production steps present:
    const draftSteps = steps.filter((s) => s.skill === prodSkill);
    assert.equal(draftSteps.length, 4, 'one first-draft step per chapter');
    assert.ok(draftSteps.every((s) => s.modelOverride?.model), 'draft steps keep modelOverride');
  });

  test(`${name}: empty seeds collapse cleanly (no dangling markers, front half still generates)`, () => {
    const p = load(name);
    const steps = expandSteps(p.steps, buildPipelineVars({ ...SEEDS, storyArc: '', characters: '', world: '' }));
    const front = steps.slice(0, 4).map((s) => s.prompt).join('\n');
    assert.ok(!front.includes('undefined') && !front.includes('{{'), 'no unresolved vars');
    assert.ok(front.includes(heatWord), 'heat language baked into front half');
    assert.ok(steps.length > 4, 'production + report steps still present');
  });
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/romance-full-pipeline.test.ts`
Expected: FAIL — `ENOENT` opening `romance-sweet-full.json` (files not created yet).

- [ ] **Step 3: Create `library/pipelines/romance-sweet-full.json`**

Front half + revision + report as below. For the production group, **open `library/pipelines/romance-sweet.json` and copy its entire first `steps[]` entry — the `{ "expand": "chapters", "steps": [ ... ] }` object (lines 7–98) — verbatim** into the marked slot. Do not retype it; copy it so the per-step `modelOverride`s and `romance-sweet-*` skills are preserved exactly.

```json
{
  "schemaVersion": 1,
  "name": "romance-sweet-full",
  "label": "Sweet Romance — Full Workflow (Seeded)",
  "description": "End-to-end sweet romance (spice level 2 / fade-to-black): seed-woven premise, character bible, world guide and chapter outline, then the full per-chapter production loop (Scene Brief -> First Draft -> Improvement Plan -> Rewrite -> Humanize -> Intimacy, closed-door), a manuscript continuity review, and a completion report. Author seeds (storyArc/characters/world) are developed and preserved, never discarded.",
  "steps": [
    {
      "label": "Premise",
      "skill": "premise",
      "taskType": "book_bible",
      "phase": "premise",
      "promptTemplate": "Write the PREMISE for the sweet romance novel \"{{title}}\". Define the central couple, the core romantic conflict that keeps them apart, the primary tropes, and the HEA/HFN promise. This is a fade-to-black sweet romance (spice level 2) — emotional intimacy over explicit heat. Follow your premise methodology and the genre guide in your context. Output the premise document only — no preamble, commentary, or questions.\n\nAuthor-provided story arc — develop and expand this, preserving everything given and filling gaps; never discard or contradict it. If the section below is blank, originate the arc from scratch.\nStory arc:\n{{storyArc}}"
    },
    {
      "label": "Character Bible",
      "skill": "book-bible",
      "taskType": "book_bible",
      "phase": "bible",
      "promptTemplate": "Write the CHARACTER BIBLE for \"{{title}}\": the protagonist, the love interest, and the full relationship arc (attraction -> tension -> midpoint shift -> black moment -> reconciliation), plus supporting cast. Use the premise in your context. Follow your book-bible methodology. Output the character bible only — no preamble or commentary.\n\nAuthor-provided characters — develop and preserve, filling gaps; if blank, originate from the premise.\nCharacters:\n{{characters}}"
    },
    {
      "label": "World & Setting",
      "skill": "book-bible",
      "taskType": "book_bible",
      "phase": "bible",
      "promptTemplate": "Write the WORLD & SETTING guide for \"{{title}}\": time, place, social rules, and the settings where the romance plays out. Use the premise and character bible in your context. Follow your book-bible methodology. Output the world guide only — no preamble or commentary.\n\nAuthor-provided world notes — develop and preserve, filling gaps; if blank, originate from the premise.\nWorld notes:\n{{world}}"
    },
    {
      "label": "Chapter Outline",
      "skill": "outline",
      "taskType": "outline",
      "phase": "outline",
      "promptTemplate": "Write the CHAPTER-BY-CHAPTER OUTLINE for \"{{title}}\" across {{chapterCount}} chapters. Use the premise, character bible and world guide in your context. Map the romance beats onto the structure: meet-cute by Chapter {{setupEnd}}, inciting connection by Chapter {{incitingEnd}}, midpoint shift at Chapter {{midpoint}}, the black moment near Chapter {{twist75}}, and the grovel / reunion / HEA across Chapters {{climaxStart}}-{{climaxEnd}}. Follow your outline methodology. Output the outline only — one entry per chapter, no preamble or commentary."
    },

    "<<< PASTE the { \"expand\": \"chapters\", \"steps\": [...] } object from library/pipelines/romance-sweet.json (its first steps[] entry) HERE, verbatim >>>",

    {
      "label": "Continuity & Arc Review",
      "taskType": "revision",
      "phase": "revision",
      "promptTemplate": "Review the completed {{chapterCount}}-chapter sweet romance manuscript \"{{title}}\" in your context for cross-chapter continuity and romance-arc integrity: does the relationship escalate coherently (attraction -> tension -> midpoint -> black moment -> HEA), are there timeline/character/detail contradictions, and are the fade-to-black boundaries consistent? Output a prioritized issue list with chapter references and concrete fixes. Do not rewrite the manuscript."
    },
    {
      "label": "Compile manuscript report",
      "taskType": "general",
      "phase": "assembly",
      "promptTemplate": "Generate a completion report for the sweet romance manuscript \"{{title}}\". Total chapters: {{chapterCount}}, target ~{{wordsPerChapter}} words each. Assess the romance arc's progression, voice consistency, the fade-to-black (spice level 2) handling across the book, continuity, and any chapters that warrant a human editing pass. End with concrete next steps (beta readers, professional edit, formatting)."
    }
  ]
}
```

Replace the `"<<< PASTE ... >>>"` string element with the actual copied object (it is a sibling array element, so it replaces that one string entry).

- [ ] **Step 4: Create `library/pipelines/romance-spicy-full.json`**

Identical to Step 3's file EXCEPT: `name` = `romance-spicy-full`; `label` = `"Spicy Romance — Full Workflow (Seeded)"`; every front-half / review / report mention of "sweet"/"fade-to-black"/"closed-door"/"spice level 2" becomes the open-door equivalent (e.g. premise prompt: "This is an open-door spicy romance — on-page intimacy is expected."); and the pasted production group is copied **from `library/pipelines/romance-spicy.json`** (its first `steps[]` entry, lines 7–98) so it carries the `romance-spicy-*` skills. Keep the outline/premise/bible/world prompts otherwise word-identical to the sweet file.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --import tsx --test tests/unit/romance-full-pipeline.test.ts tests/unit/pipeline-output-contract.test.ts`
Expected: PASS — the 6 romance tests (3 per pipeline) AND the output-contract guard (which now also scans the two new files). If "heat language baked" fails, confirm each file's front-half literally contains `fade-to-black` (sweet) / `open-door` (spicy). If the contract guard lists a `romance-*-full` step, that narrative step is missing an `Output … only` / `Do not rewrite …` clause — add one.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add library/pipelines/romance-sweet-full.json library/pipelines/romance-spicy-full.json tests/unit/romance-full-pipeline.test.ts
git commit -m "feat(romance): romance-sweet-full / romance-spicy-full seed-woven pipelines"
```

---

## Task 2: Persist seeds on the book manifest

**Files:**
- Modify: `gateway/src/services/book-types.ts:71` (add `seeds?` to `BookManifest`)
- Modify: `gateway/src/services/book.ts:54` (add `seeds?` to `BookSelection`), `gateway/src/services/book.ts:365` (persist in `create()`)
- Test: `tests/unit/romance-full-pipeline.test.ts` (append a manifest round-trip test) — or a new `tests/unit/book-seeds.test.ts`

**Interfaces:**
- Produces: `BookSelection.seeds?: { storyArc?: string; characters?: string; world?: string; councilSelection?: 'auto' | 'propose' }` and the identical shape on `BookManifest.seeds?`. `BookService.create(sel)` writes `sel.seeds` onto `book.json` when present.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/book-seeds.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookService } from '../../gateway/src/services/book.js';
import { LibraryService } from '../../gateway/src/services/library.js';

test('BookService.create persists seeds onto the manifest', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bookclaw-seeds-'));
  try {
    const library = new LibraryService(process.cwd());
    await library.initialize?.();
    const books = new BookService(dir, library, '0.0.0-test');
    await books.initialize?.();
    const authors = library.list('author'); const voices = library.list('voice');
    const manifest = await books.create({
      title: 'Seeded Romance', author: authors[0].name, voice: voices[0].name,
      genre: null, pipeline: 'romance-sweet-full', sections: [],
      seeds: { storyArc: 'ARC_X', characters: 'CHAR_X', world: 'WORLD_X', councilSelection: 'auto' },
    } as any);
    assert.equal(manifest.seeds?.storyArc, 'ARC_X');
    const onDisk = JSON.parse(readFileSync(join(dir, 'books', manifest.slug, 'book.json'), 'utf-8'));
    assert.equal(onDisk.seeds.characters, 'CHAR_X');
    assert.equal(onDisk.seeds.councilSelection, 'auto');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

> Confirm the `BookService` / `LibraryService` constructor + `initialize` signatures against the source before running (they are read in this session as `new BookService(rootDir, library, appVersion)`); adjust the harness lines only if the real signatures differ. If a full `LibraryService` bootstrap is heavy, an acceptable alternative is to assert on the object returned by `create()` and skip the on-disk read — but prefer the disk read.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/unit/book-seeds.test.ts`
Expected: FAIL — `manifest.seeds` is `undefined` (create doesn't persist it yet), or a TS error that `seeds` is not a `BookSelection` member.

- [ ] **Step 3: Add `seeds` to the manifest type**

In `gateway/src/services/book-types.ts`, after the `ensemble?` line (~line 71) inside `interface BookManifest`:

```ts
  seeds?: { storyArc?: string; characters?: string; world?: string; councilSelection?: 'auto' | 'propose' }; // Romance Workflow Foundation — author-provided seeds developed by the pipeline's front half; councilSelection reserved for sub-project 2 (inert here) (additive-optional, no schema bump)
```

- [ ] **Step 4: Add `seeds` to `BookSelection` and persist it**

In `gateway/src/services/book.ts`, after the `ensemble?` line (~line 54) inside `interface BookSelection`:

```ts
  seeds?: { storyArc?: string; characters?: string; world?: string; councilSelection?: 'auto' | 'propose' };  // Romance Workflow Foundation — persisted on the manifest, developed by the pipeline front half
```

In the `manifest` object literal in `create()`, after the `...(sel.ensemble ? { ensemble: sel.ensemble } : {}),` line (~line 365):

```ts
      ...(sel.seeds ? { seeds: sel.seeds } : {}),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test tests/unit/book-seeds.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add gateway/src/services/book-types.ts gateway/src/services/book.ts tests/unit/book-seeds.test.ts
git commit -m "feat(books): persist romance author seeds on the book manifest"
```

---

## Task 3: Route plumbing — accept seeds at create, thread them at run

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts` (~line 594 parse/validate; ~line 597 pass into `create()`)
- Modify: `gateway/src/api/routes/projects.routes.ts:181` (spread `manifest.seeds` into `seqContext`)
- Modify (lockstep, if seeds surfaced): `mcp/` create_book tool
- Test: `tests/romance-seed-smoke.sh`

**Interfaces:**
- Consumes: `BookSelection.seeds` (Task 2), `manifest.seeds` (Task 2), the two pipelines (Task 1).
- Produces: `POST /api/books` accepts optional `storyArc`, `characters`, `world`, `councilSelection` (strings; `councilSelection` ∈ `{auto, propose}`) and stores them under `manifest.seeds`. `POST /api/projects` (book-sequence branch) resolves them from the opened manifest into project `context`, so the pipeline's `{{storyArc}}` etc. interpolate.

- [ ] **Step 1: Write the failing end-to-end smoke**

Create `tests/romance-seed-smoke.sh` (model structure + `-v` handling on an existing smoke, e.g. `tests/sequence-smoke.sh`):

```bash
#!/usr/bin/env bash
# Romance Foundation seed round-trip: create a book with seeds on romance-sweet-full,
# run its sequence, and assert the seed text lands in the resulting project step prompts.
set -euo pipefail
VERBOSE=0; [[ "${1:-}" == "-v" ]] && VERBOSE=1
PORT=3878
TOKEN="romance-seed-smoke-token"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$(mktemp)"
BOOKCLAW_AUTH_TOKEN="$TOKEN" BOOKCLAW_BIND=127.0.0.1 PORT="$PORT" \
  node --import tsx "$ROOT/gateway/src/index.ts" >"$LOG" 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null || true; [[ "$VERBOSE" == 1 ]] && { echo '--- server log ---'; cat "$LOG"; }; rm -f "$LOG"; }
trap cleanup EXIT
for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/status" -H "Authorization: Bearer $TOKEN" >/dev/null && break; sleep 1; done

H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
ARC="ARC_MARKER rivals-to-lovers over one summer"

# 1) create the book with seeds
BOOK=$(curl -sf "${H[@]}" -X POST "http://127.0.0.1:$PORT/api/books" -d "$(cat <<JSON
{ "title": "Seed Smoke Romance", "pipelineSequence": ["romance-sweet-full"],
  "author": "$(curl -sf "${H[@]}" "http://127.0.0.1:$PORT/api/library/author" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).entries[0].name))')",
  "voice": "$(curl -sf "${H[@]}" "http://127.0.0.1:$PORT/api/library/voice" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).entries[0].name))')",
  "storyArc": "$ARC", "characters": "CHAR_MARKER", "world": "WORLD_MARKER", "councilSelection": "auto" }
JSON
)")
SLUG=$(echo "$BOOK" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).book.slug))')
[[ -n "$SLUG" ]] || { echo "FAIL: no slug"; exit 1; }

# 2) make it active, then run its sequence
curl -sf "${H[@]}" -X POST "http://127.0.0.1:$PORT/api/books/$SLUG/activate" >/dev/null
RUN=$(curl -sf "${H[@]}" -X POST "http://127.0.0.1:$PORT/api/projects" -d '{"title":"Seed Smoke Romance","description":"seed round-trip"}')

# 3) assert the seed text is present in the first project's step prompts
echo "$RUN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const p=(r.projects||[r.project])[0];const blob=JSON.stringify(p.steps.map(x=>x.prompt));if(!blob.includes("ARC_MARKER")){console.error("FAIL: storyArc not woven into project steps");process.exit(1)}console.log("PASS: seeds threaded into project step prompts")}'
```

`chmod +x tests/romance-seed-smoke.sh`.

> Confirm the activate endpoint path (`POST /api/books/:slug/activate`) and the create-project response shape against `projects.routes.ts` before running; adjust the two `node -e` extractors if the field names differ. The book-sequence branch returns `{ projects: [...] }`; the fallback branch returns `{ project }` — the extractor handles both.

- [ ] **Step 2: Run the smoke to verify it fails**

Run: `bash tests/romance-seed-smoke.sh -v`
Expected: FAIL — `storyArc not woven` (seeds are persisted on the manifest by Task 2 but not yet read back into `seqContext`, and the route may not yet accept them).

- [ ] **Step 3: Accept + validate seeds on `POST /api/books`**

In `gateway/src/api/routes/books.routes.ts`, immediately before the `try {` at ~line 596 (after the `ensemble` validation block), add:

```ts
    // Romance Workflow Foundation: optional author seeds. Free-text prose fields
    // (developed by the pipeline front half); councilSelection is persisted but
    // inert in Foundation (reserved for the LLM Council sub-project).
    const seedStr = (v: unknown) => (typeof v === 'string' ? v : '');
    const councilSelection = seedStr(body.councilSelection);
    if (councilSelection && councilSelection !== 'auto' && councilSelection !== 'propose') {
      return res.status(400).json({ error: "councilSelection must be 'auto' or 'propose'" });
    }
    const seeds = { storyArc: seedStr(body.storyArc), characters: seedStr(body.characters), world: seedStr(body.world), ...(councilSelection ? { councilSelection: councilSelection as 'auto' | 'propose' } : {}) };
    const hasSeeds = seeds.storyArc || seeds.characters || seeds.world || councilSelection;
```

Then in the `services.books.create({ ... })` call at ~line 597, add to the spread list (alongside `...(ensemble ? { ensemble } : {})`):

```ts
, ...(hasSeeds ? { seeds } : {})
```

- [ ] **Step 4: Thread seeds into the project context at run time**

In `gateway/src/api/routes/projects.routes.ts`, the book-sequence branch (~line 176 opens the book; ~line 181 builds `seqContext`). Change the `seqContext` line to spread the manifest seeds in FIRST (so an explicit request `context` still wins if it ever sets the same key):

```ts
          const manifestSeeds = (opened?.manifest?.seeds ?? {}) as { storyArc?: string; characters?: string; world?: string };
          const seqContext = { storyArc: '', characters: '', world: '', ...manifestSeeds, ...(context || {}), ...resolvedConfig, ...(fmtGuide?.structureRail ? { structureRail: fmtGuide.structureRail } : {}) };
```

(Seeding empty defaults for `storyArc`/`characters`/`world` guarantees the vars resolve to `''` — never left undefined — even for a book created without seeds. `councilSelection` is intentionally NOT threaded — it drives no template in Foundation.)

- [ ] **Step 5: Run the smoke to verify it passes**

Run: `bash tests/romance-seed-smoke.sh -v`
Expected: `PASS: seeds threaded into project step prompts`.

- [ ] **Step 6: MCP lockstep — surface seeds on `create_book` (if exposed)**

Check whether the MCP `create_book` tool passes a body through to `POST /api/books`:

Run: `grep -rn "storyArc\|create_book\|/api/books" mcp/src`

If `create_book` has an explicit input schema (zod) enumerating book fields, add optional `storyArc`, `characters`, `world`, `councilSelection` string params passed straight through, in THIS commit (repo lockstep rule). If it forwards an arbitrary body (or seeding is only reachable via the generic `bookclaw_request` escape hatch), no change is needed — note that in the commit body. Rebuild + test MCP if changed:

Run: `cd mcp && npm run build && npm test`
Expected: PASS.

- [ ] **Step 7: Type-check + full unit suite**

Run: `npx tsc --noEmit && node --import tsx --test tests/unit/*.test.ts`
Expected: no type errors; all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add gateway/src/api/routes/books.routes.ts gateway/src/api/routes/projects.routes.ts tests/romance-seed-smoke.sh
# add mcp/ files only if Step 6 changed them
git commit -m "feat(romance): thread author seeds from /api/books through the manifest into project context"
```

---

## Task 4: Wire-up verification (no new code)

**Files:** none created; verifies decision #2 ("also as presets") and the end-to-end path.

- [ ] **Step 1: Confirm the two pipelines are library-resolvable and picker-visible**

Boot the gateway (or reuse the smoke's server) and:

Run: `curl -sf -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/api/library/pipeline | grep -o 'romance-sweet-full\|romance-spicy-full'`
Expected: both names present. The studio `NewBook.tsx` picker loads `/api/library/pipeline` (line 59–60), so they appear as selectable presets automatically — no frontend change. Confirm by loading the New ▸ book form if convenient.

- [ ] **Step 2: Update feature tracking**

Move the Foundation item from `docs/TODO.md` to `docs/COMPLETED.md` with today's date (`2026-07-08`), per the repo feature-tracking rule. If the Romance Workflow is tracked as one umbrella item, check the Foundation sub-item and leave Guided/Council/Adaptive pending.

- [ ] **Step 3: Write the `commit_message` file**

Per repo workflow, write a `commit_message` (short summary + dash detail lines) covering the Foundation batch, so the maintainer's `./push.sh` picks it up. (Do NOT `git commit`/`git push` — the per-task commits above are for local checkpointing during subagent-driven execution; reconcile with the maintainer's workflow before finalizing.)

---

## Self-Review

- **Spec coverage:** Two `romance-*-full` files (Task 1) ✓; seed contract fields `storyArc/characters/world/councilSelection` persisted (Task 2) + `heat` via pipeline selection + `chapterCount/wordsPerChapter` via existing vars ✓; seed→context threading via `buildPipelineVars` (Task 3 Step 4) ✓; `councilSelection` stored-but-inert ✓; production block verbatim reuse ✓; empty-seed clean collapse (Task 1 Step 1 test + Task 3 Step 4 empty defaults) ✓; scripted tests (unit + smoke) ✓; MCP lockstep (Task 3 Step 6) ✓; presets-visible decision #2 (Task 4 Step 1) ✓. Spec's three-step Revision intentionally collapsed to one — flagged in Task 1 for confirmation.
- **Type consistency:** `seeds` shape identical on `BookSelection` (book.ts) and `BookManifest` (book-types.ts); `manifestSeeds` in projects.routes reads the same three prose keys the pipelines consume; var names bare and matched to context keys throughout.
- **Placeholders:** none — the one deliberate `"<<< PASTE ... >>>"` marker is an explicit copy instruction with exact source lines, not a TODO.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-08-romance-foundation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
