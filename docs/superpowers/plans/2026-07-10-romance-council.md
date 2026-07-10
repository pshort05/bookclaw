# Romance Workflow — LLM Council (sub-project 3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the romance-`{sweet,spicy}`-full pipelines an **LLM Council** front step that originates the *base story* (premise + relationship arc): generate N candidate base stories from the seeds, have an AI judge rank them, then either (`councilSelection: 'auto'`) run straight through on the judge's top pick with **no pause**, or (`'propose'`) **pause the project, surface the ranked candidates + the AI recommendation, and resume from the base story the user picks**. This introduces the first genuine mid-pipeline **pause-resume selection gate** into an engine that today auto-executes start to finish — additively, gated, and with auto-mode and every non-romance/non-propose project behaving **exactly as today**.

**Architecture.** Four load-bearing pieces, each modelled on existing prior art so the risky part is small:

1. **`CouncilService`** (`gateway/src/services/council.ts`) — an injected-AI service exactly like the shipped `PremiseIntakeService` (`gateway/src/services/premise-intake.ts:11-39`): a constructor taking `aiComplete` / `aiSelectProvider`, an `originate(seeds)` method that fans out N candidate generations (`Promise.all` across N provider/model configs — the same multi-model diversity as `library/pipelines/editorial-outline-council.json`, but in-service so it is deterministically unit-testable) and then one **judge** call that ranks + recommends. Pure, no engine coupling.
2. **A shared step-dispatch helper** (`gateway/src/services/council-gate.ts`, modelled on `gateway/src/services/human-review.ts`) that BOTH drivers call at the exact site they call `isHumanReviewStep` today. This is the single point that decides auto-complete vs. pause — so the two drivers **cannot diverge** (the known "wired into routes but not `startAndRunProject`" bug class is eliminated by construction).
3. **Engine pause-resume state** — a new optional `Project.selection` field (mirrors the existing `Project.review`, `gateway/src/services/projects.ts:85`) plus `applyCouncilSelection` / `clearCouncilSelection` (mirror `applyReviewResume` / `clearReview`, `projects.ts:986-1028`). **No new project `status` value** — we reuse `'paused'` and distinguish a council pause by the presence of `project.selection`, exactly as the Human Review gate reuses `'paused'` + `project.review`. (Rationale + the rejected alternative are in Global Constraints.)
4. **The pipeline hook** — one new step at the FRONT of both `romance-*-full.json` pipelines, marked `skill: 'council-origination'` (a marker skill, mirroring `human-review`), `phase: 'premise'`. When the driver reaches it the shared helper runs the council; the chosen base story is written as that step's **`result`**, which `buildProjectContext` already injects into the downstream Premise step as "Prior Premise Work" (`projects.ts:1795`) — so the base story reaches Premise→Bible→Outline through the **existing** step-result chaining, with no new template interpolation (prompts are interpolated once at creation, `projects.ts:837-838`, so a `{{baseStory}}` var would be too early).

**Tech Stack:** Node 22 + TypeScript (`--import tsx`, NodeNext `.js` imports), Express routes in `gateway/src/api/routes/`, the shipped AI router (`services.aiRouter.complete` / `.selectProvider`), static JSON pipelines in `library/pipelines/`, React studio in `frontend/studio/`, vendored MCP server in `mcp/`. Unit tests: `node --import tsx --test tests/unit/*.test.ts` (inject AI for determinism). Smoke tests: bash under `tests/`.

## Global Constraints

