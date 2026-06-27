# Consistency Apply-Fix (v1) — Design Spec

- **Date:** 2026-06-26
- **Status:** Approved design; pending implementation plan.
- **Owner ask:** A way to act on consistency findings — a per-finding fix/ignore toggle plus a button that applies the selected fixes to the prose. Must be very specific (low model temperature) and operate at the chapter level.

## 1. Summary

The consistency auditor is currently report-only: it extracts facts, runs a deterministic check, and lists findings. This feature adds the first capability that **edits the author's prose** to reconcile a finding.

The author selects findings to fix, the model **proposes** a precise prose edit per finding (temperature 0), the author reviews the resulting diff, and on confirmation the edits are applied **deterministically** (string find/replace — the model is never in the write path). Every edited chapter is version-snapshotted first, so all edits are revertible.

## 2. Decisions (resolved during brainstorming)

1. **Fix direction:** the model proposes the canonical value and the concrete edit; the author approves or ignores via a diff. (Not author-typed values in v1.)
2. **Edit mechanism:** surgical find/replace. The model returns exact `oldPhrase → newPhrase` pairs anchored to real substrings of the chapter; application is a deterministic string replace. No whole-chapter regeneration, so the rest of the prose is byte-for-byte untouched.
3. **Scope:** phrase-swappable findings only — `contradiction`, `continuity`, `impossibility`, and `canon-divergence` (which always edits the prose **to match** the World-Repository bible, since the bible is the source of truth). `knowledge-violation` findings are shown with a *"manual — needs a plot change, not a phrase swap"* badge and no toggle.
4. **Granularity:** chapter-level. Edits are grouped and applied per chapter; the propose step batches by chapter to keep model calls bounded and the edits coherent.
5. **Two-step (propose then apply):** propose is a separate, side-effect-free step that returns a preview diff; apply commits only after explicit author confirmation. The author always sees the diff before any write.
6. **Opt-in:** per-finding toggles default to **Ignore**. Prose edits never happen without an explicit selection + confirmation.
7. **Re-audit is manual:** a "Re-run audit" button verifies resolution, so the feature never silently spends on re-extraction.

## 3. UX flow

1. After an audit, each phrase-swappable finding in the Consistency panel gets a **Fix / Ignore** toggle (default Ignore). `knowledge-violation` findings show the manual badge, no toggle.
2. The author toggles the findings to fix, then clicks **Prepare fixes**.
3. The backend generates proposed edits for the selected findings (model, temperature 0) and returns a **preview**: per finding, the chapter, the `oldPhrase → newPhrase`, and an anchor status. Edits whose `oldPhrase` cannot be matched exactly and uniquely in the target chapter are flagged *"couldn't anchor — skipped"* and excluded from the apply set.
4. The author reviews the diffs and clicks **Confirm & apply** (or cancels).
5. On confirm: each affected chapter is **version-snapshotted**, the find/replace edits are applied deterministically, the file is written back, and an activity-log entry is recorded.
6. The author may click **Re-run audit** to confirm the findings are resolved and nothing new was introduced.

## 4. Architecture and components

Each unit has one purpose and a testable boundary.

- **`gateway/src/services/consistency/fix-proposer.ts` (new).** Boundary: *(chapterText, findingsForChapter) → proposedEdits*. Builds the temperature-0 prompt from a chapter's prose plus its selected findings (each carrying both conflicting values and both verbatim quotes), calls the model via the existing router, and parses the JSON response through the shared lenient parser (`parseJsonLenient` / `jsonrepair`). Returns, per finding, `{ findingId, canonicalValue, targetChapter, oldPhrase, newPhrase, note }`. No file access, no writes.
- **`gateway/src/services/consistency/fix-apply.ts` (new).** Pure and deterministic. Boundary: *(chapterText, validatedEdits) → { newText, diff, applied[], skipped[] }*. Validates each `oldPhrase` is an exact, unique substring of the chapter; applies the replacements; produces a structured diff. The model is never invoked here.
- **Routes** (extend `gateway/src/api/routes/consistency.routes.ts`):
  - `POST /api/books/:slug/consistency-fix/propose` — body `{ findingIds: string[], provider?, model? }`. Resolves the findings from the stored report, groups by target chapter, calls `fix-proposer` per chapter, validates anchors via `fix-apply` (dry-run), returns the preview diffs. No write. Reuses the consistency capability gate + `validateConsistencyModelSelection`.
  - `POST /api/books/:slug/consistency-fix/apply` — body `{ edits: ConfirmedEdit[] }` (the exact edits the author confirmed). Snapshots each chapter, applies via `fix-apply`, writes back, logs activity. Returns the applied diff and per-edit status.
