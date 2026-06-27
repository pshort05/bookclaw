# Implementation plan: Try-Fail & Escalation Auditor (TODO #15)

Spec: `docs/superpowers/specs/2026-06-27-try-fail-escalation-auditor-design.md`
TDD throughout. The deterministic `score.ts` core is built test-first.

## Stage A — engine + deterministic core (TDD) — `gateway/src/services/try-fail/`

1. `types.ts` — exact types from the spec.
2. **Tests first:** `tests/unit/try-fail-score.test.ts` + `tests/unit/try-fail-parse.test.ts`
   (failing) covering every detector + the parser, from fixture `AuditExtraction`s.
3. `score.ts` — `buildLadders`, `assessEscalation`, `detectEarlyEasyWin`,
   `detectFlatEscalation`, `detectEasyResolutions`, `detectNoTryFail`,
   `assessCrucible`, `assembleReport`. Make the tests pass.
4. `extract.ts` — `buildAuditPrompt`, `parseAuditExtraction` (tolerant + clamping),
   `condenseChapters`. Parser tests pass.
5. `audit.ts` — `runTryFailAudit(deps)` orchestrator (chapters → 1 LLM call →
   parse → assemble). fail-soft on no chapters.
   - **verify:** `npx tsx --test tests/unit/try-fail-*.test.ts` green; `npx tsc --noEmit` clean.

## Stage B — route + report + MCP wiring (against locked types)

6. `reports.ts` — add `'try-fail'` to `ReportKind` + `KIND_LABELS`.
7. `gateway/src/services/reports/render-try-fail.ts` + `tests/unit/report-render-try-fail.test.ts`.
8. `gateway/src/api/routes/try-fail.routes.ts` (`mountTryFail`) — `POST …/try-fail-audit`,
   `GET …/try-fail-report`; reuse consistency model-selection helpers; SLUG-guard;
   write report on completion. Register `mountTryFail` in `routes.ts`.
9. `mcp/src/tools/craft.ts` — `audit_try_fail` + `get_try_fail_report` (lockstep).
   - **verify:** `npx tsc --noEmit` clean; `cd mcp && npm run build`.

## Stage C — studio panel + smoke

10. `frontend/studio/src/routes/TryFail.tsx` (+ nav) modeled on `Consistency.tsx`
    (run button + optional model picker via `useModelCatalog` + report render +
    download link).
    - **verify:** `npx tsc --noEmit -p frontend/studio/tsconfig.json`; `npm run build:frontend`.
11. Smoke: extend `tests/feature-smoke.sh` (real-call, tiny book) to run the audit +
    assert a `try-fail` report appears; and a perimeter assertion (401 without token).

## Stage D — review, deploy, verify

12. Code-review workflow (high) over the diff; fix all medium+ findings.
13. `build_now` → Mercury rebuild; run smokes against Mercury; fix.
14. `commit_message` + `./push.sh`; deploy Neptune (idle-checked) + verify.

## Files

- `gateway/src/services/try-fail/{types,score,extract,audit}.ts`
- `gateway/src/services/reports/render-try-fail.ts`
- `gateway/src/services/reports.ts` (ReportKind add)
- `gateway/src/api/routes/try-fail.routes.ts` + `routes.ts` (register)
- `mcp/src/tools/craft.ts`
- `frontend/studio/src/routes/TryFail.tsx` (+ nav)
- `tests/unit/try-fail-score.test.ts`, `try-fail-parse.test.ts`, `report-render-try-fail.test.ts`
- `tests/feature-smoke.sh` / `tests/smoke-test.sh` (assertions)