- **Imports use `.js` extensions** even in `.ts` source (NodeNext). Match existing files.
- **Fail-soft init/runtime posture:** log `⚠`/`ℹ` and continue degraded; never crash the gateway. A council-service failure must degrade to today's behavior (generate premise from seeds directly), not abort the run.
- **PRODUCTION SAFETY IS THE FIRST REQUIREMENT.** This ships to Neptune with 23 live books. Every change is additive-optional. The gate engages **only** for a project whose active step is a `council-origination` step **and** `project.context.councilSelection === 'propose'`. Auto mode, every existing pipeline (none contains a council step until Task 5), and every non-romance project take **byte-for-byte today's path**.
- **No new `status` value (decision, not oversight).** The `Project.status` union (`projects.ts:67`) is switched on in dozens of places (drivers, list filters, persistence, studio). Adding `'awaiting-selection'` would touch all of them — unnecessary risk on a live instance. The shipped Human Review gate already proves the pattern: it reuses `'paused'` and keys off `project.review`. We do the same with `project.selection`. A pause with `selection` set is an "awaiting-selection" pause; the API/UI report it as such via a derived `awaitingSelection` boolean, never a new status.
- **Both drivers, one helper.** The auto-vs-propose decision lives in ONE function (`maybeRunCouncilStep`, Task 3) imported by both `/auto-execute` (`gateway/src/api/routes/projects.routes.ts:848`) and `startAndRunProject` (`gateway/src/index.ts:2248`). Do not inline the logic in either driver.
- **Seed field is `setting`, never `world`** for romance (place/sensory texture). **`blueprint`** is the act/POV/ending scaffold seed. Both are already shipped (Foundation + Premise-Intake).
- **MCP lockstep:** any new/changed `/api/*` surface must be updated in `mcp/` in the **same commit** as the gateway route.
- **No `git push`.** "Commit" steps stage a local commit for review during subagent-driven execution; the maintainer pushes via `./push.sh` + `commit_message`.
- **Council originates the base story = premise + relationship arc, NOT the full outline** (design decision 7, `docs/superpowers/specs/2026-07-08-romance-workflow-design.md:50-63`).

**Reference spec:** `docs/superpowers/specs/2026-07-08-romance-workflow-design.md` (decision 7, lines 50-63).

**Prior art anchors (read before starting):**
- Injected-AI service to copy: `gateway/src/services/premise-intake.ts:11-39`.
- Multi-model fan-out to echo: `library/pipelines/editorial-outline-council.json` (parallel candidate rounds → synthesis).
- Pause-resume machinery to mirror: `gateway/src/services/human-review.ts` (`openReviewGate:81`, `resolveReviewGates:131`, `isHumanReviewStep:64`) and `gateway/src/services/projects.ts` (`Project.review:85`, `applyReviewResume:986`, `clearReview:1022`, `parkForReview:1055`).
- Driver gate sites (where to add the council check): `projects.routes.ts:811` (the `project.review` 409 guard) + `:848` (`isHumanReviewStep` dispatch); `index.ts:2248` (`isHumanReviewStep` dispatch).
- Resume-driver to reuse for the select endpoint: `projects.routes.ts:1470` (`driveResumedProject`) — fire-and-forget drive after resume.
- Step-result → downstream-context chaining: `projects.ts:1545` (`buildProjectContext`), premise-phase injection at `:1795` ("Prior Premise Work").
- Context threading site (must add `councilSelection`): `projects.routes.ts:181-183` (`manifestSeeds` → `seqContext`).
- Front-half pipeline shape (insert point): `romance-sweet-full.json` steps are `[Premise, Character Bible, Setting, Chapter Outline, {expand:chapters}, Continuity, Compile]` — the council step becomes index 0.

---

### Task 1: `CouncilService.originate()` — candidates + judge (pure, injected AI)

The council brain: from the seeds, fan out N candidate base stories across N model configs, then one judge call that ranks and recommends. Injected `aiComplete` / `aiSelectProvider` (copy `premise-intake.ts:11-12,35`) make it deterministic. No engine coupling — fully unit-testable in isolation, zero production risk.

**Files:**
- Create: `gateway/src/services/council.ts`
- Test: `tests/unit/council-service.test.ts`

**Interfaces:**