- **Frontend** (`frontend/studio/src/routes/Consistency.tsx`): per-finding Fix/Ignore toggles, a **Prepare fixes** action, a preview section rendering the diffs with anchor status, and a **Confirm & apply** action. Client helpers in `consistencyApi.ts`.

## 5. Data shapes

- **Stable finding id.** `ConsistencyFinding` gains a deterministic `id` — a stable hash of `category`, `entity`, `attribute`, `a.chapter`, `a.quote`, and `b.chapter`/`b.canonSource`. Computed where findings are produced (check-engine / audit), so the UI and the fix endpoints can reference a finding across the propose/apply round-trip without re-running the audit. The id is part of the persisted report.
- **ProposedEdit** (propose response): `{ findingId, category, entity, attribute, canonicalValue, targetChapter, oldPhrase, newPhrase, note, anchored: boolean }`.
- **ConfirmedEdit** (apply request): `{ findingId, targetChapter, oldPhrase, newPhrase }` — only edits the author kept.

## 6. Target-chapter resolution and grouping

A finding spans two locations (`a` in one chapter, `b` in another). The losing side — the chapter to edit — is the model's canonical-direction decision. Grouping for the propose calls is by **detection chapter** (`a.chapter`); the model is given that chapter's full prose plus, per finding, the counterpart chapter name, value, and quote, and returns the edit with an explicit `targetChapter`.

- Edits targeting the detection chapter anchor against the full prose the model already saw (exact `oldPhrase`).
- Edits targeting the counterpart chapter anchor against the finding's stored quote; `fix-apply` re-validates that against the counterpart chapter's actual prose at apply time and flags any mismatch. (A later refinement — a second exact-anchoring pass on the counterpart chapter — is noted as optional; v1 relies on the stored quote plus apply-time validation.)

The chapter's prose file is located with the auditor's existing resolution: per-chapter files for generated books (`selectChapterFiles`), or the combined `manuscript.md` for imported books (`findCombinedManuscript`). Find/replace operates on whichever file holds the chapter; for an imported single-file manuscript the replacement targets the substring within `manuscript.md`, so the file layout does not change the mechanism.

## 7. Safety and reversibility

- **Deterministic write path:** the model only proposes; application is string replace, so a model error cannot corrupt prose beyond the proposed phrase.
- **Anchor validation:** an `oldPhrase` that is not an exact, unique substring of the target chapter is skipped and surfaced, never silently applied to the wrong place or lost.
- **Preview + explicit confirm:** no write occurs without the author confirming the diff.
- **Version snapshot per chapter** before any write (reusing the existing file-versioning used by `POST /api/books/:slug/file` history), so every fix is revertible.
- **Activity log** entry per apply.

## 8. Scope and non-goals (v1)

- In: `contradiction`, `continuity`, `impossibility`, `canon-divergence` (prose-to-bible).
- Out, by design (clean later additions): `knowledge-violation` auto-fix; author-typed custom canonical values; auto re-audit; a second exact-anchoring pass for counterpart-chapter edits; batch fix across multiple books.

## 9. Testing

- **Unit — `fix-apply`:** exact/unique anchor match; multiple edits in one chapter; unmatched `oldPhrase` skipped + reported; ambiguous (non-unique) `oldPhrase` skipped; diff correctness; non-target prose unchanged byte-for-byte.
- **Unit — `fix-proposer` parsing:** valid edit extraction; lenient-JSON recovery; rejection of malformed/empty proposals; per-finding `targetChapter`/`oldPhrase` shape.
- **Unit — finding id:** stable across runs for the same finding; distinct for different findings.
- **Smoke (`tests/consistency-smoke.sh` extension):** plant a contradiction, audit, propose a fix, confirm it anchors, apply, assert the chapter file changed only at the expected phrase and a version snapshot exists, then re-audit and assert the finding is gone.

## 10. Risks

- **Wrong canonical direction.** The model may pick the wrong side. Mitigated by the preview diff + explicit confirm, and by per-chapter version snapshots (fully revertible).
- **Anchor mismatch on counterpart-chapter edits.** Mitigated by apply-time validation that skips and flags non-matching edits.
- **Author over-trust of the diff.** Mitigated by defaulting toggles to Ignore and keeping re-audit one click away to verify outcomes.
- **Cost.** One temperature-0 call per chapter with selected fixes; bounded and cheap, and only for findings the author chose.
