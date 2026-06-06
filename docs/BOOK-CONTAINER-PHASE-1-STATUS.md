# Book-Container Phase 1 (Library, read side) — STATUS

_Source of truth for **where we are**. Updated 2026-06-06._

**Plan:** `docs/superpowers/plans/2026-06-06-book-container-phase-1-library.md` (complete, TDD, 7 tasks).
**Design:** `docs/BOOK-CONTAINER-ARCHITECTURE.md` (Phase 1 bullet). **North Star:** `docs/TODO.md`.

## Phase table

| # | Task | Status | Commit |
|---|------|--------|--------|
| — | Plan written + reviewed | ✅ done (2026-06-06) | — |
| — | Owner scope decisions | ✅ (a) extract ALL pipelines so a future New-Book page can select them; (b) FOLD skills overlay into the library now | — |
| 1 | Pipeline-as-data: `library-types.ts` + `exportBuiltinPipelines()` + generated `library/pipelines/*.json` + drift-guard test | ✅ done | `1b1f8c4` + `964105c` (dynamic flag) |
| 2 | Seed built-in author/genre/section content | ✅ done | `5c66ac8` |
| 3 | `LibraryService` (overlay, 5 kinds, reload) + unit test | ✅ done | `b15768a` |
| 4 | Fold skills overlay → `workspace/library/skills/` + boot migration `migrateSkillOverlay()` | ✅ done | `8e1ffa5` + `08e5e06` (comment) |
| 5 | Wire `LibraryService` into `init/phase-05` + `getServices()` | ✅ done | `b6af886` |
| 6 | Read API `GET /api/library[/:kind[/:name]]` + Dockerfile `COPY library` + API tests | ✅ done | `e251460` |
| 7 | Docs (CLAUDE.md, arch doc, TODO, plan/status) | ✅ done | `054867e` |
| 8 | Final whole-branch code review + apply findings | ✅ done | `6ad271c` (fixes) |
| 9 | Merge to `main` + Mercury deploy (`touch build_now`) + acceptance + move TODO→COMPLETED | ⬜ **NEXT — owner's call** |  |

All implementation tasks (1–7) complete and reviewed (spec + code-quality) per subagent-driven-development. Each task verified: `tsc` clean, `npm run test:unit` 39/39, API checks pass on an isolated port (the live container on 3847 was never disturbed).

**Code review (2026-06-06):** ran `/code-review` high-effort over the whole branch — no Critical/Important bugs. Applied 3 findings in `6ad271c`: (1) fail-soft `gw.library.loadAll()` (unreadable overlay dir degrades instead of crashing init); (2) `migrateSkillOverlay` warns instead of silently orphaning when both old+new overlay dirs exist; (3) collapsed the repeated kind-union literal in `library.ts` to `FILE_KINDS`/`FileKind`. Refuted (non-issues): premium-skill exposure (parity with existing `/api/skills`), `renameSync` EXDEV (whole-`workspace/` is one bind-mount), exporter 0-value drop (no template uses 0). One pre-existing finding tracked in TODO: `heartbeat.routes.ts:393` writes generated skills to the baked `skills/` dir, not the overlay (Phase 4).

**Code review 2nd pass (2026-06-06):** re-ran `/code-review` over the full branch incl. the fix commit — confirmed the fixes sound, no Critical/Important. Applied finding #1 in `7a5c8fa`: per-dir fail-soft in `LibraryService.loadKind` (wraps `readdir` so one unreadable overlay dir can't abort other kinds/their built-ins; `loadKind` is now the fail-soft boundary, the phase-05 try/catch a documented backstop) + a deterministic regression test (authors-path-as-file → ENOTDIR → other kinds still load). 40/40 unit. Remaining flagged items all deferred/tracked (dynamic-proxy → Phase 3; heartbeat skill writer → TODO/Phase 4) or declined (house-style dup).

**Branch decision (2026-06-06): KEEP AS-IS.** Owner chose not to merge yet. Branch `feat/book-container-phase-1-library` (11 commits) is preserved; main is unchanged. Nothing deployed. Owner will merge/push/deploy when ready.

## How to resume

1. Read this file. Verify state: `git log --oneline -12`, `git branch --show-current` (should be `feat/book-container-phase-1-library`), `find library -type f` (17 files: 7 pipeline JSON + 10 seed md).
2. **Remaining work = deploy, not code:**
   - The branch is NOT yet merged to `main`. The Mercury sentinel deploy (`touch build_now`) builds the *working tree on Mercury* — so deploy AFTER merging to main, not from the feature branch.
   - Deploy caveat: the committed `tests/api/api-test.sh` and `tests/smoke-test.sh` hardcode port 3847; with the live container holding 3847 they can't be run locally as-is (run throwaway copies on an alt port via `BOOKCLAW_PORT`, as was done during implementation).
   - After deploy + human acceptance (click-through that `/api/library` serves templates), write a COMPLETED.md entry for Phase 1 and trim the "Phase 1 DONE" note from TODO.md's umbrella item.
3. Bind-mount ownership: a fresh deploy needs `deploy.sh`'s chown step (uid 999) — see arch doc Docker note.

## Decisions made (don't re-litigate)

- **Built-in skills stay at repo `skills/`** (not moved into `library/`) — moving the tree would churn premium gitignore + Dockerfile + SKILLS.txt for no Phase-1 gain. Only the **user overlay** relocates to `workspace/library/skills/`. (Resolves arch-doc "collides with" #3.)
- **`novel-pipeline` ships as a `dynamic: true` descriptor** with `steps: []` — it is code-generated (computed beat boundaries + one step/chapter); faithful data-expansion is Phase 3.
- **The 6 pipelines coexist as TS constants AND JSON until Phase 3.** A drift-guard unit test keeps them identical. The engine still reads `PROJECT_TEMPLATES`; Phase 3 deletes the constants and reads the JSON.
- **Library is read-only in Phase 1.** No `safePath` needed (lookups are name-keyed against in-memory maps, never filesystem paths). Editor write-path is Phase 4.
- **No dashboard UI in Phase 1** (read API only).

## Deferred to later phases (do NOT build here)

- Book entity / `book.json` / snapshot-on-create / version gate → **Phase 2**.
- **New Book page** (per-component selection UI; default pull-all) — owner ask 2026-06-06 → **Phase 2**. Tracked in `docs/TODO.md` under the multi-author umbrella.
- Per-book `SoulService`/`ProjectEngine` wiring; engine reads `pipeline.json`; delete constants; dynamic novel-pipeline data-expansion → **Phase 3**.
- Editor re-point (two edit scopes) + re-pull → **Phase 4**.

## Deploy

Sentinel trigger on the NFS-exported tree: `touch build_now` → Mercury (`192.168.1.32:3847`) rebuilds in ~1 min; check `.build-logs/last-build.status` for `result=PASS`.