```ts
// gateway/src/services/council.ts
export type AiComplete = (req: { provider: string; system: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; maxTokens?: number; thinking?: 'low' | 'medium' | 'high' }) => Promise<{ text: string }>;
export type AiSelectProvider = (taskType: string) => { id: string };

export interface CouncilSeeds { storyArc: string; characters: string; setting: string; blueprint: string; heat: 'sweet' | 'spicy'; title?: string; }
export interface CouncilCandidate { id: string; model: string; premise: string; relationshipArc: string; text: string; } // `text` = the assembled base story injected downstream
export interface CouncilRanking { id: string; rank: number; rationale: string; }
export interface CouncilResult { candidates: CouncilCandidate[]; ranking: CouncilRanking[]; recommendedId: string; rationale: string; }

// N model configs — 3 by default; degrade to fewer if providers are missing.
export interface CouncilModel { provider: string; model?: string; }

export class CouncilService {
  constructor(aiComplete: AiComplete, aiSelectProvider: AiSelectProvider, models?: CouncilModel[]);
  originate(seeds: CouncilSeeds): Promise<CouncilResult>;
}
```

Behavior:
- `originate` builds one generation prompt from the seeds (weave `storyArc`/`characters`/`setting`/`blueprint`/`heat`, expand-phrasing: "develop, preserve, fill gaps — do not discard or contradict"). Fans out over `models` (default 3) with `Promise.all`, each returning a candidate; a per-candidate failure is dropped (fail-soft) rather than aborting, as long as ≥1 survives.
- Each generation asks for a strict JSON `{ premise, relationshipArc }`; `text` is assembled as `"PREMISE\n<premise>\n\nRELATIONSHIP ARC\n<relationshipArc>"`. Tolerant JSON extraction (copy `premise-intake.ts` `extractJson` + `str` helpers).
- The judge call (single `aiComplete`, `aiSelectProvider('book_bible').id`) receives all surviving candidates and returns `{ ranking:[{id,rank,rationale}], recommendedId, rationale }`. Defensive: if the judge output is unparseable or `recommendedId` is not among the candidates, fall back to `candidates[0].id` (log `ℹ`).
- If **all** generations fail, throw `Error('COUNCIL_ORIGINATION_FAILED')` (the driver catches this and degrades — Task 3/4).

- [ ] **Step 1: Write the failing test**

`tests/unit/council-service.test.ts` — a canned `aiComplete` that returns a candidate JSON on generation calls and a ranking JSON on the judge call (discriminate by a marker in `system`). Assert:
  - 3 models → 3 candidates, each with non-empty `premise`, `relationshipArc`, `text` containing both.
  - `recommendedId` is one of the candidate ids; `ranking` covers every candidate.
  - A model whose `aiComplete` rejects is dropped, and `originate` still returns with the survivors (≥1).
  - Judge output naming a non-existent id → `recommendedId` falls back to `candidates[0].id`.
  - All generations reject → `assert.rejects(..., /COUNCIL_ORIGINATION_FAILED/)`.

- [ ] **Step 2: Run test to verify it fails** — `node --import tsx --test tests/unit/council-service.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `council.ts`** per the Interfaces + Behavior above. Reuse `extractJson`/`str` shapes from `premise-intake.ts`.
- [ ] **Step 4: Run test to verify it passes** — then `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(romance): CouncilService — candidate base-story fan-out + AI judge`.

---

### Task 2: Engine pause-resume state — `Project.selection` + resume methods

Add the persisted selection state and its resolve methods to `ProjectEngine`, mirroring the Human Review gate. Purely additive: no existing run path reads `selection` yet, so behavior is unchanged until Task 4 wires the driver.

**Files:**
- Modify: `gateway/src/services/projects.ts` (the `Project` interface `:62-91`; new methods next to `applyReviewResume` `:986`)
- Test: `tests/unit/council-selection-state.test.ts`

**Interfaces:**

```ts
// on Project (projects.ts, alongside `review?` at :85) — additive-optional, no schemaVersion bump:
selection?: {
  stepId: string;                    // the council-origination step this gate parks on
  candidates: Array<{ id: string; model: string; premise: string; relationshipArc: string; text: string }>;
  ranking: Array<{ id: string; rank: number; rationale: string }>;
  recommendedId: string;
  rationale: string;
  createdAt: string;
};

