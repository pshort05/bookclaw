# Flagship Content Axes + Heat Routing Implementation Plan (Plan 2 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Add the three content axes (author-branded spice/violence ceiling, per-character profanity) and the scene-heat classifier that drives the intimacy branch — filling the `spiceRoute` seam Plan 1 left in `castStep`, so flagged intimate/violent scenes route Claude-first-then-uncensored.

**Architecture:** A per-chapter `heat_check` scores the scene brief `{spice, violence}` 0-10. A pure `intimacyDecision` function combines that score with the book's ceiling and the casting sheet's `heatLadder` to produce either no re-route (fade-to-black / on-page Claude) or a `spiceRoute` (uncensored provider) plus the intimacy-template choice. The execution loop runs `heat_check`, computes the decision, and passes `spiceRoute` into `stepRouting`/`castStep`. Profanity is a character-bible trait injected into scene-brief/draft prompts. A safety floor (banned-content + consequence-not-procedure) runs regardless of settings.

**Tech Stack:** Node 22+, TypeScript (NodeNext, `.js` imports), `node --import tsx --test`.

## Global Constraints

- Same as Plan 1: `.js` import extensions; tests are `node:test`+`node:assert/strict`, one file per unit; no direct `git commit`/`git push` — append to `commit_message`, maintainer runs `./push.sh`; NodeNext; no placeholders.
- Backward compatibility: books with no `contentCeiling` behave as fade-to-black (no intimacy branch, no uncensored routing). Untagged/non-intimate steps are unaffected.
- Ceiling clamps: a scene is never written more explicit than the book's ceiling.
- Safety floor is non-negotiable and independent of any ceiling: no CSAM / non-consent; dark technical content is consequence-realistic, not procedure-reproducible.
- **Re-ground note:** this plan consumes Plan 1's shipped `castStep(inputs)` / `CastInputs.spiceRoute` / `CastingSheet.heatLadder`. Confirm those signatures before starting (they are live in `gateway/src/services/casting/`).

## File Structure

- Create `gateway/src/services/casting/heat.ts` — `intimacyDecision()` (pure), the `HeatScore` type, and `heatCheckPrompt()` builder.
- Create `gateway/src/services/casting/heat-classify.ts` — `classifyScene(sceneBrief, complete)` (calls a cheap model, returns `HeatScore`), with a deterministic fallback.
- Create `gateway/src/services/casting/profanity.ts` — `profanityInjection(character)` and `dialogueProfanityFlags()`.
- Create `gateway/src/services/casting/safety-floor.ts` — `bannedContentCheck(text)` + `operationalDetailGuard(text)`.
- Modify `gateway/src/services/book-types.ts` — add `contentCeiling`, `uncensoredProvider` to `BookManifest`.
- Modify `gateway/src/api/routes/projects.routes.ts` (the two `stepRouting` call sites ~455, ~707, and the per-chapter draft path) — run `heat_check`, compute `spiceRoute`, pass it through, and select the intimacy template.
- Modify `gateway/src/api/routes/_shared.ts` — `stepRouting` gains an optional `spiceRoute` param forwarded to `castStep`.
- Create `library/craft/intimacy/romance.md` — the emotional-framing intimacy template (first genre).
- Create the character-bible `profanity` field handling (in the bible/character data path — read the current character storage first).
- Tests: `tests/unit/heat-decision.test.ts`, `tests/unit/heat-classify.test.ts`, `tests/unit/profanity.test.ts`, `tests/unit/safety-floor.test.ts`, `tests/unit/steprouting-spice.test.ts`.

---

### Task 1: `intimacyDecision` — the pure routing decision

**Files:** Create `gateway/src/services/casting/heat.ts`; Test `tests/unit/heat-decision.test.ts`.

**Interfaces:**
- Produces:
  - `interface HeatScore { spice: number; violence: number }`
  - `interface HeatLadderLike { eroticaThreshold: number; uncensoredByLevel: Array<{ minSpice: number; provider: string; model?: string }>; rerouteRoles: string[] }`
  - `interface IntimacyDecision { mode: 'fade' | 'onpage_claude' | 'uncensored'; spiceRoute: { provider: string; model?: string } | null; effectiveSpice: number; template: string | null }`
  - `function intimacyDecision(args: { score: HeatScore; ceiling: { spice: number; violence: number } | null; ladder: HeatLadderLike | null; refusalEscalated?: boolean; genre: string }): IntimacyDecision`

