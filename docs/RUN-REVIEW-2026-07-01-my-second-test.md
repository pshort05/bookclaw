# Run Review — "My Second Test Medical Romance"

- **Host:** Mercury (test), `http://192.168.1.32:3847`. **Model:** `deepseek/deepseek-v4-pro` throughout.
- **Code under test:** `c2bc06e` (deployed on Mercury) + the uncommitted working-tree changes below.
- **Run outcome:** Planning ✓ (6/6) → Bible ✓ (5/5) → Production ✓ (65/65, 32 chapters) → **stalled** at
  Deep Revision (663) for ~8 h, then **manually unblocked** and now running again. Format-Export (664)
  and Launch (665) not yet run.
- **Reviewed** read-only from Mercury (API + container logs + on-disk output) unless noted.

---

## 1. Handoff — uncommitted changes in the working tree

`HEAD = c2bc06e` (pushed). On top of it, these are **staged but NOT committed** (owner asked to hold
pushing until the book is done/abandoned). Pick these up on the other workstation (shared tree already
has them; otherwise commit + push):

```
 M frontend/studio/src/components/write/OutlinePane.tsx     # fix #A (outputs list)
 M frontend/studio/src/components/write/PipelineRail.tsx    # fix #B (frontier poll)
 M frontend/studio/src/routes/Write.tsx                     # fix #A wiring
?? docs/RUN-REVIEW-2026-07-01-my-second-test.md             # this doc
```

Both fixes **type-check clean** (`cd frontend/studio && npx tsc --noEmit`). There is no frontend
component test harness, so they need a Mercury rebuild to verify in the real UI.

### Fix #A — Write screen showed "No outputs yet" while phases advanced
`OutlinePane` fetched `/api/projects/:id/files` only on `projectId` change (once, empty at start) and
never re-fetched, so completed-step outputs never appeared in the Write "Outline" pane (they only showed
in Files, which re-fetches). Endpoint was correct (verified 5 planning `.md` files for project-660).
Fix: `Write.tsx` passes `readyCount` (completed-step count) into `OutlinePane`, whose fetch effect now
re-runs on `readyCount` change → outputs post live as each step completes.

### Fix #B — Write rail showed stale status ("reverted to first step" and froze)
The rail's progress poll targeted a **fixed** project id and relied on a separate "follow" effect + a
once-fetched template, all keyed to `[slug]`; a socket reconnect or interrupted hand-off froze
`activeProject` on the phase it started with (owner saw Bible→step 1 / 0% while the backend was already
in Production). Fix (`PipelineRail.tsx`): poll the **frontier** via `/api/books/:slug/current-project`
(self-heals across transitions + reconnects, advances phases on its own, fires the auto-execute kick when
a new phase goes active — subsumes the removed follow effect); and render the live project's own steps
(correct labels + real per-step status) instead of mapping a stale template.

> **Note:** Fix #B is still **browser-driven**, so it does NOT fix the phase-boundary stall in §3 — that
> needs a server-side driver.

---

## 2. Already shipped in `c2bc06e` (validated by this run)
- **Pipeline phase-advance kick** (`PipelineRail` follow effect / now the frontier poll): Planning→Bible
  and Bible→Production both auto-advanced and executed with no manual kick **while a browser was open**.
- **Config persistence to the workspace mount**: `ai.openrouter.model` etc. now survive rebuilds.

---

## 3. Bugs found (ranked, most → least severe)

### B1 — No server-side phase driver → the pipeline stalls at any boundary with no browser open  *(CRITICAL)*
**Root cause of the 663 stall, confirmed.** `project-663` `step-1` (revision) was marked `active`, steps
2–24 `pending`, **no error on any step**; the full container log shows Deep Revision was **never
executed** — the only line for it is "built 24 Steps" at creation (01:34Z). When Production completed
(04:24:56Z) the server hook `advancePipeline` marked 663 `active`, but with **autonomous mode OFF** the
only thing that fires `/auto-execute` is a **browser** (`PipelineRail`). Production's single kick ran all
65 steps server-side (~4 h); when it finished no tab was open, so 663 orphaned (`0/24`, frozen ~8 h,
idle CPU, no outbound call). It cannot self-resume. The earlier boundaries only advanced because a
browser was open then. Fix #B does **not** solve this (also browser-driven).
- **Fix options:** (a) have `advancePipeline` / the `onProjectCompleted` hook kick the next phase's
  execution **server-side** (opt-in flag, so it works headless); or (b) a lightweight server watchdog
  that resumes any `active` phase-project with no in-flight runner.
