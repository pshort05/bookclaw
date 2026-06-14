# Multi-step executable skills — Phase A (engine) design (2026-06-13)

Make a skill **executable**: a chain of N LLM phases (no cap; usually 2), each with
its own **OpenRouter** model + temperature, passing each phase's output to the next,
with per-failing-phase retries — run as a **pipeline step**. Supersedes the old
"Per-skill LLM in a pipeline" TODO. **Phase A = engine** (schema + runner + pipeline
wiring); the Asset Studio editor UI is **Phase B**.

## Use case (canonical)

A "Humanize" skill: phase 1 (Gemini Flash, low temp) lists the AI-tells in the text;
phase 2 (Gemini Pro, higher temp) rewrites the text to remove those tells, using
phase 1's output. Both temperatures configurable; retry a phase up to N times.

## Decisions (from brainstorming)

- **Invocation:** runs as a **pipeline step**. When a step's `skill` is executable,
  the engine runs the skill's phases and the **last phase's output = the step's output**
  (instead of injecting the skill's markdown into one call).
- **Retries:** retry the **failing phase only**, up to `retries` (0–4, per skill),
  keeping earlier phases' output. Failure = the OpenRouter call throws OR returns
  empty/whitespace output.
- **OpenRouter only:** every phase call is forced to `provider: 'openrouter'` with the
  phase's `model`. If OpenRouter isn't configured, the run fails with a clear error and
  the step fails (caught by the existing per-step error handling).
- **Unbounded steps:** any number of phases ≥ 1.

## Storage (decided — flag for review)

A skill dir is `skills/<category>/<name>/`. Executable config lives in a **sibling
`steps.json`** next to `SKILL.md` — NOT nested YAML in the frontmatter. Rationale:
the repo hand-parses frontmatter (no YAML lib) and stores structured config as JSON
(`pipeline.json`, `book.json`); a sibling JSON is dep-free, trivially parsed, and needs
no risky refactor of the existing line-based frontmatter parser. `SKILL.md` stays the
human doc (frontmatter `description`/`triggers` + markdown body = `{{guidance}}`).

```json
// skills/author/humanize/steps.json
{
  "retries": 2,
  "steps": [
    { "name": "detect",   "model": "google/gemini-2.0-flash-001", "temperature": 0.2,
      "prompt": "List every AI-tell in this text:\n{{input}}" },
    { "name": "humanize", "model": "google/gemini-pro-1.5",       "temperature": 0.9,
      "prompt": "Rewrite to remove these AI-tells:\n{{previous}}\n\nText:\n{{input}}" }
  ]
}
```

A skill with a valid `steps.json` (≥1 step) is **executable**; otherwise it's **passive**
(today's markdown-injection behavior, unchanged). *(Alternative considered: add a
`js-yaml` dep + a `steps:` block in the frontmatter — single-file authoring, but a new
dep + a parser refactor with regression risk. Rejected for Phase A.)*

## Loader

Extend `SkillLoader` (`gateway/src/skills/loader.ts`): when loading a skill dir, also
read `steps.json` if present and attach `steps?: SkillStep[]` + `retries?: number` to the
`Skill`. Validate: each step has a non-empty `model` (string) + `prompt` (string);
`temperature` optional number; `retries` clamped 0–4; ≥1 step. Invalid `steps.json` →
log a `⚠` and treat the skill as **passive** (fail-soft; never crash load).

```
interface SkillStep { name?: string; model: string; temperature?: number; prompt: string }
// Skill gains: steps?: SkillStep[]; retries?: number
```

## Templating

Simple string substitution in each phase's `prompt`:
- `{{input}}` — the text the step operates on (the step's assembled input message).
- `{{previous}}` — the immediately-preceding phase's output (`''` for phase 1).
- `{{guidance}}` — the skill's markdown body (shared instructions; `''` if none).

## Execution — `SkillRunner` (`gateway/src/services/skill-runner.ts`)

`async run(skill, input, guidance): Promise<string>`:
- For each phase: render the prompt (substitute the vars), call
  `aiRouter.complete({ provider: 'openrouter', model: step.model, temperature: step.temperature, … })`.
- Failure (throw or empty/whitespace output) → retry that phase up to `skill.retries`
  times; if still failing, throw (the step fails).
- Feed each phase's output as `{{previous}}` to the next; return the last phase's output.
- Pure of pipeline concerns — takes the AI-complete fn injected (so it's unit-testable
  with a fake AI). OpenRouter-forced; a missing OpenRouter provider → throw a clear error.

## Pipeline integration

In the step-execution paths (the `goal-engine` loop in `index.ts`, and `/execute` +
`/auto-execute` in `projects.routes.ts`), when `step.skill` resolves to an **executable**
skill, call `SkillRunner.run(skill, <assembled step input>, skill.content)` and use its
output as the step result — instead of the single injected-content call. **Passive skills
unchanged.** Precedence: an executable skill's phase models win over the step's
`modelOverride` (which still applies to passive skills).

## Cost

Each phase is a billed OpenRouter call, recorded per-call by the router (and per-book once
that TODO lands). A 2-phase skill costs ~2× a normal step. No new budget logic.

## Out of scope (later)

- **Phase B:** Asset Studio editor to author `steps.json` (models/temps/prompts/retries)
  without hand-editing JSON; include `steps.json` in skill share/import.
- On-demand (non-pipeline) invocation.

## Testing (TDD)

- **Unit:** `SkillRunner.run` with a fake AI-complete fn — phase chaining + `{{previous}}`,
  `{{input}}`/`{{guidance}}` substitution, retry-on-throw, retry-on-empty-output, exhausted
  retries → throw, OpenRouter forced (provider/model asserted on the fake), single-phase
  skill. `SkillLoader` parses a valid `steps.json` → executable; invalid → passive (fail-soft).
- **Smoke:** a tiny real 2-phase OpenRouter skill exercised through a pipeline step (a new
  tier or a dedicated `tests/skill-steps-smoke.sh`), asserting the chained output is produced.
