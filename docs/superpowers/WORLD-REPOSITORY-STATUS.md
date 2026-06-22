# World Repository — Status & Handoff

**Last updated:** 2026-06-22 (session handoff for moving to another system)

This is the portable, git-tracked snapshot of the World Repository feature's state. The live SDD scratch (`.superpowers/sdd/`) is gitignored and local-only — this file carries everything needed to resume elsewhere.

## TL;DR

**The feature is fully implemented, committed/pushed (`origin/main` @ `2843d53`), and deployed.** Phases 1, 3, 4, 5, 6 are built, code-reviewed, tested, and **running live on Mercury** (`http://192.168.1.32:3847`). The only remaining work is **Phase 2 — the owner-run Luminarch/Shattered-Cradle data import** (intentionally off-GitHub; not a coding task).

## Portability of the current state

The feature work **is committed and pushed to `origin/main`** — commits `283cd4c` (Phase 1) and `2843d53` (Phases 1+3+4+5+6). A fresh `git clone`/`git pull` on any host gets the complete feature; no further action is needed to move it.

- The **only** uncommitted item is this status doc (`docs/superpowers/WORLD-REPOSITORY-STATUS.md`). Run `./push.sh` once more (a `commit_message` for it is in the repo root) to include it on the remote, or just read it locally.
- The `.superpowers/sdd/` SDD scratch (ledger, per-phase reports, review packages) is gitignored and stays on this host — this doc is its portable summary.
- Pre-existing edits to `docker/docker-compose.yml` / `docker-compose.writing.yml`: these were already committed as part of the pushed commits (`./push.sh` does `git add .`). If they should not have ridden along, review `git show 2843d53` / `283cd4c`.

## Deploy mechanism (so it's not mysterious)

