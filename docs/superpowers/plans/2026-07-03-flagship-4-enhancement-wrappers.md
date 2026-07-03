# Flagship Enhancement Wrappers Implementation Plan (Plan 4 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Apply the three uniform enhancement wrappers to every genre base — grounding research on the front, rolling-summary memory feeding each chapter, and analyze-then-apply polish on the back (chaining the existing critics into targeted apply-edit passes instead of emit-notes).

**Architecture:** A grounding-research step (using `ResearchGate.search` + `ResearchLookupService.lookup`) writes cited facts into `workspace/research/<slug>/` and injects them into the bible. A rolling-summary memory object (built on `context-engine`'s chapter summaries + entity registry) feeds each chapter draft in four tiers. The back-end polish chains `craft-critic` + `dialogue-auditor` + `beta-reader` (+ Plan 3's continuity flags) into a targeted rewrite pass per flagged chapter.

**Tech Stack:** Node 22+, TypeScript (NodeNext `.js`), `node --import tsx --test`.

## Global Constraints
- Same as Plan 1. Fail-soft: research/critics are best-effort — a failure logs and continues, never blocks generation.
- Reuse existing services: `ResearchGate` (`research.ts`), `ResearchLookupService` (`research-lookup.ts`), `ContextEngine` (`context-engine.ts`, already has `generateSummary`/entities), `craft-critic.ts`, `dialogue-auditor.ts`, `beta-reader.ts`. Do NOT reimplement them.
- Cost-aware: the grounding-research and beta-reader passes route through the router/cost tracker; the deterministic critics (craft-critic, dialogue-auditor) are zero-AI and run freely.
- **Re-ground note:** confirm `ResearchLookupService.lookup(query, opts)` return shape, `ContextEngine.generateSummary` signature (Plan 1's `chapterSummaryTarget` feeds it), and each critic's public method before writing tests.

## File Structure
- Create `gateway/src/services/pipeline/grounding-research.ts` — `runGroundingResearch(book, signals, deps)` → cited facts written to `workspace/research/<slug>/` + a bible-injection string.
- Create `gateway/src/services/pipeline/rolling-summary.ts` — `buildRollingSummary(project, chapterNumber, contextEngine)` → the four-tier memory block.
- Create `gateway/src/services/pipeline/analyze-apply.ts` — `analyzeChapter(...)` (runs critics + Plan 3 flags → structured findings) and `applyEdits(...)` (targeted rewrite prompt from findings).
- Modify `gateway/src/api/routes/projects.routes.ts` — inject the rolling summary into each chapter draft; run analyze-then-apply in the revision/polish phase.
- Modify the bible-phase wiring (`phase-06-content.ts` or `projects.routes.ts`) to call `runGroundingResearch` before/within the bible phase.
- Tests: `tests/unit/grounding-research.test.ts`, `tests/unit/rolling-summary.test.ts`, `tests/unit/analyze-apply.test.ts`.

## Tasks

### Task 1: Grounding research (front)
**Files:** create `grounding-research.ts`; test `grounding-research.test.ts`.
**Interfaces:** `runGroundingResearch(args: { slug: string; signals: { setting?: string; period?: string; domain?: string; genre: string }; research: ResearchGateLike; lookup: ResearchLookupLike; writeFile: (p:string,c:string)=>Promise<void>; researchDir: string }): Promise<{ citedFacts: string; sources: string[] }>` — for dark genres frames queries as "summarize what is publicly documented about X for fiction accuracy" (Plan 2's consequence-not-procedure principle); writes a citations file; returns an injection block for the bible.
- [ ] TDD (stubbed research/lookup): asserts a citations file is written under `researchDir`, `citedFacts` contains the sourced summary, `sources` lists URLs, and a lookup failure degrades to `{citedFacts:'', sources:[]}` without throwing. Commit.
- [ ] Integration: call it in the bible phase and inject `citedFacts` into the bible step prompt (guarded by a per-book `grounding.enabled`, default on). Test at the phase seam. Commit.

### Task 2: Rolling-summary memory
**Files:** create `rolling-summary.ts`; test `rolling-summary.test.ts`.
**Interfaces:** `buildRollingSummary(args: { summaries: ChapterSummary[]; entities: EntityEntry[]; chapterNumber: number }): string` — four tiers: recent chapters (last 2, high fidelity), current-arc beats (medium), macro events (low), entity registry. Pure function over the context-engine's stored summaries/entities.
- [ ] TDD: given 10 chapter summaries + entities, the block for chapter 8 includes ch6-7 verbatim-ish, older chapters compressed, and the entity registry; caps total length. Commit.
- [ ] Integration: replace/augment the current per-chapter context assembly (projects.routes.ts context builder) so each chapter draft receives `buildRollingSummary` instead of raw prior text. Test at the integration seam; confirm `tsc`. Commit.

### Task 3: Analyze-then-apply polish (back)
**Files:** create `analyze-apply.ts`; test `analyze-apply.test.ts`.
**Interfaces:**
- `analyzeChapter(args: { text: string; chapterNumber: number; craftCritic: CraftCriticLike; dialogueAuditor: DialogueAuditorLike; continuityFlags?: Flag[] }): Findings` — merges the deterministic critics' flags (sagging middle, telling-vs-showing, off-voice dialogue, profanity sanitization from Plan 2) + Plan 3 continuity flags into one structured `Findings`.
- `applyEditsPrompt(findings: Findings, chapterText: string): string` — builds a targeted rewrite instruction addressing only the flagged issues (not a blind rewrite).
- [ ] TDD: a chapter with a telling-heavy passage + an off-voice line yields findings naming both; `applyEditsPrompt` references them specifically and instructs a surgical rewrite. Commit.
- [ ] Integration: in the revision/deep-revision phase, replace the "emit notes" steps with analyze → apply (run `analyzeChapter`, then a rewrite step using `applyEditsPrompt`, cast via the `editorial`/`rewrite` roles). Add a beta-reader panel pass before format as a gate input. Test at the seam. Commit.

## Self-Review
- Spec coverage (§4.3 wrappers): grounding research front (T1), rolling-summary memory (T2), analyze-then-apply polish replacing emit-notes (T3), beta-reader as a pre-format gate input (T3 integration). All reuse existing services.
- Downstream: T3's `Findings` also carries Plan 3 continuity flags; T2 feeds Plan 3's canon injection alongside the rolling summary.
