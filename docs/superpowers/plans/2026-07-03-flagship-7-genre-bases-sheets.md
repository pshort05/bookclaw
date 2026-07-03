# Flagship Genre Bases + Casting Sheets Implementation Plan (Plan 7 of 8)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. Steps use `- [ ]`.

**Goal:** Complete the four launch genres — add the new near-future techno-thriller base pipeline (adapted from MSF), and author the casting sheets + intimacy templates for romantasy, mundane sci-fi, and techno-thriller (romance shipped in Plan 1).

**Architecture:** Each genre keeps its base pipeline (Plan 1 established this). This plan adds the missing techno-thriller base and the per-genre casting sheets (`library/casting/<genre>.json`) + intimacy templates (`library/craft/intimacy/<genre>.md`), and ensures genre → base-pipeline + sheet selection resolves correctly.

**Tech Stack:** Node 22+, TypeScript (NodeNext `.js`), `node --import tsx --test`.

## Global Constraints
- Same as Plan 1. Casting sheets must pass `validateCastingSheet` (Plan 1) and `loadCastingSheet` (with the workspace overlay). The `continuity` role in every sheet pins a high-reasoning model (Plan 3 requirement). Model slugs are format-valid (`isValidModelId`) but may be aspirational — the resolver drops+warns on invalid ones (Plan 1).
- Techno-thriller reuses the MSF base shape (grounded, plausible-tech, tension-driven); it is data, not new engine code — a pipeline JSON + sheet + template.
- **Re-ground note:** confirm the pipeline-JSON schema (`expand: chapters` + nested step shape with `role`/`modelOverride`) and how genre selects a base pipeline (the sequence/library mapping) before authoring the techno-thriller pipeline.

## File Structure
- Create `library/pipelines/technothriller-planning.json` and `library/pipelines/technothriller-production.json` (adapt from `msf-phase*` + `romantasy-*`), fully role-tagged.
- Create `library/sequences/technothriller.json` (chains the techno-thriller pipelines) if genres select via sequences.
- Create `library/casting/romantasy.json`, `library/casting/scifi.json` (mundane sci-fi), `library/casting/technothriller.json`.
- Create `library/craft/intimacy/romantasy.md` (romance-adjacent), and light/empty intimacy handling for sci-fi/techno-thriller (lower default ceilings; violence axis emphasized).
- Modify the genre→base+sheet resolution if needed (read how `context.genre` maps to a base pipeline today).
- Tests: `tests/unit/casting-sheets-all-genres.test.ts`, `tests/unit/technothriller-pipeline.test.ts`.

## Tasks

### Task 1: Genre casting sheets (romantasy, scifi, technothriller)
**Files:** create the three `library/casting/*.json`; test `casting-sheets-all-genres.test.ts`.
**Content:** seed `roleModels` from the audited n8n recipe (draft→Opus, improve/rewrite→Gemini, editorial→Sonnet, continuity→high-reasoning), `proseRoles: ['scene_brief','draft']`, `ensemblePanel: ['gpt','grok','gemini','claude']`, and a `heatLadder` per genre (romantasy: erotica threshold like romance; sci-fi/techno-thriller: low spice ceiling, violence-focused ladder).
- [ ] TDD: for each of the four genres, `loadCastingSheet(genre)` returns a sheet that passes `validateCastingSheet`, has a `continuity` role model, and `proseRoles` = scene_brief+draft. Commit.

### Task 2: Techno-thriller base pipeline
**Files:** create `technothriller-planning.json` + `technothriller-production.json` (+ sequence); test `technothriller-pipeline.test.ts`.
**Content:** adapt the MSF phase shape — grounding-research-heavy planning (real tech/geopolitics via Plan 4's front), tension structure (Lester Dent / seven-point), a per-chapter production loop (`expand: chapters`) with role-tagged steps: `scene_brief` → `draft` → `improve` → `rewrite` → `humanize`, plus a `continuity` check and the consequence-not-procedure guardrail (Plan 2 safety floor) emphasized. No on-page intimacy branch by default (low spice ceiling); violence axis active.
- [ ] TDD: the pipeline JSON parses, every nested step has a valid `role`, and the production loop uses `expand: chapters`. Load it through `LibraryService` (route or service test) and assert it lists/gets like the other pipelines. Commit.

### Task 3: Intimacy + craft templates per genre
**Files:** create `library/craft/intimacy/romantasy.md` (and confirm romance from Plan 2); minimal/violence-oriented guidance for sci-fi/techno-thriller.
- [ ] TDD: `intimacyDecision` (Plan 2) for each genre resolves a template path that exists; sci-fi/techno-thriller with a low ceiling resolve to `fade` for typical scenes. Commit.

### Task 4: Genre → base + sheet selection
**Files:** modify the genre→pipeline resolution if the four genres don't already map to their bases.
- [ ] TDD (integration): creating a book with `genre: 'technothriller'` selects the techno-thriller base and `loadCastingSheet('technothriller')`; `genre: 'romantasy'` selects the romantasy base + sheet. Commit.

## Self-Review
- Spec coverage (§4.3 genre bases): the four launch genres each have a base + casting sheet + intimacy/craft template; techno-thriller adapted from MSF as data (no new engine). All sheets validate and carry a high-reasoning `continuity` role.
- Downstream: Plan 8's ensemble reads each sheet's `ensemblePanel`.