- [ ] **Step 1: Write failing test** — cases: (a) no ceiling → `fade`, spiceRoute null; (b) score.spice below ceiling and below erotica threshold → `onpage_claude`, template `library/craft/intimacy/<genre>.md`, spiceRoute null, effectiveSpice = min(score, ceiling); (c) score.spice at/above eroticaThreshold (within ceiling) → `uncensored`, spiceRoute = the ladder entry for that level; (d) `refusalEscalated: true` on an onpage scene → `uncensored`; (e) ceiling clamps: score.spice 9, ceiling.spice 4, eroticaThreshold 7 → effectiveSpice 4, mode `onpage_claude` (clamped below erotica).

```ts
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { intimacyDecision } from '../../gateway/src/services/casting/heat.js';
const ladder = { eroticaThreshold: 7, uncensoredByLevel: [{ minSpice: 7, provider: 'grok' }, { minSpice: 9, provider: 'openrouter', model: 'venice/uncensored' }], rerouteRoles: ['draft','intimacy'] };
test('no ceiling → fade to black', () => {
  const d = intimacyDecision({ score: { spice: 8, violence: 0 }, ceiling: null, ladder, genre: 'romance' });
  assert.equal(d.mode, 'fade'); assert.equal(d.spiceRoute, null);
});
test('on-page below erotica → claude + template', () => {
  const d = intimacyDecision({ score: { spice: 5, violence: 0 }, ceiling: { spice: 8, violence: 5 }, ladder, genre: 'romance' });
  assert.equal(d.mode, 'onpage_claude'); assert.equal(d.spiceRoute, null); assert.match(d.template ?? '', /intimacy\/romance\.md$/); assert.equal(d.effectiveSpice, 5);
});
test('at erotica threshold → uncensored (grok)', () => {
  const d = intimacyDecision({ score: { spice: 7, violence: 0 }, ceiling: { spice: 10, violence: 5 }, ladder, genre: 'romance' });
  assert.equal(d.mode, 'uncensored'); assert.deepEqual(d.spiceRoute, { provider: 'grok', model: undefined });
});
test('ceiling clamps below erotica', () => {
  const d = intimacyDecision({ score: { spice: 9, violence: 0 }, ceiling: { spice: 4, violence: 5 }, ladder, genre: 'romance' });
  assert.equal(d.effectiveSpice, 4); assert.equal(d.mode, 'onpage_claude');
});
test('refusal escalates on-page to uncensored', () => {
  const d = intimacyDecision({ score: { spice: 5, violence: 0 }, ceiling: { spice: 8, violence: 5 }, ladder, refusalEscalated: true, genre: 'romance' });
  assert.equal(d.mode, 'uncensored');
});
```

- [ ] **Step 2: Run → fail** (`node --import tsx --test tests/unit/heat-decision.test.ts`).
- [ ] **Step 3: Implement `heat.ts`:**

```ts
export interface HeatScore { spice: number; violence: number }
export interface HeatLadderLike { eroticaThreshold: number; uncensoredByLevel: Array<{ minSpice: number; provider: string; model?: string }>; rerouteRoles: string[] }
export interface IntimacyDecision { mode: 'fade' | 'onpage_claude' | 'uncensored'; spiceRoute: { provider: string; model?: string } | null; effectiveSpice: number; template: string | null }

function ladderModel(ladder: HeatLadderLike, spice: number): { provider: string; model?: string } | null {
  const eligible = ladder.uncensoredByLevel.filter(e => spice >= e.minSpice).sort((a, b) => b.minSpice - a.minSpice);
  return eligible[0] ? { provider: eligible[0].provider, model: eligible[0].model } : null;
}

export function intimacyDecision(args: { score: HeatScore; ceiling: { spice: number; violence: number } | null; ladder: HeatLadderLike | null; refusalEscalated?: boolean; genre: string }): IntimacyDecision {
  const { score, ceiling, ladder, refusalEscalated, genre } = args;
  if (!ceiling || ceiling.spice <= 0) return { mode: 'fade', spiceRoute: null, effectiveSpice: 0, template: null };
  const effectiveSpice = Math.min(score.spice, ceiling.spice);
  if (effectiveSpice <= 0) return { mode: 'fade', spiceRoute: null, effectiveSpice: 0, template: null };
  const template = `library/craft/intimacy/${genre}.md`;
  const atErotica = !!ladder && effectiveSpice >= ladder.eroticaThreshold;
  if (atErotica || refusalEscalated) {
    const route = ladder ? ladderModel(ladder, effectiveSpice) : null;
    if (route) return { mode: 'uncensored', spiceRoute: route, effectiveSpice, template };
    // No uncensored model configured but needed → keep on-page Claude (the caller's
    // fallback ladder / human-review pause handles a hard refusal downstream).
  }
  return { mode: 'onpage_claude', spiceRoute: null, effectiveSpice, template };
}
```

