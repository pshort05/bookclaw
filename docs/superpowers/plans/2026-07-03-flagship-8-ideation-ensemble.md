# Flagship Opt-in Ideation Ensemble Implementation Plan (Plan 8 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Restore the maintainer's multi-model divergent ideation as an opt-in per-book phase — fan one premise out to a panel of models (default `[gpt, grok, gemini, claude]`), each with a distinct creative angle, then a divergence-preserving judge/selector picks or blends the best pitch. Built in-house (not OpenRouter Fusion, whose consensus judge is wrong for divergence).

**Architecture:** When `book.ensemble.enabled`, the planning/premise phase runs `runIdeationEnsemble`: N parallel `router.complete` calls (one per panel model, each with an angle-specific prompt) → the raw pitches → a `selectPitch` judge step that scores on divergence-aware criteria and returns the chosen/blended pitch. Reuses BookClaw's multi-provider router; no new provider plumbing.

**Tech Stack:** Node 22+, TypeScript (NodeNext `.js`), `node --import tsx --test`.

## Global Constraints
- Same as Plan 1. Off by default (opt-in per book). Reuse `AIRouter.complete` (per-call model override already supported) — do NOT add a new HTTP client. The panel is `book.ensemble.panel` (default `[gpt,grok,gemini,claude]`), overridable per book; unknown/unavailable panel members are skipped with a log, never fatal.
- The judge/selector must PRESERVE divergence (pick the strongest single pitch or graft the best ideas), not converge to consensus — this is the explicit reason Fusion is not used (see spec §4.4).
- Cost-aware: N panel calls + 1 judge call route through the CostTracker; the phase is opt-in precisely because it is the most expensive front-end.
- **Re-ground note:** confirm `AIRouter.complete({ provider, model, ... })` returns `{ text }` and that a per-call model override maps a provider→model (Plan 1 relies on the same). Read `book.ensemble` field addition from Plan 2/Task-6-era manifest work (add it here if not present).

## File Structure
- Create `gateway/src/services/pipeline/ideation-ensemble.ts` — `runIdeationEnsemble(...)` (fan-out) and `selectPitch(...)` (judge).
- Modify `gateway/src/services/book-types.ts` — `BookManifest.ensemble?: { enabled?: boolean; panel?: string[] }` (additive-optional) if not already added.
- Modify the planning/premise phase wiring (`projects.routes.ts` / `phase-06`) — when enabled, run the ensemble to produce the premise the rest of the pipeline consumes.
- Create `library/craft/ideation-angles.json` — the per-panel angle prompts (MVP-first, risk-first, character-first, world-first, etc.), tunable.
- Tests: `tests/unit/ideation-ensemble.test.ts`, `tests/unit/select-pitch.test.ts`.

## Tasks

### Task 1: `runIdeationEnsemble` fan-out
**Files:** create `ideation-ensemble.ts`; test `ideation-ensemble.test.ts`.
**Interfaces:** `runIdeationEnsemble(args: { premise: string; genre: string; panel: string[]; angles: Record<string,string>; complete: (req:any)=>Promise<{text:string}>; resolveModel: (member:string)=>{provider:string;model?:string} }): Promise<Array<{ member: string; angle: string; pitch: string }>>` — one `complete` per panel member with a distinct angle prompt, run in parallel (`Promise.allSettled`); a failed/absent member is dropped with a log, not fatal.
- [ ] TDD (stubbed `complete` keyed by model): a 4-member panel yields 4 pitches with distinct angles; a member whose `complete` rejects is omitted and the rest still return; an empty panel returns `[]`. Commit.

### Task 2: `selectPitch` divergence-preserving judge
**Files:** same module; test `select-pitch.test.ts`.
**Interfaces:** `selectPitch(args: { pitches: Array<{member:string;angle:string;pitch:string}>; premise: string; complete: (req:any)=>Promise<{text:string}>; judgeModel: {provider:string;model?:string} }): Promise<{ chosen: string; rationale: string; graftedFrom: string[] }>` — a judge prompt that scores originality/genre-fit/hook and returns the strongest single pitch (optionally grafting distinct strengths), NOT a consensus merge. Tolerant JSON parse; on judge failure, fall back to the longest/first pitch with a log.
- [ ] TDD: with three clearly-different pitches and a stubbed judge returning a structured choice, `chosen` is the judged pick and `graftedFrom` lists contributors; a judge failure falls back deterministically without throwing. Commit.

### Task 3: `ensemble` manifest field + panel resolution
**Files:** modify `book-types.ts` (if not present) and the book-create path; the panel default `[gpt,grok,gemini,claude]` comes from the genre sheet's `ensemblePanel` (Plan 1/7) unless the book overrides.
- [ ] TDD: a book with `ensemble.enabled` and no panel inherits the genre sheet's `ensemblePanel`; an explicit book panel overrides; `enabled` defaults false. Commit.

### Task 4: Wire the ensemble into the planning phase (opt-in)
**Files:** modify the premise/planning phase wiring.
- [ ] TDD (integration, stubbed router): a book with `ensemble.enabled:false` runs the normal single-model premise step; with `enabled:true`, the premise phase runs `runIdeationEnsemble` + `selectPitch` and the selected pitch becomes the premise the bible/outline phases consume. Panel members resolve via each provider's model; the CostTracker records all calls. Commit.

## Self-Review
- Spec coverage (§4.4): opt-in per-book ensemble (T3, T4), default panel `[gpt,grok,gemini,claude]` overridable (T3), in-house fan-out + divergence-preserving judge — explicitly NOT Fusion (T1, T2), reuses the router (no new plumbing). Off by default (most expensive front-end).
- This completes Sub-project 1 (Plans 1-8). Sub-project 2 (Smart Intake Wizard) is a separate spec that surfaces all the per-book knobs these plans added (genre, structure, author identity/brand, prose model, spice/gore ceiling, gate cadence, ensemble toggle) in the expanded Easy Start flow.