// new ProjectEngine methods:
applyCouncilSelection(projectId: string, candidateId: string): void; // completeStep(stepId, chosen.text); status→active unless completed; delete selection; persist
clearCouncilSelection(projectId: string): void;                      // abandon — stays paused; delete selection; persist
```

`applyCouncilSelection` mirrors `applyReviewResume`'s approve branch (`projects.ts:1007-1014`): find `chosen = selection.candidates.find(c => c.id === candidateId)` (if missing → fall back to `recommendedId`; if still missing → no-op + log `⚠`), `this.completeStep(projectId, selection.stepId, chosen.text)`, `if (project.status !== 'completed') project.status = 'active'`, `delete project.selection`, `updatedAt`, `persistState()`.

- [ ] **Step 1: Write the failing test** `tests/unit/council-selection-state.test.ts`:
  - Construct an engine + a project with one `council-origination` step (status `active`) and a downstream premise step; hand-set `project.selection` with 3 candidates + `recommendedId`.
  - `applyCouncilSelection(id, candidates[1].id)` → the council step is `completed` with `result === candidates[1].text`; `project.selection` is gone; `status === 'active'`; the premise step is now the active frontier (via `completeStep`).
  - `applyCouncilSelection(id, 'bogus')` → falls back to `recommendedId`'s text.
  - `clearCouncilSelection` → `selection` gone, status still `paused`.
  - State survives `persistState`/reload (mirror the existing persistence test pattern).
- [ ] **Step 2: Run → FAIL** (methods undefined).
- [ ] **Step 3: Implement** the field + two methods.
- [ ] **Step 4: Run → PASS**; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(romance): Project.selection state + applyCouncilSelection/clearCouncilSelection`.

---

### Task 3: `council-gate.ts` — the shared driver helper (auto vs. propose)

The single decision point both drivers call. Encapsulates: detect a council step, run the council once (idempotent on re-entry), then either auto-complete (auto) or park for selection (propose). Modelled on `human-review.ts` (`isHumanReviewStep`, `openReviewGate`, `maybeOpenCadenceGate`).

**Files:**
- Create: `gateway/src/services/council-gate.ts`
- Test: `tests/unit/council-gate.test.ts`

**Interfaces:**

```ts
// gateway/src/services/council-gate.ts
export const COUNCIL_SKILL = 'council-origination';
export function isCouncilStep(step: { skill?: string } | null | undefined): boolean { return step?.skill === COUNCIL_SKILL; }

interface EngineLike {
  getProject(id: string): any;
  completeStep(projectId: string, stepId: string, result: string): void;
  parkForReview(id: string): void;        // reused: sets status 'paused' without demoting steps (projects.ts:1055)
  persistState(): void;
}
interface Deps { engine: EngineLike; council: { originate(seeds: any): Promise<any> }; }

/**
 * Called by BOTH drivers at the site they call isHumanReviewStep. Returns:
 *   { handled:false }                      — not a council step; driver proceeds normally.
 *   { handled:true, gated:false }          — auto mode: step completed with the chosen base story; driver continues.
 *   { handled:true, gated:true }           — propose mode: project parked awaiting selection; driver STOPS.
 * Idempotent: if project.selection is already set (re-entry after park), returns gated:true without re-running the council.
 * Fail-soft: if council.originate throws (COUNCIL_ORIGINATION_FAILED), completes the step with a minimal
 * seed-derived base story and returns gated:false (degrade to today's straight-through behavior); logs ⚠.
 */
export async function maybeRunCouncilStep(deps: Deps, project: any, step: any): Promise<{ handled: boolean; gated: boolean }>;
```

