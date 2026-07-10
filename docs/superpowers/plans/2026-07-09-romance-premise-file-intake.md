# Romance Premise-File Intake — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed a new romance novel from a free-form premise markdown file — extract structured seeds (including a new `blueprint` scaffold), research-ground and fact-check a real-world setting, surface gaps + discrepancies in a studio review gate, then create the book on the existing romance pipeline.

**Architecture:** A new `PremiseIntakeService` runs two AI/research passes (`parse` → seeds/gaps/realPlace; `ground` → setting dossier + premise fact-check/discrepancies). A new `POST /api/books/intake` endpoint returns their combined output. A studio "From Premise File" screen renders the review gate and then calls the *existing* `POST /api/books`. Fidelity is carried by one new seed field, `blueprint`, threaded through the shipped Foundation seed path and honored by the pipeline's outline step. No mid-pipeline gate — the review is entirely pre-creation.

**Tech Stack:** Node 22 + TypeScript (`--import tsx`, NodeNext `.js` imports), Express routes in `gateway/src/api/routes/`, the shipped AI router (`services.aiRouter.complete` / `.selectProvider`) and research lookup (`services.researchLookup.lookup`), static JSON pipelines in `library/pipelines/`, React studio in `frontend/studio/`, vendored MCP server in `mcp/`. Unit tests: `node --import tsx --test tests/unit/*.test.ts`. Smoke tests: bash under `tests/`.

## Global Constraints

- **Imports use `.js` extensions** even in `.ts` source (NodeNext). Match existing files.
- **Fail-soft init/runtime posture:** log `⚠`/`ℹ` and continue degraded; never crash the gateway. Missing seeds are the empty string, not an error.
- **Seed field is `setting`, never `world`** for romance (place/sensory texture, distinct from the World Repository `world` bind).
- **New seed field is `blueprint`, never `structure`** (`structure` is the existing narrative-structure preset field on `/api/books`).
- **MCP lockstep:** any new/changed `/api/books*` field surfaced through MCP must be updated in `mcp/` in the **same commit** as the gateway route.
- **No `git push`.** Per repo workflow, the maintainer commits via `./push.sh` + a `commit_message` file. In this plan, "Commit" steps mean staging a local git commit for review during subagent-driven execution; the final push is the maintainer's.
- **Discrepancies are advisory** — never auto-rewrite the premise; the author resolves each as *correct* (apply suggestion) or *keep intentional*.

**Reference spec:** `docs/superpowers/specs/2026-07-09-romance-premise-file-intake-design.md`.

---

### Task 1: `blueprint` seed — thread end-to-end + honor in the outline

Adds the `blueprint` seed to the shipped Foundation path (manifest type → route accept → project-context threading → both pipeline JSON outline steps). Independently testable: `blueprint` persists on the manifest and reaches the outline prompt.

**Files:**
- Modify: `gateway/src/services/book.ts:55` (manifest `seeds` type)
- Modify: `gateway/src/api/routes/books.routes.ts:599-605` (seed acceptance)
- Modify: `gateway/src/api/routes/projects.routes.ts:181-183` (context threading; apply to **every** `manifestSeeds` construction in the file)
- Modify: `library/pipelines/romance-sweet-full.json` (Chapter Outline step `promptTemplate`)
- Modify: `library/pipelines/romance-spicy-full.json` (Chapter Outline step `promptTemplate`)
- Test: `tests/unit/book-seeds.test.ts` (extend), `tests/unit/romance-full-pipeline.test.ts` (extend)

**Interfaces:**
- Produces: manifest `seeds.blueprint?: string`; context key `blueprint`; template var `{{blueprint}}` resolved in the outline step.

- [ ] **Step 1: Write the failing test — `blueprint` persists on the manifest**

In `tests/unit/book-seeds.test.ts`, extend the existing "persists seeds" test's payload and assertions:

```ts
const manifest = await books.create({
  title: 'Seeded Romance', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [],
  seeds: { storyArc: 'ARC_X', characters: 'CHAR_X', setting: 'SETTING_X', blueprint: 'BLUEPRINT_X', councilSelection: 'auto' },
} as any);
assert.deepEqual(manifest.seeds, { storyArc: 'ARC_X', characters: 'CHAR_X', setting: 'SETTING_X', blueprint: 'BLUEPRINT_X', councilSelection: 'auto' });

const onDisk = JSON.parse(readFileSync(join(root, 'workspace', 'books', manifest.slug, 'book.json'), 'utf-8'));
assert.equal(onDisk.seeds.blueprint, 'BLUEPRINT_X');
```

