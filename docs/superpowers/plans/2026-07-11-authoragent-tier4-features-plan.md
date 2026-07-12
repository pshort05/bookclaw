# Implementation Plan — AuthorAgent Tier 4 Features (#10–#17)

**Spec:** `docs/superpowers/specs/2026-07-11-authoragent-tier4-features-design.md`
**Baseline:** HEAD `8f53a41` (T4-BASE). Work directly on `main` (sole contributor).

## Global constraints (bind every task)

- **`.js` import extensions** (NodeNext). Node 22, `--import tsx`.
- **No git commits during implementation.** Single commit at goal step 7. Implementers write files + run their unit test + report; they do NOT commit.
- **Injected-AI pattern:** `aiComplete=(req:{provider,system,messages,maxTokens?,temperature?})=>Promise<{text}>`; `aiSelectProvider=(taskType)=>{id}` (call `.id`).
- **Test runner:** Node built-in — `node --import tsx --test tests/unit/<file>.test.ts`.
- **Fail-soft:** new services degrade, never crash boot.
- **Only two deliberate behaviour deltas:** #15 null-byte hardening, #16 untrimmed-name fix. Everything else behaviour-preserving. **`dialogue-auditor.ts` stays untouched** (#16 descope). **Do NOT port the fork's `sandbox.ts`** (#15 — keep our `realpathSync` symlink defense).
- Every changed line traces to the spec. No speculative features.

## Scope-down decisions (locked, from research)

- **#12** = motivation check only (knowledge-horizon redundant vs our `evaluateKnowledge`; off-voice redundant vs `character-voices`).
- **#14** = `CostTracker` **overrides** the router's flat estimate for known models (fixes the live `#35b` Opus underpricing; a literal fallback-fill fixes nothing live).
- **#15** = 28 `safePath` sites collapse to a one-line alias; preserve `SandboxGuard.assertRealpathContained`.
- **#16** = migrate `character-voices.ts` + `audiobook-prep.ts` only; `dialogue-auditor.ts` descoped.

## Wave 1 — parallel, disjoint file ownership (NO commit)

Each task: write files + unit test, run green, report. Defer any edit to a shared hot file (listed per task) to Wave 2.