Logic:
1. `if (!isCouncilStep(step)) return { handled: false, gated: false };`
2. `if (project.selection) { deps.engine.parkForReview(project.id); return { handled: true, gated: true }; }` — idempotent re-entry (a re-fired `/auto-execute` or a `startAndRunProject` retry finds the still-active step; do NOT regenerate).
3. Build `CouncilSeeds` from `project.context` (`storyArc`, `characters`, `setting`, `blueprint`, `heat` inferred from context/genre, `title`).
4. `let council; try { council = await deps.council.originate(seeds); } catch { /* degrade */ deps.engine.completeStep(project.id, step.id, seedFallbackBaseStory(seeds)); return { handled:true, gated:false }; }`
5. `const mode = project.context?.councilSelection === 'propose' ? 'propose' : 'auto';`
6. **auto:** `const pick = council.candidates.find(c => c.id === council.recommendedId) ?? council.candidates[0]; deps.engine.completeStep(project.id, step.id, pick.text); return { handled:true, gated:false };`
7. **propose:** set `project.selection = { stepId: step.id, candidates: council.candidates, ranking: council.ranking, recommendedId: council.recommendedId, rationale: council.rationale, createdAt: new Date().toISOString() }; deps.engine.parkForReview(project.id); deps.engine.persistState(); return { handled:true, gated:true };`

- [ ] **Step 1: Write the failing test** `tests/unit/council-gate.test.ts` with a fake engine + fake council:
  - Non-council step → `{ handled:false }`, engine untouched.
  - Council step, `context.councilSelection` unset/`'auto'` → council ran once; step completed with recommended candidate's `text`; `{ handled:true, gated:false }`; NO `selection` set.
  - Council step, `context.councilSelection==='propose'` → `project.selection` populated (candidates+ranking+recommendedId); `parkForReview` called; `{ handled:true, gated:true }`; step NOT completed.
  - Re-entry with `selection` already set → council NOT re-run; `{ handled:true, gated:true }`.
  - `council.originate` throws → step completed with a fallback base story; `{ handled:true, gated:false }` (degrade), NOT gated.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement `council-gate.ts`.**
- [ ] **Step 4: Run → PASS**; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `feat(romance): council-gate shared driver helper (auto-complete vs. propose-park)`.

---

### Task 4: Wire the helper + the selection guard into BOTH drivers (the risky change — regression tests FIRST)

Insert one `maybeRunCouncilStep` call in each driver at the `isHumanReviewStep` site, and one `project.selection` short-circuit guard mirroring the `project.review` guard. **This is the only change that touches the live auto-execute path, so its regression tests (proving auto-mode and non-council projects are unchanged) are written and RED-verified before the wiring.**

**Files:**
- Modify: `gateway/src/api/routes/projects.routes.ts` — guard at `:811`, dispatch at `:848`, thread `councilSelection` into context at `:181-183`
- Modify: `gateway/src/index.ts` — dispatch at `:2248` (+ a top-of-`startAndRunProject` `selection` short-circuit near `:2244`)
- Test: `tests/unit/council-driver-regression.test.ts` (new), `tests/romance-council-smoke.sh` (new)

**Wiring:**

1. **Context threading** (`projects.routes.ts:181-183`): extend `manifestSeeds` and pass `councilSelection` so the driver can read `project.context.councilSelection`:
```ts
const s = (opened?.manifest?.seeds ?? {}) as { storyArc?: string; characters?: string; setting?: string; blueprint?: string; councilSelection?: 'auto' | 'propose' };
const manifestSeeds = { storyArc: s.storyArc ?? '', characters: s.characters ?? '', setting: s.setting ?? '', blueprint: s.blueprint ?? '', councilSelection: s.councilSelection ?? 'auto' };
```
(Also confirm every OTHER `manifestSeeds` construction in the file gets `councilSelection`, matching how Premise-Intake threaded `blueprint`.)

2. **`/auto-execute` guard** (`projects.routes.ts:811`, right beside the `project.review` guard):
```ts
if (project.selection) {
  return res.status(409).json({ error: 'Awaiting council base-story selection', awaitingSelection: true, projectId: project.id });
}
```

3. **`/auto-execute` dispatch** (`projects.routes.ts:848`, immediately before the `isHumanReviewStep` block, same loop position):
```ts
const councilOutcome = await maybeRunCouncilStep({ engine, council: buildCouncilService(services) }, currentProject, activeStep);
if (councilOutcome.gated) { results.push({ step: activeStep.label, success: false, error: 'awaiting council selection' }); break; }
if (councilOutcome.handled) { continue; } // auto: step completed, advance to the next frontier
```