- [ ] **Step 2: Write the failing test — both outline steps weave `{{blueprint}}`**

In `tests/unit/romance-full-pipeline.test.ts`, add:

```ts
import { readFileSync } from 'node:fs';
for (const file of ['romance-sweet-full.json', 'romance-spicy-full.json']) {
  const pipe = JSON.parse(readFileSync(new URL(`../../library/pipelines/${file}`, import.meta.url), 'utf-8'));
  const outline = pipe.steps.find((s: any) => s.label === 'Chapter Outline');
  assert.ok(outline, `${file} has a Chapter Outline step`);
  assert.match(outline.promptTemplate, /\{\{blueprint\}\}/, `${file} outline weaves {{blueprint}}`);
  assert.match(outline.promptTemplate, /\{\{setupEnd\}\}/, `${file} outline keeps beat-var fallback`);
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --import tsx --test tests/unit/book-seeds.test.ts tests/unit/romance-full-pipeline.test.ts`
Expected: FAIL — manifest lacks `blueprint`; outline `promptTemplate` has no `{{blueprint}}`.

- [ ] **Step 4: Add `blueprint` to the manifest type**

`gateway/src/services/book.ts:55` — extend the seeds type:

```ts
  seeds?: { storyArc?: string; characters?: string; setting?: string; blueprint?: string; councilSelection?: 'auto' | 'propose' };  // Romance Workflow — developed by the pipeline front half; `blueprint` honored by the outline step
```

(No change needed at `book.ts:367` — `...(sel.seeds ? { seeds: sel.seeds } : {})` passes the whole object through.)

- [ ] **Step 5: Accept `blueprint` in the create route**

`gateway/src/api/routes/books.routes.ts` — in the seeds block (~599-605), add `blueprint` to the constructed object and the `hasSeeds` guard:

```ts
    const seeds = { storyArc: seedStr(body.storyArc), characters: seedStr(body.characters), setting: seedStr(body.setting), blueprint: seedStr(body.blueprint), ...(councilSelection ? { councilSelection: councilSelection as 'auto' | 'propose' } : {}) };
    const hasSeeds = seeds.storyArc || seeds.characters || seeds.setting || seeds.blueprint || councilSelection;
```

- [ ] **Step 6: Thread `blueprint` into project context**

`gateway/src/api/routes/projects.routes.ts` — at each `manifestSeeds` construction (starts ~181):

```ts
          const s = (opened?.manifest?.seeds ?? {}) as { storyArc?: string; characters?: string; setting?: string; blueprint?: string };
          const manifestSeeds = { storyArc: s.storyArc ?? '', characters: s.characters ?? '', setting: s.setting ?? '', blueprint: s.blueprint ?? '' };
```

- [ ] **Step 7: Weave `{{blueprint}}` into both outline steps**

In **both** `library/pipelines/romance-sweet-full.json` and `romance-spicy-full.json`, replace the Chapter Outline step's `promptTemplate` value with (single JSON line; `\n` literal escapes preserved):

```
Write the CHAPTER-BY-CHAPTER OUTLINE for "{{title}}" across {{chapterCount}} chapters. Use the premise, character bible and setting guide in your context. Map the romance beats onto the structure: meet-cute by Chapter {{setupEnd}}, inciting connection by Chapter {{incitingEnd}}, midpoint shift at Chapter {{midpoint}}, the black moment near Chapter {{twist75}}, and the grovel / reunion / HEA across Chapters {{climaxStart}}-{{climaxEnd}}. Follow your outline methodology. Output the outline only — one entry per chapter, no preamble or commentary.\n\nAuthor-provided structural blueprint — treat this as canon: reproduce its act breakdown, POV strategy, black-moment mechanic and ending faithfully, and generate only the beats it leaves unspecified. If the section below is blank, map the beats onto the structure yourself as described above.\nBlueprint:\n{{blueprint}}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --import tsx --test tests/unit/book-seeds.test.ts tests/unit/romance-full-pipeline.test.ts`
Expected: PASS. Then `npx tsc --noEmit` → no errors.

- [ ] **Step 9: Commit**

