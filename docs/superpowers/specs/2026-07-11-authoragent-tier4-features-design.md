# AuthorAgent Port — Tier 4 Features (items #10–#17)

**Date:** 2026-07-11
**Source:** `docs/AUTHORAGENT-PORT-ANALYSIS-2026-07-11.md`, Tier 4 table (items #10–#17). Fork ref: `authoragent/main` (`47e9570`).
**Baseline:** `T4-BASE = 8f53a41` (HEAD after the Tier 2/3 push).

## Purpose

Port the eight Tier-4 items from the AuthorAgent fork, each grounded in the fork's actual code and adapted to BookClaw's service topology. Several items are ADAPT (take the idea, reimplement against our tree) rather than drop-in. Three items are honestly **scoped down** where the fork's feature is largely redundant against a stronger BookClaw implementation (documented per-item). All new endpoints are additive/fail-soft; no existing behaviour changes except the two deliberate bug fixes (#15 null-byte hardening, #16 untrimmed-name).

Test convention (established by Tier 1–3): Node built-in runner, `node --import tsx --test tests/unit/<file>.test.ts`. `.js` import extensions (NodeNext). No commits until goal step 7.

---

## #10 API-key format validation on vault save (PORT, trivial)

Non-blocking warning when a saved credential doesn't match its provider slot's shape. **Never blocks the save.**

- **New:** `validateKeyFormat(keyName: string, value: string): { ok: boolean; warning?: string }` exported from `gateway/src/api/routes/_shared.ts` (pure, directly unit-testable). Validation table (ported, adjusted to our 5 vault slots): `openai_api_key` → `/^sk-(?!ant-)/`; `anthropic_api_key` → `/^sk-ant-/`; `gemini_api_key` → `/^AIzaSy/`; `openrouter_api_key` → only flag clear cross-provider pastes (Google/Anthropic prefixes); `telegram_bot_token` → `/^\d+:[A-Za-z0-9_-]+$/`; unknown key name (incl. `deepseek_api_key`) → always `{ok:true}`.
- **Wire:** in `gateway/src/api/routes/settings.routes.ts` `POST /api/vault` (~line 31-54), call `validateKeyFormat(key, value)` and add `warning: check.warning` to the existing `res.json({ success, key, refreshedProviders })` (additive field, non-breaking). `console.warn` server-side. No change to `Vault.set` (provider-agnostic by design).
- **Optional frontend** (`frontend/studio/src/routes/Settings.tsx` `saveKey`): surface `r.warning` in the existing `msg` state. Low priority; the smoke tests the route field.
- **Test:** `tests/unit/vault-key-format.test.ts` — correct-shape accepts; cross-provider paste flags with the right provider name; unknown key name ok.
- **Effort:** trivial. **Risk:** very low (additive response field). **Files:** `_shared.ts`, `settings.routes.ts`, (opt) `Settings.tsx`, new test.

---

## #11 `GET /api/onboarding/status` (PORT backend)

Read-only first-run checklist. Backend only.

- **New:** `gateway/src/api/routes/onboarding-status.ts` exporting pure helpers `hasProviderKeyName(keys)`, `isVoiceProfileTemplate(content)` and `computeOnboardingStatus(services, baseDir): Promise<{firstRun, checklist}>` (`checklist` = `Array<{id,label,done,hint}>`). Each signal try/caught (one failure → that item `done:false`, never 500).
- **Signals → accessors:** `ai_provider` = `services.aiRouter.getActiveProviders().length>0` (fallback `hasProviderKeyName(await vault.list())`, 5-key list, drop `together_api_key`); `voice_profile` = `workspace/soul/VOICE-PROFILE.md` exists && not the "Not Yet Analyzed" marker; `soul` = `workspace/soul/SOUL.md` non-empty; `project` = `getProjectEngine().listProjects().length>0 || services.books.list().length>0`; `telegram`/`discord` (optional) = `config.get('bridges.<x>.enabled')` && vault has the token. `firstRun` gated on `ai_provider && project`.
- **Wire:** mount in `gateway/src/api/routes/core.routes.ts` `mountCore` after `/api/status`.
- **Test:** `tests/unit/onboarding-status.test.ts` — pure helpers + a real-express + fake-gateway route test over a tmp `workspace/soul` fixture; fail-soft (a throwing accessor → 200, that item false).
- **Effort:** small. **Risk:** low (read-only). **Files:** new `onboarding-status.ts`, `core.routes.ts`, new test.

---

## #12 Character motivation check (ADAPT — scoped to motivation only)

**Scope-down:** the fork's `character-agent` bundles voice + knowledge-horizon + motivation. **Skip off-voice** (redundant with `character-voices.ts` drift). **Skip knowledge-horizon** — our `consistency/continuity-check.ts` `evaluateKnowledge` already does fact-level, story-time acquire/use tracking (`ContinuityFlag.kind==='knowledge'`), strictly stronger than the fork's chapter-presence heuristic; porting it would add a weaker duplicate path. **Only the motivation check is genuinely new** (nothing in our tree checks drafted prose against established motivation).

- **New:** `gateway/src/services/character-motivation.ts` — `CharacterMotivationService.critiqueMotivation(input, aiComplete, aiSelectProvider, entities, summaries)` (one `style_analysis`-tier AI call per eligible character; `MIN_LINES_FOR_CRITIQUE=3`, `MAX_CHARACTERS_PER_RUN=5`; never throws on malformed AI output). Builds a `CharacterMotivationBrief` from `EntityEntry.attributes` + `.changes` (arc). Report shape `CharacterMotivationReport{projectId,chapterId?,generatedAt,charactersReviewed,byCharacter:[{character,linesReviewed,flags:[{line,reason,suggestion}]}]}` (no `issue` discriminator — one issue kind). Inline a trimmed dialogue-extraction copy (~40 lines from `character-voices.ts`) — do NOT depend on #16's parser (keep independent). Data via `ContextEngine.getEntities`/`getSummaries` after `loadContext`.
- **Wire:** instantiate in `phase-07-knowledge.ts` (near `characterVoices`); `characterMotivation` field on gateway + `getServices()`; route `POST /api/projects/:id/motivation-critique` in `wave.routes.ts` (mirror `craft-critique`); MCP `motivation_critique` in `mcp/src/tools/craft.ts`.
- **Test:** `tests/unit/character-motivation.test.ts` — `buildCharacterMotivationBrief` renders attributes+arc; `critiqueMotivation` with fake AI parses/filters JSON, malformed→`[]` not throw, respects the caps.
- **Effort:** low-moderate. **Risk:** low (additive, stateless, opt-in). **Files:** new `character-motivation.ts`, `phase-07-knowledge.ts`, `index.ts`, `wave.routes.ts`, `mcp/src/tools/craft.ts`, new test.

---

## #13 Translation execution (ADAPT)

Complete the half-built feature: our `translation-pipeline.ts` ships planning only. Port `executeTranslation` (our file is a stripped copy of the fork's).

- **In `gateway/src/services/translation-pipeline.ts`:** port the `AICompleteFn`/`AISelectProviderFn`/`TranslationTier`/`ExecuteTranslationInput`/`ExecuteTranslationResult` types, `setAI()`, `executeTranslation(input)`, and private `chunkManuscript` (paragraph-boundary greedy pack ≤6000 chars), `buildTranslationSystem` (translation-only, Markdown/proper-noun/glossary preservation), `translateChunk` (one retry, then a `[TRANSLATION ERROR …]` marker + original so one bad chunk never loses the book). Accumulate router cost, words-based fallback when $0. Routes `tier==='premium'?'final_edit':'revision'` (both task types already exist). **Do NOT port `executeApprovedTranslation`** — the gate check moves to the route (BookClaw convention). JSON in/out, no disk write.
- **Wire:** route `POST /api/translation/execute` in `knowledge.routes.ts` after `/propose`, using the shared `requireApprovedConfirmation(services.confirmationGate, {id, expectedService:'translation-pipeline'})` (mirror `website.routes.ts` `/deploy/finalize`) + `recordOutcome` on success/failure. `gw.translationPipeline.setAI(...)` in `phase-09-export-wave.ts` after the existing `setGate`.
- **Test:** `tests/unit/translation-execute.test.ts` — fake AI: throws before `setAI`; single/multi-chunk boundaries; premium→final_edit routing; glossary in system prompt; `fr`→disclosure warning; double-fail→error marker + `failedChunks`, rest still translates. `tests/wave3-gate-smoke.sh`: execute without approval → 400/409 (AI-free).
- **Effort:** small. **Risk:** low (chunk failure fail-soft; gate already built in `proposeTranslation`). **Files:** `translation-pipeline.ts`, `knowledge.routes.ts`, `phase-09-export-wave.ts`, new/updated tests.

---

## #14 Model-aware pricing (ADAPT — table + CostTracker override)

Fix the acknowledged `#35b` mispricing (router bills every non-default-model call at the provider's flat boot rate → Opus ~40% too cheap). **Decision (locked):** the intent is to *fix* the mispricing, so `CostTracker` **overrides** the router's flat estimate for known models (a literal "fill the dormant fallback" reading fixes nothing live, since the router always supplies an estimate).

- **New:** `gateway/src/ai/pricing.ts` — port `LLMPrice`, `LLM_PRICING`, `getLLMPrice(model, fallback?)` (LLM subset only; skip image pricing). `PRICING_LAST_VERIFIED='2026-07-11'`. Per-1K list prices: claude-sonnet-4-5(+`-20250929` alias) 0.003/0.015; claude-opus-4-8(+4-5/6/7) 0.005/0.025; claude-haiku-4-5 0.001/0.005; claude-fable-5 0.010/0.050(rough); gpt-4o 0.0025/0.01; gpt-4o-mini 0.00015/0.0006; gemini-2.5-flash/-pro 0/0; deepseek-chat 0.00014/0.00028; deepseek-reasoner 0.00055/0.00219(rough).
- **Wire:** extend `CostTracker.record()` (`gateway/src/services/costs.ts`) with trailing optional `model?, promptTokens?, completionTokens?`. When `provider!=='openrouter' && model && promptTokens!=null && completionTokens!=null`: `cost = getLLMPrice(model, {flat,flat}).costPer1kInput/Output * tokens/1000` (overrides). Else keep today's `estimatedCost`/flat-fallback path. OpenRouter excluded (its `estimatedCost` may already be real `usage.cost`). Append `resp.model, resp.promptTokens, resp.completionTokens` at the 9 `record()` call sites (`index.ts` ×4, `phase-06-content.ts`, `prompt-runner.ts`, `skill-runner.ts`, `_shared.ts` ×2); leave `_shared.ts:325` research-lookup (no router response) untouched.
- **Test:** `tests/unit/pricing.test.ts` (known→listed exact, unknown→fallback rough, no-fallback→0/0); extend `tests/unit/costs.test.ts` (known model overrides flat; unknown finite/no-throw; openrouter passthrough; existing tests stay green — trailing optional args only).
- **Effort:** low. **Risk:** low; the override is a deliberate divergence from `record()`'s "prefer router estimate" doc-comment (updated in the same change). **Files:** new `pricing.ts`, `costs.ts`, 9 call sites, new/updated tests.

---

## #15 Path-safety consolidation (ADAPT — preserve realpath)

Consolidate 3+ path-safety impls onto the fork's stronger helpers. **The "~25 call sites" collapse to a one-line alias.** **CRITICAL: do NOT port the fork's `sandbox.ts`** — it dropped the `realpathSync` symlink-escape defense (a regression).

- **New:** `gateway/src/security/paths.ts` (distinct from existing `gateway/src/paths.ts`) — port `resolveWithin(base,...segs)` (throws; null-byte + boundary via case/sep-normalized compare), `safeResolveWithin(...)` (null on throw), `sanitizeSegment(name, fallback='file')` (control-char/sep/Windows-illegal strip, `..` collapse, leading-dot strip, 200-cap, empty→fallback, Windows-reserved CON/PRN/AUX/NUL/COM1-9/LPT1-9→fallback).
- **Migrate (behavior-preserving):**
  - `gateway/src/api/routes/_shared.ts`: re-point `safePath(base,input)` body to `return safeResolveWithin(base,input)` (1 line + import). **All 28 callers unchanged.** Only delta: null-byte now → null (→ existing 403), a security gain.
  - `gateway/src/security/sandbox.ts`: `validatePath` lexical layer → `safeResolveWithin`, **KEEP `assertRealpathContained` (realpath) + `forbiddenPatterns` + `..`-segment checks**; `sanitizeFilename` → `sanitizeSegment(name,'file')` (callers already `.slice(0,200)||'upload'`).
  - `gateway/src/services/memory.ts`: delete private `sanitizeSegment`, import shared, update 4 sites (edge-case delta on reserved/all-dot internal IDs — flagged, acceptable).
  - Optional (same batch): fold inline boundary checks at `export.routes.ts:183`, `heartbeat.routes.ts:321`, `reports.ts:123` into `safeResolveWithin` (preserve each status code).
- **Test:** `tests/unit/path-safety.test.ts` — port the fork's matrix (`..`/mixed-slash traversal, sibling-prefix, null byte, non-string, Windows-reserved, `console.txt` NOT rejected, 200-cap) **plus a load-bearing regression: an in-workspace symlink to `/etc` is still blocked by `SandboxGuard.validatePath`** (proves realpath preserved).
- **Effort:** ~2-3h. **Risk:** low-medium; the realpath-preservation is the sharp edge — must not copy the fork's sandbox.ts. **Files:** new `paths.ts`, `_shared.ts`, `sandbox.ts`, `memory.ts`, (opt) 3 inline sites, new test.

---

## #16 Dialogue-parser deduplication (ADAPT — fix the untrimmed-name bug)

Extract one shared parser and fix the confirmed untrimmed-name bug. **Scope-down:** migrate the two consumers that both duplicate the logic AND carry the bug; **leave `dialogue-auditor.ts` untouched** — its attribution algorithm is architecturally distinct (position-scan, different verb set, no known-character validation, deliberately-unfiltered `paragraphIndex` guarded by `tests/unit/dialogue-auditor.test.ts:95-96`); forcing it through the shared parser is a behavior-changing separate feature, not a dedup.

- **The bug (2 instances, same root cause — key trimmed, canonical value not):** `character-voices.ts:515-528` `canonicalize()` — a character name with stray whitespace silently **drops the whole dialogue line** (data loss); `audiobook-prep.ts:339-343` — mis-voices to narrator + pollutes `unmappedSpeakers`. Fixed by `buildNameLookup` trimming both key and value.
- **New:** `gateway/src/services/dialogue-parser.ts` — port the fork's pure functions: `splitParagraphs`, `startsWithQuote`, `extractSpokenText`, `buildExplicitTagRegex`/`buildReverseTagRegex`, `matchSpeakerTag`, `buildNameLookup` (trims key+value), `escapeRegex`, `DEFAULT_SPEECH_VERBS`.
- **Migrate:** `character-voices.ts` `extractDialogue`/`canonicalize` → shared calls (keep its 21-verb list via `matchSpeakerTag({speechVerbs})` to avoid widening matches). `audiobook-prep.ts` `attributeMultiVoice` → shared calls, **omit `extractSpokenText`** (TTS keeps the full paragraph). Both behavior-preserving except the bug fix.
- **Test:** `tests/unit/dialogue-parser.test.ts` (port fork matrix, `node:test` syntax); add a regression test per bug instance (`characterNames:['Sarah ']` → voice resolves / character record created). Existing `character-voices.test.ts` (8), `audiobook-prep.test.ts` (13), `dialogue-auditor.test.ts` (14) stay green unmodified.
- **Effort:** low-medium. **Risk:** low (strong existing test harness). **Files:** new `dialogue-parser.ts`, `character-voices.ts`, `audiobook-prep.ts`, updated tests. `dialogue-auditor.ts` explicitly descoped.

---

## #17 revision-orchestrator unified report (ADAPT)

A thin aggregator over detectors we already have — **presentation, not new detection.**

- **New:** `gateway/src/services/revision-orchestrator.ts` — port the fork's `Finding`/`RevisionReport`/`REVISION_PASSES`/`SKIP` sentinel/`dedupe`/`sort` machinery near-verbatim (detector-agnostic pure aggregation); rewrite the pass-runners against our detectors. `buildReport({projectId, chapters, passes?})` fans out per-chapter to: **craft** (`craftCritic.analyze`, severity pass-through), **dialogue** (`dialogueAuditor.audit`, pass-through), **continuity** (reads already-persisted `chapters[].continuityFlags` — NO new AI call; synth severity contradiction→error, timeline/knowledge/red_herring→warning), **voice** (`characterVoices.detectDrift`, severity hardcoded `'warning'`), **mechanical** (`writingJudge.mechanicalScreen`, pass-through, inject `chapterId`). Drop the fork's no-op `fact` pass. Each pass isolated in try/catch → `passesSkipped`; a missing dep → `SKIP`. Report: `{projectId,chapterId?,generatedAt,totalFindings,findingsBySeverity,findingsByPass,findings,passesRun,passesSkipped}`.
- **Wire:** instantiate in `phase-09-export-wave.ts` (`new RevisionOrchestrator({craftCritic,dialogueAuditor,writingJudge,characterVoices})` — all on `gw` by phase-09); `revisionOrchestrator` field + `getServices()`; route `POST /api/projects/:id/revision-report` in `wave.routes.ts` (reuse `gatherChapters`, which includes per-chapter `continuityFlags`); MCP `revision_report` in `mcp/src/tools/craft.ts`. Does NOT replace `human-review.ts`'s `buildCadenceGateFindings` (narrower gate payload) — parallel, no shared mutable state.
- **Test:** `tests/unit/revision-orchestrator.test.ts` — fake each detector via optional deps: severity normalization for continuity/voice; a null dep → `passesSkipped` not throw; dedup collapses near-identical cross-chapter findings; sort error-first then pass-order; a throwing detector → `passesSkipped`, others still run.
- **Effort:** small-medium. **Risk:** low (all deps optional/fail-soft, no new AI). **Files:** new `revision-orchestrator.ts`, `phase-09-export-wave.ts`, `index.ts`, `wave.routes.ts`, `mcp/src/tools/craft.ts`, new test.

---

## Cross-cutting: shared-file conflict map

| File | Touched by |
|------|-----------|
| `gateway/src/api/routes/_shared.ts` | #10 (validateKeyFormat), #14 (2 record() call sites), #15 (safePath body) |
| `gateway/src/index.ts` | #12 (field+getServices), #14 (4 record() call sites), #17 (field+getServices) |
| `gateway/src/api/routes/wave.routes.ts` | #12 (route), #17 (route) |
| `mcp/src/tools/craft.ts` | #12 (tool), #17 (tool) |
| `gateway/src/init/phase-09-export-wave.ts` | #13 (setAI), #17 (instantiate) |
| `gateway/src/init/phase-07-knowledge.ts` | #12 (instantiate) |
| `gateway/src/services/costs.ts` | #14 |
| `gateway/src/api/routes/knowledge.routes.ts` | #13 |
| `gateway/src/api/routes/core.routes.ts` | #11 |

Fully self-contained (no shared hot file): **#11** (onboarding), **#16** (dialogue-parser + its two consumers), **#15** (mostly — only `_shared.ts` safePath body overlaps #10/#14). Execution sequences the shared-file wiring (see plan).

## Success criteria

1. Each feature's unit tests pass in isolation.
2. `npx tsc --noEmit` clean (root + mcp); mcp builds.
3. Existing suites stay green (`costs`, `character-voices`, `audiobook-prep`, `dialogue-auditor`, path/vault) — modulo the known parallel-runner flake.
4. No unintended behaviour change: the only deliberate deltas are #15 null-byte hardening and #16 untrimmed-name fix; `dialogue-auditor.ts` untouched.
5. Code review: all Medium+ findings fixed.
6. Smoke tests cover each new live surface; pass against Mercury.
7. Deployed to Mercury; `commit_message` written; pushed.