4. **`startAndRunProject` short-circuit + dispatch** (`index.ts`): near `:2244` (after `activeStep` is resolved), before the `isHumanReviewStep` block at `:2248`:
```ts
if (project.selection) return { error: 'awaiting council selection' };
const councilOutcome = await maybeRunCouncilStep({ engine: gateway.projectEngine, council: buildCouncilService(gateway) }, project, activeStep);
if (councilOutcome.gated) return { error: 'awaiting council selection' };
if (councilOutcome.handled) return { completed: activeStep.label, response: '[council base story selected]', wordCount: 0, nextStep: gateway.projectEngine.getProject(projectId)?.steps.find((s:any)=>s.status==='active')?.label };
```

5. **`buildCouncilService(services|gateway)`** — a tiny local factory (in each file, or a shared `_shared.ts` helper) that wraps `services.aiRouter.complete`/`.selectProvider` into the injected `AiComplete`/`AiSelectProvider` shape, exactly as the intake route builds `PremiseIntakeService` (`books.routes.ts`).

**Regression tests (write + RED before wiring):**

- [ ] **Step 1: Write `tests/unit/council-driver-regression.test.ts`** — drive `maybeRunCouncilStep` against representative projects and assert the safety invariants:
  - A **non-council** project's active step → `{ handled:false }`; the engine is not mutated (proves every existing pipeline is untouched — none has a council step).
  - A romance-full project, active council step, `councilSelection` unset OR `'auto'` → council runs, step completes, `{ gated:false }`, project NOT paused (proves auto runs straight through, **no gate**).
  - Same project with `'propose'` → `{ gated:true }`, `project.selection` set, `status==='paused'`.
- [ ] **Step 2: Write `tests/romance-council-smoke.sh`** (model on the Foundation `tests/romance-*-smoke.sh`; boot gateway with a known `BOOKCLAW_AUTH_TOKEN`, loopback, `-v` streams the log). Assert, with the driver wired:
  - Create a `romance-sweet-full` book with `councilSelection:'auto'` → `/auto-execute` runs past the council step without a 409 (auto is transparent).
  - Create one with `councilSelection:'propose'` → the project reaches `paused`; a second `/auto-execute` returns **409 `awaitingSelection`** and does NOT advance (proves the guard; proves no double-run). `GET /api/projects/:id/council` (Task 5) returns candidates.
  - A **normal** (non-romance) project still auto-executes to completion unchanged (explicit "auto-execute of a normal project is unchanged" guard required by the brief).
- [ ] **Step 3: Run both → FAIL** (helper not wired; endpoints 404).
- [ ] **Step 4: Wire** items 1-5 above into both drivers.
- [ ] **Step 5: Run unit regression → PASS**; run smoke after Task 5's endpoints exist; `npx tsc --noEmit`.
- [ ] **Step 6: Commit** — `feat(romance): wire council gate + selection guard into both drivers (auto unchanged)`.

---

### Task 5: Pipeline JSON — insert the council step + the selection API

Add the `council-origination` step to the front of both romance-full pipelines, and the two endpoints the propose-mode UI needs.

**Files:**
- Modify: `library/pipelines/romance-sweet-full.json`, `library/pipelines/romance-spicy-full.json` (prepend the council step)
- Modify: `gateway/src/api/routes/projects.routes.ts` (GET council + POST select, reusing `driveResumedProject` at `:1470`)
- Test: extend `tests/unit/romance-full-pipeline.test.ts`; the smoke (Task 4) exercises the endpoints

**Pipeline step (index 0 in both files):**
```json
{
  "label": "Council — Base Story Origination",
  "phase": "premise",
  "skill": "council-origination",
  "taskType": "book_bible",
  "promptTemplate": "The LLM Council originates the base story (premise + relationship arc) for \"{{title}}\" from the author's seeds. This step is handled by the council engine; no direct generation."
}
```
(The `promptTemplate` is never sent to the router — the driver special-cases the step — but keep it descriptive for logs/UI. Because the step is `phase:'premise'`, its chosen-candidate `result` is injected into the real Premise step as "Prior Premise Work", `projects.ts:1795`.)