- **T1 (#11 onboarding)** — SELF-CONTAINED. `gateway/src/api/routes/onboarding-status.ts` (helpers + `computeOnboardingStatus`), mount in `gateway/src/api/routes/core.routes.ts`, `tests/unit/onboarding-status.test.ts`. Owns core.routes.ts fully.
- **T2 (#16 dialogue-parser)** — SELF-CONTAINED. New `gateway/src/services/dialogue-parser.ts`; migrate `character-voices.ts` (`extractDialogue`/`canonicalize`) + `audiobook-prep.ts` (`attributeMultiVoice`) to shared calls (fix untrimmed-name bug via `buildNameLookup`); `tests/unit/dialogue-parser.test.ts` + regression tests in the two existing test files. **Do NOT touch `dialogue-auditor.ts`.**
- **T3 (#12 character-motivation)** — `gateway/src/services/character-motivation.ts` + `tests/unit/character-motivation.test.ts`. Inline a trimmed dialogue-extraction copy (no dep on dialogue-parser). DEFER: phase-07 instantiate, index.ts field/getServices, wave.routes route, mcp craft.ts tool → Wave 2.
- **T4 (#13 translation-execute)** — port `executeTranslation`+helpers+`setAI` into `gateway/src/services/translation-pipeline.ts`; `tests/unit/translation-execute.test.ts`. DEFER: knowledge.routes route, phase-09 setAI → Wave 2. (translation-pipeline.ts is #13-only — safe.)
- **T5 (#14 pricing)** — new `gateway/src/ai/pricing.ts` + `tests/unit/pricing.test.ts`; extend `gateway/src/services/costs.ts` `record()` (override logic) + `tests/unit/costs.test.ts` new cases. DEFER: the 9 `record()` call-site appends → Wave 2. (pricing.ts + costs.ts are #14-only — safe.)
- **T6 (#15 path-safety)** — new `gateway/src/security/paths.ts` + `tests/unit/path-safety.test.ts` (incl. symlink-still-blocked regression); refactor `gateway/src/security/sandbox.ts` (keep realpath) + `gateway/src/services/memory.ts` (use shared sanitizeSegment). DEFER: `_shared.ts` safePath body + optional inline sites → Wave 2.
- **T7 (#17 revision-orchestrator)** — new `gateway/src/services/revision-orchestrator.ts` + `tests/unit/revision-orchestrator.test.ts`. DEFER: phase-09 instantiate, index.ts field/getServices, wave.routes route, mcp craft.ts tool → Wave 2.

## Wave 2 — shared-file integration (2 disjoint parallel clusters, NO commit)

Wave 1 must be complete first. The two clusters own disjoint file sets → safe to run in parallel.

- **C1 (security/vault/shared-helpers cluster)** — files: `gateway/src/api/routes/_shared.ts` (#10 add `validateKeyFormat`; #15 `safePath` body → `safeResolveWithin`; #14 append `resp.model,resp.promptTokens,resp.completionTokens` at the 2 `record()` calls ~397/514), `gateway/src/api/routes/settings.routes.ts` (#10 `/api/vault` warning), `tests/unit/vault-key-format.test.ts` (#10), and optional #15 inline folds in `export.routes.ts:183`/`heartbeat.routes.ts:321`/`reports.ts:123`.
- **C2 (registration/routes/mcp/pricing-callsites cluster)** — files: `gateway/src/index.ts` (#12+#17 field+getServices; #14 append at the 4 `record()` calls), `gateway/src/api/routes/wave.routes.ts` (#12 `motivation-critique` + #17 `revision-report` routes), `mcp/src/tools/craft.ts` (#12 `motivation_critique` + #17 `revision_report` tools), `gateway/src/init/phase-07-knowledge.ts` (#12 instantiate `characterMotivation`), `gateway/src/init/phase-09-export-wave.ts` (#13 `translationPipeline.setAI` + #17 instantiate `revisionOrchestrator`), `gateway/src/api/routes/knowledge.routes.ts` (#13 `/api/translation/execute`), `gateway/src/services/{prompt-runner,skill-runner}.ts` + `gateway/src/init/phase-06-content.ts` (#14 `record()` call-site appends).

## Wave 3 — verify

`npx tsc --noEmit` (root + mcp) clean; mcp builds; full `tests/unit/*.test.ts` green modulo the known parallel flake; confirm `costs`/`character-voices`/`audiobook-prep`/`dialogue-auditor` existing tests still pass.

## Post-implementation (goal steps 4–7)

4. **Code review** — whole-diff (Opus), fix all Medium+. Focus: #15 realpath preserved + no null-byte regressions at the 28 sites; #14 override correctness + no double-count; #16 the two bug fixes + no output drift in the migrated consumers; #13 gate check at route; fail-soft everywhere.
5. **Smoke tests** — extend `tests/` with live coverage: #10 `/api/vault` warning field, #11 `/api/onboarding/status`, #12 `/api/projects/:id/motivation-critique`, #13 `/api/translation/execute` (unapproved→409), #17 `/api/projects/:id/revision-report`. (#14/#15/#16 are unit-covered — internal, no clean live surface; note that.)
6. **Deploy Mercury** — `touch build_now`; poll `.build-logs/`; run the new + existing smokes against `http://192.168.1.32:3847`; fix any finding.
7. **Commit + push** — `commit_message`; add a `docs/COMPLETED.md` Tier-4 entry; push.

## Verification checklist

- [ ] All Wave-1 unit tests green in isolation
- [ ] `npx tsc --noEmit` clean (root + mcp) after Wave 2
- [ ] Existing costs/character-voices/audiobook-prep/dialogue-auditor tests still green
- [ ] `dialogue-auditor.ts` untouched; fork `sandbox.ts` NOT ported (realpath preserved)
- [ ] Code review Medium+ all fixed
- [ ] Smokes pass against Mercury
- [ ] `commit_message` written, COMPLETED.md updated, pushed
