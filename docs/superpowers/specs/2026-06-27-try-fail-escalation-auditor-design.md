# Try-Fail & Escalation Auditor (+ crucible check) — TODO #15

**Date:** 2026-06-27
**Status:** Approved (goal-driven)

## Goal

A per-book, per-protagonist manuscript structure check that detects discrete
**try-fail cycles** (attempt → outcome), verifies early attempts genuinely fail
("a win on the first try isn't earned"), confirms each conflict **deepens**
(higher personal/emotional stakes) and/or **broadens** (affects more people)
across the arc, flags conflicts that resolve too easily, and runs a lightweight
**crucible check** (is there a binding force — setting / relationship / duty —
that stops characters simply walking away?). TODO #15; **Difficulty: Medium.**

## Approach (mirrors existing engines)

Book-bound, report-emitting auditor modeled on the **consistency** engine
(`/api/books/:slug/...`, reads chapters via `selectChapterFiles` + `BookService.dataDirOf`,
reuses the consistency model-selection helpers, emits a `ReportsService` report),
with the analysis/report shape modeled on **plot-promises** (synchronous audit →
report). The valuable, novel logic — the try-fail ladder + escalation scoring +
crucible assessment — is a **pure deterministic core** (unit-tested), fed by a
single structured-JSON LLM extraction over the manuscript (the I/O boundary,
mocked in tests).

**Why one LLM call, not per-chapter:** the analysis is arc-level. One structured
extraction over the (optionally condensed) manuscript keeps the audit synchronous,
fast, cheap, and smoke-testable, and large-context models (the consistency
provider set) hold a full book. If the manuscript exceeds a char budget, each
chapter is condensed to head+tail with a `condensed: true` flag in the report.

## Types — `gateway/src/services/try-fail/types.ts`

```ts
export type AttemptOutcome = 'success' | 'partial' | 'failure' | 'none';
export type Cost = 'none' | 'low' | 'medium' | 'high';

export interface AttemptRecord {
  protagonist: string;
  chapter: number;
  goal: string;
  conflict: string;
  outcome: AttemptOutcome;
  cost: Cost;
  personalStakes: number;   // 0–5 emotional/personal stakes (deepen axis)
  peopleAffected: number;   // breadth count (broaden axis)
}
export interface CrucibleSignal {
  kind: 'setting' | 'relationship' | 'duty' | 'other';
  description: string;
  strength: 'weak' | 'moderate' | 'strong';
  chapter: number;
}
export type FindingSeverity = 'high' | 'medium' | 'low';
export type FindingCategory =
  | 'early_easy_win' | 'flat_escalation' | 'easy_resolution'
  | 'missing_crucible' | 'no_try_fail_cycle';
export interface TryFailFinding {
  severity: FindingSeverity;
  category: FindingCategory;
  protagonist?: string;
  chapter?: number;
  detail: string;
}
export interface ProtagonistLadder {
  protagonist: string;
  attempts: AttemptRecord[];      // ordered by chapter
  deepens: boolean;
  broadens: boolean;
  firstAttemptOutcome: AttemptOutcome;
  findings: TryFailFinding[];
}
export interface CrucibleAssessment {
  present: boolean;
  strongest: 'none' | 'weak' | 'moderate' | 'strong';
  signals: CrucibleSignal[];
  finding?: TryFailFinding;
}
export interface TryFailReport {
  bookSlug: string;
  protagonists: ProtagonistLadder[];
  crucible: CrucibleAssessment;
  findings: TryFailFinding[];      // aggregated, sorted high→low
  summary: string;
  condensed: boolean;
  generatedAt: string;
  model?: { provider: string; model?: string };
}
// Raw LLM extraction shape (one call over the whole manuscript):
export interface AuditExtraction {
  protagonists: string[];
  attempts: AttemptRecord[];
  crucibleSignals: CrucibleSignal[];
}
```

## Deterministic core (TDD heart) — `gateway/src/services/try-fail/score.ts`

Pure functions, unit-tested with fixtures:

- `buildLadders(ex: AuditExtraction): ProtagonistLadder[]` — group attempts by
  protagonist, order by chapter, set `firstAttemptOutcome`, run escalation +
  per-ladder finding detectors.
- `assessEscalation(attempts): { deepens; broadens }` — `deepens` = `personalStakes`
  rises across the ordered attempts (last meaningfully > first / positive slope);
  `broadens` = `peopleAffected` rises. (≥2 attempts required to assess.)
