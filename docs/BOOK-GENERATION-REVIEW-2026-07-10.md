# Book Generation System Review — 2026-07-10

Full-file bug review of the book generation system, ranked most severe to least.

**Scope:** ProjectEngine (`services/projects.ts`), BookService (`services/book.ts`, `book-types.ts`, `book-canon.ts`), AI router (`ai/router.ts`), pipeline-engine helpers (`services/pipeline/*`, `pipeline-expand.ts`, `pipeline-vars.ts`, `prompt-runner.ts`, `sequence-parse.ts`, `prompt-parse.ts`, `runner-files.ts`, `merge.ts`, `strip-meta.ts`), romance intake and council (`premise-intake.ts`, `romance-interview.ts`, `council.ts`, `council-gate.ts`), context assembly (`context-engine.ts`, `soul.ts`, `library.ts`, `story-structures.ts`, `story-forms.ts`), API routes (`api/routes/projects.routes.ts`, `books.routes.ts`, `_shared.ts`), orchestration and export (`orchestrator.ts`, `manuscript-assembly.ts`, `manuscript-hub.ts`, `docx-export.ts`, `epub-export.ts`), plus review-gate and cost glue (`human-review.ts`, `skill-runner.ts`, `costs.ts`, `util/chapter-context-extraction.ts`).

`npx tsc --noEmit` is clean; every finding below is runtime logic, not a compile error. The highest-severity findings were verified directly against the code (scheduler promise-sharing, non-atomic state writes, the in-memory-only context cache, the Gemini thinking-budget math); the rest were verified against callers and, where relevant, vendored dependency source.

---

## Critical — data loss or corruption of live book state

1. **Project state can be wiped entirely, then new output overwrites old chapters.** `projects.ts:360-384` writes `projects-state.json` with a plain `writeFile` (no temp-file + rename), and `loadState` (`:389-434`) reacts to corrupt JSON by continuing with an empty map and `nextId = 1`. A crash mid-write therefore loses every project's progress, and — because IDs restart at `project-1` — the next project's step files (`project-1-step-N-….md`) silently overwrite the previous book's chapters in the shared data dir. The 1s save debounce is trailing (each call re-arms it) so a burst of completions can defer the write indefinitely, and there is no shutdown flush. On Neptune this is live production data.

2. **Every `book.json` write is equally non-atomic, and mutators race each other.** All ~13 manifest/pointer writes in `book.ts` (lines 370, 382, 396, 515, 586, 622, 648, 999, 1022, 1042, 1312, 1369, 1728) are direct `writeFile`s; a crash mid-write truncates `book.json`, after which `open()` returns `undefined` and `list()` skips the book — it vanishes from the UI with its data intact but unreachable. The v1-to-v2 migration even rewrites the manifest on a read path. Separately, every mutator (`setPhase`, `setFormat`, `setAppendix`, `updatePulledFrom`, and others) does read-modify-write with awaits in between and no per-book serialization, so a pipeline-completion `setPhase` racing a UI `setFormat` silently loses one of the updates.

3. **DriveScheduler's queue dedup causes concurrent double-drives of one project.** `pipeline/scheduler.ts:60-61` returns the *same* pending promise to a second `acquire()` for a queued project, and `drainQueue()` (`:115-121`) resolves it `true` once — every awaiter receives `true`, so two runners (e.g. two firings of the 60s review-resolver sweep) drive the same project simultaneously: duplicate chapters, double spend. Worse, the first finisher's `release()` frees the per-project lock while the duplicate is still driving, letting a third runner in — the corruption cascades. Duplicate awaiters need to resolve `false`.

4. **After any gateway restart, chapters are written with zero story context.** `context-engine.ts` `getRelevantContext`/`getSummaries` read only the in-memory map (`:617-625` — "works entirely from in-memory data"), and `loadContext()` is only called from `generateSummary`/`extractEntities`/`runContinuityCheck` — never on the generation path, and ProjectEngine never calls it. Resume a book at chapter 14 after a deploy and the prompt gets no summaries, no entities, no rolling continuity — silently — even though `workspace/context/<id>.json` holds everything. Compounded by the context engine's own 2s debounced persist with no flush.

5. **The council's base story is reduced to a 500-char stub after a restart.** `persistState` truncates every step result to 500 chars (`projects.ts:374`), relying on rehydration from the step's `.md` file — but all three council completion paths (`council-gate.ts:90`, the `/execute` and auto-execute short-circuits, `applyCouncilSelection`) bypass the file write that only AI-generation paths perform. Restart mid-book and every remaining step builds on the first 500 characters of the premise/relationship arc. For a multi-day 40-chapter romance run on Mercury/Neptune, a restart is routine.

## High — wrong books get generated, or exports fail

