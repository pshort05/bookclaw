# Implementation plan: Consistency Apply-Fix (TODO #46)

Spec: `docs/superpowers/specs/2026-06-26-consistency-apply-fix-design.md` (+ §0 reconciliation).
TDD; the pure `fix-apply.ts` core is built test-first. Stage A is the contract
source; Stages B/C build against the locked types below.

## Locked contract (all stages code to these)

```ts
// added to ConsistencyFinding (consistency/types.ts):
id?: string;                                   // stable hash, computed in check-engine

// consistency/fix-types.ts (new) — shared:
const FIXABLE = ['contradiction','continuity','impossibility','canon-divergence'] as const;
interface ProposedEdit {
  findingId: string; category: string; entity: string; attribute: string;
  canonicalValue: string; targetChapter: string;   // chapter label
  oldPhrase: string; newPhrase: string; note: string; anchored: boolean;
}
interface ConfirmedEdit { findingId: string; targetChapter: string; oldPhrase: string; newPhrase: string; }
interface ApplyOutcome {
  applied: { findingId: string; targetChapter: string; oldPhrase: string; newPhrase: string }[];
  skipped: { findingId: string; targetChapter: string; oldPhrase: string; reason: 'not-found'|'ambiguous' }[];
}
// fix-apply pure core:
applyEditsToText(text: string, edits: {findingId:string; oldPhrase:string; newPhrase:string}[])
  : { newText: string; applied: {...}[]; skipped: {...}[] }   // exact+unique anchor; sequential; never throws
```

## Stage A — engine core (TDD) — contract source

1. `consistency/finding-id.ts` — `computeFindingId(f): string` (sha256 hex, 16 chars, over
   `category|entity|attribute|a.chapter|a.scene|a.quote|b.chapter??b.canonSource|b.quote`). Pure.
2. `consistency/types.ts` — add `id?: string` to `ConsistencyFinding`; `consistency/fix-types.ts` — the shared types above.
3. `check-engine.ts` — attach `id = computeFindingId(f)` at both construction sites (`finding()` + `evaluateKnowledge()`).
4. **Tests first** (failing): `tests/unit/consistency-fix-apply.test.ts` (exact+unique replace; multiple edits one chapter; not-found skip; ambiguous/non-unique skip; non-target text byte-identical; sequential edits), `tests/unit/consistency-fix-parse.test.ts` (proposer parse: valid, fenced, garbage→[], shape), `tests/unit/consistency-finding-id.test.ts` (stable across runs; distinct findings differ).
5. `consistency/fix-apply.ts` — `applyEditsToText` pure core. Make apply tests pass.
6. `consistency/fix-proposer.ts` — `buildFixPrompt(chapterText, findings): {system,user}` (temp-0; demand exact-substring `oldPhrase`), `parseFixProposals(raw): Omit<ProposedEdit,'anchored'>[]` (lenient, never throws). Make parse tests pass.
   - verify: `npx tsx --test tests/unit/consistency-fix-*.test.ts tests/unit/consistency-finding-id.test.ts` green; `npx tsc --noEmit` clean.

## Stage B — routes + resolver + MCP (against locked types)

7. `consistency/fix-apply.ts` (or a sibling) — `resolveChapterFile(dataDir, chapterLabel): string | null` (selectChapterFiles + chapter-number match; else combined manuscript). Unit-test it.
8. Extend `consistency.routes.ts`:
   - `POST /api/books/:slug/consistency-fix/propose` — `{findingIds[], provider?, model?}`. SLUG-guard; `validateConsistencyModelSelection`→400; capability gate→422; reload `consistencyStore.getReport(slug).findings`, filter by id, drop non-FIXABLE, group by `a.chapter`; per chapter resolve file+text, `fix-proposer` (model via `resolveConsistencyModel`), dry-run `applyEditsToText` to set `anchored`; return `{proposals: ProposedEdit[]}`. No write.
   - `POST /api/books/:slug/consistency-fix/apply` — `{edits: ConfirmedEdit[]}`. Group by targetChapter; per chapter resolve file, read, `applyEditsToText`, `writeWithVersion`, `activityLog.log`; return `ApplyOutcome` + snapshot info.
9. `mcp/src/tools/craft.ts` — `propose_consistency_fixes` + `apply_consistency_fixes` (lockstep).
   - verify: `npx tsc --noEmit` clean; `cd mcp && npm run build`.

## Stage C — frontend

10. `Consistency.tsx` + `consistencyApi.ts` — per-finding Fix/Ignore toggle (FIXABLE only; `knowledge-violation` shows a "manual — needs a plot change" badge, no toggle), **Prepare fixes** → propose → preview diffs with anchor status (skipped→"couldn't anchor"), **Confirm & apply** → apply → success + "Re-run audit" nudge. Default toggles Ignore.
    - verify: studio `tsc` + `npm run build:frontend`.

## Stage D — smoke, review, deploy

11. Extend `tests/consistency-smoke.sh`: plant a contradiction → audit → propose → assert an edit anchors → apply → assert the chapter file changed ONLY at the phrase + a `.versions/` snapshot exists → re-audit → finding gone. Perimeter assertion in `tests/smoke-test.sh` (propose/apply 401 without token).
12. Code-review workflow (high); fix medium+.
13. `build_now` Mercury → smokes → fix. `commit_message` + `./push.sh` → Neptune (idle-checked) + verify on a real book.

## Files

- `gateway/src/services/consistency/{finding-id,fix-types,fix-apply,fix-proposer}.ts`, `types.ts` (+id), `check-engine.ts` (attach id)
- `gateway/src/api/routes/consistency.routes.ts` (propose/apply + resolver)
- `mcp/src/tools/craft.ts`
- `frontend/studio/src/routes/Consistency.tsx`, `lib/consistencyApi.ts`
- `tests/unit/consistency-fix-apply.test.ts`, `consistency-fix-parse.test.ts`, `consistency-finding-id.test.ts`, `tests/consistency-smoke.sh`, `tests/smoke-test.sh`