- **Interim unblock (used):** `POST /api/projects/<id>/auto-execute` (detached, server-side). Re-kick is
  required at **each** remaining boundary (663→664, 664→665).

### B2 — Consistency fact-store missing `canonical` column migration → `no such column: canonical`  *(HIGH)*
`facts`/`knowledge` define `canonical` only in `CREATE TABLE IF NOT EXISTS`
(`gateway/src/services/consistency/fact-store.ts:32,42`); the additive-migration block (`:48–52`) covers
only `story_elapsed`. Any DB created before `canonical` existed lacks it, so **every** consistency query
(`:75,98,138,…`) fails and the audit throws. Effect: the post-production **auto-consistency audit was
silently skipped** (`ℹ Auto consistency audit skipped … no such column: canonical`, 04:24Z) — consistency
checking is effectively **disabled** on any deployment with a pre-`canonical` DB (incl. Mercury).
- **Fix:** add PRAGMA-checked `ALTER TABLE facts ADD COLUMN canonical INTEGER NOT NULL DEFAULT 1` and the
  same for `knowledge`, mirroring the existing `story_elapsed` migration.

### B3 — Context-engine entity extraction: recurring unrecoverable JSON parse failure (3×)  *(MEDIUM)*
`[context-engine] Entity extraction error: Could not parse AI JSON after recovery attempts` at ~02:28,
and 2× in 03:31–03:46, all during production `creative_writing`. Consistent malformed shape:
`deepseek-v4-pro` emits `attributes` as an object then more objects —
`"attributes":{"key":"engaged","value":"…"},{"key":"location","value":"…"}` — where an **array**
(`"attributes":[{…},{…}]`) is expected; the JSON-recovery pass can't fix it. Fail-soft (pipeline
continued), but each failed chapter's entities aren't extracted → **cumulative continuity-tracking gaps**.
- **Fix:** constrain the extractor's `attributes` to an array in the prompt/schema, and/or harden the
  JSON recovery to coalesce a `{…},{…}` run into an array.

### B4 — Meta-leakage in the compiled manuscript  *(MEDIUM)*
`project-662-step-65-compile-manuscript.md` contains `**Target Word Count per Chapter:** ~2500 words`
and `**Final Word Count:** 800,000 words` (a hallucinated number). The per-chapter meta-strip worked
(the only other meta-ish grep hits were legit italic interior monologue), but it **does not cover the
compile/assemble step's output**.
- **Fix:** apply the meta-strip (or a compile-specific guard) to the compile step's result.

### B5 — `book-launch` pipeline references a skill that isn't installed  *(LOW)*
`⚠ Books: skill "book-launch" referenced by pipeline not found — skipping snapshot` (1×). The launch
phase's template points at a missing skill.

### B6 — Auxiliary tasks fall back to Ollama (2×)  *(LOW)*
The context/consistency extractor fell back to `ollama` twice (~ch21 mid-run, and just before the failed
audit). **Chapter generation was NOT affected** (word counts 3.8–4.0k, judges 81–85/100). Worth
understanding why the primary provider was unavailable for those aux calls.

---

## 4. Content review

### Held up well (GOOD)
- **Canon consistent across all 32 chapters** — the my-third/my-fourth name-drift failure did **not**
  recur. Willow Creek 181×, Charles Nathaniel Blackwood ("Dr. Blackwood" 155×), June (Elise) Delaney 64×.
  Canon injection is working.