- [ ] **Step 4: Run → pass.**  **Step 5: Commit** (`commit_message`: `feat(casting): intimacyDecision — heat→route mapping with ceiling clamp`).

---

### Task 2: `classifyScene` heat classifier

**Files:** Create `gateway/src/services/casting/heat-classify.ts`; Test `tests/unit/heat-classify.test.ts`.

**Interfaces:**
- Consumes: `HeatScore` from Task 1; an injected `complete(req) => Promise<{ text: string }>` (the router, matching the world-service pattern).
- Produces: `function classifyScene(sceneBrief: string, complete: (req: any) => Promise<{ text: string }>, model?: { provider: string; model?: string }): Promise<HeatScore>` — asks the cheap model to rate `{spice, violence}` 0-10, parses tolerant JSON (reuse `jsonrepair` as the context-engine does), clamps to 0-10, and returns `{spice:0,violence:0}` on any failure (fail-soft: an unclassifiable scene is treated as non-explicit).

- [ ] **Step 1: Failing test** — stub `complete` returning `{"spice":8,"violence":2}` → `{spice:8,violence:2}`; a garbage response → `{spice:0,violence:0}`; an out-of-range `{"spice":15}` → clamped to 10.
- [ ] **Step 2-4:** implement with `jsonrepair` (import `{ jsonrepair } from 'jsonrepair'`), `Math.max(0, Math.min(10, n))` clamp, try/catch → zeros.  **Step 5: Commit.**

---

### Task 3: Profanity injection + dialogue fidelity

**Files:** Create `gateway/src/services/casting/profanity.ts`; Test `tests/unit/profanity.test.ts`. Read the current character-bible storage first (search `character`, `bible`, `dialogue-auditor.ts`) to place the `profanity` field correctly.

**Interfaces:**
- Produces:
  - `interface CharacterProfanity { level: number; contexts: string[]; register: string }`
  - `function profanityInjection(character: { name: string; profanity?: CharacterProfanity }): string` — returns a prompt block instructing authentic in-voice profanity (empty string when `level` is 0 or absent).
  - `function isInCharacterProfanity(line: string, character: { profanity?: CharacterProfanity }): boolean` — used by the anti-slop whitelist so humanize/strip never removes legit swearing.

- [ ] **Step 1: Failing test** — a `level:8` character yields a block containing "do not sanitize" and the register; `level:0`/absent yields `''`; the whitelist returns true for a profane line from a high-profanity character.
- [ ] **Step 2-4:** implement.  **Step 5: Commit.**
- [ ] **Step 6 (integration):** in `dialogue-auditor.ts`, extend the per-character check to flag a high-profanity character whose lines came back with zero profanity (a sanitization signal) → returns a targeted re-gen flag. Add a unit test at the auditor's existing test seam. Confirm `tsc` clean.

---

### Task 4: Safety floor

**Files:** Create `gateway/src/services/casting/safety-floor.ts`; Test `tests/unit/safety-floor.test.ts`.

**Interfaces:**
- Produces: `function bannedContentCheck(text: string): { ok: boolean; reason?: string }` (deterministic pattern check for CSAM/non-consent markers — fail closed, block); `function operationalDetailGuard(text: string): { flagged: boolean; spans: string[] }` (flags draft passages that read as actionable instructions — real code blocks, step-numbered synthesis/procedure — for a consequence-abstraction rewrite).

- [ ] **Step 1: Failing test** — a benign dark scene passes both; a text with a fenced code block + imperative step list is `operationalDetailGuard.flagged === true`; a banned-content marker makes `bannedContentCheck.ok === false`.
- [ ] **Step 2-4:** implement conservative deterministic checks (no AI). Keep it a *flag-and-abstract* guard for operational detail (not a hard block), and a hard block only for `bannedContentCheck`.  **Step 5: Commit.**

---

### Task 5: `stepRouting` accepts a `spiceRoute`

**Files:** Modify `gateway/src/api/routes/_shared.ts`; Test `tests/unit/steprouting-spice.test.ts`.

**Interfaces:**
- `stepRouting(project, step, spiceRoute?: { provider: string; model?: string } | null)` — forwards `spiceRoute` into `castStep` (Plan 1 already handles it as precedence level 1). Untagged steps ignore it.