**Endpoints (`projects.routes.ts`):**
```ts
// GET the pending selection for the studio review screen
app.get('/api/projects/:id/council', (req, res) => {
  const project = engine?.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.selection) return res.status(404).json({ error: 'No council selection pending' });
  const { candidates, ranking, recommendedId, rationale } = project.selection;
  res.json({ candidates, ranking, recommendedId, rationale });
});

// Submit the pick + resume the pipeline
app.post('/api/projects/:id/council/select', async (req, res) => {
  const project = engine?.getProject(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  if (!project.selection) return res.status(409).json({ error: 'No council selection pending' });
  const candidateId = typeof req.body?.candidateId === 'string' ? req.body.candidateId : '';
  if (!candidateId) return res.status(400).json({ error: 'candidateId required' });
  engine.applyCouncilSelection(req.params.id, candidateId);
  driveResumedProject(req.params.id).catch(() => {}); // fire-and-forget resume (same pattern as /review/action, :1470)
  res.json({ ok: true, project: engine.getProject(req.params.id) });
});
```

**Board indicator field:** in the project serialization used by `GET /api/projects/list` and `GET /api/projects/:id` (`projects.routes.ts:274,300`), add `awaitingSelection: !!p.selection` so the Board/PipelineRail can badge it without a new status.

- [ ] **Step 1: Extend `tests/unit/romance-full-pipeline.test.ts`** — both files: step 0 has `skill:'council-origination'`, `phase:'premise'`; the Premise step still follows; the outline step's `{{blueprint}}` weave (Premise-Intake) is untouched.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Add the step to both JSONs + the two endpoints + the `awaitingSelection` field.**
- [ ] **Step 4: Run the pipeline unit test → PASS; run `tests/romance-council-smoke.sh -v` → PASS; `npx tsc --noEmit`.**
- [ ] **Step 5: Commit** — `feat(romance): council-origination pipeline step + /council selection API`.

---

### Task 6: MCP lockstep — council selection tools

Keep the vendored MCP server in step with the new endpoints.

**Files:**
- Modify: `mcp/src/tools/projects.ts` (register two tools)
- Test: `cd mcp && npm run build && npm test`

- [ ] **Step 1:** Register `get_council_candidates` (`GET /api/projects/:id/council`, input `{ projectId }`) and `select_council_candidate` (`POST /api/projects/:id/council/select`, input `{ projectId, candidateId }`), using the existing `client.request` + `toToolResult` pattern in that file.
- [ ] **Step 2:** Confirm `create_book` already carries `councilSelection` in its seeds schema (Foundation/Premise-Intake); if absent, add `councilSelection: z.enum(['auto','propose']).optional()` in the SAME commit.
- [ ] **Step 3:** `cd mcp && npm install && npm run build && npm test` → green.
- [ ] **Step 4: Commit** — `feat(mcp): council candidate get/select tools (lockstep with /api/projects/:id/council)`.

---

### Task 7: Studio candidate-review screen + pending-selection indicator

The propose-mode UI: a screen that fetches the ranked candidates, shows the AI recommendation, lets the user pick one, and resumes; plus a Board/PipelineRail badge that routes to it.

**Files:**
- Create: `frontend/studio/src/routes/CouncilSelect.tsx` (route `/council/:projectId`)
- Modify: the studio router + `frontend/studio/src/components/PipelineRail.tsx` (or the Board card) to surface `awaitingSelection`
- Verify: `tests/unit/studio-build.test.ts` (existing build-then-assert) + manual