```bash
git add gateway/src/services/book.ts gateway/src/api/routes/books.routes.ts gateway/src/api/routes/projects.routes.ts library/pipelines/romance-sweet-full.json library/pipelines/romance-spicy-full.json tests/unit/book-seeds.test.ts tests/unit/romance-full-pipeline.test.ts
git commit -m "feat(romance): add blueprint seed, honored by the romance-full outline step"
```

---

### Task 2: `PremiseIntakeService.parse()` — doc → seeds + gaps + realPlace

The first intake pass: one structured-output AI call that maps a free-form premise into the seed set, a gap list, and real-place detection. The AI call is injected (like `knowledge.routes` injects `aiComplete`/`aiSelectProvider`) so the test is deterministic.

**Files:**
- Create: `gateway/src/services/premise-intake.ts`
- Test: `tests/unit/premise-intake.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3 & 4):

```ts
export type SeedField = 'storyArc' | 'characters' | 'setting' | 'blueprint' | 'heat' | 'chapterCount' | 'wordsPerChapter';
export interface IntakeSeeds { storyArc: string; characters: string; setting: string; blueprint: string; heat: 'sweet' | 'spicy'; chapterCount: number; wordsPerChapter: number; }
export interface IntakeGap { id: string; question: string; proposedAnswer: string; alternatives?: string[]; targetField: SeedField; }
export interface RealPlace { isReal: boolean; canonicalName?: string; }
export interface IntakeResult { seeds: IntakeSeeds; gaps: IntakeGap[]; realPlace: RealPlace; }

// Injected dependencies (decoupled from router.ts internal interfaces):
export type AiComplete = (req: { provider: string; system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number; thinking?: 'low' | 'medium' | 'high' }) => Promise<{ text: string }>;
export type AiSelectProvider = (taskType: string) => string;

export class PremiseIntakeService {
  constructor(aiComplete: AiComplete, aiSelectProvider: AiSelectProvider, researchLookup?: ResearchLookup);
  parse(premiseText: string): Promise<IntakeResult>;
}
```

- [ ] **Step 1: Write the failing test**

`tests/unit/premise-intake.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PremiseIntakeService } from '../../gateway/src/services/premise-intake.js';

const CANNED = JSON.stringify({
  seeds: { storyArc: 'Legacy vs new on LBI', characters: 'Gia; Cole; Gianni; cousin', setting: 'Surf City, Long Beach Boulevard; the bayside', blueprint: 'Act One rivalry+storm; POV-lock on Cole until Act Three; ending: Gianni\'s Morning Joint', heat: 'sweet', chapterCount: 40, wordsPerChapter: 2500 },
  gaps: [{ id: 'cousin-name', question: "Cousin's name?", proposedAnswer: 'Nina', alternatives: ['Rosa'], targetField: 'characters' }],
  realPlace: { isReal: true, canonicalName: 'Long Beach Island, New Jersey' },
});

test('parse maps a premise into seeds, gaps, and realPlace', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: CANNED }), () => 'gemini');
  const out = await svc.parse('# FERRARO\'S ...');
  assert.equal(out.seeds.heat, 'sweet');
  assert.equal(out.seeds.chapterCount, 40);
  assert.equal(out.realPlace.isReal, true);
  assert.equal(out.gaps[0].targetField, 'characters');
});

test('parse tolerates fenced/pre-amble JSON and defaults missing fields', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: 'Sure!\n```json\n{"seeds":{"storyArc":"x"}}\n```' }), () => 'gemini');
  const out = await svc.parse('thin premise');
  assert.equal(out.seeds.storyArc, 'x');
  assert.equal(out.seeds.characters, '');       // missing → empty string
  assert.equal(out.seeds.heat, 'sweet');         // default
  assert.deepEqual(out.gaps, []);
  assert.equal(out.realPlace.isReal, false);
});