6. **`/execute` bypasses both review gates and corrupts gated steps.** `projects.routes.ts:470-540` never checks `project.review` (unlike `/auto-execute`, which returns 409 at `:847`): executing a cadence-gated step regenerates it (duplicate spend), completes it, and a later review "approve" then overwrites the fresh result with the stale pre-gate draft. `/execute` also never calls `maybeOpenCadenceGate`, so a book with `per_chapter` review cadence driven by the Execute button never gates at all.

7. **retry/restart/skip/resume mutate a project mid-generation.** The four mutation routes (`projects.routes.ts:745`, `:772`, `:1500`, `:1685`) have no `isDriving` guard. Restart during an in-flight chapter resets all steps, then the in-flight loop's `completeStep` on its stale reference re-activates the frontier — the "restarted" project jumps ahead with mixed state. `resumeProject` (`projects.ts:1498-1515`) additionally demotes an in-flight step to `pending` and activates the *next* step, so chapter N+1 gets drafted before chapter N exists.

8. **A project can complete with failed steps — a hole in the manuscript.** `'failed'` is not in `completeStep`'s remaining-work filter (`projects.ts:1296-1300`) and `runnableSteps` skips failed steps, so after "Write Chapter 5" fails, resume advances from chapter 6 to the end, the project is marked completed, and completion hooks (website auto-add-book) fire with chapter 5 missing.

9. **Gemini calls with high reasoning starve their own output.** `router.ts:614-626` sets `thinkingBudget` (up to 16384) without adding it on top of `maxOutputTokens` — the Claude path explicitly corrects for exactly this (`:699-704`). For `consistency` (thinking 16384, output budget 8192) the model spends the whole cap thinking and returns nothing; the error handler (`:661-670`) then misreports it as a content-safety block, telling the author to rewrite their prompt.

10. **Truncated AI output is never detected, and the DeepSeek clamp guarantees it.** No completion path checks `finish_reason: length` / `MAX_TOKENS` / `stop_reason: max_tokens` — partial text is returned as success (`CompletionResponse` has no truncation field). `router.ts:814` clamps a 16384-token `outline` request to DeepSeek's 8192, so whenever Gemini is unavailable, outlines/bibles arrive half-finished and break downstream steps — the exact failure mode the `TASK_OUTPUT_BUDGET` comment warns about.

11. **Exported EPUBs are spec-invalid.** `epub-export.ts:45` adds the `mimetype` entry through adm-zip, which DEFLATE-compresses every non-empty entry (verified in the vendored `zipEntry.js:303-313`); OCF requires it stored, first, at byte 38. epubcheck fails, and KDP/Apple/Kobo validation can reject the upload even though desktop readers open the file.

12. **A transient FS error during a book switch silently erases the author identity.** `soul.ts` `load()` blanks all fields *before* its awaited reads (`:81-101`); `useBook`'s catch restores the directory pointers but never re-runs `load()`, so prompts fall back to "You are BookClaw, a helpful writing assistant" while the log claims "keeping current Author".

13. **Regenerating chapter 1 injects the book's ending as "Previous Chapter".** The fallback ternary in `context-engine.ts:649-662` returns the *last* summary when the current chapter is first (or unmatched), leaking the finale's `endingState` into the rewritten opening. Relatedly, "Relevant Earlier Events" (`:721-743`) has no `chapterNumber < current` filter, so regenerating chapter 5 can pull chapters 12 and 20 into its context.

## Medium — quality degradation, wasted spend, stuck workflows

14. **Council in `/execute` runs before the drive lock** (`projects.routes.ts:497-507` vs `:534`): a double-click double-bills the full council ensemble and can double-complete the step; council spend also bypasses the budget-pause check.

15. **"Regenerate"/"edit" on a pipeline-gate silently approves it.** `applyReviewResume`'s branches only match those actions for `cadence-gate`; anything else falls through to complete-the-step (`projects.ts:999-1028`).

16. **The adaptive interview breaks from turn 2 on Claude/Gemini-routed deployments.** The kickoff user message is server-substituted but never returned, so subsequent transcripts start with an assistant message, which Anthropic (and current Gemini) reject (`romance-interview.ts:51-56`, `books.routes.ts:102-116`).

17. **The interview trusts `done:true` with null seeds** (`romance-interview.ts:65-79`) — the whole conversation collapses into a blank, irreversible review form.

18. **Outline context is head-truncated to 4,000 chars** in the writing phase (`projects.ts:1899-1902`), so chapters ~10+ never see their own beats — systematic outline drift in the back half of every novel. The default context branch has the opposite problem: unbounded accumulation (~160K chars by step 21 of deep-revision, `projects.ts:1615-1633`).

19. **The rolling summary truncates its Entity Registry first** (`pipeline/rolling-summary.ts:77-81`) — late chapters of long books systematically lose the continuity roster this module exists to protect.

20. **`strip-meta.ts:64-70` deletes legitimate content.** The word-count filter is not gated on prose, so "Estimated word count: 800" lines requested by the scene-breakdown step are stripped from the deliverable.

21. **Write-gate bypasses in BookService.** `assertWritable` fails open when the manifest is unreadable (`book.ts:1501-1506`), and `setAppendix` (`:1032-1044`) skips the gate entirely — a read-only (too-new) book's manifest is writable through the appendix route.