- [ ] **Step 1:** Build `CouncilSelect.tsx` (auth-fetch pattern from `NewBook.tsx`): `GET /api/projects/:projectId/council`; render each candidate as a card ordered by `ranking` (rank badge, model label, premise + relationship arc, judge rationale); mark the `recommendedId` card "AI recommendation". Radio-select; "Use this base story & continue" → `POST /council/select { candidateId }` → on success navigate to the pipeline rail/board. Handle 404 (no selection pending) gracefully.
- [ ] **Step 2:** Pending indicator — when a project reports `awaitingSelection` (Task 5 field), show a "Choose base story" CTA on the Board card / PipelineRail that links to `/council/:projectId`. Mirror how PipelineRail already surfaces a paused Human Review.
- [ ] **Step 3:** Wire the route into the studio router.
- [ ] **Step 4:** `npm run build:frontend` → `node --import tsx --test tests/unit/studio-build.test.ts` → PASS.
- [ ] **Step 5 (manual, record result):** create a `romance-spicy-full` book with `councilSelection:'propose'`, let it reach the gate, open `/council/:id`, confirm 3 ranked candidates + the recommendation render, pick one, confirm the pipeline resumes and the Premise step's context contains the chosen base story.
- [ ] **Step 6: Commit** — `feat(studio): council candidate-review screen + pending-selection indicator`.

---

### Task 8: Wire `councilSelection` into the entry UIs (dependency note)

`councilSelection` must be selectable where a romance-full book is created. Today it is accepted by `POST /api/books` (Foundation) but no entry UI sets it except via raw payload.

- [ ] **Guided wizard (sub-project 2, built in parallel):** add a two-option control — "Auto-Select Best Story" (`auto`) / "Propose Top Ideas, ranked by the AI Judge" (`propose`) — to the Guided form, POSTing `councilSelection`. **Dependency:** if Guided is not yet merged, land this control in whichever create surface exists (the Premise-Intake "From Premise File" screen `PremiseIntake.tsx`, and/or the standard `NewBook.tsx` when a `romance-*-full` pipeline is picked) so propose mode is reachable end-to-end. Record which surface received it.
- [ ] Verify with the Task 4 smoke (a propose-mode book created through the chosen UI reaches the gate).

---

## Feature tracking

- [ ] Before starting: sub-project 3 is already listed in `docs/TODO.md:177` ("Sub-project 3 — LLM Council"). On completion, move that bullet to `docs/COMPLETED.md` with the completion date (per repo CLAUDE.md feature-tracking rule), preserving the bullet text and noting the pause-resume gate + `project.selection` mechanism.

## Self-Review (against the brief)

- **Candidate generation** → Task 1 (`CouncilService.originate` fan-out, echoing `editorial-outline-council.json`; in-service for testability — deliberate, justified deviation from literal pipeline `parallel` steps).
- **AI judge** → Task 1 (judge call → ranking + recommendation + rationale, defensive fallback).
- **The gate** → Tasks 2-4: `project.selection` state + `applyCouncilSelection` (Task 2); the shared auto-vs-propose helper (Task 3); wired identically into BOTH `/auto-execute` and `startAndRunProject` via one function (Task 4). Pause reuses `'paused'` + `parkForReview`; resume completes the council step with the chosen base story, which reaches Premise via existing step-result chaining (`projects.ts:1795`). **No new status** (justified in Global Constraints).
- **API** → Task 5 (`GET /api/projects/:id/council`, `POST /api/projects/:id/council/select` + `awaitingSelection` list field).
- **UI** → Task 7 (candidate-review screen + Board/PipelineRail indicator).
- **MCP lockstep** → Task 6.
- **Safety/regression** → Task 4 leads with the regression tests: non-council project unchanged, auto mode no-gate, propose parks; the `/auto-execute` 409 guard + `startAndRunProject` short-circuit prove neither driver bypasses the gate; the smoke's explicit "normal project auto-executes unchanged" assertion. Fail-soft: a council failure degrades to today's straight-through generation.
- **Open items deferred to implementation:** the default `CouncilModel[]` list (3 provider/model configs — confirm against the live OpenRouter catalog, like the Foundation `modelOverride`s); how `heat` is surfaced to the council (context var vs. inferred from the `romance-sweet`/`spicy` pipeline id); the exact studio router/PipelineRail registration points (Task 7 follows existing NewBook/Human-Review wiring).