`build_now` is a **gitignored local sentinel**, not a git artifact. Mercury runs `scripts/build-watch.sh` on a 1-minute systemd timer; when it sees `build_now` in the repo root (which lands on Mercury's disk via NFS from any client), it rebuilds the Docker image **from the current working tree** (no git pull) via `scripts/deploy.sh`, redeploys on port 3847, and removes the sentinel. So `touch build_now` deploys the working tree to Mercury directly — **a `git push` is not required for deployment** (push is only for git history). Build logs: `.build-logs/` (gitignored); status in `.build-logs/last-build.status`.

The final build this session passed; the deployed image was verified to serve the world feature (`GET /api/worlds` → `{"worlds":[]}`; the generic `world-author` editor is baked in).

## What was built, by phase

- **Phase 1 — world kind + CRUD** (COMPLETED.md 2026-06-22): `world` library kind; `world-types.ts`; `world-parse.ts` (`parseWorldJson`, `parseWorldDoc`/`serializeWorldDoc` hand-rolled frontmatter incl. inline `tags:[a,b]`, `nextClassification` = monotonic max+1); `WorldService` (config read-through + documents CRUD + auto-classify); `worlds.routes.ts` (7 routes, single-doc responses wrapped `{document}`); wired in `index.ts` (`services.world`, singular) + `init/phase-05`. `world` rejected in `library-transfer`.
- **Phase 3 — binding/pull/snapshot**: `world` ref on series (`REF_KINDS`) + book manifest (`pulledFrom.world`, `worldDocs`, `WIRED_KINDS`, `updatePulledFrom` branch); `WorldService.proposeWorldDocs` (relevance-pull → `{proposals}`, fail-soft to full catalog); `snapshotWorldDocs` → `books/<slug>/templates/world/<docId>.md` + `.baseline`; 3-way re-pull extended; `worldDocsOf` composed into the `worldGuide` system-prompt rail. Endpoints `POST /api/books/:slug/world/propose`, `PUT …/world/docs`. Guards: `writeTemplate` rejects `world`; `snapshotWorldDocs` validates docId.
- **Phase 4 — authoring editor (generic, user-replaceable)**: `library/editors/world-author.json` (neutral built-in; defers to runtime-injected world context). A world names its editor via `world.json.authoringEditor` (default `world-author`); **the user replaces it by setting that field to any editor asset** via the library API — no code change. `world-authoring.ts` helpers (`composeWorldAuthoringContext` capped at 50 catalog rows, `worldForAuthoringEditor` warns on ambiguity, `proposedDocToCreateInput`); `worldContext` threaded into `composeEditorPrompt` + `buildSystemPrompt` (additive, fail-soft).
- **Phase 5 — appendix render**: `BookManifest.appendix` + `BookService.setAppendix`; `PUT /api/books/:slug/world/appendix → {appendix}`; `world-appendix.ts` (`resolveBookAppendix` — orders, snapshot-first then live, enforces `appendixEligible`, fail-soft; `stripAppendixCodes` — strips Classification/Distribution/Access-Level body lines when `stripCodesInAppendix`, keeps attribution); DOCX (`NEXT_PAGE` sections) + EPUB (XHTML + manifest/spine) back-matter, threaded through the documents compile/export route. Appendix is independent of the bible `worldDocs`.
- **Phase 6 — React studio UI**: `frontend/studio/src/lib/worldApi.ts` (correct envelope unwraps); world repository browser (`components/asset/WorldEditor` = world.json config, `WorldDocEditor` = doc CRUD, `lib/worldGroup.ts`) wired into `AssetStudio`/`KindRail`/`EntryList`; New-Book `components/newbook/WorldPicker`; `components/book/{BuildBiblePanel,AppendixPanel}` in `BookDrawer`. Shared types in `frontend/shared/src/types.ts`. Fixed a Phase-1 frontend build break (`GLOSSARY`/`KIND_LABELS` lacked a `world` key).

## Verification status

- Full backend unit suite: **557/557** on repeated runs. `npx tsc --noEmit` clean. `npm run build:frontend` exit 0.
- `tests/world-crud-smoke.sh`: **29 checks PASS** (boots the gateway locally: world CRUD + book binding + propose + curate→snapshot + series world-ref + `authoringEditor` config + generic editor loads + appendix select/persist). Hermetic + self-cleaning.
- Mercury deployed image: verified serving the world routes + the generic editor.

## Known issues / deferred (non-blocking)

- **Pre-existing intermittent test flake** (NOT world-related): a confirmation-gate persistence test occasionally fails with `ENOENT` on `rename .../confirmations.json.tmp` (an async-write-races-own-cleanup temp-dir race). Observed once across many runs; world tests are deterministic. Worth a separate fix (guard the async persist against cleanup), not a world defect.
- **Minor review findings deferred to future polish** (all below the "fix medium+" bar): `parseWorldJson` `domains`/`clearanceLevels` drop non-string entries with a slightly misleading error + don't trim `label`/`description`; `parseInlineArray` splits tags on commas without honoring quotes; EPUB nav TOC doesn't list appendix entries; DOCX appendix titles are uppercased. None affect correctness at current scope.
- **Cross-phase note for the Phase 2 import:** `nextClassification` mints `codex → CO`, but the real Luminarch codex codes use `CN`. The import preserves existing codes, so only *new* codex docs would diverge — confirm the desired abbreviation before/while importing.

## How to resume Phase 2 (owner-run)

Phase 2 is a data task, not code: import `~/data/Writing/shattered-cradle-world/Luminarch/*.md` into a `world` on the Neptune writing instance, kept off GitHub. The reference plan (if an importer is ever wanted) is `docs/superpowers/plans/2026-06-21-world-repository-phase-2-luminarch-migration.md`. The feature is otherwise complete and live.

## Key references

- Design spec: `docs/superpowers/specs/2026-06-21-world-repository-design.md` (all sections approved)
- Plans + shared contract: `docs/superpowers/plans/2026-06-21-world-repository-00-index-and-contract.md` (the "Resolved reconciliations" section is authoritative) + the six `…-phase-N-…` plans
- Completion record: `docs/COMPLETED.md` (2026-06-22 entries for Phase 1 and Phases 3–6)
- Roadmap status: `docs/TODO.md` (★ World Repository block)