22. **Re-pull never deletes stale files** (`book.ts:1527-1576`) — library deletions never converge and `repullStatus` reports "diverged" forever; series pipeline pulls update `pulledFrom` but not `pipelineSequence` (`:1263-1295`), so the pulled pipeline is inert; only the first sequence pipeline is re-pullable (`:1455-1468`).

23. **Manuscript Hub double-counts words and steps** (`manuscript-hub.ts:194-198` counts both `file_saved` and `step_completed`, which carry the same wordCount) — daily-goal and streak tracking run at roughly 2x.

24. **`mapRunnerPath` does not block dot-segments** (`runner-files.ts:22-28`) — the runner file API can overwrite `.versions/` history sidecars it claims are unreachable.

25. **`/api/projects/:id/provider` never persists** (`projects.routes.ts:1728-1730`), reverting on restart; template save routes have unguarded `writeFile`s that hang requests on FS errors (`:90`, `:106`).

26. **Legacy no-book project deletion uses a title-derived directory** (`projects.routes.ts:1781-1798`) — two projects with the same title share it, and `?files=true` deletes the survivor's files.

27. **`AIRouter.reinitialize()` clears the provider map before repopulating** across several awaits (`router.ts:191`) — saving an API key mid-run fails an in-flight step. `LibraryService.loadAll()` (`library.ts:100-109`) and `SoulService.load()` have the same clear-then-await-repopulate window.

28. **Orchestrator (user-script manager).** Health-check auto-restart is a guaranteed no-op (`orchestrator.ts:478-485` — the trigger condition is exactly what `start()` early-returns on); spawn errors skip auto-restart and emit no crash event (`:260-265`); `orchestrator.json` persistence is non-atomic and fail-open (`:526-534`); `buildSafeEnv` (`:52-67`) strips AI keys but not `BOOKCLAW_AUTH_TOKEN`.

29. **Gemini parses only `parts[0]`** (`router.ts:657`) — multi-part long generations are silently cut; OpenAI o-series get no reasoning headroom (`:824-829`), mirroring finding 9.

## Low — cosmetic, misleading, or edge-case

30. Skipping a parked council step wedges the project behind a phantom gate (`projects.routes.ts:1500` has no `selection` guard), and `clearCouncilSelection` — the documented abandon path — has no callers at all.

31. `/council/select` silently substitutes the judge's pick on an unknown candidate ID and still returns `ok:true` (`projects.ts:1055-1056`).

32. Premise intake can research "Real geography of undefined" when a place is flagged but unnamed (`premise-intake.ts:51,61`), and the council fail-soft fallback labels the character roster as "RELATIONSHIP ARC" (`council-gate.ts:34-38`).

33. Structural-beat math produces negative/contradictory chapter ranges for short books and leaves chapters 20-22 unassigned at the default 25 (`projects.ts:480-485`, `pipeline-vars.ts:17-18`); pipeline phase labels ("Title — Production") leak into prompts as the book's title.

34. Assembly/export polish: the title block renders as a phantom first chapter in DOCX and the EPUB TOC; `---` separators become spurious `* * *` scene breaks; `####`+ headings and blockquotes pass through as literal markdown; stray asterisk pairs italicize unrelated prose; a post-polish chapter rewrite is silently ignored in favor of the older polished version.

35. Router bookkeeping: prompt-cache "savings" are fabricated (nothing is sent to any provider), paid-tier Gemini spend is hardcoded to $0 so the budget gate never sees it, Anthropic 529s are not retried, `thinking` silently swaps a pinned `deepseek-chat` to `deepseek-reasoner`, budget exhaustion throws a misleading "no providers configured" error, and `book_bible`'s 12288 budget contradicts CLAUDE.md's stated 16K.

36. Miscellaneous: `interpolate` blanks typo'd `{{vars}}` with no warning; a provider-throttle limit of 0 from hand-edited config deadlocks all generation; canon file selection is nondeterministic when multiple files match (`book-canon.ts:93-99`); library pipelines loaded from disk skip the schema validation the write path enforces; daily cost reset uses UTC midnight; `create()` failure after `claimSlug` burns the slug forever; error responses leak absolute paths (acceptable on LAN).

## Verified clean

Chapter ordering in assembly (numeric, not lexicographic), path traversal on all HTTP routes (`SLUG_RE` + `safePath`), the drive-lock discipline inside `/execute`/`/auto-execute` themselves, council-select double-submit, diff3 merge argument order, the schemaVersion classify direction, `parsePlanResponse` fence handling, and all parsing regexes (no catastrophic backtracking).

## Suggested first batch

The five critical items form a natural first batch — three of them (1, 2, and the persist halves of 4/5) share one fix pattern: atomic temp-file + rename writes plus a load-time refusal to continue from corrupt state. Items 3 and 6-8 are the concurrency/gating cluster.
