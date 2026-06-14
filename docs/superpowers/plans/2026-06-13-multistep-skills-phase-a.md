# Multi-step Skills Phase A (engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Executable skills — a skill carries N OpenRouter phases (model + temperature + prompt); when a pipeline step uses it, the engine runs the phases (chaining `{{previous}}`), retries the failing phase up to N, and the last output becomes the step output.

**Architecture:** `steps.json` sibling to `SKILL.md` → `SkillLoader` attaches `steps`/`retries` to the `Skill`. New `SkillRunner` executes the chain against an injected AI-complete fn (OpenRouter-forced). The 3 step-execution call sites branch to `SkillRunner` for executable skills; passive skills unchanged.

**Tech Stack:** Node 22 + TS (tsx), Express, node:test, bash smoke. No new deps.

---

## Task 1: Loader — parse `steps.json` (TDD)
**Files:** `gateway/src/skills/loader.ts`; Test `tests/unit/skill-steps-loader.test.ts`
- [ ] Failing test: a skill dir with a valid `steps.json` ({retries:2, steps:[{model,prompt},…]}) loads with `skill.steps.length===N` + `skill.retries===2`; a skill with no `steps.json` → `skill.steps` undefined (passive); an invalid `steps.json` (missing model, steps not array, 0 steps) → passive + no throw; `retries` clamped to 0–4.
- [ ] Run → FAIL.
- [ ] Implement: `interface SkillStep { name?:string; model:string; temperature?:number; prompt:string }`; add `steps?: SkillStep[]; retries?: number` to `Skill`. In the dir-load path, read `steps.json` (same dir as SKILL.md); validate (each step model+prompt are non-empty strings; ≥1 step; clamp retries `Math.max(0,Math.min(4,n))`); on any error log `⚠` + leave passive.
- [ ] Run → PASS. Commit.

## Task 2: `SkillRunner` (TDD with a fake AI)
**Files:** Create `gateway/src/services/skill-runner.ts`; Test `tests/unit/skill-runner.test.ts`
- [ ] Failing tests (inject a fake `complete` fn): two-phase skill chains (`{{previous}}` = phase-1 output; `{{input}}`/`{{guidance}}` substituted); every call uses `provider:'openrouter'` + the step's `model` + `temperature` (assert on the fake's recorded args); a phase that throws is retried up to `retries` then re-thrown; a phase returning '' / whitespace is treated as failure + retried; single-phase skill returns its output; returns the LAST phase output.
- [ ] Run → FAIL.
- [ ] Implement `export class SkillRunner { constructor(complete: (req)=>Promise<{text:string}>) }` with `async run(skill, input, guidance=''): Promise<string>`: loop phases, render prompt via a small `renderTemplate(tpl,{input,previous,guidance})` (global string replace of the three tokens), call `complete({provider:'openrouter', model, temperature, messages:[{role:'user',content:rendered}], ... })`, treat throw/empty as failure → retry up to `skill.retries ?? 0`, set `previous=output`. Throw a clear error if no phases. (Provider availability is enforced by the caller wiring the real router; the runner just sets provider:'openrouter'.)
- [ ] Run → PASS. Commit.

## Task 3: Pipeline integration
**Files:** `gateway/src/index.ts` (goal-engine loop ~1779), `gateway/src/api/routes/projects.routes.ts` (`/execute` ~655, `/auto-execute` ~759/801)
- [ ] At each step-execution site: after resolving `stepSkill = skills.getSkillByName(step.skill)`, branch — if `stepSkill?.steps?.length`, run `new SkillRunner(aiRouter-complete-bound).run(stepSkill, <assembled step input>, stepSkill.content)` and use the returned string as `aiResponse`/the step output (then `completeStep` as today); else keep the current passive-inject + single `handleMessage`/complete call. `<assembled step input>` = the same user-message string the passive path builds ({{input}}). Wrap the runner call so a thrown error becomes the step's failure (existing `[AI provider failure]` / catch handling). Extract a shared helper `runExecutableSkillIfAny(...)` to avoid divergence across the 3 sites.
- [ ] Verify: `npx tsc --noEmit` clean; full unit suite green. Commit.

## Task 4: Smoke
**Files:** Create `tests/skill-steps-smoke.sh`
- [ ] A self-contained smoke (OpenRouter-only, tiny): create a 2-phase executable skill in the workspace overlay (write `steps.json` via the skills API or a temp skill dir), pin cheap OpenRouter models, run it through a 1-step pipeline against a short input, assert the chained output is non-empty + reflects phase 2. Pre-clean + leave-or-remove like the other smokes. `bash -n` clean.
- [ ] Verify: full unit suite + `tsc` + `build:frontend` green. Commit.

## Self-review
- Spec coverage: loader (T1), runner+retry+openrouter+templating (T2), pipeline wiring (T3), smoke (T4). Editor UI + share/import of steps.json + on-demand invocation deferred to Phase B.
- Types: `SkillStep`, `Skill.steps/retries`, `SkillRunner.run(skill,input,guidance)`, `renderTemplate` — consistent.
- Risk: the 3 step-execution sites must branch identically — the shared `runExecutableSkillIfAny` helper is the mitigation; verify each site routes executable skills through it.
