# Book-Container Phase 2 (Book entity) — STATUS

_Source of truth for **where we are**. Updated 2026-06-06._

**Plan:** `docs/superpowers/plans/2026-06-06-book-container-phase-2-book-entity.md` (complete, TDD, 6 tasks).
**Design:** `docs/BOOK-CONTAINER-ARCHITECTURE.md` (Phase 2). **Phase 1:** done + on remote (`84b64bb`).

## Workflow (IMPORTANT — changed 2026-06-06)
- Work directly on **`main`** (sole maintainer; no feature branches). See [[git-workflow-main-pushsh]].
- **Do NOT `git commit`/`git push`.** Accumulate changes in the working tree; write `commit_message`; the maintainer runs `./push.sh`.
- Execution: **subagent-driven**, adapted — subagents leave changes uncommitted; controller reviews between tasks via `git diff`; one `commit_message` at the end.

## Phase table

| # | Task | Status |
|---|------|--------|
| — | Plan written + reviewed | ✅ (2026-06-06) |
| — | Scope decisions | ✅ lean (gate yes, migration runners no); snapshot = author/genre/pipeline/sections (**skills deferred** to Phase 3/4); one combined plan |
| 1 | `book-types.ts` (manifest types, BOOK_SCHEMA_VERSION, slugify, classifyVersion) + unit tests | ✅ |
| 2 | `BookService` create(snapshot)/list/open(gate) + unit tests | ✅ |
| 3 | Wire BookService into init (phase-05) + getServices | ✅ |
| 4 | Books API (GET /api/books[/:slug], POST /api/books) + API tests | ✅ |
| 5 | New Book dashboard panel (nav + panel + panels/books.js + build) | ✅ |
| 6 | Docs + this status + write commit_message | ✅ |
| — | Final whole-change review | ⬜ in progress |
| — | Maintainer: `./push.sh` → deploy (`touch build_now`) → click-through acceptance | ⬜ **NEXT** |

**All 6 tasks implemented + reviewed (spec + code-quality) subagent-driven; no commits made (changes uncommitted on `main` per workflow).** 47/47 unit, `tsc` clean, API checks pass on an isolated port (live 3847 untouched), dashboard build clean (placeholder + `panel-books` present). `.gitignore` updated to ignore `workspace/books/` so `push.sh`'s `git add .` never commits runtime books.

## Decisions (don't re-litigate)
- **Lean Phase 2:** version gate ships (too-old→quarantine, too-new→read-only); migration step runners + existing-data migration deferred (no v2 schema, nothing to migrate — fresh workspace).
- **Snapshot covers author/genre/pipeline/sections.** Skills join the book snapshot in Phase 3/4 (when injected into the book pipeline) — avoids plumbing skill-category trees now.
- **Phase 2 stores books; does not drive generation** (SoulService/ProjectEngine wiring = Phase 3).
- Slug from title (lowercase, non-alnum→`-`, ≤60, uniqueness `-2/-3`). `status` computed from gate, not stored. No book index file (dir is the store).

## How to resume
1. Read this + the plan. Verify: `git branch --show-current` (main), `git status` (uncommitted Phase 2 work?), `ls gateway/src/services/book*.ts`, `find workspace/books -maxdepth 2 2>/dev/null`.
2. Tests: `npm run test:unit` (port-free). API/smoke hardcode 3847 → run throwaway copies on an alt port (live container holds 3847).
3. Next: continue at the first ⬜ task per the plan. At the end, write `commit_message` and tell the maintainer to `./push.sh` (do not push yourself).