- [ ] **Step 1: Failing test** — `stepRouting({context:{genre:'romance'}}, {role:'draft', modelOverride:{provider:'openai'}}, {provider:'grok'})` returns provider `'grok'` (spice beats the manual pin, per Plan 1's precedence).
- [ ] **Step 2-4:** thread the param through to the `castStep({ ..., spiceRoute })` call.  **Step 5: Commit.**

---

### Task 6: Book manifest content fields + author brand inheritance

**Files:** Modify `gateway/src/services/book-types.ts` (`BookManifest`), and the book-create path (`books.routes.ts` create, and `book.ts`); read author-template storage to add `contentBrand`. Test `tests/unit/book-content-ceiling.test.ts`.

**Interfaces:**
- `BookManifest` gains `contentCeiling?: { spice: number; violence: number }` and `uncensoredProvider?: 'grok' | 'venice' | 'auto'` (additive-optional, no schema bump — match the existing comment convention).
- Author brand `contentBrand?: { spiceCeiling: number; violenceCeiling: number }` stored with the author template; a new book inherits `contentCeiling` from the bound author's brand when not explicitly set.

- [ ] **Step 1: Failing test** — creating a book bound to an author with brand `{spiceCeiling:8, violenceCeiling:4}` and no explicit ceiling yields `manifest.contentCeiling === {spice:8, violence:4}`; an explicit per-book ceiling overrides.
- [ ] **Step 2-4:** implement inheritance at create time.  **Step 5: Commit.**

---

### Task 7: Wire heat_check + intimacy branch into the per-chapter execution

**Files:** Modify `gateway/src/api/routes/projects.routes.ts` (the auto-execute loop ~line 707 and the `/execute` path ~455, specifically where a `draft`/`intimacy`-role step runs). Test: an integration test with a fake engine + fake `complete` proving the flow.

**Interfaces (consumes):** `classifyScene` (T2), `intimacyDecision` (T1), `loadCastingSheet` + `castStep` (Plan 1), `stepRouting` with spiceRoute (T5), the book's `contentCeiling`/`uncensoredProvider` (T6), the intimacy template (read the file `intimacyDecision.template` when present), `profanityInjection` (T3), `bannedContentCheck`/`operationalDetailGuard` (T4).

- [ ] **Step 1: Failing integration test** — drive a single `draft`-role chapter step for a `romance` book with `contentCeiling {spice:10}`; stub `classifyScene` to return spice 8 (>= eroticaThreshold 7) and assert the draft call's resolved provider is the ladder's uncensored provider (`grok`); with spice 5 assert it stays on the sheet's Claude draft model and the intimacy template text is present in the prompt; with a Claude refusal (empty completion) on an on-page spice-5 scene, assert it escalates to uncensored on retry.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement the wiring** at the draft/intimacy step: (1) if the active step's role is `draft`/`intimacy` and the book has a `contentCeiling`, build the scene-brief text (already assembled for the step) and call `classifyScene`; (2) `const decision = intimacyDecision({ score, ceiling, ladder: sheet.heatLadder, genre })`; (3) if `decision.template`, read that file and append `profanityInjection` + the ceiling-scaled framing into the draft prompt; (4) pass `decision.spiceRoute` into `stepRouting(project, step, decision.spiceRoute)`; (5) after generation, if the response is an empty/refusal (reuse the existing empty-completion detection) and `decision.mode === 'onpage_claude'`, recompute `intimacyDecision({..., refusalEscalated:true})` and retry once on the uncensored route; (6) run `bannedContentCheck` (block+fail the step on false) and `operationalDetailGuard` (on flag, run one abstraction rewrite pass). Keep every addition behind `book.contentCeiling` so fade-to-black books are untouched.
- [ ] **Step 4: Run → pass.**  **Step 5: Commit.**

---

### Task 8: First intimacy template + romance sheet erotica config

**Files:** Create `library/craft/intimacy/romance.md`; confirm `library/casting/romance.json` `heatLadder.eroticaThreshold` and `uncensoredByLevel` are sensible (Plan 1 seeded them). Test: `tests/unit/intimacy-template-exists.test.ts` asserting the template file exists and is non-empty and the romance sheet's ladder parses.

- [ ] **Step 1-5:** write the emotional-framing romance intimacy template (author-craft guidance: emotional stakes, sensory grounding, consent-forward, ceiling-aware); add the existence/parse test; commit.

---

## Self-Review

- Spec coverage (§4.2): author-branded ceiling (T6), per-character profanity (T3), `heat_check` classifier (T2), Claude-first-then-uncensored intimacy branch with ceiling clamp (T1, T7), refusal escalation reusing the empty-completion signal (T7), emotional-framing templates (T8), safety floor with consequence-not-procedure guard (T4). The `spiceRoute` seam left by Plan 1 is filled (T5, T7).
- No placeholders; pure logic has full code; integration tasks name exact files and the exact change.
- Type consistency: `HeatScore`, `IntimacyDecision`, `CharacterProfanity`, `spiceRoute` shape match Plan 1's `CastInputs.spiceRoute`.

## Downstream

Plan 3 (consistency spine) consumes the per-chapter execution wiring this plan touches; ground it against the T7 integration points once built.