- `detectEarlyEasyWin(ladder): TryFailFinding | null` — first attempt
  `outcome==='success'` with `cost` in {none, low} → **high** (a win on the first
  try isn't earned).
- `detectFlatEscalation(ladder): TryFailFinding | null` — ≥3 attempts but neither
  `deepens` nor `broadens` → **medium**.
- `detectEasyResolutions(attempts): TryFailFinding[]` — `outcome==='success'` with
  `cost==='none'` on a `personalStakes>=4` conflict → **medium** (resolved too easily).
- `detectNoTryFail(ladder): TryFailFinding | null` — a protagonist with attempts
  but **no** `failure`/`partial` outcome anywhere → **medium** (no real try-fail cycle).
- `assessCrucible(ex): CrucibleAssessment` — strongest signal across the book;
  `present=false` or only `weak` → **high** missing/weak-crucible finding.
- `assembleReport(slug, ex, condensed, model): TryFailReport` — ladders + crucible
  + aggregated findings sorted by severity + a deterministic `summary` string.

## Extraction (I/O boundary) — `gateway/src/services/try-fail/extract.ts`

- `buildAuditPrompt(chapters: {n:number;text:string}[]): { system:string; user:string }`
  — instructs the model to return JSON `AuditExtraction` across the whole book:
  each attempt tagged with `protagonist`, `chapter`, `goal`, `conflict`,
  `outcome`, `cost`, `personalStakes` (0–5), `peopleAffected`; plus
  `crucibleSignals` and the `protagonists` roster. Defines try-fail / deepen /
  broaden / crucible precisely so scoring inputs are consistent.
- `parseAuditExtraction(raw: string): AuditExtraction` — tolerant JSON parse
  (strip code fences; `jsonrepair` fallback like the consistency extractor),
  clamp `personalStakes` to 0–5, coerce `peopleAffected` ≥0, default invalid
  `outcome`/`cost`, drop attempts with no protagonist. Never throws → `{protagonists:[],attempts:[],crucibleSignals:[]}` on garbage.
- `condenseChapters(chapters, charBudget): { chapters; condensed }` — if the joined
  text exceeds `charBudget` (default ~120k chars), keep each chapter's head+tail.

## Orchestration — `gateway/src/services/try-fail/audit.ts`

`runTryFailAudit(deps): Promise<TryFailReport>` where `deps = { slug, dataDir,
aiComplete, aiSelect, model }`:
1. `selectChapterFiles(readdirSync(dataDir))` → read chapter texts (fail-soft: a
   book with no chapters → a report with a single `no_try_fail_cycle`/empty note,
   never a throw).
2. `condenseChapters` if needed.
3. one `aiComplete` call with `buildAuditPrompt` on the resolved model.
4. `parseAuditExtraction` → `assembleReport`.

Model selection reuses the consistency helpers
(`gateway/src/services/consistency/model-selection.ts`): `validateModelSelection`
(per-run `{provider,model}`), `resolveConsistencyModel(override, manifest.consistency)`
(reuses the book's configured large-context model), `consistencyCapabilityError`
(422 when no capable, non-Ollama provider). No new `BookManifest` field — the
auditor shares the book's consistency model selection (same "large-context
manuscript analysis" need); documented.

## REST — `gateway/src/api/routes/try-fail.routes.ts` (`mountTryFail`, registered in `routes.ts`)

- `POST /api/books/:slug/try-fail-audit` — body optional `{ provider?, model? }`.
  400 invalid model · 404 book/manuscript missing · 422 no capable provider ·
  200 → `TryFailReport`. Side effect: render + `reports.write(slug, 'try-fail', …)`.
- `GET /api/books/:slug/try-fail-report` — latest stored `try-fail` report JSON via
  `ReportsService` (`{ report: TryFailReport | null }`).

Synchronous (like `plot-promises` audit) — one LLM call, fast. SLUG-validated +
traversal-guarded like the sibling routes.

## Reports — `gateway/src/services/reports/render-try-fail.ts`

`renderTryFailReport(r: TryFailReport): { title; markdown; summary }`. Add
`'try-fail'` to `ReportKind` + `KIND_LABELS['try-fail'] = 'Try-Fail & Escalation'`
in `reports.ts`. Markdown: per-protagonist ladder table (chapter · goal · outcome ·
cost · stakes · affected), deepen/broaden verdicts, the crucible verdict, and the
findings list grouped by severity.

## MCP (lockstep) — `mcp/src/tools/craft.ts`

- `audit_try_fail` → `POST /api/books/:slug/try-fail-audit` (args `slug`, optional
  `provider`/`model`).
- `get_try_fail_report` → `GET /api/books/:slug/try-fail-report`.

## Studio — `frontend/studio/src/routes/TryFail.tsx`

A lean panel modeled on `Consistency.tsx`: a "Run Try-Fail Audit" button (+ optional
provider/exact-model picker reusing `useModelCatalog`), renders the returned report
(per-protagonist ladders, escalation/crucible verdicts, findings), and a
"download latest report" link. The report also appears generically on `Reports.tsx`.
Add the nav entry.

## Testing

- **Unit (pure, TDD):** `tests/unit/try-fail-score.test.ts` — `assessEscalation`
  (deepen/broaden true/false), `detectEarlyEasyWin`, `detectFlatEscalation`,
  `detectEasyResolutions`, `detectNoTryFail`, `assessCrucible`, `assembleReport`
  severity sort, all from fixture `AuditExtraction`s. `tests/unit/try-fail-parse.test.ts`
  — `parseAuditExtraction` (clean JSON, code-fenced, garbage→empty, clamping).
  `tests/unit/report-render-try-fail.test.ts` — renderer shape.
- **Smoke:** extend `tests/feature-smoke.sh` (real-call) or `tests/smoke-test.sh`
  (perimeter) — assert `POST /api/books/:slug/try-fail-audit` is auth-gated (401
  without token) and, against a tiny seeded book on the real-call smoke, returns
  200 + a well-formed `TryFailReport` and a `try-fail` report lands in
  `GET /api/books/:slug/reports`.

## Out of scope (v1)

- No author-edit CRUD over findings (it's an auditor, not a tracker).
- No async/socket streaming (synchronous, like plot-promises); revisit if large
  books time out. No new router `taskType` (reuses `consistency`).
- No new per-book model field (shares the consistency model selection).