test('parse throws a typed error on unparseable output', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: 'no json here' }), () => 'gemini');
  await assert.rejects(() => svc.parse('x'), /PREMISE_INTAKE_PARSE_FAILED/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/premise-intake.test.ts`
Expected: FAIL — module `premise-intake.js` not found.

- [ ] **Step 3: Implement `parse()`**

`gateway/src/services/premise-intake.ts` (types from the Interfaces block above, plus):

```ts
const PARSE_SYSTEM = `You convert a free-form romance premise document into a strict JSON seed set for a novel pipeline.
Rules:
- Preserve everything the author wrote; never invent plot the premise does not imply.
- Map sections: logline/theme -> storyArc; characters -> characters; setting -> setting (verbatim place notes); structure/POV/ending -> blueprint.
- Infer heat ('sweet' | 'spicy'), chapterCount, wordsPerChapter as suggestions.
- gaps[]: one per open choice the file flags PLUS implicit missing pieces needed to draft. Each has a proposedAnswer and a targetField (storyArc|characters|setting|blueprint|heat|chapterCount|wordsPerChapter).
- realPlace: is the setting a real, mappable location? If so give its canonicalName.
Output ONE JSON object and nothing else, matching:
{"seeds":{"storyArc","characters","setting","blueprint","heat","chapterCount","wordsPerChapter"},"gaps":[{"id","question","proposedAnswer","alternatives"?,"targetField"}],"realPlace":{"isReal","canonicalName"?}}`;

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(raw); } catch { throw new Error('PREMISE_INTAKE_PARSE_FAILED'); }
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class PremiseIntakeService {
  constructor(private aiComplete: AiComplete, private aiSelectProvider: AiSelectProvider, private researchLookup?: ResearchLookup) {}

  async parse(premiseText: string): Promise<IntakeResult> {
    const provider = this.aiSelectProvider('book_bible');
    const { text } = await this.aiComplete({ provider, system: PARSE_SYSTEM, messages: [{ role: 'user', content: premiseText }], maxTokens: 8000, thinking: 'medium' });
    const j = extractJson(text);
    const s = j?.seeds ?? {};
    const seeds: IntakeSeeds = {
      storyArc: str(s.storyArc), characters: str(s.characters), setting: str(s.setting), blueprint: str(s.blueprint),
      heat: s.heat === 'spicy' ? 'spicy' : 'sweet', chapterCount: num(s.chapterCount, 40), wordsPerChapter: num(s.wordsPerChapter, 2500),
    };
    const gaps: IntakeGap[] = Array.isArray(j?.gaps) ? j.gaps.filter((g: any) => g && typeof g.id === 'string').map((g: any) => ({
      id: str(g.id), question: str(g.question), proposedAnswer: str(g.proposedAnswer),
      ...(Array.isArray(g.alternatives) ? { alternatives: g.alternatives.map(str) } : {}),
      targetField: (['storyArc','characters','setting','blueprint','heat','chapterCount','wordsPerChapter'].includes(g.targetField) ? g.targetField : 'blueprint') as SeedField,
    })) : [];
    const realPlace: RealPlace = j?.realPlace?.isReal ? { isReal: true, canonicalName: str(j.realPlace.canonicalName) || undefined } : { isReal: false };
    return { seeds, gaps, realPlace };
  }
}
```

Add the `ResearchLookup` type (used by the constructor now, `ground()` in Task 3):

```ts
export interface ResearchLookup { lookup(query: string, opts?: { maxWords?: number }): Promise<{ answer: string; citations: Array<{ title: string; url?: string }>; hasVerifiedSources: boolean }>; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/premise-intake.test.ts`
Expected: PASS (3 tests). Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/premise-intake.ts tests/unit/premise-intake.test.ts
git commit -m "feat(romance): PremiseIntakeService.parse — premise doc to seeds/gaps/realPlace"
```

---

### Task 3: `PremiseIntakeService.ground()` — setting dossier + premise fact-check

The second pass: for a real place, research it (via injected `researchLookup`), compose a setting dossier, and audit the premise's asserted real-world facts into `discrepancies[]`. Fail-soft when research is unavailable.

**Files:**
- Modify: `gateway/src/services/premise-intake.ts` (add `ground()` + grounding types)
- Test: `tests/unit/premise-grounding.test.ts`

**Interfaces:**
- Consumes: `RealPlace` (Task 2), injected `ResearchLookup` (Task 2), `AiComplete` (Task 2).
- Produces (consumed by Task 4):

```ts
export interface Discrepancy { id: string; premiseClaim: string; finding: string; status: 'pass' | 'fail'; suggestion?: string; targetField: 'setting' | 'blueprint' | 'characters'; }
export type GroundingStatus = 'grounded' | 'fallback-llm' | 'skipped';
export interface GroundingResult { dossier: string; discrepancies: Discrepancy[]; status: GroundingStatus; citations: Array<{ title: string; url?: string }>; }
// method: ground(setting: string, realPlace: RealPlace, premiseText: string): Promise<GroundingResult>
```

- [ ] **Step 1: Write the failing test**

`tests/unit/premise-grounding.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PremiseIntakeService } from '../../gateway/src/services/premise-intake.js';

const research = { lookup: async () => ({ answer: 'LBI towns: Surf City, Ship Bottom, Beach Haven. Main road: Long Beach Boulevard. Ocean east, bay west.', citations: [{ title: 'LBI', url: 'https://example.org/lbi' }], hasVerifiedSources: true }) };
const groundingJson = JSON.stringify({
  dossier: '# Long Beach Island\nTowns: Surf City...\n',
  discrepancies: [
    { id: 'd1', premiseClaim: 'Ferraro\'s on Surf City, Long Beach Boulevard', finding: 'Surf City and Long Beach Boulevard are real and correctly placed', status: 'pass', targetField: 'setting' },
    { id: 'd2', premiseClaim: 'shop on Beachfront Ave', finding: 'No Beachfront Ave on LBI', status: 'fail', suggestion: 'Long Beach Boulevard', targetField: 'setting' },
  ],
});

test('ground skips when the place is not real', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: groundingJson }), () => 'gemini', research);
  const out = await svc.ground('a made-up kingdom', { isReal: false }, 'premise');
  assert.equal(out.status, 'skipped');
  assert.deepEqual(out.discrepancies, []);
});

test('ground produces a dossier + pass/fail discrepancies for a real place', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: groundingJson }), () => 'gemini', research);
  const out = await svc.ground('Surf City...', { isReal: true, canonicalName: 'Long Beach Island, NJ' }, 'premise');
  assert.equal(out.status, 'grounded');
  assert.match(out.dossier, /Long Beach Island/);
  assert.equal(out.discrepancies.find(d => d.id === 'd2')?.status, 'fail');
  assert.equal(out.discrepancies.find(d => d.id === 'd2')?.suggestion, 'Long Beach Boulevard');
});

test('ground falls back when research is unavailable', async () => {
  const svc = new PremiseIntakeService(async () => ({ text: groundingJson }), () => 'gemini', undefined);
  const out = await svc.ground('Surf City...', { isReal: true, canonicalName: 'LBI' }, 'premise');
  assert.equal(out.status, 'fallback-llm');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/unit/premise-grounding.test.ts`
Expected: FAIL — `ground` is not a function.

- [ ] **Step 3: Implement `ground()`**

Add to `PremiseIntakeService` in `gateway/src/services/premise-intake.ts`:

```ts
  async ground(setting: string, realPlace: RealPlace, premiseText: string): Promise<GroundingResult> {
    if (!realPlace.isReal) return { dossier: setting, discrepancies: [], status: 'skipped', citations: [] };

    let researchText = ''; let citations: Array<{ title: string; url?: string }> = []; let status: GroundingStatus = 'fallback-llm';
    if (this.researchLookup) {
      try {
        const r = await this.researchLookup.lookup(`Real geography of ${realPlace.canonicalName}: towns, main roads, orientation to water, notable public landmarks, seasonal economy.`, { maxWords: 500 });
        researchText = r.answer; citations = r.citations ?? []; status = r.hasVerifiedSources ? 'grounded' : 'fallback-llm';
      } catch { status = 'fallback-llm'; }
    }

    const system = `You build a factual SETTING DOSSIER for a novelist and audit the premise's real-world claims.
Given RESEARCH (may be empty) and the PREMISE, output ONE JSON object:
{"dossier": "<markdown place bible: real towns, roads, geography, seasonal texture; place FICTIONAL businesses on real streets; never assert a real private business as a story location>",
 "discrepancies": [{"id","premiseClaim","finding","status":"pass|fail","suggestion"?,"targetField":"setting|blueprint|characters"}]}
Audit ONLY real-world facts the PREMISE asserts (street names, town placement, geography). Record verified facts as status "pass" and errors as status "fail" with a suggestion. A fictional business is NOT a discrepancy; a wrong real street/town IS. Never rewrite the premise.`;
    const provider = this.aiSelectProvider('book_bible');
    const { text } = await this.aiComplete({ provider, system, messages: [{ role: 'user', content: `RESEARCH:\n${researchText || '(none available)'}\n\nPREMISE:\n${premiseText}` }], maxTokens: 8000, thinking: 'medium' });

    let j: any; try { j = extractJson(text); } catch { j = { dossier: researchText || setting, discrepancies: [] }; }
    const discrepancies: Discrepancy[] = Array.isArray(j?.discrepancies) ? j.discrepancies.filter((d: any) => d && typeof d.id === 'string').map((d: any) => ({
      id: str(d.id), premiseClaim: str(d.premiseClaim), finding: str(d.finding), status: d.status === 'fail' ? 'fail' : 'pass',
      ...(d.suggestion ? { suggestion: str(d.suggestion) } : {}),
      targetField: (['setting','blueprint','characters'].includes(d.targetField) ? d.targetField : 'setting') as Discrepancy['targetField'],
    })) : [];
    return { dossier: str(j?.dossier) || researchText || setting, discrepancies, status, citations };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/unit/premise-grounding.test.ts`
Expected: PASS (3 tests). Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/services/premise-intake.ts tests/unit/premise-grounding.test.ts
git commit -m "feat(romance): PremiseIntakeService.ground — setting dossier + premise fact-check"
```

---

### Task 4: `POST /api/books/intake` endpoint

Wires `parse` + `ground` behind one endpoint using the real `services.aiRouter` and `services.researchLookup`, returning everything the review gate needs. Book *creation* still goes through the existing `POST /api/books`.

**Files:**
- Modify: `gateway/src/api/routes/books.routes.ts` (add the route; import the service)
- Create: `tests/romance-premise-intake-smoke.sh`
- Modify: `package.json` (add `test:intake-smoke` script mirroring existing smoke scripts) *(fold into this task; no separate commit)*

**Interfaces:**
- Consumes: `PremiseIntakeService` (Tasks 2-3), `services.aiRouter.complete`, `services.aiRouter.selectProvider`, `services.researchLookup` (optional).
- Produces: `POST /api/books/intake` → `200 { seeds, gaps, discrepancies, realPlace, groundingStatus }`; `400` on missing/oversized text; `500 { error }` on `PREMISE_INTAKE_PARSE_FAILED`.

- [ ] **Step 1: Write the failing smoke test**

`tests/romance-premise-intake-smoke.sh` (model on `tests/romance-seed-smoke.sh`; boot the gateway with a known `BOOKCLAW_AUTH_TOKEN`, loopback bind, `-v` streams the log). Core assertions:

```bash
# POST a small premise and assert the response shape
RESP=$(curl -s -X POST "$BASE/api/books/intake" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  --data '{"premise":"# Test\nA baker on Long Beach Island, NJ (Surf City, Long Beach Boulevard) rivals a cafe owner. Open choice: the cousin is unnamed."}')
echo "$RESP" | grep -q '"seeds"'        || { echo "FAIL: no seeds"; exit 1; }
echo "$RESP" | grep -q '"gaps"'         || { echo "FAIL: no gaps"; exit 1; }
echo "$RESP" | grep -q '"discrepancies"'|| { echo "FAIL: no discrepancies"; exit 1; }
echo "$RESP" | grep -q '"realPlace"'    || { echo "FAIL: no realPlace"; exit 1; }
# Empty premise -> 400
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/books/intake" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"premise":""}')
[ "$CODE" = "400" ] || { echo "FAIL: empty premise not 400 (got $CODE)"; exit 1; }
echo "PASS"
```

- [ ] **Step 2: Run smoke to verify it fails**

Run: `bash tests/romance-premise-intake-smoke.sh`
Expected: FAIL — route 404s (no `/api/books/intake`).

- [ ] **Step 3: Implement the route**

In `gateway/src/api/routes/books.routes.ts`, add near the other book POST routes:

```ts
import { PremiseIntakeService } from '../../services/premise-intake.js';

router.post('/books/intake', async (req, res) => {
  const premise = typeof req.body?.premise === 'string' ? req.body.premise.trim() : '';
  if (!premise) return res.status(400).json({ error: 'premise text is required' });
  if (premise.length > 200_000) return res.status(400).json({ error: 'premise is too large (200k char limit)' });
  try {
    const svc = new PremiseIntakeService(
      (r) => services.aiRouter.complete(r as any),
      (t) => services.aiRouter.selectProvider(t),
      services.researchLookup ? { lookup: (q, o) => services.researchLookup!.lookup(q, o) } : undefined,
    );
    const intake = await svc.parse(premise);
    const grounding = await svc.ground(intake.seeds.setting, intake.realPlace, premise);
    const seeds = { ...intake.seeds, setting: grounding.dossier };
    return res.json({ seeds, gaps: intake.gaps, discrepancies: grounding.discrepancies, realPlace: intake.realPlace, groundingStatus: grounding.status });
  } catch (err: any) {
    if (String(err?.message).includes('PREMISE_INTAKE_PARSE_FAILED')) return res.status(500).json({ error: 'Could not parse the premise into structured seeds. Try a clearer document or create the book manually.' });
    console.log(`  ⚠ premise intake failed: ${err?.message ?? err}`);
    return res.status(500).json({ error: 'Premise intake failed' });
  }
});
```

Add a `package.json` script alongside the other smokes: `"test:intake-smoke": "bash tests/romance-premise-intake-smoke.sh"`.

- [ ] **Step 4: Run smoke to verify it passes**

Run: `bash tests/romance-premise-intake-smoke.sh -v`
Expected: PASS (needs at least one working AI provider configured in the run env; the `-v` log shows the provider used). Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/api/routes/books.routes.ts tests/romance-premise-intake-smoke.sh package.json
git commit -m "feat(romance): POST /api/books/intake — parse + ground a premise file into a review payload"
```

---

### Task 5: MCP lockstep — `blueprint` on `create_book` + `premise_intake` tool

Keep the vendored MCP server in lockstep with the new field and endpoint.

**Files:**
- Modify: `mcp/src/tools/books.ts` (add `blueprint` to `create_book`; register `premise_intake`)
- Test: `cd mcp && npm run build && npm test`

**Interfaces:**
- Consumes: `POST /api/books` (now accepts `blueprint`), `POST /api/books/intake` (Task 4).

- [ ] **Step 1: Add `blueprint` to `create_book`**

`mcp/src/tools/books.ts` — in the `create_book` input schema (next to `storyArc`, ~line 43):

```ts
        blueprint: z.string().optional().describe('Author-provided structural blueprint (act breakdown, POV strategy, ending); honored by the outline step, developed (not discarded) by the pipeline'),
```

- [ ] **Step 2: Register the `premise_intake` tool**

In the same file, register:

```ts
  server.registerTool('premise_intake',
    { description: 'Parse a free-form romance premise document into structured seeds, gaps, and a fact-checked setting dossier for review before creating a book.',
      inputSchema: { premise: z.string().describe('The premise markdown document') } },
    async (args) => toToolResult('premise_intake', await client.request('POST', '/api/books/intake', args)),
  );
```

- [ ] **Step 3: Build + test the MCP package**

Run: `cd mcp && npm install && npm run build && npm test`
Expected: build succeeds, tests pass.

- [ ] **Step 4: Commit**

```bash
git add mcp/src/tools/books.ts
git commit -m "feat(mcp): blueprint on create_book + premise_intake tool (lockstep with /api/books/intake)"
```

---

### Task 6: Studio "From Premise File" review gate

The UI: a New ▸ Advanced ▸ From Premise File screen that uploads/pastes a premise, calls `/api/books/intake`, renders the review gate (editable seeds + grounded dossier + discrepancies + gaps), and on confirm POSTs the finalized seeds to `/api/books`.

**Files:**
- Create: `frontend/studio/src/routes/PremiseIntake.tsx`
- Modify: the studio router + the New/Advanced menu (follow the existing NewBook wiring in `frontend/studio/src/routes/NewBook.tsx` and wherever routes/menu items are registered)
- Verify: `tests/unit/studio-build.test.ts` (existing build-then-assert) + manual

**Interfaces:**
- Consumes: `POST /api/books/intake` → `{ seeds, gaps, discrepancies, realPlace, groundingStatus }`; `POST /api/books` with finalized `{ title, author, voice, genre, pipelineSequence:[heat==='spicy'?'romance-spicy-full':'romance-sweet-full'], storyArc, characters, setting, blueprint, chapterCount, wordsPerChapter }`.

- [ ] **Step 1: Build the screen (state + fetch)**

Create `frontend/studio/src/routes/PremiseIntake.tsx`. Follow the auth-fetch + form patterns already in `NewBook.tsx`. Component behavior:
- A textarea + a `.md` file input that fills the textarea (`file.text()`).
- "Analyze" button → `POST /api/books/intake` with `{ premise }`; store the response in state; show a spinner while pending.
- On response: render editable text fields for `storyArc`, `characters`, `setting` (the dossier — large textarea, labelled "Grounded setting — verify against your local knowledge"), `blueprint`; number inputs for `chapterCount`/`wordsPerChapter`; a sweet/spicy toggle bound to `seeds.heat`.
- If `groundingStatus === 'fallback-llm'`, render a warning banner: "Research unavailable — geography could not be verified; check carefully."
- Render `discrepancies`: `pass` items as a muted "verified" list; each `fail` item as a card showing `premiseClaim` → `finding`, a suggestion button ("Apply: <suggestion>" → splice into the named `targetField`) and a "Keep intentional" button. Track each failed discrepancy's resolution in state.
- Render `gaps`: each as a labelled control — proposed answer pre-filled (editable text), plus `alternatives` as quick-fill buttons. Track resolution.

- [ ] **Step 2: Finalize + create**

- "Start Book" is disabled until every gap and every `fail` discrepancy is resolved.
- On click, deterministically splice resolved answers into their `targetField` (append gap answers to the field text with a clear label, e.g. `\n\n[cousin's name] Nina`; apply accepted discrepancy suggestions), then `POST /api/books` with the finalized seeds + the heat-selected `pipelineSequence`. On success, navigate to the book board (as NewBook does).

- [ ] **Step 3: Wire the entry point**

Register the route and add "From Premise File" under the New ▸ Advanced menu (mirror how Easy/NewBook is registered). Keep labels consistent with the spec's tree.

- [ ] **Step 4: Build + verify**

Run: `npm run build:frontend` then `node --import tsx --test tests/unit/studio-build.test.ts`
Expected: build succeeds; studio-build assertion passes.

Manual verification (record result): start the gateway, open the studio, New ▸ Advanced ▸ From Premise File, paste `research/ferraros-premise.md`, click Analyze. Confirm: seeds populate; the grounded LBI dossier appears; explicit gaps (cousin name, storm name, etc.) list with proposals; Surf City / Long Beach Boulevard show as verified; Start Book stays disabled until gaps are resolved; creating the book lands a `romance-sweet-full` project whose outline prompt contains the blueprint.

- [ ] **Step 5: Commit**

```bash
git add frontend/studio/src/routes/PremiseIntake.tsx frontend/studio/src/  # + touched router/menu files
git commit -m "feat(studio): From Premise File review gate (seeds + grounded setting + discrepancies + gaps)"
```

---

## Feature tracking

- [ ] Add a "Romance Premise-File Intake" entry to `docs/TODO.md` under the existing "Romance Workflow" section before starting; move it to `docs/COMPLETED.md` with the completion date when Task 6 lands. (Per repo CLAUDE.md feature-tracking rule.)

## Self-Review (completed against the spec)

- **Spec coverage:** Fidelity/`blueprint` honoring → Task 1. Intake (seeds/gaps/realPlace) → Task 2. Grounding + fact-check/discrepancies (advisory, pass+fail, artistic-license) → Task 3. `/api/books/intake` (+ shape, fail-soft, 400s) → Task 4. MCP lockstep (`blueprint` + `premise_intake`) → Task 5. Studio review gate (editable seeds, dossier centerpiece, discrepancy resolution, gap gating, finalize-splice, entry point) → Task 6. Testing requirements → Tasks 1-4 tests + Task 6 manual/build. Fail-soft (research unavailable, invented setting, malformed doc, empty gaps) → Tasks 3-4.
- **Placeholder scan:** none — every code/test step carries concrete content.
- **Type consistency:** `IntakeSeeds`/`IntakeGap`/`RealPlace`/`IntakeResult`/`Discrepancy`/`GroundingResult`/`GroundingStatus` are defined in Tasks 2-3 and consumed unchanged in Task 4; `blueprint` naming and the `SeedField`/`targetField` union match across tasks; injected `AiComplete`/`AiSelectProvider`/`ResearchLookup` signatures match the real `services.aiRouter.complete` / `.selectProvider` / `services.researchLookup.lookup` shapes.
- **Open items deferred to implementation (from the spec):** exact task tier for the AI calls (plan uses `book_bible`; adjust if routing demands), and the precise studio router/menu file paths (Task 6 Step 3 instructs to follow the existing NewBook registration).