- **Word budget healthy** — 3.8–4.0k words/chapter, continuations fired correctly, no truncation; every
  chapter passed the craft judge (81–85/100, mechanical 97–100).

### Minor inconsistencies (low severity)
- [ ] Supporting doctor named both **"Dr. James"** (planning) and **"Dr. Jamie"** (production) — pick one.
- [ ] Stray **"Dr. Vance"** (1×, a my-third hero surname bleeding in).
- [ ] Stray **"Mass General"** (Boston) vs June's stated **NYC** backstory — reconcile where she trained.
- [ ] Hospital **"Connecticut Medical Center"** — a statewide-sounding name for a small-town hospital;
  also referenced generically as "Medical Center". Pick a small-town-appropriate name, use consistently.

### Not verified
- [ ] **POV / narrative person** — automated sampling was blocked by shell quoting. Third-person markers
  are present ("she thought", deep-POV italic interiority), but the my-fourth 1st/3rd-person flip risk is
  **unconfirmed**. Do a dedicated narrative-person pass on the manuscript.

---

## 5. Suggested fix order (next session)
1. **B1 server-side phase driver** — biggest reliability win; unblocks headless full-novel runs.
2. **B2 `canonical` migration** — one-liner-ish; re-enables all consistency checking.
3. **B3 entity-extraction array schema** + **B4 compile meta-strip** — quality/continuity.
4. **B5 book-launch skill** + **B6 Ollama-fallback investigation** — cleanup.
Then rebuild Mercury (ships Fixes #A/#B too) and re-run to verify end-to-end + the POV pass.

---

## 6. Fixes applied (2026-07-02) — code done + unit-tested, NOT yet deployed

Worked the §5 order. All `npx tsc --noEmit` clean; new/extended unit tests pass (49 across the
touched files). No Mercury rebuild yet — verification of the runtime behaviour still needs a
rebuild + a headless re-run (as with Fixes #A/#B).

- **B1 (CRITICAL) — headless server-side phase driver.** New opt-in `BOOKCLAW_HEADLESS_PIPELINE=1`
  (`init/phase-10-heartbeat-bridges.ts`): on a phase-project completion, drive the freshly-advanced
  next phase server-side via the existing `driveProject`, so a chained run no longer orphans at a
  boundary with no browser open. Gated behind the flag so the **cost-safe default is preserved** (no
  AI spend with no human present), and skipped when the autonomous heartbeat is already driving (no
  double-drive/race). Test: `tests/unit/pipeline-advance.test.ts` — the phase-06 advance + phase-10
  driver hooks now cascade a 3-phase pipeline to completion with no external driver.
- **B2 (HIGH) — `canonical` column migration.** `fact-store.ts` now PRAGMA-checks and
  `ALTER TABLE … ADD COLUMN canonical INTEGER NOT NULL DEFAULT 1` for **both** `facts` and
  `knowledge`, mirroring the `story_elapsed` migration. Re-enables the whole consistency audit on
  any pre-`canonical` DB (incl. Mercury). Test reproduces a pre-`canonical` DB and asserts queries
  no longer throw (`tests/unit/consistency-fact-store.test.ts`).
- **B3 (MEDIUM) — entity-extraction attribute shape.** Prompt made unambiguous (flat `{name:value}`
  map, explicitly forbidding `{"key":…,"value":…}` / arrays), **and** a defensive `coerceAttributes`
  (`context-engine.ts`) folds any accepted off-shape (`[{key,value}]`, `[{name,value}]`, single-key
  objects) into the flat map the engine expects — so an off-shape response degrades one entity's
  attributes instead of the whole batch being dropped. Tests in `tests/unit/context-engine.test.ts`.
- **B4 (MEDIUM) — compile meta-strip.** `strip-meta.ts` now drops standalone `**… Word Count …:**`
  production-meta lines (the `**Final Word Count:** 800,000 words` leak) at the same per-step
  choke point, anchored to the bold `Label:` form so real mid-prose mentions of "word count" are
  preserved. Tests in `tests/unit/strip-meta-commentary.test.ts`.
- **B5 (LOW) — book-launch skill reference.** The launch pipeline's "Book cover concepts" step
  referenced a non-existent skill `book-launch` (a copy of the pipeline's own name); repointed to
  the installed `cover-designer` skill (`library/pipelines/book-launch.json`). New guard test
  `tests/unit/library-pipeline-skill-refs.test.ts` asserts **every** shipped pipeline references
  only installed skills, so this class of dangling ref can't regress silently.
- **B6 (LOW) — Ollama fallback guard (now fixed).** Root cause of the *mechanism*: the context-engine
  extraction hook selected its provider with an **unguarded** `aiRouter.selectProvider(taskType)`
  (`index.ts:2429`), so when the preferred provider was momentarily unavailable the router's tier
  fallback silently picked Ollama (small context → truncates a full chapter → the aux extraction
  degrades, compounding B3's continuity gaps). **Fix:** new `isLargeContextProvider` /
  `extractionProviderError` (`model-selection.ts`) — the extraction select now throws (→ the
  fire-and-forget `.catch` logs + skips) when routing falls back to Ollama **while a large-context
  provider is configured**, mirroring the consistency-audit guard; if Ollama is the *only* provider it
  is allowed, so an Ollama-only deployment is not regressed. Tests in
  `tests/unit/consistency-model-selection.test.ts`. The *why-was-the-primary-unavailable* question
  (rate-limit vs transient) still needs the Mercury logs, but the fallback is no longer silent.

Also: `docker/docker-compose.yml` now passes `BOOKCLAW_HEADLESS_PIPELINE` through so B1 is operable in
the Docker deployment (opt-in; unset = the cost-safe default).

---

## 7. POV / narrative-person pass (done 2026-07-02) — §4 follow-up

Ran a dedicated narrative-person analysis over the assembled 33-chapter / 104,066-word manuscript
(pulled read-only from Mercury): stripped dialogue (`"…"`) and italic interior monologue (`*…*`) —
both legitimately carry "I" in deep-3rd POV — then measured first- vs third-person pronouns in the
remaining **narrative frame** per chapter.

- **Result: consistently THIRD PERSON across all 33 chapters** (overall narrative-frame 1st/3rd ratio
  **0.024**; highest single chapter 0.15). **The my-fourth 1st/3rd-person flip did NOT recur.** GOOD.

### B7 (NEW, MEDIUM) — leaked AI process-narration + a truncated scene inside Chapter 22
The POV pass surfaced a genuine defect the per-step meta-strip missed. Chapter 22 ends a scene
**mid-word** ("… He'd never asked her for a suggestion before. She") and is immediately followed by a
leaked **AI reasoning block** wrapped in ``` fences, in the model's own first-person voice:
> The original draft is cut off after "She". So we need to complete the scene… **I'll revise by** …
> **I need to complete the chapter** with the team offering more… **Let's craft the continuation** …
> **I'll write that in a clean, polished prose, following the style guide.** Let's produce the full
> revised chapter.```markdown

`stripMetaCommentary` doesn't catch it because it is (a) **mid-document** (the strip only trims
leading/trailing framing) and (b) **inside a code fence**. This is distinct from B4 (word-count meta).
- **Root cause (to investigate):** the chapter-22 production step emitted a *truncated* first draft +
  the model's "let me continue" reasoning + a retry, and all of it was saved into the chapter file, so
  the deterministic assembly carried it into the final novel verbatim.
- **Proposed fix (deferred — needs the generation path, not a blind mid-doc regex):** detect a chapter
  step output that contains a fenced/inline AI-reasoning block or a mid-word truncation and re-run /
  repair it (the chapter equivalent of `validateAssembly`), rather than broadening the safe-first
  leading/trailing strip to eat mid-document content. Tracked in `docs/TODO.md`.

**Still pending:** headless re-run on Mercury to verify B1 end-to-end + that the consistency audit now
runs (B2); B7 chapter-repair fix.
